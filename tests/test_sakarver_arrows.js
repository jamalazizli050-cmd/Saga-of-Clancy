// Two fixes: Sakarver no longer damages herself on every lunge (she used to
// kill herself in ~32s with the player doing nothing), and the hub merchant
// now sells arrow resupplies.
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

// --- 1. Sakarver does not beat herself ---
{
  // A player parked far away and doing absolutely nothing: the exact
  // "stand still and watch her die" scenario that was reported.
  const result = run(`
    (function() {
      const boss = new SakarverBoss(700, 600, {});
      const room = { width: 4000, platforms: [{ x: 0, y: 660, w: 4000, h: 60 }] };
      const idlePlayer = {
        x: 3500, y: 600, w: 42, h: 60, hp: 100,
        takeDamage() { this.hp -= 1; },
      };
      const startHp = boss.hp;
      let lunges = 0, prevTimer = boss.attackTimer;
      for (let i = 0; i < 60 * 120; i++) { // two full minutes
        boss.update(1 / 60, room, idlePlayer);
        if (boss.attackTimer > prevTimer) lunges++; // timer reset == a new lunge
        prevTimer = boss.attackTimer;
      }
      return { startHp, endHp: boss.hp, alive: boss.alive, lunges, playerHp: idlePlayer.hp };
    })()
  `);
  console.log(`   2 minutes, player idle across the arena: ${result.lunges} lunges, boss HP ${result.startHp} -> ${result.endHp}`);

  check('THE BUG: Sakarver no longer loses HP from her own lunges',
    result.endHp === result.startHp, result);
  check('...so she is still alive after two minutes of the player doing nothing',
    result.alive === true, { alive: result.alive, endHp: result.endHp });
  check('she does still lunge repeatedly (the attack itself is intact, only the self-damage is gone)',
    result.lunges > 30, result.lunges);
  check('the boss object no longer carries a selfDamage stat at all',
    run('new SakarverBoss(0, 0, {}).selfDamage') === undefined);

  // Player damage must still be the thing that kills her.
  const killable = run(`
    (function() {
      const boss = new SakarverBoss(700, 600, {});
      const startHp = boss.hp;
      let hits = 0;
      while (boss.alive && hits < 500) { boss.takeDamage(20); hits++; }
      return { startHp, hits, alive: boss.alive, hp: boss.hp };
    })()
  `);
  check('the player can still kill her by dealing damage', killable.alive === false, killable);
  check('...and it takes a realistic number of hits (she is a real fight now)',
    killable.hits >= 15, killable.hits);
}

// --- The acceleration mechanic must survive: it keys off HP fraction, so
// player-dealt damage drives it exactly as self-damage used to. ---
{
  const accel = run(`
    (function() {
      const boss = new SakarverBoss(700, 600, {});
      const atFull = boss.cooldownMultiplier;
      boss.hp = boss.maxHp * 0.5;
      const atHalf = boss.cooldownMultiplier;
      boss.hp = 1;
      const atNearDeath = boss.cooldownMultiplier;
      return { atFull, atHalf, atNearDeath };
    })()
  `);
  check('at full HP she is at her slowest cadence', Math.abs(accel.atFull - 1) < 0.01, accel);
  check('hurting her speeds her up (the signature tell still works, now driven by the player)',
    accel.atHalf < accel.atFull && accel.atNearDeath < accel.atHalf, accel);
  check('...bottoming out at the intended floor',
    Math.abs(accel.atNearDeath - sb.SAKARVER_MIN_COOLDOWN_MUL) < 0.02, accel);
}

// --- 2. Buying arrows at the hub merchant ---
{
  check(`a bundle is ${sb.ARROW_BUNDLE_SIZE} arrows for ${sb.ARROW_BUNDLE_COST} gold, as asked`,
    sb.ARROW_BUNDLE_SIZE === 8 && sb.ARROW_BUNDLE_COST === 150,
    { size: sb.ARROW_BUNDLE_SIZE, cost: sb.ARROW_BUNDLE_COST });

  const buy = run(`
    (function() {
      Game.player = new Player(0, 0, 100, 1, 1, 3, null);
      Game.save.gold = 400;
      Game.player.arrows = 2;
      const before = { gold: Game.save.gold, arrows: Game.player.arrows };
      Game.buyArrows();
      const afterOne = { gold: Game.save.gold, arrows: Game.player.arrows };
      Game.buyArrows();
      const afterTwo = { gold: Game.save.gold, arrows: Game.player.arrows };
      // Third purchase: only 100 gold left, cannot afford 150.
      Game.buyArrows();
      const afterBroke = { gold: Game.save.gold, arrows: Game.player.arrows };
      return { before, afterOne, afterTwo, afterBroke, status: Game.arrowBundleStatus() };
    })()
  `);
  check('buying a bundle adds exactly the bundle size to the quiver',
    buy.afterOne.arrows === buy.before.arrows + sb.ARROW_BUNDLE_SIZE, buy);
  check('...and charges exactly the bundle cost',
    buy.afterOne.gold === buy.before.gold - sb.ARROW_BUNDLE_COST, buy);
  check('it is repeatable (a second bundle works too)',
    buy.afterTwo.arrows === buy.before.arrows + sb.ARROW_BUNDLE_SIZE * 2, buy);
  check('a purchase with insufficient gold is refused outright',
    buy.afterBroke.arrows === buy.afterTwo.arrows && buy.afterBroke.gold === buy.afterTwo.gold, buy.afterBroke);
  check('the status the merchant panel renders reports the real quiver count',
    buy.status.arrows === buy.afterTwo.arrows && buy.status.size === sb.ARROW_BUNDLE_SIZE, buy.status);
  check('canAfford flips false once gold drops below the price',
    buy.status.canAfford === false, buy.status);

  const affordable = run(`(function(){ Game.save.gold = 150; return Game.arrowBundleStatus().canAfford; })()`);
  check('canAfford is true at exactly the price', affordable === true);

  // Unlike the bandage there's no "already full" no-op — arrows have no cap.
  const uncapped = run(`
    (function() {
      Game.save.gold = 100000;
      Game.player.arrows = 500;
      Game.buyArrows();
      return Game.player.arrows;
    })()
  `);
  check('there is no arrow cap blocking a resupply', uncapped === 508, uncapped);

  // Buying with no player (e.g. sitting on the title screen) must not throw.
  const noPlayer = run(`
    (function() {
      const realPlayer = Game.player;
      Game.player = null;
      let threw = false;
      try { Game.buyArrows(); } catch (e) { threw = true; }
      const status = Game.arrowBundleStatus();
      Game.player = realPlayer;
      return { threw, statusArrows: status.arrows };
    })()
  `);
  check('buying with no active player is a safe no-op, not a crash', noPlayer.threw === false);
  check('...and the status still renders (reports 0 arrows)', noPlayer.statusArrows === 0);

  // Pricing sanity against the game's other repeatable gold sink.
  check('a bundle costs meaningfully more than a bandage (arrows stay a real resource)',
    sb.ARROW_BUNDLE_COST > sb.BANDAGE_COST * 2, { bundle: sb.ARROW_BUNDLE_COST, bandage: sb.BANDAGE_COST });
  check('...but is affordable well within one traversal\'s income (~1000-1500 gold)',
    sb.ARROW_BUNDLE_COST < 400, sb.ARROW_BUNDLE_COST);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
