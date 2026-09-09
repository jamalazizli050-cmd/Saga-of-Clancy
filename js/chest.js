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

class LootChest {
  constructor(x, groundY) {
    this.w = CHEST_W;
    this.h = CHEST_H;
    this.x = x;
    this.y = groundY - CHEST_H;
    this.opened = false;
  }

  draw(ctx, camX, highlighted) {
    const sx = this.x - camX;
    const img = TileImages[this.opened ? 'chest_open' : 'chest_closed'];

    if (img) {
      ctx.drawImage(img, sx, this.y, this.w, this.h);
    } else {
      ctx.fillStyle = this.opened ? '#3a3428' : (highlighted ? '#8a6a34' : '#6b4f26');
      ctx.fillRect(sx, this.y, this.w, this.h);
      ctx.fillStyle = this.opened ? '#2a2620' : '#caa96a';
      ctx.fillRect(sx, this.y, this.w, this.h * 0.35);
    }

    if (highlighted && !this.opened) {
      ctx.strokeStyle = '#d1b13c';
      ctx.strokeRect(sx - 3 * WORLD_SCALE, this.y - 3 * WORLD_SCALE, this.w + 6 * WORLD_SCALE, this.h + 6 * WORLD_SCALE);
    }
  }
}

// Room's own ground level (see createRoomN in world.js) is hardcoded here
// the same way enemy spawn heights already are in spawnEnemiesForRoom.
const CHEST_GROUND_Y = 500 * WORLD_SCALE;

// Chest placement now lives with the rest of the room contents in
// ROOM_CHAIN (game.js); spawnChestsForRoom() reads it from there.
