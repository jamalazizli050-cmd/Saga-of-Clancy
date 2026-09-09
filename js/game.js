// Persistent meta-state (gold, shards, hub upgrades — survives death and
// reload via localStorage) plus the run state machine:
// hub -> run (room chain, with a Bishop fight gated after certain rooms —
// see MID_CHAIN_BOSS_ORDER/MID_CHAIN_BOSS_DEFS) -> death or the mirror-fight
// finale -> hub.
//
// Room progress within a run is intentionally NOT persisted anywhere — dying
// always sends the next attempt back to room index 0. Gold keeps 50% on
// death; shards and every hub upgrade (gold- or shard-bought) are permanent
// and never touched by death at all.
//
// After a mid-chain boss, the run pauses in the hub instead of continuing
// straight to the next room (see pauseRunInHub()/continueAfterMidBoss()) —
// `runInProgress` marks this. That flag, `roomIndex`, and the live `player`
// object (HP, weapons, position in the chain) are ALL in-memory only, same
// as every other piece of run state — none of it goes through persistSave().
// So: closing the tab or reloading mid-pause silently drops the paused run
// back to a fresh hub (portal reads "Начать забег" again) with banked
// gold/shards intact, but does NOT run onPlayerDeath() — no heir choice, no
// gold loss. That's a deliberate simplification, not an oversight: it keeps
// death/heir logic triggered only by actual in-game HP loss, and avoids
// having to decide whether a closed tab means "died" or "walked away".

const SAVE_KEY = 'dema_roguelike_save_v1';
const BASE_MAX_HP = 100;
const HP_UPGRADE_MAX_LEVEL = 5;
const HP_UPGRADE_BASE_COST = 50;
const HP_UPGRADE_COST_STEP = 40;

// Shard-only upgrades. Deliberately stronger per level than the gold HP
// upgrade, and gated behind a currency that only comes from boss kills —
// see addShards()/onBossDefeated(). Both live in the same permanent `save`
// object as hpLevel, so they carry across heirs exactly the same way.
// Levels raised from the original 5/4 (economy audit: with Bishop kills now
// persisting across deaths within a cycle — see Game.save.defeatedBishops —
// a player reliably earns ~25 shards per full chain traversal, so the old
// caps (35 shards to max dmg, 34 to max cd) were clearable in under 3
// traversals. After that, shards had ZERO remaining use anywhere in the
// game — worse than gold's situation, which at least always had the
// bandage as an infinite sink. Raising the caps (cost keeps climbing
// linearly via the existing *_COST_STEP formulas, nothing else changes)
// keeps shards meaningful across many more cycles instead of going dead.
const DMG_UPGRADE_MAX_LEVEL = 8;
const DMG_UPGRADE_PER_LEVEL = 0.08; // +8% to all damage dealt, per level
const DMG_UPGRADE_SHARD_COST_BASE = 3;
const DMG_UPGRADE_SHARD_COST_STEP = 2;

const CD_UPGRADE_MAX_LEVEL = 6;
const CD_UPGRADE_PER_LEVEL = 0.06; // -6% to every cooldown (jump/dash/attack), per level
const CD_UPGRADE_SHARD_COST_BASE = 4;
const CD_UPGRADE_SHARD_COST_STEP = 3;

const BOSS_SHARD_MIN = 3;
const BOSS_SHARD_MAX = 7;

// --- Scrapper (hub NPC): sells unequipped inventory items for gold, with a
// small shard bonus on rare rolls. Gold is a flat multiple of the same
// itemScore()/weaponScore() heuristics used for auto-equip comparisons, so
// a scrap payout tracks "how good is this stat-wise" the same way the rest
// of the game already judges gear. Numbers picked to sit below a full
// bandage/upgrade purchase (so scrapping alone can't fund one instantly) —
// adjust after balance testing.
const SCRAP_GEAR_GOLD_PER_SCORE = 1.5;
const SCRAP_WEAPON_GOLD_PER_SCORE = 1.2;
// Accessories/armor: top 20% of a roll's own possible range (see
// equipment.js's itemQuality — exact for this uniform-roll case). Weapons
// use their own empirically-derived threshold instead (see weapons.js's
// isRareWeapon) since weaponScore's distribution isn't uniform.
const EQUIP_RARE_QUALITY_THRESHOLD = 0.8;
const SCRAP_RARE_SHARD_MIN = 1;
const SCRAP_RARE_SHARD_MAX = 2;

// Healing. Before this the game had none at all: one HP pool had to cover
// five rooms and five boss fights, so runs ended by attrition regardless of
// play. The hub rest is free but only happens at the (boss-gated) pauses;
// the bandage is repeatable and is what gold is for after the HP upgrade
// track caps out at level 5.
const HUB_REST_HEAL_FRACTION = 0.3; // of max HP, granted on each mid-boss hub pause
const BANDAGE_COST = 45;
const BANDAGE_HEAL_FRACTION = 0.35;

// --- Merchant gear offers ----------------------------------------------
// Economy audit: once the gold-bought HP track caps out (650 gold total)
// the bandage was the ONLY remaining gold sink, and it can't absorb a full
// chain traversal's income (~1000+ gold, chests+trash+bosses combined) —
// gold just piles up with nothing to do until a death converts it to
// shards. This gives gold a second, always-relevant use: a small rotating
// stock of regular (non-rare — rare gear stays chest/boss-drop-only, so
// gold can't just buy your way to the good stuff) gear/weapons, priced
// above the scrapper's SELL rate (a shop marks up, it doesn't sell at
// cost) so it's a genuine spend decision, not a free upgrade.
const MERCHANT_OFFER_COUNT = 3;
const MERCHANT_OFFER_WEAPON_SHARE = 0.4;
const MERCHANT_GEAR_GOLD_PER_SCORE = SCRAP_GEAR_GOLD_PER_SCORE * 3; // 4.5
const MERCHANT_WEAPON_GOLD_PER_SCORE = SCRAP_WEAPON_GOLD_PER_SCORE * 3; // 3.6
// Regenerated rolls would let a player just re-open the panel for a
// re-roll, so a re-roll this cheap would trivialize the "one-time buffs on
// this life" framing — reroll cost is deliberately steep.
const MERCHANT_REROLL_COST = 30;

// Difficulty ramp across a single run. Every Bishop already defeated this
// run makes the next one hit harder — without this, the fifth fight was no
// more dangerous than the first despite the player having five rooms of
// loot. Applied on top of the NG+ cycle multiplier, not instead of it.
const CHAIN_DIFFICULTY_PER_BISHOP = 0.12;
const ENEMY_SCALING_PER_ROOM = 0.18; // rank-and-file HP/damage/reward per room index

// --- Prestige ("Эхо") -------------------------------------------------
// A third currency, deliberately kept out of the merchant's pool: it is
// only ever minted by completing a cycle (becoming the new Blairface) and
// only ever spent at the obelisk. Each upgrade here changes how a run
// STARTS rather than nudging a number mid-run, which is what makes them
// read as a tier above the shard upgrades.
const PRESTIGE_PER_CYCLE_BASE = 2; // award = base + one extra per prior cycle

