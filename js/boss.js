// Bishop bosses. Each gets its own class + fear mechanic; all are driven
// the same way from main.js (update/draw/takeDamage/alive), so adding
// another is just a new class plus a BISHOP_REGISTRY/MID_CHAIN_BOSSES entry
// in bishops.js/game.js — no changes needed to the transition logic itself.
//
// Everything common lives in BossBase below. With one or two bosses the
// duplicated constructor/takeDamage/draw boilerplate was invisible; by the
// sixth it was six copies of the same twenty lines, so it's factored out.
// Subclasses supply only their fear mechanic: an update() and a draw() that
// leans on the drawBody/drawStatusBar/drawTelegraph helpers.

class BossBase {
  // config: { bishopKey, defaultName, w, h, baseHp, speed, goldReward }
  // options: { name, statMul } — the NG+ display name and per-cycle buff.
  // `bishopKey` is identity for defeat-tracking and never comes from options.
  constructor(x, y, options, config) {
    this.bishopKey = config.bishopKey;
    this.name = options.name || config.defaultName;
    this.statMul = options.statMul || 1;

    this.x = x;
    this.y = y;
    this.w = config.w * WORLD_SCALE;
    this.h = config.h * WORLD_SCALE;
    this.vx = 0;
    this.vy = 0;
    this.grounded = false;
    this.facing = 1;

    this.hp = Math.round(config.baseHp * this.statMul);
    this.maxHp = this.hp;
    this.alive = true;
    this.goldReward = config.goldReward;
    this.speed = (config.speed || 100) * WORLD_SCALE;
    this.hitFlash = 0;
    this.anim = new SpriteAnimator();
  }

  // Every subclass calls this once per update(), right after stepPhysics()
  // so `grounded` is settled for the frame — see spriteAnim.js. Factored out
  // since all six boss classes (five Bishops + MirrorBoss) need the exact
  // same call with the exact same threshold.
  updateAnim(dt) {
    this.anim.update(dt, Math.abs(this.vx) > 1, this.grounded);
  }

  // No knockback for bosses (unlike enemy.js's trash) — shoving a Bishop
  // around mid-attack-pattern would make their telegraphs unreadable and
  // trivialize positioning-based fights (Lisden's decoys, Vetomo's counter
  // window, etc). They still get the full hit-stop/shake/particle punch —
  // `big=true` since bosses land far fewer hits than trash does and can
  // afford a chunkier punctuation mark per one.
  takeDamage(amount) {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - amount);
    this.hitFlash = 0.15;
    Effects.hit(this.x + this.w / 2, this.y + this.h / 2, amount, '#f0d878', true);
    if (this.hp <= 0) this.onDepleted();
  }

  // Split out so MirrorBoss can transform instead of dying without having
  // to reimplement takeDamage's bookkeeping.
  onDepleted() {
    this.alive = false;
  }

  // Overridden by MirrorBoss (phase 2 only) — see its comment. False here
  // means "resolve an Arrow hit against me normally", which is every other
  // boss's and every other phase's behaviour, unchanged.
  reflectsArrows() {
    return false;
  }

  // Turns to face the player unless they're almost exactly overlapping
  // (where sign(dx) flickers). Returns dx so callers don't recompute it.
  faceToward(player) {
    const dx = player.x - this.x;
    if (Math.abs(dx) > 4 * WORLD_SCALE) this.facing = sign(dx);
    return dx;
  }

  // The shared silhouette: one common sprite for all five district Bishops
  // (assets/sprites/boss_bishop_common(_mirrored).png — the mirrored file
  // covers `facing`, no ctx.scale needed), with each boss's existing state
  // color layered on top as a tint instead of being the only thing drawn.
  // x/y are overridable so Lisden can draw her decoys with the identical
  // call — decoys don't track their own facing (they're static points, see
  // LisdenBoss.reclone), so they render using the real Lisden's current one.
  // `forceIdle` makes decoys always play the idle-bob (never the walk-bounce
  // tied to the real Lisden's current vx — they never actually translate, so
  // a walk-cycle bob on them would be a visible lie the mechanic doesn't
  // intend). `shaking` is the boss's own telegraph tell (see ReysdroBoss/
  // VetomoBoss/MirrorBoss's draw()).
  //
  // Falls back to the original flat rectangle + eyes if the sprite hasn't
  // loaded (or ever fails to) — a missing asset degrades, it doesn't crash
  // or blank the boss out.
  drawBody(ctx, camX, fill, x = this.x, y = this.y, { forceIdle = false, shaking = false } = {}) {
    const sx = x - camX;
    // Base art faces LEFT (same convention as the heir_* sprites) — facing>0
    // (right) needs the _mirrored file.
    const key = this.facing > 0 ? 'boss_bishop_common_mirrored' : 'boss_bishop_common';
    const img = TileImages[key];

    // Body art drawn oversized, feet-anchored — see ENTITY_VISUAL_SCALE's
    // comment in utils.js. Decoys (Lisden) pass their own x/y through the
    // same math, so they scale identically to the real boss.
    const vw = this.w * ENTITY_VISUAL_SCALE;
    const vh = this.h * ENTITY_VISUAL_SCALE;
    const vsx = sx - (vw - this.w) / 2;
    const vy = y - (vh - this.h);

    this.anim.draw(ctx, vsx, vy, vw, vh, {
      moving: !forceIdle && Math.abs(this.vx) > 1,
      grounded: this.grounded,
      facing: this.facing,
      shaking,
    }, (lctx) => {
      if (img) {
        // Tinted fairly strongly (not a subtle hint like the player's dash
        // flash) because these colors are gameplay state, not decoration —
        // hit-flash timing, Sakarver's self-damage cue, Keons' smoke state,
        // Vetomo's charge-up all need to stay as readable as they were as
        // flat rectangles. Clipped to the sprite's own alpha by
        // drawSpriteTinted (spriteAnim.js) rather than its bounding box.
        drawSpriteTinted(lctx, img, vw, vh, fill, 0.7);
      } else {
        lctx.fillStyle = fill;
        lctx.fillRect(0, 0, vw, vh);
        lctx.fillStyle = '#1b1e24';
        lctx.fillRect(vw * 0.3, 14 * WORLD_SCALE, 8 * WORLD_SCALE, 8 * WORLD_SCALE);
        lctx.fillRect(vw * 0.6, 14 * WORLD_SCALE, 8 * WORLD_SCALE, 8 * WORLD_SCALE);
      }
    });
  }

  // Thin bar above the head — Sakarver's "getting faster" and Vetomo's
  // "banked resentment" readouts are the same widget with different inputs.
  drawStatusBar(ctx, camX, fraction, color) {
    const sx = this.x - camX;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(sx, this.y - 8 * WORLD_SCALE, this.w, 4 * WORLD_SCALE);
    ctx.fillStyle = color;
    ctx.fillRect(sx, this.y - 8 * WORLD_SCALE, this.w * clamp(fraction, 0, 1), 4 * WORLD_SCALE);
  }

  // Swing-arc marker used by the telegraphing bosses (Reysdro, Vetomo).
  drawTelegraph(ctx, camX, dir, reach, style) {
    const sx = this.x - camX;
    const bx = dir > 0 ? sx + this.w : sx - reach;
    ctx.fillStyle = style;
    ctx.fillRect(bx, this.y + 10 * WORLD_SCALE, reach, this.h - 24 * WORLD_SCALE);
  }
}

