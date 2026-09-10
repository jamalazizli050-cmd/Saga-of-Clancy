// Player: movement + gravity, and the three cooldown-gated actions
// (jump / dash / attack). No stamina anywhere — every action is either
// ready or waiting out its own cooldown timer.

const MOVE_SPEED = 260 * WORLD_SCALE; // px/s
const JUMP_VELOCITY = -620 * WORLD_SCALE; // px/s
const JUMP_COOLDOWN = 0.25; // s, prevents jump-spam even while grounded
const DASH_SPEED = 700 * WORLD_SCALE; // px/s
const DASH_DURATION = 0.15; // s
const DASH_COOLDOWN = 0.8; // s
const HIT_INVULN_DURATION = 0.6; // s

// Knockback on taking a hit: a short window where input-driven movement is
// overridden by a fixed sideways impulse (see update()'s movement block,
// which checks knockbackTimer before reading WASD) plus a small upward pop
// so it reads as a "hop back", not a slide. Deliberately mild compared to
// what an enemy gets knocked with (see enemy.js) — being shoved around a
// platformer's edges/pits while YOU'RE the one taking damage is punishing in
// a way that doesn't feel earned, so this is tuned to sell the hit without
// meaningfully displacing the player off a ledge.
const PLAYER_KNOCKBACK_FORCE = 220 * WORLD_SCALE; // px/s
const PLAYER_KNOCKBACK_DURATION = 0.12; // s
const PLAYER_KNOCKBACK_HOP = 160 * WORLD_SCALE; // px/s, upward

// Swing feel (part of the hit-impact pass): duration and arc both scale with
// the weapon's own cooldown, so a fast light weapon reads as a short snappy
// flick and a slow heavy one reads as a wide telegraphed haymaker — using
// weapons.js's own min/max cooldown band as the 0..1 reference range. Purely
// a draw()-time visual; the actual gameplay hitbox (computeMeleeHitbox) is
// untouched, so this changes nothing about range/damage/balance.
const ATTACK_SWING_DURATION_MIN = 0.08; // s, fastest weapon
const ATTACK_SWING_DURATION_MAX = 0.22; // s, slowest weapon
const ATTACK_SWING_ARC_MIN = 60 * (Math.PI / 180); // fastest weapon: a quick flick
const ATTACK_SWING_ARC_MAX = 150 * (Math.PI / 180); // slowest weapon: a wide haymaker

// Arrows are the one consumable resource in the game — every other action is
// gated purely by its own cooldown. Enough to matter from the first room
// without turning the bow into the default answer to everything; chests top
// it back up (see CHEST_ARROW_* in chest.js).
const STARTING_ARROWS = 10;

function weaponSwingProfile(w) {
  const heavyT = clamp((w.cooldown - WEAPON_COOLDOWN_MIN) / (WEAPON_COOLDOWN_MAX - WEAPON_COOLDOWN_MIN), 0, 1);
  return {
    duration: clamp(w.cooldown * 0.5, ATTACK_SWING_DURATION_MIN, ATTACK_SWING_DURATION_MAX),
    arc: ATTACK_SWING_ARC_MIN + heavyT * (ATTACK_SWING_ARC_MAX - ATTACK_SWING_ARC_MIN),
  };
}

