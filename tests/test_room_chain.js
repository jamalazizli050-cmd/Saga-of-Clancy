const { loadGame } = require('./test_env');
const vm = require('vm');
const ROOT = require('path').resolve(__dirname, '..'); // repo root, wherever it was cloned

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log(`OK   ${label}`); }
  else { failures++; console.log(`FAIL ${label}  ${detail || ''}`); }
}

// --- generateRoomChain(): segment lengths, boss placement, biome mix ---
{
  const sb = loadGame(ROOT);
  const ctx = sb.__sandbox;

  const chainLengths = [];
  const allBiomes = new Set();
  let sawInvalidSegmentLength = false;
  let sawWrongBossOrder = false;
  let sawImmediateTemplateRepeat = false;

  for (let trial = 0; trial < 300; trial++) {
    const chain = vm.runInContext('generateRoomChain()', ctx);
    chainLengths.push(chain.length);

    // Recover segment boundaries from triggersBoss markers.
    const bossPositions = [];
    chain.forEach((entry, i) => {
      allBiomes.add(entry.biome);
      if (entry.triggersBoss) bossPositions.push({ i, key: entry.triggersBoss });
    });

    check_boss_order: {
      // Keons is the registry's 5th and last Bishop, folded into the same
      // MID_CHAIN_BOSS_ORDER/segment-gating as the other four (see the
      // "Keons unification" fix) — he used to be entered via a separate
      // enterBossRoom() with no room segment in front of him at all.
      const expectedOrder = ['lisden', 'sakarver', 'reysdro', 'vetomo', 'keons'];
      if (bossPositions.length !== 5) { sawWrongBossOrder = true; break check_boss_order; }
      for (let k = 0; k < 5; k++) if (bossPositions[k].key !== expectedOrder[k]) sawWrongBossOrder = true;
    }

    let segStart = 0;
    for (const bp of bossPositions) {
      const segLen = bp.i - segStart + 1;
      if (segLen < 3 || segLen > 5) sawInvalidSegmentLength = true;
      segStart = bp.i + 1;
    }

    for (let i = 1; i < chain.length; i++) {
      if (chain[i].template === chain[i - 1].template) sawImmediateTemplateRepeat = true;
    }
  }

  check('every generated chain has exactly 5 triggersBoss markers in lisden/sakarver/reysdro/vetomo/keons order',
    !sawWrongBossOrder);
  check('every segment (gap between bosses, and before the first) is 3-5 rooms',
    !sawInvalidSegmentLength);
  check('total chain length varies across runs (300 trials produced more than one distinct total)',
    new Set(chainLengths).size > 1, [...new Set(chainLengths)].sort((a, b) => a - b));
  check('total chain length is always within [15,25] (5 segments x 3-5 rooms each)',
    chainLengths.every((n) => n >= 15 && n <= 25), { min: Math.min(...chainLengths), max: Math.max(...chainLengths) });
  check('both biomes (trench and dema) actually get picked across many rolls',
    allBiomes.has('trench') && allBiomes.has('dema'), [...allBiomes]);
  check('the same room template is never picked twice in a row', !sawImmediateTemplateRepeat);
}

// --- startRun() actually uses the generated chain end-to-end ---
{
  const sb = loadGame(ROOT);
  const { Game } = sb;
  Game.startRun();
  check('startRun(): Game.roomChain is populated', Game.roomChain.length >= 15 && Game.roomChain.length <= 25, Game.roomChain.length);
  check('startRun(): Game.room carries the first entry\'s biome tag',
    Game.room.biome === Game.roomChain[0].biome, { roomBiome: Game.room.biome, chainBiome: Game.roomChain[0].biome });
  check('startRun(): roomIndex starts at 0', Game.roomIndex === 0);
  check('startRun(): enemies were spawned for room 0', Game.enemies.length === Game.roomChain[0].template.enemies.length);

  // Walk the entire chain via advanceRoom(), simulating "room cleared", and
  // confirm we hit all 5 Bishops (Keons included — see the "Keons
  // unification" fix: he no longer has his own separate "final boss"
  // state/room, he's just the 5th one in the same MID_CHAIN_BOSS_ORDER),
  // then eventually the mirror finale once the chain is exhausted.
  let midBossCount = 0;
  let sawFinale = false;
  for (let guard = 0; guard < 40 && !sawFinale; guard++) {
    if (Game.state === 'run') {
      Game.enemies.forEach((e) => { e.alive = false; });
      Game.advanceRoom();
    } else if (Game.state === 'boss') {
      if (Game.isFinaleFight) {
        sawFinale = true;
      } else {
        midBossCount++;
        // Simulate defeating the mid-boss and resuming, same as onBossDefeated()/continueAfterMidBoss() would.
        Game.defeatedBishopsThisRun.add(Game.boss.bishopKey);
        Game.markBishopDefeatedThisCycle(Game.boss.bishopKey);
        Game.pauseRunInHub();
        Game.continueAfterMidBoss();
      }
    }
  }
  check('walking the whole generated chain hits exactly 5 Bishops (Keons included)', midBossCount === 5, midBossCount);
  check('walking the whole generated chain eventually reaches the mirror finale', sawFinale);
}

