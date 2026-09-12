const { loadGame } = require('./test_env');
const ROOT = require('path').resolve(__dirname, '..'); // repo root, wherever it was cloned

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log(`OK   ${label}`); }
  else { failures++; console.log(`FAIL ${label}  ${detail || ''}`); }
}

// --- Part 3: inventory / equip-unequip-preserve-everything ----------------
{
  const sb = loadGame(ROOT);
  const { Player } = sb;
  const p = new Player(0, 0, 100, 1, 1, 3);
  const zeroMods = () => sb.emptyEquipMods();

  // 1) A strictly worse item must NOT be lost — this is the exact bug the
  // user flagged: "chests auto-equip only if upgrade, otherwise item is
  // lost". Force a bad roll into an already-good slot.
  const goodChest = { id: 'g1', slotType: 'chest', mods: { ...zeroMods(), bonusHp: 50 }, name: 'Good', color: '#fff', label: '+50 HP' };
  const badChest = { id: 'g2', slotType: 'chest', mods: { ...zeroMods(), bonusHp: 1 }, name: 'Bad', color: '#fff', label: '+1 HP' };
  p.receiveGear(goodChest);
  check('receiveGear: first item auto-equips into empty slot', p.equipment.chest === goodChest);
  p.receiveGear(badChest);
  check('receiveGear: worse item is NOT auto-equipped over a better one', p.equipment.chest === goodChest);
  check('receiveGear: worse item is preserved in gearInventory, not lost', p.gearInventory.includes(badChest),
    `gearInventory=${JSON.stringify(p.gearInventory.map((i) => i.id))}`);

  // 2) Manual equip from the inventory screen ALWAYS equips regardless of
  // score (no upgrade gate on manual actions), and the bumped item returns
  // to the grid rather than vanishing.
  const ok = p.manualEquipGear(badChest);
  check('manualEquipGear: succeeds even though item is a downgrade', ok === true);
  check('manualEquipGear: worse item is now worn', p.equipment.chest === badChest);
  check('manualEquipGear: bumped (better) item returned to gearInventory, not deleted',
    p.gearInventory.includes(goodChest));
  check('manualEquipGear: item removed from gearInventory once worn', !p.gearInventory.includes(badChest));

  // 3) Live stat recalculation: maxHp should reflect whatever's worn, at
  // every step, with no separate "recompute" call needed at the use site.
  const hpWithBad = p.maxHp;
  check('stats recompute live: maxHp only includes the +1 HP piece now', hpWithBad === 101, `got ${hpWithBad}`);
  p.unequipToInventory('chest');
  check('unequipToInventory: slot now empty', p.equipment.chest === null);
  check('unequipToInventory: item returned to gearInventory', p.gearInventory.includes(badChest));
  check('stats recompute live: maxHp back to fixed base with nothing worn', p.maxHp === 100, `got ${p.maxHp}`);
  p.manualEquipGear(goodChest);
  check('stats recompute live: maxHp reflects the +50 piece after re-equipping', p.maxHp === 150, `got ${p.maxHp}`);

  // 4) Accessory auto-equip fills empty slots first, then only swaps the
  // weakest occupant if the newcomer scores higher — same heuristic as
  // before, just no-loss now.
  const acc1 = { id: 'a1', slotType: 'accessory', mods: { ...zeroMods(), speedBonus: 0.10 }, name: 'Boots1', color: '#fff', label: '+10% speed' };
  const acc2 = { id: 'a2', slotType: 'accessory', mods: { ...zeroMods(), speedBonus: 0.05 }, name: 'Boots2', color: '#fff', label: '+5% speed' };
  const acc3 = { id: 'a3', slotType: 'accessory', mods: { ...zeroMods(), speedBonus: 0.01 }, name: 'Boots3', color: '#fff', label: '+1% speed' };
  const acc4weak = { id: 'a4', slotType: 'accessory', mods: { ...zeroMods(), speedBonus: 0.001 }, name: 'Boots4', color: '#fff', label: '+0.1% speed' };
  [acc1, acc2, acc3].forEach((a) => p.receiveGear(a));
  check('3 accessories all auto-equipped into the 3 empty slots',
    ['acc1', 'acc2', 'acc3'].every((slot) => [acc1, acc2, acc3].includes(p.equipment[slot])));
  p.receiveGear(acc4weak);
  check('4th (weaker) accessory NOT auto-equipped once all slots are full',
    !Object.values(p.equipment).includes(acc4weak));
  check('4th (weaker) accessory still preserved in gearInventory', p.gearInventory.includes(acc4weak));

  // 5) unequippedItems() unifies weapons + gear for the inventory grid AND
  // the scrapper — confirm the active weapon is excluded but everything
  // else (owned-but-inactive weapons, gearInventory) is included.
  const secondWeapon = sb.generateWeapon();
  p.unlockWeapon(secondWeapon); // equips it, so weaponIndex now points here
  const unequipped = p.unequippedItems();
  check('unequippedItems: currently-active weapon excluded',
    !unequipped.some((e) => e.kind === 'weapon' && e.item === secondWeapon));
  check('unequippedItems: previously-active (now inactive) weapon included',
    unequipped.some((e) => e.kind === 'weapon' && e.item === sb.STARTING_WEAPON));
  check('unequippedItems: gearInventory items included (acc4weak)',
    unequipped.some((e) => e.kind === 'gear' && e.item === acc4weak));
  check('unequippedItems: currently-worn gear excluded',
    !unequipped.some((e) => e.item === goodChest || e.item === acc1 || e.item === acc2 || e.item === acc3));

  // 6) removeUnequippedItem: permanent removal, with weaponIndex correctly
  // shifted when an earlier-indexed weapon is deleted.
  const startingEntry = unequipped.find((e) => e.item === sb.STARTING_WEAPON);
  const idxBefore = p.weaponIndex;
  const removed = p.removeUnequippedItem(startingEntry);
  check('removeUnequippedItem: reports success', removed === true);
  check('removeUnequippedItem: weapon actually gone from owned list', !p.weapons.includes(sb.STARTING_WEAPON));
  check('removeUnequippedItem: weaponIndex shifted down since an earlier slot was removed',
    p.weaponIndex === idxBefore - 1, `got ${p.weaponIndex}, expected ${idxBefore - 1}`);
  check('removeUnequippedItem: active weapon (secondWeapon) untouched', p.weapon === secondWeapon);

  const gearEntry = { kind: 'gear', item: acc4weak };
  check('removeUnequippedItem: gear removal works', p.removeUnequippedItem(gearEntry) === true);
  check('removeUnequippedItem: gear actually gone', !p.gearInventory.includes(acc4weak));
}

