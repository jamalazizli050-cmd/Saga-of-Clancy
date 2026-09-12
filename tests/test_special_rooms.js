// Special room kinds: generation weights, what fills each kind, the blood
// covenant, treasure choices, elite champions, and the clear-reward tiers.
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

// --- 1. Generation: kinds appear, normals dominate, structure is intact ---
{
  const stats = run(`
    (function() {
      const counts = {}; let chains = 0, rooms = 0;
      let firstRoomSpecial = 0, gateRoomSpecial = 0, bossGates = 0, challengeMissingVariant = 0;
      for (let i = 0; i < 400; i++) {
        Game.save.defeatedBishops = [];
        const chain = generateRoomChain();
        chains++;
        chain.forEach((e, idx) => {
          rooms++;
          counts[e.kind] = (counts[e.kind] || 0) + 1;
          if (idx === 0 && e.kind !== 'normal') firstRoomSpecial++;
          if (e.triggersBoss) {
            bossGates++;
            if (e.kind !== 'normal') gateRoomSpecial++;
          }
          if (e.kind === 'challenge' && !CHALLENGE_VARIANTS[e.challenge]) challengeMissingVariant++;
        });
      }
      return { counts, chains, rooms, firstRoomSpecial, gateRoomSpecial, bossGates, challengeMissingVariant };
    })()
  `);
  const pct = (k) => (stats.counts[k] || 0) / stats.rooms;
  console.log('   Доли комнат:', Object.fromEntries(
    Object.keys(sb.ROOM_KINDS).map((k) => [k, (pct(k) * 100).toFixed(1) + '%'])));

  check('генерируются все шесть типов комнат',
    Object.keys(sb.ROOM_KINDS).every((k) => (stats.counts[k] || 0) > 0), stats.counts);
  check('обычные комнаты остаются основой забега (>60%)', pct('normal') > 0.6, pct('normal'));
  check('специальных не больше трети', 1 - pct('normal') < 0.4, 1 - pct('normal'));
  check('тайник действительно редкий (<5%)', pct('secret') < 0.05, pct('secret'));
  check('сокровищница — самый частый из специальных',
    pct('treasure') > pct('elite') && pct('treasure') > pct('secret'), { t: pct('treasure'), e: pct('elite') });

  // Structure guarantees the task calls out explicitly.
  check('ПЕРВАЯ комната забега всегда обычная', stats.firstRoomSpecial === 0, stats.firstRoomSpecial);
  check('комната, поднимающая епископа, всегда обычная', stats.gateRoomSpecial === 0, stats.gateRoomSpecial);
  check('боссовые гейты вообще существуют (структура забега не сломана)',
    stats.bossGates === stats.chains * sb.MID_CHAIN_BOSS_ORDER.length,
    { bossGates: stats.bossGates, expected: stats.chains * sb.MID_CHAIN_BOSS_ORDER.length });
  check('у каждой challenge-комнаты есть валидный вариант правила',
    stats.challengeMissingVariant === 0, stats.challengeMissingVariant);
  check('длина цепочки не изменилась (3–5 комнат на епископа)',
    stats.rooms / stats.chains >= 3 * 5 && stats.rooms / stats.chains <= 5 * 5,
    stats.rooms / stats.chains);
}