//
// Keons — fear of suffocation/death.
// Fear mechanic: on a fixed cycle the arena fills with smoke. While it's
// active, game.js gates the player's attack input off entirely (see
// canAttack in main.js) — the only option is to move and dodge until it
// clears. Outside smoke, Keons just chases and occasionally lunges.

const SMOKE_CYCLE = 7; // seconds between smoke phases
const SMOKE_DURATION = 3.2; // seconds the smoke lasts (attacking is disabled throughout, so this stays short)
const LUNGE_RANGE = 260 * WORLD_SCALE;
const LUNGE_COOLDOWN = 2.5;

class KeonsBoss extends BossBase {
  constructor(x, y, options = {}) {
    super(x, y, options, {
      bishopKey: 'keons', defaultName: 'Кеонс',
      w: 56, h: 78, baseHp: 450, speed: 110, goldReward: 60,
    });

    this.lungeTimer = 0;
    this.contactDamage = Math.round(14 * this.statMul);
    this.contactCooldown = 0;

    this.inSmoke = false;
    this.smokeTimerToNext = SMOKE_CYCLE * 0.5; // first smoke comes a bit sooner
    this.smokePhaseTimer = 0;
    this.erraticMoveTimer = 0;
  }

  update(dt, room, player) {
    if (!this.alive) return;
    // Only needed now that drawBody() renders a directional sprite instead
    // of a symmetric rectangle — she/he never turned to face the player
    // before because there was nothing visual riding on it.
    this.faceToward(player);

    if (!this.inSmoke) {
      this.smokeTimerToNext -= dt;
      if (this.smokeTimerToNext <= 0) {
        this.inSmoke = true;
        this.smokePhaseTimer = SMOKE_DURATION;
      }
    }

    if (this.inSmoke) {
      this.smokePhaseTimer -= dt;
      this.erraticMoveTimer -= dt;
      if (this.erraticMoveTimer <= 0) {
        this.vx = (Math.random() < 0.5 ? -1 : 1) * this.speed * 1.5;
        this.erraticMoveTimer = 0.3 + Math.random() * 0.4;
      }
      if (this.smokePhaseTimer <= 0) {
        this.inSmoke = false;
        this.smokeTimerToNext = SMOKE_CYCLE;
      }
    } else {
      const dx = player.x - this.x;
      this.lungeTimer = Math.max(0, this.lungeTimer - dt);
      if (Math.abs(dx) < LUNGE_RANGE && this.lungeTimer <= 0) {
        this.vx = sign(dx) * this.speed * 2.2;
        this.lungeTimer = LUNGE_COOLDOWN;
      } else {
        this.vx = sign(dx) * this.speed;
      }
    }

    stepPhysics(this, dt, room);
    this.updateAnim(dt);

    this.contactCooldown = Math.max(0, this.contactCooldown - dt);
    if (this.hitFlash > 0) this.hitFlash -= dt;

    if (this.contactCooldown <= 0 && aabbIntersect(this, player)) {
      player.takeDamage(this.contactDamage);
      this.contactCooldown = 0.7;
    }
  }

  draw(ctx, camX) {
    if (!this.alive) return;
    this.drawBody(ctx, camX, this.hitFlash > 0 ? '#e8c0a0' : (this.inSmoke ? '#4a5248' : '#5a4a5e'));
  }
}

// Sakarver — fear of self-harm.
// Fear mechanic: every attack she makes damages HERSELF, and her attack
// cooldown shrinks toward a floor (40% of its base) as her HP drops — so
// she gets faster and more dangerous the more she hurts herself. It's a
// race: the player wants to finish her before that self-inflicted spiral
// makes her too fast to safely approach, but she IS also whittling her own
// HP down over time even with zero player input.
const SAKARVER_BASE_ATTACK_COOLDOWN = 2.0; // s, at full HP
const SAKARVER_MIN_COOLDOWN_MUL = 0.4; // fastest possible: 40% of base, at 0 HP
const SAKARVER_LUNGE_SPEED_MUL = 2.4;

class SakarverBoss extends BossBase {
  // statMul (NG+ per-cycle buff) scales her HP and outgoing attack damage,
  // but not the cooldown floor — the acceleration is her signature read, not
  // a power stat, so it stays identical across cycles.
  //
  // She used to also take 17 self-damage on every lunge, unconditionally.
  // That wasn't a difficulty mechanic, it was a boss that beat itself: at 380
  // HP and an accelerating 2.0s->0.8s cadence she killed herself in 23 lunges
  // / ~32 seconds with the player doing nothing at all, so the fight could be
  // won by standing still. The acceleration below never needed it — it keys
  // off her HP fraction, and damage the PLAYER deals drives it just as well
  // (better, in fact: hurting her makes her more dangerous, so burst damage
  // is a real risk/reward call instead of a free win).
  constructor(x, y, options = {}) {
    super(x, y, options, {
      bishopKey: 'sakarver', defaultName: 'Сакарвер',
      w: 54, h: 74, baseHp: 380, speed: 100, goldReward: 50,
    });

    this.attackTimer = SAKARVER_BASE_ATTACK_COOLDOWN;
    this.attackDamage = Math.round(16 * this.statMul); // damage to the player if the lunge connects
    this.lungeActiveTimer = 0; // brief window during the dash where contact hurts the player
    this.contactCooldown = 0;
  }

