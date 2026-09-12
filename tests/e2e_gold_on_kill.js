// Regression test for a real bug found during the Sprint 1 collision audit
// (see HANDOFF.md): main.js's update() used to snapshot `wasAlive` for an
// enemy AFTER resolveAttack() had already run and killed it that same frame
// (melee at update()'s top, arrows in the projectile loop — both execute
// before the enemy loop that used to read wasAlive). That made wasAlive
// already false by the time it was read, so death gold was never granted
// for ANY player-caused kill, melee or ranged. This only reproduces in the
// browser: main.js's update() loop (unlike everything test_*.js exercises)
// isn't run by the Node harness — see tests/README.md.
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

  await page.goto('http://localhost:8793/index.html');
  await page.waitForTimeout(500);

  // --- Melee kill grants gold the same frame the enemy dies ---
  await page.click('#btn-title-debug');
  await page.waitForTimeout(150);
  await page.click('[data-debug-room="normal"]');
  await page.waitForTimeout(300);

  // deathGold is fixed at spawn (see Enemy's constructor) and Game.enemies
  // gets replaced wholesale the instant the room clears (see HANDOFF.md), so
  // the expected total has to be captured BEFORE the kill loop, not after.
  // Test-menu gear is randomized (see debug menu), so a goldFind roll can be
  // active — mirror addGold()'s per-call rounding, not a flat sum, or a
  // nonzero goldFind roll makes this flaky.
  const before = await page.evaluate(() => ({
    gold: Game.save.gold,
    expectedGold: Game.enemies.reduce(
      (sum, e) => sum + Math.round(e.deathGold * (1 + Game.player.equipMods.goldFind)), 0),
  }));

  let allGrantedAtClear = false;
  for (let i = 0; i < 60; i++) {
    await page.evaluate(() => {
      const e = Game.enemies.find((en) => en.alive);
      if (e) {
        Game.player.x = e.x - 5;
        Game.player.y = e.y;
        Game.player.attackCooldownTimer = 0;
        Input.justPressed.Mouse0 = true;
      }
    });
    await page.waitForTimeout(100);
    const state = await page.evaluate(() => ({
      allDead: Game.enemies.every((en) => !en.alive),
      allGranted: Game.enemies.every((en) => en.goldGranted),
    }));
    if (state.allDead) { allGrantedAtClear = state.allGranted; break; }
  }

  const goldAfterMelee = await page.evaluate(() => Game.save.gold);
  check('каждый убитый в ближнем бою враг получает goldGranted', allGrantedAtClear);
  check('золото за ближний бой начислено полностью и сразу',
    goldAfterMelee - before.gold === before.expectedGold,
    { gained: goldAfterMelee - before.gold, expected: before.expectedGold });

  // --- Arrow kill (the other resolveAttack() call site) also grants gold ---
  await page.evaluate(() => { Game.enterTitle(); HUD.setTitleScreen(buildTitleScreenOpts()); });
  await page.waitForTimeout(200);
  await page.click('#btn-title-debug');
  await page.waitForTimeout(150);
  await page.click('[data-debug-room="normal"]');
  await page.waitForTimeout(300);

  const beforeArrow = await page.evaluate(() => ({ gold: Game.save.gold }));

  await page.evaluate(() => {
    const e = Game.enemies.find((en) => en.alive);
    e.hp = 1; // guarantee a one-shot kill regardless of weapon roll
    const facing = e.x >= Game.player.x ? 1 : -1;
    Game.projectiles.push(new Arrow(
      facing === 1 ? e.x - 5 : e.x + e.w + 5,
      e.y + e.h / 2,
      facing, 999, WEAPON_RANGE_MAX, '#fff',
    ));
  });
  await page.waitForTimeout(300);

  const afterArrow = await page.evaluate(() => {
    const e = Game.enemies.find((en) => en.hp <= 0) || Game.enemies[0];
    return {
      gold: Game.save.gold, dead: !e.alive, goldGranted: e.goldGranted,
      expectedGold: Math.round(e.deathGold * (1 + Game.player.equipMods.goldFind)),
    };
  });
  check('враг, убитый стрелой, тоже мёртв', afterArrow.dead, afterArrow);
  check('стрела тоже начисляет золото (goldGranted, сумма сходится)',
    afterArrow.goldGranted && afterArrow.gold - beforeArrow.gold === afterArrow.expectedGold,
    { gained: afterArrow.gold - beforeArrow.gold, expected: afterArrow.expectedGold, afterArrow });

  console.log('\nCONSOLE ERRORS:', errors.length ? JSON.stringify(errors) : 'нет');
  if (errors.length) failures++;
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
})();
