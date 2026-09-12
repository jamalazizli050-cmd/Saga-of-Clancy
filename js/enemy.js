// "Glorious Gone" — the rank-and-file enemy. Patrols a fixed strip, aggros
// on proximity, deals contact damage on a short per-target cooldown.

// Knockback trash takes from a landed player hit — see takeDamage() below
// and Player's own PLAYER_KNOCKBACK_* (deliberately harsher here: shoving
// mooks around sells impact without any of the "displaced off a ledge while
// I'm the one who got hit" fairness concern that caps the player's own).
const ENEMY_KNOCKBACK_FORCE = 340 * WORLD_SCALE; // px/s
const ENEMY_KNOCKBACK_DURATION = 0.16; // s

// Elite champions (see makeElite on both enemy classes) are marked with the
// same torch gold the game already uses for "this one matters", plus three
// chevrons above the head — drawn procedurally so no new art is needed and
// it reads at a glance against either biome.
const ELITE_MARKER_COLOR = '#d1b13c';

function drawEliteMarker(ctx, entity, sx) {
  if (!entity.elite) return;
  const cx = sx + entity.w / 2;
  const baseY = entity.y - 13 * WORLD_SCALE;
  const s = 3.4 * WORLD_SCALE;
  ctx.save();
  ctx.strokeStyle = ELITE_MARKER_COLOR;
  ctx.lineWidth = 1.8 * WORLD_SCALE;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = -1; i <= 1; i++) {
    const px = cx + i * s * 2;
    ctx.moveTo(px - s, baseY);
    ctx.lineTo(px, baseY - s);
    ctx.lineTo(px + s, baseY);
  }
  ctx.stroke();
  ctx.restore();
}

class GloriousGone {
  // statMul scales HP/damage/reward with how deep into the run the room is
  // (see spawnEnemiesForRoom). Flat rank-and-file stats meant room 5 was
  // populated by the same fodder as room 1 while the player had four rooms
  // of loot — the trash stopped registering as a threat entirely.
  constructor(x, y, patrolMinX, patrolMaxX, statMul = 1) {
    this.x = x;
    this.y = y;
    this.w = 26 * WORLD_SCALE;
    this.h = 36 * WORLD_SCALE;
    this.vx = 0;
    this.vy = 0;
    this.grounded = false;

    this.hp = Math.round(30 * statMul);
    this.maxHp = this.hp;
    this.alive = true;
    this.goldGranted = false;
    this.deathGold = Math.round(randInt(5, 12) * statMul);

    this.patrolMinX = patrolMinX;
    this.patrolMaxX = patrolMaxX;
    this.dir = 1;
    this.patrolSpeed = 90 * WORLD_SCALE;
    this.chaseSpeed = 170 * WORLD_SCALE;
    this.aggroRange = 190 * WORLD_SCALE;

    this.contactDamage = Math.round(8 * statMul);
    this.contactCooldown = 0;
    this.hitFlash = 0;
    this.anim = new SpriteAnimator();

    this.knockbackTimer = 0;
    this.knockbackVx = 0;
    this.elite = false;
  }

  // Elite rooms promote one spawn to a champion. The stat multiplier is
  // applied by the caller (see spawnEnemiesForRoom); this is the half that
  // makes it play differently rather than just survive longer — it notices
  // the player from much further out and closes faster, so it commits where
  // ordinary trash would still be patrolling.
  makeElite() {
    this.elite = true;
    this.aggroRange *= 1.8;
    this.chaseSpeed *= 1.25;
    this.deathGold = Math.round(this.deathGold * 2.5);
  }

