// Blairface (MirrorBoss phase 2) arrow reflection: a player's own Arrow
// bounces off her instead of dealing damage, becomes an enemy projectile
// aimed back at the player, and can never bounce twice. Phase 1, melee, and
// every other boss are asserted unaffected.
const { loadGame } = require('./test_env');
const vm = require('vm');
const ROOT = require('path').resolve(__dirname, '..'); // repo root, wherever it was cloned

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`OK   ${label}`);
  else { failures++; console.log(`FAIL ${label}  ${detail !== undefined ? JSON.stringify(detail) : ''}`); }
}

const sb = loadGame(ROOT);
const ctx = sb.__sandbox;
const run = (code) => vm.runInContext(code, ctx);
// Binds real Node-side object references into the vm context under their
// own names before evaling — needed whenever a test holds more than one
// live JS object of the same kind (two arrows, two players) that the
// fixed-name run() helper alone can't address.
const runWith = (code, bindings) => vm.runInContext(code, Object.assign(ctx, bindings));

const SNAPSHOT = 'snap = { maxHp: 100, weaponDamage: 12, weaponRange: 60, weaponCooldown: 0.4, moveSpeed: 200, damageReduction: 0, skinId: null };';

function freshBoss() {
  run(SNAPSHOT);
  return run('boss = new MirrorBoss(500, 500, snap)');
}
function freshPlayer(x) {
  run(`player = new Player(${x}, 500, 100, 1, 1, 3, null)`);
  return run('player');
}
function freshArrow(x, y, facing, damage) {
  run(`arrow = new Arrow(${x}, ${y}, ${facing}, ${damage}, 60, '#c9b98a')`);
  return run('arrow');
}
const ROOM = () => ({ width: 5000, platforms: [] });

// --- 1. Phase 1: arrows work exactly as before (no reflection at all) ---
{
  freshBoss();
  check('a fresh MirrorBoss starts in phase 1', run('boss.phase') === 1);
  check('phase 1 does not reflect arrows', run('boss.reflectsArrows()') === false);

  const hpBefore = run('boss.hp');
  const arrow = freshArrow(run('boss.x') + 5, run('boss.y') + 5, 1, 20);
  // Same routing main.js's projectile loop uses: reflect-check first, then
  // the ordinary resolveAttack() path if it doesn't apply.
  const reflects = run('boss.alive && boss.reflectsArrows() && aabbIntersect(arrow, boss)');
  check('phase 1: the reflect branch never triggers', reflects === false);
  run('boss.takeDamage(arrow.damage)');
  check('phase 1: a landed arrow damages her normally', run('boss.hp') < hpBefore, { hpBefore, hpAfter: run('boss.hp') });
  check('phase 1: the arrow is still owned by the player (unaffected)', arrow.owner === 'player');
}

// --- 2. Transforming window: still no reflection (matches old invulnerability) ---
{
  const boss = freshBoss();
  boss.hp = 0;
  run('boss.onDepleted()');
  check('depleting phase-1 HP starts the transform, not death', run('boss.transforming') === true && run('boss.alive') === true);
  check('mid-transform, phase is still reported as 1 (completeTransformation flips it)', run('boss.phase') === 1);
  check('mid-transform, reflectsArrows() is still false', run('boss.reflectsArrows()') === false);
  // Advance past the transform.
  run(`room = ${JSON.stringify(ROOM())};`);
  freshPlayer(300);
  for (let i = 0; i < 200 && run('boss.transforming'); i++) run('boss.update(1/60, room, player)');
  check('the transform eventually completes into phase 2', run('boss.phase') === 2 && run('boss.name') === 'Блэрифейс');
}

