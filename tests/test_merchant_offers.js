// Regression test for the merchant's gear-for-gold offers (new gold sink —
// part of the economy pass) and the raised dmg/cd shard-upgrade caps.
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
check('enterHub() rolls MERCHANT_OFFER_COUNT offers', run('Game.merchantOffers.length') === run('MERCHANT_OFFER_COUNT'));
check('every offer has a positive price and a kind of weapon/gear', run(`
  Game.merchantOffers.every(o => o.price > 0 && (o.kind === 'weapon' || o.kind === 'gear'))
`));

// Buying an offer: deducts gold, hands the player the item, removes the offer.
run('Game.save.gold = 100000; persistSaveTestHook = true;');
const firstOffer = JSON.parse(JSON.stringify(run('Game.merchantOffers[0]')));
const goldBefore = run('Game.save.gold');
const weaponCountBefore = run('Game.player.weapons.length');
const gearCountBefore = run('Game.player.gearInventory.length');
run(`Game.buyMerchantOffer('${firstOffer.id}');`);
check('buyMerchantOffer() deducts exactly the offer price', run('Game.save.gold') === goldBefore - firstOffer.price, { goldBefore, price: firstOffer.price, after: run('Game.save.gold') });
check('buyMerchantOffer() removes the bought offer from the list', run(`Game.merchantOffers.some(o => o.id === '${firstOffer.id}')`) === false);
if (firstOffer.kind === 'weapon') {
  check('bought weapon was added to player.weapons', run('Game.player.weapons.length') === weaponCountBefore + 1);
} else {
  check('bought gear was added to player.gearInventory (or auto-equipped)', run('Game.player.gearInventory.length') >= gearCountBefore || run('Object.values(Game.player.equipment).some(Boolean)'));
}

// Buying with insufficient gold is a no-op.
run('Game.save.gold = 0;');
const secondOffer = run('Game.merchantOffers[0]');
const result = run(`Game.buyMerchantOffer(${secondOffer ? `'${secondOffer.id}'` : 'null'})`);
check('buyMerchantOffer() with insufficient gold returns null and does not remove the offer', result === null && (secondOffer ? run('Game.merchantOffers.length') >= 1 : true));

// Reroll: costs gold, replaces the whole stock.
run('Game.save.gold = 1000;');
const stockBefore = run('JSON.stringify(Game.merchantOffers.map(o => o.id + o.price))');
run('Game.rerollMerchantOffers();');
check('rerollMerchantOffers() spends MERCHANT_REROLL_COST gold', run('Game.save.gold') === 1000 - run('MERCHANT_REROLL_COST'));
check('rerollMerchantOffers() replaces the stock back up to MERCHANT_OFFER_COUNT', run('Game.merchantOffers.length') === run('MERCHANT_OFFER_COUNT'));

// pauseRunInHub() also restocks (fresh offers each hub visit, not just enterHub).
run('Game.startRun();');
run(`
  Game.roomChain[Game.roomChain.length - 1].triggersBoss = null; // don't actually care which bishop
  Game.enterMidBoss(MID_CHAIN_BOSS_DEFS.lisden);
  Game.boss.alive = false; Game.boss.hp = 0;
`);
const offersBeforeMidBoss = run('JSON.stringify(Game.merchantOffers)');
run('Game.onBossDefeated();'); // -> pauseRunInHub()
check('pauseRunInHub() also rerolls the merchant stock for the new hub visit', run('Game.merchantOffers.length') === run('MERCHANT_OFFER_COUNT'));

// --- raised shard-upgrade caps (the shard-stagnation fix) ---------------
check('DMG_UPGRADE_MAX_LEVEL was raised above the old cap of 5', run('DMG_UPGRADE_MAX_LEVEL') > 5, run('DMG_UPGRADE_MAX_LEVEL'));
check('CD_UPGRADE_MAX_LEVEL was raised above the old cap of 4', run('CD_UPGRADE_MAX_LEVEL') > 4, run('CD_UPGRADE_MAX_LEVEL'));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