class Player {
  // skinId: which heir_XX.png/_mirrored.png pair to draw this character as
  // (1-12, see heirs.js's rollHeirs()) — null for the very first character
  // (never rolled from a death screen) and for any activeHeir that predates
  // this feature, both of which fall back to the plain rectangle in draw().
  // Chosen once at heir-selection time and never re-rolled, so it's just
  // carried through the constructor like every other "who is this
  // character" value (maxHp, speedMul) rather than recomputed anywhere.
  constructor(x, y, maxHp, speedMul = 1, cooldownMul = 1, accessorySlotCount = BASE_ACCESSORY_SLOT_COUNT, skinId = null, archetype = null) {
    this.x = x;
    this.y = y;
    this.w = 28 * WORLD_SCALE;
    this.h = 40 * WORLD_SCALE;
    this.vx = 0;
    this.vy = 0;
    this.grounded = false;
    this.facing = 1;
    this.skinId = skinId;
    // The active heir's archetype key (see heirs.js's HEIR_ARCHETYPES), or
    // null for the plain baseline profile. Read by this class's own dash/
    // takeDamage/heal below, and by main.js's resolveAttack() for the
    // melee/bow/execute hooks — never by anything in boss.js, which is what
    // keeps MirrorBoss's numeric-only player snapshot honest (see
    // Game.enterMirrorFight()'s comment).
    this.archetype = archetype;
    this.anim = new SpriteAnimator();

    // "base" values come from the heir profile + permanent hub upgrades;
    // equipment mods are layered on top by the getters below. Everything
    // that consumes these reads the getter, so equipping a item mid-run
    // takes effect immediately with no recompute call at the use site.
    this.baseSpeedMul = speedMul;
    this.baseCooldownMul = cooldownMul;
    this.baseMaxHp = maxHp;

    // Passive-gear slots (see equipment.js). Weapons are separate: they're
    // an inventory with active switching, gear is not. The accessory slot
    // count is variable — the 4th is a prestige unlock.
    this.equipment = {};
    for (const slot of EQUIP_SLOTS) this.equipment[slot] = null;
    this.accessorySlots = ACCESSORY_SLOTS.slice(0, accessorySlotCount);
    this.equipMods = emptyEquipMods();

    // Every found-but-not-worn piece of gear (armor/accessories only —
    // weapons have their own `weapons` list above). Nothing is ever dropped
    // from here except by the scrapper (Game.scrapItem) — see receiveGear().
    this.gearInventory = [];

    this.hp = maxHp;
    this.invulnTimer = 0;

    this.jumpCooldownTimer = 0;
    this.dashTimer = 0;
    this.dashCooldownTimer = 0;
    this.attackCooldownTimer = 0;
    this.attackActiveTimer = 0;
    this.attackActiveDuration = 0;
    this.attackSwingArc = 0;

    // Knockback override — see PLAYER_KNOCKBACK_* above.
    this.knockbackTimer = 0;
    this.knockbackVx = 0;

    this.weaponIndex = 0;
    // Owned weapons for this run — starts with just the guaranteed cleaver;
    // everything else is procedurally generated chest loot (see weapons.js /
    // Game.openChest). A fresh Player is created per run/hub-visit, so this
    // always resets cleanly.
    this.weapons = [STARTING_WEAPON];

    // The ranged slot: its own owned-list + active index, entirely parallel
    // to weapons/weaponIndex above and NOT competing with it. Both a melee
    // weapon and a bow are equipped at once — left mouse swings one, right
    // mouse fires the other, each on its own cooldown timer.
    this.bowIndex = 0;
    this.bows = [STARTING_BOW];
    this.arrows = STARTING_ARROWS;
    this.bowCooldownTimer = 0;
    // Bow-draw pose visual, the ranged counterpart to attackActiveTimer.
    // Separate so a shot and a swing can be mid-animation simultaneously —
    // sharing one timer made whichever fired second cut the other's pose off.
    this.bowDrawTimer = 0;
    this.bowDrawDuration = 0;

    // Set for exactly the frame an attack is triggered; game.js reads it
    // to resolve damage against enemies, then it's consumed.
    this.pendingHitbox = null;
    // Same one-frame handoff as pendingHitbox above, but for the bow's shot —
    // main.js turns this into an actual Arrow (see projectile.js) and pushes
    // it into Game.projectiles. Both can now be set on the same frame: the
    // two weapons are independent actions on independent cooldowns.
    this.pendingProjectile = null;
  }

  get weapon() {
    // Falls back to the first weapon if the index is ever stale. Nothing in
    // normal play should leave it out of range, but when something did the
    // failure surfaced as a TypeError deep inside render() rather than
    // anywhere near the cause — a graceful degrade is worth the one line.
    return this.weapons[this.weaponIndex] || this.weapons[0];
  }

  get bow() {
    return this.bows[this.bowIndex] || this.bows[0];
  }

  get isDashing() {
    return this.dashTimer > 0;
  }

  // --- derived stats: base (heir + permanent upgrades) x equipped gear ---

  get maxHp() {
    return Math.round(this.baseMaxHp + this.equipMods.bonusHp);
  }

  get speedMul() {
    return this.baseSpeedMul * (1 + this.equipMods.speedBonus);
  }

  get cooldownMul() {
    return this.baseCooldownMul * (1 - this.equipMods.cooldownReduction);
  }