// --- 3. Phase 2: the core mechanic ---
{
  const boss = freshBoss();
  boss.phase = 2; // jump straight to phase 2, isolating the reflection logic from the transform timing
  boss.transforming = false;
  check('phase 2 reports reflectsArrows() true', run('boss.reflectsArrows()') === true);

  const player = freshPlayer(run('boss.x') - 200);
  const hpBefore = run('boss.hp');
  const arrow = freshArrow(run('boss.x') + 5, run('boss.y') + 5, 1, 25);
  const vxBefore = arrow.vx;

  run('boss.reflectArrow(arrow, player)');

  check('reflection deals NO damage to Blairface', run('boss.hp') === hpBefore, { hpBefore, hpAfter: run('boss.hp') });
  check('the arrow survives reflection (still alive)', arrow.alive === true);
  check('the arrow is re-flagged as an enemy projectile', arrow.owner === 'enemy');
  check('the arrow reverses horizontal direction (was heading right, now heads left, toward the player)',
    arrow.vx < 0 && vxBefore > 0, { vxBefore, vxAfter: arrow.vx });
  check('speed magnitude is preserved (same physics, just re-aimed)',
    Math.abs(arrow.vx) === Math.abs(vxBefore), { before: Math.abs(vxBefore), after: Math.abs(arrow.vx) });
  check('the arrow keeps its original damage value', arrow.damage === 25);
  check('the arrow visually flags itself as hostile (recolored to Blairface\'s own accent)',
    arrow.color === sb.BLAIREFACE_REFLECT_COLOR, arrow.color);
  check('Blairface flashes to acknowledge the deflection (juice, no HP cost)', run('boss.hitFlash') > 0);
}

// --- 4. Direction is aimed at the PLAYER'S CURRENT position, not just flipped ---
{
  const boss = freshBoss();
  boss.phase = 2; boss.transforming = false;
  // Player standing to the LEFT of the boss — the reflected arrow must fly
  // left (toward them), regardless of which way the incoming arrow was
  // already travelling.
  const bossX = run('boss.x'), bossY = run('boss.y');
  const playerLeft = { x: bossX - 300, w: 28, h: 40 };
  const arrowFromLeft = runWith(`new Arrow(${bossX - 5}, ${bossY}, 1, 10, 60, '#c9b98a')`, {}); // was flying rightward, INTO her
  runWith('boss.reflectArrow(arrowFromLeft, playerLeft)', { arrowFromLeft, playerLeft });
  check('player to the left -> reflected arrow flies left', arrowFromLeft.vx < 0, arrowFromLeft.vx);

  const playerRight = { x: bossX + 300, w: 28, h: 40 };
  const arrowFromRight = runWith(`new Arrow(${bossX + 5}, ${bossY}, -1, 10, 60, '#c9b98a')`, {}); // was flying leftward, INTO her
  runWith('boss.reflectArrow(arrowFromRight, playerRight)', { arrowFromRight, playerRight });
  check('player to the right -> reflected arrow flies right', arrowFromRight.vx > 0, arrowFromRight.vx);
}

// --- 5. A reflected arrow can actually hit the player (full loop, no shortcuts) ---
{
  const boss = freshBoss();
  boss.phase = 2; boss.transforming = false;
  const room = ROOM();
  run(`room = ${JSON.stringify(room)};`);
  const player = freshPlayer(run('boss.x') - 260);
  player.takeDamage = function (amount, fromX) { this.hp -= amount; this.lastHitFrom = fromX; };
  player.hp = 100;

  const arrow = freshArrow(run('boss.x'), run('boss.y') + 5, 1, 18);
  run('boss.reflectArrow(arrow, player)');

  // Fly it toward the player exactly the way main.js's loop does: update(),
  // then (since owner is now 'enemy') check aabbIntersect against the player.
  let hit = false;
  for (let i = 0; i < 300 && arrow.alive && !hit; i++) {
    vm.runInContext('arrow.update(1/60, room)', Object.assign(ctx, { arrow, room }));
    if (arrow.alive && vm.runInContext('aabbIntersect(arrow, player)', Object.assign(ctx, { arrow, player }))) {
      player.takeDamage(arrow.damage, arrow.x);
      arrow.alive = false;
      hit = true;
    }
  }
  check('the reflected arrow actually reaches and hits the player', hit === true);
  check('it deals the ORIGINAL arrow\'s damage', player.hp === 100 - 18, player.hp);
}

