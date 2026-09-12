// Regression test for "Bishops resurrect after a normal death" — the fix
// makes Game.save.defeatedBishops persistent within a cycle (only cleared
// by onCycleVictory/NG+), instead of the old defeatedBishopsThisRun Set
// that reset every startRun() with nothing tracking prior attempts.
//
// Also covers the later "Keons unification" fix: he used to be a special
// "final boss" entered via his own enterBossRoom() with no room segment in
// front of him and no hub pause after him. He's now just the 5th (and
// last) entry in MID_CHAIN_BOSS_ORDER, so this test walks through all 5,
// including his own hub pause, before the chain is truly exhausted and
// routes to the mirror finale.
const { loadGame } = require('./test_env');
const vm = require('vm');
const ROOT = require('path').resolve(__dirname, '..'); // repo root, wherever it was cloned

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log(`OK   ${label}`); }
  else { failures++; console.log(`FAIL ${label}  ${detail !== undefined ? JSON.stringify(detail) : ''}`); }
}

const sb = loadGame(ROOT);
const ctx = sb.__sandbox;
const run = (code) => vm.runInContext(code, ctx);

// Walks the CURRENT run forward via advanceRoom() (clearing whatever
// enemies are in the way each time), same pattern test_room_chain.js
// already uses, until either a boss fight starts or the run leaves 'run'
// state entirely (mirror finale, etc.) — mirrors how a real playthrough
// reaches each trigger room instead of teleporting roomIndex.
function walkToNextBoss() {
  for (let guard = 0; guard < 30; guard++) {
    if (run('Game.state') !== 'run') return;
    run('Game.enemies.forEach(e => { e.alive = false; }); Game.advanceRoom();');
  }
  throw new Error('walkToNextBoss: guard exceeded, chain never reached a boss');
}

const ALL_FIVE = ['lisden', 'sakarver', 'reysdro', 'vetomo', 'keons'];

run('Game.enterHub();');
run('Game.startRun();');

check('fresh cycle: chain triggers all 5 Bishops (Keons included) in order',
  JSON.stringify(run('Game.roomChain.filter(e => e.triggersBoss).map(e => e.triggersBoss)')) === JSON.stringify(ALL_FIVE),
  run('Game.roomChain.filter(e => e.triggersBoss).map(e => e.triggersBoss)'));

// --- Walk to and defeat Lisden, then die before finishing the run -------
walkToNextBoss();
check('walked straight into the Lisden fight', run('Game.state') === 'boss' && run('Game.boss.bishopKey') === 'lisden',
  { state: run('Game.state'), bishopKey: run('Game.boss && Game.boss.bishopKey') });

run('Game.boss.alive = false; Game.boss.hp = 0;');
run('Game.onBossDefeated();');

check('Lisden persisted into save.defeatedBishops immediately on defeat',
  run('Game.save.defeatedBishops.includes("lisden")'));
check('defeating a mid-chain boss pauses in the hub (unchanged behavior)',
  run('Game.state') === 'hub' && run('Game.runInProgress') === true);

// Die right here, before the run finishes.
run('Game.onPlayerDeath();');
check('death does NOT clear the persisted Bishop roster',
  run('Game.save.defeatedBishops.includes("lisden")'));

// Pick whichever heir was rolled and go again.
run('Game.chooseHeir(Game.pendingHeirs[0]);');
run('Game.startRun();');

check('new attempt after death: Lisden\'s segment no longer triggers a fight',
  run('Game.roomChain.some(e => e.triggersBoss === "lisden")') === false);
check('new attempt after death: the other 4 Bishops (Keons included) still gate their segments',
  JSON.stringify(run('Game.roomChain.filter(e => e.triggersBoss).map(e => e.triggersBoss)')) === JSON.stringify(['sakarver', 'reysdro', 'vetomo', 'keons']),
  run('Game.roomChain.filter(e => e.triggersBoss).map(e => e.triggersBoss)'));
check('defeatedBishopsThisRun (the per-attempt difficulty-ramp counter) reset to empty for the new attempt',
  run('Game.defeatedBishopsThisRun.size') === 0);