  // 1.0 at full HP (full base cooldown) down to SAKARVER_MIN_COOLDOWN_MUL at 0 HP.
  get cooldownMultiplier() {
    const hpFraction = clamp(this.hp / this.maxHp, 0, 1);
    return 1 - (1 - SAKARVER_MIN_COOLDOWN_MUL) * (1 - hpFraction);
  }

  update(dt, room, player) {
    if (!this.alive) return;
    // See KeonsBoss.update()'s identical line: drawBody() now needs a real
    // facing to pick the mirrored sprite or not.
    this.faceToward(player);

    const dx = player.x - this.x;
    this.attackTimer -= dt;

    if (this.attackTimer <= 0) {
      this.vx = sign(dx) * this.speed * SAKARVER_LUNGE_SPEED_MUL;
      this.lungeActiveTimer = 0.35;
      this.attackTimer = SAKARVER_BASE_ATTACK_COOLDOWN * this.cooldownMultiplier;
    } else if (this.lungeActiveTimer <= 0) {
      this.vx = sign(dx) * this.speed;
    }

    if (this.lungeActiveTimer > 0) this.lungeActiveTimer -= dt;

    stepPhysics(this, dt, room);
    this.updateAnim(dt);

    this.contactCooldown = Math.max(0, this.contactCooldown - dt);
    if (this.hitFlash > 0) this.hitFlash -= dt;

    // Contact only hurts the player during the lunge window — walking into
    // her between attacks is safe, keeping the danger tied to her actual
    // attack cadence (the thing that's accelerating) rather than passive touch.
    if (this.lungeActiveTimer > 0 && this.contactCooldown <= 0 && aabbIntersect(this, player)) {
      player.takeDamage(this.attackDamage);
      this.contactCooldown = 0.5;
    }
  }

  draw(ctx, camX) {
    if (!this.alive) return;
    this.drawBody(ctx, camX, this.hitFlash > 0 ? '#e8c0a0' : '#4a3a4e');

    // "Getting faster" tell: a thin red bar that fills as her cooldown
    // shrinks toward its floor — a visible readout of the actual mechanic.
    const speedPct = (1 - this.cooldownMultiplier) / (1 - SAKARVER_MIN_COOLDOWN_MUL);
    this.drawStatusBar(ctx, camX, speedPct, '#c9433a');
  }
}

// Lisden — fear of a blurred boundary with oneself.
// Fear mechanic: every LISDEN_CLONE_CYCLE seconds she "reclones" — 3 total
// silhouettes appear across the arena (herself + LISDEN_DECOY_COUNT fakes),
// all drawn identically. Only ONE position is ever real: takeDamage() and
// contact damage both key off `this.x/this.y` alone, and decoys are never
// separate entities (just {x,y} points this class draws) — so they
// structurally cannot deal or take damage, not merely "flagged" harmless.
// The one tell available to the player: decoys are static once placed,
// while the real Lisden keeps chasing/lunging, so motion — not appearance —
// is what gives her away.
const LISDEN_CLONE_CYCLE = 6.5; // seconds between reclone events
const LISDEN_DECOY_COUNT = 2; // + 1 real = 3 silhouettes total
const LISDEN_LUNGE_RANGE = 220 * WORLD_SCALE;
const LISDEN_LUNGE_COOLDOWN = 2.2;

class LisdenBoss extends BossBase {
  constructor(x, y, options = {}) {
    super(x, y, options, {
      bishopKey: 'lisden', defaultName: 'Лисден',
      w: 54, h: 76, baseHp: 400, speed: 105, goldReward: 55,
    });

    this.lungeTimer = 0;
    this.contactDamage = Math.round(15 * this.statMul);
    this.contactCooldown = 0;

    this.cloneTimer = LISDEN_CLONE_CYCLE * 0.4; // first clone comes a bit sooner
    this.decoys = []; // {x, y} points — purely visual, see class comment above
    this.cloneFlash = 0; // brief shimmer across all silhouettes at the clone moment

    // Room bounds for picking clone slots, cached on first update() since
    // the room isn't known yet at construction time.
    this.arenaMinX = null;
    this.arenaMaxX = null;
  }

  update(dt, room, player) {
    if (!this.alive) return;
    // See KeonsBoss.update()'s identical line — also covers her decoys,
    // which render via drawBody() reusing the real Lisden's current facing.
    this.faceToward(player);

    if (this.arenaMinX === null) {
      this.arenaMinX = this.w;
      this.arenaMaxX = Math.max(this.arenaMinX, room.width - this.w * 2);
    }

    this.cloneTimer -= dt;
    if (this.cloneTimer <= 0) {
      this.reclone();
      this.cloneTimer = LISDEN_CLONE_CYCLE;
    }
    if (this.cloneFlash > 0) this.cloneFlash -= dt;

    const dx = player.x - this.x;
    this.lungeTimer = Math.max(0, this.lungeTimer - dt);
    if (Math.abs(dx) < LISDEN_LUNGE_RANGE && this.lungeTimer <= 0) {
      this.vx = sign(dx) * this.speed * 2.1;
      this.lungeTimer = LISDEN_LUNGE_COOLDOWN;
    } else {
      this.vx = sign(dx) * this.speed;
    }

    stepPhysics(this, dt, room);
    this.updateAnim(dt);

    this.contactCooldown = Math.max(0, this.contactCooldown - dt);
    if (this.hitFlash > 0) this.hitFlash -= dt;

    if (this.contactCooldown <= 0 && aabbIntersect(this, player)) {
      player.takeDamage(this.contactDamage);
      this.contactCooldown = 0.7;
    }
  }

