// Room kinds — the "what makes this room different" table.
//
// A kind is ONE field (`kind`) on a chain entry, rolled once in
// generateRoomChain() and then read by exactly three places:
//   - spawnEnemiesForRoom()   — what fills the room
//   - enterRoomChainIndex()   — what per-room state it needs
//   - render()                — how it announces itself
// Everything else about a room (layout template, biome, chests, exit door,
// camera, physics) is untouched, so a special room IS a normal room with one
// field set. That's deliberate: there is no parallel "special room" system to
// keep in sync with the normal one, the same way `biome` is just a field that
// changes what the existing renderer paints.

// Weights are relative, not percentages — rollRoomKind() normalizes. Note
// that roughly a quarter of a chain never reaches this roll at all: the five
// Bishop gate rooms and the run's first room are forced normal (see
// generateRoomChain). So the normal weight here is deliberately lower than
// the target share — measured end to end, a run lands near 73% normal, which
// is where the brief asked for it.
const ROOM_KINDS = {
  normal: { weight: 58 },

  treasure: {
    weight: 11,
    label: 'СОКРОВИЩНИЦА',
    sub: 'Ни одного врага. Возьми одно.',
    symbol: '◇',
    color: '#d1b13c',
  },

  elite: {
    weight: 7,
    label: 'ЭЛИТА',
    sub: 'Среди них — усиленный. Награда за зачистку выше.',
    symbol: '✦',
    color: '#b2453f',
  },

  challenge: {
    weight: 7,
    label: 'ИСПЫТАНИЕ',
    symbol: '⚔',
    color: '#6fa3b8',
  },

  blood: {
    weight: 4,
    label: 'КРОВАВЫЙ ЗАВЕТ',
    sub: 'Отдать кровь за долю добычи?',
    symbol: '†',
    color: '#b2453f',
  },

  secret: {
    weight: 3,
    label: 'ТАЙНИК',
    sub: 'Сюда давно никто не спускался.',
    symbol: '✧',
    color: '#b58ac9',
  },
};

// The two challenge variants. Both are deliberately built from mechanics the
// game already has — no new movement rules, no separate game mode:
//   - nohit: the room is a normal fight; the bonus is forfeited the moment
//     the player's HP drops. Pure bookkeeping over the existing fight.
//   - waves: the SAME enemy spawn points fire twice, the second set arriving
//     once the first is down. Reuses spawnEnemiesForRoom wholesale.
const CHALLENGE_VARIANTS = {
  nohit: {
    label: 'ИСПЫТАНИЕ · БЕЗ УРОНА',
    sub: 'Зачисти комнату, не получив ни одного удара.',
    status: 'БЕЗ УРОНА',
  },
  waves: {
    label: 'ИСПЫТАНИЕ · ВОЛНЫ',
    sub: 'Двумя волнами. Дверь откроется только после второй.',
    status: 'ВОЛНА',
  },
};

const CHALLENGE_WAVE_COUNT = 2;

// How long a room's name stays on screen after entry. Long enough to read
// while walking in, short enough that it's gone before the first fight.
const ROOM_BANNER_DURATION = 3.2; // s

// Reward tiers for clearing a room. Numbers are set against the game's own
// baseline: a chest is 15-35 gold, a trash kill 5-12, and a full traversal
// runs 1000-1500 gold total (see game.js's economy notes). Special rooms are
// ~a third of a run, so these are sized to enrich a run noticeably without
// making the normal chest/trash economy irrelevant — and the rooms that pay
// tier 2+ either cost the player a real fight (elite) or a real resource
// (blood), rather than handing it over for walking in.
const ROOM_REWARD_TIERS = {
  1: { goldMin: 45, goldMax: 80, arrows: 3, gear: false },
  2: { goldMin: 70, goldMax: 110, arrows: 4, gear: true },
  3: { goldMin: 90, goldMax: 140, arrows: 6, gear: true, rare: true, shards: 2 },
};

// Blood covenant: a percentage of MAX hp, not a flat 25, so it stays a real
// decision at 161 max HP (the fully-upgraded ceiling) instead of decaying
// into a rounding error. Never offered when it would leave the player on the
// edge of death — a covenant that can kill you outright isn't a choice.
const BLOOD_COST_FRACTION = 0.25;
const BLOOD_MIN_HP_FRACTION = 0.4; // must be above this to be offered at all

function bloodCovenantCost(player) {
  return Math.max(1, Math.round(player.maxHp * BLOOD_COST_FRACTION));
}

function canOfferBloodCovenant(player) {
  return player.hp > player.maxHp * BLOOD_MIN_HP_FRACTION;
}

// Treasure room's "choose one". Four options that are genuinely
// non-comparable rather than four sizes of the same thing:
//   - gold is fungible but only spendable back at the hub;
//   - arrows are worth more than their gold price (a bundle is 8/150) but
//     only if you actually shoot;
//   - healing is unbuyable mid-segment at any price, which is exactly when
//     you need it;
//   - an item is the only one that can change how the rest of the run plays.
// None of them dominates, which is the point — see the balance notes in the
// task: the player should be choosing, not pressing the obvious button.
const TREASURE_CHOICES = [
  { id: 'gold', title: 'ЗОЛОТО', detail: '+110 золота', hint: 'Тратится только в хабе' },
  { id: 'arrows', title: 'СТРЕЛЫ', detail: '+14 стрел', hint: 'У продавца это 8 за 150' },
  { id: 'heal', title: 'ПЕРЕВЯЗКА', detail: '+45% HP', hint: 'До хаба другого лечения нет' },
  { id: 'item', title: 'СНАРЯЖЕНИЕ', detail: 'Оружие, лук или броня', hint: 'Единственное, что меняет забег' },
];

const TREASURE_GOLD = 110;
const TREASURE_ARROWS = 14;
const TREASURE_HEAL_FRACTION = 0.45;

// Elite: a champion among ordinary trash, not one ordinary enemy with a
// bloated HP bar. The stat bump is only half of it — enemy.js also widens
// the elite's aggro range and chase speed, so it closes distance and commits
// in a way a normal one doesn't, and draws a marker so it reads on sight.
const ELITE_STAT_MUL = 2.1;

// Rolls a kind for one chain entry. `forceNormal` covers the two positions
// that must stay predictable: the room that gates a Bishop (a special room
// there would muddle the boss transition) and the very first room of a run.
function rollRoomKind(forceNormal) {
  if (forceNormal) return 'normal';
  const entries = Object.entries(ROOM_KINDS);
  const total = entries.reduce((sum, [, def]) => sum + def.weight, 0);
  let roll = Math.random() * total;
  for (const [kind, def] of entries) {
    roll -= def.weight;
    if (roll < 0) return kind;
  }
  return 'normal';
}

function rollChallengeVariant() {
  const keys = Object.keys(CHALLENGE_VARIANTS);
  return keys[randInt(0, keys.length - 1)];
}

// The banner text a room announces itself with on entry. Challenge rooms
// resolve through their variant so the player learns the RULE, not just that
// something is different.
function roomKindBanner(entry) {
  const def = ROOM_KINDS[entry.kind];
  if (!def || !def.label) return null;
  if (entry.kind === 'challenge') {
    const variant = CHALLENGE_VARIANTS[entry.challenge];
    return { label: variant.label, sub: variant.sub, symbol: def.symbol, color: def.color };
  }
  return { label: def.label, sub: def.sub, symbol: def.symbol, color: def.color };
}

// Rooms with no fight in them at all — the door is already open on arrival,
// and spawnEnemiesForRoom returns nothing.
function isPeacefulRoom(kind) {
  return kind === 'treasure' || kind === 'secret';
}
