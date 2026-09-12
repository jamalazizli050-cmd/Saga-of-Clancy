// The victory transition is held for the length of a Bishop's death animation
// (BOSS_DEATH_DURATION in boss.js) so the kill is actually seen instead of
// being cut straight to a screen. That hold introduces a window that didn't
// exist before — one where the boss is dead but the fight hasn't resolved —
// and this suite covers what must stay true inside it. Browser-only: the hold
// lives in main.js's update loop, which the Node harness doesn't run.
const { chromium } = require('playwright');

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`OK   ${label}`);
  else { failures++; console.log(`FAIL ${label}  ${detail !== undefined ? JSON.stringify(detail) : ''}`); }
}

async function enterBossFight(page, key) {
  await page.evaluate(() => { Game.enterTitle(); HUD.setTitleScreen(buildTitleScreenOpts()); });
  await page.waitForTimeout(200);
  await page.click('#btn-title-debug');
  await page.waitForTimeout(150);
  await page.click(`[data-debug-boss="${key}"]`);
  await page.waitForTimeout(350);
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('http://localhost:8793/index.html');
  await page.waitForTimeout(600);

  // --- The hold itself ----------------------------------------------------
  await enterBossFight(page, 'vetomo');
  await page.evaluate(() => { Game.boss.takeDamage(999999); });
  await page.waitForTimeout(250);

  const during = await page.evaluate(() => ({
    state: Game.state, alive: Game.boss.alive, dying: Game.boss.dying,
    progress: Game.boss.deathProgress(),
  }));
  check('во время анимации бой ещё не завершён (экран победы придержан)',
    during.state === 'boss' && during.alive === false && during.dying === true, during);
  check('анимация реально идёт', during.progress > 0 && during.progress < 1, during.progress);

  await page.waitForTimeout(1300);
  const after = await page.evaluate(() => ({ state: Game.state }));
  check('после анимации бой завершается сам', after.state !== 'boss', after);

  // --- Взаимное убийство: победа, а не смерть ----------------------------
  //
  // Раньше это работало само собой — ветка босса делала return в том же
  // кадре. С придержанной анимацией случай стало возможно проиграть, если
  // не проверять его явно.
  await enterBossFight(page, 'vetomo');
  await page.evaluate(() => {
    Game.boss.takeDamage(999999);   // босс падает
    Game.player.hp = 0;             // и игрок в том же кадре
  });
  await page.waitForTimeout(400);
  const mutualDuring = await page.evaluate(() => Game.state);
  check('взаимное убийство: смерть игрока не срабатывает во время анимации',
    mutualDuring === 'boss', mutualDuring);

  await page.waitForTimeout(1300);
  const mutualAfter = await page.evaluate(() => Game.state);
  check('взаимное убийство засчитывается как победа, а не как смерть',
    mutualAfter !== 'boss' && mutualAfter !== 'death', mutualAfter);

  // --- Долетающая стрела не отнимает победу ------------------------------
  //
  // У Сакарвера есть стрелы, поэтому проверяем именно на нём.
  await enterBossFight(page, 'sakarver');
  const arrowCase = await page.evaluate(async () => {
    // Вражеская стрела в воздухе ровно в момент смерти босса.
    const a = new Arrow(Game.player.x - 60, Game.player.y + 10, 1, 9999, WEAPON_RANGE_MAX, '#fff');
    a.owner = 'enemy';
    Game.projectiles.push(a);
    const hpBefore = Game.player.hp;
    Game.boss.takeDamage(999999);
    await new Promise((r) => setTimeout(r, 500));
    return {
      hpBefore, hpAfter: Game.player.hp,
      enemyArrows: Game.projectiles.filter((p) => p.owner === 'enemy').length,
      state: Game.state,
    };
  });
  check('вражеские стрелы вычищаются, когда босс упал',
    arrowCase.enemyArrows === 0, arrowCase);
  check('долетающая стрела не наносит урон во время анимации смерти',
    arrowCase.hpAfter === arrowCase.hpBefore, arrowCase);

  // --- Награда выдаётся ровно один раз ------------------------------------
  //
  // Ветка держится много кадров подряд — если бы onBossDefeated() вызывался
  // внутри неё, награда начислялась бы каждый кадр.
  await enterBossFight(page, 'keons');
  const reward = await page.evaluate(async () => {
    let calls = 0;
    const orig = Game.onBossDefeated.bind(Game);
    Game.onBossDefeated = () => { calls += 1; return orig(); };
    const goldBefore = Game.save.gold;
    Game.boss.takeDamage(999999);
    await new Promise((r) => setTimeout(r, 2000));
    Game.onBossDefeated = orig;
    return { calls, goldBefore, goldAfter: Game.save.gold };
  });
  check('onBossDefeated() вызывается ровно один раз за всю анимацию',
    reward.calls === 1, reward);
  check('золото за босса начислено', reward.goldAfter > reward.goldBefore, reward);

  console.log('\nCONSOLE ERRORS:', errors.length ? JSON.stringify(errors) : 'нет');
  if (errors.length) failures++;
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
})();
