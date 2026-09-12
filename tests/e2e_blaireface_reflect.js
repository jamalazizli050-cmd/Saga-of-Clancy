// Full-loop browser check of Blairface's arrow reflection, plus the
// untouched parts of the finale fight around it: phase transition, melee,
// death, and boss->win routing.
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
  await page.waitForTimeout(1200);

  await page.evaluate(() => {
    Game.continueGame();
    Game.startRun();
    Game.enterMirrorFight();
    Game.player.x = Game.boss.x - 260;
    Game.player.y = Game.boss.y;
    Game.player.facing = 1;
    // Force-equip a bow so RMB fires real Arrows through the real input path.
    const bow = { id: 'e2e-bow', name: 'E2E лук', noun: 'лук', type: 'ranged', damage: 20, cooldown: 0.3, range: 78, color: '#c9b98a' };
    Game.player.bows.push(bow);
    Game.player.bowIndex = Game.player.bows.length - 1;
    Game.player.arrows = 20;
  });
  await page.waitForTimeout(300);

  const start = await page.evaluate(() => ({ phase: Game.boss.phase, state: Game.state, name: Game.boss.name }));
  check('вход в финал: Зеркало, фаза 1', start.phase === 1 && start.state === 'boss', start);

  // --- Фаза 1: стрела наносит обычный урон ---
  const hpBefore1 = await page.evaluate(() => Game.boss.hp);
  await page.evaluate(() => { Game.player.bowCooldownTimer = 0; Input.justPressed.Mouse2 = true; });
  await page.waitForTimeout(1200); // время долететь через 260 юнитов
  const afterShot1 = await page.evaluate(() => ({ hp: Game.boss.hp, projectiles: Game.projectiles.length }));
  check('фаза 1: стрела реально долетает и наносит урон Зеркалу (как раньше)',
    afterShot1.hp < hpBefore1, { hpBefore1, afterShot1 });

  // --- Форсируем фазу 2, не трогая остальную логику через реальный API ---
  await page.evaluate(() => {
    Game.boss.hp = 0;
    Game.boss.onDepleted();
  });
  await page.waitForTimeout(50);
  const transforming = await page.evaluate(() => ({ transforming: Game.boss.transforming, alive: Game.boss.alive }));
  check('исчерпание фазы 1 запускает трансформацию, а не смерть', transforming.transforming && transforming.alive, transforming);

  await page.waitForTimeout(2200); // MIRROR_TRANSFORM_DURATION = 1.6s
  const phase2 = await page.evaluate(() => ({ phase: Game.boss.phase, name: Game.boss.name, hp: Game.boss.hp, maxHp: Game.boss.maxHp }));
  check('переход в фазу 2 завершился, имя сменилось на Блэрифейс', phase2.phase === 2 && phase2.name === 'Блэрифейс', phase2);

  // --- Фаза 2: настоящий выстрел через реальный ввод (ПКМ), проверяем отражение ---
  await page.evaluate(() => {
    Game.player.x = Game.boss.x - 260;
    Game.player.hp = Game.player.maxHp;
    Game.projectiles = [];
  });
  const hpBefore2 = await page.evaluate(() => Game.boss.hp);
  await page.evaluate(() => { Game.player.bowCooldownTimer = 0; Input.justPressed.Mouse2 = true; });

  // Наблюдаем полёт стрелы кадр за кадром — она должна долететь до босса,
  // не пропасть, и сменить владельца на 'enemy'.
  let sawReflected = false;
  let sawPlayerHit = false;
  for (let i = 0; i < 40 && !sawPlayerHit; i++) {
    await page.waitForTimeout(60);
    const s = await page.evaluate(() => {
      const a = Game.projectiles[0];
      return a ? { owner: a.owner, x: a.x, alive: a.alive, color: a.color } : null;
      });
    if (s && s.owner === 'enemy') sawReflected = true;
    const playerHp = await page.evaluate(() => Game.player.hp);
    if (playerHp < (await page.evaluate(() => Game.player.maxHp))) sawPlayerHit = true;
  }
  const afterReflect = await page.evaluate(() => ({ bossHp: Game.boss.hp, playerHp: Game.player.hp, playerMaxHp: Game.player.maxHp }));
  check('фаза 2: стрела помечена как отражённая ("enemy") хоть раз за полёт', sawReflected);
  check('фаза 2: Блэрифейс НЕ потеряла HP от отражённой стрелы', afterReflect.bossHp === hpBefore2, { hpBefore2, ...afterReflect });
  check('фаза 2: отражённая стрела реально долетела и ударила игрока', sawPlayerHit && afterReflect.playerHp < afterReflect.playerMaxHp, afterReflect);

  await page.screenshot({ path: 'blaireface_reflect.png' });

  // --- Melee продолжает работать в фазе 2 ---
  await page.evaluate(() => {
    Game.player.x = Game.boss.x - 20;
    Game.player.facing = 1;
  });
  const hpBeforeMelee = await page.evaluate(() => Game.boss.hp);
  await page.evaluate(() => { Game.player.attackCooldownTimer = 0; Input.justPressed.Mouse0 = true; });
  await page.waitForTimeout(200);
  const afterMelee = await page.evaluate(() => Game.boss.hp);
  check('фаза 2: ЛКМ (меч) продолжает наносить нормальный урон', afterMelee < hpBeforeMelee, { hpBeforeMelee, afterMelee });

  // --- Смерть Блэрифейс и возврат ---
  await page.evaluate(() => { Game.boss.hp = 0; Game.boss.onDepleted(); });
  await page.waitForTimeout(400);
  const afterDeath = await page.evaluate(() => ({ alive: Game.boss ? Game.boss.alive : null, state: Game.state }));
  check('смерть фазы 2 окончательна (без второй трансформации)', afterDeath.alive === false, afterDeath);

  await page.waitForTimeout(500);
  const finalState = await page.evaluate(() => Game.state);
  check('победа над Блэрифейс уводит из боя (переход на экран победы/цикла)', finalState !== 'boss', finalState);

  console.log('\nCONSOLE ERRORS:', errors.length ? JSON.stringify(errors) : 'нет');
  if (errors.length) failures++;
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
})();
