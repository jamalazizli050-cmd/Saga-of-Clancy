// Regression test for the hit-impact pass: hit-stop freezing gameplay dt,
// screen shake decay, particle spawn/decay, and knockback overriding normal
// movement for enemies/player.
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

// --- Effects.hit()/update() basics --------------------------------------
run('Effects.hit(100, 100, 20, "#fff", false);');
check('Effects.hit() sets a nonzero hitStopTimer', run('Effects.hitStopTimer') > 0);
check('Effects.hit() sets a nonzero shakeTimer/shakeMag', run('Effects.shakeTimer > 0 && Effects.shakeMag > 0'));
check('Effects.hit() spawns particles', run('Effects.particles.length') > 0);

const stopBefore = run('Effects.hitStopTimer');
run('Effects.update(1000);'); // huge dt: should fully drain everything
check('Effects.update() with a huge dt drains hitStopTimer to 0', run('Effects.hitStopTimer') === 0, { stopBefore });
check('Effects.update() with a huge dt drains shakeTimer to 0 and clears shakeMag', run('Effects.shakeTimer === 0 && Effects.shakeMag === 0'));
check('Effects.update() with a huge dt clears all particles (expired)', run('Effects.particles.length') === 0);

// A bigger/boss hit should freeze/shake for at least as long as a small one.
run('Effects.hitStopTimer = 0; Effects.shakeTimer = 0; Effects.shakeMag = 0; Effects.particles = [];');
run('Effects.hit(0, 0, 5, "#fff", false);');
const smallStop = run('Effects.hitStopTimer');
run('Effects.hitStopTimer = 0; Effects.shakeTimer = 0; Effects.shakeMag = 0; Effects.particles = [];');
run('Effects.hit(0, 0, 40, "#fff", true);');
const bigStop = run('Effects.hitStopTimer');
check('a bigger/boss hit freezes for at least as long as a small one', bigStop >= smallStop, { smallStop, bigStop });

// --- loop()-style hit-stop freeze: gameplay dt zeroed while frozen -------
run('Game.enterHub(); Game.startRun();');
run('Effects.hitStopTimer = 0; Effects.shakeTimer = 0; Effects.particles = [];');
run(`
  function simulateFrame(rawDt) {
    Effects.update(rawDt);
    return Effects.hitStopTimer > 0 ? 0 : rawDt;
  }
`);
run('Effects.hit(0, 0, 30, "#fff");'); // enqueue a freeze
const framesFrozen = run(`
  (function(){
    let frozen = 0;
    for (let i = 0; i < 20; i++) {
      const dt = simulateFrame(1/60);
      if (dt === 0) frozen++; else break;
    }
    return frozen;
  })()
`);
check('a landed hit freezes gameplay dt for a few frames, then releases', framesFrozen >= 1 && framesFrozen <= 6, framesFrozen);

// --- Player knockback overrides WASD-driven vx -------------------------
run('Game.player.x = 500; Game.player.facing = 1;');
run('Game.player.takeDamage(20, 400);'); // hit from the left -> knocked right
check('player.takeDamage() sets a knockbackTimer', run('Game.player.knockbackTimer') > 0);
const pushDir = run('Math.sign(Game.player.knockbackVx)');
check('player knockback pushes AWAY from the hit source (hit from the left -> pushed right)', pushDir === 1, pushDir);

run(`
  Input.isDownAny = () => false; // no WASD held
  Game.player.update(0.016, Game.room, true);
`);
check('knockback vx wins over the (idle) movement block on the very next update()', run('Game.player.vx') === run('Game.player.knockbackVx'));

// Let the knockback window fully expire, then normal input should retake vx.
run('Game.player.knockbackTimer = 0;');
run(`
  Input.isDownAny = (keys) => keys.includes('KeyD');
  Game.player.update(0.016, Game.room, true);
`);
check('once knockbackTimer expires, normal input-driven movement resumes', run('Game.player.vx') > 0);

// --- Enemy knockback: takeDamage(amount, fromX) pushes away from fromX --
run(`
  var testEnemy = new GloriousGone(500 * WORLD_SCALE, 460 * WORLD_SCALE, 400 * WORLD_SCALE, 700 * WORLD_SCALE, 1);
  testEnemy.takeDamage(10, testEnemy.x - 50); // hit from the left -> knocked right
`);
check('enemy.takeDamage(amount, fromX) sets a knockbackTimer', run('testEnemy.knockbackTimer') > 0);
check('enemy knockback pushes away from fromX (hit from the left -> pushed right)', run('Math.sign(testEnemy.knockbackVx)') === 1);
check('enemy.takeDamage() with no fromX (contact/hazard damage) does not set knockback', (() => {
  run('var testEnemy2 = new GloriousGone(500 * WORLD_SCALE, 460 * WORLD_SCALE, 400 * WORLD_SCALE, 700 * WORLD_SCALE, 1);');
  run('testEnemy2.takeDamage(10);');
  return run('testEnemy2.knockbackTimer') === 0;
})());

// --- Swing profile: fast weapon -> short/narrow, slow weapon -> long/wide
const fastProfile = run('weaponSwingProfile({ cooldown: WEAPON_COOLDOWN_MIN, range: 40 })');
const slowProfile = run('weaponSwingProfile({ cooldown: WEAPON_COOLDOWN_MAX, range: 40 })');
check('a fast weapon gets a shorter swing duration than a slow one', fastProfile.duration < slowProfile.duration, { fastProfile, slowProfile });
check('a fast weapon gets a narrower swing arc than a slow one', fastProfile.arc < slowProfile.arc, { fastProfile, slowProfile });

// Attacking sets attackActiveDuration/attackSwingArc from the equipped weapon.
run('Game.player.weapons = [{ id: "t", name: "t", damage: 10, cooldown: WEAPON_COOLDOWN_MAX, range: 40, color: "#fff" }]; Game.player.weaponIndex = 0;');
run('Game.player.attackCooldownTimer = 0;');
run(`
  Input.wasPressedAny = (keys) => keys.includes('KeyJ');
  Game.player.update(0.016, Game.room, true);
`);
check('triggering an attack stores a nonzero attackActiveDuration/attackSwingArc', run('Game.player.attackActiveDuration') > 0 && run('Game.player.attackSwingArc') > 0);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
