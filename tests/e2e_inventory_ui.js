// Sprint 1 equipment-UI pass (HANDOFF item 7), in a real browser: the card
// actually renders with icon, name, type, stats, worn state and a colour-coded
// comparison, and the two sections read as one consistent component rather
// than two different ones. The comparison LOGIC is covered without a browser
// in test_inventory_ui.js; this is about the DOM the player sees.
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
  await page.waitForTimeout(600);
  await page.click('#btn-title-debug');
  await page.waitForTimeout(150);
  await page.click('[data-debug-room="normal"]');
  await page.waitForTimeout(400);

  // A bag stocked to hit every card state: strictly better, strictly worse,
  // identical, and a piece of gear for an empty slot.
  await page.evaluate(() => {
    const p = Game.player;
    const cur = p.weapon;
    p.weapons.push({ ...cur, id: 'test-better', name: 'Лучший тесак', damage: cur.damage + 9, cooldown: Math.max(0.18, cur.cooldown - 0.1), range: cur.range + 12 });
    p.weapons.push({ ...cur, id: 'test-worse', name: 'Худший тесак', damage: Math.max(1, cur.damage - 6), cooldown: cur.cooldown + 0.15, range: Math.max(10, cur.range - 10) });
    p.weapons.push({ ...cur, id: 'test-same', name: 'Такой же тесак' });
    p.equipment.helm = null;
    p.gearInventory.push(generateArmor('helm'));
  });

  await page.keyboard.press('KeyI');
  await page.waitForTimeout(300);

  const dom = await page.evaluate(() => {
    const read = (c) => ({
      name: c.querySelector('.item-name') && c.querySelector('.item-name').textContent,
      kind: c.querySelector('.item-kind') && c.querySelector('.item-kind').textContent,
      stats: c.querySelector('.item-extra') && c.querySelector('.item-extra').textContent,
      icon: !!c.querySelector('.item-icon svg'),
      worn: !!c.querySelector('.item-worn-badge'),
      cmp: [...c.querySelectorAll('.cmp')].map((e) => ({ cls: e.className, text: e.textContent })),
    });
    return {
      open: !document.getElementById('inventory-overlay').classList.contains('hidden'),
      worn: [...document.querySelectorAll('#inventory-slots .item-cell')].map(read),
      emptySlots: document.querySelectorAll('#inventory-slots .equip-slot-empty').length,
      bag: [...document.querySelectorAll('#inventory-grid .item-cell')].map(read),
    };
  });

  check('инвентарь открывается по I', dom.open);

  // --- Worn section: the same card component, marked as worn -------------
  check('надетое показано карточками (а не голой строкой)', dom.worn.length >= 2, dom.worn.length);
  check('каждая надетая вещь помечена бейджем НАДЕТО', dom.worn.every((c) => c.worn), dom.worn.map((c) => c.worn));
  check('у надетых карточек есть иконка, тип и статы',
    dom.worn.every((c) => c.icon && c.kind && c.stats), dom.worn);
  check('оружие и лук подписаны разными типами',
    dom.worn[0].kind === 'Оружие' && dom.worn[1].kind === 'Лук',
    dom.worn.map((c) => c.kind));
  check('пустые слоты по-прежнему видны как пустые', dom.emptySlots > 0, dom.emptySlots);
  check('надетые вещи не сравниваются сами с собой',
    dom.worn.every((c) => c.cmp.length === 0));

  // --- Bag section: same card + comparison -------------------------------
  const byName = (n) => dom.bag.find((c) => c.name === n);
  check('вещи в сумке показаны теми же карточками с иконкой/типом/статами',
    dom.bag.length > 0 && dom.bag.every((c) => c.icon && c.kind && c.stats), dom.bag.length);
  check('вещи в сумке НЕ помечены как надетые', dom.bag.every((c) => !c.worn));

  const better = byName('Лучший тесак');
  check('строго лучшее оружие: все дельты подсвечены как улучшение',
    better && better.cmp.length === 3 && better.cmp.every((c) => c.cls.includes('cmp-up')),
    better && better.cmp);

  const worse = byName('Худший тесак');
  check('строго худшее оружие: все дельты подсвечены как ухудшение',
    worse && worse.cmp.length === 3 && worse.cmp.every((c) => c.cls.includes('cmp-down')),
    worse && worse.cmp);

  const same = byName('Такой же тесак');
  check('идентичное оружие подписано «то же самое»',
    same && same.cmp.length === 1 && same.cmp[0].cls.includes('cmp-same'),
    same && same.cmp);

  // Gear for an empty slot reads as a pure gain, and the defensive stat is
  // signed so that better protection shows as LESS incoming damage.
  const helm = dom.bag.find((c) => c.kind === 'Шлем');
  check('шлем в пустой слот: всё показано как прибавка',
    helm && helm.cmp.length > 0 && helm.cmp.every((c) => c.cls.includes('cmp-up')),
    helm && helm.cmp);
  const dr = helm && helm.cmp.find((c) => c.text.includes('вх. урон'));
  check('улучшение защиты подписано через «−», а не «+»',
    dr && dr.text.trim().startsWith('−'), dr);

  // --- Clicking a card equips it, and the panel refreshes ----------------
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#inventory-grid .item-cell')];
    const target = cards.find((c) => c.querySelector('.item-name').textContent === 'Лучший тесак');
    target.click();
  });
  await page.waitForTimeout(250);

  const after = await page.evaluate(() => ({
    equippedName: Game.player.weapon.name,
    wornNames: [...document.querySelectorAll('#inventory-slots .item-cell .item-name')].map((e) => e.textContent),
    bagNames: [...document.querySelectorAll('#inventory-grid .item-cell .item-name')].map((e) => e.textContent),
  }));
  check('клик по карточке надевает вещь', after.equippedName === 'Лучший тесак', after.equippedName);
  check('надетая вещь переезжает в секцию «Надето»', after.wornNames.includes('Лучший тесак'), after.wornNames);
  check('и исчезает из сумки', !after.bagNames.includes('Лучший тесак'), after.bagNames);

  // --- The panel fits: no card clipped by the scroll container ----------
  //
  // The cards grew several lines taller in this pass; the failure mode is a
  // flex child that refuses to shrink and slices its last row instead of
  // scrolling (min-height: auto). Checked as real geometry, not by eye.
  const fit = await page.evaluate(() => {
    const grid = document.getElementById('inventory-grid');
    const panel = document.getElementById('inventory-panel');
    return {
      gridScrolls: grid.scrollHeight > grid.clientHeight,
      gridOverflow: getComputedStyle(grid).overflowY,
      panelWithinStage: panel.getBoundingClientRect().bottom
        <= document.getElementById('stage').getBoundingClientRect().bottom + 1,
      closeVisible: document.getElementById('btn-inventory-close').getBoundingClientRect().height > 0,
    };
  });
  check('длинный список прокручивается, а не обрезается', fit.gridOverflow === 'auto', fit);
  check('панель целиком помещается в игровое поле', fit.panelWithinStage, fit);
  check('кнопка «Закрыть» не выдавлена за пределы панели', fit.closeVisible, fit);

  await page.screenshot({ path: 'inventory_ui.png' });

  console.log('\nCONSOLE ERRORS:', errors.length ? JSON.stringify(errors) : 'нет');
  if (errors.length) failures++;
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
})();