  // Picks totalSlots evenly-spaced-but-jittered x positions across the
  // arena, teleports the real Lisden to a random one of them, and stores
  // the rest as decoy points.
  reclone() {
    const totalSlots = LISDEN_DECOY_COUNT + 1;
    const bandWidth = (this.arenaMaxX - this.arenaMinX) / totalSlots;
    const slots = [];
    for (let i = 0; i < totalSlots; i++) {
      const bandStart = this.arenaMinX + i * bandWidth;
      slots.push(bandStart + Math.random() * Math.max(1, bandWidth));
    }
    const realIndex = randInt(0, totalSlots - 1);
    this.x = slots[realIndex];
    this.decoys = slots.filter((_, i) => i !== realIndex).map((sx) => ({ x: sx, y: this.y }));
    this.cloneFlash = 0.25;
  }

  draw(ctx, camX) {
    if (!this.alive) return;

    const idle = this.cloneFlash > 0 ? '#bcb4d6' : '#5a4a6e';
    // Decoys first — the identical drawBody call as the real one (they're
    // never hit-flashed since they never take damage), so nothing about the
    // sprite itself distinguishes them.
    for (const decoy of this.decoys) this.drawBody(ctx, camX, idle, decoy.x, decoy.y, { forceIdle: true });
    this.drawBody(ctx, camX, this.hitFlash > 0 ? '#e8c0a0' : idle);
  }
}

// Reysdro — fear of doubt / lost faith.
// Fear mechanic: her windup lies. Each attack telegraphs a big obvious
// swing to one side, but the side the hitbox actually lands on is rolled
// separately — REYSDRO_LIE_CHANCE of the time it's the opposite one.
// Crucially the lie is still *fair*: for REYSDRO_COMMIT seconds before the
// hitbox goes live the telegraph snaps to the true side and brightens, so
// a player watching her rather than her wind-up can always still dodge.
// Reading the tell is possible; trusting the tell is what kills you.
const REYSDRO_WINDUP = 0.7;        // s of (possibly lying) telegraph
const REYSDRO_COMMIT = 0.2;        // s where the true side is shown before damage
const REYSDRO_STRIKE = 0.14;       // s the hitbox is live
const REYSDRO_ATTACK_COOLDOWN = 1.9;
const REYSDRO_LIE_CHANCE = 0.5;
const REYSDRO_REACH = 96 * WORLD_SCALE;
const REYSDRO_ENGAGE_RANGE = 300 * WORLD_SCALE;

class ReysdroBoss extends BossBase {
  constructor(x, y, options = {}) {
    super(x, y, options, {
      bishopKey: 'reysdro', defaultName: 'Рейсдро',
      w: 52, h: 76, baseHp: 410, speed: 100, goldReward: 55,
    });

    this.attackDamage = Math.round(17 * this.statMul);

    // Attack state machine: 'idle' -> 'windup' -> 'commit' -> 'strike' -> idle.
    this.phase = 'idle';
    this.phaseTimer = REYSDRO_ATTACK_COOLDOWN * 0.5;
    this.telegraphDir = 1; // the side the windup POINTS at (may be a lie)
    this.strikeDir = 1;    // the side the hitbox actually lands on
    this.struckThisSwing = false;
  }

  update(dt, room, player) {
    if (!this.alive) return;

    const dx = player.x - this.x;
    this.phaseTimer -= dt;

    if (this.phase === 'idle') {
      // Close the distance between swings; hold still once in range.
      this.vx = Math.abs(dx) > REYSDRO_REACH ? sign(dx) * this.speed : 0;
      this.faceToward(player);
      if (this.phaseTimer <= 0 && Math.abs(dx) < REYSDRO_ENGAGE_RANGE) {
        // Truth is decided up front; the telegraph then either matches it
        // or points the other way. Both are picked here so the lie is a
        // property of the swing, not something re-rolled mid-animation.
        this.strikeDir = sign(dx) || 1;
        this.telegraphDir = Math.random() < REYSDRO_LIE_CHANCE ? -this.strikeDir : this.strikeDir;
        this.phase = 'windup';
        this.phaseTimer = REYSDRO_WINDUP;
        this.struckThisSwing = false;
      }
    } else if (this.phase === 'windup') {
      this.vx = 0;
      if (this.phaseTimer <= 0) {
        this.phase = 'commit';
        this.phaseTimer = REYSDRO_COMMIT;
      }
    } else if (this.phase === 'commit') {
      this.vx = 0;
      if (this.phaseTimer <= 0) {
        this.phase = 'strike';
        this.phaseTimer = REYSDRO_STRIKE;
      }
    } else {
      this.vx = 0;
      if (!this.struckThisSwing) {
        // Hitbox is built facing strikeDir, which is what makes the lie
        // mechanically real rather than cosmetic. computeMeleeHitbox only
        // reads x/y/w/h/facing, so a literal beats spreading the whole boss.
        const swinger = { x: this.x, y: this.y, w: this.w, h: this.h, facing: this.strikeDir };
        const hitbox = computeMeleeHitbox(swinger, REYSDRO_REACH, this.attackDamage);
        if (aabbIntersect(hitbox, player)) {
          player.takeDamage(this.attackDamage);
          this.struckThisSwing = true;
        }
      }
      if (this.phaseTimer <= 0) {
        this.phase = 'idle';
        this.phaseTimer = REYSDRO_ATTACK_COOLDOWN;
      }
    }

    stepPhysics(this, dt, room);
    this.updateAnim(dt);
    if (this.hitFlash > 0) this.hitFlash -= dt;
  }

  draw(ctx, camX) {
    if (!this.alive) return;
    // Shake during the wind-up/commit read (the "telegraph" — the anticipation
    // that's either honest or a lie), not during the strike itself.
    const telegraphShaking = this.phase === 'windup' || this.phase === 'commit';
    this.drawBody(ctx, camX, this.hitFlash > 0 ? '#e8c0a0' : '#4a5a62', undefined, undefined, { shaking: telegraphShaking });

    // Windup shows telegraphDir dim; commit/strike show strikeDir bright.
    // Same bar in both cases, so the flip at commit is the visual "tell".
    if (this.phase === 'windup' || this.phase === 'commit' || this.phase === 'strike') {
      const lying = this.phase === 'windup';
      const dir = lying ? this.telegraphDir : this.strikeDir;
      this.drawTelegraph(ctx, camX, dir, REYSDRO_REACH,
        lying ? 'rgba(209,177,60,0.28)' : 'rgba(209,177,60,0.75)');
    }
  }
}

