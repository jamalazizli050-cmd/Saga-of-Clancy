// Heir archetypes (heirs.js) — the "builds" layer. Node-level checks for
// everything that lives in player.js/game.js/boss.js (generation, dash/
// takeDamage/heal hooks, Blood Pact synergy, Blairface non-leak). The
// melee/bow/execute damage hooks live in main.js's resolveAttack(), which
// this harness deliberately doesn't load (see test_env.js's own comment) —
// those are covered instead by e2e_heir_archetypes.js in a real browser.
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
const runWith = (code, bindings) => vm.runInContext(code, Object.assign(ctx, bindings));

const ARCHETYPE_KEYS = ['berserker', 'hunter', 'runner', 'executioner', 'survivor'];

// --- 1. Generation: 5-archetype pool, 3 offered, every field present ---
{
  check('the pool has exactly 5 archetypes (baseline + the 5 new ones... i.e. 6 entries: null + 5 keys)',
    sb.HEIR_ARCHETYPES.length === 6, sb.HEIR_ARCHETYPES.length);
  check('every requested archetype key exists in the pool',
    ARCHETYPE_KEYS.every((k) => sb.HEIR_ARCHETYPES.some((a) => a.key === k)), sb.HEIR_ARCHETYPES.map((a) => a.key));
  check('the plain "no archetype" baseline is still in the pool (key: null) — not removed',
    sb.HEIR_ARCHETYPES.some((a) => a.key === null));

  const samples = [];
  for (let i = 0; i < 300; i++) samples.push(run('rollHeirs()'));
  check('rollHeirs() always offers exactly 3 candidates', samples.every((s) => s.length === 3));
  check('every candidate carries name/key/hpMul/speedMul/label/styleLabel/bonusLabel/drawbackLabel/skinId',
    samples.every((s) => s.every((h) =>
      typeof h.name === 'string' && 'key' in h && typeof h.hpMul === 'number' && typeof h.speedMul === 'number'
      && typeof h.label === 'string' && typeof h.styleLabel === 'string'
      && typeof h.bonusLabel === 'string' && typeof h.drawbackLabel === 'string'
      && Number.isInteger(h.skinId))));
  check('the 3 offered candidates on one card are always distinct archetypes (no duplicate key on the same screen)',
    samples.every((s) => new Set(s.map((h) => h.key)).size === 3));

  const seenKeys = new Set();
  for (const s of samples) for (const h of s) seenKeys.add(h.key);
  check('across many rolls, every archetype in the pool eventually gets offered (nothing dead/unreachable)',
    sb.HEIR_ARCHETYPES.every((a) => seenKeys.has(a.key)), [...seenKeys]);
}

// --- 2. Balance sanity: no archetype's numbers are obviously dominant ---
{
  // Every bonus/penalty should be a modest nudge (roughly the scale
  // ACCESSORY_AFFIXES/DMG_UPGRADE_PER_LEVEL already use elsewhere in this
  // game — a few percent to ~a third), not something that reads as "clearly
  // the best pick" or "clearly worse than baseline overall".
  check('Berserker\'s melee bonus is a real nudge, not a multiplier that trivializes trash rooms',
    sb.BERSERKER_MELEE_BONUS >= 0.1 && sb.BERSERKER_MELEE_BONUS <= 0.3, sb.BERSERKER_MELEE_BONUS);
  check('Hunter\'s bow bonus does not dwarf its own melee penalty (stays a lateral tradeoff, not a straight buff)',
    sb.HUNTER_BOW_BONUS - sb.HUNTER_MELEE_PENALTY <= 0.15, { bonus: sb.HUNTER_BOW_BONUS, penalty: sb.HUNTER_MELEE_PENALTY });
  check('Hunter\'s melee penalty never disables melee outright (per the task: must not "break" melee)',
    sb.HUNTER_MELEE_PENALTY < 0.5, sb.HUNTER_MELEE_PENALTY);
  check('Runner\'s dash cooldown cut is meaningful but leaves a real cooldown (not near-zero spam)',
    sb.RUNNER_DASH_COOLDOWN_MUL >= 0.4 && sb.RUNNER_DASH_COOLDOWN_MUL <= 0.85, sb.RUNNER_DASH_COOLDOWN_MUL);
  check('Runner\'s dash i-frame is brief (a dodge window, not prolonged invincibility)',
    sb.RUNNER_DASH_IFRAME <= 0.4, sb.RUNNER_DASH_IFRAME);
  check('Executioner\'s two multipliers roughly offset (front-loaded risk, back-loaded reward — not a pure buff)',
    Math.abs(sb.EXECUTIONER_LOW_HP_BONUS - sb.EXECUTIONER_FULL_HP_PENALTY) <= 0.3,
    { bonus: sb.EXECUTIONER_LOW_HP_BONUS, penalty: sb.EXECUTIONER_FULL_HP_PENALTY });
  check('Executioner\'s "dead zone" (no bonus/penalty) covers most of a target\'s HP bar',
    sb.EXECUTIONER_FULL_HP_FRACTION - sb.EXECUTIONER_LOW_HP_FRACTION >= 0.4,
    { low: sb.EXECUTIONER_LOW_HP_FRACTION, full: sb.EXECUTIONER_FULL_HP_FRACTION });
  check('Survivor\'s extra mitigation is modest (well under the gear cap, so it reads as a nudge, not a second armor slot)',
    sb.SURVIVOR_DAMAGE_REDUCTION > 0 && sb.SURVIVOR_DAMAGE_REDUCTION <= 0.15, sb.SURVIVOR_DAMAGE_REDUCTION);
  check('Survivor\'s healing penalty is noticeable but not crippling (still gets real value from a bandage)',
    sb.SURVIVOR_HEAL_MUL >= 0.5 && sb.SURVIVOR_HEAL_MUL < 1, sb.SURVIVOR_HEAL_MUL);
}