  // Sums every equipped item's mods into one object the getters above read.
  // Called on every equip change; nothing else should write equipMods.
  recomputeEquipmentMods() {
    const previousMaxHp = this.maxHp;
    const totals = emptyEquipMods();
    for (const slot of EQUIP_SLOTS) {
      const item = this.equipment[slot];
      if (!item) continue;
      for (const key of EQUIP_MOD_KEYS) totals[key] += item.mods[key] || 0;
    }
    totals.damageReduction = Math.min(totals.damageReduction, EQUIP_MAX_DAMAGE_REDUCTION);
    this.equipMods = totals;

    // Gaining +maxHp shouldn't silently heal, and losing it shouldn't leave
    // hp above the new ceiling: carry the delta, then clamp.
    const delta = this.maxHp - previousMaxHp;
    if (delta > 0) this.hp += delta;
    this.hp = clamp(this.hp, 0, this.maxHp);
  }

  // Which accessory slot a piece of gear should land in when there's no
  // explicit target: the first empty one, or (all full) the occupant
  // contributing least to damage/mitigation — the same two axes auto-equip
  // judges on (see isCombatUpgrade), so a candidate is always measured
  // against the piece it's most likely to legitimately beat. Shared by the
  // auto-equip convenience path and by the inventory screen's "equip this"
  // click when it's an accessory, since both need the same "which slot"
  // decision.
  pickAccessoryTargetSlot() {
    const emptySlot = this.accessorySlots.find((slot) => !this.equipment[slot]);
    if (emptySlot) return emptySlot;
    return this.accessorySlots.reduce((worst, slot) =>
      combatValue(this.equipment[slot]) < combatValue(this.equipment[worst]) ? slot : worst, this.accessorySlots[0]);
  }

  // Core equip primitive: item MUST currently be in gearInventory (both the
  // manual inventory-screen click and the auto-equip path push it there
  // first, so this never has to special-case "where did it come from").
  // Whatever was previously in `slot` goes back to gearInventory instead of
  // being discarded — nothing equipped is ever lost, only swapped.
  equipFromInventory(item, slot) {
    const idx = this.gearInventory.indexOf(item);
    if (idx === -1) return false;
    this.gearInventory.splice(idx, 1);
    const previous = this.equipment[slot];
    this.equipment[slot] = item;
    if (previous) this.gearInventory.push(previous);
    this.recomputeEquipmentMods();
    return true;
  }

  // Inventory-screen click on a worn slot: sends it back to the grid.
  unequipToInventory(slot) {
    const item = this.equipment[slot];
    if (!item) return null;
    this.equipment[slot] = null;
    this.gearInventory.push(item);
    this.recomputeEquipmentMods();
    return item;
  }

  // Convenience-only pass, used right after receiveGear() stores the item.
  // Equips it only if it beats what's worn on damage or on incoming-damage
  // mitigation (see isCombatUpgrade) — failing that check is a no-op on an
  // item that's already safely sitting in gearInventory, never a loss.
  autoEquipIfBetter(item) {
    const slot = item.slotType === 'accessory' ? this.pickAccessoryTargetSlot() : item.slotType;
    if (isCombatUpgrade(item, this.equipment[slot])) this.equipFromInventory(item, slot);
  }

  // Every piece of found armor/accessory gear MUST come through here (chests,
  // prestige starting gear, anywhere else): it is unconditionally preserved
  // in gearInventory first, and auto-equip is only ever a convenience on top
  // of that guarantee — never the only place the item is stored.
  receiveGear(item) {
    this.gearInventory.push(item);
    this.autoEquipIfBetter(item);
  }

  // Inventory-screen click on a grid item that's a piece of gear: always
  // equips it (no upgrade-check gate — that's only for the passive
  // chest-pickup convenience path), swapping the current occupant back to
  // the grid rather than discarding it.
  manualEquipGear(item, slot = null) {
    const resolvedSlot = slot || (item.slotType === 'accessory' ? this.pickAccessoryTargetSlot() : item.slotType);
    return this.equipFromInventory(item, resolvedSlot);
  }

  // Which owned-list a given weapon belongs to. Bows and melee weapons are
  // the same KIND of item everywhere else (same generator, same budget, same
  // describeWeaponFull/weaponScore/isRareWeapon, same inventory cell) — they
  // differ only in which slot holds them, so every list-touching method below
  // routes through this one check rather than duplicating the pair of paths.
  weaponListFor(weapon) {
    return isRangedWeapon(weapon) ? this.bows : this.weapons;
  }

