// Heir candidates offered on the death screen. Each is just a numeric stat
// profile applied to a fresh Player — no unique perks, per the MVP scope.
// Names are shuffled from a flavor pool each death so the offering feels
// different every time, even though the three tradeoff profiles are fixed.

const HEIR_PROFILES = [
  { hpMul: 1.2, speedMul: 0.85, label: '+20% HP / −15% скорость' },
  { hpMul: 0.85, speedMul: 1.2, label: '−15% HP / +20% скорость' },
  { hpMul: 1.0, speedMul: 1.0, label: 'без отклонений' },
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

function rollHeirs() {
  const names = [...HEIR_NAME_POOL].sort(() => Math.random() - 0.5);
  return HEIR_PROFILES.map((profile, i) => ({
    name: names[i],
    hpMul: profile.hpMul,
    speedMul: profile.speedMul,
    label: profile.label,
    skinId: randInt(1, HEIR_SKIN_COUNT),
  }));
}