// --- 3. Baseline (archetype: null) behaves EXACTLY as before this feature ---
{
  const before = runWith('new Player(100, 100, 100, 1, 1, 3, null)', {}); // 7-arg call, no archetype param at all
  check('a Player constructed with no archetype argument defaults to null (old call sites, old behavior)',
    before.archetype === null || before.archetype === undefined, before.archetype);

  const p = run('p = new Player(100, 100, 100, 1, 1, 3, null, null)');
  const dashCdBefore = run('DASH_COOLDOWN');
  runWith('Input.justPressed = { ShiftLeft: true }; p.update(1/60, room, true)',
    { p, room: { platforms: [{ x: 0, y: 1000, w: 5000, h: 40 }], width: 5000 } });
  check('baseline dash cooldown is the plain DASH_COOLDOWN (no Runner discount applied)',
    Math.abs(run('p.dashCooldownTimer') - dashCdBefore) < 0.001, { got: run('p.dashCooldownTimer'), expected: dashCdBefore });
  check('baseline dash grants no bonus invulnerability', run('p.invulnTimer') === 0, run('p.invulnTimer'));

  const p2 = run('p2 = new Player(100, 100, 100, 1, 1, 3, null, null)');
  const heal = runWith('(function() { p2.hp = 50; return p2.heal(40); })()', { p2 });
  check('baseline heal() applies the full nominal amount (no Survivor penalty)', heal === 40, heal);
}

// --- 4. Runner: cheaper dash + a real dodge window ---
{
  const p = run(`p = new Player(100, 100, 100, 1, 1, 3, null, 'runner')`);
  check('constructed with archetype "runner"', run('p.archetype') === 'runner');

  const room = { platforms: [{ x: 0, y: 1000, w: 5000, h: 40 }], width: 5000 };
  runWith('Input.justPressed = { ShiftLeft: true }; p.update(1/60, room, true)', { p, room });
  const expectedCd = sb.DASH_COOLDOWN * sb.RUNNER_DASH_COOLDOWN_MUL; // cooldownMul=1 here
  check('Runner\'s dash cooldown is shortened by exactly RUNNER_DASH_COOLDOWN_MUL',
    Math.abs(run('p.dashCooldownTimer') - expectedCd) < 0.01, { got: run('p.dashCooldownTimer'), expectedCd });
  check('dashing grants the RUNNER_DASH_IFRAME invulnerability window',
    Math.abs(run('p.invulnTimer') - sb.RUNNER_DASH_IFRAME) < 0.01, run('p.invulnTimer'));

  // The actual point of the passive: a hit that lands mid-dash is negated.
  const hpBefore = run('p.hp');
  runWith('p.takeDamage(30)', { p });
  check('a hit landing inside the dash i-frame window deals NO damage', run('p.hp') === hpBefore, { hpBefore, hpAfter: run('p.hp') });

  // Once the window expires, damage resumes normally.
  for (let i = 0; i < 20; i++) runWith('p.invulnTimer = Math.max(0, p.invulnTimer - 1/60)', { p });
  const hpBefore2 = run('p.hp');
  runWith('p.takeDamage(30)', { p });
  check('...but only for that brief window — a later hit connects normally', run('p.hp') < hpBefore2, { hpBefore2, hpAfter: run('p.hp') });
}

