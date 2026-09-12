// Sprint 1 equipment-UI pass (HANDOFF item 7). The card's look is checked in
// the browser (e2e_inventory_ui.js); what's covered here is the logic behind
// it — the stat comparison and, most importantly, that the comparison is
// resolved against the slot the item would ACTUALLY go into. A card that
// promises "+9 урон" against the wrong slot is worse than showing nothing.
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

run('Game.enterHub(); Game.startRun();');

// --- Weapon comparison ---------------------------------------------------
run(`
  __base = { id: 'b', name: 'база', noun: 'тесак', type: 'melee', damage: 15, cooldown: 0.45, range: 60, color: '#fff' };
  __better = { ...__base, id: 'up', damage: 24, cooldown: 0.35, range: 72 };
  __worse = { ...__base, id: 'dn', damage: 9, cooldown: 0.6, range: 50 };
  __same = { ...__base, id: 'eq' };
  __dirs = (list) => list.map((c) => c.dir);
  __labels = (list) => list.map((c) => c.label);
`);

check('лучшее оружие: все три оси как улучшение',
  run('__dirs(compareWeapons(__better, __base)).every((d) => d === 1)'),
  run('__labels(compareWeapons(__better, __base))'));
check('худшее оружие: все три оси как ухудшение',
  run('__dirs(compareWeapons(__worse, __base)).every((d) => d === -1)'),
  run('__labels(compareWeapons(__worse, __base))'));
check('идентичное оружие: сравнивать нечего (карточка покажет «то же самое»)',
  run('compareWeapons(__same, __base).length') === 0);

// Cooldown is the one axis where lower is better — the direction has to be
// flipped relative to the raw delta, or a faster weapon reads as a downgrade.
run(`
  __fasterOnly = { ...__base, id: 'f', cooldown: 0.30 };
  __cdCmp = compareWeapons(__fasterOnly, __base)[0];
`);
check('меньший кулдаун — это улучшение (единственная ось, где меньше = лучше)',
  run('__cdCmp.dir') === 1, run('__cdCmp'));
check('и подписан он со знаком минус', run('__cdCmp.label').includes('−'), run('__cdCmp.label'));

// --- Gear comparison -----------------------------------------------------
run(`
  __mk = (mods) => ({ id: 'g' + Math.random(), slotType: 'chest', name: 'g', mods: { ...emptyEquipMods(), ...mods }, label: '', color: '#fff' });
  __armorLow = __mk({ damageReduction: 0.02, bonusHp: 5 });
  __armorHigh = __mk({ damageReduction: 0.08, bonusHp: 12 });
  __drCmp = compareGear(__armorHigh, __armorLow).find((c) => c.label.includes('вх. урон'));
`);
check('больше снижения урона = улучшение (цвет)', run('__drCmp.dir') === 1, run('__drCmp'));
// The stat is written on the item as a negative ("-8% вх. урон"), so an
// improvement must print as a bigger negative, not as "+6% вх. урон" — which
// would read as taking MORE damage.
check('улучшение защиты подписано как «−», а не «+» (иначе читается наоборот)',
  run('__drCmp.label').startsWith('−'), run('__drCmp.label'));

run('__drWorse = compareGear(__armorLow, __armorHigh).find((c) => c.label.includes("вх. урон"));');
check('ухудшение защиты подписано как «+» и помечено ухудшением',
  run('__drWorse.dir') === -1 && run('__drWorse.label').startsWith('+'), run('__drWorse'));

run(`
  __cdrHigh = __mk({ cooldownReduction: 0.09 });
  __cdrLow = __mk({ cooldownReduction: 0.03 });
  __cdrCmp = compareGear(__cdrHigh, __cdrLow)[0];
`);
check('снижение кулдаунов подписано по той же логике («−», улучшение)',
  run('__cdrCmp.dir') === 1 && run('__cdrCmp.label').startsWith('−'), run('__cdrCmp'));

// An empty slot: everything the candidate rolls is a straight gain.
run('__vsEmpty = compareGear(__armorHigh, null);');
check('против пустого слота всё считается прибавкой',
  run('__vsEmpty.length') > 0 && run('__dirs(__vsEmpty).every((d) => d === 1)'),
  run('__labels(__vsEmpty)'));

