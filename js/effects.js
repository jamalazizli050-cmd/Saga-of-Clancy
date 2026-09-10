// Hit-impact feedback: a brief global freeze ("hit-stop"), screen shake, and
// a small particle burst on every successful hit — landed OR taken. Its own
// tiny module (not folded into main.js/player.js) because every combat file
// needs to trigger it, and main.js's loop() needs to read hitStopTimer back
// to decide whether to freeze gameplay dt for a frame or two.
//
// Nothing here is gated by Game.state: it's pure presentation, driven by
// whatever calls Effects.hit(), and updated every frame with the RAW
// (unfrozen) timestamp delta — see main.js's loop(), which calls
// Effects.update(rawDt) unconditionally, then only zeroes the dt it hands to
// update()/updateHub() while hitStopTimer is still counting down. If
// Effects.update() itself were subject to the freeze, hitStopTimer could
// never tick back down to 0 and the freeze would never end.
const Effects = {
  hitStopTimer: 0,
  shakeTimer: 0,
  shakeMag: 0,
  particles: [],

  // x/y: world-space point of impact. damage: the actual number just dealt
  // (post-multipliers) — bigger hits freeze/shake/spray harder, within a
  // small cap so combat never starts feeling unresponsive. `big` (boss hits)
  // raises that cap a bit further; bosses land far fewer hits than trash
  // does, so they can afford a chunkier punctuation mark.
  hit(x, y, damage, color, big = false) {
    const stopMs = clamp(30 + damage * 1.1, 40, big ? 110 : 80);
    this.hitStopTimer = Math.max(this.hitStopTimer, stopMs / 1000);
    this.shakeTimer = Math.max(this.shakeTimer, big ? 0.18 : 0.1);
    this.shakeMag = Math.max(this.shakeMag, clamp(damage * 0.35, 2, big ? 14 : 8) * WORLD_SCALE);

    const count = big ? 14 : Math.round(clamp(4 + damage * 0.25, 4, 10));
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (60 + Math.random() * 160) * WORLD_SCALE;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.18 + Math.random() * 0.16,
        maxLife: 0.34,
        size: (1.5 + Math.random() * 2.5) * WORLD_SCALE,
        color: color || '#e8dca0',
      });
    }
  },

  // A spray with shake but deliberately NO hit-stop — for things that are
  // good news (a reward paid out, a wave arriving) rather than an impact.
  // Freezing the frame is the game's punctuation for "that connected", so
  // reusing hit() here would make picking up gold feel like taking a hit.
  burst(x, y, color, count = 14, shake = 5 * WORLD_SCALE) {
    this.shakeTimer = Math.max(this.shakeTimer, 0.16);
    this.shakeMag = Math.max(this.shakeMag, shake);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (70 + Math.random() * 190) * WORLD_SCALE;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.3 + Math.random() * 0.3,
        maxLife: 0.6,
        size: (1.5 + Math.random() * 2.5) * WORLD_SCALE,
        color: color || '#d1b13c',
      });
    }
  },

  update(rawDt) {
    if (this.hitStopTimer > 0) this.hitStopTimer = Math.max(0, this.hitStopTimer - rawDt);
    if (this.shakeTimer > 0) {
      this.shakeTimer = Math.max(0, this.shakeTimer - rawDt);
      if (this.shakeTimer <= 0) this.shakeMag = 0;
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= rawDt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * rawDt;
      p.y += p.vy * rawDt;
      p.vx *= 0.9;
      p.vy *= 0.9;
    }
  },

  // A small pseudo-random screen-space offset, alive only while shakeTimer
  // is counting down. main.js applies this as a ctx.translate wrapping the
  // world-content draw calls (never the HUD/vignette, which stay put).
  shakeOffset() {
    if (this.shakeTimer <= 0) return { x: 0, y: 0 };
    const t = this.shakeTimer * 97;
    return {
      x: (Math.sin(t * 1.7) + Math.sin(t * 3.1)) * 0.5 * this.shakeMag,
      y: (Math.sin(t * 2.3) + Math.sin(t * 4.3)) * 0.5 * this.shakeMag,
    };
  },

  draw(ctx, camX, camY = 0) {
    for (const p of this.particles) {
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - camX - p.size / 2, p.y - camY - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  },
};