// --- 2. Что стоит в комнате ---
{
  const filled = run(`
    (function() {
      function chainWith(kind, challenge) {
        Game.roomChain = [{ template: ROOM_TEMPLATES[0], biome: 'trench', triggersBoss: null, kind, challenge: challenge || null }];
        Game.save.defeatedBishops = [];
        return { enemies: spawnEnemiesForRoom(0), chests: spawnChestsForRoom(0) };
      }
      const normal = chainWith('normal');
      const treasure = chainWith('treasure');
      const secret = chainWith('secret');
      let eliteCounts = [];
      for (let i = 0; i < 200; i++) {
        const r = chainWith('elite');
        eliteCounts.push(r.enemies.filter((e) => e.elite).length);
      }
      const eliteSample = chainWith('elite');
      const eliteOne = eliteSample.enemies.find((e) => e.elite);
      const plainOne = eliteSample.enemies.find((e) => !e.elite);
      return {
        normalEnemies: normal.enemies.length,
        normalChests: normal.chests.length,
        normalElites: normal.enemies.filter((e) => e.elite).length,
        treasureEnemies: treasure.enemies.length,
        treasureChests: treasure.chests.map((c) => c.variant),
        secretEnemies: secret.enemies.length,
        secretChests: secret.chests.map((c) => c.variant),
        eliteCounts,
        eliteHp: eliteOne ? eliteOne.hp : null,
        plainHp: plainOne ? plainOne.hp : null,
        eliteAggro: eliteOne ? eliteOne.aggroRange : null,
        plainAggro: plainOne ? plainOne.aggroRange : null,
        eliteChase: eliteOne ? eliteOne.chaseSpeed : null,
        plainChase: plainOne ? plainOne.chaseSpeed : null,
        eliteGold: eliteOne ? eliteOne.deathGold : null,
      };
    })()
  `);

  check('обычная комната наполняется как раньше',
    filled.normalEnemies === 3 && filled.normalChests === 1 && filled.normalElites === 0, filled);
  check('в сокровищнице нет врагов', filled.treasureEnemies === 0);
  check('в сокровищнице ровно один сундук-выбор',
    filled.treasureChests.length === 1 && filled.treasureChests[0] === 'choice', filled.treasureChests);
  check('в тайнике нет врагов и стоит сундук-тайник',
    filled.secretEnemies === 0 && filled.secretChests.length === 1 && filled.secretChests[0] === 'secret', filled.secretChests);
  check('в элитной комнате РОВНО один чемпион, всегда',
    filled.eliteCounts.every((n) => n === 1), [...new Set(filled.eliteCounts)]);
  check('чемпион не всегда в одном и том же слоте (позиция случайна)',
    run(`(function(){
      const slots = new Set();
      for (let i = 0; i < 200; i++) {
        Game.roomChain = [{ template: ROOM_TEMPLATES[0], biome: 'trench', triggersBoss: null, kind: 'elite', challenge: null }];
        spawnEnemiesForRoom(0).forEach((e, s) => { if (e.elite) slots.add(s); });
      }
      return slots.size;
    })()`) > 1);

  // The task is explicit: an elite must not be "a normal enemy with a huge HP bar".
  check('чемпион крепче обычного', filled.eliteHp > filled.plainHp, { elite: filled.eliteHp, plain: filled.plainHp });
  check('...НО дело не только в HP: у него шире агро', filled.eliteAggro > filled.plainAggro,
    { elite: filled.eliteAggro, plain: filled.plainAggro });
  check('...и он быстрее догоняет', filled.eliteChase > filled.plainChase,
    { elite: filled.eliteChase, plain: filled.plainChase });
  check('за чемпиона больше золота', filled.eliteGold > 0);
}