// Vetomo — fear of success.
// Fear mechanic: she banks the damage the player deals her in a rolling
// window (recentDamage, which bleeds off at VETOMO_DECAY_PER_SEC), and her
// next counter-attack scales with whatever is banked when it fires. Dumping
// a burst into her buys a punishing swing; spacing hits out so the decay
// keeps up costs nothing extra. Winning too fast is the danger.
const VETOMO_COUNTER_COOLDOWN = 2.6;
const VETOMO_DECAY_PER_SEC = 14;      // banked damage bled off per second
const VETOMO_COUNTER_SCALE = 0.30;    // banked damage -> bonus counter damage
const VETOMO_COUNTER_MAX_BONUS = 34;  // ceiling so a huge burst can't one-shot
const VETOMO_WINDUP = 0.5;
const VETOMO_REACH = 104 * WORLD_SCALE;
const VETOMO_ENGAGE_RANGE = 320 * WORLD_SCALE;

class VetomoBoss extends BossBase {
  constructor(x, y, options = {}) {
    super(x, y, options, {
      bishopKey: 'vetomo', defaultName: 'Ветомо',
      w: 56, h: 78, baseHp: 440, speed: 95, goldReward: 60,
    });

    this.baseCounterDamage = Math.round(11 * this.statMul);

    this.recentDamage = 0;   // the "success" she's resenting right now
    this.counterTimer = VETOMO_COUNTER_COOLDOWN;
    this.windupTimer = 0;
    this.pendingCounterDamage = 0;
  }

  // 0..1 readout of how loaded her next counter is, for the charge bar.
  get chargeFraction() {
    return clamp((this.recentDamage * VETOMO_COUNTER_SCALE) / VETOMO_COUNTER_MAX_BONUS, 0, 1);
  }

  update(dt, room, player) {
    if (!this.alive) return;

    // Bank decays continuously — this is what makes paced damage safe.
    this.recentDamage = Math.max(0, this.recentDamage - VETOMO_DECAY_PER_SEC * dt);

    const dx = this.faceToward(player);

    if (this.windupTimer > 0) {
      this.windupTimer -= dt;
      this.vx = 0;
      if (this.windupTimer <= 0) {
        // Counter lands now, using damage locked in when the windup began.
        const hitbox = computeMeleeHitbox(this, VETOMO_REACH, this.pendingCounterDamage);
        if (aabbIntersect(hitbox, player)) player.takeDamage(this.pendingCounterDamage);
      }
    } else {
      this.counterTimer -= dt;
      this.vx = Math.abs(dx) > VETOMO_REACH ? sign(dx) * this.speed : 0;

      if (this.counterTimer <= 0 && Math.abs(dx) < VETOMO_ENGAGE_RANGE) {
        const bonus = Math.min(this.recentDamage * VETOMO_COUNTER_SCALE, VETOMO_COUNTER_MAX_BONUS);
        this.pendingCounterDamage = Math.round((this.baseCounterDamage + bonus * this.statMul));
        // Spending the bank on this swing is what stops burst damage from
        // compounding across multiple counters.
        this.recentDamage = 0;
        this.windupTimer = VETOMO_WINDUP;
        this.counterTimer = VETOMO_COUNTER_COOLDOWN;
      }
    }

    stepPhysics(this, dt, room);
    this.updateAnim(dt);
    if (this.hitFlash > 0) this.hitFlash -= dt;
  }

  // Banking the damage is the mechanic, so this is the one boss that needs
  // more than the base bookkeeping when it gets hit.
  takeDamage(amount) {
    if (!this.alive) return;
    this.recentDamage += amount;
    super.takeDamage(amount);
  }