  update(dt, room, player) {
    if (!this.alive) return;

    this.knockbackTimer = Math.max(0, this.knockbackTimer - dt);
    if (this.knockbackTimer > 0) {
      this.vx = this.knockbackVx;
    } else {
      const dx = player.x - this.x;
      if (Math.abs(dx) < this.aggroRange) {
        this.dir = sign(dx) || this.dir;
        this.vx = this.dir * this.chaseSpeed;
      } else {
        if (this.x <= this.patrolMinX) this.dir = 1;
        if (this.x >= this.patrolMaxX) this.dir = -1;
        this.vx = this.dir * this.patrolSpeed;
      }
    }

    stepPhysics(this, dt, room);
    this.anim.update(dt, Math.abs(this.vx) > 1, this.grounded);

    this.contactCooldown = Math.max(0, this.contactCooldown - dt);
    if (this.hitFlash > 0) this.hitFlash -= dt;

    if (this.contactCooldown <= 0 && aabbIntersect(this, player)) {
      player.takeDamage(this.contactDamage, this.x + this.w / 2);
      this.contactCooldown = 0.8;
    }
  }

  takeDamage(amount, fromX = null) {
    if (!this.alive) return;
    this.hp -= amount;
    this.hitFlash = 0.15;
    Effects.hit(this.x + this.w / 2, this.y + this.h / 2, amount, '#e8dca0');
    if (fromX !== null) {
      const dir = sign(this.x + this.w / 2 - fromX) || this.dir;
      this.knockbackVx = dir * ENEMY_KNOCKBACK_FORCE;
      this.knockbackTimer = ENEMY_KNOCKBACK_DURATION;
    }
    if (this.hp <= 0) this.alive = false;
  }

  draw(ctx, camX) {
    if (!this.alive) return;
    const sx = this.x - camX;

    // Body art drawn oversized, anchored at the hitbox's feet — see
    // ENTITY_VISUAL_SCALE's comment in utils.js. The hp sliver below still
    // uses the real sx/this.w so it stays pinned above the actual hitbox.
    const vw = this.w * ENTITY_VISUAL_SCALE;
    const vh = this.h * ENTITY_VISUAL_SCALE;
    const vsx = sx - (vw - this.w) / 2;
    const vy = this.y - (vh - this.h);

    // Same left-facing-base convention as the player/bosses (dir>0 = right
    // = needs the _mirrored file).
    const img = TileImages[this.dir > 0 ? 'enemy_grunt_mirrored' : 'enemy_grunt'];

    this.anim.draw(ctx, vsx, vy, vw, vh, {
      moving: Math.abs(this.vx) > 1,
      grounded: this.grounded,
      facing: this.dir,
    }, (lctx) => {
      if (img) {
        // Tint follows the sprite's own alpha, not its bounding box — see
        // drawSpriteTinted() in spriteAnim.js for why this can't just be a
        // source-atop fillRect on the main canvas.
        drawSpriteTinted(lctx, img, vw, vh, this.hitFlash > 0 ? '#e8a0a0' : null, 0.6);
      } else {
        lctx.fillStyle = this.hitFlash > 0 ? '#e8a0a0' : '#6b5a4a';
        lctx.fillRect(0, 0, vw, vh);
      }
    });

    // tiny hp sliver above the head — screen-locked, not part of the
    // wobble/tilt transform (same call as before, untouched by the animator).
    const pct = clamp(this.hp / this.maxHp, 0, 1);
    ctx.fillStyle = '#0008';
    ctx.fillRect(sx, this.y - 8 * WORLD_SCALE, this.w, 4 * WORLD_SCALE);
    ctx.fillStyle = this.elite ? ELITE_MARKER_COLOR : '#b2453f';
    ctx.fillRect(sx, this.y - 8 * WORLD_SCALE, this.w * pct, 4 * WORLD_SCALE);
    drawEliteMarker(ctx, this, sx);
  }
}

// Bat — the second rank-and-file type. Flies freely (no gravity, no
// stepPhysics/platform collision — GloriousGone's whole ground/patrol model
// doesn't apply to something that never touches the floor), hovers near its
// spawn until the player gets close, then swoops in and bites. Spawned
// interchangeably with GloriousGone by spawnEnemiesForRoom() in game.js —
// same constructor signature on purpose so either can fill any enemy slot.
const BAT_FRAME_W = 44;
const BAT_FRAME_H = 92;
const BAT_ANIM_FPS = 10;
// `key` matches the TILE_SOURCES entry in tiles.js; `frames` is the strip's
// own frame count (native strip width / BAT_FRAME_W); `loop` false holds on
// the last frame instead of restarting (a bite or death shouldn't cycle).
const BAT_ANIMS = {
  idle: { key: 'bat_idle', frames: 7, loop: true },
  fly: { key: 'bat_fly', frames: 7, loop: true },
  bite: { key: 'bat_bite', frames: 8, loop: false },
  dying: { key: 'bat_hit_and_death', frames: 7, loop: false },
};
const BAT_DEATH_HOLD = 0.5; // s the death frame stays on screen before the bat is actually gone

