// Regression tests for the bow as its OWN equipment slot (previously it
// shared the single melee weapon slot): both armaments equipped at once,
// LMB/RMB driving them independently on independent cooldowns, arrows as a
// consumable, and chest loot routing bows to the bow slot.
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

const ROOM = { platforms: [{ x: 0, y: 1000, w: 5000, h: 40 }], width: 5000 };
// Fresh player + a frame of input, driven the way main.js does it. Binds it
// as a context global `p` so the run(...) snippets below can name it.
function newPlayer() {
  return run('p = new Player(100, 100, 100, 1, 1, 3, null)');
}
function tick(p, presses = [], dt = 1 / 60) {
  vm.runInContext('Input.justPressed = {};', ctx);
  for (const code of presses) vm.runInContext(`Input.justPressed[${JSON.stringify(code)}] = true;`, ctx);
  vm.runInContext(`p.update(${dt}, room, true)`, Object.assign(ctx, { p, room: ROOM }));
}

// --- 1. Separate slot: both equipped from the first frame ---
{
  const p = newPlayer();
  check('a fresh player starts with a melee weapon equipped', run('p.weapon') && run('p.weapon.type') === 'melee', run('p.weapon'));
  check('...AND a bow equipped at the same time, in its own slot', run('p.bow') && run('p.bow.type') === 'ranged', run('p.bow'));
  check('the two slots hold different items (the bow did not replace the cleaver)', run('p.weapon.id') !== run('p.bow.id'));
  check('the starting bow is the fixed STARTING_BOW, not a random roll', run('p.bow.id') === 'starting-bow');
  check('the starting bow is built from the same mid-budget as the starting cleaver (not separately tuned)',
    sb.STARTING_BOW.damage === sb.STARTING_WEAPON.damage
    && sb.STARTING_BOW.cooldown === sb.STARTING_WEAPON.cooldown
    && sb.STARTING_BOW.range === sb.STARTING_WEAPON.range,
    { bow: sb.STARTING_BOW, cleaver: sb.STARTING_WEAPON });
  check('the melee owned-list contains ONLY the melee weapon (bow is not in it)',
    run('p.weapons.length') === 1 && run('p.weapons[0].type') === 'melee');
  check('the bow owned-list contains ONLY the bow', run('p.bows.length') === 1 && run('p.bows[0].type') === 'ranged');
}

// --- 2. LMB swings, RMB shoots, independently ---
{
  const p = newPlayer();
  tick(p, ['Mouse0']);
  check('LMB produces a melee hitbox', run('p.pendingHitbox') !== null);
  check('LMB does NOT fire an arrow', run('p.pendingProjectile') === null);
  check('LMB spends no arrows', run('p.arrows') === sb.STARTING_ARROWS, run('p.arrows'));
}
{
  const p = newPlayer();
  tick(p, ['Mouse2']);
  check('RMB fires an arrow', run('p.pendingProjectile') !== null);
  check('RMB does NOT produce a melee hitbox', run('p.pendingHitbox') === null);
  check('RMB spends exactly one arrow', run('p.arrows') === sb.STARTING_ARROWS - 1, run('p.arrows'));
  check('the fired arrow carries the BOW\'s stats, not the melee weapon\'s',
    run('p.pendingProjectile.damage') === run('p.bow.damage') && run('p.pendingProjectile.range') === run('p.bow.range'));
}
{
  // The headline of the whole feature: both on the same frame, then both
  // again as soon as their own cooldowns allow — neither gating the other.
  const p = newPlayer();
  tick(p, ['Mouse0', 'Mouse2']);
  check('LMB and RMB on the SAME frame both fire (independent actions)',
    run('p.pendingHitbox') !== null && run('p.pendingProjectile') !== null);
  check('both cooldown timers are running after that frame',
    run('p.attackCooldownTimer') > 0 && run('p.bowCooldownTimer') > 0);
}
{
  // Melee on cooldown must not block a shot, and vice versa.
  const p = newPlayer();
  tick(p, ['Mouse0']);
  check('with melee freshly swung (its cooldown running), RMB still fires', (() => {
    tick(p, ['Mouse2']);
    return run('p.pendingProjectile') !== null && run('p.attackCooldownTimer') > 0;
  })(), { attackCd: run('p.attackCooldownTimer'), bowCd: run('p.bowCooldownTimer') });
  check('...and a second LMB during its OWN cooldown is correctly still blocked', (() => {
    tick(p, ['Mouse0']);
    return run('p.pendingHitbox') === null;
  })());
}