  draw(ctx, camX) {
    if (!this.alive) return;
    const charging = this.windupTimer > 0;

    // Fear-of-success beat made visible on her body, not just the status
    // bar: a glow that grows with exactly the banked damage her counter
    // will cash in on, so "don't let her charge up" reads at a glance
    // without needing to watch the numeric bar. One radial gradient behind
    // her per frame — cheap regardless of how loaded the bank is.
    if (this.chargeFraction > 0.02) {
      const cx = this.x - camX + this.w / 2;
      const cy = this.y + this.h / 2;
      const radius = (this.w * 0.6) + this.chargeFraction * this.w * 1.8;
      const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, radius);
      glow.addColorStop(0, `rgba(209, 177, 60, ${0.15 + this.chargeFraction * 0.35})`);
      glow.addColorStop(1, 'rgba(209, 177, 60, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    }

    // Windup is her telegraph — the counter is already locked in, this is
    // the readable warning before it lands.
    this.drawBody(ctx, camX, this.hitFlash > 0 ? '#e8c0a0' : (charging ? '#8a6a2a' : '#5e5233'), undefined, undefined, { shaking: charging });

    // Charge bar: how much banked "success" her next counter will cash in.
    this.drawStatusBar(ctx, camX, this.chargeFraction, '#d1b13c');

    if (charging) this.drawTelegraph(ctx, camX, this.facing, VETOMO_REACH, 'rgba(209,177,60,0.35)');
  }
}

// The finale: a mirror of the player (phase 1), which transforms into
// Blairface (phase 2) instead of dying once her first HP bar is emptied.
// Phase 1 attacks reuse computeMeleeHitbox() — the exact same hitbox shape
// the player's own attack uses — so "she fights like you do" is literal,
// not just a description. Phase 2 swaps that for a 3-pattern cycle.
//
// Balance pass (this fight measured out as a wall, not a hard-but-fair
// fight): phase 1 used to run a flat +20% over the mirrored snapshot on
// BOTH hp and weapon damage — a "mirror" that's already 20% stronger than
// you isn't a mirror. It's now a TRUE 1:1 mirror (MIRROR_PHASE1_STAT_BONUS)
// — she hits exactly as hard as you do, which is still a real fight since
// resolveAttack() in main.js layers the player's OWN dmg-upgrade/gear
// bonuses onto their outgoing hits but her mirrored weaponDamage doesn't
// get any of that, so a progressed account still comes out ahead on paper.
// The +20% escalation moves to Blairface (phase 2) only, and even there
// it's folded into the already-present per-pattern multipliers rather
// than stacked on top of a separately-inflated base (see
// BLAIREFACE_HEAVY_DAMAGE_MUL/BLAIREFACE_DASH_DAMAGE_MUL below) — measured
// against a few representative maxHp/weaponDamage profiles (see
// scratchpad/sim_blaireface_balance.js), the old numbers put the single
// heavy-telegraph hit at ~23-29% of the player's own maxHp and the total
// HP the player has to grind through across both phases at 240% of their
// own maxHp; this brings those to ~16-20% and 165% respectively (a
// two-full-health-bars fight is still a long fight, but the reduced phase-2
// refill means it's not literally starting the boss over from full).
const MIRROR_PHASE1_STAT_BONUS = 1.0; // true mirror — no inflation over the player's own stats
const MIRROR_TRANSFORM_DURATION = 1.6; // s — brief invulnerable palette-swap window
const MIRROR_ENGAGE_MARGIN = 10 * WORLD_SCALE; // extra reach so she doesn't need pixel-perfect overlap to swing
// Phase 2 no longer refills to a full second bar — see completeTransformation().
const BLAIREFACE_PHASE2_HP_FRACTION = 0.65;

const BLAIREFACE_PATTERN_COOLDOWN = 2.0; // s between the start of one pattern and the next
const BLAIREFACE_DASH_SPEED_MUL = 2.6;
const BLAIREFACE_DASH_ACTIVE = 0.3;
const BLAIREFACE_DASH_DAMAGE_MUL = 1.0; // was 1.1 — the speed/hard-to-avoid part of this pattern is the threat, it didn't need a damage bonus too
const BLAIREFACE_AOE_TELEGRAPH = 0.45;
const BLAIREFACE_AOE_ACTIVE = 0.15;
const BLAIREFACE_AOE_RADIUS = 100 * WORLD_SCALE;
const BLAIREFACE_AOE_DAMAGE_MUL = 0.9; // unchanged — already sub-100%
const BLAIREFACE_TELEGRAPH_WINDUP = 0.6;
const BLAIREFACE_TELEGRAPH_STRIKE = 0.15;
const BLAIREFACE_HEAVY_RANGE_MUL = 1.5;
const BLAIREFACE_HEAVY_DAMAGE_MUL = 1.35; // was 1.6

// Arrow reflection (phase 2 / Blairface only — see reflectsArrows() and
// reflectArrow() below). Not a new colour: it's the exact accent her own
// draw() already tints phase-2 idle frames with, reused here so a bounced
// arrow reads as "hers" the same way her own body already does.
const BLAIREFACE_REFLECT_COLOR = '#f0d43a';

class MirrorBoss extends BossBase {
  // snapshot: { maxHp, weaponDamage, weaponRange, weaponCooldown, moveSpeed,
  // damageReduction, skinId } captured from Game.player at the moment the
  // fight starts (see Game.enterMirrorFight()) — everything below is
  // derived from that. Phase 1 is a true 1:1 mirror (MIRROR_PHASE1_STAT_BONUS,
  // see its comment); range/speed/cooldown/mitigation are mirrored 1:1 too.
  constructor(x, y, snapshot) {
    super(x, y, {}, {
      // Not in BISHOP_REGISTRY — she's the finale, not a rotating Bishop.
      bishopKey: 'mirror', defaultName: 'Зеркало',
      w: 28, h: 40, baseHp: Math.round(snapshot.maxHp * MIRROR_PHASE1_STAT_BONUS),
      speed: 0, goldReward: 100,
    });
    this.facing = -1;
    this.phase = 1;
    // Drawn as this exact skin in draw() (falls back to the old procedural
    // rendering if null — a skinId-less "Ты" can still reach the finale on
    // a first-ever run, since it only takes clearing every Bishop once).
    this.skinId = snapshot.skinId || null;

    this.weaponDamage = Math.round(snapshot.weaponDamage * MIRROR_PHASE1_STAT_BONUS);
    this.weaponRange = snapshot.weaponRange;
    this.weaponCooldown = snapshot.weaponCooldown;
    this.moveSpeed = snapshot.moveSpeed;
    // She is a mirror, so she also mirrors the player's armour. Without
    // this, stacking damage reduction made the finale strictly easier the
    // better geared you were — the one fight where that's backwards.
    this.damageReduction = snapshot.damageReduction || 0;

    this.attackTimer = this.weaponCooldown;
    this.attackActiveTimer = 0;
    this.hitLandedThisSwing = false;

    this.transforming = false;
    this.transformTimer = 0;

    // Phase 2 (Blairface) pattern-cycle state.
    this.patternIndex = 0;
    this.activePattern = null;
    this.patternSubPhase = null;
    this.patternSubTimer = 0;
    this.patternTimer = 0;
    this.hitLandedThisPattern = false;
  }

  update(dt, room, player) {
    if (!this.alive) return;

    if (this.transforming) {
      this.transformTimer -= dt;
      this.vx = 0;
      if (this.transformTimer <= 0) this.completeTransformation();
      stepPhysics(this, dt, room);
      this.updateAnim(dt);
      return;
    }

    if (this.phase === 1) this.updatePhase1(dt, player);
    else this.updatePhase2(dt, player);

    stepPhysics(this, dt, room);
    this.updateAnim(dt);
    if (this.hitFlash > 0) this.hitFlash -= dt;
  }

  updatePhase1(dt, player) {
    const dx = player.x - this.x;
    if (Math.abs(dx) > 4 * WORLD_SCALE) this.facing = sign(dx);

    if (this.attackActiveTimer > 0) {
      this.attackActiveTimer -= dt;
      this.vx = 0;
      if (!this.hitLandedThisSwing) {
        const hitbox = computeMeleeHitbox(this, this.weaponRange, this.weaponDamage);
        if (aabbIntersect(hitbox, player)) {
          player.takeDamage(hitbox.damage);
          this.hitLandedThisSwing = true;
        }
      }
      return;
    }

    this.attackTimer -= dt;
    const distance = Math.abs(dx);
    const engageRange = this.weaponRange + MIRROR_ENGAGE_MARGIN;
    if (distance <= engageRange) {
      this.vx = 0;
      if (this.attackTimer <= 0) {
        this.attackActiveTimer = 0.14;
        this.hitLandedThisSwing = false;
        this.attackTimer = this.weaponCooldown;
      }
    } else {
      this.vx = sign(dx) * this.moveSpeed;
    }
  }

