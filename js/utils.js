// Small shared helpers used across every module below.

// Single source of truth for the world's spatial scale. Every px-based size,
// position, or speed constant in the game is written as its original design
// value times WORLD_SCALE, so bumping this one number resizes the whole
// world (platforms, entities, HUD) together without breaking proportions.
// Time-based values (cooldowns, durations) intentionally do NOT scale with
// this — pacing shouldn't change just because the world got bigger.
const WORLD_SCALE = 1.5;

// Draw-only oversize for character art (player/enemies/bosses): the sprite
// is painted bigger than its own hitbox, anchored at the hitbox's
// bottom-center (feet stay planted, the extra size grows upward/outward) —
// see each draw()'s visual-box math. Hitboxes/collision/aabbIntersect never
// see this; it exists purely so combat doesn't read as small figures lost
// against a room's mostly-empty sky. A true camera-zoom pass (rescaling the
// whole visible room, not just character art) was attempted and reverted —
// see main.js's git history / the request notes — because biomes.js's
// parallax backdrops are written in screen-space-relative terms (CANVAS_H
// fractions, camX-based tiling loops) that broke under a global transform;
// this is the safe subset of that idea that doesn't touch the render
// pipeline's coordinate system at all.
const ENTITY_VISUAL_SCALE = 1.25;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function sign(n) {
  return n > 0 ? 1 : (n < 0 ? -1 : 0);
}

function aabbIntersect(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}

// The one melee-hitbox shape used everywhere in the game: a box extending
// `range` in front of `entity` (whichever way it's facing), inset vertically
// by 4*WORLD_SCALE top/bottom. Player.update() uses this for its own attack,
// and MirrorBoss reuses it verbatim so her attacks are mechanically
// identical to the player's rather than a separate reimplementation.
function computeMeleeHitbox(entity, range, damage) {
  return {
    x: entity.facing > 0 ? entity.x + entity.w : entity.x - range,
    y: entity.y + 4 * WORLD_SCALE,
    w: range,
    h: entity.h - 8 * WORLD_SCALE,
    damage,
  };
}