  activeIndexFor(weapon) {
    return isRangedWeapon(weapon) ? this.bowIndex : this.weaponIndex;
  }

  // Inventory-screen click on an owned-but-inactive weapon: just switches to
  // it (same effect as the in-run Q / B cycle) — the previously active one
  // stays owned and simply becomes the "unequipped" one, so it reappears in
  // unequippedItems() with nothing to lose or restore. A bow lands in the bow
  // slot, a melee weapon in the melee slot; neither can displace the other.
  manualEquipWeapon(weapon) {
    const idx = this.weaponListFor(weapon).indexOf(weapon);
    if (idx === -1) return false;
    if (isRangedWeapon(weapon)) this.bowIndex = idx;
    else this.weaponIndex = idx;
    return true;
  }

  // Adds a weapon to the owned list for its own slot (deduped by id) and
  // equips it, so finding new gear from a chest feels immediate. No-op if
  // already owned.
  unlockWeapon(weapon) {
    const list = this.weaponListFor(weapon);
    if (list.some((w) => w.id === weapon.id)) return false;
    list.push(weapon);
    if (isRangedWeapon(weapon)) this.bowIndex = list.length - 1;
    else this.weaponIndex = list.length - 1;
    return true;
  }

  // Everything the inventory screen's grid and the scrapper's sell list both
  // need: every owned weapon and bow that ISN'T the active one for its slot,
  // plus every piece of gear in gearInventory — tagged so callers can tell
  // them apart without caring how each is stored internally. Bows are tagged
  // 'weapon' like any other weapon; only the slot routing above cares.
  unequippedItems() {
    const items = [];
    this.weapons.forEach((weapon, i) => {
      if (i !== this.weaponIndex) items.push({ kind: 'weapon', item: weapon });
    });
    this.bows.forEach((bow, i) => {
      if (i !== this.bowIndex) items.push({ kind: 'weapon', item: bow });
    });
    for (const item of this.gearInventory) items.push({ kind: 'gear', item });
    return items;
  }

  // Permanent removal for the scrapper (Game.scrapItem) — entry must be one
  // returned by unequippedItems(), i.e. never an active weapon/bow or
  // anything currently worn.
  removeUnequippedItem(entry) {
    if (entry.kind === 'weapon') {
      const ranged = isRangedWeapon(entry.item);
      const list = this.weaponListFor(entry.item);
      const activeIdx = this.activeIndexFor(entry.item);
      const idx = list.indexOf(entry.item);
      if (idx === -1 || idx === activeIdx) return false;
      list.splice(idx, 1);
      if (idx < activeIdx) {
        if (ranged) this.bowIndex -= 1;
        else this.weaponIndex -= 1;
      }
      return true;
    }
    const idx = this.gearInventory.indexOf(entry.item);
    if (idx === -1) return false;
    this.gearInventory.splice(idx, 1);
    return true;
  }