  updatePhase2(dt, player) {
    const dx = player.x - this.x;
    if (Math.abs(dx) > 4 * WORLD_SCALE) this.facing = sign(dx);

    if (this.activePattern) {
      this.runActivePattern(dt, player);
      return;
    }

    this.patternTimer -= dt;
    this.vx = sign(dx) * this.moveSpeed * 0.6; // unhurried drift — the patterns carry the threat, not chasing
    if (this.patternTimer <= 0) this.startNextPattern();
  }

  startNextPattern() {
    const patterns = ['dash', 'aoe', 'telegraph'];
    this.activePattern = patterns[this.patternIndex % patterns.length];
    this.patternIndex += 1;
    this.hitLandedThisPattern = false;
    this.vx = 0;

    if (this.activePattern === 'dash') {
      this.patternSubPhase = 'dash';
      this.patternSubTimer = BLAIREFACE_DASH_ACTIVE;
    } else if (this.activePattern === 'aoe') {
      this.patternSubPhase = 'telegraph';
      this.patternSubTimer = BLAIREFACE_AOE_TELEGRAPH;
    } else {
      this.patternSubPhase = 'windup';
      this.patternSubTimer = BLAIREFACE_TELEGRAPH_WINDUP;
    }
  }

  runActivePattern(dt, player) {
    this.patternSubTimer -= dt;

    if (this.activePattern === 'dash') {
      this.vx = this.facing * this.moveSpeed * BLAIREFACE_DASH_SPEED_MUL;
      if (!this.hitLandedThisPattern) {
        const hitbox = computeMeleeHitbox(this, this.weaponRange, Math.round(this.weaponDamage * BLAIREFACE_DASH_DAMAGE_MUL));
        if (aabbIntersect(hitbox, player)) {
          player.takeDamage(hitbox.damage);
          this.hitLandedThisPattern = true;
        }
      }
      if (this.patternSubTimer <= 0) this.endPattern();
    } else if (this.activePattern === 'aoe') {
      this.vx = 0;
      if (this.patternSubPhase === 'telegraph') {
        if (this.patternSubTimer <= 0) {
          this.patternSubPhase = 'burst';
          this.patternSubTimer = BLAIREFACE_AOE_ACTIVE;
        }
      } else {
        if (!this.hitLandedThisPattern) {
          const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
          const pcx = player.x + player.w / 2, pcy = player.y + player.h / 2;
          if (Math.hypot(cx - pcx, cy - pcy) <= BLAIREFACE_AOE_RADIUS) {
            player.takeDamage(Math.round(this.weaponDamage * BLAIREFACE_AOE_DAMAGE_MUL));
          }
          this.hitLandedThisPattern = true;
        }
        if (this.patternSubTimer <= 0) this.endPattern();
      }
    } else {
      // telegraph: long readable windup, then one heavy hit with extended range.
      this.vx = 0;
      if (this.patternSubPhase === 'windup') {
        if (this.patternSubTimer <= 0) {
          this.patternSubPhase = 'strike';
          this.patternSubTimer = BLAIREFACE_TELEGRAPH_STRIKE;
        }
      } else {
        if (!this.hitLandedThisPattern) {
          const hitbox = computeMeleeHitbox(this, this.weaponRange * BLAIREFACE_HEAVY_RANGE_MUL, Math.round(this.weaponDamage * BLAIREFACE_HEAVY_DAMAGE_MUL));
          if (aabbIntersect(hitbox, player)) {
            player.takeDamage(hitbox.damage);
          }
          this.hitLandedThisPattern = true;
        }
        if (this.patternSubTimer <= 0) this.endPattern();
      }
    }
  }

  endPattern() {
    this.activePattern = null;
    this.patternSubPhase = null;
    this.patternTimer = BLAIREFACE_PATTERN_COOLDOWN;
  }

  takeDamage(amount) {
    // Invulnerable for the duration of the palette-swap transformation.
    if (this.transforming) return;
    super.takeDamage(amount * (1 - this.damageReduction));
  }

  // Phase 2 (Blairface) only, and not mid-transform (this.phase is still 1
  // for the whole palette-swap window — completeTransformation() is what
  // flips it — so this already reads false there without an extra check;
  // the arrow just bounces off her ordinary phase-1 invulnerability like it
  // always did). Read fresh off `this.phase` every time main.js's projectile
  // loop asks, rather than a stored flag, so it can never be left "stuck on"
  // across the phase 1 -> 2 transition or a death.
  //
  // This is the whole counter to bow-spam the task asked for: phase 1 (a
  // true mirror of the player, including their own bow if they're carrying
  // one) is untouched, and phase 2 makes ranged spam actively punish the
  // player instead of raising her max HP or damage — no global buff needed.
  reflectsArrows() {
    return this.phase === 2;
  }

  // Called by main.js's projectile loop instead of resolveAttack() when a
  // 'player'-owned Arrow hits her while reflectsArrows() is true. She takes
  // NO damage from it (this never calls takeDamage) and the arrow is never
  // marked dead — it's the SAME Arrow instance, same gravity/room-collision
  // physics, just re-aimed and re-flagged so main.js's owner-branch resolves
  // it against the player next frame instead of against her/the trash. See
  // Arrow's own `owner` comment in projectile.js for why one arrow can never
  // bounce twice.
  reflectArrow(arrow, player) {
    // "Direction from Blairface's position back to the player at the moment
    // of reflection" — recomputed here rather than just flipping the arrow's
    // existing vx, so a player who moved (or an arrow that hit her from an
    // unusual angle) still gets sent an arrow aimed at where they actually
    // are, not just backward along the incoming line.
    const dir = sign(player.x - this.x) || -arrow.facing;
    arrow.facing = dir;
    arrow.vx = dir * Math.abs(arrow.vx);
    // Vertical motion (gravity-driven, see projectile.js's ARROW_GRAVITY) is
    // deliberately left untouched — same physics, just a new horizontal aim.
    arrow.owner = 'enemy';
    arrow.color = BLAIREFACE_REFLECT_COLOR;

    // Feedback that a hit connected but didn't land as damage: the same
    // hitFlash + Effects.hit punctuation every other hit in the game uses
    // (see BossBase.takeDamage), just without the HP loss, and in her own
    // accent colour instead of the generic hit-flash tan so it doesn't read
    // as "that damaged her".
    this.hitFlash = 0.15;
    Effects.hit(this.x + this.w / 2, this.y + this.h / 2, arrow.damage, BLAIREFACE_REFLECT_COLOR, false);
  }