const PRESTIGE_UPGRADES = [
  {
    key: 'weapon',
    saveKey: 'prestigeWeaponLevel',
    maxLevel: 1,
    costs: [3],
    title: 'Наследие оружия',
    desc: 'Наследник начинает забег со сгенерированным оружием вместо тесака',
  },
  {
    key: 'armor',
    saveKey: 'prestigeArmorLevel',
    maxLevel: 2,
    costs: [4, 6],
    title: 'Врождённая броня',
    desc: 'Забег начинается с 1 (затем 2) случайными частями брони',
  },
  {
    key: 'slot',
    saveKey: 'prestigeSlotLevel',
    maxLevel: 1,
    costs: [5],
    title: 'Четвёртый слот',
    desc: 'Открывает 4-й слот аксессуара навсегда',
  },
  {
    key: 'gold',
    saveKey: 'prestigeGoldLevel',
    maxLevel: 2,
    costs: [4, 6],
    title: 'Стойкость рода',
    desc: 'При смерти золото конвертируется в шарды по курсу 12 (затем 10) вместо 15 за шард',
  },
];

// --- Echo exchange (hub NPC #5) -----------------------------------------
// A second, deliberately worse way to get Эхо, for gold/shards that are
// stuck with nothing left to buy (HP/dmg/cd maxed, merchant offers already
// bought, no rare gear to scrap right now). Becoming the new Blairface
// stays the main event — completing even just the FIRST cycle grants
// PRESTIGE_PER_CYCLE_BASE=2 echo directly, on top of everything else that
// comes with it (a new heir, renamed Bishops, a harder-but-richer NG+
// loop). This exchange requires BOTH currencies at once (one combined
// price, not two independent ones) specifically so it can't be maxed out
// by whichever currency happens to be sitting around — it's a genuine
// "cash in the stockpile" moment, not a tap-to-farm loop:
//
//   - Gold resets to 0 on every death (converted to shards instead — see
//     onPlayerDeath), so it can only ever be spent WITHIN a single life.
//     A full 5-Bishop-plus-mirror clear generates roughly 1000-1500 gold
//     total (chests + trash + boss rewards combined, before the
//     difficulty ramp inflates it further) — at 500/exchange, hoarding
//     ALL of one life's gold (skipping every bandage/merchant offer,
//     which is a real risk, not a free choice) buys at most ~2-3.
//   - Shards never reset, but a full clear's boss rewards alone total
//     roughly 25-30 (5-7 per kill x ~5 kills) — at 20/exchange, that's
//     bottlenecked to about 1 exchange per clear even before any of it
//     goes toward the dmg/cd upgrade tracks first (which it should).
//
// Net: at best ~1 echo per full clear sacrificed entirely to this NPC,
// against 2+ from just finishing that same clear normally — deliberately
// worse, so it reads as a release valve for leftover currency, not a
// competing strategy.
const ECHO_EXCHANGE_GOLD_COST = 500;
const ECHO_EXCHANGE_SHARD_COST = 20;

// Death: gold no longer survives as gold at all — it (and any HP above the
// fixed 100 base) converts to shards instead. This upgrade used to keep a
// growing % of gold AS gold; now that nothing does, it instead makes that
// conversion less lossy — a better (lower) rate, by prestigeGoldLevel.
const GOLD_TO_SHARD_RATE_BY_LEVEL = [15, 12, 10]; // gold per shard
// Surplus max-HP above the fixed 100 base (from gear, permanent upgrades,
// prestige starting items — whatever it is) converts too, at this rate.
const HP_SURPLUS_SHARDS_PER_UNIT = 10; // HP per shard

// NG+ per-cycle Bishop buff (see Game.bishopStatMultiplier) and the flat
// bonus the mirror-fight boss gets over the player's own mirrored stats.
const CYCLE_STAT_BONUS_PER_CYCLE = 0.15; // +15% HP/damage per completed cycle

// The pool of room LAYOUTS a run's chain is assembled from — each entry is
// the room factory (platform geometry) plus the enemy/chest contents tuned
// to fit that specific geometry. Since generateRoomChain() (below) now
// picks a random NUMBER of rooms per segment and can reuse the same layout
// more than once in a run, this is a template pool rather than a fixed
// sequence — the enemy/chest coordinates stay valid every time a template
// is picked because they're relative to that template's own platforms, not
// to "which room index this happens to be". Adding a layout is one entry
// here plus a createRoomN() in world.js; there is no per-room switch to
// extend anywhere.
const ROOM_GROUND_SPAWN_Y = 460; // design-unit y that puts a ground entity on the floor

const ROOM_TEMPLATES = [
  {
    create: createRoom1,
    enemies: [[500, 420, 640], [1150, 1050, 1300], [1750, 1700, 1950]],
    chests: [900],
  },
  {
    create: createRoom2,
    enemies: [[600, 500, 750], [1300, 1200, 1450], [2000, 1900, 2150]],
    chests: [1050, 1950],
  },
  {
    create: createRoom3,
    enemies: [[550, 450, 700], [1100, 1000, 1250], [1700, 1600, 1850], [2150, 2050, 2300]],
    chests: [800, 1950],
  },
  {
    create: createRoom4,
    enemies: [[520, 430, 680], [1080, 980, 1240], [1620, 1520, 1800], [2100, 2000, 2280]],
    chests: [860, 1820],
  },
  {
    create: createRoom5,
    enemies: [[480, 400, 660], [980, 900, 1180], [1520, 1420, 1720], [1980, 1880, 2140], [2260, 2180, 2330]],
    chests: [740, 1700],
  },
];

// Bosses that interrupt the chain mid-way, keyed by bishopKey instead of a
// fixed room index — see generateRoomChain() below, which decides at
// startRun() time how many rooms precede each one. `bishopKey` must match an
// entry in BISHOP_REGISTRY (bishops.js) so defeat-tracking/renaming/NG+
// buffs find it. Keons (the registry's 5th and last entry) used to be
// special-cased as "the final boss", entered via its own enterBossRoom()
// with NO room segment in front of it at all — a leftover from an earlier
// version of the registry with only 2 bosses, where "last" and "final"
// happened to be the same boss. He's a normal district Bishop like the
// other four; folding him into this table/order gives him the same random
// 3-5 room segment everyone else gets, and — as a side effect — routes his
// fight through the same enterMidBoss() HUD-clearing path the others use,
// instead of the old enterBossRoom() path that skipped it (see
// continueAfterMidBoss()'s comment for the stale-portal-prompt bug that caused).
const MID_CHAIN_BOSS_DEFS = {
  lisden: { bishopKey: 'lisden', create: (x, y, options) => new LisdenBoss(x, y, options), room: createLisdenRoom, spawnX: 780, spawnY: 420 },
  sakarver: { bishopKey: 'sakarver', create: (x, y, options) => new SakarverBoss(x, y, options), room: createSakarverRoom, spawnX: 700, spawnY: 420 },
  reysdro: { bishopKey: 'reysdro', create: (x, y, options) => new ReysdroBoss(x, y, options), room: createReysdroRoom, spawnX: 760, spawnY: 420 },
  vetomo: { bishopKey: 'vetomo', create: (x, y, options) => new VetomoBoss(x, y, options), room: createVetomoRoom, spawnX: 760, spawnY: 420 },
  keons: { bishopKey: 'keons', create: (x, y, options) => new KeonsBoss(x, y, options), room: createBossRoom, spawnX: 820, spawnY: 420 },
};
// Fixed order the five district Bishops appear in — only the room COUNT
// between them is randomized, not which one comes next. Nothing in the
// request asked for boss order to vary too, and keeping it fixed means
// BISHOP_REGISTRY/save data (bishopNames etc.) doesn't need to change shape.
// Keons stays last (see MID_CHAIN_BOSS_DEFS's comment) — after his own
// segment, the chain is simply exhausted and continueAfterMidBoss()/
// advanceRoom() route straight to the mirror finale (no room segment in
// front of THAT — it isn't a registry Bishop, see MirrorBoss's constructor).
const MID_CHAIN_BOSS_ORDER = ['lisden', 'sakarver', 'reysdro', 'vetomo', 'keons'];

