// Loot chests: static interactable props placed in the normal run rooms
// (never the boss room). Same proximity + "E — interact" pattern as the
// hub's merchant/portal, just triggered from Game.openChest() instead.

const CHEST_W = 36 * WORLD_SCALE;
const CHEST_H = 26 * WORLD_SCALE;
const CHEST_INTERACT_RANGE = 90 * WORLD_SCALE;
const CHEST_GOLD_MIN = 15;
const CHEST_GOLD_MAX = 35;
// Chance a chest contains gear at all, and — if it does — how often that
// gear is a weapon rather than a piece of passive equipment. Weapons keep
// the larger share because they're the slot the player actively pilots.
const CHEST_GEAR_DROP_CHANCE = 0.7;
const CHEST_WEAPON_SHARE = 0.45;
// If the gear roll lands on a weapon, how often that weapon is a bow rather
// than a melee one. Under half, because the melee slot is the one the player
// leans on constantly while arrows are rationed — bows shouldn't out-drop
// the weapon type that gets used every fight.
const CHEST_BOW_SHARE = 0.4;
// Arrows roll INDEPENDENTLY of the gold/gear rolls above, so a chest can
// hand over ammo and a weapon both. Roughly every other chest, at a few
// arrows a time: enough to keep the bow live across a run without ever
// letting it become the answer to everything (see STARTING_ARROWS).
const CHEST_ARROW_CHANCE = 0.5;
const CHEST_ARROW_MIN = 2;
const CHEST_ARROW_MAX = 5;

// Colour of the halo a non-ordinary chest carries, keyed to the room kind
// that placed it (see spawnChestsForRoom) so a reliquary reads as "not a
// normal chest" from across the room, before the player is close enough for
// the interact prompt.
const CHEST_VARIANT_GLOW = {
  choice: '#d1b13c',
  secret: '#b58ac9',
};

class LootChest {
  // variant: 'loot' (ordinary chest loot) | 'choice' (treasure room's pick
  // one) | 'secret' (the rare find). Game.openChest branches on it — every
  // other behaviour here is identical, which is the point of reusing this
  // class instead of adding a parallel interactable.
  constructor(x, groundY, variant = 'loot') {
    this.w = CHEST_W;
    this.h = CHEST_H;
    this.x = x;
    this.y = groundY - CHEST_H;
    this.opened = false;
    this.variant = variant;
  }

  draw(ctx, camX, highlighted, timestamp = 0) {
    const sx = this.x - camX;
    const img = TileImages[this.opened ? 'chest_open' : 'chest_closed'];
    const glow = CHEST_VARIANT_GLOW[this.variant];

    // Slow pulse behind a special chest — procedural, no new art, and it
    // stops the moment the chest is spent so the room reads as done.
    if (glow && !this.opened) {
      const pulse = 0.35 + Math.sin(timestamp / 320) * 0.15;
      const r = this.w * 1.5;
      const cx = sx + this.w / 2;
      const cy = this.y + this.h / 2;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, glow + Math.round(pulse * 90).toString(16).padStart(2, '0'));
      grad.addColorStop(1, glow + '00');
      ctx.fillStyle = grad;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }

    if (img) {
      ctx.drawImage(img, sx, this.y, this.w, this.h);
    } else {
      ctx.fillStyle = this.opened ? '#3a3428' : (highlighted ? '#8a6a34' : '#6b4f26');
      ctx.fillRect(sx, this.y, this.w, this.h);
      ctx.fillStyle = this.opened ? '#2a2620' : '#caa96a';
      ctx.fillRect(sx, this.y, this.w, this.h * 0.35);
    }

    if (highlighted && !this.opened) {
      ctx.strokeStyle = glow || '#d1b13c';
      ctx.strokeRect(sx - 3 * WORLD_SCALE, this.y - 3 * WORLD_SCALE, this.w + 6 * WORLD_SCALE, this.h + 6 * WORLD_SCALE);
    }
  }
}

// Room's own ground level (see createRoomN in world.js) is hardcoded here
// the same way enemy spawn heights already are in spawnEnemiesForRoom.
const CHEST_GROUND_Y = 500 * WORLD_SCALE;

// Chest placement now lives with the rest of the room contents in
// ROOM_CHAIN (game.js); spawnChestsForRoom() reads it from there.