// How high a jump can carry the player's own body above the floor —
// physics-derived (v²/2g) rather than a guessed constant, so it stays
// correct if jump tuning ever changes. Used to cap Bat's flight ceiling
// below (bug: it used to be allowed almost to the top of the room, well
// above anything a jump + swing could ever connect with).
function playerMaxJumpHeight() {
  return (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);
}

class Bat {
  constructor(x, y, patrolMinX, patrolMaxX, statMul = 1) {
    this.x = x;
    this.y = y;
    this.w = 30 * WORLD_SCALE;
    this.h = 40 * WORLD_SCALE;
    this.vx = 0;
    this.vy = 0;
    this.facing = 1;

    // Slightly less HP than GloriousGone (30) — flying makes it harder to
    // land hits on reliably, so it dies faster once you do connect.
    this.hp = Math.round(22 * statMul);
    this.maxHp = this.hp;
    this.alive = true;
    this.dying = false; // true only while the death animation plays out
    this.deathHold = 0;
    this.goldGranted = false;
    this.deathGold = Math.round(randInt(5, 12) * statMul);

    this.patrolMinX = patrolMinX;
    this.patrolMaxX = patrolMaxX;
    this.hoverSpeed = 60 * WORLD_SCALE;
    this.chaseSpeed = 160 * WORLD_SCALE;
    this.aggroRange = 220 * WORLD_SCALE;
    this.biteRange = 34 * WORLD_SCALE;
    this.biteTimer = 0;

    this.contactDamage = Math.round(7 * statMul);
    this.contactCooldown = 0;
    this.hitFlash = 0;

    this.knockbackTimer = 0;
    this.knockbackVx = 0;

    this.hoverPhase = Math.random() * Math.PI * 2;

    this.animState = 'idle';
    this.animFrame = 0;
    this.animTimer = 0;
    this.elite = false;
  }

  // See GloriousGone.makeElite — same contract, same reasons. A bat's threat
  // is its reach, so widening aggro and chase is exactly what turns it from
  // ambient hazard into something that hunts you across the room.
  makeElite() {
    this.elite = true;
    this.aggroRange *= 1.8;
    this.chaseSpeed *= 1.25;
    this.deathGold = Math.round(this.deathGold * 2.5);
  }

  // Advances the frame index for `state`'s strip, resetting to frame 0
  // whenever the state itself just changed (so switching idle->fly always
  // starts the new strip from its beginning, not wherever idle left off).
  updateAnim(dt, state) {
    if (state !== this.animState) {
      this.animState = state;
      this.animFrame = 0;
      this.animTimer = 0;
    }
    const def = BAT_ANIMS[this.animState];
    const frameDur = 1 / BAT_ANIM_FPS;
    this.animTimer += dt;
    while (this.animTimer >= frameDur) {
      this.animTimer -= frameDur;
      this.animFrame++;
      if (this.animFrame >= def.frames) this.animFrame = def.loop ? 0 : def.frames - 1;
    }
  }

  update(dt, room, player) {
    if (!this.alive) {
      if (this.dying) {
        this.updateAnim(dt, 'dying');
        this.deathHold += dt;
        if (this.deathHold > BAT_DEATH_HOLD) this.dying = false;
      }
      return;
    }

    this.contactCooldown = Math.max(0, this.contactCooldown - dt);
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.biteTimer > 0) this.biteTimer -= dt;

