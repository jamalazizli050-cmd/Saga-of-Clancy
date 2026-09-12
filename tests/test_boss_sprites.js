const { loadGame } = require('./test_env');
const vm = require('vm');
const ROOT = require('path').resolve(__dirname, '..'); // repo root, wherever it was cloned

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log(`OK   ${label}`); }
  else { failures++; console.log(`FAIL ${label}  ${detail || ''}`); }
}

function fakeCtx(sandbox) {
  vm.runInContext(`
    globalThis.__calls = [];
    globalThis.ctx = {
      drawImage: (img, x, y, w, h) => { globalThis.__calls.push({ kind: 'drawImage', img, x, y, w, h }); },
      save() {}, restore() {},
      translate() {}, rotate() {}, scale() {},
      set globalAlpha(v) { globalThis.__lastAlpha = v; }, get globalAlpha() { return globalThis.__lastAlpha; },
      set globalCompositeOperation(v) { globalThis.__lastComposite = v; },
      set fillStyle(v) { globalThis.__lastFillStyle = v; }, get fillStyle() { return globalThis.__lastFillStyle; },
      set strokeStyle(v) {}, set lineWidth(v) {},
      beginPath(){}, arc(){}, stroke(){},
      fillRect(x, y, w, h) { globalThis.__calls.push({ kind: 'fillRect', x, y, w, h, fillStyle: globalThis.__lastFillStyle, alpha: globalThis.__lastAlpha, composite: globalThis.__lastComposite }); },
    };
  `, sandbox);
}

// --- BossBase.drawBody: sprite + facing + tint ---
{
  const sb = loadGame(ROOT);
  const { Game } = sb;
  const ctx = sb.__sandbox;
  fakeCtx(ctx);
  vm.runInContext(`
    TileImages.boss_bishop_common = { __fake: 'base' };
    TileImages.boss_bishop_common_mirrored = { __fake: 'mirrored' };
  `, ctx);

  // Base art faces LEFT (same convention fixed for the player after the
  // user reported it looked backwards in-game) — facing=1 (right) needs
  // the _mirrored file.
  // A tinted sprite is composed in the shared offscreen buffer (see
  // drawSpriteTinted in spriteAnim.js — the hit-flash fix), so the sprite
  // drawImage and the tint fillRect land in __offscreenCalls; the main
  // canvas only ever receives the finished blit. Both are checked.
  const offscreen = () => vm.runInContext('__offscreenCalls', ctx);
  const resetCalls = () => vm.runInContext('__calls.length = 0; __offscreenCalls.length = 0;', ctx);

  const boss = vm.runInContext(`new KeonsBoss(100, 200, { name: 'Кеонс' })`, ctx);
  boss.facing = 1;
  resetCalls();
  vm.runInContext(`boss.drawBody(ctx, 0, '#5a4a5e');`, Object.assign(ctx, { boss }));
  let calls = vm.runInContext('__calls', ctx);
  let buf = offscreen();
  check('drawBody (facing=1): draws the _mirrored sprite (base art faces left)',
    buf.some((c) => c.kind === 'drawImage' && c.img.__fake === 'mirrored'), buf);
  // Body art is deliberately drawn BIGGER than the hitbox (ENTITY_VISUAL_SCALE,
  // see utils.js) — the hitbox itself (boss.w/h) is untouched. Measured on the
  // main canvas's blit, which is what actually lands in the world.
  const bossVisualScale = vm.runInContext('ENTITY_VISUAL_SCALE', ctx);
  check('drawBody: sprite drawn at boss w/h scaled by ENTITY_VISUAL_SCALE',
    Math.abs(calls.find((c) => c.kind === 'drawImage').w - boss.w * bossVisualScale) < 0.01, calls);

  // THE hit-flash fix: the tint must be composed against the sprite alone
  // (inside the buffer), never against the main canvas — compositing over
  // the main canvas is what used to paint a solid rectangle over the whole
  // bounding box, because source-atop clipped to the background instead.
  const tintCall = buf.find((c) => c.kind === 'fillRect');
  check('drawBody: tint is composed in the offscreen buffer, NOT on the main canvas',
    !!tintCall && !calls.some((c) => c.kind === 'fillRect'), { tintCall, mainFills: calls.filter((c) => c.kind === 'fillRect') });
  check('drawBody: tint fillRect uses source-atop composite (clips to the sprite\'s alpha)',
    tintCall && tintCall.composite === 'source-atop', tintCall);
  check('drawBody: the buffer holds the sprite BEFORE the tint (so there is something to clip to)',
    buf.findIndex((c) => c.kind === 'drawImage') < buf.findIndex((c) => c.kind === 'fillRect'), buf.map((c) => c.kind));
  check('drawBody: buffer is cleared before reuse (no leftovers from the previous entity)',
    buf[0] && buf[0].kind === 'clearRect', buf.map((c) => c.kind));
  check('drawBody: tint uses the passed-in state color', tintCall && tintCall.fillStyle === '#5a4a5e', tintCall);
  check('drawBody: tint alpha is strong (>=0.5), not a barely-visible hint', tintCall && tintCall.alpha >= 0.5, tintCall);
  check('drawBody: the main canvas receives exactly the composed result (one blit)',
    calls.filter((c) => c.kind === 'drawImage').length === 1, calls);

  boss.facing = -1;
  resetCalls();
  vm.runInContext(`boss.drawBody(ctx, 0, '#e8c0a0');`, ctx);
  check('drawBody (facing=-1): draws the base (non-mirrored) sprite',
    offscreen().some((c) => c.kind === 'drawImage' && c.img.__fake === 'base'), offscreen());

  // Fallback: sprite not registered -> old rectangle+eyes path, no throw.
  vm.runInContext(`delete TileImages.boss_bishop_common; delete TileImages.boss_bishop_common_mirrored;`, ctx);
  boss.facing = 1;
  vm.runInContext(`__calls.length = 0; boss.drawBody(ctx, 0, '#5a4a5e');`, ctx);
  calls = vm.runInContext('__calls', ctx);
  check('drawBody: missing sprite falls back to fillRect rectangle (no drawImage, no throw)',
    calls.some((c) => c.kind === 'fillRect') && !calls.some((c) => c.kind === 'drawImage'), calls);
}