// Unchanged stats are omitted entirely rather than listed as "+0".
run(`
  __a = __mk({ damageReduction: 0.05, bonusHp: 10 });
  __b = __mk({ damageReduction: 0.05, bonusHp: 14 });
  __partial = compareGear(__b, __a);
`);
check('неизменившиеся статы в сравнении не показываются',
  run('__partial.length') === 1 && run('__partial[0].label').includes('HP'),
  run('__labels(__partial)'));

// --- The comparison targets the slot the click would actually use --------
//
// This is the check that matters most: slotOccupantFor() has to mirror
// manualEquipGear()'s slot resolution exactly, including the accessory rule.
run(`
  __p = Game.player;
  __meleeInBag = generateWeapon('melee');
  __bowInBag = generateBow();
  __p.weapons.push(__meleeInBag);
  __p.bows.push(__bowInBag);
`);
check('меч в сумке сравнивается с надетым мечом, не с луком',
  run('__p.slotOccupantFor({ kind: "weapon", item: __meleeInBag }) === __p.weapon'));
check('лук в сумке сравнивается с надетым луком',
  run('__p.slotOccupantFor({ kind: "weapon", item: __bowInBag }) === __p.bow'));

run(`
  __helm = generateArmor('helm');
  __p.gearInventory.push(__helm);
  __wornHelm = generateArmor('helm');
  __p.equipment.helm = __wornHelm;
`);
check('шлем сравнивается с надетым шлемом',
  run('__p.slotOccupantFor({ kind: "gear", item: __helm }) === __wornHelm'));

run('__p.equipment.helm = null;');
check('пустой слот даёт null (а не undefined) — карточка покажет чистую прибавку',
  run('__p.slotOccupantFor({ kind: "gear", item: __helm })') === null);

// Accessories: with every slot full, the target is the one the equip click
// would displace — pickAccessoryTargetSlot's "least combat value" rule, not
// slot 1 and not the lowest blended score.
run(`
  __acc = generateAccessory();
  __p.gearInventory.push(__acc);
  for (const slot of __p.accessorySlots) __p.equipment[slot] = generateAccessory();
  // Make one slot unambiguously the weakest on the combat axes.
  __weakSlot = __p.accessorySlots[__p.accessorySlots.length - 1];
  __p.equipment[__weakSlot] = { ...generateAccessory(), mods: { ...emptyEquipMods(), goldFind: 0.3 } };
  for (const slot of __p.accessorySlots) {
    if (slot !== __weakSlot) __p.equipment[slot] = { ...generateAccessory(), mods: { ...emptyEquipMods(), damageBonus: 0.12 } };
  }
  __target = __p.slotOccupantFor({ kind: 'gear', item: __acc });
`);
check('аксессуар сравнивается именно с тем, который вытеснит (самый слабый по бою)',
  run('__target === __p.equipment[__weakSlot]'),
  { target: run('__target && __target.label'), weak: run('__p.equipment[__weakSlot].label') });

// And that really is the slot the equip would use — the promise the card
// makes has to match what the click does.
run(`
  __before = __p.equipment[__weakSlot];
  __p.manualEquipGear(__acc);
  __after = __p.equipment[__weakSlot];
`);
check('клик «надеть» действительно занимает тот же слот, что показала карточка',
  run('__after === __acc && __before !== __after'),
  { after: run('__after && __after.name'), acc: run('__acc.name') });

// --- Type labels ---------------------------------------------------------
check('тип оружия ближнего боя подписан «Оружие»', run('describeWeaponKind(STARTING_WEAPON)') === 'Оружие');
check('тип лука подписан «Лук»', run('describeWeaponKind(STARTING_BOW)') === 'Лук');
check('тип шлема подписан «Шлем»', run('describeGearKind(generateArmor("helm"))') === 'Шлем');
check('тип нагрудника подписан «Нагрудник»', run('describeGearKind(generateArmor("chest"))') === 'Нагрудник');
check('тип аксессуара подписан «Аксессуар»', run('describeGearKind(generateAccessory())') === 'Аксессуар');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
