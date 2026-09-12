const { loadGame } = require('./test_env');
const vm = require('vm');
const ROOT = require('path').resolve(__dirname, '..'); // repo root, wherever it was cloned

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log(`OK   ${label}`); }
  else { failures++; console.log(`FAIL ${label}  ${detail || ''}`); }
}

function makeRecordingCtx(ctx) {
  vm.runInContext(`
    globalThis.__transformLog = [];
    globalThis.ctx = {
      save() { globalThis.__transformLog.push({ op: 'save' }); },
      restore() { globalThis.__transformLog.push({ op: 'restore' }); },
      translate(x, y) { globalThis.__transformLog.push({ op: 'translate', x, y }); },
      rotate(a) { globalThis.__transformLog.push({ op: 'rotate', a }); },
      scale(x, y) { globalThis.__transformLog.push({ op: 'scale', x, y }); },
      drawImage() {}, fillRect() {},
      set globalAlpha(v) {}, get globalAlpha() { return 1; },
      set globalCompositeOperation(v) {}, set fillStyle(v) {},
    };
  `, ctx);
}

function getLog(ctx) {
  return vm.runInContext('__transformLog', ctx);
}

// --- Idle bob: sine wave, correct amplitude, active only when not moving/grounded ---
{
  const sb = loadGame(ROOT);
  const ctx = sb.__sandbox;
  makeRecordingCtx(ctx);
  const anim = vm.runInContext('new SpriteAnimator()', ctx);

  // Advance idlePhase to a known point (pi/2 -> sin=1, max amplitude) without
  // ever moving, by ticking small dt steps.
  const dt = 1 / 60;
  let elapsed = 0;
  const targetPhase = Math.PI / 2;
  const IDLE_BOB_RATE = sb.IDLE_BOB_RATE;
  const IDLE_BOB_AMPLITUDE = sb.IDLE_BOB_AMPLITUDE;
  const steps = Math.round((targetPhase / IDLE_BOB_RATE) / dt);
  for (let i = 0; i < steps; i++) anim.update(dt, false, true);

  vm.runInContext('__transformLog.length = 0', ctx);
  vm.runInContext('anim.draw(ctx, 0, 0, 40, 60, { moving: false, grounded: true }, () => {})', Object.assign(ctx, { anim }));
  const log = getLog(ctx);
  const translateCall = log.find((e) => e.op === 'translate' && e.y !== undefined && Math.abs(e.y - 30) > 0.01); // cy=30, offset added
  check('idle bob: at phase~pi/2 the y-offset is close to full IDLE_BOB_AMPLITUDE',
    translateCall && Math.abs((translateCall.y - 30) - IDLE_BOB_AMPLITUDE) < 0.5,
    { translateCall, expected: IDLE_BOB_AMPLITUDE });
  check('idle bob amplitude is in the requested 1-2px (unscaled) range',
    IDLE_BOB_AMPLITUDE / WORLD_SCALE_VAL(sb) >= 1 && IDLE_BOB_AMPLITUDE / WORLD_SCALE_VAL(sb) <= 2,
    IDLE_BOB_AMPLITUDE);
}

function WORLD_SCALE_VAL(sb) {
  return vm.runInContext('WORLD_SCALE', sb.__sandbox);
}

// --- Walk bounce + tilt: active only when moving AND grounded ---
{
  const sb = loadGame(ROOT);
  const ctx = sb.__sandbox;
  makeRecordingCtx(ctx);
  const anim = vm.runInContext('new SpriteAnimator()', ctx);
  const WALK_TILT_MAX = sb.WALK_TILT_MAX;

  anim.update(1 / 60, true, true); // one frame of walking
  vm.runInContext('__transformLog.length = 0', ctx);
  vm.runInContext('anim.draw(ctx, 0, 0, 40, 60, { moving: true, grounded: true, facing: 1 }, () => {})', Object.assign(ctx, { anim }));
  let log = getLog(ctx);
  const rotateCall = log.find((e) => e.op === 'rotate');
  check('walk (facing=1): tilts toward movement direction (positive rotation)',
    rotateCall && rotateCall.a > 0, rotateCall);
  check('walk tilt magnitude matches WALK_TILT_MAX (~4 degrees)',
    rotateCall && Math.abs(Math.abs(rotateCall.a) - WALK_TILT_MAX) < 1e-6, { rotateCall, WALK_TILT_MAX });
  check('tilt is within the requested 3-5 degree range',
    (WALK_TILT_MAX * 180 / Math.PI) >= 3 && (WALK_TILT_MAX * 180 / Math.PI) <= 5, WALK_TILT_MAX * 180 / Math.PI);

  vm.runInContext('__transformLog.length = 0', ctx);
  vm.runInContext('anim.draw(ctx, 0, 0, 40, 60, { moving: true, grounded: true, facing: -1 }, () => {})', ctx);
  log = getLog(ctx);
  const rotateCall2 = log.find((e) => e.op === 'rotate');
  check('walk (facing=-1): tilts the OTHER way (negative rotation)', rotateCall2 && rotateCall2.a < 0, rotateCall2);

  // Not moving -> no tilt, only idle bob.
  vm.runInContext('__transformLog.length = 0', ctx);
  vm.runInContext('anim.draw(ctx, 0, 0, 40, 60, { moving: false, grounded: true, facing: 1 }, () => {})', ctx);
  log = getLog(ctx);
  const rotateCall3 = log.find((e) => e.op === 'rotate');
  check('standing still: no tilt applied (rotation resets to 0)', rotateCall3 && rotateCall3.a === 0, rotateCall3);
}

