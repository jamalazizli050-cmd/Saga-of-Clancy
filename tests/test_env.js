// Minimal headless-DOM-free harness for running the game's plain-<script>
// files directly under Node via vm, so game-logic methods (Game.*, Player,
// equipment generators, etc.) can be exercised without a browser. Only
// stubs what's touched at script-LOAD time (HUD.init()'s getElementById
// calls, Input.init()'s addEventListener calls, localStorage) — anything
// touched only inside functions we don't call doesn't need a stub.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeFakeEl() {
  // A real Set-backed classList (not just no-op stubs) so tests can assert
  // on visibility (classList.toggle('hidden', bool) / .contains('hidden'))
  // instead of only on whether a call happened.
  const classes = new Set();
  const el = {
    classList: {
      toggle(name, force) {
        const on = force === undefined ? !classes.has(name) : !!force;
        if (on) classes.add(name); else classes.delete(name);
        return on;
      },
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
    style: {},
    children: [],
    addEventListener() {},
    appendChild(child) { el.children.push(child); return child; },
    removeChild() {},
    set innerHTML(v) { el.children = []; },
    get innerHTML() { return ''; },
  };
  return el;
}

function makeLocalStorage() {
  const store = {};
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
    clear() { for (const k of Object.keys(store)) delete store[k]; },
  };
}