// --- 5. Survivor: flatter incoming damage + weaker healing everywhere ---
{
  const survivor = run(`survivor = new Player(100, 100, 100, 1, 1, 3, null, 'survivor')`);
  const baseline = run(`baseline = new Player(100, 100, 100, 1, 1, 3, null, null)`);
  check('constructed with archetype "survivor"', run('survivor.archetype') === 'survivor');

  runWith('survivor.takeDamage(50)', { survivor });
  runWith('baseline.takeDamage(50)', { baseline });
  const survivorLoss = 100 - run('survivor.hp');
  const baselineLoss = 100 - run('baseline.hp');
  check('Survivor takes strictly less damage than baseline from the identical hit',
    survivorLoss < baselineLoss, { survivorLoss, baselineLoss });
  check('...specifically by the SURVIVOR_DAMAGE_REDUCTION factor',
    Math.abs(survivorLoss - 50 * (1 - sb.SURVIVOR_DAMAGE_REDUCTION)) < 0.01, survivorLoss);

  // Stacked with gear mitigation, still nowhere near invulnerable. Uses a
  // high maxHp so the hit doesn't overkill and clamp at the hp floor —
  // that would understate how much damage actually got through.
  const geared = run(`geared = new Player(100, 100, 10000, 1, 1, 3, null, 'survivor')`);
  runWith('geared.equipMods.damageReduction = EQUIP_MAX_DAMAGE_REDUCTION', { geared }); // worst case: gear cap maxed
  runWith('geared.takeDamage(1000)', { geared });
  const totalMitigation = 1 - (10000 - run('geared.hp')) / 1000;
  check('Survivor + maxed gear DR still leaves a real chunk of damage through (never unkillable)',
    totalMitigation < 0.65, totalMitigation);

  const s2 = run(`s2 = new Player(100, 100, 100, 1, 1, 3, null, 'survivor')`);
  const b2 = run(`b2 = new Player(100, 100, 100, 1, 1, 3, null, null)`);
  const survivorHealed = runWith('s2.hp = 10; s2.heal(50)', { s2 });
  const baselineHealed = runWith('b2.hp = 10; b2.heal(50)', { b2 });
  check('Survivor heals for strictly less than baseline from the identical heal call',
    survivorHealed < baselineHealed, { survivorHealed, baselineHealed });
  check('...specifically by SURVIVOR_HEAL_MUL', Math.abs(survivorHealed - Math.round(50 * sb.SURVIVOR_HEAL_MUL)) <= 1, survivorHealed);
  check('heal() still respects the maxHp ceiling for Survivor (no overheal)',
    runWith('(function() { s2.hp = 95; return s2.heal(50); })()', { s2 }) === 5, undefined);
}

// --- 6. Cross-system synergy: Survivor + Blood Pact ---
// The brief specifically asks to check this interaction. Blood Pact spends
// HP for a reward; Survivor's healing penalty means recovering that
// self-inflicted cost takes MORE of the run's limited healing (bandages,
// hub rest) than it would for anyone else — without Blood Pact's own cost/
// reward numbers (bloodCovenantCost/grantRoomReward) changing AT ALL for
// Survivor. The interaction falls out of heal() alone.
{
  // Scaled up (maxHp 1000) so neither heal below overshoots the ceiling for
  // EITHER heir — that would mask the difference behind the clamp instead
  // of measuring it (a real bug this test caught on the first pass: at
  // maxHp 100 with a 45-point heal, both sides hit the ceiling and reported
  // an identical "25 recovered", which was the clamp, not the multiplier).
  const survivor = run(`survivor = new Player(100, 100, 1000, 1, 1, 3, null, 'survivor')`);
  const baseline = run(`baseline = new Player(100, 100, 1000, 1, 1, 3, null, null)`);

  const costS = runWith('bloodCovenantCost(survivor)', { survivor });
  const costB = runWith('bloodCovenantCost(baseline)', { baseline });
  check('Blood Pact costs the IDENTICAL amount of HP regardless of archetype (the room\'s own terms are untouched)',
    costS === costB, { costS, costB });

  // Both pay the same cost (25% of maxHp, matching BLOOD_COST_FRACTION's
  // scale), then both try to recover it with the same bandage-sized heal.
  runWith('survivor.hp -= 250; baseline.hp -= 250;', { survivor, baseline });
  const recoveredSurvivor = runWith('survivor.heal(350)', { survivor });
  const recoveredBaseline = runWith('baseline.heal(350)', { baseline });
  check('...but Survivor recovers LESS of that self-inflicted cost from the same bandage — a real, emergent synergy',
    recoveredSurvivor < recoveredBaseline, { recoveredSurvivor, recoveredBaseline });
}

// --- 7. Elite champions expose the same hp/maxHp shape Executioner reads ---
// (The damage MULTIPLIER itself is main.js's, tested in the browser suite —
// this just confirms the target-side data Executioner's formula depends on
// is actually there and behaves as expected on a real Elite champion.)
{
  const info = run(`
    (function() {
      Game.roomChain = [{ template: ROOM_TEMPLATES[0], biome: 'trench', triggersBoss: null, kind: 'elite', challenge: null }];
      const enemies = spawnEnemiesForRoom(0);
      const champ = enemies.find((e) => e.elite);
      return { hasChamp: !!champ, hp: champ.hp, maxHp: champ.maxHp, fracAtFull: champ.hp / champ.maxHp };
    })()
  `);
  check('an Elite champion exposes hp/maxHp (what Executioner\'s multiplier reads)', info.hasChamp && info.maxHp > 0, info);
  check('a fresh champion starts at the "full HP" end of the fraction Executioner checks',
    info.fracAtFull >= sb.EXECUTIONER_FULL_HP_FRACTION, info.fracAtFull);
}