// --- Facing now actually tracks the player for Keons/Sakarver/Lisden ---
{
  const sb = loadGame(ROOT);
  const ctx = sb.__sandbox;
  const boss = vm.runInContext(`new KeonsBoss(500, 200, { name: 'Кеонс' })`, ctx);
  const player = { x: 100, y: 200, w: 20, h: 20 }; // to the LEFT of the boss
  const room = { width: 2000, platforms: [{ x: 0, y: 700, w: 2000, h: 40 }] };
  vm.runInContext('boss.update(1/60, room, player)', Object.assign(ctx, { boss, player, room }));
  check('KeonsBoss now updates facing toward the player (was previously stuck at 1 forever)',
    boss.facing === -1, boss.facing);

  const sakarver = vm.runInContext(`new SakarverBoss(500, 200, { name: 'Сакарвер' })`, ctx);
  vm.runInContext('sak.update(1/60, room, player)', Object.assign(ctx, { sak: sakarver }));
  check('SakarverBoss now updates facing toward the player', sakarver.facing === -1, sakarver.facing);

  const lisden = vm.runInContext(`new LisdenBoss(500, 200, { name: 'Лисден' })`, ctx);
  vm.runInContext('lis.update(1/60, room, player)', Object.assign(ctx, { lis: lisden }));
  check('LisdenBoss now updates facing toward the player', lisden.facing === -1, lisden.facing);
}

