const { loadGame } = require('./test_env');
const ROOT = require('path').resolve(__dirname, '..'); // repo root, wherever it was cloned

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log(`OK   ${label}`); }
  else { failures++; console.log(`FAIL ${label}  ${detail || ''}`); }
}

// --- rollHeirs: every candidate gets an independent random skinId 1-12 ---
{
  const sb = loadGame(ROOT);
  const { Game } = sb;

  const seenSkinIds = new Set();
  let allInRange = true;
  for (let trial = 0; trial < 200; trial++) {
    const heirs = sb.__sandbox ? require('vm').runInContext('rollHeirs()', sb.__sandbox) : null;
    for (const h of heirs) {
      seenSkinIds.add(h.skinId);
      if (!(h.skinId >= 1 && h.skinId <= 12) || !Number.isInteger(h.skinId)) allInRange = false;
    }
  }
  check('every rolled skinId is an integer in [1,12]', allInRange);
  check('across many rolls, skinIds actually vary (not stuck on one value)', seenSkinIds.size > 5, [...seenSkinIds].sort());

  // Same-death-screen duplicates must be allowed (not deduped) — roll until
  // we see one, to prove there's no hidden uniqueness constraint. With 3
  // candidates * 12 skins, a collision happens fairly often; try enough
  // times that a false failure here would be extraordinarily unlikely.
  let sawDuplicateOnOneScreen = false;
  for (let trial = 0; trial < 500 && !sawDuplicateOnOneScreen; trial++) {
    const heirs = require('vm').runInContext('rollHeirs()', sb.__sandbox);
    const ids = heirs.map((h) => h.skinId);
    if (new Set(ids).size < ids.length) sawDuplicateOnOneScreen = true;
  }
  check('duplicate skinIds across the 3 cards on one death screen are allowed', sawDuplicateOnOneScreen);
}

// --- Player: skinId flows from activeHeir into the constructed Player ---
{
  const sb = loadGame(ROOT);
  const { Game } = sb;
  const heir = { name: 'Test', hpMul: 1, speedMul: 1, label: 'test', skinId: 7 };
  Game.activeHeir = heir;
  Game.enterHub();
  check('enterHub: player.skinId matches the chosen heir\'s skinId', Game.player.skinId === 7, Game.player.skinId);

  Game.chooseHeir({ name: 'Test2', hpMul: 1, speedMul: 1, label: 'test2', skinId: 3 });
  check('chooseHeir -> enterHub: new player picks up the new heir\'s skinId', Game.player.skinId === 3, Game.player.skinId);

  // The default "Ты" profile (very first character, never rolled) has no
  // skinId at all -- Player must accept that and store null/undefined
  // rather than throwing, since Player.draw()'s fallback depends on this.
  Game.activeHeir = { name: 'Ты', hpMul: 1, speedMul: 1, label: 'начальный профиль' };
  Game.enterHub();
  check('default (pre-heir) profile with no skinId -> player.skinId is falsy (fallback rectangle path)', !Game.player.skinId, Game.player.skinId);
}

// --- Player.draw(): picks the right file per facing, falls back cleanly ---
{
  const sb = loadGame(ROOT);
  const { Player } = sb;

  // Stub TileImages with fake "loaded" entries so we can assert on which
  // key draw() reaches for, without needing real image decoding.
  const vm = require('vm');
  vm.runInContext(`
    TileImages.heir_07 = { __fake: 'base-7' };
    TileImages.heir_07_mirrored = { __fake: 'mirrored-7' };
  `, sb.__sandbox);

  const calls = [];
  vm.runInContext(`
    globalThis.ctx = {
      drawImage: (img, x, y, w, h) => { globalThis.__calls.push({ kind: 'drawImage', img, x, y, w, h }); },
      save() {}, restore() {},
      translate() {}, rotate() {}, scale() {},
      set globalAlpha(v) {}, get globalAlpha() { return 1; },
      set globalCompositeOperation(v) {},
      set fillStyle(v) {},
      fillRect(x, y, w, h) { globalThis.__calls.push({ kind: 'fillRect', x, y, w, h }); },
    };
    globalThis.__calls = [];
  `, sb.__sandbox);

  // Base art faces LEFT (confirmed against the actual files after the user
  // reported the in-game character looked backwards) — facing=1 (right)
  // needs the _mirrored file, facing=-1 (left) needs the base file.
  const p = new Player(100, 200, 100, 1, 1, 3, 7);
  p.facing = 1;
  vm.runInContext('player.draw(ctx, 0)', Object.assign(sb.__sandbox, { player: p }));
  let recorded = vm.runInContext('__calls', sb.__sandbox);
  const drawImageCalls = recorded.filter((c) => c.kind === 'drawImage');
  check('facing right (facing=1): draws the _mirrored file (base art faces left)',
    drawImageCalls.length === 1 && drawImageCalls[0].img.__fake === 'mirrored-7',
    drawImageCalls);
  // Body art is deliberately drawn BIGGER than the hitbox now
  // (ENTITY_VISUAL_SCALE, see utils.js) — combat used to read as small
  // figures against mostly-empty rooms; the hitbox itself (p.w/p.h,
  // collision/aabbIntersect) is completely untouched by this.
  const visualScale = vm.runInContext('ENTITY_VISUAL_SCALE', sb.__sandbox);
  check('sprite is drawn at the hitbox size scaled by ENTITY_VISUAL_SCALE (visual-only oversize)',
    Math.abs(drawImageCalls[0].w - p.w * visualScale) < 0.01 && Math.abs(drawImageCalls[0].h - p.h * visualScale) < 0.01,
    { call: drawImageCalls[0], expectedW: p.w * visualScale, expectedH: p.h * visualScale });

  vm.runInContext('__calls.length = 0', sb.__sandbox);
  p.facing = -1;
  vm.runInContext('player.draw(ctx, 0)', sb.__sandbox);
  recorded = vm.runInContext('__calls', sb.__sandbox);
  const drawImageCalls2 = recorded.filter((c) => c.kind === 'drawImage');
  check('facing left (facing=-1): draws the base (non-mirrored) file',
    drawImageCalls2.length === 1 && drawImageCalls2[0].img.__fake === 'base-7',
    drawImageCalls2);

  // Fallback: skinId set, but image NOT in TileImages (simulates an old
  // save / a dropped asset) -> must degrade to the rectangle path, not throw.
  const p2 = new Player(100, 200, 100, 1, 1, 3, 99); // skin 99 was never preloaded
  vm.runInContext('__calls.length = 0', sb.__sandbox);
  vm.runInContext('player2.draw(ctx, 0)', Object.assign(sb.__sandbox, { player2: p2 }));
  recorded = vm.runInContext('__calls', sb.__sandbox);
  check('missing/unregistered skin image -> falls back to fillRect, does not throw',
    recorded.some((c) => c.kind === 'fillRect') && !recorded.some((c) => c.kind === 'drawImage'),
    recorded);

  // No skinId at all (the pre-heir default character).
  const p3 = new Player(100, 200, 100, 1, 1, 3, null);
  vm.runInContext('__calls.length = 0', sb.__sandbox);
  vm.runInContext('player3.draw(ctx, 0)', Object.assign(sb.__sandbox, { player3: p3 }));
  recorded = vm.runInContext('__calls', sb.__sandbox);
  check('skinId null -> falls back to fillRect (never crashes on a save without the field)',
    recorded.some((c) => c.kind === 'fillRect') && !recorded.some((c) => c.kind === 'drawImage'),
    recorded);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