// --- Walk through and finish off the remaining 4 Bishops (Keons last) ---
// Lisden's now-untriggered segment should be walked through with no fight.
walkToNextBoss();
check('walked past Lisden\'s (already-dead) segment straight into Sakarver',
  run('Game.state') === 'boss' && run('Game.boss.bishopKey') === 'sakarver',
  { state: run('Game.state'), bishopKey: run('Game.boss && Game.boss.bishopKey') });

for (const key of ['sakarver', 'reysdro', 'vetomo', 'keons']) {
  check(`fighting the expected boss (${key})`, run('Game.boss.bishopKey') === key, run('Game.boss.bishopKey'));

  run('Game.boss.alive = false; Game.boss.hp = 0;');
  run('Game.onBossDefeated();');

  // Bug #3: EVERY mid-chain boss, Keons included, pauses in the hub —
  // never a direct jump to the mirror finale from onBossDefeated() itself.
  check(`defeating ${key} pauses in the hub (never jumps straight to the finale)`,
    run('Game.state') === 'hub' && run('Game.runInProgress') === true,
    { state: run('Game.state'), runInProgress: run('Game.runInProgress') });

  // Simulate the player actually standing at the portal in this hub pause
  // (what a real frame of updateHub() would do while hubNearPortal is
  // true) before continuing — this is what makes the next check a REAL
  // regression test for bug #2, not just "was it hidden by default".
  run(`HUD.setPortalPrompt(true, { left: 0, top: 0, label: 'x' }); HUD.setHubHint(true);`);
  check(`portal prompt/hub hint ARE showing right before continuing past ${key} (sanity check)`,
    run('!HUD.els.portalPrompt.classList.contains("hidden") && !HUD.els.hubHint.classList.contains("hidden")'));

  run('Game.continueAfterMidBoss();'); // leaves the hub pause, resumes the chain

  // Bug #2 regression check: continuing into the NEXT fight (Keons
  // included) must clear that stale prompt/hint. Keons used to be reached
  // via a separate enterBossRoom() that early-returned past the HUD-
  // clearing calls every other boss transition runs, leaving this prompt
  // visible for the whole fight.
  check(`continuing past ${key} clears the portal-prompt/hub-hint (no stale HUD state going into the next fight)`,
    run('HUD.els.portalPrompt.classList.contains("hidden") && HUD.els.hubHint.classList.contains("hidden")'));

  if (key !== 'keons') walkToNextBoss();
}

check('all 5 Bishops now persisted as defeated',
  JSON.stringify(run('Game.save.defeatedBishops.slice().sort()')) === JSON.stringify([...ALL_FIVE].sort()),
  run('Game.save.defeatedBishops'));

// continueAfterMidBoss() after Keons' own hub pause is what actually
// starts the mirror finale now — not onBossDefeated() short-circuiting.
check('continuing from Keons\' hub pause enters the mirror finale directly (no extra rooms)',
  run('Game.isFinaleFight === true && Game.boss && Game.boss.bishopKey === "mirror"'),
  { isFinaleFight: run('Game.isFinaleFight'), bishopKey: run('Game.boss && Game.boss.bishopKey') });
check('no stale portal-prompt/hub-hint HUD state during the mirror finale either',
  run('HUD.els.portalPrompt.classList.contains("hidden") && HUD.els.hubHint.classList.contains("hidden")'));

// --- Cycle victory: the ONE point that's allowed to reset the roster ----
const cycleBefore = run('Game.save.cycleCount');
run('Game.boss.alive = false; Game.boss.hp = 0;');
run('Game.onBossDefeated();'); // isFinaleFight -> onCycleVictory()

check('onCycleVictory() incremented cycleCount', run('Game.save.cycleCount') === cycleBefore + 1);
check('onCycleVictory() is the point that clears the persisted Bishop roster (NG+ rebirth)',
  run('Game.save.defeatedBishops.length') === 0, run('Game.save.defeatedBishops'));

// A fresh cycle's first run should once again gate all 5 Bishops.
run('Game.showCycleHeirChoice();'); // the narrative screen's "continue" -> heir picker
run('Game.chooseCycleHeir(Game.pendingHeirs[0]);');
run('Game.startRun();');
check('new cycle: chain triggers all 5 Bishops again',
  JSON.stringify(run('Game.roomChain.filter(e => e.triggersBoss).map(e => e.triggersBoss)')) === JSON.stringify(ALL_FIVE),
  run('Game.roomChain.filter(e => e.triggersBoss).map(e => e.triggersBoss)'));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
