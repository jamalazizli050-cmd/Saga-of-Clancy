// "Glorious Gone" — the rank-and-file enemy. Patrols a fixed strip, aggros
// on proximity, deals contact damage on a short per-target cooldown.

// Knockback trash takes from a landed player hit — see takeDamage() below
// and Player's own PLAYER_KNOCKBACK_* (deliberately harsher here: shoving
// mooks around sells impact without any of the "displaced off a ledge while
// I'm the one who got hit" fairness concern that caps the player's own).
const ENEMY_KNOCKBACK_FORCE = 340 * WORLD_SCALE; // px/s
const ENEMY_KNOCKBACK_DURATION = 0.16; // s

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
        lctx.drawImage(img, 0, 0, vw, vh);
        if (this.hitFlash > 0) {
          lctx.save();
          lctx.globalCompositeOperation = 'source-atop';
          lctx.globalAlpha = 0.6;
          lctx.fillStyle = '#e8a0a0';
          lctx.fillRect(0, 0, vw, vh);
          lctx.restore();
        }
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
    ctx.fillStyle = '#b2453f';
    ctx.fillRect(sx, this.y - 8 * WORLD_SCALE, this.w * pct, 4 * WORLD_SCALE);
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
        const nx = dx / dist, ny = dy / dist;
        this.vx = nx * this.chaseSpeed;
        this.vy = ny * this.chaseSpeed;
        if (Math.abs(dx) > 4 * WORLD_SCALE) this.facing = sign(dx);
        this.updateAnim(dt, 'fly');
      }
    } else {
      // Hover near the spawn strip: gentle vertical bob + slow horizontal
      // drift between the patrol bounds (reusing them as a hover range,
      // not a ground patrol — this bat never touches the floor).
      this.hoverPhase += dt * 2;
      this.vy = Math.cos(this.hoverPhase) * this.hoverSpeed * 0.4;
      if (this.x <= this.patrolMinX) this.facing = 1;
      if (this.x >= this.patrolMaxX) this.facing = -1;
      this.vx = this.facing * this.hoverSpeed;
      this.updateAnim(dt, 'idle');
    }

    // No stepPhysics: this thing flies, so gravity/ground collision simply
    // don't apply — move freely and just keep it within the room's airspace
    // (below the ceiling, above the floor it never lands on).
    this.x = clamp(this.x + this.vx * dt, 0, room.width - this.w);
    this.y = clamp(this.y + this.vy * dt, 40 * WORLD_SCALE, ROOM_GROUND_SPAWN_Y * WORLD_SCALE - this.h);

    if (this.contactCooldown <= 0 && aabbIntersect(this, player)) {
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
      ctx.drawImage(img, this.animFrame * BAT_FRAME_W, 0, BAT_FRAME_W, BAT_FRAME_H, 0, 0, vw, vh);
      if (this.hitFlash > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'source-atop';
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = '#e8a0a0';
        ctx.fillRect(0, 0, vw, vh);
        ctx.restore();
      }
    } else {
      ctx.fillStyle = this.hitFlash > 0 ? '#e8a0a0' : '#4a4a5e';
      ctx.fillRect(0, 0, vw, vh);
    }
    ctx.restore();

    if (this.alive) {
      const pct = clamp(this.hp / this.maxHp, 0, 1);
      ctx.fillStyle = '#0008';
      ctx.fillRect(sx, this.y - 8 * WORLD_SCALE, this.w, 4 * WORLD_SCALE);
      ctx.fillStyle = '#b2453f';
      ctx.fillRect(sx, this.y - 8 * WORLD_SCALE, this.w * pct, 4 * WORLD_SCALE);
    }
  }
}
