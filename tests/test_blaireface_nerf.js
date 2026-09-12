// Regression test for the Blairface/Mirror finale nerf: phase 1 is now a
// true 1:1 mirror (no +20% inflation), and phase 2 (Blairface) refills to
// a SMALLER bar instead of a full second one, with softened pattern damage.
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

const snapshot = { maxHp: 150, weaponDamage: 20, weaponRange: 60, weaponCooldown: 0.4, moveSpeed: 300, damageReduction: 0, skinId: null };
run(`var snap = ${JSON.stringify(snapshot)};`);
run('var mb = new MirrorBoss(0, 0, snap);');

// --- Phase 1: true mirror, no inflation ---------------------------------
check('phase-1 maxHp equals the player\'s own maxHp exactly (no +20% inflation)',
  run('mb.maxHp') === snapshot.maxHp, run('mb.maxHp'));
check('phase-1 weaponDamage equals the player\'s own weapon damage exactly',
  run('mb.weaponDamage') === snapshot.weaponDamage, run('mb.weaponDamage'));

// --- Phase transition: smaller second bar, not a full refill -----------
run('mb.hp = 0; mb.onDepleted();'); // -> beginTransformation()
check('depleting phase 1 starts the transform (does not just die)', run('mb.alive') === true && run('mb.transforming') === true);
run('mb.transformTimer = 0; mb.update(0.001, { platforms: [], width: 5000, height: 1000 }, { x: 1000, y: 0, w: 10, h: 10 });'); // ticks past the transform window -> completeTransformation()
check('phase 2 (Blairface) maxHp is a REDUCED fraction of phase-1\'s maxHp, not a full repeat',
  run('mb.maxHp') === Math.round(snapshot.maxHp * run('BLAIREFACE_PHASE2_HP_FRACTION')),
  { phase2MaxHp: run('mb.maxHp'), phase1MaxHp: snapshot.maxHp, fraction: run('BLAIREFACE_PHASE2_HP_FRACTION') });
check('phase 2 starts at a fresh full bar of that SMALLER maxHp (not partially damaged)',
  run('mb.hp') === run('mb.maxHp'));
check('total HP across both phases is clearly less than 2x the old flat-refill design (was maxHp*1.2 + maxHp*1.2)',
  (snapshot.maxHp + run('mb.maxHp')) < Math.round(snapshot.maxHp * 1.2) * 2,
  { newTotal: snapshot.maxHp + run('mb.maxHp'), oldTotal: Math.round(snapshot.maxHp * 1.2) * 2 });

// --- Phase 2 pattern damage is softened ---------------------------------
// Simulate landing a heavy-telegraph hit and confirm the multiplier used.
run(`
  // Positioned inside mb's own forward-facing attack hitbox (see
  // computeMeleeHitbox in utils.js), not just overlapping her body.
  var testPlayer = { x: mb.x + (mb.facing > 0 ? mb.w : -mb.w), y: mb.y, w: 10, h: 10, hp: 1000, maxHp: 1000, invulnTimer: 0, equipMods: { damageReduction: 0 },
    takeDamage(amount) { this.lastHit = amount; this.hp -= amount; } };
  mb.activePattern = 'telegraph';
  mb.patternSubPhase = 'strike';
  mb.hitLandedThisPattern = false;
  mb.patternSubTimer = 1;
  mb.runActivePattern(0.001, testPlayer);
`);
const expectedHeavyHit = Math.round(snapshot.weaponDamage * run('BLAIREFACE_HEAVY_DAMAGE_MUL'));
check(`heavy-telegraph hit damage matches weaponDamage * BLAIREFACE_HEAVY_DAMAGE_MUL (${run('BLAIREFACE_HEAVY_DAMAGE_MUL')}, was 1.6)`,
  run('testPlayer.lastHit') === expectedHeavyHit, { got: run('testPlayer.lastHit'), expected: expectedHeavyHit });
check('BLAIREFACE_HEAVY_DAMAGE_MUL was reduced below the old 1.6', run('BLAIREFACE_HEAVY_DAMAGE_MUL') < 1.6);

// Dash pattern: damage multiplier reduced from 1.1 to 1.0 (no bonus over mirrored weaponDamage).
run(`
  mb.activePattern = 'dash';
  mb.hitLandedThisPattern = false;
  mb.patternSubTimer = 1;
  testPlayer.lastHit = 0;
  mb.runActivePattern(0.001, testPlayer);
`);
check('dash-pattern hit damage no longer carries the old +10% bonus (BLAIREFACE_DASH_DAMAGE_MUL <= 1.0)',
  run('BLAIREFACE_DASH_DAMAGE_MUL') <= 1.0, run('BLAIREFACE_DASH_DAMAGE_MUL'));
check('dash-pattern hit damage matches weaponDamage * BLAIREFACE_DASH_DAMAGE_MUL',
  run('testPlayer.lastHit') === Math.round(snapshot.weaponDamage * run('BLAIREFACE_DASH_DAMAGE_MUL')));

// --- Sanity: she's still invulnerable during the transform, mirrors armor
run('var mb2 = new MirrorBoss(0, 0, Object.assign({}, snap, { damageReduction: 0.3 }));');
check('mirrors the player\'s own damageReduction (still a real fight for tanky builds)', run('mb2.damageReduction') === 0.3);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
