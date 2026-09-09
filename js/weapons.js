// Procedural weapon generation. Every weapon (chest loot, boss drops later)
// is built by splitting a fixed stat "budget" across the speed/damage/range
// triangle, so nothing is ever great at everything — a weapon that leans
// hard into one axis necessarily gives up the other two.

// Sane floors/ceilings per stat so a 0%-weighted axis still lands on a
// noticeably-but-not-absurdly weak value (never 0 damage or an instant hit).
const WEAPON_DAMAGE_MIN = 6;
const WEAPON_DAMAGE_MAX = 28;
const WEAPON_COOLDOWN_MIN = 0.18; // s — fastest possible roll
const WEAPON_COOLDOWN_MAX = 0.65; // s — slowest possible roll
const WEAPON_RANGE_MIN = 22 * WORLD_SCALE;
const WEAPON_RANGE_MAX = 78 * WORLD_SCALE;

function lerp(min, max, t) {
  return min + (max - min) * t;
}

// Total stat budget shared across the three axes. It is deliberately > 1:
// with a budget of exactly 1 the best possible roll still lost to a weapon
// built from the per-axis midpoints (which is what STARTING_WEAPON used to
// be), so every chest weapon was a downgrade and the whole procedural
// system was decorative. At 1.25 the even split lands exactly on the
// starting cleaver, so a drop is a coin-flip upgrade rather than a
// guaranteed disappointment — and the corners stay sane because each axis
// still clamps at its own max.
const WEAPON_BUDGET = 1.25;

// Samples a uniformly random point on the 3-way simplex, then scales it to
// the budget. Weights are clamped to 1 individually, so pushing everything
// into one axis wastes the overflow instead of exceeding that axis's cap —
// which is what keeps a max-damage roll from also being max-speed.
function rollStatWeights() {
  const raw = [-Math.log(Math.random()), -Math.log(Math.random()), -Math.log(Math.random())];
  const total = raw[0] + raw[1] + raw[2];
  return {
    damageWeight: Math.min(1, (raw[0] / total) * WEAPON_BUDGET),
    speedWeight: Math.min(1, (raw[1] / total) * WEAPON_BUDGET),
    rangeWeight: Math.min(1, (raw[2] / total) * WEAPON_BUDGET),
  };
}

function dominantAxis(w) {
  if (w.damageWeight >= w.speedWeight && w.damageWeight >= w.rangeWeight) return 'damage';
  if (w.speedWeight >= w.rangeWeight) return 'speed';
  return 'range';
}

const WEAPON_COLOR_BY_AXIS = {
  damage: '#8a5a4a',
  speed: '#c9b98a',
  range: '#6b7a8a',
};

const ADJ_NEUTRAL = ['Ржавый', 'Зазубренный', 'Костяной', 'Обугленный', 'Мрачный', 'Погнутый', 'Треснутый'];
const ADJ_HEAVY = ['Тяжёлый', 'Массивный', 'Грузный', 'Громоздкий'];
const ADJ_LIGHT = ['Быстрый', 'Лёгкий', 'Проворный', 'Гибкий'];
const WEAPON_NOUNS = ['тесак', 'серп', 'молот', 'кинжал', 'топор', 'коса'];

// Soft bias, not a hard rule: neutral adjectives are always in the running,
// heavy/light ones just get extra copies mixed in when a roll leans hard
// toward one end of the speed axis.
function pickAdjective(weights) {
  const pool = [...ADJ_NEUTRAL, ...ADJ_NEUTRAL];
  if (weights.speedWeight > 0.5) pool.push(...ADJ_LIGHT, ...ADJ_LIGHT);
  else if (weights.speedWeight < 0.15) pool.push(...ADJ_HEAVY, ...ADJ_HEAVY);
  return pool[randInt(0, pool.length - 1)];
}

function generateWeaponName(weights, noun) {
  const adjective = pickAdjective(weights);
  return `${adjective} ${noun}`;
}