// --- 3. Кровавый завет ---
{
  const blood = run(`
    (function() {
      Game.player = new Player(0, 0, 100, 1, 1, 3, null);
      Game.roomChain = [{ template: ROOM_TEMPLATES[0], biome: 'trench', triggersBoss: null, kind: 'blood', challenge: null }];
      Game.roomIndex = 0;
      Game.beginRoomKind(Game.roomChain[0]);
      const offered = Game.bloodOfferOpen;
      const cost = bloodCovenantCost(Game.player);
      const hpBefore = Game.player.hp;
      Game.acceptBloodCovenant();
      const afterAccept = { hp: Game.player.hp, accepted: Game.bloodAccepted, open: Game.bloodOfferOpen };

      // Declining instead.
      Game.player.hp = Game.player.maxHp;
      Game.beginRoomKind(Game.roomChain[0]);
      Game.declineBloodCovenant();
      const afterDecline = { hp: Game.player.hp, accepted: Game.bloodAccepted, open: Game.bloodOfferOpen };

      // Too hurt to be asked.
      Game.player.hp = Game.player.maxHp * 0.2;
      Game.beginRoomKind(Game.roomChain[0]);
      const whenHurt = Game.bloodOfferOpen;
      return { offered, cost, hpBefore, afterAccept, afterDecline, whenHurt };
    })()
  `);
  check('в кровавой комнате предложение поднимается на входе', blood.offered === true);
  check('цена — доля от МАКСИМУМА HP, а не плоское число',
    blood.cost === Math.round(100 * sb.BLOOD_COST_FRACTION), { cost: blood.cost });
  check('принятие списывает ровно цену', blood.afterAccept.hp === blood.hpBefore - blood.cost, blood.afterAccept);
  check('принятие помечает комнату как оплаченную', blood.afterAccept.accepted === true);
  check('отказ ничего не стоит', blood.afterDecline.hp === 100 && blood.afterDecline.accepted === false, blood.afterDecline);
  check('обе кнопки закрывают предложение',
    blood.afterAccept.open === false && blood.afterDecline.open === false);
  check('раненому игроку завет не предлагают вовсе (он не может убить)', blood.whenHurt === false);

  // Scaling: the cost must stay a real decision at the upgraded HP ceiling.
  const scaled = run(`(function(){
    const p = new Player(0, 0, 161, 1, 1, 3, null);
    return bloodCovenantCost(p);
  })()`);
  check('цена растёт вместе с максимумом HP (не превращается в мелочь к концу)',
    scaled > blood.cost, { at100: blood.cost, at161: scaled });

  // Even at the exact offer threshold it can never be lethal.
  const survives = run(`(function(){
    Game.player = new Player(0, 0, 100, 1, 1, 3, null);
    Game.player.hp = Math.ceil(Game.player.maxHp * BLOOD_MIN_HP_FRACTION) + 1;
    Game.roomChain = [{ template: ROOM_TEMPLATES[0], biome: 'trench', triggersBoss: null, kind: 'blood', challenge: null }];
    Game.roomIndex = 0;
    Game.beginRoomKind(Game.roomChain[0]);
    Game.acceptBloodCovenant();
    return Game.player.hp;
  })()`);
  check('завет никогда не убивает — HP остаётся выше нуля', survives > 0, survives);
}

// --- 4. Сокровищница: выбор ---
{
  check('четыре варианта, все разные по сути', sb.TREASURE_CHOICES.length === 4);
  check('у каждого варианта есть заголовок, значение и пояснение',
    sb.TREASURE_CHOICES.every((c) => c.id && c.title && c.detail && c.hint));

  const picks = run(`
    (function() {
      function fresh(hpFraction) {
        Game.player = new Player(0, 0, 100, 1, 1, 3, null);
        Game.player.hp = Math.round(Game.player.maxHp * hpFraction);
        Game.player.arrows = 5;
        Game.save.gold = 0;
        Game.treasureChoiceOpen = true;
        Game.treasureChest = { opened: false, variant: 'choice' };
      }
      const out = {};
      fresh(1); out.gold = { r: Game.applyTreasureChoice('gold'), gold: Game.save.gold, chestOpened: true };
      fresh(1); out.arrows = { r: Game.applyTreasureChoice('arrows'), arrows: Game.player.arrows };
      fresh(0.5); const beforeHeal = Game.player.hp; out.heal = { r: Game.applyTreasureChoice('heal'), before: beforeHeal, after: Game.player.hp };
      // Counts equipped gear too: an item dropped into an empty slot is
      // auto-equipped straight out of the bag, so bag size alone would miss it.
      function owned() {
        const worn = EQUIP_SLOTS.filter((s) => Game.player.equipment[s]).length;
        return Game.player.weapons.length + Game.player.bows.length + Game.player.gearInventory.length + worn;
      }
      fresh(1); const wBefore = owned();
      out.item = { r: Game.applyTreasureChoice('item'), before: wBefore, after: owned() };

      // Taking twice must be impossible.
      fresh(1);
      Game.applyTreasureChoice('gold');
      const goldAfterFirst = Game.save.gold;
      const second = Game.applyTreasureChoice('gold');
      out.doubleDip = { second, goldAfterFirst, goldNow: Game.save.gold };
      return out;
    })()
  `);
  check('золото начисляется', picks.gold.gold === sb.TREASURE_GOLD, picks.gold);
  check('стрелы начисляются', picks.arrows.arrows === 5 + sb.TREASURE_ARROWS, picks.arrows);
  check('лечение реально лечит', picks.heal.after > picks.heal.before, picks.heal);
  check('предмет попадает в инвентарь', picks.item.after === picks.item.before + 1, picks.item);
  check('выбрать дважды нельзя',
    picks.doubleDip.second === null && picks.doubleDip.goldNow === picks.doubleDip.goldAfterFirst, picks.doubleDip);

  // Balance: no option may dominate the others outright.
  check('лечение сильнее покупной перевязки (иначе золото всегда лучше)',
    sb.TREASURE_HEAL_FRACTION > 0.35, sb.TREASURE_HEAL_FRACTION);
  check('стрелы стоят дороже золотого варианта по магазинному курсу',
    (sb.TREASURE_ARROWS / sb.ARROW_BUNDLE_SIZE) * sb.ARROW_BUNDLE_COST > sb.TREASURE_GOLD,
    { arrowsValue: (sb.TREASURE_ARROWS / sb.ARROW_BUNDLE_SIZE) * sb.ARROW_BUNDLE_COST, gold: sb.TREASURE_GOLD });
}

