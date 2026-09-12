// Regression test for the 5th hub NPC: a gold+shard -> Эхо exchange,
// deliberately worse than completing a cycle (see game.js's ECHO_EXCHANGE_*
// comment).
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

run('Game.enterHub();');

// --- status reporting ---------------------------------------------------
run('Game.save.gold = 0; Game.save.shards = 0;');
let status = run('Game.echoExchangeStatus()');
check('echoExchangeStatus() reports the fixed costs', status.goldCost === run('ECHO_EXCHANGE_GOLD_COST') && status.shardCost === run('ECHO_EXCHANGE_SHARD_COST'), status);
check('cannot afford with 0 gold/shards', status.canAfford === false);

run('Game.save.gold = ECHO_EXCHANGE_GOLD_COST; Game.save.shards = ECHO_EXCHANGE_SHARD_COST - 1;');
check('cannot afford with enough gold but one shard short', run('Game.echoExchangeStatus().canAfford') === false);

run('Game.save.gold = ECHO_EXCHANGE_GOLD_COST - 1; Game.save.shards = ECHO_EXCHANGE_SHARD_COST;');
check('cannot afford with enough shards but gold short (requires BOTH at once)', run('Game.echoExchangeStatus().canAfford') === false);

// --- the actual exchange -------------------------------------------------
run('Game.save.gold = ECHO_EXCHANGE_GOLD_COST * 2; Game.save.shards = ECHO_EXCHANGE_SHARD_COST * 2; Game.save.prestige = 0;');
run('Game.buyEchoExchange();');
check('buyEchoExchange() deducts exactly ECHO_EXCHANGE_GOLD_COST gold', run('Game.save.gold') === run('ECHO_EXCHANGE_GOLD_COST'));
check('buyEchoExchange() deducts exactly ECHO_EXCHANGE_SHARD_COST shards', run('Game.save.shards') === run('ECHO_EXCHANGE_SHARD_COST'));
check('buyEchoExchange() grants exactly 1 prestige/echo', run('Game.save.prestige') === 1);

// Repeatable (no level cap, unlike the prestige tree).
run('Game.buyEchoExchange();');
check('buyEchoExchange() is repeatable', run('Game.save.prestige') === 2 && run('Game.save.gold') === 0 && run('Game.save.shards') === 0);

// Insufficient funds -> no-op, no partial spend.
const goldBefore = run('Game.save.gold');
const shardBefore = run('Game.save.shards');
const prestigeBefore = run('Game.save.prestige');
run('Game.buyEchoExchange();'); // gold/shards are 0 now
check('buyEchoExchange() with insufficient funds does not touch gold/shards/prestige',
  run('Game.save.gold') === goldBefore && run('Game.save.shards') === shardBefore && run('Game.save.prestige') === prestigeBefore);

// --- balance sanity: clearly worse than the main cycle-completion path --
const cycleAward = run('PRESTIGE_PER_CYCLE_BASE'); // first-cycle direct award
// Best case for the exchange: an entire clear's gold+shard income spent on
// nothing else (unrealistic — bandages/upgrades/merchant offers compete for
// the same pool) still caps out around 1-2 echo, per the constants' own
// comment's math (~1000-1500 gold and ~25-30 shards per full clear).
const plausibleFullClearGold = 1500;
const plausibleFullClearShards = 30;
const bestCaseExchanges = Math.min(
  Math.floor(plausibleFullClearGold / run('ECHO_EXCHANGE_GOLD_COST')),
  Math.floor(plausibleFullClearShards / run('ECHO_EXCHANGE_SHARD_COST')),
);
check('best-case exchange count from one full clear\'s income is clearly <= the direct first-cycle award',
  bestCaseExchanges <= cycleAward, { bestCaseExchanges, cycleAward });

// --- hub wiring: proximity shows/hides the panel, main.js's HubProps -----
check('HubProps.echoTrader exists and is spatially distinct from the other 4 stations', (() => {
  const props = run(`({
    echoTrader: HubProps.echoTrader,
    merchant: HubProps.merchant,
    obelisk: HubProps.obelisk,
    scrapper: HubProps.scrapper,
    portal: HubProps.portal,
  })`);
  const center = (p) => p.x + p.w / 2;
  const dist = (a, b) => Math.abs(center(a) - center(b));
  const HUB_INTERACT_RANGE = run('HUB_INTERACT_RANGE');
  return ['merchant', 'obelisk', 'scrapper', 'portal'].every((k) => dist(props.echoTrader, props[k]) >= HUB_INTERACT_RANGE);
})());

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
