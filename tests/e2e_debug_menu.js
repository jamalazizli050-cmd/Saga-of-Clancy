// Browser check of the new title-screen test menu: real mouse clicks,
// starting from a genuinely cold title screen (no Game.* shortcuts used to
// get there).
const { chromium } = require('playwright');

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`OK   ${label}`);
  else { failures++; console.log(`FAIL ${label}  ${detail !== undefined ? JSON.stringify(detail) : ''}`); }
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('http://localhost:8793/index.html');
  await page.waitForTimeout(1000);

  const onTitle = await page.evaluate(() => Game.state === 'title');
  check('старт: игра на титульном экране', onTitle);

  // --- Открыть тест-меню настоящим кликом ---
  await page.click('#btn-title-debug');
  await page.waitForTimeout(150);
  const panelOpen = await page.evaluate(() => !document.getElementById('debug-overlay').classList.contains('hidden'));
  check('клик по «Тест-меню» открывает панель', panelOpen);

  const buttonCount = await page.evaluate(() => document.querySelectorAll('.debug-btn').length);
  check('в панели 6 кнопок боссов + 7 кнопок комнат', buttonCount === 13, buttonCount);

  // --- Клик по боссу ---
  await page.click('[data-debug-boss="vetomo"]');
  await page.waitForTimeout(300);
  const afterBoss = await page.evaluate(() => ({
    state: Game.state, bishopKey: Game.boss && Game.boss.bishopKey,
    hudBossVisible: !document.getElementById('boss-bar-wrap').classList.contains('hidden'),
    hudVisible: !document.getElementById('hud').classList.contains('hidden'),
    titleHidden: document.getElementById('title-screen').classList.contains('hidden'),
    panelClosed: document.getElementById('debug-overlay').classList.contains('hidden'),
  }));
  check('клик по «Ветомо» сразу бросает в бой с ней', afterBoss.state === 'boss' && afterBoss.bishopKey === 'vetomo', afterBoss);
  check('HUD и полоса босса показаны, титульный экран скрыт, панель закрылась',
    afterBoss.hudVisible && afterBoss.hudBossVisible && afterBoss.titleHidden && afterBoss.panelClosed, afterBoss);

  // Бой реально играбелен: можно бить.
  const hpBefore = await page.evaluate(() => Game.boss.hp);
  await page.evaluate(() => { Game.player.x = Game.boss.x - 10; Game.player.attackCooldownTimer = 0; Input.justPressed.Mouse0 = true; });
  await page.waitForTimeout(200);
  const hpAfter = await page.evaluate(() => Game.boss.hp);
  check('бой реально играбелен — удар мечом наносит урон', hpAfter < hpBefore, { hpBefore, hpAfter });

  // --- Вернуться на титульный экран и протестировать комнату ---
  await page.evaluate(() => { Game.enterTitle(); HUD.setTitleScreen(buildTitleScreenOpts()); });
  await page.waitForTimeout(200);
  await page.click('#btn-title-debug');
  await page.waitForTimeout(150);
  await page.click('[data-debug-room="elite"]');
  await page.waitForTimeout(300);
  const afterRoom = await page.evaluate(() => ({
    state: Game.state, kind: Game.room.kind,
    elites: Game.enemies.filter((e) => e.elite).length,
    banner: Game.roomBanner && Game.roomBanner.label,
  }));
  check('клик по «Элита» входит именно в элитную комнату', afterRoom.state === 'run' && afterRoom.kind === 'elite', afterRoom);
  check('в комнате настоящий чемпион и баннер «ЭЛИТА»', afterRoom.elites === 1 && afterRoom.banner === 'ЭЛИТА', afterRoom);

  await page.screenshot({ path: 'debug_menu_elite.png' });

  // --- Комната с испытанием, вариант считывается корректно ---
  await page.evaluate(() => { Game.enterTitle(); HUD.setTitleScreen(buildTitleScreenOpts()); });
  await page.waitForTimeout(200);
  await page.click('#btn-title-debug');
  await page.waitForTimeout(150);
  await page.click('[data-debug-room="challenge"][data-debug-challenge="waves"]');
  await page.waitForTimeout(300);
  const afterWaves = await page.evaluate(() => ({
    state: Game.state, challenge: Game.roomChain[0].challenge, pendingWaves: Game.pendingWaves,
  }));
  check('кнопка «Испытание: волны» ставит именно этот вариант', afterWaves.challenge === 'waves' && afterWaves.pendingWaves === 1, afterWaves);

  // --- Закрытие панели по кнопке «Закрыть» без выбора ---
  await page.evaluate(() => { Game.enterTitle(); HUD.setTitleScreen(buildTitleScreenOpts()); });
  await page.waitForTimeout(200);
  await page.click('#btn-title-debug');
  await page.waitForTimeout(150);
  await page.click('#btn-debug-close');
  await page.waitForTimeout(150);
  const afterClose = await page.evaluate(() => ({
    panelHidden: document.getElementById('debug-overlay').classList.contains('hidden'),
    state: Game.state,
  }));
  check('«Закрыть» прячет панель без входа в игру', afterClose.panelHidden && afterClose.state === 'title', afterClose);

  console.log('\nCONSOLE ERRORS:', errors.length ? JSON.stringify(errors) : 'нет');
  if (errors.length) failures++;
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
})();
