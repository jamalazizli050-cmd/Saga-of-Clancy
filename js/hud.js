// DOM-based HUD/menu overlay. Kept separate from canvas rendering so the
// game world (canvas) and UI chrome (DOM) can be styled/extended independently.
//
// The hub itself is rendered on the canvas (see hub.js) — the only DOM here
// for it is the floating merchant panel / portal prompt, positioned over the
// world-space coordinates of those objects each frame.

const HUD = {
  els: {},

  init() {
    this.els.hud = document.getElementById('hud');
    this.els.hpBar = document.getElementById('hp-bar');
    this.els.hpText = document.getElementById('hp-text');
    this.els.goldValue = document.getElementById('gold-value');
    this.els.shardValue = document.getElementById('shard-value');
    this.els.prestigeValue = document.getElementById('prestige-value');
    this.els.arrowValue = document.getElementById('arrow-value');
    this.els.heirName = document.getElementById('heir-name');
    this.els.weaponDisplay = document.getElementById('weapon-display');
    this.els.weaponName = document.getElementById('weapon-name');
    this.els.bowDisplay = document.getElementById('bow-display');
    this.els.bowName = document.getElementById('bow-name');
    this.els.equipDisplay = document.getElementById('equip-display');
    this.els.equipHelm = document.getElementById('equip-helm');
    this.els.equipChest = document.getElementById('equip-chest');
    this.els.equipAcc = document.getElementById('equip-acc');
    this.els.bossBarWrap = document.getElementById('boss-bar-wrap');
    this.els.bossBar = document.getElementById('boss-bar');
    this.els.bossNameLabel = document.getElementById('boss-name-label');
    this.els.smokeOverlay = document.getElementById('smoke-overlay');

    this.els.deathScreen = document.getElementById('death-screen');
    this.els.deathMessage = document.getElementById('death-message');

    this.els.merchantPanel = document.getElementById('merchant-panel');
    this.els.btnBuyBandage = document.getElementById('btn-buy-bandage');
    this.els.merchantBandagePct = document.getElementById('merchant-bandage-pct');
    this.els.merchantBandageCost = document.getElementById('merchant-bandage-cost');
    this.els.btnBuyArrows = document.getElementById('btn-buy-arrows');
    this.els.merchantArrowSize = document.getElementById('merchant-arrow-size');
    this.els.merchantArrowCost = document.getElementById('merchant-arrow-cost');
    this.els.merchantOffers = document.getElementById('merchant-offers');
    this.els.btnMerchantReroll = document.getElementById('btn-merchant-reroll');
    this.els.merchantRerollCost = document.getElementById('merchant-reroll-cost');

    this.els.obeliskPanel = document.getElementById('obelisk-panel');
    this.els.obeliskPermanent = document.getElementById('obelisk-permanent');
    this.els.obeliskPrestige = document.getElementById('obelisk-prestige');
    this.els.obeliskUpgrades = document.getElementById('obelisk-upgrades');

    this.els.echoPanel = document.getElementById('echo-panel');
    this.els.echoRow = document.getElementById('echo-row');

    this.els.portalPrompt = document.getElementById('portal-prompt');
    this.els.hubHint = document.getElementById('hub-hint');
    this.els.chestPrompt = document.getElementById('chest-prompt');
    this.els.heirChoices = document.getElementById('heir-choices');

    this.els.cycleNarrativeScreen = document.getElementById('cycle-narrative-screen');
    this.els.cycleHeirScreen = document.getElementById('cycle-heir-screen');
    this.els.cycleHeirChoices = document.getElementById('cycle-heir-choices');

    this.els.scrapperPrompt = document.getElementById('scrapper-prompt');

    this.els.bloodPanel = document.getElementById('blood-panel');
    this.els.bloodCost = document.getElementById('blood-cost');
    this.els.btnBloodAccept = document.getElementById('btn-blood-accept');
    this.els.btnBloodDecline = document.getElementById('btn-blood-decline');
    this.els.treasureOverlay = document.getElementById('treasure-overlay');
    this.els.treasureChoices = document.getElementById('treasure-choices');

    this.els.inventoryOverlay = document.getElementById('inventory-overlay');
    this.els.inventorySlots = document.getElementById('inventory-slots');
    this.els.inventoryGrid = document.getElementById('inventory-grid');
    this.els.btnInventoryClose = document.getElementById('btn-inventory-close');

    this.els.scrapperOverlay = document.getElementById('scrapper-overlay');
    this.els.scrapperGrid = document.getElementById('scrapper-grid');
    this.els.btnScrapperClose = document.getElementById('btn-scrapper-close');

    this.els.titleScreen = document.getElementById('title-screen');
    this.els.titleSaveSummary = document.getElementById('title-save-summary');
    this.els.titleGold = document.getElementById('title-gold');
    this.els.titleShards = document.getElementById('title-shards');
    this.els.titlePrestige = document.getElementById('title-prestige');
    this.els.titleCycle = document.getElementById('title-cycle');
    this.els.btnTitleContinue = document.getElementById('btn-title-continue');
    this.els.titleVersion = document.getElementById('title-version');

    this.els.pauseOverlay = document.getElementById('pause-overlay');
    this.els.btnPauseHub = document.getElementById('btn-pause-hub');
    this.els.pauseSettingsPanel = document.getElementById('pause-settings-panel');

    this.els.chronicleOverlay = document.getElementById('chronicle-overlay');
    this.els.chronicleContent = document.getElementById('chronicle-content');

    this.els.creditsOverlay = document.getElementById('credits-overlay');
  },

  showScreen(name) {
    this.els.deathScreen.classList.toggle('hidden', name !== 'death');
    this.els.cycleNarrativeScreen.classList.toggle('hidden', name !== 'cycleNarrative');
    this.els.cycleHeirScreen.classList.toggle('hidden', name !== 'cycleHeir');
    this.els.titleScreen.classList.toggle('hidden', name !== 'title');
    this.els.hud.classList.toggle('hidden', name !== 'game');
    if (name !== 'game') {
      this.setObeliskPanel(false);
      this.setMerchantPanel(false);
      this.setEchoPanel(false);
      this.setPortalPrompt(false);
      this.setHubHint(false);
      this.setChestPrompt(false);
      this.setScrapperPrompt(false);
      this.setInventoryPanel(false);
      this.setScrapperPanel(false);
      this.setPauseMenu(false);
      this.setBloodOffer(false);
      this.setTreasurePanel(false);
    }
  },

  // Called once when Game.enterTitle() runs (not per-frame) — opts:
  // { hasSave, gold, shards, prestige, cycleCount, version }. "Продолжить"
  // only shows at all when a save actually exists (see Game.hasSaveProgress).
  setTitleScreen(opts) {
    this.els.btnTitleContinue.classList.toggle('hidden', !opts.hasSave);
    this.els.titleSaveSummary.classList.toggle('hidden', !opts.hasSave);
    if (opts.hasSave) {
      this.els.titleGold.textContent = opts.gold;
      this.els.titleShards.textContent = opts.shards;
      this.els.titlePrestige.textContent = opts.prestige;
      this.els.titleCycle.textContent = opts.cycleCount;
    }
    this.els.titleVersion.textContent = opts.version;
  },

  // opts: { showHubReturn }. Built once per open (Escape toggles this, not
  // a 60fps loop), so — unlike the obelisk/merchant panels — there's no
  // signature-guard needed; the button visibility toggle is the only
  // per-open state, everything else is wired up once in main.js.
  setPauseMenu(visible, opts) {
    this.els.pauseOverlay.classList.toggle('hidden', !visible);
    if (!visible) {
      this.els.pauseSettingsPanel.classList.add('hidden');
      return;
    }
    this.els.btnPauseHub.classList.toggle('hidden', !opts.showHubReturn);
  },

  togglePauseSettings() {
    this.els.pauseSettingsPanel.classList.toggle('hidden');
  },

  // data: Game.chronicleData(). Rebuilt fresh each open — this is a
  // read-only screen with no per-frame updates.
  setChronicleScreen(visible, data) {
    this.els.chronicleOverlay.classList.toggle('hidden', !visible);
    if (!visible) return;

    const c = this.els.chronicleContent;
    c.innerHTML = '';

    const addRow = (label, value) => {
      const row = document.createElement('div');
      row.className = 'chronicle-row';
      row.innerHTML = `${label}: <span>${value}</span>`;
      c.appendChild(row);
    };
    addRow('Текущий носитель имени', data.currentHeirName);
    addRow('Смертей за всю сагу', data.totalDeaths);
    addRow('Раз стал Блэрифейсом', data.cyclesCompleted);

    const title = document.createElement('div');
    title.className = 'chronicle-ancestors-title';
    title.textContent = 'Предки, ставшие Блэрифейсом';
    c.appendChild(title);

    if (data.ancestors.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'chronicle-empty';
      empty.textContent = 'Пока никто из рода не завершил цикл.';
      c.appendChild(empty);
    }
    for (const a of data.ancestors) {
      const row = document.createElement('div');
      row.className = 'chronicle-ancestor';
      row.innerHTML = `${a.name} — <span>цикл ${a.cycle}</span>`;
      c.appendChild(row);
    }
  },

  setCreditsScreen(visible) {
    this.els.creditsOverlay.classList.toggle('hidden', !visible);
  },

  update({ hp, maxHp, gold, shards, prestige, arrows, weaponName, bowName, heirName, equipment }) {
    const pct = clamp(hp / maxHp, 0, 1) * 100;
    this.els.hpBar.style.width = pct + '%';
    this.els.hpText.textContent = `${Math.ceil(hp)} / ${maxHp}`;
    this.els.goldValue.textContent = gold;
    this.els.shardValue.textContent = shards;
    this.els.prestigeValue.textContent = prestige;
    this.els.arrowValue.textContent = arrows;
    // Out of ammo is a state the player has to be able to read at a glance —
    // right-click silently doing nothing is otherwise indistinguishable from
    // a broken control.
    this.els.arrowValue.classList.toggle('depleted', arrows <= 0);
    this.els.weaponName.textContent = weaponName;
    this.els.bowName.textContent = bowName;
    this.els.heirName.textContent = heirName;

    if (equipment) {
      this.els.equipHelm.textContent = describeSlot(equipment.helm);
      this.els.equipChest.textContent = describeSlot(equipment.chest);
      const accs = ACCESSORY_SLOTS
        .map((slot) => equipment[slot])
        .filter(Boolean)
        .map((item) => `${item.name} (${item.label})`);
      this.els.equipAcc.textContent = accs.length ? accs.join(' · ') : '—';
    }
  },

  // Weapon + gear panels share visibility: both are run-relevant and both
  // are hidden in the neutral hub (see Game.enterHub).
  setWeaponVisible(visible) {
    this.els.weaponDisplay.classList.toggle('hidden', !visible);
    this.els.bowDisplay.classList.toggle('hidden', !visible);
    this.els.equipDisplay.classList.toggle('hidden', !visible);
  },

  setBossVisible(visible, name) {
    this.els.bossBarWrap.classList.toggle('hidden', !visible);
    if (visible) this.els.bossNameLabel.textContent = name;
  },

  updateBoss(hp, maxHp) {
    const pct = clamp(hp / maxHp, 0, 1) * 100;
    this.els.bossBar.style.width = pct + '%';
  },

  setSmoke(active) {
    this.els.smokeOverlay.classList.toggle('hidden', !active);
  },

  setHubHint(visible) {
    this.els.hubHint.classList.toggle('hidden', !visible);
  },

  // Shared by every dynamic upgrade/offer list below (permanent hp/dmg/cd,
  // the prestige tree, the merchant's offers) — one row-shape, so adding a
  // new entry to any of them needs no HTML edit. Buttons are re-created
  // each rebuild; cheap at this size and keeps disabled/label state
  // trivially correct without diffing.
  buildUpgradeRow({ title, desc, buttonLabel, disabled, buttonClass, onClick }) {
    const row = document.createElement('div');
    row.className = 'obelisk-row';

    const label = document.createElement('div');
    label.className = 'stat-line prestige-stat';
    label.textContent = title;
    row.appendChild(label);

    if (desc) {
      const descEl = document.createElement('div');
      descEl.className = 'obelisk-desc';
      descEl.textContent = desc;
      row.appendChild(descEl);
    }

    const btn = document.createElement('button');
    btn.className = `btn btn-small ${buttonClass || ''}`.trim();
    btn.textContent = buttonLabel;
    btn.disabled = disabled;
    btn.addEventListener('click', onClick);
    row.appendChild(btn);

    return row;
  },

  // left/top are world-space (== canvas pixel space, hub camera never scrolls).
  // opts.bandage: the one-time heal. opts.offers: merchant.js's
  // merchantOfferStatuses() (regular gear/weapons for gold — the second gold
  // sink, alongside bandage, now that the permanent gold/shard upgrades live
  // on the Улучшения panel instead). opts.reroll: {cost, canAfford}.
  setMerchantPanel(visible, opts) {
    this.els.merchantPanel.classList.toggle('hidden', !visible);
    if (!visible) {
      this.merchantSignature = null;
      return;
    }
    this.els.merchantPanel.style.left = opts.left + 'px';
    this.els.merchantPanel.style.top = opts.top + 'px';

    const { bandage, arrows, offers, reroll } = opts;
    this.els.merchantBandagePct.textContent = bandage.healPct;
    this.els.merchantBandageCost.textContent = bandage.cost;
    // Disabled at full HP as well as when broke — selling a no-op heal is
    // just a way to take the player's gold for nothing.
    this.els.btnBuyBandage.disabled = !bandage.canAfford;

    this.els.merchantArrowSize.textContent = arrows.size;
    this.els.merchantArrowCost.textContent = arrows.cost;
    // Only gated on gold: there's no arrow cap, so a resupply is never a no-op
    // the way a full-HP bandage would be.
    this.els.btnBuyArrows.disabled = !arrows.canAfford;

    this.els.merchantRerollCost.textContent = reroll.cost;
    this.els.btnMerchantReroll.disabled = !reroll.canAfford;

    // Same "don't rebuild every frame" guard as the upgrade panels below —
    // updateHub() calls this continuously while in range.
    const signature = `${bandage.canAfford}|${arrows.canAfford}|${reroll.canAfford}|` + offers.map((o) => `${o.id}:${o.canAfford}`).join(',');
    if (signature === this.merchantSignature) return;
    this.merchantSignature = signature;

    const container = this.els.merchantOffers;
    container.innerHTML = '';
    const KIND_LABEL = { weapon: 'Оружие', gear: 'Снаряжение' };
    for (const offer of offers) {
      container.appendChild(this.buildUpgradeRow({
        title: `${KIND_LABEL[offer.kind]}: ${offer.name}`,
        buttonLabel: `Купить (${offer.price} золота)`,
        buttonClass: 'btn-shard',
        disabled: !offer.canAfford,
        onClick: () => opts.onBuyOffer(offer.id),
      }));
    }
    if (offers.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'obelisk-desc';
      empty.textContent = 'Товар распродан — обновите ассортимент.';
      container.appendChild(empty);
    }
  },

  // opts.permanent: hp/dmg/cd upgrade statuses (gold + shard, mapped to the
  // shared row shape by main.js) — the "постоянное" section. opts.upgrades:
  // the prestige (echo) tree, unchanged from before. Both rebuild through
  // the same signature-guard trick as setMerchantPanel.
  setObeliskPanel(visible, opts) {
    this.els.obeliskPanel.classList.toggle('hidden', !visible);
    if (!visible) {
      this.obeliskSignature = null;
      return;
    }
    this.els.obeliskPanel.style.left = opts.left + 'px';
    this.els.obeliskPanel.style.top = opts.top + 'px';
    this.els.obeliskPrestige.textContent = opts.prestige;

    const signature = `${opts.prestige}|`
      + opts.permanent.map((u) => `${u.key}:${u.level}:${u.canAfford}`).join(',') + '|'
      + opts.upgrades.map((u) => `${u.key}:${u.level}:${u.canAfford}`).join(',');
    if (signature === this.obeliskSignature) return;
    this.obeliskSignature = signature;

    const permanentContainer = this.els.obeliskPermanent;
    permanentContainer.innerHTML = '';
    for (const status of opts.permanent) {
      permanentContainer.appendChild(this.buildUpgradeRow({
        title: `${status.title} (${status.level}/${status.maxLevel})`,
        desc: status.desc,
        buttonLabel: status.maxed ? 'Максимум' : `Купить (${status.cost} ${status.currency})`,
        buttonClass: status.currency === 'шардов' ? 'btn-shard' : '',
        disabled: status.maxed || !status.canAfford,
        onClick: () => status.onBuy(),
      }));
    }

    const container = this.els.obeliskUpgrades;
    container.innerHTML = '';
    for (const status of opts.upgrades) {
      container.appendChild(this.buildUpgradeRow({
        title: `${status.title} (${status.level}/${status.maxLevel})`,
        desc: status.desc,
        buttonLabel: status.maxed ? 'Максимум' : `Купить (${status.cost} эха)`,
        buttonClass: 'btn-prestige',
        disabled: status.maxed || !status.canAfford,
        onClick: () => opts.onBuy(status.key),
      }));
    }
  },

  // The Echo trader (5th hub station): a repeatable gold+shard -> Эхо
  // exchange, deliberately worse than just finishing a cycle — see
  // game.js's ECHO_EXCHANGE_* comment. opts.exchange is
  // Game.echoExchangeStatus().
  setEchoPanel(visible, opts) {
    this.els.echoPanel.classList.toggle('hidden', !visible);
    if (!visible) {
      this.echoSignature = null;
      return;
    }
    this.els.echoPanel.style.left = opts.left + 'px';
    this.els.echoPanel.style.top = opts.top + 'px';

    const { exchange } = opts;
    // Same "don't rebuild the row (and swallow a click) 60x/second" guard
    // the other dynamic panels use.
    const signature = `${exchange.canAfford}`;
    if (signature === this.echoSignature) return;
    this.echoSignature = signature;

    const container = this.els.echoRow;
    container.innerHTML = '';
    container.appendChild(this.buildUpgradeRow({
      title: 'Обменять на Эхо',
      desc: `${exchange.goldCost} золота + ${exchange.shardCost} шардов -> 1 эхо. Медленнее, чем стать новым Блэрифейсом, но не требует забега.`,
      buttonLabel: `Обменять (${exchange.goldCost} золота, ${exchange.shardCost} шардов)`,
      buttonClass: 'btn-prestige',
      disabled: !exchange.canAfford,
      onClick: () => opts.onBuy(),
    }));
  },

  setPortalPrompt(visible, opts) {
    this.els.portalPrompt.classList.toggle('hidden', !visible);
    if (!visible) return;
    this.els.portalPrompt.style.left = opts.left + 'px';
    this.els.portalPrompt.style.top = opts.top + 'px';
    this.els.portalPrompt.textContent = opts.label;
  },

  // left/top here are screen-space (world-space minus camera.x) since,
  // unlike the hub, run rooms scroll.
  setChestPrompt(visible, opts) {
    this.els.chestPrompt.classList.toggle('hidden', !visible);
    if (!visible) return;
    this.els.chestPrompt.style.left = opts.left + 'px';
    this.els.chestPrompt.style.top = opts.top + 'px';
  },

  // The scrapper NPC's world-space prompt — same "E — открыть" pattern as
  // a chest, not the always-visible floating panel the merchant/obelisk use.
  setScrapperPrompt(visible, opts) {
    this.els.scrapperPrompt.classList.toggle('hidden', !visible);
    if (!visible) return;
    this.els.scrapperPrompt.style.left = opts.left + 'px';
    this.els.scrapperPrompt.style.top = opts.top + 'px';
  },

  // The procedural silhouette icon (see icons.js) in its own bordered box —
  // shared by the item grid cells below and the equipped-slot row in
  // setInventoryPanel, `small` picking which of the two sizes (see
  // .item-icon/.item-icon-sm in style.css).
  buildItemIconBox(entry, rare, small) {
    const box = document.createElement('div');
    box.className = 'item-icon' + (small ? ' item-icon-sm' : '') + (rare ? ' item-icon-rare' : '');
    box.appendChild(buildItemIconSvg(entry));
    return box;
  },

  // Shared cell builder for both the inventory grid and the scrapper's sell
  // list — same {kind:'weapon'|'gear', item} entry shape either way (see
  // Player.unequippedItems). `extra` is an optional second line (e.g. a
  // scrap payout, or a quality readout) under the item's normal label.
  buildItemCell(entry, onClick, extra, rare) {
    const cell = document.createElement('button');
    cell.className = 'btn item-cell' + (rare ? ' item-cell-rare' : '');
    cell.title = entry.kind === 'weapon' ? describeWeaponFull(entry.item) : describeItemFull(entry.item);

    cell.appendChild(this.buildItemIconBox(entry, rare, false));

    const text = document.createElement('div');
    text.className = 'item-cell-text';

    const name = document.createElement('div');
    name.className = 'item-name';
    name.textContent = entry.item.name;

    const label = document.createElement('div');
    label.className = 'item-extra';
    label.textContent = entry.kind === 'weapon'
      ? `Урон ${entry.item.damage} · КД ${entry.item.cooldown}с · Дист. ${Math.round(entry.item.range)}`
      : entry.item.label;

    text.appendChild(name);
    text.appendChild(label);

    if (extra) {
      const extraEl = document.createElement('div');
      extraEl.className = 'item-extra';
      extraEl.textContent = extra;
      text.appendChild(extraEl);
    }

    cell.appendChild(text);
    cell.addEventListener('click', () => onClick(entry));
    return cell;
  },

  // opts: { equipment, weapon, accessorySlots, items, isRare(entry),
  // onEquip(entry), onUnequipSlot(slotKey) }. isRare is a callback (rather
  // than HUD reaching into Game.isRareItem itself) to keep this module a
  // pure render layer — main.js's renderInventoryPanel supplies it. Rebuilt
  // fully on every call — unlike the per-frame obelisk/merchant panels,
  // this is only ever called right after a state-changing click, never on
  // a 60fps timer, so there's no button-swallowed-by-rebuild risk here.
  // Blood covenant offer. Cost is passed in rather than computed here so the
  // HUD never has to know the covenant's rules — see rooms.js.
  setBloodOffer(visible, opts) {
    this.els.bloodPanel.classList.toggle('hidden', !visible);
    if (!visible) return;
    this.els.bloodCost.textContent = opts.cost;
  },

  // Treasure room's "choose one". Rebuilt on open only (never on a 60fps
  // timer), same as the inventory panel, so a click can't be swallowed by a
  // rebuild mid-press.
  setTreasurePanel(visible, opts) {
    this.els.treasureOverlay.classList.toggle('hidden', !visible);
    if (!visible) return;

    const container = this.els.treasureChoices;
    container.innerHTML = '';
    for (const choice of opts.choices) {
      const cell = document.createElement('button');
      cell.className = 'treasure-choice';
      cell.id = `treasure-choice-${choice.id}`;

      const title = document.createElement('span');
      title.className = 'tc-title';
      title.textContent = choice.title;
      const detail = document.createElement('span');
      detail.className = 'tc-detail';
      detail.textContent = choice.detail;
      const hint = document.createElement('span');
      hint.className = 'tc-hint';
      hint.textContent = choice.hint;

      cell.append(title, detail, hint);
      cell.addEventListener('click', () => opts.onChoose(choice.id));
      container.appendChild(cell);
    }
  },

  setInventoryPanel(visible, opts) {
    this.els.inventoryOverlay.classList.toggle('hidden', !visible);
    if (!visible) return;

    const slotsContainer = this.els.inventorySlots;
    slotsContainer.innerHTML = '';

    // The two armament slots. Neither is clickable-to-unequip the way gear
    // slots are: there's always exactly one melee weapon and one bow
    // equipped, and swapping happens by clicking a different one in the grid
    // below (see Player.manualEquipWeapon, which routes each to its own slot).
    for (const [label, item] of [['Оружие', opts.weapon], ['Лук', opts.bow]]) {
      const entry = { kind: 'weapon', item };
      const cell = document.createElement('div');
      cell.className = 'equip-slot-cell equip-slot-filled';
      cell.appendChild(this.buildItemIconBox(entry, opts.isRare(entry), true));
      const text = document.createElement('span');
      text.textContent = `${label}: ${item.name}`;
      cell.appendChild(text);
      slotsContainer.appendChild(cell);
    }

    const slotLabels = { helm: 'Шлем', chest: 'Нагрудник', acc1: 'Аксессуар 1', acc2: 'Аксессуар 2', acc3: 'Аксессуар 3', acc4: 'Аксессуар 4' };
    const gearSlots = ['helm', 'chest', ...opts.accessorySlots];
    for (const slotKey of gearSlots) {
      const item = opts.equipment[slotKey];
      const cell = document.createElement('button');
      cell.className = 'btn equip-slot-cell' + (item ? ' equip-slot-filled' : ' equip-slot-empty');
      if (item) {
        const entry = { kind: 'gear', item };
        cell.appendChild(this.buildItemIconBox(entry, opts.isRare(entry), true));
      }
      const label = document.createElement('span');
      label.textContent = item ? `${slotLabels[slotKey]}: ${item.name}` : `${slotLabels[slotKey]}: —`;
      cell.appendChild(label);
      if (item) cell.addEventListener('click', () => opts.onUnequipSlot(slotKey));
      else cell.disabled = true;
      slotsContainer.appendChild(cell);
    }

    const grid = this.els.inventoryGrid;
    grid.innerHTML = '';
    if (opts.items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'item-grid-empty';
      empty.textContent = 'Пусто — здесь появятся найденные, но не надетые вещи.';
      grid.appendChild(empty);
    }
    for (const entry of opts.items) {
      grid.appendChild(this.buildItemCell(entry, opts.onEquip, null, opts.isRare(entry)));
    }
  },

  // opts: { items, onScrap(entry) }. Same rebuild-on-click model as
  // setInventoryPanel — see its comment above.
  setScrapperPanel(visible, opts) {
    this.els.scrapperOverlay.classList.toggle('hidden', !visible);
    if (!visible) return;

    const grid = this.els.scrapperGrid;
    grid.innerHTML = '';
    if (opts.items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'item-grid-empty';
      empty.textContent = 'Нечего продать — сними что-нибудь лишнее в инвентаре.';
      grid.appendChild(empty);
    }
    for (const { entry, value } of opts.items) {
      const priceLabel = value.shards > 0 ? `${value.gold} золота + ${value.shards} шардов` : `${value.gold} золота`;
      grid.appendChild(this.buildItemCell(entry, opts.onScrap, priceLabel, value.rare));
    }
  },

  // opts: { goldLost, goldShards, hpSurplus, hpShards, shardsGained } — see
  // Game.onPlayerDeath. Everything lost converts to shards now, so the
  // message reports the conversion instead of a flat "lost X gold".
  showDeath({ goldLost, goldShards, hpSurplus, hpShards, shardsGained }) {
    const parts = [];
    if (goldLost > 0) parts.push(`${goldLost} золота → ${goldShards} шардов`);
    if (hpSurplus > 0) parts.push(`${hpSurplus} излишков HP → ${hpShards} шардов`);
    const detail = parts.length ? parts.join(', ') : 'нечего было конвертировать';
    this.els.deathMessage.textContent = `Всё обращено в шарды: ${detail} (итого +${shardsGained}).`;
  },

  // Shared renderer: one button per heir candidate in `container`, each
  // calling onChoose(heir) when clicked. Used by both the death screen
  // (showHeirChoices) and the cycle-victory screen (showCycleHeirChoices) —
  // same heir system (heirs.js) either way, just a different container/callback.
  renderHeirChoicesInto(container, heirs, onChoose) {
    container.innerHTML = '';
    for (const heir of heirs) {
      const btn = document.createElement('button');
      btn.className = 'btn heir-card';

      // Cosmetic portrait for the rolled skinId (see heirs.js's rollHeirs())
      // — a plain <img>, not the canvas TileImages cache, since this is DOM
      // chrome rather than a canvas draw. Older/hand-built heir objects
      // without a skinId (there shouldn't be any from rollHeirs(), but this
      // stays defensive) just render no image rather than a broken icon.
      if (heir.skinId) {
        const portrait = document.createElement('img');
        portrait.className = 'heir-portrait';
        portrait.src = `assets/sprites/heirs/heir_${String(heir.skinId).padStart(2, '0')}.png`;
        portrait.alt = '';
        btn.appendChild(portrait);
      }

      const nameEl = document.createElement('div');
      nameEl.className = 'heir-name';
      nameEl.textContent = heir.name;

      const statsEl = document.createElement('div');
      statsEl.className = 'heir-stats';
      statsEl.textContent = heir.label;

      btn.appendChild(nameEl);
      btn.appendChild(statsEl);

      // Archetype identity (heirs.js) — three short lines so the card stays
      // scannable at a glance rather than a paragraph to read under time
      // pressure on the death screen: which STYLE this heir plays, the one
      // concrete BONUS behind it, and the one concrete DRAWBACK that keeps
      // it from just being strictly better. Older/hand-built heir objects
      // without these fields (there shouldn't be any from rollHeirs()
      // anymore, but this stays defensive) simply render the card without
      // them, same as a missing skinId already does above.
      if (heir.styleLabel) {
        const styleEl = document.createElement('div');
        styleEl.className = 'heir-style';
        styleEl.textContent = heir.styleLabel;
        btn.appendChild(styleEl);
      }
      if (heir.bonusLabel) {
        const bonusEl = document.createElement('div');
        bonusEl.className = 'heir-bonus';
        bonusEl.textContent = heir.bonusLabel;
        btn.appendChild(bonusEl);
      }
      if (heir.drawbackLabel) {
        const drawbackEl = document.createElement('div');
        drawbackEl.className = 'heir-drawback';
        drawbackEl.textContent = heir.drawbackLabel;
        btn.appendChild(drawbackEl);
      }

      btn.addEventListener('click', () => onChoose(heir));
      container.appendChild(btn);
    }
  },

  // Death screen: clicking a candidate both applies the stat profile and
  // returns to the hub (Game.chooseHeir) — there's no separate confirm step.
  showHeirChoices(heirs, onChoose) {
    this.renderHeirChoicesInto(this.els.heirChoices, heirs, onChoose);
  },

  // Cycle-victory screen: same UI, routed to Game.chooseCycleHeir instead so
  // it also carries the "just started a new cycle" bookkeeping.
  showCycleHeirChoices(heirs, onChoose) {
    this.renderHeirChoicesInto(this.els.cycleHeirChoices, heirs, onChoose);
  },
};

HUD.init();
