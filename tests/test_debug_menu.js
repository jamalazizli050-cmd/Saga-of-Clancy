// Game.debugFightBoss / Game.debugTestRoom — the two functions behind the
// new title-screen test menu. Verifies each shortcut actually reaches the
// right state, doesn't touch saved progress, and that a fresh player is
// always fully playable (HP, weapon, bow).
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

// --- 1. Каждый босс из меню реально доступен через debugFightBoss ---
const BOSS_KEYS = ['lisden', 'sakarver', 'reysdro', 'vetomo', 'keons'];
for (const key of BOSS_KEYS) {
  const before = { gold: run('Game.save.gold'), shards: run('Game.save.shards'), defeated: run('Game.save.defeatedBishops.length') };
  run(`Game.debugFightBoss(${JSON.stringify(key)})`);
  const after = {
    state: run('Game.state'), bossAlive: run('Game.boss.alive'), bishopKey: run('Game.boss.bishopKey'),
    playerHp: run('Game.player.hp'), playerMaxHp: run('Game.player.maxHp'),
    gold: run('Game.save.gold'), shards: run('Game.save.shards'), defeated: run('Game.save.defeatedBishops.length'),
  };
  check(`debugFightBoss('${key}') входит в бой с этим самым боссом`,
    after.state === 'boss' && after.bossAlive && after.bishopKey === key, after);
  check(`debugFightBoss('${key}') даёт игроку полное HP`, after.playerHp === after.playerMaxHp, after);
  check(`debugFightBoss('${key}') не трогает сохранение`,
    after.gold === before.gold && after.shards === before.shards && after.defeated === before.defeated,
    { before, after });
}

// --- 2. Финал (Зеркало -> Блэрифейс) ---
{
  run(`Game.debugFightBoss('mirror')`);
  const state = { state: run('Game.state'), phase: run('Game.boss.phase'), name: run('Game.boss.name'), finale: run('Game.isFinaleFight') };
  check("debugFightBoss('mirror') входит в бой с Зеркалом, фаза 1", state.state === 'boss' && state.phase === 1 && state.finale, state);
}

// --- 3. Каждый тип комнаты реально доступен через debugTestRoom ---
const ROOM_CASES = [
  ['normal', null], ['treasure', null], ['elite', null],
  ['challenge', 'nohit'], ['challenge', 'waves'], ['blood', null], ['secret', null],
];
for (const [kind, challenge] of ROOM_CASES) {
  run(`Game.debugTestRoom(${JSON.stringify(kind)}, ${JSON.stringify(challenge)})`);
  const info = {
    state: run('Game.state'),
    roomKind: run('Game.room.kind'),
    entryKind: run('Game.roomChain[0].kind'),
    entryChallenge: run('Game.roomChain[0].challenge'),
    enemies: run('Game.enemies.length'),
    playerHp: run('Game.player.hp'),
    arrows: run('Game.player.arrows'),
    bloodOffer: run('Game.bloodOfferOpen'),
  };
  const label = challenge ? `${kind}/${challenge}` : kind;
  check(`debugTestRoom('${label}') входит в комнату именно этого типа`,
    info.state === 'run' && info.roomKind === kind && info.entryKind === kind, info);
  if (kind === 'challenge') {
    check(`debugTestRoom('${label}') выставляет правильный вариант испытания`, info.entryChallenge === challenge, info);
  }
  if (kind === 'treasure' || kind === 'secret') {
    check(`debugTestRoom('${label}') — мирная комната без врагов`, info.enemies === 0, info);
  } else if (kind === 'blood') {
    check(`debugTestRoom('blood') сразу поднимает кровавое предложение (полное HP)`, info.bloodOffer === true, info);
  }
  check(`debugTestRoom('${label}') даёт игроку стрелы для теста лука`, info.arrows > 0, info.arrows);
}

// --- 4. Повторные вызовы не копят состояние старых комнат/боёв ---
{
  run(`Game.debugFightBoss('keons')`);
  run(`Game.debugTestRoom('treasure', null)`);
  const after = { boss: run('Game.boss'), state: run('Game.state'), bloodOffer: run('Game.bloodOfferOpen'), treasureOpen: run('Game.treasureChoiceOpen') };
  check('переход из боя в тест комнаты полностью сбрасывает boss', after.boss === null, after.boss);
  check('...и не тащит за собой состояние спец-комнат (clearRoomKindState через enterRoomChainIndex)',
    after.bloodOffer === false, after);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