  update(dt, room, canAttack) {
    this.pendingHitbox = null;
    this.pendingProjectile = null;

    // --- timers ---
    this.jumpCooldownTimer = Math.max(0, this.jumpCooldownTimer - dt);
    this.dashCooldownTimer = Math.max(0, this.dashCooldownTimer - dt);
    this.attackCooldownTimer = Math.max(0, this.attackCooldownTimer - dt);
    this.bowCooldownTimer = Math.max(0, this.bowCooldownTimer - dt);
    this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    if (this.attackActiveTimer > 0) this.attackActiveTimer -= dt;
    if (this.bowDrawTimer > 0) this.bowDrawTimer -= dt;
    if (this.dashTimer > 0) this.dashTimer -= dt;
    if (this.knockbackTimer > 0) this.knockbackTimer -= dt;

    // --- weapon switch (Digit2/3 only valid once that many weapons are owned —
    // see unlockWeapon; owned count can be 1 early in a run) ---
    if (Input.wasPressed('Digit1') && this.weapons.length > 0) this.weaponIndex = 0;
    else if (Input.wasPressed('Digit2') && this.weapons.length > 1) this.weaponIndex = 1;
    else if (Input.wasPressed('Digit3') && this.weapons.length > 2) this.weaponIndex = 2;
    else if (Input.wasPressed('KeyQ')) this.weaponIndex = (this.weaponIndex + 1) % this.weapons.length;

    // Bow slot cycles on its own key — a separate statement, not part of the
    // chain above, because it's a separate slot: switching bows must never
    // also consume a melee-switch press.
    if (Input.wasPressed('KeyB')) this.bowIndex = (this.bowIndex + 1) % this.bows.length;

    // --- horizontal movement ---
    if (this.knockbackTimer > 0) {
      // Overrides WASD/dash entirely for a brief window — see
      // PLAYER_KNOCKBACK_* / takeDamage(). Expires on its own via the timer
      // decrement above; nothing needs to explicitly end it.
      this.vx = this.knockbackVx;
    } else if (this.isDashing) {
      this.vx = this.facing * DASH_SPEED * this.speedMul;
    } else {
      const left = Input.isDownAny(['KeyA', 'ArrowLeft']);
      const right = Input.isDownAny(['KeyD', 'ArrowRight']);
      if (left && !right) { this.vx = -MOVE_SPEED * this.speedMul; this.facing = -1; }
      else if (right && !left) { this.vx = MOVE_SPEED * this.speedMul; this.facing = 1; }
      else this.vx = 0;
    }

    // --- jump ---
    if (Input.wasPressedAny(['Space', 'KeyW', 'ArrowUp']) && this.grounded && this.jumpCooldownTimer <= 0) {
      this.vy = JUMP_VELOCITY;
      this.grounded = false;
      this.jumpCooldownTimer = JUMP_COOLDOWN * this.cooldownMul;
    }

    // --- dash ---
    if (Input.wasPressedAny(['ShiftLeft', 'ShiftRight', 'KeyK']) && this.dashCooldownTimer <= 0 && !this.isDashing) {
      this.dashTimer = DASH_DURATION;
      // Runner: a shorter leash on the one button that gets you out of
      // danger, so dashing more often is a real option, not just a slightly
      // faster jog.
      const dashCdMul = this.archetype === 'runner' ? RUNNER_DASH_COOLDOWN_MUL : 1;
      this.dashCooldownTimer = DASH_COOLDOWN * this.cooldownMul * dashCdMul;
      this.vy = 0;
      // Runner: the dash itself becomes a brief dodge — a window to dash
      // INTO/THROUGH a telegraphed hit (Reysdro's committed side, Vetomo's
      // counter, Sakarver's lunge, Keons mid-chase) instead of only ever
      // using it to close/open distance. Layered on top of whatever
      // post-hit invulnerability is already running, never shortening it.
      if (this.archetype === 'runner') this.invulnTimer = Math.max(this.invulnTimer, RUNNER_DASH_IFRAME);
    }

    // --- melee attack (keyboard J or LEFT mouse button) ---
    if (canAttack && Input.wasPressedAny(['KeyJ', 'Mouse0']) && this.attackCooldownTimer <= 0) {
      const w = this.weapon;
      this.attackCooldownTimer = w.cooldown * this.cooldownMul;
      const swing = weaponSwingProfile(w);
      this.attackActiveDuration = swing.duration;
      this.attackActiveTimer = swing.duration;
      this.attackSwingArc = swing.arc;
      this.pendingHitbox = computeMeleeHitbox(this, w.range, w.damage);
    }

    // --- bow shot (RIGHT mouse button) ---
    // Entirely independent of the melee block above: its own cooldown timer,
    // its own weapon, its own pose timer. The two can be alternated freely,
    // and neither one's cooldown blocks the other. Costs one arrow — the only
    // consumable in the game, so unlike every other action this can be
    // "ready" and still do nothing.
    if (canAttack && Input.wasPressed('Mouse2') && this.bowCooldownTimer <= 0 && this.arrows > 0) {
      const b = this.bow;
      this.arrows -= 1;
      this.bowCooldownTimer = b.cooldown * this.cooldownMul;
      const draw = weaponSwingProfile(b);
      this.bowDrawDuration = draw.duration;
      this.bowDrawTimer = draw.duration;
      // `range` doesn't cap flight distance (see projectile.js) — it scales
      // the arrow's speed, and the arrow then flies under gravity until it
      // lands or hits something. Fired from roughly bow-hand height/depth on
      // the player's sprite, the same anchor computeMeleeHitbox uses for its
      // own facing-dependent x.
      const spawnX = this.facing > 0 ? this.x + this.w : this.x - 4 * WORLD_SCALE;
      // Upper chest rather than mid-body: it's where a drawn bow actually
      // sits, and the few extra units of clearance above the floor measurably
      // extend the shot before its arc grounds it.
      const spawnY = this.y + this.h * 0.32;
      this.pendingProjectile = { x: spawnX, y: spawnY, facing: this.facing, damage: b.damage, range: b.range, color: b.color };
    }

    stepPhysics(this, dt, room);
    this.anim.update(dt, Math.abs(this.vx) > 1, this.grounded);
  }