// --- skinId persistence round-trips through localStorage ---
{
  const sb = loadGame(ROOT);
  const { Game } = sb;
  const heir = { name: 'PersistTest', hpMul: 1, speedMul: 1, label: 'test', skinId: 9 };
  Game.chooseHeir(heir);
  const savedRaw = vm.runInContext('localStorage.getItem(SAVE_KEY)', sb.__sandbox);
  const saved = JSON.parse(savedRaw);
  check('chooseHeir(): heirSkinId is written into the persisted save blob', saved.heirSkinId === 9, saved.heirSkinId);

  // Simulate a fresh page load in a NEW sandbox that shares the same
  // (fake) localStorage backing store — loadGame() gives each sandbox its
  // own store, so instead just re-run loadSave() logic against the same
  // raw JSON to prove the read side works.
  const sb2 = loadGame(ROOT);
  vm.runInContext(`localStorage.setItem(SAVE_KEY, ${JSON.stringify(savedRaw)})`, sb2.__sandbox);
  const reloaded = vm.runInContext('loadSave()', sb2.__sandbox);
  check('loadSave(): heirSkinId round-trips back out correctly', reloaded.heirSkinId === 9, reloaded.heirSkinId);

  // Simulate an actual page reload (the real bug report): pre-seed
  // localStorage in a THIRD sandbox before game.js ever runs, since
  // `initialSave`/`Game.save` are only computed once at script-load time —
  // this is what the browser really does on refresh, not a snapshot taken
  // mid-session. loadGame() runs every file in one pass, so we go through
  // the raw file list ourselves to inject the seeded save between
  // utils.js (defines localStorage-independent helpers) and game.js.
  const fs = require('fs');
  const path = require('path');
  const vmMod = require('vm');
  const freshSandbox = {};
  freshSandbox.console = console;
  freshSandbox.Math = Math;
  const backingStore = {};
  freshSandbox.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(backingStore, k) ? backingStore[k] : null),
    setItem: (k, v) => { backingStore[k] = String(v); },
  };
  backingStore['dema_roguelike_save_v1'] = savedRaw; // seeded BEFORE any file runs, like a real reload
  freshSandbox.document = { getElementById: () => ({ classList: { toggle(){}, add(){}, remove(){}, contains(){return false;} }, style: {}, children: [], addEventListener(){}, appendChild(c){return c;}, set innerHTML(v){}, get innerHTML(){return '';} }), createElement: () => freshSandbox.document.getElementById(), createElementNS: () => Object.assign(freshSandbox.document.getElementById(), { setAttribute(){} }), addEventListener(){} };
  freshSandbox.window = freshSandbox;
  freshSandbox.addEventListener = () => {};
  freshSandbox.removeEventListener = () => {};
  freshSandbox.requestAnimationFrame = () => 0;
  freshSandbox.Image = function () {};
  freshSandbox.globalThis = freshSandbox;
  vmMod.createContext(freshSandbox);
  for (const rel of ['js/utils.js', 'js/effects.js', 'js/spriteAnim.js', 'js/tiles.js', 'js/input.js', 'js/weapons.js', 'js/equipment.js', 'js/icons.js', 'js/world.js', 'js/player.js', 'js/enemy.js', 'js/boss.js', 'js/bishops.js', 'js/chest.js', 'js/heirs.js', 'js/hub.js', 'js/hud.js', 'js/game.js']) {
    vmMod.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), freshSandbox, { filename: rel });
  }
  const reloadedSkin = vmMod.runInContext('Game.activeHeir.skinId', freshSandbox);
  check('a real page-reload sequence (save seeded before game.js loads) restores the saved skinId as the default activeHeir\'s face',
    reloadedSkin === 9, reloadedSkin);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