    // Flight ceiling: bug was a flat 40*WORLD_SCALE (near the room's own
    // top edge) — a bat could drift or chase its way up there and then just
    // sit, completely out of reach of a jump + swing (and just as unable to
    // reach the player itself). Tied to the player's actual jump apex, which
    // is exactly how high the player's own body (and thus the melee attack
    // hitbox, which tracks the attacker's own y/h — see computeMeleeHitbox
    // in utils.js — NOT weapon range, that's horizontal-only) can ever get
    // off the ground. Previously this also subtracted player.weapon.range
    // as "extra headroom", which was wrong on two counts: range doesn't
    // grant any vertical reach at all, and it could push the ceiling up to
    // 117 world units higher than the player's jump apex could physically
    // reach — i.e. it let the bat sit somewhere a full-height jump + swing
    // genuinely could not connect with, which is the bug the user reported.
    // The floor of that band is where a ground entity's own TOP sits when
    // standing (that's what ROOM_GROUND_SPAWN_Y means — see
    // spawnEnemiesForRoom, which is also exactly where a bat is spawned), so
    // putting the bat's top there makes it occupy the same vertical band as
    // a standing player: bodies overlapping, which is what BOTH the bite
    // check and the player's own swing need in order to connect at all.
    // This used to subtract this.h, which parked the bat's BOTTOM on the
    // player's HEAD — a 60-unit centre-to-centre gap against a 51-unit
    // biteRange, so a bat could hover directly above the player forever with
    // neither of them able to touch the other. That is the "они всё ещё не
    // достают" bug: the altitude cap was working, the reachable band itself
    // was simply one full body-height too high.
    const reachableMaxY = ROOM_GROUND_SPAWN_Y * WORLD_SCALE;
    const reachableMinY = reachableMaxY - playerMaxJumpHeight();

    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    const pcx = player.x + player.w / 2, pcy = player.y + player.h / 2;
    const dx = pcx - cx, dy = pcy - cy;
    const dist = Math.hypot(dx, dy);

    this.knockbackTimer = Math.max(0, this.knockbackTimer - dt);
    if (this.knockbackTimer > 0) {
      this.vx = this.knockbackVx;
      this.vy = 0;
      this.updateAnim(dt, 'idle');
    } else if (this.biteTimer > 0) {
      this.vx = 0;
      this.vy = 0;
      this.updateAnim(dt, 'bite');
    } else if (dist < this.aggroRange) {
      if (dist < this.biteRange) {
        this.vx = 0;
        this.vy = 0;
        this.biteTimer = 0.5;
        this.updateAnim(dt, 'bite');
      } else {
        // Chase toward the CLAMPED target y, not the player's raw one — if
        // the player is ever above the reachable band, this pulls the bat
        // down to the closest reachable altitude instead of pressing
        // uselessly against the ceiling clamp below (or, before this fix,
        // just flying straight up to match with nothing capping it at all).
        const targetY = clamp(pcy, reachableMinY + this.h / 2, reachableMaxY + this.h / 2);
        const tdx = pcx - cx, tdy = targetY - cy;
        const tdist = Math.hypot(tdx, tdy) || 1;
        this.vx = (tdx / tdist) * this.chaseSpeed;
        this.vy = (tdy / tdist) * this.chaseSpeed;
        if (Math.abs(dx) > 4 * WORLD_SCALE) this.facing = sign(dx);
        this.updateAnim(dt, 'fly');
      }
    } else {
      // Hover near a comfortable, near-ground resting height — not wherever
      // it happens to be. Without a pull back down, a bat that got dragged
      // up toward the ceiling while chasing an out-of-reach player then just
      // sat there hovering in place once it lost aggro, still unreachably
      // high with nothing left to bring it back down. Blends a gentle
      // vertical bob with a bias toward a low resting altitude, so most
      // encounters happen near the ground and don't require jumping at all.
      this.hoverPhase += dt * 2;
      const restCy = reachableMaxY + this.h / 2 - 20 * WORLD_SCALE;
      const bob = Math.cos(this.hoverPhase) * this.hoverSpeed * 0.4;
      const pull = clamp((restCy - cy) * 1.5, -this.hoverSpeed, this.hoverSpeed);
      this.vy = bob + pull;
      if (this.x <= this.patrolMinX) this.facing = 1;
      if (this.x >= this.patrolMaxX) this.facing = -1;
      this.vx = this.facing * this.hoverSpeed;
      this.updateAnim(dt, 'idle');
    }