  // fromX: world-space x of whatever hit us, used only to pick which way to
  // knock back (see PLAYER_KNOCKBACK_*) — null (any hazard that doesn't have
  // a sensible single source point) falls back to knocking back away from
  // wherever the player is currently facing.
  takeDamage(amount, fromX = null) {
    if (this.invulnTimer > 0) return;
    // Armour/accessory mitigation. Capped in recomputeEquipmentMods(), so
    // this can never reach or exceed 1 and zero out incoming damage.
    // Survivor's flat bonus mitigation is applied AFTER that (multiplicative,
    // not added to the same pool) — it never needs its own cap: stacked with
    // the gear cap's worst case (55%), total mitigation still tops out well
    // under 100%, so this can never make the player unkillable.
    const survivorMul = this.archetype === 'survivor' ? 1 - SURVIVOR_DAMAGE_REDUCTION : 1;
    const mitigated = amount * (1 - this.equipMods.damageReduction) * survivorMul;
    this.hp = Math.max(0, this.hp - mitigated);
    this.invulnTimer = HIT_INVULN_DURATION;

    Effects.hit(this.x + this.w / 2, this.y + this.h / 2, mitigated, '#e8a0a0');
    const dir = fromX !== null ? (sign(this.x + this.w / 2 - fromX) || -this.facing) : -this.facing;
    this.knockbackVx = dir * PLAYER_KNOCKBACK_FORCE;
    this.knockbackTimer = PLAYER_KNOCKBACK_DURATION;
    this.vy = Math.min(this.vy, -PLAYER_KNOCKBACK_HOP);
  }

