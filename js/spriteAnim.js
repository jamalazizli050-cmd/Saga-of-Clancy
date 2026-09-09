// Cheap procedural "juice" for otherwise-static sprites: walk bounce/tilt,
// jump stretch, landing squash, idle bob, and boss telegraph shake. Every
// effect is a canvas transform (translate/rotate/scale) applied around the
// sprite's own center, restored immediately after — no new art, no sprite
// sheets, nothing that scales with entity count beyond one small object per
// animated entity.
//
// One SpriteAnimator instance per animated entity (player, each enemy, each
// boss). Hub NPCs (merchant/scrapper) are stationary enough that they just
// inline a one-line sine bob in hub.js using IDLE_BOB_RATE/AMPLITUDE below
// instead of carrying a whole instance — see idleBob() there.

const WALK_BOUNCE_AMPLITUDE = 3 * WORLD_SCALE;      // px, y-bob while walking
const WALK_BOUNCE_RATE = 9;                          // rad/s phase advance at any walk speed
const WALK_TILT_MAX = (4 * Math.PI) / 180;           // ~4 degrees, lean toward the movement direction
const IDLE_BOB_AMPLITUDE = 1.5 * WORLD_SCALE;        // px, slow standing sway
const IDLE_BOB_RATE = 2.2;                           // rad/s

const AIR_STRETCH_X = 0.9;                           // scale while airborne (jump/fall)
const AIR_STRETCH_Y = 1.1;
const LAND_SQUASH_X = 1.15;                          // scale spike right on landing
const LAND_SQUASH_Y = 0.85;
const LAND_SQUASH_DURATION = 0.13;                   // s, decays back to normal (spec: ~100-150ms)

const TELEGRAPH_SHAKE_AMPLITUDE = 1.5 * WORLD_SCALE; // px, random jitter while a boss telegraphs

class SpriteAnimator {
  constructor() {
    this.walkPhase = 0;
    this.idlePhase = 0;
    this.wasGrounded = true;
    this.landTimer = 0; // >0 while the post-landing squash is decaying
  }

  // Call once per frame, after physics has settled `grounded` for this
  // frame — see stepPhysics() in world.js. `moving` should reflect real
  // horizontal intent (a small speed threshold, not exactly zero) so
  // floating-point drift doesn't flicker between walk/idle.
  update(dt, moving, grounded) {
    if (moving && grounded) this.walkPhase += dt * WALK_BOUNCE_RATE;
    this.idlePhase += dt * IDLE_BOB_RATE;

    if (!this.wasGrounded && grounded) {
      this.landTimer = LAND_SQUASH_DURATION; // just touched down -> squash, decaying below
    } else if (this.landTimer > 0) {
      this.landTimer = Math.max(0, this.landTimer - dt);
    }
    this.wasGrounded = grounded;
  }

  // Wraps `drawFn(ctx)` — which must paint the entity as if its top-left
  // corner were (0,0) at size (w,h) — in a transform stack centered on the
  // sprite's own middle, so drawFn never has to know about position, scale,
  // or rotation. `opts`: { moving, grounded, facing (1|-1), shaking }.
  draw(ctx, sx, y, w, h, opts, drawFn) {
    const { moving = false, grounded = true, facing = 1, shaking = false } = opts;
    const cx = sx + w / 2;
    const cy = y + h / 2;

    let offsetY = 0;
    let rotation = 0;
    let scaleX = 1;
    let scaleY = 1;

    if (!grounded) {
      scaleX = AIR_STRETCH_X;
      scaleY = AIR_STRETCH_Y;
    } else if (this.landTimer > 0) {
      const t = this.landTimer / LAND_SQUASH_DURATION; // 1 -> 0
      scaleX = 1 + (LAND_SQUASH_X - 1) * t;
      scaleY = 1 + (LAND_SQUASH_Y - 1) * t;
    } else if (moving) {
      offsetY = Math.sin(this.walkPhase) * WALK_BOUNCE_AMPLITUDE;
      rotation = facing * WALK_TILT_MAX;
    } else {
      offsetY = Math.sin(this.idlePhase) * IDLE_BOB_AMPLITUDE;
    }

    let shakeX = 0;
    let shakeY = 0;
    if (shaking) {
      shakeX = (Math.random() - 0.5) * 2 * TELEGRAPH_SHAKE_AMPLITUDE;
      shakeY = (Math.random() - 0.5) * 2 * TELEGRAPH_SHAKE_AMPLITUDE;
    }

    ctx.save();
    ctx.translate(cx + shakeX, cy + offsetY + shakeY);
    ctx.rotate(rotation);
    ctx.scale(scaleX, scaleY);
    ctx.translate(-w / 2, -h / 2);
    drawFn(ctx);
    ctx.restore();
  }
}