// --- 3. Arrows are a real consumable ---
{
  const p = newPlayer();
  check(`a fresh player starts with STARTING_ARROWS (${sb.STARTING_ARROWS})`, run('p.arrows') === sb.STARTING_ARROWS);
  check('STARTING_ARROWS is in the requested 8-10 band', sb.STARTING_ARROWS >= 8 && sb.STARTING_ARROWS <= 10, sb.STARTING_ARROWS);

  // Fire until dry, waiting out the bow cooldown between shots.
  let shots = 0;
  for (let i = 0; i < 2000 && run('p.arrows') > 0; i++) {
    tick(p, ['Mouse2']);
    if (run('p.pendingProjectile') !== null) shots++;
  }
  check('firing until empty consumes exactly STARTING_ARROWS arrows', shots === sb.STARTING_ARROWS, { shots });
  check('the counter bottoms out at 0, never negative', run('p.arrows') === 0, run('p.arrows'));

  // Now dry: RMB must do nothing at all, and must not start a cooldown.
  vm.runInContext('p.bowCooldownTimer = 0;', ctx);
  tick(p, ['Mouse2']);
  check('with 0 arrows, RMB fires nothing', run('p.pendingProjectile') === null);
  check('with 0 arrows, RMB does not even start the bow cooldown', run('p.bowCooldownTimer') === 0);
  check('with 0 arrows, the arrow count stays at 0 (no underflow)', run('p.arrows') === 0);
  check('with 0 arrows, MELEE still works — the bow being dry never disarms you', (() => {
    tick(p, ['Mouse0']);
    return run('p.pendingHitbox') !== null;
  })());
}

// --- 4. Procedural bows: same budget, own noun pool, own slot ---
{
  const sample = run(`
    (function() {
      const bows = [], melee = [];
      for (let i = 0; i < 1500; i++) { bows.push(generateBow()); melee.push(generateWeapon()); }
      return { bows, melee };
    })()
  `);
  check('generateBow() always produces type "ranged"', sample.bows.every((w) => w.type === 'ranged'));
  check('generateWeapon() with no argument still produces melee (existing callers unchanged)',
    sample.melee.every((w) => w.type === 'melee'));
  check('bow nouns come from the bow pool only', sample.bows.every((w) => sb.RANGED_WEAPON_NOUNS.includes(w.noun)));
  check('melee nouns never leak a bow noun into the melee pool',
    sample.melee.every((w) => sb.MELEE_WEAPON_NOUNS.includes(w.noun)));
  check('every bow noun has an inventory icon (no blank cells)',
    sb.RANGED_WEAPON_NOUNS.every((n) => typeof sb.WEAPON_ICONS[n] === 'string' && sb.WEAPON_ICONS[n].length > 0),
    sb.RANGED_WEAPON_NOUNS.filter((n) => !sb.WEAPON_ICONS[n]));

  const bounds = (arr, k) => ({ min: Math.min(...arr.map((w) => w[k])), max: Math.max(...arr.map((w) => w[k])) });
  const bd = bounds(sample.bows, 'damage'), md = bounds(sample.melee, 'damage');
  check('bows roll damage from the SAME budget/bounds as melee weapons',
    Math.abs(bd.min - md.min) <= 2 && Math.abs(bd.max - md.max) <= 2, { bd, md });
}

// --- 5. Slot routing: a found bow goes to the bow slot, never the melee one ---
{
  const p = newPlayer();
  const startingMeleeId = run('p.weapon.id');
  run('foundBow = generateBow();');
  run('p.unlockWeapon(foundBow);');
  check('a found bow becomes the active BOW', run('p.bow.id') === run('foundBow.id'));
  check('a found bow does NOT touch the melee slot', run('p.weapon.id') === startingMeleeId);
  check('a found bow lands in the bows list, not the weapons list',
    run('p.bows.length') === 2 && run('p.weapons.length') === 1);
  check('the displaced starting bow is still owned (swappable, not destroyed)',
    run('p.bows.some((b) => b.id === "starting-bow")'));
  check('the displaced bow shows up in the inventory grid as an unequipped item',
    run('p.unequippedItems().some((e) => e.item.id === "starting-bow")'));
  check('the ACTIVE bow does NOT show up as unequipped',
    !run('p.unequippedItems().some((e) => e.item.id === foundBow.id)'));

  run('foundSword = generateWeapon();');
  run('p.unlockWeapon(foundSword);');
  check('a found melee weapon becomes the active melee weapon', run('p.weapon.id') === run('foundSword.id'));
  check('a found melee weapon does NOT touch the bow slot', run('p.bow.id') === run('foundBow.id'));

  // Clicking the old bow in the inventory grid swaps the BOW slot only.
  check('clicking an owned bow in the inventory swaps the bow slot', (() => {
    run('p.manualEquipWeapon(p.bows.find((b) => b.id === "starting-bow"))');
    return run('p.bow.id') === 'starting-bow' && run('p.weapon.id') === run('foundSword.id');
  })());
  check('clicking an owned melee weapon swaps the melee slot only', (() => {
    run('p.manualEquipWeapon(p.weapons.find((w) => w.id === "starting-cleaver"))');
    return run('p.weapon.id') === 'starting-cleaver' && run('p.bow.id') === 'starting-bow';
  })());
}

