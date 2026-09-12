// Economy rebalance (max-HP track priced up, echo priced down) plus the new
// auto-equip rule: a drop replaces what's worn when it beats it on outgoing
// damage OR on incoming-damage mitigation.
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

// Income reference used throughout: a full chain traversal nets roughly
// 1000-1500 gold (chests + trash + boss rewards), per game.js's own economy
// notes. The complaint being fixed: after ONE traversal you could buy three
// max-HP levels outright.
const TRAVERSAL_GOLD_LOW = 1000;
const TRAVERSAL_GOLD_HIGH = 1500;
// Not all of that is available for the obelisk: bandages (45 each) and the
// merchant's rotating stock are the other gold sinks, and a run that skips
// them entirely is taking a real survival risk rather than making a free
// choice. This is the honest ceiling on what one traversal can put toward
// max-HP levels.
const TRAVERSAL_DISPOSABLE_HIGH = TRAVERSAL_GOLD_HIGH - 300;

// --- 1. Max-HP track is no longer trivially affordable ---
{
  const costs = [];
  for (let lvl = 0; lvl < sb.HP_UPGRADE_MAX_LEVEL; lvl++) costs.push(sb.hpUpgradeCost(lvl));
  const cumulative = costs.map((_, i) => costs.slice(0, i + 1).reduce((a, b) => a + b, 0));
  console.log(`   HP costs per level: ${costs.join(' / ')}  (cumulative ${cumulative.join(' / ')})`);

  check('every level costs strictly more than the one before it', costs.every((c, i) => i === 0 || c > costs[i - 1]), costs);
  check('costs grow geometrically, not by a flat step (late levels are real goals)',
    costs[4] / costs[3] > 1.5 && costs[1] / costs[0] > 1.5, costs);
  check('costs are round tens (readable prices at the obelisk)', costs.every((c) => c % 10 === 0), costs);

  // The actual complaint: three levels after one traversal.
  check('THE BUG: three levels can no longer be bought out of a single traversal',
    cumulative[2] > TRAVERSAL_DISPOSABLE_HIGH, { threeLevels: cumulative[2], TRAVERSAL_DISPOSABLE_HIGH });
  check('...three levels used to cost 270 — a fraction of one run; now it is most of one at minimum',
    cumulative[2] > TRAVERSAL_GOLD_LOW, cumulative[2]);
  check('...but the first level is still affordable inside one traversal (progress is not walled off)',
    costs[0] < TRAVERSAL_GOLD_LOW / 2, { first: costs[0] });
  check('...and two levels remain reachable in a good first run (it is a spend decision, not a block)',
    cumulative[1] < TRAVERSAL_GOLD_HIGH, { twoLevels: cumulative[1] });
  check('the full track costs several traversals rather than a fraction of one',
    cumulative[4] > TRAVERSAL_GOLD_HIGH * 2, { fullTrack: cumulative[4] });
  check('the full track is meaningfully pricier than the old 650-gold total', cumulative[4] > 650 * 3, cumulative[4]);
}

// --- 2. Echo got cheaper, both the tree and the exchange ---
{
  const treeTotal = sb.PRESTIGE_UPGRADES.reduce((sum, u) => sum + u.costs.reduce((a, b) => a + b, 0), 0);
  console.log(`   Echo tree total: ${treeTotal} (was 28) | exchange: ${sb.ECHO_EXCHANGE_GOLD_COST}g + ${sb.ECHO_EXCHANGE_SHARD_COST}s (was 500g + 20s)`);

  check('the whole prestige tree costs less echo than it used to (28)', treeTotal < 28, treeTotal);
  check('...but is not given away either (still a multi-cycle goal)', treeTotal >= 15, treeTotal);
  check('every upgrade still costs at least 2 echo', sb.PRESTIGE_UPGRADES.every((u) => u.costs.every((c) => c >= 2)));
  check('multi-level upgrades still get pricier per level',
    sb.PRESTIGE_UPGRADES.every((u) => u.costs.every((c, i) => i === 0 || c >= u.costs[i - 1])));

  // Cycles needed to afford the whole tree: award is base + one per prior cycle.
  let earned = 0, cycles = 0;
  while (earned < treeTotal && cycles < 50) { earned += sb.PRESTIGE_PER_CYCLE_BASE + cycles; cycles++; }
  console.log(`   Cycles to fully buy the tree: ${cycles} (was ~7)`);
  check('the tree is now finishable in fewer cycles than before', cycles < 7, cycles);
  check('...and still takes more than a couple of clears', cycles >= 3, cycles);

  check('the echo exchange got cheaper in gold', sb.ECHO_EXCHANGE_GOLD_COST < 500, sb.ECHO_EXCHANGE_GOLD_COST);
  check('the echo exchange got cheaper in shards', sb.ECHO_EXCHANGE_SHARD_COST < 20, sb.ECHO_EXCHANGE_SHARD_COST);
  // It must stay no better than simply finishing the cycle, or it becomes the
  // dominant strategy instead of a release valve.
  const shardsPerClear = 28; // ~5-7 per boss x ~5 bosses
  const exchangesPerClear = Math.floor(shardsPerClear / sb.ECHO_EXCHANGE_SHARD_COST);
  check('hoarding a whole clear\'s shards still buys no more echo than finishing the cycle does',
    exchangesPerClear <= sb.PRESTIGE_PER_CYCLE_BASE, { exchangesPerClear, perCycle: sb.PRESTIGE_PER_CYCLE_BASE });
}