  // The ONE path every heal in the game routes through (bandage, hub rest,
  // the treasure room's "heal" pick — see their call sites in game.js) so
  // Survivor's penalty lives in exactly one place instead of three. Returns
  // the actual HP gained (post-multiplier, post-ceiling-clamp) so callers
  // that report a number to the player show the real one, not the nominal
  // amount requested.
  heal(amount) {
    const survivorMul = this.archetype === 'survivor' ? SURVIVOR_HEAL_MUL : 1;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount * survivorMul);
    return Math.round(this.hp - before);
  }

  // The original procedural look — still what draws whenever there's no
  // chosen skin (the very first character of a session, before any death
  // has offered heir_XX portraits) or, defensively, if a skin was chosen
  // but its image somehow isn't in TileImages (e.g. a dropped network
  // request) — so a missing asset degrades to a rectangle, never a crash
  // or a blank frame.
  // Draws at local (0,0,w,h) — the caller (draw(), via SpriteAnimator) has
  // already translated to wherever on screen that needs to end up, so this
  // never has to know about camera/position/animation transforms.
  drawFallbackBody(ctx, w = this.w, h = this.h) {
    ctx.fillStyle = this.isDashing ? '#e8dca0' : '#cfd6e4';
    ctx.fillRect(0, 0, w, h);

    // Facing indicator
    ctx.fillStyle = '#1b1e24';
    const eyeX = this.facing > 0 ? w - 8 * WORLD_SCALE : 4 * WORLD_SCALE;
    ctx.fillRect(eyeX, 8 * WORLD_SCALE, 4 * WORLD_SCALE, 4 * WORLD_SCALE);
  }

  draw(ctx, camX) {
    const sx = this.x - camX;

    // Body art is drawn at ENTITY_VISUAL_SCALE, anchored to the hitbox's
    // bottom-center (feet stay planted on this.y+this.h — see
    // ENTITY_VISUAL_SCALE's comment) — everything below that keeps using
    // the real this.x/y/w/h for the swing pivot / hp readouts / hitbox math.
    const vw = this.w * ENTITY_VISUAL_SCALE;
    const vh = this.h * ENTITY_VISUAL_SCALE;
    const vsx = sx - (vw - this.w) / 2;
    const vy = this.y - (vh - this.h);

    // Brief hit-flash / dash trail feedback via alpha instead of sprites.
    ctx.globalAlpha = this.invulnTimer > 0 ? (Math.floor(this.invulnTimer * 20) % 2 === 0 ? 0.4 : 1) : 1;

    // Pre-mirrored art means facing left/right is just picking a different
    // file — no ctx.scale(-1,1) flip logic needed here. The base art faces
    // LEFT (confirmed against the actual files — facing>0 is right, which
    // needs the _mirrored file).
    const skinKey = this.skinId
      ? `heir_${String(this.skinId).padStart(2, '0')}${this.facing > 0 ? '_mirrored' : ''}`
      : null;
    const skinImg = skinKey ? TileImages[skinKey] : null;

    this.anim.draw(ctx, vsx, vy, vw, vh, {
      moving: Math.abs(this.vx) > 1,
      grounded: this.grounded,
      facing: this.facing,
    }, (lctx) => {
      if (skinImg) {
        lctx.drawImage(skinImg, 0, 0, vw, vh);
        // Dash feedback has no dedicated art — a translucent tint over just
        // the sprite's own opaque pixels (source-atop) keeps the same visual
        // cue the old fillRect had without needing a second dash sprite.
        if (this.isDashing) {
          lctx.save();
          lctx.globalCompositeOperation = 'source-atop';
          lctx.fillStyle = 'rgba(232, 220, 160, 0.55)';
          lctx.fillRect(0, 0, vw, vh);
          lctx.restore();
        }
      } else {
        this.drawFallbackBody(lctx, vw, vh);
      }
    });

    ctx.globalAlpha = 1;

    const dir = this.facing;
    const pivotX = dir > 0 ? sx + this.w * 0.72 : sx + this.w * 0.28;
    const pivotY = this.y + this.h * 0.42;

    // Bowstring recoil, on its OWN timer (bowDrawTimer) rather than the melee
    // swing's — the two weapons fire independently now, so both poses can be
    // on screen at once and neither may cut the other short. A rotating blade
    // sweep wouldn't suit a bow anyway: it fires instantly on press (no
    // charge-up), so the string reads as pulled back at release (t=0) easing
    // forward to rest (t=1). Purely visual — the Arrow's own travel is what
    // resolves damage.
    if (this.bowDrawTimer > 0) {
      const b = this.bow;
      const t = clamp(1 - this.bowDrawTimer / this.bowDrawDuration, 0, 1);
      const bowHeight = this.h * 0.85;
      const bowBulge = 8 * WORLD_SCALE * dir;
      const pullback = (1 - t) * 14 * WORLD_SCALE;

      ctx.save();
      ctx.translate(pivotX, pivotY);
      ctx.strokeStyle = b.color;
      ctx.lineCap = 'round';

      ctx.lineWidth = 3 * WORLD_SCALE;
      ctx.beginPath();
      ctx.moveTo(0, -bowHeight / 2);
      ctx.quadraticCurveTo(bowBulge, 0, 0, bowHeight / 2);
      ctx.stroke();

      ctx.lineWidth = 1.5 * WORLD_SCALE;
      ctx.beginPath();
      ctx.moveTo(0, -bowHeight / 2);
      ctx.lineTo(-dir * pullback, 0);
      ctx.lineTo(0, bowHeight / 2);
      ctx.stroke();

      ctx.restore();
    }

    // Melee swing arc, driven by attackActiveTimer/Duration from
    // weaponSwingProfile() — fast weapons resolve quickly, slow ones linger.
    if (this.attackActiveTimer > 0) {
      const w = this.weapon;
      const t = clamp(1 - this.attackActiveTimer / this.attackActiveDuration, 0, 1);
      const arc = this.attackSwingArc;
      const localStart = -arc / 2;
      const localCur = localStart + arc * t;
      const absStart = dir > 0 ? localStart : Math.PI - localStart;
      const absCur = dir > 0 ? localCur : Math.PI - localCur;

      ctx.save();
      ctx.translate(pivotX, pivotY);

      ctx.globalAlpha = 0.3;
      ctx.fillStyle = w.color;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, w.range, absStart, absCur, dir < 0);
      ctx.closePath();
      ctx.fill();

      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = w.color;
      ctx.lineWidth = 4 * WORLD_SCALE;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(absCur) * w.range, Math.sin(absCur) * w.range);
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }
}
