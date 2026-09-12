const { loadGame } = require('./test_env');
const ROOT = require('path').resolve(__dirname, '..'); // repo root, wherever it was cloned

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log(`OK   ${label}`); }
  else { failures++; console.log(`FAIL ${label}  ${detail || ''}`); }
}

// --- Part 1: fixed-base heir profiles -----------------------------------
{
  const sb = loadGame(ROOT);
  const { Game, BASE_MAX_HP, MOVE_SPEED } = sb;

  // Simulate a heavily-upgraded, gear-inflated previous character: high
  // hpLevel (permanent) plus a heir profile multiplier.
  Game.save.hpLevel = 5;
  Game.activeHeir = { name: 'Test', hpMul: 1.2, speedMul: 0.85, label: 'test' };
  const hpWithInflatedHeir = Game.currentMaxHp();
  const expectedHp = Math.round(BASE_MAX_HP * 1.2 * Math.pow(1.1, 5));
  check('currentMaxHp uses fixed BASE_MAX_HP * heirMul * hpLevel-curve',
    hpWithInflatedHeir === expectedHp,
    `got ${hpWithInflatedHeir}, expected ${expectedHp}`);

  // Now prove it does NOT depend on any live/previous player instance's
  // actual maxHp (e.g. one inflated further by gear) — currentMaxHp() takes
  // no player argument at all, so simulate "a previous character that had
  // +200 bonus HP from gear" and confirm the next heir's base is unaffected.
  Game.player = { maxHp: 9999 }; // pretend the dead character had huge maxHp
  const hpStillFixed = Game.currentMaxHp();
  check('currentMaxHp ignores previous player.maxHp entirely',
    hpStillFixed === expectedHp,
    `got ${hpStillFixed}, expected ${expectedHp} (should be unchanged by player.maxHp=9999)`);

  // Different heir profile -> different fixed base, still independent of hpLevel? no hpLevel applies on top.
  Game.activeHeir = { name: 'Test2', hpMul: 0.85, speedMul: 1.2, label: 'test2' };
  const hpMul2 = Game.currentMaxHp();
  const expectedHp2 = Math.round(BASE_MAX_HP * 0.85 * Math.pow(1.1, 5));
  check('currentMaxHp recomputes cleanly per-heir (0.85 mul)',
    hpMul2 === expectedHp2, `got ${hpMul2}, expected ${expectedHp2}`);

  check('computeMaxHp() no longer exists (removed dead code)',
    typeof sb.computeMaxHp === 'undefined');
}

// --- Part 2: death converts surplus HP + all gold to shards -------------
{
  const sb = loadGame(ROOT);
  const { Game, BASE_MAX_HP, GOLD_TO_SHARD_RATE_BY_LEVEL, HP_SURPLUS_SHARDS_PER_UNIT } = sb;

  Game.save.gold = 137;
  Game.save.shards = 20; // pre-existing banked shards must be preserved, not overwritten
  Game.save.prestigeGoldLevel = 0;
  // Fake a player with inflated maxHp (as if gear pushed it well above the
  // fixed 100 base) — this is exactly the "inflated HP from armor" scenario
  // the user's test plan calls for.
  Game.player = { maxHp: 154 };

  const hpSurplusExpected = 154 - BASE_MAX_HP; // 54
  const hpShardsExpected = Math.ceil(hpSurplusExpected / HP_SURPLUS_SHARDS_PER_UNIT); // ceil(5.4)=6
  const goldShardsExpected = Math.ceil(137 / GOLD_TO_SHARD_RATE_BY_LEVEL[0]); // ceil(137/15)=10
  const totalExpected = hpShardsExpected + goldShardsExpected;
  const shardsBefore = Game.save.shards;

  Game.onPlayerDeath();

  check('onPlayerDeath: gold fully zeroed', Game.save.gold === 0, `got ${Game.save.gold}`);
  check('onPlayerDeath: exact shard math (hp+gold) added on top of banked shards',
    Game.save.shards === shardsBefore + totalExpected,
    `got ${Game.save.shards}, expected ${shardsBefore + totalExpected} (hpShards=${hpShardsExpected}, goldShards=${goldShardsExpected})`);
  check('onPlayerDeath: state -> dead', Game.state === 'dead');
  check('onPlayerDeath: pendingHeirs rolled', Array.isArray(Game.pendingHeirs) && Game.pendingHeirs.length > 0);

  // Prestige gold-rate upgrade should improve (lower) the conversion rate.
  const sb2 = loadGame(ROOT);
  const Game2 = sb2.Game;
  Game2.save.gold = 137;
  Game2.save.prestigeGoldLevel = 2; // best tier -> rate 10
  Game2.player = { maxHp: 100 }; // no HP surplus this time
  const goldShardsExpected2 = Math.ceil(137 / sb2.GOLD_TO_SHARD_RATE_BY_LEVEL[2]);
  const shardsBefore2 = Game2.save.shards;
  Game2.onPlayerDeath();
  check('onPlayerDeath: prestigeGoldLevel improves conversion rate (10 gold/shard)',
    Game2.save.shards === shardsBefore2 + goldShardsExpected2,
    `got ${Game2.save.shards}, expected ${shardsBefore2 + goldShardsExpected2}`);
  check('onPlayerDeath: zero HP surplus contributes zero shards',
    Game2.save.shards - shardsBefore2 === goldShardsExpected2);

  // chooseHeir -> enterHub spawns a fresh Player strictly from fixed base.
  const heir = Game.pendingHeirs[0];
  Game.chooseHeir(heir);
  const expectedFreshHp = Math.round(BASE_MAX_HP * heir.hpMul * Math.pow(1.1, Game.save.hpLevel));
  check('chooseHeir -> enterHub: new Player.maxHp is clean fixed-base (not inflated)',
    Game.player.maxHp === expectedFreshHp,
    `got ${Game.player.maxHp}, expected ${expectedFreshHp}`);
  check('chooseHeir -> enterHub: new Player has 0 bonus equip HP (nothing carried over)',
    Game.player.equipMods.bonusHp === 0);
  check('new heir gold is 0 (not carried over)', Game.save.gold === 0);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