// --- Airborne stretch + landing squash decay ---
{
  const sb = loadGame(ROOT);
  const ctx = sb.__sandbox;
  makeRecordingCtx(ctx);
  const anim = vm.runInContext('new SpriteAnimator()', ctx);
  const AIR_STRETCH_X = sb.AIR_STRETCH_X, AIR_STRETCH_Y = sb.AIR_STRETCH_Y;
  const LAND_SQUASH_X = sb.LAND_SQUASH_X, LAND_SQUASH_Y = sb.LAND_SQUASH_Y;

  // Leave the ground.
  anim.update(1 / 60, false, false);
  vm.runInContext('__transformLog.length = 0', ctx);
  vm.runInContext('anim.draw(ctx, 0, 0, 40, 60, { moving: false, grounded: false }, () => {})', Object.assign(ctx, { anim }));
  let log = getLog(ctx);
  let scaleCall = log.find((e) => e.op === 'scale');
  check('airborne: scale matches the requested (0.9, 1.1) stretch',
    scaleCall && Math.abs(scaleCall.x - AIR_STRETCH_X) < 1e-9 && Math.abs(scaleCall.y - AIR_STRETCH_Y) < 1e-9,
    scaleCall);

  // Land -> squash should be at its peak right away.
  anim.update(1 / 60, false, true);
  vm.runInContext('__transformLog.length = 0', ctx);
  vm.runInContext('anim.draw(ctx, 0, 0, 40, 60, { moving: false, grounded: true }, () => {})', ctx);
  log = getLog(ctx);
  scaleCall = log.find((e) => e.op === 'scale');
  check('landing instant: squash matches the requested (1.15, 0.85)',
    scaleCall && Math.abs(scaleCall.x - LAND_SQUASH_X) < 1e-9 && Math.abs(scaleCall.y - LAND_SQUASH_Y) < 1e-9,
    scaleCall);

  // Squash should decay back to (1,1) within the requested 100-150ms window.
  const LAND_SQUASH_DURATION = sb.LAND_SQUASH_DURATION;
  check('squash decay duration is within the requested 100-150ms',
    LAND_SQUASH_DURATION >= 0.09 && LAND_SQUASH_DURATION <= 0.16, LAND_SQUASH_DURATION);

  for (let i = 0; i < 60; i++) anim.update(1 / 60, false, true); // 1s, well past decay
  vm.runInContext('__transformLog.length = 0', ctx);
  vm.runInContext('anim.draw(ctx, 0, 0, 40, 60, { moving: false, grounded: true }, () => {})', ctx);
  log = getLog(ctx);
  scaleCall = log.find((e) => e.op === 'scale');
  check('long after landing: squash fully decayed back to normal scale',
    scaleCall && Math.abs(scaleCall.x - 1) < 1e-9 && Math.abs(scaleCall.y - 1) < 1e-9, scaleCall);
}

// --- Telegraph shake: only when explicitly requested, small random jitter ---
{
  const sb = loadGame(ROOT);
  const ctx = sb.__sandbox;
  makeRecordingCtx(ctx);
  const anim = vm.runInContext('new SpriteAnimator()', ctx);
  const TELEGRAPH_SHAKE_AMPLITUDE = sb.TELEGRAPH_SHAKE_AMPLITUDE;

  vm.runInContext('__transformLog.length = 0', ctx);
  vm.runInContext('anim.draw(ctx, 100, 100, 40, 60, { moving: false, grounded: true, shaking: false }, () => {})', Object.assign(ctx, { anim }));
  let log = getLog(ctx);
  const firstTranslate = log.find((e) => e.op === 'translate');
  check('no shake requested: translate lands exactly on the sprite center (100+20=120)',
    Math.abs(firstTranslate.x - 120) < 1e-9, firstTranslate);

  let sawJitter = false;
  for (let i = 0; i < 20; i++) {
    vm.runInContext('__transformLog.length = 0', ctx);
    vm.runInContext('anim.draw(ctx, 100, 100, 40, 60, { moving: false, grounded: true, shaking: true }, () => {})', ctx);
    log = getLog(ctx);
    const t = log.find((e) => e.op === 'translate');
    if (Math.abs(t.x - 120) > 0.01) sawJitter = true;
    check(`shaking sample ${i}: jitter stays within TELEGRAPH_SHAKE_AMPLITUDE bound`,
      Math.abs(t.x - 120) <= TELEGRAPH_SHAKE_AMPLITUDE + 1e-9, { x: t.x, bound: TELEGRAPH_SHAKE_AMPLITUDE });
  }
  check('shaking actually varies frame to frame (not a fixed offset)', sawJitter);
}

// --- Integration: GloriousGone enemy has an animator and updates it ---
{
  const sb = loadGame(ROOT);
  const ctx = sb.__sandbox;
  const enemy = vm.runInContext(`new GloriousGone(100*WORLD_SCALE, 200*WORLD_SCALE, 0, 500*WORLD_SCALE, 1)`, ctx);
  check('GloriousGone has its own SpriteAnimator instance', enemy.anim && typeof enemy.anim.update === 'function');

  const room = { width: 2000, platforms: [{ x: 0, y: 260 * (sb.WORLD_SCALE || 1.5), w: 2000, h: 40 }] };
  const player = { x: 400 * 1.5, y: 200 };
  const beforePhase = enemy.anim.walkPhase;
  vm.runInContext('enemy.update(1/60, room, player)', Object.assign(ctx, { enemy, room, player }));
  check('enemy walkPhase advances after update() while chasing (moving+grounded)',
    enemy.anim.walkPhase !== beforePhase || !enemy.grounded, { before: beforePhase, after: enemy.anim.walkPhase, grounded: enemy.grounded });
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
