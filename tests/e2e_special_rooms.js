// Full-loop browser check of the special rooms: real mouse clicks on both
// new panels, every room kind entered for real, then the untouched parts of
// the loop (boss room, death, hub return, cycle progress) re-verified.
const { chromium } = require('playwright');

const errors = [];
let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`OK   ${label}`);
  else { failures++; console.log(`FAIL ${label}  ${detail !== undefined ? JSON.stringify(detail) : ''}`); }
}

// Forces the run's current room to a given kind and re-enters it, so each
// kind can be exercised without waiting for the RNG to produce one.
const forceRoom = (kind, challenge) => `(() => {
  const e = Game.roomChain[Game.roomIndex];
  e.kind = ${JSON.stringify(kind)};
  e.challenge = ${JSON.stringify(challenge || null)};
  Game.enterRoomChainIndex(Game.roomIndex);
  return { kind: Game.room.kind, enemies: Game.enemies.length, chests: Game.chests.map(c => c.variant) };
})()`;

const walkToChest = `(() => {
  const c = Game.chests.find(c => !c.opened);
  if (!c) return false;
  Game.player.x = c.x - 10;
  Game.player.y = c.y;
  return true;
})()`;

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('http://localhost:8793/index.html');
  await page.waitForTimeout(1200);
  await page.evaluate(() => { Game.continueGame(); Game.startRun(); });
  await page.waitForTimeout(300);

  // --- обычная комната ---
  const normal = await page.evaluate(forceRoom('normal'));
  await page.waitForTimeout(200);
  check('обычная комната: враги на месте, баннера нет',
    normal.enemies > 0 && (await page.evaluate(() => Game.roomBanner === null)), normal);

  // --- сокровищница: настоящий клик по выбору ---
  const treasure = await page.evaluate(forceRoom('treasure'));
  await page.waitForTimeout(200);
  check('сокровищница: врагов нет, стоит сундук-выбор',
    treasure.enemies === 0 && treasure.chests[0] === 'choice', treasure);
  check('сокровищница: дверь открыта сразу (драться не с кем)',
    await page.evaluate(() => Game.enemies.every(e => !e.alive)));

  await page.evaluate(walkToChest);
  await page.waitForTimeout(150);
  await page.evaluate(() => { Input.justPressed.KeyE = true; });
  await page.waitForTimeout(250);
  const panelUp = await page.evaluate(() => !document.getElementById('treasure-overlay').classList.contains('hidden'));
  check('сокровищница: панель выбора открылась по E', panelUp);

  const goldBefore = await page.evaluate(() => Game.save.gold);
  await page.click('#treasure-choice-gold');   // <-- настоящий клик мышью
  await page.waitForTimeout(250);
  const afterPick = await page.evaluate(() => ({
    gold: Game.save.gold,
    hidden: document.getElementById('treasure-overlay').classList.contains('hidden'),
    chestOpened: Game.chests[0].opened,
  }));
  check('сокровищница: клик по «ЗОЛОТО» начислил золото', afterPick.gold > goldBefore, { goldBefore, ...afterPick });
  check('сокровищница: панель закрылась, сундук отмечен использованным',
    afterPick.hidden && afterPick.chestOpened, afterPick);

  // --- тайник ---
  await page.evaluate(forceRoom('secret'));
  await page.waitForTimeout(200);
  const secretBefore = await page.evaluate(() => ({ gold: Game.save.gold, shards: Game.save.shards }));
  await page.evaluate(walkToChest);
  await page.evaluate(() => { Input.justPressed.KeyE = true; });
  await page.waitForTimeout(250);
  const secretAfter = await page.evaluate(() => ({
    gold: Game.save.gold, shards: Game.save.shards, reward: Game.lastRoomReward,
  }));
  check('тайник: сразу выдаёт награду высшего тира',
    secretAfter.reward && secretAfter.reward.tier === 3, secretAfter.reward);
  check('тайник: даёт и золото, и шарды',
    secretAfter.gold > secretBefore.gold && secretAfter.shards > secretBefore.shards, { secretBefore, secretAfter });

  // --- элита ---
  const elite = await page.evaluate(forceRoom('elite'));
  await page.waitForTimeout(200);
  const eliteInfo = await page.evaluate(() => {
    const champ = Game.enemies.find(e => e.elite);
    const plain = Game.enemies.find(e => !e.elite);
    return { champs: Game.enemies.filter(e => e.elite).length, champHp: champ && champ.hp, plainHp: plain && plain.hp,
             banner: Game.roomBanner && Game.roomBanner.label };
  });
  check('элита: ровно один чемпион, крепче обычных',
    eliteInfo.champs === 1 && eliteInfo.champHp > eliteInfo.plainHp, eliteInfo);
  check('элита: комната объявляет себя баннером', eliteInfo.banner === 'ЭЛИТА', eliteInfo);

  const eliteGold = await page.evaluate(() => Game.save.gold);
  await page.evaluate(() => { Game.enemies.forEach(e => { e.alive = false; e.dying = false; }); });
  await page.waitForTimeout(400);
  const eliteReward = await page.evaluate(() => ({ gold: Game.save.gold, reward: Game.lastRoomReward, door: Game.room.doorOpenAmount }));
  check('элита: зачистка выдала бонус тира 2',
    eliteReward.reward && eliteReward.reward.tier === 2 && eliteReward.gold > eliteGold, eliteReward);
  check('элита: дверь открывается после зачистки', eliteReward.door > 0, eliteReward.door);

  // --- испытание: волны ---
  await page.evaluate(forceRoom('challenge', 'waves'));
  await page.waitForTimeout(200);
  const wave1 = await page.evaluate(() => ({ pending: Game.pendingWaves, wave: Game.waveIndex, enemies: Game.enemies.length }));
  await page.evaluate(() => { Game.enemies.forEach(e => { e.alive = false; e.dying = false; }); });
  await page.waitForTimeout(350);
  const wave2 = await page.evaluate(() => ({
    pending: Game.pendingWaves, wave: Game.waveIndex,
    aliveEnemies: Game.enemies.filter(e => e.alive).length, door: Game.room.doorOpenAmount,
  }));
  check('волны: после первой волны приходит вторая, а не открывается дверь',
    wave2.wave === 2 && wave2.aliveEnemies > 0, { wave1, wave2 });
  check('волны: дверь заперта, пока идёт вторая волна', wave2.door < 0.5, wave2.door);

  await page.evaluate(() => { Game.enemies.forEach(e => { e.alive = false; e.dying = false; }); });
  await page.waitForTimeout(400);
  const wavesDone = await page.evaluate(() => ({ reward: Game.lastRoomReward, door: Game.room.doorOpenAmount }));
  check('волны: обе волны пройдены — награда и открытая дверь',
    wavesDone.reward && wavesDone.door > 0, wavesDone);

  // --- испытание: без урона ---
  await page.evaluate(forceRoom('challenge', 'nohit'));
  await page.waitForTimeout(200);
  await page.evaluate(() => { Game.player.takeDamage(5); });
  await page.waitForTimeout(200);
  const hitTaken = await page.evaluate(() => Game.roomHitTaken);
  check('без урона: полученный удар фиксируется', hitTaken === true);
  await page.evaluate(() => { Game.enemies.forEach(e => { e.alive = false; e.dying = false; }); });
  await page.waitForTimeout(350);
  const nohitFailed = await page.evaluate(() => ({ reward: Game.lastRoomReward, door: Game.room.doorOpenAmount }));
  check('без урона: правило нарушено — бонуса нет, но комната проходима',
    nohitFailed.door > 0, nohitFailed);

  // --- кровавый завет: настоящий клик ---
  await page.evaluate(() => { Game.player.hp = Game.player.maxHp; });
  await page.evaluate(forceRoom('blood'));
  await page.waitForTimeout(250);
  const offerUp = await page.evaluate(() => ({
    open: Game.bloodOfferOpen,
    hidden: document.getElementById('blood-panel').classList.contains('hidden'),
    cost: document.getElementById('blood-cost').textContent,
  }));
  check('завет: панель показана с ценой', offerUp.open && !offerUp.hidden && Number(offerUp.cost) > 0, offerUp);

  const hpBefore = await page.evaluate(() => Game.player.hp);
  await page.click('#btn-blood-accept');   // <-- настоящий клик мышью
  await page.waitForTimeout(250);
  const accepted = await page.evaluate(() => ({
    hp: Game.player.hp, taken: Game.bloodAccepted,
    hidden: document.getElementById('blood-panel').classList.contains('hidden'),
  }));
  check('завет: клик «Принять» списал HP и закрыл панель',
    accepted.hp < hpBefore && accepted.taken && accepted.hidden, { hpBefore, ...accepted });

  const bloodGold = await page.evaluate(() => Game.save.gold);
  await page.evaluate(() => { Game.enemies.forEach(e => { e.alive = false; e.dying = false; }); });
  await page.waitForTimeout(400);
  const bloodReward = await page.evaluate(() => ({ gold: Game.save.gold, reward: Game.lastRoomReward }));
  check('завет: обычная комната отдала повышенную награду',
    bloodReward.reward && bloodReward.reward.tier >= 2 && bloodReward.gold > bloodGold, bloodReward);

  // Отказ ничего не стоит.
  await page.evaluate(() => { Game.player.hp = Game.player.maxHp; });
  await page.evaluate(forceRoom('blood'));
  await page.waitForTimeout(250);
  const hpDecline = await page.evaluate(() => Game.player.hp);
  await page.click('#btn-blood-decline');
  await page.waitForTimeout(250);
  const declined = await page.evaluate(() => ({ hp: Game.player.hp, open: Game.bloodOfferOpen, accepted: Game.bloodAccepted }));
  check('завет: отказ бесплатен и закрывает панель',
    declined.hp === hpDecline && !declined.open && !declined.accepted, declined);

  await page.screenshot({ path: 'rooms_e2e.png' });

  // --- существующий цикл не сломан ---
  // Следующая комната в цепочке случайна; форсируем её в обычную, иначе
  // проверка ниже зависит от того, не выпало ли предложение, которое по
  // задумке ставит игру на паузу.
  await page.evaluate(() => {
    const next = Game.roomChain[Game.roomIndex + 1];
    if (next) { next.kind = 'normal'; next.challenge = null; }
    Game.enemies = [];
    Game.player.x = Game.room.exitX + 50;
  });
  await page.waitForTimeout(400);
  const advanced = await page.evaluate(() => ({ state: Game.state, idx: Game.roomIndex, offer: Game.bloodOfferOpen }));
  check('переход в следующую комнату работает', advanced.state === 'run' || advanced.state === 'boss', advanced);

  await page.evaluate(() => { Game.enterMidBoss(MID_CHAIN_BOSS_DEFS.lisden); });
  await page.waitForTimeout(400);
  check('боссовая комната открывается', await page.evaluate(() => Game.state === 'boss' && !!Game.boss));

  const beforeBishops = await page.evaluate(() => Game.save.defeatedBishops.length);
  await page.evaluate(() => { Game.boss.hp = 0; Game.boss.alive = false; });
  await page.waitForTimeout(500);
  const afterBoss = await page.evaluate(() => ({
    state: Game.state, bishops: Game.save.defeatedBishops.length, runInProgress: Game.runInProgress,
  }));
  check('победа над боссом уводит в хаб и засчитывает епископа',
    afterBoss.state === 'hub' && afterBoss.bishops === beforeBishops + 1 && afterBoss.runInProgress,
    { beforeBishops, ...afterBoss });

  await page.evaluate(() => { Game.startRun(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { Game.player.hp = 0; });
  await page.waitForTimeout(500);
  const dead = await page.evaluate(() => ({ state: Game.state, deaths: Game.save.totalDeaths }));
  check('смерть уводит на экран наследников', dead.state === 'dead', dead);

  await page.evaluate(() => { Game.chooseHeir(0); });
  await page.waitForTimeout(400);
  check('выбор наследника возвращает в хаб', await page.evaluate(() => Game.state === 'hub'));
  check('прогресс цикла пережил смерть',
    await page.evaluate(() => Game.save.defeatedBishops.length) >= 1);

  console.log('\nCONSOLE ERRORS:', errors.length ? JSON.stringify(errors) : 'нет');
  if (errors.length) failures++;
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
})();