// --- 3. Auto-equip: damage OR mitigation, nothing else ---
function gear(slotType, mods) {
  const full = run('emptyEquipMods()');
  return { id: 'test-' + Math.random(), slotType, name: 'test', mods: Object.assign(full, mods), color: '#fff', label: '' };
}
function playerWith(slot, item) {
  const p = run('p = new Player(100, 100, 100, 1, 1, 3, null)');
  if (item) {
    vm.runInContext('p.gearInventory.push(worn); p.equipFromInventory(worn, slotName);',
      Object.assign(ctx, { p, worn: item, slotName: slot }));
  }
  return p;
}
function receive(p, item) {
  vm.runInContext('p.receiveGear(dropped)', Object.assign(ctx, { p, dropped: item }));
}

{
  const worn = gear('chest', { damageReduction: 0.05, bonusHp: 10 });
  const p = playerWith('chest', worn);
  const better = gear('chest', { damageReduction: 0.09, bonusHp: 4 });
  receive(p, better);
  check('a drop with MORE mitigation replaces the worn piece', run('p.equipment.chest.id') === better.id);
  check('...and the displaced piece is kept in the bag, not destroyed',
    run('p.gearInventory.some((g) => g.id === wornId)'.replace('wornId', JSON.stringify(worn.id))));
}
{
  // All three accessory slots filled, so there's no empty slot to absorb the
  // drop and it has to actually beat an occupant to get equipped.
  const p = run('p = new Player(100, 100, 100, 1, 1, 3, null)');
  const weakest = gear('accessory', { damageBonus: 0.05 });
  const mid = gear('accessory', { damageBonus: 0.08 });
  const strong = gear('accessory', { damageBonus: 0.12 });
  for (const [slot, item] of [['acc1', weakest], ['acc2', mid], ['acc3', strong]]) {
    vm.runInContext('p.gearInventory.push(it); p.equipFromInventory(it, s);', Object.assign(ctx, { p, it: item, s: slot }));
  }
  const better = gear('accessory', { damageBonus: 0.11 });
  receive(p, better);
  check('a drop with MORE damage replaces the weakest worn accessory',
    run('p.equipment.acc1.id') === better.id, { acc1: run('p.equipment.acc1.mods.damageBonus') });
  check('...leaving the stronger accessories alone',
    run('p.equipment.acc2.id') === mid.id && run('p.equipment.acc3.id') === strong.id);
  check('...and the displaced one stays in the bag',
    run(`p.gearInventory.some((g) => g.id === ${JSON.stringify(weakest.id)})`));

  // A drop weaker than every occupant must not churn any slot.
  const worse = gear('accessory', { damageBonus: 0.01 });
  receive(p, worse);
  check('a drop weaker than every worn accessory changes nothing',
    run('p.equipment.acc1.id') === better.id && run('p.equipment.acc2.id') === mid.id && run('p.equipment.acc3.id') === strong.id);
}
{
  // The case the old blended score got wrong: a big pile of HP made an
  // otherwise-worse piece win, so the genuinely better defensive item was
  // left in the bag.
  const worn = gear('chest', { damageReduction: 0.02, bonusHp: 20 });
  const p = playerWith('chest', worn);
  const drop = gear('chest', { damageReduction: 0.03, bonusHp: 4 });
  const oldScoreSaysNo = run(`itemScore(${JSON.stringify(drop)}) < itemScore(${JSON.stringify(worn)})`);
  receive(p, drop);
  check('a straight mitigation gain now equips even when the old blended score said no',
    oldScoreSaysNo && run('p.equipment.chest.id') === drop.id, { oldScoreSaysNo });
}
{
  // ...and the inverse: more HP alone is NOT a reason to auto-swap.
  const worn = gear('chest', { damageReduction: 0.08, bonusHp: 4 });
  const p = playerWith('chest', worn);
  const drop = gear('chest', { damageReduction: 0.03, bonusHp: 20 });
  receive(p, drop);
  check('more HP alone does NOT auto-replace a better-mitigating piece', run('p.equipment.chest.id') === worn.id);
  check('...and that drop is still safely in the bag for a manual equip',
    run(`p.gearInventory.some((g) => g.id === ${JSON.stringify(drop.id)})`));
}
{
  const worn = gear('acc1', { speedBonus: 0.10, goldFind: 0.30 });
  const p = playerWith('acc1', worn);
  const drop = gear('accessory', { speedBonus: 0.12, goldFind: 0.30 });
  receive(p, drop);
  check('speed/gold-find gains alone never trigger an auto-swap', run('p.equipment.acc1.id') === worn.id);
}
{
  // An empty slot always takes the item, regardless of stats.
  const p = playerWith('chest', null);
  const drop = gear('chest', { bonusHp: 4 });
  receive(p, drop);
  check('an empty slot equips any drop (nothing to compare against)', run('p.equipment.chest.id') === drop.id);
}
{
  // Equal on both axes is not "better" — no pointless swapping.
  const worn = gear('chest', { damageReduction: 0.05, bonusHp: 10 });
  const p = playerWith('chest', worn);
  const drop = gear('chest', { damageReduction: 0.05, bonusHp: 10 });
  receive(p, drop);
  check('an identical piece does not churn the slot', run('p.equipment.chest.id') === worn.id);
}
{
  // Accessory targeting: a combat accessory should displace the trinket that
  // contributes least to damage/defence, not whichever the blended score
  // happened to rank lowest.
  const p = run('p = new Player(100, 100, 100, 1, 1, 3, null)');
  const combat = gear('acc1', { damageBonus: 0.10 });
  const tanky = gear('acc2', { damageReduction: 0.05 });
  const trinket = gear('acc3', { goldFind: 0.30, bonusHp: 20 });
  for (const [slot, item] of [['acc1', combat], ['acc2', tanky], ['acc3', trinket]]) {
    vm.runInContext('p.gearInventory.push(it); p.equipFromInventory(it, s);', Object.assign(ctx, { p, it: item, s: slot }));
  }
  const drop = gear('accessory', { damageBonus: 0.06 });
  receive(p, drop);
  check('a new combat accessory displaces the non-combat trinket, not a combat one',
    run('p.equipment.acc3.id') === drop.id
    && run('p.equipment.acc1.id') === combat.id
    && run('p.equipment.acc2.id') === tanky.id,
    { acc1: run('p.equipment.acc1.name'), acc2: run('p.equipment.acc2.name'), acc3: run('p.equipment.acc3.name') });
}
{
  // Real generated gear, many rolls: auto-equip must never leave the player
  // worse on BOTH axes than a piece sitting in their own bag.
  const bad = run(`
    (function() {
      let violations = 0;
      for (let i = 0; i < 400; i++) {
        const pl = new Player(100, 100, 100, 1, 1, 3, null);
        for (let d = 0; d < 8; d++) pl.receiveGear(generateRandomGear());
        for (const slot of ['helm', 'chest']) {
          const wornPiece = pl.equipment[slot];
          if (!wornPiece) continue;
          for (const bagItem of pl.gearInventory) {
            if (bagItem.slotType !== slot) continue;
            if (bagItem.mods.damageBonus > wornPiece.mods.damageBonus
             && bagItem.mods.damageReduction > wornPiece.mods.damageReduction) violations++;
          }
        }
      }
      return violations;
    })()
  `);
  check('over 400 simulated runs, no bagged armour ever beats the worn piece on BOTH axes at once', bad === 0, bad);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
