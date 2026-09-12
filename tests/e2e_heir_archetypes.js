// Browser check of the three archetype hooks that live in main.js's
// resolveAttack() (Berserker/Hunter/Executioner — not directly testable
// through the Node/vm harness, which deliberately skips main.js), plus a
// full death -> real-click archetype choice -> continue-the-cycle pass using
// the actual death screen, and the dev test-menu for fast setup per the
// task's own suggestion ("если есть dev room selector, используй его").
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

  // Sets Game.activeHeir.key BEFORE using the dev test-menu's own shortcut
  // (Game.debugTestRoom), so the fresh Player it builds carries that
  // archetype — same technique the Node suite uses, just through the real
  // browser Game object. Also normalizes the weapon to a fixed, known
  // damage so percentage differences read exactly off the HP numbers.
  const setup = (archetypeKey) => page.evaluate((key) => {
    Game.activeHeir = { name: 'Т', key, hpMul: 1, speedMul: 1, label: '', styleLabel: '', bonusLabel: '', drawbackLabel: '', skinId: 1 };
    Game.debugTestRoom('normal', null);
    Game.player.weapons = [{ id: 'fixed', name: 'fixed', noun: 'тесак', type: 'melee', damage: 100, cooldown: 0.3, range: 60, color: '#fff' }];
    Game.player.weaponIndex = 0;
    Game.player.bows = [{ id: 'fixed-bow', name: 'fixed-bow', noun: 'лук', type: 'ranged', damage: 100, cooldown: 0.3, range: 78, color: '#fff' }];
    Game.player.bowIndex = 0;
    Game.player.arrows = 20;
    Game.enemies = [];
    return Game.player.archetype;
  }, archetypeKey);

  // --- Berserker: melee bonus only when 2+ enemies are near the swing ---
  {
    const key = await setup('berserker');
    check('Player carries archetype "berserker" after setup', key === 'berserker');

    // Isolated target: alone, no bonus.
    const aloneResult = await page.evaluate(() => {
      const p = Game.player;
      const e = new GloriousGone(p.facing > 0 ? p.x + 40 : p.x - 40, p.y, 0, 3000, 1); e.update = () => {};
      e.hp = 100000; e.maxHp = 100000;
      Game.enemies = [e];
      const hpBefore = e.hp;
      Game.player.attackCooldownTimer = 0;
      Input.justPressed.Mouse0 = true;
      return { hpBefore, ex: e.x, ey: e.y };
    });
    await page.waitForTimeout(120);
    const aloneDamage = await page.evaluate((before) => before - Game.enemies[0].hp, aloneResult.hpBefore);
    check('Berserker alone vs a single target deals plain (unbonused) damage', Math.abs(aloneDamage - 100) < 1, aloneDamage);

    // Same setup, now with 2 more enemies standing close by.
    const crowdResult = await page.evaluate(() => {
      const p = Game.player;
      const target = new GloriousGone(p.facing > 0 ? p.x + 40 : p.x - 40, p.y, 0, 3000, 1); target.update = () => {};
      target.hp = 100000; target.maxHp = 100000;
      const bystander1 = new GloriousGone(p.x + 5, p.y, 0, 3000, 1); bystander1.update = () => {};
      const bystander2 = new GloriousGone(p.x - 5, p.y, 0, 3000, 1); bystander2.update = () => {};
      Game.enemies = [target, bystander1, bystander2];
      const hpBefore = target.hp;
      Game.player.attackCooldownTimer = 0;
      Input.justPressed.Mouse0 = true;
      return hpBefore;
    });
    await page.waitForTimeout(120);
    const crowdDamage = await page.evaluate((before) => before - Game.enemies[0].hp, crowdResult);
    check('Berserker surrounded by >=2 enemies deals MORE melee damage than alone',
      crowdDamage > aloneDamage, { aloneDamage, crowdDamage });
    check('...specifically the documented +18% bonus', Math.abs(crowdDamage - 118) < 1, crowdDamage);

    // Same crowd, but fired with the BOW — bonus must NOT apply to arrows.
    const bowResult = await page.evaluate(() => {
      const p = Game.player;
      const target = new GloriousGone(p.facing > 0 ? p.x + 60 : p.x - 60, p.y, 0, 3000, 1); target.update = () => {};
      target.hp = 100000; target.maxHp = 100000;
      const b1 = new GloriousGone(p.x + 5, p.y, 0, 3000, 1); b1.update = () => {};
      const b2 = new GloriousGone(p.x - 5, p.y, 0, 3000, 1); b2.update = () => {};
      Game.enemies = [target, b1, b2];
      Game.projectiles = [];
      Game.player.bowCooldownTimer = 0;
      Input.justPressed.Mouse2 = true;
      return target.hp;
    });
    await page.waitForTimeout(700);
    const bowDamage = await page.evaluate((before) => before - Game.enemies[0].hp, bowResult);
    check('Berserker\'s crowd bonus does NOT apply to bow shots (melee-only, per the design)',
      Math.abs(bowDamage - 100) < 1, bowDamage);
  }

  // --- Hunter: bow up, melee down ---
  {
    await setup('hunter');
    const meleeResult = await page.evaluate(() => {
      const p = Game.player;
      const e = new GloriousGone(p.facing > 0 ? p.x + 40 : p.x - 40, p.y, 0, 3000, 1); e.update = () => {};
      e.hp = 100000; e.maxHp = 100000;
      Game.enemies = [e];
      const hpBefore = e.hp;
      Game.player.attackCooldownTimer = 0;
      Input.justPressed.Mouse0 = true;
      return hpBefore;
    });
    await page.waitForTimeout(120);
    const meleeDamage = await page.evaluate((before) => before - Game.enemies[0].hp, meleeResult);
    check('Hunter melee deals LESS than the weapon\'s nominal 100 (the -12% penalty)',
      meleeDamage < 100, meleeDamage);
    check('...specifically the documented -12%', Math.abs(meleeDamage - 88) < 1, meleeDamage);

    const bowResult2 = await page.evaluate(() => {
      const p = Game.player;
      const e = new GloriousGone(p.facing > 0 ? p.x + 60 : p.x - 60, p.y, 0, 3000, 1); e.update = () => {};
      e.hp = 100000; e.maxHp = 100000;
      Game.enemies = [e];
      Game.projectiles = [];
      Game.player.bowCooldownTimer = 0;
      Input.justPressed.Mouse2 = true;
      return e.hp;
    });
    await page.waitForTimeout(700);
    const bowDamage2 = await page.evaluate((before) => before - Game.enemies[0].hp, bowResult2);
    check('Hunter bow deals MORE than the weapon\'s nominal 100 (the +20% bonus)', bowDamage2 > 100, bowDamage2);
    check('...specifically the documented +20%', Math.abs(bowDamage2 - 120) < 1, bowDamage2);
    check('Hunter\'s melee penalty leaves melee clearly still usable (not broken/zeroed)', meleeDamage > 50, meleeDamage);
  }

  // --- Executioner: bonus finishing a low-hp target, penalty on a fresh one ---
  {
    await setup('executioner');
    const lowHpResult = await page.evaluate(() => {
      const p = Game.player;
      const e = new GloriousGone(p.facing > 0 ? p.x + 40 : p.x - 40, p.y, 0, 3000, 1); e.update = () => {};
      e.maxHp = 100000; e.hp = e.maxHp * 0.2; // 20% — inside the "low hp" bonus band
      Game.enemies = [e];
      const hpBefore = e.hp;
      Game.player.attackCooldownTimer = 0;
      Input.justPressed.Mouse0 = true;
      return hpBefore;
    });
    await page.waitForTimeout(120);
    const lowHpDamage = await page.evaluate((before) => before - Game.enemies[0].hp, lowHpResult);
    check('Executioner deals MORE than nominal 100 to a badly-hurt target', lowHpDamage > 100, lowHpDamage);
    check('...specifically the documented +35%', Math.abs(lowHpDamage - 135) < 1, lowHpDamage);

    const fullHpResult = await page.evaluate(() => {
      const p = Game.player;
      const e = new GloriousGone(p.facing > 0 ? p.x + 40 : p.x - 40, p.y, 0, 3000, 1); e.update = () => {};
      e.maxHp = 100000; e.hp = e.maxHp; // 100% — inside the "fresh target" penalty band
      Game.enemies = [e];
      const hpBefore = e.hp;
      Game.player.attackCooldownTimer = 0;
      Input.justPressed.Mouse0 = true;
      return hpBefore;
    });
    await page.waitForTimeout(120);
    const fullHpDamage = await page.evaluate((before) => before - Game.enemies[0].hp, fullHpResult);
    check('Executioner deals LESS than nominal 100 to a full-hp target', fullHpDamage < 100, fullHpDamage);
    check('...specifically the documented -12%', Math.abs(fullHpDamage - 88) < 1, fullHpDamage);

    // Applies identically to an Elite champion.
    const eliteResult = await page.evaluate(() => {
      const e = Game.roomChain[Game.roomIndex];
      e.kind = 'elite'; e.challenge = null;
      Game.enterRoomChainIndex(Game.roomIndex);
      Game.player.weapons = [{ id: 'fixed', name: 'fixed', noun: 'тесак', type: 'melee', damage: 100, cooldown: 0.3, range: 200, color: '#fff' }];
      Game.player.weaponIndex = 0;
      const champ = Game.enemies.find((en) => en.elite);
      champ.hp = champ.maxHp * 0.15; // low-hp band
      Game.player.x = champ.x - 10;
      Game.player.facing = 1;
      const hpBefore = champ.hp;
      Game.player.attackCooldownTimer = 0;
      Input.justPressed.Mouse0 = true;
      return hpBefore;
    });
    await page.waitForTimeout(120);
    const eliteDamage = await page.evaluate((before) => {
      const champ = Game.enemies.find((en) => en.elite);
      return before - champ.hp;
    }, eliteResult);
    check('Executioner\'s low-hp bonus applies identically to an Elite champion', Math.abs(eliteDamage - 135) < 1, eliteDamage);

    // Applies to a boss too (Blairface, phase 2, where reflection does NOT
    // intercept melee — only arrows — so this cleanly isolates the hook).
    await page.evaluate(() => {
      Game.debugFightBoss('mirror');
      Game.boss.hp = 0;
      Game.boss.onDepleted();
    });
    await page.waitForTimeout(2200);
    const bossResult = await page.evaluate(() => {
      Game.player.weapons = [{ id: 'fixed', name: 'fixed', noun: 'тесак', type: 'melee', damage: 100, cooldown: 0.3, range: 400, color: '#fff' }];
      Game.player.weaponIndex = 0;
      // BossBase.takeDamage() clamps hp at a 0 floor (unlike GloriousGone's,
      // which the Elite check above relies on going negative) — scaling
      // maxHp/hp up here (rather than using her real, small phase-2 pool)
      // keeps the hit well clear of that floor, so "before - after" measures
      // the actual multiplier instead of getting truncated by the clamp.
      Game.boss.maxHp = 10000;
      Game.boss.hp = Game.boss.maxHp * 0.15;
      Game.player.x = Game.boss.x - 10;
      Game.player.facing = 1;
      const hpBefore = Game.boss.hp;
      Game.player.attackCooldownTimer = 0;
      Input.justPressed.Mouse0 = true;
      return { hpBefore, phase: Game.boss.phase };
    });
    await page.waitForTimeout(150);
    const bossDamage = await page.evaluate((before) => before - Game.boss.hp, bossResult.hpBefore);
    check('reached Blairface phase 2 for this check', bossResult.phase === 2, bossResult.phase);
    check('Executioner\'s low-hp bonus applies to a boss exactly like trash/elite', Math.abs(bossDamage - 135) < 1, bossDamage);
  }

  await page.screenshot({ path: 'heir_archetypes_combat.png' });

  // --- Full loop: real death, real click on an archetype card, continue ---
  {
    await page.evaluate(() => {
      Game.continueGame();
      Game.startRun();
      Game.player.hp = 0;
    });
    await page.waitForTimeout(300);
    const deathState = await page.evaluate(() => ({
      state: Game.state,
      cardCount: document.querySelectorAll('#heir-choices .heir-card').length,
      firstCardText: document.querySelector('#heir-choices .heir-card').innerText,
    }));
    check('death screen shows exactly 3 real heir cards', deathState.state === 'dead' && deathState.cardCount === 3, deathState);
    check('a card shows style/bonus/drawback text, not just the old hp/speed line',
      deathState.firstCardText.split('\n').length >= 4, deathState.firstCardText);

    const pickedKeyBefore = await page.evaluate(() => Game.pendingHeirs[0].key);
    await page.click('#heir-choices .heir-card:first-child'); // real mouse click
    await page.waitForTimeout(200);
    const afterPick = await page.evaluate(() => ({
      state: Game.state, activeKey: Game.activeHeir.key, playerArchetype: Game.player.archetype,
    }));
    check('clicking a card applies that exact archetype and returns to the hub',
      afterPick.state === 'hub' && afterPick.activeKey === pickedKeyBefore && afterPick.playerArchetype === pickedKeyBefore,
      { pickedKeyBefore, ...afterPick });

    // The chosen archetype must survive into the NEXT run, not just the hub.
    await page.evaluate(() => { Game.startRun(); });
    await page.waitForTimeout(200);
    const nextRun = await page.evaluate(() => Game.player.archetype);
    check('the chosen archetype carries into a fresh run afterward', nextRun === pickedKeyBefore, nextRun);
  }

  console.log('\nCONSOLE ERRORS:', errors.length ? JSON.stringify(errors) : 'нет');
  if (errors.length) failures++;
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
})();