// Rough DPS-ish ranking, used only to compare rolls against each other
// (see Game.applyPrestigeStartingGear). Range is worth much less than the
// damage/speed product, but not nothing — reach is what lets you connect.
function weaponScore(w) {
  return (w.damage / w.cooldown) + w.range * 0.05;
}

// Because weaponScore is a ratio (damage/cooldown), its achievable range
// under rollStatWeights() isn't a simple interval the way a single lerp'd
// armor stat is — pushing damageWeight to 1 costs speedWeight budget, so the
// true ceiling sits well below "max damage / min cooldown independently".
// This threshold was derived empirically (200k-sample Monte Carlo of
// generateWeapon()+weaponScore(), see scratchpad/sim_weapon.js from the
// inventory/scrapper work): ~82nd percentile, i.e. roughly the top 18% of
// rolls — inside the "top ~15-20%" band the scrapper's rare-item bonus
// should apply to. Adjust after balance testing if drops feel mis-tiered.
const WEAPON_RARE_SCORE_THRESHOLD = 48.5;

function isRareWeapon(w) {
  return weaponScore(w) >= WEAPON_RARE_SCORE_THRESHOLD;
}

// Full multi-line tooltip text for the inventory/scrapper grid, mirroring
// equipment.js's describeItemFull() for gear.
function describeWeaponFull(w) {
  return `${w.name}\nУрон ${w.damage} · КД ${w.cooldown}с · Дистанция ${Math.round(w.range)}\n${isRareWeapon(w) ? 'Редкое' : 'Обычное'}`;
}

let weaponUid = 0;

function generateWeapon() {
  const weights = rollStatWeights();
  const damage = Math.round(lerp(WEAPON_DAMAGE_MIN, WEAPON_DAMAGE_MAX, weights.damageWeight));
  // Inverted vs. the other two axes: a higher speed weight means a LOWER
  // (faster) cooldown, so it maps toward MIN instead of MAX.
  const cooldown = Math.round(lerp(WEAPON_COOLDOWN_MAX, WEAPON_COOLDOWN_MIN, weights.speedWeight) * 100) / 100;
  const range = Math.round(lerp(WEAPON_RANGE_MIN, WEAPON_RANGE_MAX, weights.rangeWeight));
  // Rolled once here (rather than re-derived from the name string later) so
  // the inventory icon picker (see icons.js) has an exact, locale-independent
  // key instead of having to parse it back out of the Russian display name.
  const noun = WEAPON_NOUNS[randInt(0, WEAPON_NOUNS.length - 1)];

  weaponUid += 1;
  return {
    id: `gen-${weaponUid}`,
    name: generateWeaponName(weights, noun),
    noun,
    damage,
    cooldown,
    range,
    color: WEAPON_COLOR_BY_AXIS[dominantAxis(weights)],
  };
}

// The one fixed, guaranteed item every run starts with: an even three-way
// split of the SAME budget the generator rolls against, so it sits exactly
// at the median of what loot can produce. It used to be built from the
// per-axis midpoints instead, which put it outside the reachable roll space
// entirely and made ~98% of generated weapons a straight downgrade.
const STARTING_WEAPON_WEIGHT = WEAPON_BUDGET / 3;
const STARTING_WEAPON = {
  id: 'starting-cleaver',
  name: 'Ржавый тесак',
  noun: 'тесак',
  damage: Math.round(lerp(WEAPON_DAMAGE_MIN, WEAPON_DAMAGE_MAX, STARTING_WEAPON_WEIGHT)),
  cooldown: Math.round(lerp(WEAPON_COOLDOWN_MAX, WEAPON_COOLDOWN_MIN, STARTING_WEAPON_WEIGHT) * 100) / 100,
  range: Math.round(lerp(WEAPON_RANGE_MIN, WEAPON_RANGE_MAX, STARTING_WEAPON_WEIGHT)),
  color: '#8a7f6b',
};
