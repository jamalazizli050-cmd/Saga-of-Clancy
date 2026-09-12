// Procedural armour + accessories, built the same way weapons are (weapons.js):
// a rolled stat budget rather than a hand-written item list.
//
// Everything an item does lives in its `mods` object, and every mod key is
// summed across all equipped slots by Player.recomputeEquipmentMods(). That
// uniform shape is the whole point — adding a new mod key later means
// touching the roll tables and the one place that consumes it, never the
// equip/aggregate plumbing.
//
// All bonuses are PASSIVE. Nothing here grants an activated ability.

// acc4 exists in the slot list from the start but is only *assignable* once
// the prestige upgrade unlocks it (see Player.accessorySlots). Aggregating
// over a null slot is a no-op, so nothing else needs to know about the gate.
const EQUIP_SLOTS = ['helm', 'chest', 'acc1', 'acc2', 'acc3', 'acc4'];
const ACCESSORY_SLOTS = ['acc1', 'acc2', 'acc3', 'acc4'];
const BASE_ACCESSORY_SLOT_COUNT = 3;

// Every mod key that can appear on an item. Kept as a flat list so the
// aggregate starts from a known-complete zeroed object instead of relying on
// whatever keys happen to be present on the equipped items.
const EQUIP_MOD_KEYS = [
  'damageReduction', // fraction of incoming damage removed
  'bonusHp',         // flat max-HP added
  'speedBonus',      // fraction added to move/dash speed
  'cooldownReduction', // fraction removed from every cooldown
  'damageBonus',     // fraction added to outgoing damage
  'goldFind',        // fraction added to all gold pickups
];

// Hard ceiling on stacked damage reduction. The current roll tables top out
// around 38% with a perfect set, so this is headroom rather than an active
// constraint — but it guarantees no future mod pool can make the player
// immortal by stacking a sixth DR source.
const EQUIP_MAX_DAMAGE_REDUCTION = 0.55;

function emptyEquipMods() {
  const mods = {};
  for (const key of EQUIP_MOD_KEYS) mods[key] = 0;
  return mods;
}

// --- Armour (helm / chest) ---------------------------------------------
// Two-axis budget: a piece is either flat-HP-heavy or mitigation-heavy, and
// the split is what varies. Helms roll a slightly smaller budget than chest
// pieces so the two slots aren't interchangeable.
const ARMOR_DR_MIN = 0.02;
const ARMOR_DR_MAX = 0.10;
const ARMOR_HP_MIN = 4;
const ARMOR_HP_MAX = 20;
const HELM_BUDGET_SCALE = 0.75;

const ARMOR_ADJECTIVES = ['Латаный', 'Кованый', 'Ржавый', 'Обугленный', 'Треснутый', 'Тяжёлый', 'Костяной'];
const ARMOR_NOUNS = { helm: ['шлем', 'капюшон', 'маска'], chest: ['нагрудник', 'кираса', 'жилет'] };
const ARMOR_COLORS = { helm: '#7a8496', chest: '#6b7a8a' };

// --- Accessories -------------------------------------------------------
// One rolled affix each, from a pool of six. Deliberately smaller numbers
// than armour: three accessory slots means these stack three ways.
const ACCESSORY_AFFIXES = [
  { key: 'speedBonus', min: 0.04, max: 0.12, noun: 'сапоги', label: (v) => `+${Math.round(v * 100)}% скорость` },
  { key: 'goldFind', min: 0.10, max: 0.30, noun: 'печать', label: (v) => `+${Math.round(v * 100)}% золото` },
  { key: 'cooldownReduction', min: 0.03, max: 0.09, noun: 'кольцо', label: (v) => `-${Math.round(v * 100)}% кулдауны` },
  { key: 'damageBonus', min: 0.04, max: 0.12, noun: 'клеймо', label: (v) => `+${Math.round(v * 100)}% урон` },
  { key: 'bonusHp', min: 5, max: 20, noun: 'оберег', label: (v) => `+${Math.round(v)} HP` },
  { key: 'damageReduction', min: 0.02, max: 0.06, noun: 'пластина', label: (v) => `-${Math.round(v * 100)}% вх. урон` },
];

const ACCESSORY_ADJECTIVES = ['Тусклый', 'Витой', 'Щербатый', 'Позеленевший', 'Стёртый', 'Холодный', 'Немой'];
const ACCESSORY_COLOR = '#8a7f6b';