    // No stepPhysics: this thing flies, so gravity/ground collision simply
    // don't apply — move freely and just keep it within the room's airspace
    // (below the ceiling, above the floor it never lands on).
    this.x = clamp(this.x + this.vx * dt, 0, room.width - this.w);
    this.y = clamp(this.y + this.vy * dt, reachableMinY, reachableMaxY);

    // Two ways to connect. Physically overlapping the player covers walking
    // into a hovering bat. The bite has to land on its OWN reach, though,
    // because the bat halts the moment it's within biteRange (51 centres
    // apart) while the boxes only actually touch at ~43 (their half-widths
    // summed) — so a bat closing in from the side stopped 8 units short and
    // chewed empty air forever, never once damaging the player. Both paths
    // share contactCooldown, so this is still one hit per 0.7s either way.
    const biteConnected = this.biteTimer > 0 && dist < this.biteRange;
    if (this.contactCooldown <= 0 && (biteConnected || aabbIntersect(this, player))) {
      player.takeDamage(this.contactDamage, this.x + this.w / 2);
      this.contactCooldown = 0.7;
    }
  }

  takeDamage(amount, fromX = null) {
    if (!this.alive) return;
    this.hp -= amount;
    this.hitFlash = 0.15;
    Effects.hit(this.x + this.w / 2, this.y + this.h / 2, amount, '#e8dca0');
    if (fromX !== null) {
      const dir = sign(this.x + this.w / 2 - fromX) || this.facing;
      this.knockbackVx = dir * ENEMY_KNOCKBACK_FORCE;
      this.knockbackTimer = ENEMY_KNOCKBACK_DURATION;
    }
    if (this.hp <= 0) {
      this.alive = false;
      this.dying = true;
      this.deathHold = 0;
      this.animState = null; // forces updateAnim to reset cleanly into 'dying'
    }
  }

  draw(ctx, camX) {
    if (!this.alive && !this.dying) return;
    const sx = this.x - camX;
    const def = BAT_ANIMS[this.animState] || BAT_ANIMS.idle;
    const img = TileImages[def.key];
    const flip = this.facing < 0;

    // Body art drawn oversized, center-anchored (a flier has no "feet" to
    // plant — see ENTITY_VISUAL_SCALE's comment in utils.js).
    const vw = this.w * ENTITY_VISUAL_SCALE;
    const vh = this.h * ENTITY_VISUAL_SCALE;
    const vsx = sx - (vw - this.w) / 2;
    const vy = this.y - (vh - this.h) / 2;

    ctx.save();
    ctx.translate(vsx, vy);
    if (flip) { ctx.translate(vw, 0); ctx.scale(-1, 1); }

    if (img) {
      // Strip-based sprite, so the tint helper gets the frame's sub-rect —
      // same alpha-accurate path every other entity uses.
      drawSpriteTinted(ctx, img, vw, vh, this.hitFlash > 0 ? '#e8a0a0' : null, 0.6,
        { sx: this.animFrame * BAT_FRAME_W, sy: 0, sw: BAT_FRAME_W, sh: BAT_FRAME_H });
    } else {
      ctx.fillStyle = this.hitFlash > 0 ? '#e8a0a0' : '#4a4a5e';
      ctx.fillRect(0, 0, vw, vh);
    }
    ctx.restore();

    if (this.alive) {
      const pct = clamp(this.hp / this.maxHp, 0, 1);
      ctx.fillStyle = '#0008';
      ctx.fillRect(sx, this.y - 8 * WORLD_SCALE, this.w, 4 * WORLD_SCALE);
      ctx.fillStyle = this.elite ? ELITE_MARKER_COLOR : '#b2453f';
      ctx.fillRect(sx, this.y - 8 * WORLD_SCALE, this.w * pct, 4 * WORLD_SCALE);
      drawEliteMarker(ctx, this, sx);
    }
  }
}