// --- 6. No infinite / double reflection ---
{
  const boss = freshBoss();
  boss.phase = 2; boss.transforming = false;
  const player = freshPlayer(run('boss.x') - 200);
  const arrow = freshArrow(run('boss.x'), run('boss.y'), 1, 10);

  run('boss.reflectArrow(arrow, player)');
  check('after one reflection, owner is enemy', arrow.owner === 'enemy');

  // Simulate the arrow drifting back over the boss's own box (e.g. it
  // overlaps her again on its way past). main.js's real loop would never
  // even offer an 'enemy' arrow to the reflect branch — reproduce that
  // routing decision directly, since that's the actual guarantee.
  const stillOverlapping = run('aabbIntersect(arrow, boss)');
  const wouldReflectAgain = arrow.owner === 'player' && run('boss.reflectsArrows()') && stillOverlapping;
  check('an already-reflected arrow can never be offered to reflectArrow() again', wouldReflectAgain === false);

  // Even if reflectArrow() were somehow called twice (defensive check on the
  // method itself, not just the routing), the result must stay physically
  // sane rather than compounding.
  const vxAfterFirst = arrow.vx;
  run('boss.reflectArrow(arrow, player)');
  check('calling reflectArrow() again does not change owner (already enemy)', arrow.owner === 'enemy');
  check('...and does not blow up the speed (same magnitude, still just re-aimed)',
    Math.abs(arrow.vx) === Math.abs(vxAfterFirst), { vxAfterFirst, vxNow: arrow.vx });
}

// --- 7. Melee is completely unaffected in phase 2 ---
{
  const boss = freshBoss();
  boss.phase = 2; boss.transforming = false;
  const hpBefore = boss.hp;
  const meleeHitbox = { x: boss.x, y: boss.y, w: boss.w, h: boss.h, damage: 15 };
  runWith('boss.takeDamage(hitbox.damage)', { hitbox: meleeHitbox });
  check('a melee hit still damages Blairface normally in phase 2', boss.hp < hpBefore, { hpBefore, hpAfter: boss.hp });
}

// --- 8. Other bosses / other MirrorBoss states never reflect ---
{
  check('BossBase (every non-mirror boss) reports reflectsArrows() false by default',
    run(`(function(){
      const b = new SakarverBoss(0, 0, {});
      return b.reflectsArrows();
    })()`) === false);
}

// --- 9. Phase transition end to end, then death/hub-return path intact ---
{
  const boss = freshBoss();
  const room = ROOM();
  run(`room = ${JSON.stringify(room)};`);
  const player = freshPlayer(boss.x - 30);

  // Drain phase 1 via the boss's own takeDamage (mirrors how resolveAttack
  // calls it) — confirms the 1 -> 2 transition itself is untouched.
  run('boss.hp = 1; boss.takeDamage(999)');
  check('phase 1 depletion transforms rather than kills', run('boss.alive') === true && run('boss.transforming') === true);
  for (let i = 0; i < 300 && run('boss.transforming'); i++) run('boss.update(1/60, room, player)');
  check('transform completes into phase 2 with its own (smaller) HP pool',
    run('boss.phase') === 2 && run('boss.maxHp') === Math.round(100 * sb.BLAIREFACE_PHASE2_HP_FRACTION));

  // A phase-2 arrow reflects...
  const arrow = freshArrow(boss.x, boss.y, 1, 10);
  run('boss.reflectArrow(arrow, player)');
  check('reflection in the live fight still leaves her HP untouched', run('boss.hp') === run('boss.maxHp'));

  // ...but melee still finishes the fight normally.
  run('boss.hp = 0; boss.onDepleted()');
  check('depleting phase-2 HP kills her for real (no second transform)', run('boss.alive') === false);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
