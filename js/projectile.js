// Arrow: the one projectile type in the game, fired by a ranged ('лук')
// weapon — see Player.update()'s attack block and main.js's wiring
// (Game.projectiles). A real flying projectile, not a melee hitbox with
// extra steps: it arcs downward over time and keeps flying until it either
// lands on a platform/floor, flies past a room edge, or connects with an
// enemy (resolved the same way a melee swing's hitbox is, see main.js's
// resolveAttack()).
//
// Deliberately its OWN gravity, far weaker than the player's (GRAVITY,
// world.js). The vertical space an arrow has to work with is tiny: it's
// fired from chest height with only ~30 world units of clearance to the
// floor, so anything close to the player's own jump-tuned gravity buries it
// in the ground almost immediately — indistinguishable from a melee hit,
// and unable to reach a Bat (which hovers in a band ABOVE the arrow's
// launch height, so an arrow that dips even slightly passes underneath it).
// At this value the shot stays nearly level for its first ~400 units and
// only then visibly arcs down, landing after roughly 800 (slow bow) to 1400
// (fast bow) units — a real ranged weapon that still, as asked, falls to the
// floor when it misses.
const ARROW_GRAVITY = 60 * WORLD_SCALE; // px/s^2

// The weapon's own `range` stat does NOT cap how far the arrow can fly
// (that was the original design and it was a bug: WEAPON_RANGE_MIN/MAX are
// 33-117 world units, and at any sane speed the arrow covered that in well
// under a tenth of a second — indistinguishable from a melee swing landing
// instantly in front of the player). Instead `range` scales arrow speed —
// a higher-range bow roll shoots a faster, flatter arrow — so the stat
// still matters without artificially cutting the shot short.
const ARROW_SPEED_MIN = 620 * WORLD_SCALE; // px/s, at WEAPON_RANGE_MIN
const ARROW_SPEED_MAX = 1100 * WORLD_SCALE; // px/s, at WEAPON_RANGE_MAX
const ARROW_W = 26 * WORLD_SCALE;
const ARROW_H = 6 * WORLD_SCALE;

class Arrow {
  // x/y: spawn position (already offset to the bow hand — see where this is
  // constructed in main.js). facing: +1/-1. range: the firing weapon's own
  // `range` stat, mapped to arrow speed (see ARROW_SPEED_MIN/MAX above).
  // color: matches the bow's own weapon.color, so the arrow reads as
  // "belonging" to that weapon the same way a melee swing's trail does.
  //
  // owner: 'player' (always, at spawn — every Arrow starts life fired BY the
  // player, there's no other source of one) | 'enemy'. Read by main.js's
  // projectile loop to decide who it can hurt: a 'player' arrow resolves
  // against enemies/the boss same as always; an 'enemy' one resolves against
  // the player instead. The only way an arrow ever becomes 'enemy' is
  // MirrorBoss.reflectArrow() (phase 2, Blairface) bouncing it back — see
  // boss.js. That flip happens exactly once: reflectArrow() is only ever
  // offered a 'player' arrow (main.js's owner-branch checks that first), so
  // an already-'enemy' arrow can never be reflected a second time.
  constructor(x, y, facing, damage, range, color) {
    this.x = x;
    this.y = y;
    this.w = ARROW_W;
    this.h = ARROW_H;
    this.facing = facing;
    const speedT = clamp((range - WEAPON_RANGE_MIN) / (WEAPON_RANGE_MAX - WEAPON_RANGE_MIN), 0, 1);
    this.vx = facing * lerp(ARROW_SPEED_MIN, ARROW_SPEED_MAX, speedT);
    this.vy = 0;
    this.damage = damage;
    this.color = color;
    this.alive = true;
    this.angle = 0; // updated each frame to face the arc's current direction
    this.owner = 'player';
  }

  update(dt, room) {
    if (!this.alive) return;
    this.vy += ARROW_GRAVITY * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.angle = Math.atan2(this.vy, this.vx);

    if (this.x < -this.w || this.x > room.width) {
      this.alive = false;
      return;
    }
    // Lands the instant it touches the floor or any platform/wall — it
    // doesn't slide along or tunnel through, it just stops flying right
    // where it struck (an enemy hit is resolved separately, by main.js,
    // one frame after this update — see resolveAttack()).
    for (const p of room.platforms) {
      if (aabbIntersect(this, p)) {
        this.alive = false;
        return;
      }
    }
  }

  draw(ctx, camX) {
    if (!this.alive) return;
    const sx = this.x - camX;
    const cx = sx + this.w / 2;
    const cy = this.y + this.h / 2;

    ctx.save();
    ctx.translate(cx, cy);
    // Face the direction of travel, mirrored horizontally when flying
    // leftward so the arrowhead/fletching still read the right way round.
    if (this.facing < 0) {
      ctx.scale(-1, 1);
      ctx.rotate(-this.angle);
    } else {
      ctx.rotate(this.angle);
    }

    // A simple arrowhead-tipped shaft — a thin body with a small triangular
    // point at the leading edge and two short fletching lines at the back.
    ctx.fillStyle = this.color;
    ctx.fillRect(-this.w / 2, -this.h / 4, this.w * 0.7, this.h / 2);
    ctx.beginPath();
    ctx.moveTo(this.w / 2, 0);
    ctx.lineTo(this.w * 0.2, -this.h);
    ctx.lineTo(this.w * 0.2, this.h);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = this.color;
    ctx.lineWidth = Math.max(1, this.h * 0.3);
    ctx.beginPath();
    ctx.moveTo(-this.w / 2, 0);
    ctx.lineTo(-this.w / 2 - this.h, -this.h);
    ctx.moveTo(-this.w / 2, 0);
    ctx.lineTo(-this.w / 2 - this.h, this.h);
    ctx.stroke();

    ctx.restore();
  }
}
