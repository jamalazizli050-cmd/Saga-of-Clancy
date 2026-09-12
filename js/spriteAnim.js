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

// --- Sprite tinting (hit flash, dash glow, Blairface's palette swap) -------
//
// Tinting "only the sprite's own pixels" needs `source-atop`, but that
// operator composites against EVERYTHING already on the target canvas — and
// every entity here draws straight onto the main canvas (the `lctx` handed to
// draw() below is the main context with a transform applied, not a layer). So
// the tint used to clip to the background instead of to the sprite, painting
// a solid rectangle over the entity's whole bounding box: the hit-flash bug.
//
// The fix is to give `source-atop` a canvas where the sprite is the ONLY
// content. One offscreen buffer, allocated lazily and reused for every
// entity in the game — it only ever grows to fit the largest sprite drawn so
// far, so there is no per-frame allocation and no per-entity canvas.
let tintBuffer = null;
let tintBufferCtx = null;

function ensureTintBuffer(w, h) {
  if (!tintBuffer) {
    tintBuffer = document.createElement('canvas');
    tintBufferCtx = tintBuffer.getContext('2d');
  }
  // Resizing clears the canvas, so only do it when genuinely too small.
  if (tintBuffer.width < w || tintBuffer.height < h) {
    tintBuffer.width = Math.max(tintBuffer.width, Math.ceil(w));
    tintBuffer.height = Math.max(tintBuffer.height, Math.ceil(h));
  }
  return tintBufferCtx;
}

// Draws `img` into the caller's current transform at (0,0,dw,dh) — the box
// every entity's draw() already works in — with `color` laid over the
// sprite's own opaque pixels only. `src` is an optional {sx,sy,sw,sh}
// sub-rectangle for strip-based sprites (the Bat's animation frames).
// Falls back to a plain drawImage if there's nothing to tint, so callers can
// use it unconditionally.
function drawSpriteTinted(ctx, img, dw, dh, color, alpha, src) {
  const drawSprite = (target, w, h) => {
    if (src) target.drawImage(img, src.sx, src.sy, src.sw, src.sh, 0, 0, w, h);
    else target.drawImage(img, 0, 0, w, h);
  };

  if (!color || alpha <= 0) {
    drawSprite(ctx, dw, dh);
    return;
  }

  // Round up: a fractional buffer size would clip the sprite's last column.
  const bw = Math.ceil(dw);
  const bh = Math.ceil(dh);
  const buf = ensureTintBuffer(bw, bh);

  // Only the region we're about to use — clearing the whole (possibly much
  // larger) buffer every call would waste fill on sprites that never touch it.
  buf.clearRect(0, 0, bw, bh);
  buf.save();
  drawSprite(buf, dw, dh);
  // Inside the buffer the sprite is the only content, so source-atop now
  // clips to its alpha — transparent pixels stay transparent.
  buf.globalCompositeOperation = 'source-atop';
  buf.globalAlpha = alpha;
  buf.fillStyle = color;
  buf.fillRect(0, 0, bw, bh);
  buf.restore();

  // Blit under the caller's transform, so rotation/scale/flip still apply.
  ctx.drawImage(tintBuffer, 0, 0, bw, bh, 0, 0, dw, dh);
}

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