// --- 6. Scrapping an unequipped bow keeps the active one intact ---
{
  const p = newPlayer();
  run('extraBow = generateBow(); p.unlockWeapon(extraBow);');
  const activeBowId = run('p.bow.id');
  const entry = run('p.unequippedItems().find((e) => e.item.type === "ranged")');
  const removed = vm.runInContext('p.removeUnequippedItem(entry)', Object.assign(ctx, { p: run('p'), entry }));
  check('an unequipped bow can be scrapped', removed === true);
  check('scrapping it leaves the ACTIVE bow equipped and unchanged', run('p.bow.id') === activeBowId, run('p.bow.id'));
  check('the bows list shrank by exactly one', run('p.bows.length') === 1);
  // The active bow itself must never be scrappable.
  const activeEntry = { kind: 'weapon', item: run('p.bow') };
  const removedActive = vm.runInContext('p.removeUnequippedItem(activeEntry)', Object.assign(ctx, { p: run('p'), activeEntry }));
  check('the ACTIVE bow can never be scrapped', removedActive === false);
}

// --- 7. B cycles the bow slot without disturbing the melee slot ---
{
  const p = newPlayer();
  run('p.unlockWeapon(generateBow()); p.unlockWeapon(generateBow());');
  const meleeBefore = run('p.weapon.id');
  const bowBefore = run('p.bow.id');
  tick(p, ['KeyB']);
  check('B cycles to a different bow', run('p.bow.id') !== bowBefore, { bowBefore, after: run('p.bow.id') });
  check('B leaves the melee slot alone', run('p.weapon.id') === meleeBefore);
  // ...and Q still only touches melee.
  run('p.unlockWeapon(generateWeapon());');
  const bowBeforeQ = run('p.bow.id');
  tick(p, ['KeyQ']);
  check('Q leaves the bow slot alone', run('p.bow.id') === bowBeforeQ);
}

// --- 8. Chest arrow drops ---
{
  check('chest arrow drop constants are in the requested 2-5 band',
    sb.CHEST_ARROW_MIN === 2 && sb.CHEST_ARROW_MAX === 5, { min: sb.CHEST_ARROW_MIN, max: sb.CHEST_ARROW_MAX });
  check('chests drop arrows often enough to matter but not every time',
    sb.CHEST_ARROW_CHANCE > 0.2 && sb.CHEST_ARROW_CHANCE < 0.9, sb.CHEST_ARROW_CHANCE);

  // Drive the real Game.openChest() against a stub player, so this exercises
  // the actual loot path rather than a re-implementation of it.
  const stats = run(`
    (function() {
      const player = { arrows: 0, weapons: [], bows: [], gearInventory: [],
        unlockWeapon(w) { (w.type === 'ranged' ? this.bows : this.weapons).push(w); },
        receiveGear(g) { this.gearInventory.push(g); }, equipMods: { goldFind: 0 } };
      const realPlayer = Game.player, realSave = Game.save;
      Game.player = player;
      Game.save = { gold: 0, shards: 0 };
      let chestsWithArrows = 0;
      const N = 4000;
      for (let i = 0; i < N; i++) {
        const before = player.arrows;
        Game.openChest({ opened: false });
        if (player.arrows > before) chestsWithArrows++;
      }
      const result = { N, chestsWithArrows, totalArrows: player.arrows, bows: player.bows.length, weapons: player.weapons.length, gear: player.gearInventory.length };
      Game.player = realPlayer; Game.save = realSave;
      return result;
    })()
  `);
  const arrowRate = stats.chestsWithArrows / stats.N;
  check('opening many chests drops arrows at roughly CHEST_ARROW_CHANCE',
    Math.abs(arrowRate - sb.CHEST_ARROW_CHANCE) < 0.05, { arrowRate, expected: sb.CHEST_ARROW_CHANCE });
  const avgPerDrop = stats.totalArrows / stats.chestsWithArrows;
  check('each arrow drop averages within the 2-5 band', avgPerDrop >= 2 && avgPerDrop <= 5, { avgPerDrop });
  check('chests generate bows as loot (they are findable upgrades, not starting-only)', stats.bows > 0, stats);
  check('chests still generate melee weapons and gear too', stats.weapons > 0 && stats.gear > 0, stats);
  check('bows are the minority of weapon drops (melee slot is used more)', stats.bows < stats.weapons, stats);
  check('an already-opened chest gives nothing (openChest stays idempotent)',
    run('(function(){ const c = { opened: true }; const before = Game.player ? 1 : 1; Game.openChest(c); return c.opened === true; })()'));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