// --- 5. Награда за зачистку и правила испытаний ---
{
  const rewards = run(`
    (function() {
      function room(kind, challenge, opts = {}) {
        Game.player = new Player(0, 0, 100, 1, 1, 3, null);
        Game.save.gold = 0;
        Game.save.shards = 0;
        Game.roomChain = [{ template: ROOM_TEMPLATES[0], biome: 'trench', triggersBoss: null, kind, challenge: challenge || null }];
        Game.roomIndex = 0;
        Game.beginRoomKind(Game.roomChain[0]);
        if (opts.hit) Game.roomHitTaken = true;
        if (opts.blood) Game.bloodAccepted = true;
        const r = Game.grantRoomClearReward();
        return { r, gold: Game.save.gold, arrows: Game.player.arrows, again: Game.grantRoomClearReward() };
      }
      return {
        normal: room('normal'),
        elite: room('elite'),
        nohitClean: room('challenge', 'nohit'),
        nohitFailed: room('challenge', 'nohit', { hit: true }),
        waves: room('challenge', 'waves'),
        bloodNormal: room('blood', null, { blood: true }),
        bloodElite: room('elite', null, { blood: true }),
      };
    })()
  `);

  check('обычная комната не даёт бонуса за зачистку', rewards.normal.r === null);
  check('элитная комната даёт бонус', rewards.elite.r !== null && rewards.elite.r.tier === 2, rewards.elite.r);
  check('элитная комната гарантированно даёт предмет', rewards.elite.r.item !== null);
  check('испытание без урона: бонус выдан, если урона не было',
    rewards.nohitClean.r !== null && rewards.nohitClean.r.tier === 1, rewards.nohitClean.r);
  check('испытание без урона: получил удар — бонуса нет (правило что-то значит)',
    rewards.nohitFailed.r === null);
  check('испытание волнами засчитывается по факту прохождения', rewards.waves.r !== null);
  check('завет поднимает награду обычной комнаты с нуля до тира 2',
    rewards.bloodNormal.r !== null && rewards.bloodNormal.r.tier === 2, rewards.bloodNormal.r);
  check('завет в элитной комнате даёт высший тир', rewards.bloodElite.r.tier === 3, rewards.bloodElite.r);
  check('высший тир добавляет шарды', rewards.bloodElite.r.shards > 0, rewards.bloodElite.r);
  check('награда выдаётся ровно один раз за комнату',
    rewards.elite.again === null && rewards.nohitClean.again === null);
  check('награда всегда включает золото и стрелы',
    rewards.elite.r.gold > 0 && rewards.elite.r.arrows > 0, rewards.elite.r);
}

