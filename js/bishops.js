// Canonical registry of every rotating Bishop boss (not the mirror-fight
// finale, which isn't one of these — see MirrorBoss). Used two ways:
//
// 1. Game.onBossDefeated() checks THIS ARRAY'S LENGTH against how many
//    distinct bishopKeys have been beaten so far this run, to know when the
//    player has just downed the last one and the finale should trigger —
//    so adding another createRoomN-style Bishop needs no change to that
//    check, just another entry here (confirmed when Lisden was added: the
//    finale automatically waited for all 3 with zero changes elsewhere).
// 2. NG+ rebirth (Game.renameBishopsForNewCycle in game.js) walks this list
//    to assign each one a new display name from the accumulated ancestor
//    pool (or a random fallback) after every completed cycle.
const BISHOP_REGISTRY = [
  { key: 'lisden', baseName: 'Лисден' },
  { key: 'sakarver', baseName: 'Сакарвер' },
  { key: 'reysdro', baseName: 'Рейсдро' },
  { key: 'vetomo', baseName: 'Ветомо' },
  { key: 'keons', baseName: 'Кеонс' },
];

// Picks `count` display names for a new cycle: real ancestor names (past
// cycle winners) first, shuffled so it's not always the same bishop that
// inherits the oldest name, then random fallbacks from heirs.js's name pool
// once the ancestor list runs short — exactly the "not enough ancestors yet"
// case the request calls out.
function pickBishopNames(count, ancestorNames) {
  const shuffled = [...ancestorNames].sort(() => Math.random() - 0.5);
  const names = [];
  for (let i = 0; i < count; i++) {
    names.push(i < shuffled.length ? shuffled[i] : HEIR_NAME_POOL[randInt(0, HEIR_NAME_POOL.length - 1)]);
  }
  return names;
}
