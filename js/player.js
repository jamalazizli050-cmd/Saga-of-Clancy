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
  constructor(x, y, maxHp, speedMul = 1, cooldownMul = 1, accessorySlotCount = BASE_ACCESSORY_SLOT_COUNT, skinId = null) {
    this.x = x;
    this.y = y;
    this.w = 28 * WORLD_SCALE;
    this.h = 40 * WORLD_SCALE;
    this.vx = 0;
    this.vy = 0;
    this.grounded = false;
    this.facing = 1;
    this.skinId = skinId;
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

    // Set for exactly the frame an attack is triggered; game.js reads it
    // to resolve damage against enemies, then it's consumed.
    this.pendingHitbox = null;
  }

  get weapon() {
    // Falls back to the first weapon if the index is ever stale. Nothing in
    // normal play should leave it out of range, but when something did the
    // failure surfaced as a TypeError deep inside render() rather than
    // anywhere near the cause — a graceful degrade is worth the one line.
    return this.weapons[this.weaponIndex] || this.weapons[0];
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
  // explicit target: the first empty one, or (all full) the weakest-scoring
  // occupant. Shared by the auto-equip convenience path and by the
  // inventory screen's "equip this" click when it's an accessory, since
  // both need the same "which slot" decision.
  pickAccessoryTargetSlot() {
    const emptySlot = this.accessorySlots.find((slot) => !this.equipment[slot]);
    if (emptySlot) return emptySlot;
    return this.accessorySlots.reduce((worst, slot) =>
      itemScore(this.equipment[slot]) < itemScore(this.equipment[worst]) ? slot : worst, this.accessorySlots[0]);
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
  // Equips it ONLY if it's an actual upgrade over what's worn — but unlike
  // the old equipItem(), failing that check is a no-op on an item that's
  // already safely sitting in gearInventory, never a loss.
  autoEquipIfBetter(item) {
    if (item.slotType === 'accessory') {
      const slot = this.pickAccessoryTargetSlot();
      const current = this.equipment[slot];
      if (!current || itemScore(item) > itemScore(current)) this.equipFromInventory(item, slot);
      return;
    }
    const slot = item.slotType; // 'helm' | 'chest'
    const current = this.equipment[slot];
    if (!current || itemScore(item) > itemScore(current)) this.equipFromInventory(item, slot);
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

  // Inventory-screen click on an owned-but-inactive weapon: just switches to
  // it (same effect as the in-run Q cycle) — the previously active weapon
  // stays owned and simply becomes the "unequipped" one, so it reappears in
  // unequippedItems() with nothing to lose or restore.
  manualEquipWeapon(weapon) {
    const idx = this.weapons.indexOf(weapon);
    if (idx === -1) return false;
    this.weaponIndex = idx;
    return true;
  }

  // Adds a weapon to the owned list (deduped by id) and equips it, so
  // finding new gear from a chest feels immediate. No-op if already owned.
  unlockWeapon(weapon) {
    if (this.weapons.some((w) => w.id === weapon.id)) return false;
    this.weapons.push(weapon);
    this.weaponIndex = this.weapons.length - 1;
    return true;
  }

  // Everything the inventory screen's grid and the scrapper's sell list both
  // need: every owned weapon that ISN'T the currently active one, plus every
  // piece of gear in gearInventory — tagged so callers can tell them apart
  // without caring how each is stored internally.
  unequippedItems() {
    const items = [];
    this.weapons.forEach((weapon, i) => {
      if (i !== this.weaponIndex) items.push({ kind: 'weapon', item: weapon });
    });
    for (const item of this.gearInventory) items.push({ kind: 'gear', item });
    return items;
  }

  // Permanent removal for the scrapper (Game.scrapItem) — entry must be one
  // returned by unequippedItems(), i.e. never the active weapon or anything
  // currently worn.
  removeUnequippedItem(entry) {
    if (entry.kind === 'weapon') {
      const idx = this.weapons.indexOf(entry.item);
      if (idx === -1 || idx === this.weaponIndex) return false;
      this.weapons.splice(idx, 1);
      if (idx < this.weaponIndex) this.weaponIndex -= 1;
      return true;
    }
    const idx = this.gearInventory.indexOf(entry.item);
    if (idx === -1) return false;
    this.gearInventory.splice(idx, 1);
    return true;
  }

  update(dt, room, canAttack) {
    this.pendingHitbox = null;

    // --- timers ---
    this.jumpCooldownTimer = Math.max(0, this.jumpCooldownTimer - dt);
    this.dashCooldownTimer = Math.max(0, this.dashCooldownTimer - dt);
    this.attackCooldownTimer = Math.max(0, this.attackCooldownTimer - dt);
    this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    if (this.attackActiveTimer > 0) this.attackActiveTimer -= dt;
    if (this.dashTimer > 0) this.dashTimer -= dt;
    if (this.knockbackTimer > 0) this.knockbackTimer -= dt;

    // --- weapon switch (Digit2/3 only valid once that many weapons are owned —
    // see unlockWeapon; owned count can be 1 early in a run) ---
    if (Input.wasPressed('Digit1') && this.weapons.length > 0) this.weaponIndex = 0;
    else if (Input.wasPressed('Digit2') && this.weapons.length > 1) this.weaponIndex = 1;
    else if (Input.wasPressed('Digit3') && this.weapons.length > 2) this.weaponIndex = 2;
    else if (Input.wasPressed('KeyQ')) this.weaponIndex = (this.weaponIndex + 1) % this.weapons.length;

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
      this.dashCooldownTimer = DASH_COOLDOWN * this.cooldownMul;
      this.vy = 0;
    }

    // --- attack (keyboard J or left mouse button — same cooldown/hitbox either way) ---
    if (canAttack && Input.wasPressedAny(['KeyJ', 'Mouse0']) && this.attackCooldownTimer <= 0) {
      const w = this.weapon;
      this.attackCooldownTimer = w.cooldown * this.cooldownMul;
      const swing = weaponSwingProfile(w);
      this.attackActiveDuration = swing.duration;
      this.attackActiveTimer = swing.duration;
      this.attackSwingArc = swing.arc;
      this.pendingHitbox = computeMeleeHitbox(this, w.range, w.damage);
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
    const mitigated = amount * (1 - this.equipMods.damageReduction);
    this.hp = Math.max(0, this.hp - mitigated);
    this.invulnTimer = HIT_INVULN_DURATION;

    Effects.hit(this.x + this.w / 2, this.y + this.h / 2, mitigated, '#e8a0a0');
    const dir = fromX !== null ? (sign(this.x + this.w / 2 - fromX) || -this.facing) : -this.facing;
    this.knockbackVx = dir * PLAYER_KNOCKBACK_FORCE;
    this.knockbackTimer = PLAYER_KNOCKBACK_DURATION;
    this.vy = Math.min(this.vy, -PLAYER_KNOCKBACK_HOP);
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

    // Swing arc: a rotating blade sweeping from a raised wind-up to an
    // extended finish, with a filled wedge trailing behind it to sell the
    // motion — replaces the old static "flash rectangle" (which read as a
    // hitbox indicator, not a strike). Duration/arc come from
    // weaponSwingProfile() at the moment the attack was triggered (see
    // update()): fast weapons sweep a short arc quickly, slow ones sweep a
    // wide arc slowly. Purely visual — computeMeleeHitbox's rectangle is
    // still what actually resolves damage, unrelated to this angle.
    if (this.attackActiveTimer > 0) {
      const w = this.weapon;
      const dir = this.facing;
      const t = clamp(1 - this.attackActiveTimer / this.attackActiveDuration, 0, 1);
      const arc = this.attackSwingArc;
      const localStart = -arc / 2;
      const localCur = localStart + arc * t;
      const absStart = dir > 0 ? localStart : Math.PI - localStart;
      const absCur = dir > 0 ? localCur : Math.PI - localCur;
      const pivotX = dir > 0 ? sx + this.w * 0.72 : sx + this.w * 0.28;
      const pivotY = this.y + this.h * 0.42;

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