// --- MirrorBoss: skinId flows from snapshot, drives sprite selection ---
{
  const sb = loadGame(ROOT);
  const ctx = sb.__sandbox;
  fakeCtx(ctx);
  vm.runInContext(`
    TileImages.heir_05 = { __fake: 'heir5-base' };
    TileImages.heir_05_mirrored = { __fake: 'heir5-mirrored' };
  `, ctx);

  const snapshot = { maxHp: 100, weaponDamage: 10, weaponRange: 40, weaponCooldown: 0.3, moveSpeed: 200, damageReduction: 0, skinId: 5 };
  const mirror = vm.runInContext('new MirrorBoss(300, 200, snapshot)', Object.assign(ctx, { snapshot }));
  check('MirrorBoss stores skinId from the snapshot', mirror.skinId === 5, mirror.skinId);

  // Same left-facing-base convention as Player.draw().
  mirror.facing = 1;
  mirror.hitFlash = 0; // normal phase-1 state
  vm.runInContext('__calls.length = 0; mirror.draw(ctx, 0);', Object.assign(ctx, { mirror }));
  let calls = vm.runInContext('__calls', ctx);
  const drawCall = calls.find((c) => c.kind === 'drawImage');
  check('MirrorBoss phase 1 normal (facing right): draws the mirrored heir file',
    drawCall && drawCall.img.__fake === 'heir5-mirrored', calls);
  check('MirrorBoss phase 1 normal (no hit-flash): NO tint applied — it should look like just the player',
    !calls.some((c) => c.kind === 'fillRect'), calls);

  mirror.hitFlash = 0.1;
  vm.runInContext('__calls.length = 0; __offscreenCalls.length = 0; mirror.draw(ctx, 0);', ctx);
  let mirrorBuf = vm.runInContext('__offscreenCalls', ctx);
  check('MirrorBoss phase 1 hit-flash: tint IS applied over the skin (in the buffer)',
    mirrorBuf.some((c) => c.kind === 'fillRect' && c.fillStyle === '#e8c0a0' && c.composite === 'source-atop'), mirrorBuf);

  mirror.facing = -1;
  mirror.hitFlash = 0;
  vm.runInContext('__calls.length = 0; mirror.draw(ctx, 0);', ctx);
  calls = vm.runInContext('__calls', ctx);
  check('MirrorBoss facing left: draws the base (non-mirrored) heir file',
    calls.some((c) => c.kind === 'drawImage' && c.img.__fake === 'heir5-base'), calls);

  // Transform into Blairface -> phase 2 always carries a tint (her palette-
  // swapped identity), even with no hit-flash / no telegraph.
  mirror.phase = 2;
  mirror.transforming = false;
  mirror.hitFlash = 0;
  mirror.activePattern = null;
  vm.runInContext('__calls.length = 0; __offscreenCalls.length = 0; mirror.draw(ctx, 0);', ctx);
  mirrorBuf = vm.runInContext('__offscreenCalls', ctx);
  check('Blairface (phase 2) normal state: still draws the SAME heir skin underneath',
    mirrorBuf.some((c) => c.kind === 'drawImage' && (c.img.__fake === 'heir5-mirrored' || c.img.__fake === 'heir5-base')), mirrorBuf);
  check('Blairface (phase 2) normal state: yellow tint IS applied (her transformed identity, unlike phase 1)',
    mirrorBuf.some((c) => c.kind === 'fillRect' && c.fillStyle === '#f0d43a' && c.composite === 'source-atop'), mirrorBuf);

  // Fallback: no skinId at all (skinId-less "Ты" reaching the finale).
  const snapshotNoSkin = { maxHp: 100, weaponDamage: 10, weaponRange: 40, weaponCooldown: 0.3, moveSpeed: 200, damageReduction: 0, skinId: null };
  const mirror2 = vm.runInContext('new MirrorBoss(300, 200, snapshotNoSkin)', Object.assign(ctx, { snapshotNoSkin }));
  vm.runInContext('__calls.length = 0; mirror2.draw(ctx, 0);', Object.assign(ctx, { mirror2 }));
  calls = vm.runInContext('__calls', ctx);
  check('MirrorBoss with no skinId: falls back to the old procedural rectangle, no crash',
    calls.some((c) => c.kind === 'fillRect') && !calls.some((c) => c.kind === 'drawImage'), calls);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