let equipUid = 0;

// A single comparable number per item, used only to decide auto-equip
// (see Player.equipItem) — no balance logic depends on it, so the weights
// just need to rank items sensibly, not model true DPS/EHP.
function itemScore(item) {
  const m = item.mods;
  return (
    m.damageReduction * 300 +
    m.bonusHp * 1.0 +
    m.speedBonus * 120 +
    m.cooldownReduction * 200 +
    m.damageBonus * 200 +
    m.goldFind * 40
  );
}

// Auto-equip decides on TWO axes only: outgoing damage and incoming-damage
// mitigation. A drop replaces what's worn if it beats the current piece on
// either one — not on the blended itemScore above, which used to let a big
// pile of HP/gold-find outweigh a straight defensive or offensive gain and
// leave the better combat piece sitting unequipped in the bag.
//
// Everything else an item can roll (HP, speed, cooldowns, gold find) is
// deliberately NOT part of this: those are preference, and the player weighs
// them by hand in the inventory screen. Nothing is ever lost either way — the
// displaced piece goes straight back to the bag (see equipFromInventory).
function isCombatUpgrade(candidate, current) {
  if (!current) return true;
  return candidate.mods.damageBonus > current.mods.damageBonus
    || candidate.mods.damageReduction > current.mods.damageReduction;
}

// How much a piece contributes to those same two axes, as one number. Used
// only to choose WHICH filled accessory slot a candidate is measured against
// (the one contributing least to damage/defence), so a new combat accessory
// displaces the gold-find trinket rather than whichever slot happens to be
// weakest by the blended score.
function combatValue(item) {
  return item.mods.damageBonus * 200 + item.mods.damageReduction * 300;
}

function generateArmor(slotType) {
  const scale = slotType === 'helm' ? HELM_BUDGET_SCALE : 1;
  // Single weight splits the budget: 0 = all mitigation, 1 = all flat HP.
  const t = Math.random();
  const mods = emptyEquipMods();
  mods.damageReduction = lerp(ARMOR_DR_MAX, ARMOR_DR_MIN, t) * scale;
  mods.bonusHp = Math.round(lerp(ARMOR_HP_MIN, ARMOR_HP_MAX, t) * scale);

  equipUid += 1;
  const nouns = ARMOR_NOUNS[slotType];
  return {
    id: `equip-${equipUid}`,
    slotType,
    name: `${ARMOR_ADJECTIVES[randInt(0, ARMOR_ADJECTIVES.length - 1)]} ${nouns[randInt(0, nouns.length - 1)]}`,
    mods,
    color: ARMOR_COLORS[slotType],
    label: `-${Math.round(mods.damageReduction * 100)}% вх. урон, +${mods.bonusHp} HP`,
  };
}

function generateAccessory() {
  const affix = ACCESSORY_AFFIXES[randInt(0, ACCESSORY_AFFIXES.length - 1)];
  const rolled = lerp(affix.min, affix.max, Math.random());
  const value = affix.key === 'bonusHp' ? Math.round(rolled) : Math.round(rolled * 1000) / 1000;

  const mods = emptyEquipMods();
  mods[affix.key] = value;

  equipUid += 1;
  return {
    id: `equip-${equipUid}`,
    slotType: 'accessory',
    name: `${ACCESSORY_ADJECTIVES[randInt(0, ACCESSORY_ADJECTIVES.length - 1)]} ${affix.noun}`,
    mods,
    color: ACCESSORY_COLOR,
    label: affix.label(value),
  };
}

// Used by chests (Game.openChest) and anywhere else that wants "some piece
// of gear, whatever it is".
function generateRandomGear() {
  const roll = Math.random();
  if (roll < 0.34) return generateArmor('chest');
  if (roll < 0.62) return generateArmor('helm');
  return generateAccessory();
}

// Short human-readable summary for the HUD's equipment panel.
function describeSlot(item) {
  if (!item) return '—';
  return `${item.name} (${item.label})`;
}