const ROOM_SEGMENT_MIN = 3; // rooms between one Bishop and the next — inclusive
const ROOM_SEGMENT_MAX = 5;

// Builds one run's full room sequence fresh at startRun() time: for each
// Bishop in MID_CHAIN_BOSS_ORDER, a random 3-5 rooms (picked from
// ROOM_TEMPLATES, never the same layout twice in a row), each independently
// assigned a biome (~50/50, see biomes.js) purely for visuals — the
// template's platform geometry is identical either way, only the tileset/
// parallax changes. The last room of each segment carries `triggersBoss` so
// advanceRoom() knows when to break for a boss without needing a separate
// index table.
function generateRoomChain() {
  const chain = [];
  let lastTemplateIndex = -1;
  // Bishops already beaten in an earlier attempt THIS CYCLE (see
  // Game.save.defeatedBishops — persisted, only cleared by onCycleVictory)
  // still get their full room segment for loot/trash, they just don't gate
  // it behind a fight anymore: no triggersBoss means advanceRoom() walks
  // straight through into the next segment instead of calling enterMidBoss.
  const defeatedThisCycle = Game.save.defeatedBishops;
  for (const bishopKey of MID_CHAIN_BOSS_ORDER) {
    const segmentLength = randInt(ROOM_SEGMENT_MIN, ROOM_SEGMENT_MAX);
    for (let i = 0; i < segmentLength; i++) {
      let templateIndex = randInt(0, ROOM_TEMPLATES.length - 1);
      if (ROOM_TEMPLATES.length > 1) {
        while (templateIndex === lastTemplateIndex) templateIndex = randInt(0, ROOM_TEMPLATES.length - 1);
      }
      lastTemplateIndex = templateIndex;
      chain.push({ template: ROOM_TEMPLATES[templateIndex], biome: Math.random() < 0.5 ? 'trench' : 'dema', triggersBoss: null });
    }
    if (!defeatedThisCycle.includes(bishopKey)) {
      chain[chain.length - 1].triggersBoss = bishopKey;
    }
  }
  return chain;
}

// Trash scales with how many Bishops are already down this run (and with
// NG+ cycles), so later stretches stay meaningful against a player who's
// been looting all the way. Used to key off the room index directly, back
// when the chain was a fixed 1-room-per-Bishop sequence; now that each
// segment is a random 3-5 rooms, indexing off "Bishops beaten" keeps the
// difficulty curve's shape independent of how long any given segment
// happened to roll — a 5-room segment doesn't end up harder than a 3-room
// one just because its rooms have higher raw indices.
function enemyStatMultiplier() {
  return (1 + Game.defeatedBishopsThisRun.size * ENEMY_SCALING_PER_ROOM) * (1 + Game.save.cycleCount * CYCLE_STAT_BONUS_PER_CYCLE);
}

// Each slot independently rolls GloriousGone or Bat, 50/50 — deliberately
// NOT keyed to the room's biome (trench vs dema): nothing about a flying
// vs. ground enemy is inherently forest- or city-coded here (both are
// generic dungeon-fantasy trash), so tying them together would just be an
// arbitrary coupling with no gameplay or thematic payoff. Enemy variety and
// biome variety are independent axes.
function spawnEnemiesForRoom(index) {
  const entry = Game.roomChain[index];
  if (!entry) return [];
  const statMul = enemyStatMultiplier();
  return entry.template.enemies.map(([x, patrolMin, patrolMax]) => {
    const EnemyClass = Math.random() < 0.5 ? Bat : GloriousGone;
    return new EnemyClass(
      x * WORLD_SCALE,
      ROOM_GROUND_SPAWN_Y * WORLD_SCALE,
      patrolMin * WORLD_SCALE,
      patrolMax * WORLD_SCALE,
      statMul,
    );
  });
}

function spawnChestsForRoom(index) {
  const entry = Game.roomChain[index];
  if (!entry) return [];
  return entry.template.chests.map((x) => new LootChest(x * WORLD_SCALE, CHEST_GROUND_Y));
}

function defaultBishopNames() {
  const names = {};
  for (const bishop of BISHOP_REGISTRY) names[bishop.key] = bishop.baseName;
  return names;
}

function loadSave() {
  const defaults = {
    gold: 0,
    hpLevel: 0,
    shards: 0,
    dmgUpgradeLevel: 0,
    cdUpgradeLevel: 0,
    // NG+ / meta-loop state — see onCycleVictory()/renameBishopsForNewCycle().
    cycleCount: 0,
    ancestorNames: [],
    bishopNames: defaultBishopNames(),
    // Bishops (by BISHOP_REGISTRY key) beaten so far THIS CYCLE — permanent
    // across deaths/heirs, only ever cleared by onCycleVictory() when the
    // player becomes the new Blairface and NG+ starts. See
    // generateRoomChain()'s use of this and Game.onBossDefeated().
    defeatedBishops: [],
    // Lifetime death count across the whole dynasty (never reset — not even
    // by onCycleVictory, unlike defeatedBishops) — purely a Chronicle-screen
    // statistic, nothing reads it for gameplay. Incremented in onPlayerDeath().
    totalDeaths: 0,
    prestige: 0,
    prestigeWeaponLevel: 0,
    prestigeArmorLevel: 0,
    prestigeSlotLevel: 0,
    prestigeGoldLevel: 0,
    // Which heir_XX.png the current character is drawn as (see heirs.js /
    // Player.draw()). Only the portrait persists here — hpMul/speedMul/name
    // are re-neutralized on a fresh page load by design (activeHeir itself
    // is never persisted, see the top-of-file note), same as before this
    // fix; this just stops the FACE from re-rolling out from under you too.
    heirSkinId: null,
  };
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return {
      gold: parsed.gold || 0,
      hpLevel: parsed.hpLevel || 0,
      shards: parsed.shards || 0,
      dmgUpgradeLevel: parsed.dmgUpgradeLevel || 0,
      cdUpgradeLevel: parsed.cdUpgradeLevel || 0,
      cycleCount: parsed.cycleCount || 0,
      ancestorNames: parsed.ancestorNames || [],
      bishopNames: parsed.bishopNames || defaultBishopNames(),
      defeatedBishops: parsed.defeatedBishops || [],
      totalDeaths: parsed.totalDeaths || 0,
      prestige: parsed.prestige || 0,
      prestigeWeaponLevel: parsed.prestigeWeaponLevel || 0,
      prestigeArmorLevel: parsed.prestigeArmorLevel || 0,
      prestigeSlotLevel: parsed.prestigeSlotLevel || 0,
      prestigeGoldLevel: parsed.prestigeGoldLevel || 0,
      heirSkinId: parsed.heirSkinId || null,
    };
  } catch (e) {
    return defaults;
  }
}