// --- Part 4: scrapper (sell unequipped items for gold + rare-shard bonus) --
{
  const sb = loadGame(ROOT);
  const { Game, Player } = sb;
  Game.player = new Player(0, 0, 100, 1, 1, 3);
  Game.save.gold = 0;
  Game.save.shards = 0;

  // A deliberately weak (common) accessory and a deliberately maxed-out
  // (rare) one, built directly from the affix table's own bounds so the
  // rarity check is exact rather than probabilistic.
  const weakAffix = sb.ACCESSORY_AFFIXES[0];
  const commonAcc = { id: 'c1', slotType: 'accessory', mods: { ...sb.emptyEquipMods(), [weakAffix.key]: weakAffix.min }, name: 'Common', color: '#fff', label: 'weak' };
  const rareAcc = { id: 'c2', slotType: 'accessory', mods: { ...sb.emptyEquipMods(), [weakAffix.key]: weakAffix.max }, name: 'Rare', color: '#fff', label: 'strong' };
  Game.player.gearInventory.push(commonAcc, rareAcc);

  const commonEntry = { kind: 'gear', item: commonAcc };
  const rareEntry = { kind: 'gear', item: rareAcc };

  check('itemQuality: min-roll affix scores ~0', sb.itemQuality(commonAcc) < 0.05, `got ${sb.itemQuality(commonAcc)}`);
  check('itemQuality: max-roll affix scores ~1', sb.itemQuality(rareAcc) > 0.95, `got ${sb.itemQuality(rareAcc)}`);
  check('Game.isRareItem: common item is not rare', !Game.isRareItem(commonEntry));
  check('Game.isRareItem: max-roll item IS rare', Game.isRareItem(rareEntry));

  const commonValue = Game.scrapValue(commonEntry);
  const rareValue = Game.scrapValue(rareEntry);
  check('scrapValue: common item has 0 bonus shards', commonValue.shards === 0);
  check('scrapValue: rare item has a nonzero shard bonus', rareValue.shards >= sb.SCRAP_RARE_SHARD_MIN && rareValue.shards <= sb.SCRAP_RARE_SHARD_MAX,
    `got ${rareValue.shards}`);
  check('scrapValue: gold scales with itemScore (rare > common here)', rareValue.gold >= commonValue.gold,
    `common=${commonValue.gold} rare=${rareValue.gold}`);

  const goldBefore = Game.save.gold, shardsBefore = Game.save.shards;
  const payout = Game.scrapItem(commonEntry);
  check('scrapItem: returns the payout', payout && payout.gold === commonValue.gold);
  check('scrapItem: gold actually credited', Game.save.gold === goldBefore + commonValue.gold,
    `got ${Game.save.gold}, expected ${goldBefore + commonValue.gold}`);
  check('scrapItem: item permanently removed from inventory', !Game.player.gearInventory.includes(commonAcc));

  const payout2 = Game.scrapItem(rareEntry);
  check('scrapItem (rare): shards credited too', Game.save.shards === shardsBefore + payout2.shards,
    `got ${Game.save.shards}, expected ${shardsBefore + payout2.shards}`);

  // Selling an already-removed entry must be a safe no-op, not a crash or a
  // double payout (defends against a stale/double click in the UI).
  const goldBeforeStale = Game.save.gold;
  const staleResult = Game.scrapItem(commonEntry);
  check('scrapItem: re-scrapping an already-removed entry is a safe no-op', staleResult === null);
  check('scrapItem: no double payout from the stale click', Game.save.gold === goldBeforeStale);

  // A weapon rare enough to cross the empirically-derived threshold should
  // also get the bonus, via the separate (non-uniform-distribution) path.
  const weapons = [];
  for (let i = 0; i < 500; i++) weapons.push(sb.generateWeapon());
  const rareWeapon = weapons.find((w) => sb.isRareWeapon(w));
  const commonWeapon = weapons.find((w) => !sb.isRareWeapon(w));
  check('sample contains at least one rare and one common weapon (sanity)', !!rareWeapon && !!commonWeapon);
  if (rareWeapon) {
    const v = Game.scrapValue({ kind: 'weapon', item: rareWeapon });
    check('scrapValue: rare weapon gets shard bonus', v.rare === true && v.shards > 0);
  }
  if (commonWeapon) {
    const v = Game.scrapValue({ kind: 'weapon', item: commonWeapon });
    check('scrapValue: common weapon gets no shard bonus', v.rare === false && v.shards === 0);
  }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