// The two endpoint scores an armor slot's 1D roll (t=0 all-mitigation,
// t=1 all-flat-HP) can land on, using the exact same weights itemScore()
// does. Unlike weapons' 3-way simplex, this roll is a single uniform t, so
// (unlike weaponScore, see weapons.js) the achievable score range really is
// just this interval — no simulation needed to find it.
function armorScoreBounds(slotType) {
  const scale = slotType === 'helm' ? HELM_BUDGET_SCALE : 1;
  const scoreAt = (t) => {
    const dr = lerp(ARMOR_DR_MAX, ARMOR_DR_MIN, t) * scale;
    const hp = Math.round(lerp(ARMOR_HP_MIN, ARMOR_HP_MAX, t) * scale);
    return dr * 300 + hp * 1.0;
  };
  const a = scoreAt(0);
  const b = scoreAt(1);
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

// Normalized 0..1 "how close to the best possible roll of its own kind is
// this item" — used by the scrapper (Game.scrapValue) to decide the
// rare-item shard bonus, and available to the inventory tooltip too.
// Accessories roll one affix uniformly on [min,max], so quality is just
// where in that range the roll landed. Armor is linear in its single roll
// parameter, so the true min/max are the two endpoints computed above.
function itemQuality(item) {
  if (item.slotType === 'accessory') {
    const key = EQUIP_MOD_KEYS.find((k) => item.mods[k] !== 0);
    const affix = ACCESSORY_AFFIXES.find((a) => a.key === key);
    if (!affix) return 0;
    return clamp((item.mods[key] - affix.min) / (affix.max - affix.min), 0, 1);
  }
  const { min, max } = armorScoreBounds(item.slotType);
  if (max === min) return 1;
  return clamp((itemScore(item) - min) / (max - min), 0, 1);
}

// Full multi-line tooltip text for the inventory grid (hover/click), as
// opposed to describeSlot()'s one-line HUD summary.
function describeItemFull(item) {
  const pct = Math.round(itemQuality(item) * 100);
  return `${item.name}\n${item.label}\nКачество: ${pct}%`;
}

// Human-readable kind, for the inventory card's type line. Weapons answer
// this from weapons.js's own `type` field instead — see describeWeaponKind().
const GEAR_KIND_LABELS = {
  helm: 'Шлем',
  chest: 'Нагрудник',
  accessory: 'Аксессуар',
};

function describeGearKind(item) {
  return GEAR_KIND_LABELS[item.slotType] || 'Снаряжение';
}

// How each mod reads in a comparison, and which direction is an improvement.
// Every gear mod stores its raw number so that HIGHER is always better — a
// damageReduction of 0.06 beats 0.02 — so the colour (dir) is a plain
// ascending comparison for all six.
//
// The displayed SIGN is a separate question for the two "reduction" stats.
// They're written on the item itself as a negative ("-6% вх. урон"), so
// reporting an improvement as "+2% вх. урон" would read as taking MORE
// damage, which is exactly backwards. `invertSign` flips only the printed
// sign for those two, leaving the colour keyed to the real direction.
const EQUIP_MOD_COMPARE = [
  { key: 'damageBonus', label: 'урон', pct: true },
  { key: 'damageReduction', label: 'вх. урон', pct: true, invertSign: true },
  { key: 'bonusHp', label: 'HP', pct: false },
  { key: 'cooldownReduction', label: 'кулдауны', pct: true, invertSign: true },
  { key: 'speedBonus', label: 'скорость', pct: true },
  { key: 'goldFind', label: 'золото', pct: false, pctValue: true },
];

// Stat-by-stat diff of `candidate` against whatever is currently in the slot
// it would go into. Returns [{ label, dir }] where dir is +1 better, -1 worse
// — the inventory card colors on `dir` and never re-derives the comparison
// itself (HUD stays a pure render layer).
//
// `current` null means the slot is empty: everything the candidate rolls is a
// straight gain, so every nonzero mod is reported as an improvement rather
// than the item being described as having no effect.
function compareGear(candidate, current) {
  const out = [];
  for (const { key, label, pct, pctValue, invertSign } of EQUIP_MOD_COMPARE) {
    const a = candidate.mods[key] || 0;
    const b = current ? (current.mods[key] || 0) : 0;
    const delta = a - b;
    if (Math.abs(delta) < 1e-9) continue;
    const shown = pct || pctValue ? `${Math.abs(Math.round(delta * 100))}%` : `${Math.abs(Math.round(delta))}`;
    const positive = invertSign ? delta < 0 : delta > 0;
    out.push({ label: `${positive ? '+' : '−'}${shown} ${label}`, dir: delta > 0 ? 1 : -1 });
  }
  return out;
}