  // Phase 1 ending doesn't kill her — it triggers the Blairface transform.
  onDepleted() {
    if (this.phase === 1) this.beginTransformation();
    else this.alive = false;
  }

  beginTransformation() {
    this.transforming = true;
    this.transformTimer = MIRROR_TRANSFORM_DURATION;
    this.vx = 0;
  }

  completeTransformation() {
    this.transforming = false;
    this.phase = 2;
    this.name = 'Блэрифейс';
    // A fresh full bar for the new phase, but a SMALLER one than phase 1's
    // (BLAIREFACE_PHASE2_HP_FRACTION) — this used to refill to the exact
    // same maxHp, meaning the player had to grind through two entire
    // player-maxHp-sized health pools back to back with no recovery
    // between them (240% of their own maxHp total). Shrinking the bar
    // itself (rather than just starting it partly empty) keeps "fresh
    // phase, fresh bar" as the readout while still cutting the total grind.
    this.maxHp = Math.round(this.maxHp * BLAIREFACE_PHASE2_HP_FRACTION);
    this.hp = this.maxHp;
    this.patternIndex = 0;
    this.activePattern = null;
    this.patternTimer = BLAIREFACE_PATTERN_COOLDOWN * 0.5; // comes out swinging sooner than the normal gap
  }

  // Phase 1 draws the player's own heir_XX skin — "she fights like you do"
  // was already literal via the shared hitbox code; now she looks like you
  // too, so phase-1 "normal" state gets NO tint at all (the point is that
  // it's just you). Hit-flash and the transform flicker still tint over it,
  // same technique as BossBase.drawBody(). Phase 2 (Blairface) keeps a
  // constant yellow tint as her transformed identity — this is the "layer
  // Blairface's palette-swap over the heir skin" first pass the request
  // asked for; a dedicated Blairface sprite can replace the tint later
  // without touching anything else here.
  draw(ctx, camX) {
    if (!this.alive) return;
    const sx = this.x - camX;

    const telegraphing = this.phase === 2 && (
      (this.activePattern === 'aoe' && this.patternSubPhase === 'telegraph') ||
      (this.activePattern === 'telegraph' && this.patternSubPhase === 'windup')
    );

    let tintColor = null;
    let tintAlpha = 0;
    if (this.transforming) {
      const flicker = Math.floor(this.transformTimer * 12) % 2 === 0;
      tintColor = flicker ? '#f0d43a' : '#cfd6e4';
      tintAlpha = 0.7;
    } else if (this.phase === 1) {
      if (this.hitFlash > 0) { tintColor = '#e8c0a0'; tintAlpha = 0.6; }
    } else {
      tintColor = this.hitFlash > 0 ? '#fff2b0' : (telegraphing ? '#1b1e24' : '#f0d43a');
      tintAlpha = this.hitFlash > 0 ? 0.75 : (telegraphing ? 0.85 : 0.6);
    }

    // Same facing convention as Player.draw() — base art faces left.
    const skinKey = this.skinId
      ? `heir_${String(this.skinId).padStart(2, '0')}${this.facing > 0 ? '_mirrored' : ''}`
      : null;
    const skinImg = skinKey ? TileImages[skinKey] : null;

    // Body art drawn oversized, feet-anchored — see ENTITY_VISUAL_SCALE's
    // comment in utils.js (same treatment as BossBase.drawBody(), which she
    // doesn't use herself thanks to the custom skin/tint logic above).
    const vw = this.w * ENTITY_VISUAL_SCALE;
    const vh = this.h * ENTITY_VISUAL_SCALE;
    const vsx = sx - (vw - this.w) / 2;
    const vy = this.y - (vh - this.h);

    // Shake during a phase-2 telegraph (the same "about to hit you" tell
    // ReysdroBoss/VetomoBoss use via BossBase.drawBody) — she doesn't use
    // drawBody() herself (custom skin/tint logic above), so it's applied
    // directly here instead.
    this.anim.draw(ctx, vsx, vy, vw, vh, {
      moving: Math.abs(this.vx) > 1,
      grounded: this.grounded,
      facing: this.facing,
      shaking: telegraphing,
    }, (lctx) => {
      if (skinImg) {
        drawSpriteTinted(lctx, skinImg, vw, vh, tintColor, tintAlpha);
      } else {
        // Fallback: no heir skin available (skinId-less "Ты", or the image
        // never loaded) — the original flat-rectangle rendering, unchanged.
        if (this.phase === 1 && !this.transforming) {
          lctx.fillStyle = this.hitFlash > 0 ? '#e8c0a0' : '#8a8fa0'; // muted grey — an echo of the player's own colour
        } else {
          lctx.fillStyle = tintColor;
        }
        lctx.fillRect(0, 0, vw, vh);

        lctx.fillStyle = '#1b1e24';
        const eyeX = this.facing > 0 ? vw - 8 * WORLD_SCALE : 4 * WORLD_SCALE;
        lctx.fillRect(eyeX, 8 * WORLD_SCALE, 4 * WORLD_SCALE, 4 * WORLD_SCALE);
      }
    });

    if (this.activePattern === 'aoe') {
      ctx.save();
      const cx = sx + this.w / 2, cy = this.y + this.h / 2;
      ctx.strokeStyle = this.patternSubPhase === 'telegraph' ? 'rgba(240,212,58,0.5)' : 'rgba(240,212,58,0.9)';
      ctx.lineWidth = 3 * WORLD_SCALE;
      ctx.beginPath();
      ctx.arc(cx, cy, BLAIREFACE_AOE_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}
