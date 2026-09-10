// Archetype hook constants. Read from three other files at the moment each
// hook actually fires (player.js's dash/takeDamage, main.js's resolveAttack,
// game.js's heal()) — all deferred, function-body reads, so it doesn't
// matter that heirs.js itself loads after player.js in index.html (same
// pattern enemy.js's Bat already relies on for GRAVITY/JUMP_VELOCITY, which
// load even later, in world.js). They're declared HERE, right next to the
// archetype table below that also reads them (at its own top-level, which
// DOES run immediately — so these must come first in this file specifically).
const BERSERKER_MELEE_BONUS = 0.18; // +18% melee damage...
const BERSERKER_MIN_NEARBY = 2; // ...while >= 2 enemies are alive near the swing
const BERSERKER_RADIUS = 130 * WORLD_SCALE;

const HUNTER_BOW_BONUS = 0.20; // +20% arrow damage
const HUNTER_MELEE_PENALTY = 0.12; // -12% melee damage — noticeable, never a lockout

const RUNNER_DASH_COOLDOWN_MUL = 0.65; // dash ready ~35% sooner
const RUNNER_DASH_IFRAME = 0.18; // s of bonus invulnerability, granted at dash-start

const EXECUTIONER_LOW_HP_FRACTION = 0.3; // at or below 30% hp...
const EXECUTIONER_LOW_HP_BONUS = 0.35; // ...+35% damage
const EXECUTIONER_FULL_HP_FRACTION = 0.85; // at or above 85% hp...
const EXECUTIONER_FULL_HP_PENALTY = 0.12; // ...-12% damage

const SURVIVOR_DAMAGE_REDUCTION = 0.08; // extra incoming-damage mitigation, stacked multiplicatively after gear
const SURVIVOR_HEAL_MUL = 0.7; // every heal in the game (bandage/hub rest/treasure pick) is 30% weaker