// Read once, shared by both Game.save and Game.activeHeir's initial value
// below — a plain object literal can't reference its own sibling
// properties while being built, so the save has to be loaded before the
// literal starts.
const initialSave = loadSave();

function persistSave(save) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(save));
}

function hpUpgradeCost(hpLevel) {
  return HP_UPGRADE_BASE_COST + hpLevel * HP_UPGRADE_COST_STEP;
}

function dmgUpgradeCost(level) {
  return DMG_UPGRADE_SHARD_COST_BASE + level * DMG_UPGRADE_SHARD_COST_STEP;
}

function cdUpgradeCost(level) {
  return CD_UPGRADE_SHARD_COST_BASE + level * CD_UPGRADE_SHARD_COST_STEP;
}

const Game = {
  save: initialSave,
  state: 'title', // 'title' | 'hub' | 'run' | 'boss' | 'dead' | 'cycleNarrative' | 'cycleHeir'
  room: null,
  roomIndex: 0,
  // This run's generated sequence — see generateRoomChain(). Built fresh by
  // startRun(); empty outside a run (never read while not in 'run'/'boss').
  roomChain: [],
  player: null,
  enemies: [],
  chests: [],
  boss: null,
  isFinaleFight: false,
  // Which BISHOP_REGISTRY keys have been beaten so far THIS run — reset in
  // startRun(). Checked in onBossDefeated() to detect "that was the last
  // one" without hardcoding a count. Never persisted: dying resets it same
  // as everything else about run progress.
  defeatedBishopsThisRun: new Set(),
  // True only while a run is paused in the hub between a mid-chain boss and
  // the next room — see pauseRunInHub(). Governs the portal's label/action
  // in main.js's updateHub(). See the top-of-file note on why this (and the
  // rest of the paused run's state) is in-memory only.
  runInProgress: false,
  camera: { x: 0 },

  // Merchant's rotating stock — see generateMerchantOffers(). Rebuilt fresh
  // on every hub visit (enterHub()/pauseRunInHub()), never mid-run, so it
  // reads as "one-time buffs for this life" rather than an always-on shop.
  merchantOffers: [],

  // The currently-alive character's stat profile — set by choosing a heir on
  // the death screen, and applied to every Player created (hub or run) until
  // the next death. Neutral by default for the very first character (and
  // for every reload that doesn't follow a fresh heir choice — activeHeir
  // itself was never persisted and still isn't; see the top-of-file note).
  // skinId is the one exception: it reads save.heirSkinId if a previous
  // session already chose a face, so a reload can't silently swap it out
  // from under you — only re-rolling randomly when there's truly no saved
  // choice yet (a brand new save).
  activeHeir: { name: 'Ты', hpMul: 1, speedMul: 1, label: 'начальный профиль', skinId: initialSave.heirSkinId || randInt(1, HEIR_SKIN_COUNT) },
  pendingHeirs: null,

  // Heir variation is ALWAYS a fixed % of the game's base stats (BASE_MAX_HP
  // here, MOVE_SPEED in player.js for speed) — never of whatever the
  // previous character's actual end-of-run stats happened to be. That's the
  // whole point: an heir's starting toughness can't be inflated by gear,
  // permanent upgrades, or prestige starting items the character before them
  // was carrying when they died — those all reset every death by
  // construction (a fresh Player is built from scratch in enterHub/startRun).
  // The permanent hpLevel track (gold-bought, account-wide) then applies on
  // top of that fixed heir base, using the exact growth curve it always has.
  currentMaxHp() {
    const heirBase = BASE_MAX_HP * this.activeHeir.hpMul;
    return Math.round(heirBase * Math.pow(1.1, this.save.hpLevel));
  },

  // Permanent, shard-bought — independent of the heir profile (heirs only
  // ever touch hp/speed). Read live by resolveAttack() in main.js for
  // damage, and baked into Player at construction for cooldowns (see
  // buyCdUpgrade()'s live-bump for why that one needs the extra step).
  damageMultiplier() {
    return 1 + this.save.dmgUpgradeLevel * DMG_UPGRADE_PER_LEVEL;
  },

  currentCooldownMul() {
    return 1 - this.save.cdUpgradeLevel * CD_UPGRADE_PER_LEVEL;
  },

  // NG+: every completed cycle (see onCycleVictory) makes every registry
  // Bishop a bit stronger, forever — read fresh at fight-start time by
  // enterMidBoss()/enterBossRoom(), so it doesn't need its own save-bump step.
  // NG+ scaling (permanent, per completed cycle) times the within-run ramp
  // (how many Bishops are already down this attempt).
  bishopStatMultiplier() {
    const cycleBonus = 1 + this.save.cycleCount * CYCLE_STAT_BONUS_PER_CYCLE;
    const chainBonus = 1 + this.defeatedBishopsThisRun.size * CHAIN_DIFFICULTY_PER_BISHOP;
    return cycleBonus * chainBonus;
  },

  // --- prestige ---------------------------------------------------------

  accessorySlotCount() {
    return BASE_ACCESSORY_SLOT_COUNT + this.save.prestigeSlotLevel;
  },

  prestigeLevel(key) {
    const def = PRESTIGE_UPGRADES.find((u) => u.key === key);
    return def ? this.save[def.saveKey] : 0;
  },

  prestigeUpgradeStatus(def) {
    const level = this.save[def.saveKey];
    const maxed = level >= def.maxLevel;
    const cost = maxed ? 0 : def.costs[level];
    return {
      key: def.key,
      title: def.title,
      desc: def.desc,
      level,
      maxLevel: def.maxLevel,
      maxed,
      cost,
      canAfford: !maxed && this.save.prestige >= cost,
    };
  },

  allPrestigeStatuses() {
    return PRESTIGE_UPGRADES.map((def) => this.prestigeUpgradeStatus(def));
  },

  buyPrestigeUpgrade(key) {
    const def = PRESTIGE_UPGRADES.find((u) => u.key === key);
    if (!def) return;
    const level = this.save[def.saveKey];
    if (level >= def.maxLevel) return;
    const cost = def.costs[level];
    if (this.save.prestige < cost) return;
    this.save.prestige -= cost;
    this.save[def.saveKey] = level + 1;
    persistSave(this.save);

    // The slot unlock is the one that changes an already-spawned character
    // rather than only the next run, so live-bump it like the other hub
    // purchases do. The rest only matter at startRun() time.
    if (def.key === 'slot' && this.player) {
      this.player.accessorySlots = ACCESSORY_SLOTS.slice(0, this.accessorySlotCount());
    }
  },

  // See ECHO_EXCHANGE_*'s comment for the balance reasoning. Repeatable —
  // unlike the levelled upgrades, there's no cap; it's a currency sink,
  // not progression of its own.
  echoExchangeStatus() {
    return {
      goldCost: ECHO_EXCHANGE_GOLD_COST,
      shardCost: ECHO_EXCHANGE_SHARD_COST,
      canAfford: this.save.gold >= ECHO_EXCHANGE_GOLD_COST && this.save.shards >= ECHO_EXCHANGE_SHARD_COST,
    };
  },

  buyEchoExchange() {
    if (this.save.gold < ECHO_EXCHANGE_GOLD_COST || this.save.shards < ECHO_EXCHANGE_SHARD_COST) return;
    this.save.gold -= ECHO_EXCHANGE_GOLD_COST;
    this.save.shards -= ECHO_EXCHANGE_SHARD_COST;
    this.save.prestige += 1;
    persistSave(this.save);
  },

  // Applies every "your run starts with…" prestige perk to a freshly built
  // Player. Called from startRun() only: mid-run hub visits must not re-roll
  // starting gear, or the pause between bosses would become a loot fountain.
  applyPrestigeStartingGear(player) {
    if (this.save.prestigeWeaponLevel > 0) {
      // Best of three rolls: a single roll could easily come out worse than
      // the flat mid-roll cleaver it replaces, which would make a 3-echo
      // purchase a coin flip. Replace rather than append — this is the
      // heir's starting armament, not an extra pickup.
      const candidates = [generateWeapon(), generateWeapon(), generateWeapon()];
      candidates.sort((a, b) => weaponScore(b) - weaponScore(a));
      player.weapons = [candidates[0]];
      player.weaponIndex = 0;
    }
    if (this.save.prestigeArmorLevel > 0) player.receiveGear(generateArmor('chest'));
    if (this.save.prestigeArmorLevel > 1) player.receiveGear(generateArmor('helm'));
  },

  // --- title screen -------------------------------------------------------

  // True the moment ANY save has ever been written — not just "save has
  // interesting values" (a save can legitimately be all-zeroes right after
  // startNewGame() and still be "a save"). Used by main.js to decide
  // whether the title screen shows "Продолжить" at all.
  hasSaveProgress() {
    return localStorage.getItem(SAVE_KEY) !== null;
  },

  // Bootstraps into the title screen instead of straight into the hub —
  // see main.js's preloadTiles() callback. No room/player exists yet in
  // this state; main.js renders a static biome backdrop behind the DOM
  // screen instead of the normal game world.
  enterTitle() {
    this.state = 'title';
    HUD.showScreen('title');
  },

  // "Продолжить" on the title screen — save/activeHeir are already the
  // loaded ones (read once at script-init time), so this is just entering
  // the hub with them, same as returning from any other screen.
  continueGame() {
    this.enterHub();
  },

  // "Новая игра" — wipes the save completely and re-derives a fresh one
  // (rather than hand-building the defaults shape here a second time) so
  // this can never drift from what loadSave() considers "empty". Confirmed
  // by main.js BEFORE this is called — this method itself does not ask.
  startNewGame() {
    localStorage.removeItem(SAVE_KEY);
    this.save = loadSave();
    this.pendingHeirs = null;
    // Neutral profile + a fresh random face, exactly like the very first
    // character before any heir was ever chosen (see activeHeir's own
    // top-of-object comment) — heirSkinId is gone now too, so there's no
    // saved face left to prefer over a new roll.
    this.activeHeir = { name: 'Ты', hpMul: 1, speedMul: 1, label: 'начальный профиль', skinId: randInt(1, HEIR_SKIN_COUNT) };
    this.enterHub();
  },

  enterHub() {
    this.room = createHubRoom();
    this.player = new Player(this.room.spawn.x, this.room.spawn.y, this.currentMaxHp(), this.activeHeir.speedMul, this.currentCooldownMul(), this.accessorySlotCount(), this.activeHeir.skinId);
    this.enemies = [];
    this.boss = null;
    this.runInProgress = false;
    this.camera.x = 0;
    this.state = 'hub';
    this.generateMerchantOffers();
    HUD.setBossVisible(false);
    HUD.setWeaponVisible(false);
    HUD.showScreen('game');
  },

  // Rolls a fresh MERCHANT_OFFER_COUNT-item stock: regular (non-rare —
  // that stays chest/boss-drop-only) weapons/gear, priced above the
  // scrapper's sell rate. See the MERCHANT_* constants' comment for why
  // this exists (gold's only sink used to be the bandage).
  generateMerchantOffers() {
    const offers = [];
    for (let i = 0; i < MERCHANT_OFFER_COUNT; i++) {
      if (Math.random() < MERCHANT_OFFER_WEAPON_SHARE) {
        const item = generateWeapon();
        offers.push({ id: `offer-${i}`, kind: 'weapon', item, price: Math.max(20, Math.round(weaponScore(item) * MERCHANT_WEAPON_GOLD_PER_SCORE)) });
      } else {
        const item = generateRandomGear();
        offers.push({ id: `offer-${i}`, kind: 'gear', item, price: Math.max(20, Math.round(itemScore(item) * MERCHANT_GEAR_GOLD_PER_SCORE)) });
      }
    }
    this.merchantOffers = offers;
  },

  rerollMerchantOffers() {
    if (this.save.gold < MERCHANT_REROLL_COST) return;
    this.save.gold -= MERCHANT_REROLL_COST;
    persistSave(this.save);
    this.generateMerchantOffers();
  },

  // Buys and removes one offer (one-time — it doesn't restock until the
  // next hub visit). Returns the bought entry, or null on a stale click
  // (already bought, or can't afford it after all).
  buyMerchantOffer(offerId) {
    const offer = this.merchantOffers.find((o) => o.id === offerId);
    if (!offer || !this.player || this.save.gold < offer.price) return null;
    this.save.gold -= offer.price;
    persistSave(this.save);
    if (offer.kind === 'weapon') this.player.unlockWeapon(offer.item);
    else this.player.receiveGear(offer.item);
    this.merchantOffers = this.merchantOffers.filter((o) => o.id !== offerId);
    return offer;
  },

  merchantOfferStatuses() {
    return this.merchantOffers.map((o) => ({
      id: o.id,
      kind: o.kind,
      name: o.item.name,
      price: o.price,
      canAfford: this.save.gold >= o.price,
    }));
  },

  startRun() {
    // Defensive: shouldn't normally be reachable (onBossDefeated() routes
    // straight to enterMirrorFight() the instant the registry hits 0
    // remaining), but if it ever is, don't hand the player a chain with no
    // Bishops left to fight instead of the finale they've actually earned.
    if (this.save.defeatedBishops.length >= BISHOP_REGISTRY.length) {
      this.enterMirrorFight();
      return;
    }
    this.roomIndex = 0;
    this.defeatedBishopsThisRun = new Set();
    this.isFinaleFight = false;
    this.runInProgress = false;
    this.roomChain = generateRoomChain();
    this.room = this.roomChain[0].template.create();
    this.room.biome = this.roomChain[0].biome;
    this.player = new Player(this.room.spawn.x, this.room.spawn.y, this.currentMaxHp(), this.activeHeir.speedMul, this.currentCooldownMul(), this.accessorySlotCount(), this.activeHeir.skinId);
    this.applyPrestigeStartingGear(this.player);
    this.enemies = spawnEnemiesForRoom(0);
    this.chests = spawnChestsForRoom(0);
    this.boss = null;
    this.camera.x = 0;
    this.state = 'run';
    HUD.setBossVisible(false);
    HUD.setWeaponVisible(true);
    // Clears every hub floating panel, not just the ones a player standing
    // at the portal could plausibly still have open (none of the others
    // overlap the portal's interact range right now — see HubProps) —
    // kept unconditional anyway so a future station placed closer to the
    // portal, or a debug/console-triggered startRun(), can't leave one
    // stuck on screen the way Keons' old enterBossRoom() did (see
    // continueAfterMidBoss()'s comment for that bug).
    HUD.setMerchantPanel(false);
    HUD.setObeliskPanel(false);
    HUD.setEchoPanel(false);
    HUD.setPortalPrompt(false);
    HUD.setHubHint(false);
    HUD.setChestPrompt(false);
    HUD.showScreen('game');
  },

  // Shared by advanceRoom()/continueAfterMidBoss(): moves the player into
  // roomChain[index], repositioned at its spawn with fresh enemies/chests.
  // Never touches HP/weapons/gear — same Player instance throughout a run.
  enterRoomChainIndex(index) {
    const entry = this.roomChain[index];
    this.roomIndex = index;
    this.room = entry.template.create();
    this.room.biome = entry.biome;
    this.player.x = this.room.spawn.x;
    this.player.y = this.room.spawn.y;
    this.player.vx = 0;
    this.player.vy = 0;
    this.enemies = spawnEnemiesForRoom(index);
    this.chests = spawnChestsForRoom(index);
    this.camera.x = 0;
  },

  // Called once the current room's enemies are cleared and the player has
  // reached its exit marker. If this room is the last one in its segment
  // (see generateRoomChain()), fight the Bishop gating it; otherwise
  // advances to the next room. Reaching the end of the WHOLE chain (past
  // Keons' own segment, the last one — see MID_CHAIN_BOSS_ORDER) can only
  // happen here if every Bishop, Keons included, was already dead this
  // cycle and skipped (a live one always has triggersBoss set, which
  // returns above instead of ever reaching this branch) — so it always
  // means the full registry is down, straight to the mirror finale.
  advanceRoom() {
    const currentEntry = this.roomChain[this.roomIndex];
    if (currentEntry.triggersBoss) {
      this.enterMidBoss(MID_CHAIN_BOSS_DEFS[currentEntry.triggersBoss]);
      return;
    }

    const nextIndex = this.roomIndex + 1;
    if (nextIndex < this.roomChain.length) {
      this.enterRoomChainIndex(nextIndex);
      HUD.setChestPrompt(false);
    } else {
      this.enterMirrorFight();
    }
  },

  enterMidBoss(descriptor) {
    this.room = descriptor.room();
    this.player.x = this.room.spawn.x;
    this.player.y = this.room.spawn.y;
    this.player.vx = 0;
    this.player.vy = 0;
    const options = { name: this.save.bishopNames[descriptor.bishopKey], statMul: this.bishopStatMultiplier() };
    this.boss = descriptor.create(descriptor.spawnX * WORLD_SCALE, descriptor.spawnY * WORLD_SCALE, options);
    this.enemies = [];
    this.chests = [];
    this.camera.x = 0;
    this.state = 'boss';
    HUD.setBossVisible(true, this.boss.name);
    HUD.setChestPrompt(false);
  },

  // Resumes the room chain — called from the hub portal (see main.js) once
  // the player is done spending gold/shards after a mid-chain boss
  // (Keons included — see pauseRunInHub()/onBossDefeated()). Only touches
  // position/room/enemies/chests: HP, weapons, and everything else about
  // the player carry over untouched since it's the same Player instance
  // that walked out of the boss fight.
  //
  // The HUD-clearing calls run BEFORE the branch (not just in the "resume
  // the chain" case) — Keons used to be entered via a separate
  // enterBossRoom() that early-returned past all of this, which is exactly
  // why his fight showed a stale "E — путь в лес" portal prompt the whole
  // time. Now that reaching the end of the chain routes to the mirror
  // finale instead of a special-cased boss room, that same mistake would
  // just resurface one step later for the finale if these moved back
  // inside a branch — keep them unconditional.
  continueAfterMidBoss() {
    const nextIndex = this.roomIndex + 1;
    this.runInProgress = false;
    HUD.setBossVisible(false);
    HUD.setWeaponVisible(true);
    HUD.setMerchantPanel(false);
    HUD.setObeliskPanel(false);
    HUD.setEchoPanel(false);
    HUD.setPortalPrompt(false);
    HUD.setHubHint(false);
    HUD.setChestPrompt(false);
    if (nextIndex >= this.roomChain.length) {
      this.enterMirrorFight();
      return;
    }
    this.enterRoomChainIndex(nextIndex);
    this.boss = null;
    this.state = 'run';
  },

  // Sets up the mirror-fight finale: a boss built from a snapshot of the
  // player's CURRENT stats/weapon, taken right now. See MirrorBoss in boss.js
  // for the +20% HP/damage bonus and the phase-1-to-Blairface transformation.
  enterMirrorFight() {
    HUD.setSmoke(false);
    this.room = createMirrorRoom();
    this.player.x = this.room.spawn.x;
    this.player.y = this.room.spawn.y;
    this.player.vx = 0;
    this.player.vy = 0;

    const snapshot = {
      maxHp: this.player.maxHp,
      weaponDamage: this.player.weapon.damage,
      weaponRange: this.player.weapon.range,
      weaponCooldown: this.player.weapon.cooldown,
      moveSpeed: MOVE_SPEED * this.player.speedMul,
      damageReduction: this.player.equipMods.damageReduction,
      // She's drawn as the player's own heir portrait now (see
      // MirrorBoss.draw()) — null on a skinId-less character (the very
      // first, pre-heir "Ты") falls back to the old procedural rendering.
      skinId: this.player.skinId,
    };
    this.boss = new MirrorBoss(this.room.width / 2, this.room.spawn.y, snapshot);
    this.isFinaleFight = true;
    this.enemies = [];
    this.chests = [];
    this.camera.x = 0;
    this.state = 'boss';
    HUD.setBossVisible(true, this.boss.name);
    HUD.setChestPrompt(false);
  },

  // Common boss-death handling: gold + shards always drop. The finale fight
  // resolves into the cycle-victory sequence; every other Bishop (Keons
  // included — he's just the last one in MID_CHAIN_BOSS_ORDER now, not a
  // separate "final boss" case) always pauses the run in the hub. Whether
  // that was the LAST Bishop standing is discovered later, when the player
  // continues from the hub — see continueAfterMidBoss() — not here: this
  // used to short-circuit straight into the mirror finale the instant the
  // registry emptied out, which skipped the hub pause everyone else gets.
  onBossDefeated() {
    this.addGold(this.boss.goldReward);
    this.addShards(randInt(BOSS_SHARD_MIN, BOSS_SHARD_MAX));

    if (this.isFinaleFight) {
      this.onCycleVictory();
      return;
    }

    this.defeatedBishopsThisRun.add(this.boss.bishopKey);
    this.markBishopDefeatedThisCycle(this.boss.bishopKey);
    this.pauseRunInHub();
  },

  // Permanent within a dynasty/cycle — the actual fix for the "Bishops
  // resurrect after death" regression. Only ever cleared by onCycleVictory()
  // (NG+ rebirth). A normal death must NOT touch this: a Bishop beaten in an
  // earlier attempt this cycle stays beaten no matter how many heirs come
  // after, and generateRoomChain() skips fighting them again as a result.
  markBishopDefeatedThisCycle(bishopKey) {
    if (this.save.defeatedBishops.includes(bishopKey)) return;
    this.save.defeatedBishops.push(bishopKey);
    persistSave(this.save);
  },

  // After a mid-chain boss, the run doesn't resume automatically — the
  // player gets a hub visit first to spend the gold/shards just earned,
  // with the exact character they finished the fight with (HP, weapons,
  // weaponIndex, maxHp, speedMul, cooldownMul all untouched — this is the
  // SAME Player instance, just repositioned to the hub spawn). The portal
  // reads "Продолжить забег" while runInProgress is set (see main.js) and
  // calls continueAfterMidBoss() instead of startRun() when interacted with.
  pauseRunInHub() {
    HUD.setSmoke(false);
    this.room = createHubRoom();
    this.player.x = this.room.spawn.x;
    this.player.y = this.room.spawn.y;
    this.player.vx = 0;
    this.player.vy = 0;
    this.enemies = [];
    this.chests = [];
    this.boss = null;
    // Free partial rest — the run's only guaranteed healing, deliberately
    // gated behind having just beaten a Bishop.
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.player.maxHp * HUB_REST_HEAL_FRACTION);
    this.runInProgress = true;
    this.camera.x = 0;
    this.state = 'hub';
    this.generateMerchantOffers();
    HUD.setBossVisible(false);
    HUD.setWeaponVisible(true);
    HUD.showScreen('game');
  },

  // Opens a chest exactly once: gold always, then one roll for gear. The
  // gear roll picks between a weapon (inventory, actively switchable) and a
  // piece of passive equipment (auto-equipped if it beats what's worn —
  // see Player.equipItem / equipment.js).
  openChest(chest) {
    if (chest.opened) return;
    chest.opened = true;
    this.addGold(randInt(CHEST_GOLD_MIN, CHEST_GOLD_MAX));

    if (Math.random() >= CHEST_GEAR_DROP_CHANCE) return;
    if (Math.random() < CHEST_WEAPON_SHARE) {
      this.player.unlockWeapon(generateWeapon());
    } else {
      this.player.receiveGear(generateRandomGear());
    }
  },

  // Every gold pickup in the game routes through here, so the goldFind
  // accessory mod is applied in exactly one place. Upgrade purchases
  // subtract from save.gold directly and are unaffected.
  addGold(amount) {
    const find = this.player ? this.player.equipMods.goldFind : 0;
    this.save.gold += Math.round(amount * (1 + find));
    persistSave(this.save);
  },

  // Shards bank the instant they're picked up. They're also the only thing
  // that survives death now (see onPlayerDeath) — gold and surplus HP both
  // convert INTO shards on death rather than being separately preserved.
  addShards(amount) {
    this.save.shards += amount;
    persistSave(this.save);
  },

  // entry: { kind: 'weapon'|'gear', item } from Player.unequippedItems().
  // Rarity check is per-kind (see the constants above) since weapon and
  // gear scores aren't on the same scale or distribution.
  isRareItem(entry) {
    return entry.kind === 'weapon' ? isRareWeapon(entry.item) : itemQuality(entry.item) >= EQUIP_RARE_QUALITY_THRESHOLD;
  },

  scrapValue(entry) {
    const rare = this.isRareItem(entry);
    const rawScore = entry.kind === 'weapon' ? weaponScore(entry.item) : itemScore(entry.item);
    const perScore = entry.kind === 'weapon' ? SCRAP_WEAPON_GOLD_PER_SCORE : SCRAP_GEAR_GOLD_PER_SCORE;
    const gold = Math.max(1, Math.round(rawScore * perScore));
    const shards = rare ? randInt(SCRAP_RARE_SHARD_MIN, SCRAP_RARE_SHARD_MAX) : 0;
    return { gold, shards, rare };
  },

  // Permanently removes `entry` from the player's inventory and pays out.
  // Returns the payout (with the removed entry) so the caller can show a
  // confirmation, or null if the item was already gone (stale UI click).
  scrapItem(entry) {
    if (!this.player) return null;
    const value = this.scrapValue(entry);
    if (!this.player.removeUnequippedItem(entry)) return null;
    this.addGold(value.gold);
    if (value.shards > 0) this.addShards(value.shards);
    return value;
  },

  // Death no longer lets any gold survive as gold, and no HP/stats carry
  // over to the heir (see currentMaxHp's comment — heirs always start from
  // the fixed base). Instead, everything that WOULD have been lost gets
  // converted into the one currency that IS permanent: all banked gold, plus
  // any maxHp above the fixed BASE_MAX_HP (gear/permanent upgrades/prestige
  // starting items — whatever produced it), each at its own shard rate.
  onPlayerDeath() {
    const goldLost = this.save.gold;
    const goldRate = GOLD_TO_SHARD_RATE_BY_LEVEL[this.save.prestigeGoldLevel] || GOLD_TO_SHARD_RATE_BY_LEVEL[0];
    const goldShards = Math.ceil(goldLost / goldRate);

    const hpSurplus = Math.max(0, this.player.maxHp - BASE_MAX_HP);
    const hpShards = Math.ceil(hpSurplus / HP_SURPLUS_SHARDS_PER_UNIT);

    const shardsGained = goldShards + hpShards;
    this.save.gold = 0;
    this.save.totalDeaths += 1;
    this.addShards(shardsGained); // persists — see addShards()

    this.state = 'dead';
    this.pendingHeirs = rollHeirs();
    HUD.setSmoke(false);
    HUD.setChestPrompt(false);
    HUD.showDeath({ goldLost, goldShards, hpSurplus, hpShards, shardsGained });
    HUD.showScreen('death');
    HUD.showHeirChoices(this.pendingHeirs, (heir) => this.chooseHeir(heir));
  },

  // Picking a heir on the death screen both ends the death screen and spawns
  // the new character in the hub — there's no separate "continue" step.
  chooseHeir(heir) {
    this.activeHeir = heir;
    this.pendingHeirs = null;
    // Persist the face (not the rest of the profile — see loadSave()'s
    // comment) so a reload can't undo the choice.
    this.save.heirSkinId = heir.skinId;
    persistSave(this.save);
    this.enterHub();
  },

  // The mirror-fight/Blairface finale ends in its own narrative beat ("you
  // are the new Blairface") followed by the same heir-choice UI death uses
  // (see showCycleHeirChoice), because the player carries on playing as a
  // descendant either way — there's no separate "you win" screen; every
  // run always continues into either a new heir or a new cycle. This is
  // also where NG+ bookkeeping happens: the just-won heir joins the permanent
  // ancestor-name pool, the cycle counter (bishopStatMultiplier's input)
  // increments, and every registry Bishop gets renamed from that pool.
  onCycleVictory() {
    this.save.ancestorNames.push(this.activeHeir.name);
    // Award scales with how many cycles are already behind you, so later
    // cycles fund the pricier obelisk tiers without needing a grind loop.
    this.save.prestige += PRESTIGE_PER_CYCLE_BASE + this.save.cycleCount;
    this.save.cycleCount += 1;
    this.renameBishopsForNewCycle();
    // The ONE and only place the whole Bishop roster resurrects: becoming
    // the new Blairface and starting NG+. A normal death never reaches here
    // (onPlayerDeath doesn't call this) — see markBishopDefeatedThisCycle.
    this.save.defeatedBishops = [];
    persistSave(this.save);

    this.state = 'cycleNarrative';
    HUD.setSmoke(false);
    HUD.showScreen('cycleNarrative');
  },

  renameBishopsForNewCycle() {
    const names = pickBishopNames(BISHOP_REGISTRY.length, this.save.ancestorNames);
    BISHOP_REGISTRY.forEach((bishop, i) => {
      this.save.bishopNames[bishop.key] = names[i];
    });
  },

  // Shown right after the cycle-narrative screen's "continue" — same heir
  // system as death (heirs.js), just presented as starting a new cycle
  // rather than a restart, and routed to chooseCycleHeir instead of
  // chooseHeir so it doesn't get confused with a normal death.
  showCycleHeirChoice() {
    this.pendingHeirs = rollHeirs();
    this.state = 'cycleHeir';
    HUD.showScreen('cycleHeir');
    HUD.showCycleHeirChoices(this.pendingHeirs, (heir) => this.chooseCycleHeir(heir));
  },

  chooseCycleHeir(heir) {
    this.activeHeir = heir;
    this.pendingHeirs = null;
    this.save.heirSkinId = heir.skinId;
    persistSave(this.save);
    this.enterHub();
  },

  buyHpUpgrade() {
    if (this.save.hpLevel >= HP_UPGRADE_MAX_LEVEL) return;
    const cost = hpUpgradeCost(this.save.hpLevel);
    if (this.save.gold < cost) return;
    this.save.gold -= cost;
    this.save.hpLevel += 1;
    persistSave(this.save);
    // Player's already spawned in the hub with the old maxHp — bump it live
    // so the upgrade is felt immediately instead of only on the next run.
    // (baseMaxHp, not maxHp: the latter is a getter that layers gear on top.)
    if (this.state === 'hub' && this.player) {
      this.player.baseMaxHp = this.currentMaxHp();
      this.player.hp = this.player.maxHp;
    }
  },

  // Repeatable, unlike the levelled upgrades — this is where surplus gold
  // goes once hpLevel is capped, and the main way to enter a late-chain
  // boss fight at something other than whatever HP you limped out with.
  buyBandage() {
    if (!this.player) return;
    if (this.save.gold < BANDAGE_COST) return;
    if (this.player.hp >= this.player.maxHp) return; // no selling no-ops
    this.save.gold -= BANDAGE_COST;
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.player.maxHp * BANDAGE_HEAL_FRACTION);
    persistSave(this.save);
  },

  bandageStatus() {
    const hurt = this.player ? this.player.hp < this.player.maxHp : false;
    return {
      cost: BANDAGE_COST,
      healPct: Math.round(BANDAGE_HEAL_FRACTION * 100),
      canAfford: this.save.gold >= BANDAGE_COST && hurt,
      hurt,
    };
  },

  hpUpgradeStatus() {
    const maxHp = this.currentMaxHp();
    const maxed = this.save.hpLevel >= HP_UPGRADE_MAX_LEVEL;
    const cost = maxed ? 0 : hpUpgradeCost(this.save.hpLevel);
    return { maxHp, maxed, cost, canAfford: !maxed && this.save.gold >= cost };
  },

  buyDmgUpgrade() {
    if (this.save.dmgUpgradeLevel >= DMG_UPGRADE_MAX_LEVEL) return;
    const cost = dmgUpgradeCost(this.save.dmgUpgradeLevel);
    if (this.save.shards < cost) return;
    this.save.shards -= cost;
    this.save.dmgUpgradeLevel += 1;
    persistSave(this.save);
    // No live-bump needed: damageMultiplier() is read fresh by resolveAttack()
    // in main.js on every hit, so this takes effect on the very next attack.
  },

  dmgUpgradeStatus() {
    const level = this.save.dmgUpgradeLevel;
    const maxed = level >= DMG_UPGRADE_MAX_LEVEL;
    const cost = maxed ? 0 : dmgUpgradeCost(level);
    return { bonusPct: Math.round((this.damageMultiplier() - 1) * 100), maxed, cost, canAfford: !maxed && this.save.shards >= cost };
  },

  buyCdUpgrade() {
    if (this.save.cdUpgradeLevel >= CD_UPGRADE_MAX_LEVEL) return;
    const cost = cdUpgradeCost(this.save.cdUpgradeLevel);
    if (this.save.shards < cost) return;
    this.save.shards -= cost;
    this.save.cdUpgradeLevel += 1;
    persistSave(this.save);
    // Unlike damage, the cooldown multiplier is baked into Player at
    // construction time — live-bump the already-spawned hub character so the
    // purchase is felt immediately, same reasoning as buyHpUpgrade().
    // (baseCooldownMul, not cooldownMul: the latter is a gear-aware getter.)
    if (this.state === 'hub' && this.player) {
      this.player.baseCooldownMul = this.currentCooldownMul();
    }
  },

  cdUpgradeStatus() {
    const level = this.save.cdUpgradeLevel;
    const maxed = level >= CD_UPGRADE_MAX_LEVEL;
    const cost = maxed ? 0 : cdUpgradeCost(level);
    return { reductionPct: Math.round((1 - this.currentCooldownMul()) * 100), maxed, cost, canAfford: !maxed && this.save.shards >= cost };
  },

  // "Летопись рода" — a read-only stats dump across the WHOLE dynasty (every
  // cycle, every heir), not just the current one. ancestorNames is already
  // in cycle-completion order (see onCycleVictory's push), so pairing it
  // with a 1-based index is exactly "which cycle did this ancestor fall in
  // (i.e. become Blairface and hand off) at" — nothing else needs deriving.
  chronicleData() {
    return {
      totalDeaths: this.save.totalDeaths,
      cyclesCompleted: this.save.cycleCount,
      currentHeirName: this.activeHeir.name,
      ancestors: this.save.ancestorNames.map((name, i) => ({ name, cycle: i + 1 })),
    };
  },
};