// --- 6. Баланс: специальные комнаты не заливают забег золотом ---
{
  const income = run(`
    (function() {
      let totalGold = 0, runs = 200, specialRooms = 0;
      for (let i = 0; i < runs; i++) {
        Game.player = new Player(0, 0, 100, 1, 1, 3, null);
        Game.save.gold = 0; Game.save.defeatedBishops = [];
        Game.roomChain = generateRoomChain();
        for (let idx = 0; idx < Game.roomChain.length; idx++) {
          const e = Game.roomChain[idx];
          if (e.kind === 'normal') continue;
          specialRooms++;
          Game.roomIndex = idx;
          Game.beginRoomKind(e);
          // Best case for the player: covenant always taken, challenges clean.
          if (Game.bloodOfferOpen) Game.acceptBloodCovenant();
          Game.grantRoomClearReward();
          if (e.kind === 'treasure') { Game.treasureChoiceOpen = true; Game.treasureChest = {}; Game.applyTreasureChoice('gold'); }
          if (e.kind === 'secret') { Game.lastRoomReward = Game.grantRoomReward(3); }
        }
        totalGold += Game.save.gold;
      }
      return { perRun: totalGold / runs, specialPerRun: specialRooms / runs };
    })()
  `);
  console.log(`   Специальных комнат за забег: ${income.specialPerRun.toFixed(1)}, доп. золота при идеальной игре: ${Math.round(income.perRun)}`);
  check('специальных комнат за забег — заметно, но не половина',
    income.specialPerRun >= 3 && income.specialPerRun <= 11, income.specialPerRun);
  check('доп. золото не превышает обычный доход за проходку (~1000-1500)',
    income.perRun < 1000, income.perRun);
  check('...но и не пренебрежимо мало', income.perRun > 200, income.perRun);
}

// --- 7. Баннеры и вспомогательные функции ---
{
  check('у обычной комнаты нет баннера',
    run(`roomKindBanner({ kind: 'normal', challenge: null })`) === null);
  const t = run(`roomKindBanner({ kind: 'treasure', challenge: null })`);
  check('у сокровищницы есть символ, название и цвет', !!(t.symbol && t.label && t.color), t);
  const c = run(`roomKindBanner({ kind: 'challenge', challenge: 'nohit' })`);
  check('баннер испытания сообщает КОНКРЕТНОЕ правило, а не просто "испытание"',
    c.label.includes('БЕЗ УРОНА') && c.sub.length > 0, c);
  check('isPeacefulRoom верно делит комнаты на боевые и мирные',
    run(`isPeacefulRoom('treasure')`) === true
    && run(`isPeacefulRoom('secret')`) === true
    && run(`isPeacefulRoom('elite')`) === false
    && run(`isPeacefulRoom('normal')`) === false);
  check('rollRoomKind(true) всегда возвращает normal',
    run(`(function(){ for (let i=0;i<50;i++) if (rollRoomKind(true) !== 'normal') return false; return true; })()`));
  check('в комнате волн заранее выставлены ожидающие волны',
    run(`(function(){
      Game.player = new Player(0,0,100,1,1,3,null);
      Game.beginRoomKind({ kind: 'challenge', challenge: 'waves' });
      return Game.pendingWaves;
    })()`) === sb.CHALLENGE_WAVE_COUNT - 1);
  check('состояние комнаты полностью сбрасывается при входе в следующую',
    run(`(function(){
      Game.player = new Player(0,0,100,1,1,3,null);
      Game.beginRoomKind({ kind: 'challenge', challenge: 'nohit' });
      Game.roomHitTaken = true; Game.roomRewardGranted = true; Game.bloodAccepted = true;
      Game.beginRoomKind({ kind: 'normal', challenge: null });
      return !Game.roomHitTaken && !Game.roomRewardGranted && !Game.bloodAccepted && Game.pendingWaves === 0;
    })()`));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