// Heir candidates offered on the death screen. Each carries the same
// hp/speed profile the game always had (still the ONE thing Game.currentMaxHp()
// and the Player constructor read), plus exactly ONE behavior hook — an
// archetype identity, not just a bigger/smaller number. `key` is what those
// hooks (player.js's dash/takeDamage, main.js's resolveAttack, game.js's
// heal()) switch on; everywhere else in the game keeps reading hpMul/
// speedMul/label exactly as before, so nothing outside this file and the
// small set of hooks below needed to change shape.
//
// Each archetype is deliberately ONE decision, not a kit:
//   - Berserker: melee-only bonus vs 2+ nearby enemies — fight packs head-on
//     instead of pulling one at a time. No effect on bosses (Game.enemies is
//     empty during a boss fight), so it's purely a trash-room read.
//   - Hunter: bow damage up, melee damage down — keep range instead of
//     closing in; melee stays usable (a -12% penalty, not a lockout), so it
//     never "breaks" melee, per the request.
//   - Runner: cheaper dash + a brief dash-triggered invulnerability window —
//     dash INTO/THROUGH a telegraphed hit instead of tanking or retreating.
//     Directly changes how Reysdro's lie/commit window, Vetomo's counter,
//     Sakarver's lunge, and Keons' chases are played.
//   - Executioner: bonus damage finishing a badly-hurt target, a penalty
//     opening on a fresh one — bait damage early, burst late. Reads target
//     HP fraction, so it applies identically to trash, Elite champions, and
//     bosses — rewards committing to a kill over spreading damage around.
//   - Survivor: flatter incoming damage, but every heal in the game (bandage,
//     hub rest, treasure room's "heal" pick) works for less. The interesting
//     synergy: Blood Pact (which SPENDS hp for reward) recovers slower for
//     this heir specifically — not because Blood Pact itself changed, but
//     because healing off that self-inflicted cost now costs more turns of
//     play. Nothing about the room needed touching for that to fall out.
//
// None of these touch Echo, the prestige tree, or any special-room's own
// numbers (blood cost, treasure amounts, elite/challenge reward tiers) —
// deliberately: a heir that made one of those rooms trivially better (or
// worse) would remove the actual decision that room exists to offer, for
// as long as that heir is alive. The two archetypes that DO touch a special
// room (Executioner vs Elite champions, Survivor vs Blood Pact) only ever
// change how good the PLAYER's own follow-through is, never the room's own
// terms — the choice to enter a Blood room or fight the champion is exactly
// as real for them as for anyone else.
const HEIR_ARCHETYPES = [
  {
    key: null, // handled as "no archetype" by every hook below — see the
    // explicit `null` default they all fall back to; a legacy save's
    // activeHeir (pre-this-feature) has no `key` field at all, which reads
    // as undefined and therefore also matches none of them, same effect.
    hpMul: 1.0, speedMul: 1.0,
    label: 'без отклонений',
    styleLabel: 'Универсал',
    bonusLabel: 'Без пассивки — чистые статы',
    drawbackLabel: 'Ничем не выделяется',
  },
  {
    key: 'berserker',
    hpMul: 0.9, speedMul: 1.0,
    label: '-10% HP',
    styleLabel: 'Ближний бой · толпы',
    bonusLabel: `+${Math.round(BERSERKER_MELEE_BONUS * 100)}% урон меча, когда рядом ≥${BERSERKER_MIN_NEARBY} врага`,
    drawbackLabel: '-10% максимум HP',
  },
  {
    key: 'hunter',
    hpMul: 1.0, speedMul: 1.0,
    label: 'без отклонений',
    styleLabel: 'Дальний бой',
    bonusLabel: `+${Math.round(HUNTER_BOW_BONUS * 100)}% урон стрел`,
    drawbackLabel: `-${Math.round(HUNTER_MELEE_PENALTY * 100)}% урон меча`,
  },
  {
    key: 'runner',
    hpMul: 0.92, speedMul: 1.15,
    label: '-8% HP / +15% скорость',
    styleLabel: 'Мобильность · уклонение',
    bonusLabel: 'Рывок короче на треть и даёт миг неуязвимости',
    drawbackLabel: '-8% максимум HP',
  },
  {
    key: 'executioner',
    hpMul: 1.0, speedMul: 1.0,
    label: 'без отклонений',
    styleLabel: 'Добивание',
    bonusLabel: `+${Math.round(EXECUTIONER_LOW_HP_BONUS * 100)}% урон по врагам ≤${Math.round(EXECUTIONER_LOW_HP_FRACTION * 100)}% HP`,
    drawbackLabel: `-${Math.round(EXECUTIONER_FULL_HP_PENALTY * 100)}% урон по целым (≥${Math.round(EXECUTIONER_FULL_HP_FRACTION * 100)}%) врагам`,
  },
  {
    key: 'survivor',
    hpMul: 1.15, speedMul: 0.92,
    label: '+15% HP / -8% скорость',
    styleLabel: 'Живучесть',
    bonusLabel: `+${Math.round(SURVIVOR_DAMAGE_REDUCTION * 100)}% доп. снижение входящего урона`,
    drawbackLabel: `Лечение (перевязка, отдых, находки) на ${Math.round((1 - SURVIVOR_HEAL_MUL) * 100)}% слабее`,
  },
];

const HEIR_NAME_POOL = [
  'Ловчий', 'Скиталец', 'Тень Демы', 'Беглянка', 'Дозорный',
  'Пепельный', 'Молчун', 'Бродяга', 'Настороженный', 'Отступник',
];

// 12 pre-drawn character designs (assets/sprites/heirs/heir_01.png ..
// heir_12.png, + a _mirrored twin of each for facing left — see
// Player.draw()). Purely cosmetic: skinId never touches stats. Rolled
// independently per candidate, so two of the three cards on a single death
// screen can end up with the same face — that's fine, nothing keys off
// uniqueness anywhere.
const HEIR_SKIN_COUNT = 12;

// Offers 3 of the 5 archetypes each time (shuffled, not "always these 3") —
// pool > offer count is new here specifically so which THREE playstyles are
// on the table varies death to death, on top of the name/face already doing
// that. Every archetype (including the plain "без отклонений" one, which is
// deliberately still in the pool — the baseline stays a valid, honest pick,
// not a trap option) is equally likely to appear.
function rollHeirs() {
  const names = [...HEIR_NAME_POOL].sort(() => Math.random() - 0.5);
  const archetypes = [...HEIR_ARCHETYPES].sort(() => Math.random() - 0.5).slice(0, 3);
  return archetypes.map((profile, i) => ({
    name: names[i],
    key: profile.key,
    hpMul: profile.hpMul,
    speedMul: profile.speedMul,
    label: profile.label,
    styleLabel: profile.styleLabel,
    bonusLabel: profile.bonusLabel,
    drawbackLabel: profile.drawbackLabel,
    skinId: randInt(1, HEIR_SKIN_COUNT),
  }));
}
