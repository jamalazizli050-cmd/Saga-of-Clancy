// Regression test for the title screen / new-game / chronicle logic added
// this pass. Pause-menu DOM wiring itself lives in main.js (event
// listeners), so it's covered by the browser visual pass instead — this
// file exercises the underlying Game methods those listeners call.
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

// --- boots into 'title', not 'hub' ---------------------------------------
check('Game.state defaults to "title" (boots to the title screen, not straight into the hub)',
  run('Game.state') === 'title');
check('a brand-new load has no save progress yet', run('Game.hasSaveProgress()') === false);

// --- continueGame() / hasSaveProgress() ----------------------------------
run('Game.addGold(50);'); // any persistSave() call writes the key
check('hasSaveProgress() becomes true once anything is persisted', run('Game.hasSaveProgress()') === true);

run('Game.enterTitle();');
check('enterTitle() sets state back to "title"', run('Game.state') === 'title');
run('Game.continueGame();');
check('continueGame() enters the hub with the existing save intact', run('Game.state') === 'hub' && run('Game.save.gold') === 50);

// --- startNewGame() wipes everything, including the localStorage key ----
run('Game.save.shards = 99; Game.save.prestige = 7; Game.save.cycleCount = 3; Game.save.ancestorNames = ["X","Y"];');
run('localStorage.setItem(SAVE_KEY, JSON.stringify(Game.save));');
const oldSkinId = run('Game.activeHeir.skinId');
run('Game.startNewGame();');
check('startNewGame() clears the localStorage save entirely', run('localStorage.getItem(SAVE_KEY)') === null);
check('startNewGame() resets gold/shards/prestige/cycleCount to 0', run('Game.save.gold') === 0 && run('Game.save.shards') === 0 && run('Game.save.prestige') === 0 && run('Game.save.cycleCount') === 0);
check('startNewGame() clears ancestorNames', run('Game.save.ancestorNames.length') === 0);
check('startNewGame() resets activeHeir to the neutral starting profile', run('Game.activeHeir.name') === 'Ты' && run('Game.activeHeir.hpMul') === 1 && run('Game.activeHeir.speedMul') === 1);
check('startNewGame() lands in the hub, ready to play', run('Game.state') === 'hub' && run('Game.player') !== null);

// --- totalDeaths tracking -------------------------------------------------
run('Game.startRun();');
const deathsBefore = run('Game.save.totalDeaths');
run('Game.player.hp = 0; Game.onPlayerDeath();');
check('onPlayerDeath() increments save.totalDeaths', run('Game.save.totalDeaths') === deathsBefore + 1);
check('totalDeaths survives being read back from a persisted save', (() => {
  const raw = run('localStorage.getItem(SAVE_KEY)');
  return JSON.parse(raw).totalDeaths === deathsBefore + 1;
})());

// pick a heir to get back to a normal state, then die again to confirm it
// keeps counting (not a one-shot flag).
run('Game.chooseHeir(Game.pendingHeirs[0]);');
run('Game.startRun();');
run('Game.player.hp = 0; Game.onPlayerDeath();');
check('totalDeaths keeps incrementing across multiple deaths', run('Game.save.totalDeaths') === deathsBefore + 2);
run('Game.chooseHeir(Game.pendingHeirs[0]);');

// --- chronicleData() -------------------------------------------------------
run('Game.save.cycleCount = 2; Game.save.ancestorNames = ["Первый", "Вторая"];');
const chronicle = run('Game.chronicleData()');
check('chronicleData() reports totalDeaths', chronicle.totalDeaths === deathsBefore + 2, chronicle);
check('chronicleData() reports cyclesCompleted from save.cycleCount', chronicle.cyclesCompleted === 2);
check('chronicleData() reports the current heir name', chronicle.currentHeirName === run('Game.activeHeir.name'));
check('chronicleData() pairs each ancestor with its 1-based cycle number, in order',
  JSON.stringify(chronicle.ancestors) === JSON.stringify([{ name: 'Первый', cycle: 1 }, { name: 'Вторая', cycle: 2 }]),
  chronicle.ancestors);

// --- icons.js: every real generated item resolves to SOME markup --------
const iconGaps = run(`
  (function() {
    const gaps = [];
    for (const noun of WEAPON_NOUNS) {
      const markup = getItemIconMarkup({ kind: 'weapon', item: { noun } });
      if (!markup) gaps.push('weapon noun: ' + noun);
    }
    for (const slotType of ['helm', 'chest']) {
      const markup = getItemIconMarkup({ kind: 'gear', item: { slotType, mods: {} } });
      if (!markup) gaps.push('armor slotType: ' + slotType);
    }
    for (const affix of ACCESSORY_AFFIXES) {
      const mods = emptyEquipMods();
      mods[affix.key] = 1;
      const markup = getItemIconMarkup({ kind: 'gear', item: { slotType: 'accessory', mods } });
      if (!markup) gaps.push('accessory affix: ' + affix.key);
    }
    return gaps;
  })()
`);
check('every weapon noun / armor slot / accessory affix has an icon (no silent gaps)', iconGaps.length === 0, iconGaps);

// A weapon generated the normal way (generateWeapon()) always carries a
// `noun` field the icon lookup can use — this is the actual bug the request
// would have hit if noun had been left off STARTING_WEAPON or the generator.
const realWeaponIcons = run(`
  (function() {
    const missing = [];
    for (let i = 0; i < 200; i++) {
      const w = generateWeapon();
      if (!w.noun || !getItemIconMarkup({ kind: 'weapon', item: w })) missing.push(w);
    }
    if (!STARTING_WEAPON.noun) missing.push(STARTING_WEAPON);
    return missing.length;
  })()
`);
check('200 freshly generated weapons + STARTING_WEAPON all carry a resolvable noun', realWeaponIcons === 0, realWeaponIcons);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