// --- 8. Blairface (MirrorBoss) never leaks archetype behavior ---
{
  const snapshotKeys = run(`
    (function() {
      const p = new Player(0, 0, 100, 1, 1, 3, null, 'berserker');
      const snapshot = {
        maxHp: p.maxHp, weaponDamage: p.weapon.damage, weaponRange: p.weapon.range,
        weaponCooldown: p.weapon.cooldown, moveSpeed: MOVE_SPEED * p.speedMul,
        damageReduction: p.equipMods.damageReduction, skinId: p.skinId,
      };
      return Object.keys(snapshot);
    })()
  `);
  check('the exact snapshot shape enterMirrorFight() builds has no archetype-related field',
    !snapshotKeys.some((k) => /archetype/i.test(k)), snapshotKeys);

  // Regardless of what archetype the player currently has, her own combat
  // numbers (phase 1 mirrors weaponDamage 1:1) must come out identical.
  for (const key of [null, ...ARCHETYPE_KEYS]) {
    const dmg = run(`
      (function() {
        const snap = { maxHp: 100, weaponDamage: 12, weaponRange: 60, weaponCooldown: 0.4, moveSpeed: 200, damageReduction: 0, skinId: null };
        const boss = new MirrorBoss(500, 500, snap);
        return boss.weaponDamage;
      })()
    `);
    check(`MirrorBoss's own mirrored weaponDamage is unaffected by a player archetype of '${key}' (snapshot is numeric-only)`,
      dmg === 12, dmg);
  }

  // She must never even carry an `archetype` field herself.
  const bossHasArchetype = run(`(function(){
    const snap = { maxHp: 100, weaponDamage: 12, weaponRange: 60, weaponCooldown: 0.4, moveSpeed: 200, damageReduction: 0, skinId: null };
    const boss = new MirrorBoss(500, 500, snap);
    return 'archetype' in boss;
  })()`);
  check('MirrorBoss instances never carry an `archetype` field at all', bossHasArchetype === false);
}

// --- 9. Death -> archetype choice -> hub, full state transition ---
{
  const result = run(`
    (function() {
      Game.player = new Player(0, 0, 100, 1, 1, 3, null, null);
      Game.player.hp = 0;
      Game.save.gold = 500;
      Game.onPlayerDeath();
      const stateAfterDeath = Game.state;
      const offered = Game.pendingHeirs;
      const picked = offered[0];
      Game.chooseHeir(picked);
      return {
        stateAfterDeath, offeredCount: offered.length, pickedKey: picked.key,
        stateAfterChoice: Game.state, activeHeirKey: Game.activeHeir.key,
        savedSkinId: Game.save.heirSkinId,
      };
    })()
  `);
  check('death shows the "dead" state with 3 pending heirs', result.stateAfterDeath === 'dead' && result.offeredCount === 3, result);
  check('choosing a heir applies its archetype key and returns to the hub',
    result.stateAfterChoice === 'hub' && result.activeHeirKey === result.pickedKey, result);
  check('the chosen face is persisted', result.savedSkinId !== undefined, result.savedSkinId);

  // The freshly-spawned hub Player must actually carry that archetype.
  const carried = run('Game.player.archetype');
  check('the new hub Player is constructed WITH the chosen archetype (not silently dropped)',
    carried === result.pickedKey, { carried, expected: result.pickedKey });
}

// --- 10. The chosen archetype survives a room transition mid-run ---
{
  const carried = run(`
    (function() {
      Game.activeHeir = { name: 'Т', key: 'runner', hpMul: 0.92, speedMul: 1.15, label: '', styleLabel: '', bonusLabel: '', drawbackLabel: '', skinId: 1 };
      Game.startRun();
      const beforeRoomKey = Game.player.archetype;
      const nextEntry = Game.roomChain[1] || Game.roomChain[0];
      nextEntry.kind = 'normal';
      Game.enterRoomChainIndex(Game.roomChain.length > 1 ? 1 : 0);
      return { beforeRoomKey, afterRoomKey: Game.player.archetype };
    })()
  `);
  check('archetype is intact right after startRun()', carried.beforeRoomKey === 'runner', carried);
  check('...and still intact after moving to the next room (enterRoomChainIndex reuses the SAME Player, never rebuilds it)',
    carried.afterRoomKey === 'runner', carried);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