function buildSandbox() {
  const sandbox = {};
  sandbox.console = console;
  sandbox.Math = Math;
  sandbox.localStorage = makeLocalStorage();
  // A no-op 2D context, enough for anything that only *draws* during a test.
  // spriteAnim.js's drawSpriteTinted() creates one offscreen <canvas> lazily
  // (the hit-flash fix — see its comment), so createElement('canvas') has to
  // hand back something with getContext or every draw()-exercising test dies.
  // Every call made into an offscreen canvas context lands here, so a test
  // can assert on what the tint buffer actually received (that's where the
  // hit-flash tint now happens — the main canvas only ever sees the finished
  // blit). Tests clear it themselves before the call they care about.
  sandbox.__offscreenCalls = [];

  const makeFakeCanvas = () => {
    const el = makeFakeEl();
    el.width = 0;
    el.height = 0;
    el.getContext = () => {
      const rec = sandbox.__offscreenCalls;
      let composite = 'source-over';
      let fillStyle = null;
      let alpha = 1;
      return {
        save() {}, restore() {},
        clearRect() { rec.push({ kind: 'clearRect' }); },
        drawImage(img) { rec.push({ kind: 'drawImage', img, composite }); },
        fillRect(x, y, w, h) { rec.push({ kind: 'fillRect', x, y, w, h, composite, fillStyle, alpha }); },
        translate() {}, scale() {}, rotate() {}, beginPath() {}, closePath() {},
        moveTo() {}, lineTo() {}, arc() {}, fill() {}, stroke() {},
        createRadialGradient: () => ({ addColorStop() {} }),
        set globalAlpha(v) { alpha = v; }, get globalAlpha() { return alpha; },
        set globalCompositeOperation(v) { composite = v; }, get globalCompositeOperation() { return composite; },
        set fillStyle(v) { fillStyle = v; }, get fillStyle() { return fillStyle; },
        set strokeStyle(v) {}, set lineWidth(v) {},
        set lineCap(v) {}, set lineJoin(v) {}, set font(v) {}, set textAlign(v) {},
      };
    };
    return el;
  };

  sandbox.document = {
    getElementById() { return makeFakeEl(); },
    createElement(tag) { return tag === 'canvas' ? makeFakeCanvas() : makeFakeEl(); },
    // icons.js's buildItemIconSvg() builds a real <svg> via createElementNS
    // — the fake element just needs setAttribute (no-op) and an innerHTML
    // setter (no-op, same as createElement's fake nodes above).
    createElementNS() { const el = makeFakeEl(); el.setAttribute = () => {}; return el; },
    addEventListener() {},
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  sandbox.requestAnimationFrame = () => 0;
  sandbox.Image = function Image() {};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

// Same load order as index.html's <script> tags, minus main.js (we drive
// Game's methods directly instead of running the render loop).
const FILES = [
  'js/utils.js', 'js/effects.js', 'js/spriteAnim.js', 'js/tiles.js', 'js/input.js', 'js/weapons.js', 'js/projectile.js', 'js/equipment.js', 'js/icons.js',
  'js/world.js', 'js/player.js', 'js/enemy.js', 'js/boss.js', 'js/bishops.js',
  'js/chest.js', 'js/rooms.js', 'js/heirs.js', 'js/hub.js', 'js/hud.js', 'js/game.js',
];

// Names we want reachable from the Node side. Top-level `const`/`let`/`class`
// declarations in a vm-run script live in that context's lexical environment,
// NOT as enumerable properties of the sandbox object — so `sandbox.Game` is
// undefined even though `Game` is a valid identifier *inside* the context.
// This final in-context snippet copies everything we need onto a plain
// object we can read normally from outside.
const EXPORT_NAMES = [
  'Game', 'BASE_MAX_HP', 'MOVE_SPEED', 'GOLD_TO_SHARD_RATE_BY_LEVEL', 'HP_SURPLUS_SHARDS_PER_UNIT',
  'computeMaxHp', 'Player', 'EQUIP_SLOTS', 'ACCESSORY_SLOTS', 'BASE_ACCESSORY_SLOT_COUNT',
  'generateArmor', 'generateAccessory', 'generateRandomGear', 'itemScore', 'itemQuality',
  'isCombatUpgrade', 'combatValue',
  'emptyEquipMods', 'EQUIP_MOD_KEYS',
  'hpUpgradeCost', 'HP_UPGRADE_MAX_LEVEL', 'HP_UPGRADE_BASE_COST', 'HP_UPGRADE_COST_MULT',
  'ROOM_KINDS', 'CHALLENGE_VARIANTS', 'CHALLENGE_WAVE_COUNT', 'ROOM_REWARD_TIERS', 'ROOM_BANNER_DURATION',
  'TREASURE_CHOICES', 'TREASURE_GOLD', 'TREASURE_ARROWS', 'TREASURE_HEAL_FRACTION', 'ELITE_STAT_MUL',
  'rollRoomKind', 'rollChallengeVariant', 'roomKindBanner', 'isPeacefulRoom',
  'bloodCovenantCost', 'canOfferBloodCovenant', 'BLOOD_COST_FRACTION', 'BLOOD_MIN_HP_FRACTION',
  'generateRoomChain', 'spawnEnemiesForRoom', 'spawnChestsForRoom', 'ROOM_TEMPLATES', 'MID_CHAIN_BOSS_ORDER',
  'ARROW_BUNDLE_SIZE', 'ARROW_BUNDLE_COST', 'BANDAGE_COST',
  'SakarverBoss', 'SAKARVER_BASE_ATTACK_COOLDOWN', 'SAKARVER_MIN_COOLDOWN_MUL',
  'MirrorBoss', 'BLAIREFACE_REFLECT_COLOR', 'MIRROR_TRANSFORM_DURATION', 'BLAIREFACE_PHASE2_HP_FRACTION',
  'HEIR_ARCHETYPES', 'rollHeirs',
  'BERSERKER_MELEE_BONUS', 'BERSERKER_MIN_NEARBY', 'BERSERKER_RADIUS',
  'HUNTER_BOW_BONUS', 'HUNTER_MELEE_PENALTY',
  'RUNNER_DASH_COOLDOWN_MUL', 'RUNNER_DASH_IFRAME',
  'EXECUTIONER_LOW_HP_FRACTION', 'EXECUTIONER_LOW_HP_BONUS', 'EXECUTIONER_FULL_HP_FRACTION', 'EXECUTIONER_FULL_HP_PENALTY',
  'SURVIVOR_DAMAGE_REDUCTION', 'SURVIVOR_HEAL_MUL',
  'DASH_COOLDOWN', 'HIT_INVULN_DURATION', 'computeMeleeHitbox',
  'PRESTIGE_UPGRADES', 'PRESTIGE_PER_CYCLE_BASE', 'ECHO_EXCHANGE_GOLD_COST', 'ECHO_EXCHANGE_SHARD_COST',
  'armorScoreBounds', 'ACCESSORY_AFFIXES', 'ARMOR_DR_MIN', 'ARMOR_DR_MAX', 'ARMOR_HP_MIN', 'ARMOR_HP_MAX',
  'generateWeapon', 'generateBow', 'weaponScore', 'isRareWeapon', 'isRangedWeapon', 'WEAPON_RARE_SCORE_THRESHOLD',
  'STARTING_WEAPON', 'STARTING_BOW', 'STARTING_ARROWS',
  'CHEST_ARROW_CHANCE', 'CHEST_ARROW_MIN', 'CHEST_ARROW_MAX', 'CHEST_BOW_SHARE', 'CHEST_GOLD_MIN', 'CHEST_GOLD_MAX',
  'WEAPON_NOUNS', 'MELEE_WEAPON_NOUNS', 'RANGED_WEAPON_NOUNS', 'WEAPON_ICONS',
  'Arrow', 'ARROW_SPEED_MIN', 'ARROW_SPEED_MAX', 'WEAPON_RANGE_MIN', 'WEAPON_RANGE_MAX',
  'GRAVITY', 'JUMP_VELOCITY', 'ROOM_GROUND_SPAWN_Y', 'Bat', 'GloriousGone',
  'rollHeirs', 'HUD', 'Room', 'WORLD_SCALE', 'EQUIP_RARE_QUALITY_THRESHOLD',
  'SCRAP_GEAR_GOLD_PER_SCORE', 'SCRAP_WEAPON_GOLD_PER_SCORE', 'SCRAP_RARE_SHARD_MIN', 'SCRAP_RARE_SHARD_MAX',
  'SpriteAnimator', 'WALK_BOUNCE_AMPLITUDE', 'WALK_BOUNCE_RATE', 'WALK_TILT_MAX',
  'IDLE_BOB_AMPLITUDE', 'IDLE_BOB_RATE', 'AIR_STRETCH_X', 'AIR_STRETCH_Y',
  'LAND_SQUASH_X', 'LAND_SQUASH_Y', 'LAND_SQUASH_DURATION', 'TELEGRAPH_SHAKE_AMPLITUDE',
  'GloriousGone', 'LootChest',
];

function loadGame(root) {
  const sandbox = buildSandbox();
  for (const rel of FILES) {
    const code = fs.readFileSync(path.join(root, rel), 'utf8');
    vm.runInContext(code, sandbox, { filename: rel });
  }
  const exportSnippet = `({ ${EXPORT_NAMES.map((n) => `${n}: (typeof ${n} !== 'undefined' ? ${n} : undefined)`).join(', ')} })`;
  const exported = vm.runInContext(exportSnippet, sandbox, { filename: 'export.js' });
  exported.__sandbox = sandbox;
  return exported;
}

module.exports = { loadGame };
