// Combat sound. Every sound here is SYNTHESISED at play time from Web Audio
// primitives — there is not one audio file in the project, and adding one
// would be the first asset the game has ever shipped. That's deliberate and
// matches how the rest of the presentation layer already works: icons.js
// draws its item icons procedurally, spriteAnim.js generates its squash /
// stretch / tint entirely in code.
//
// Nothing is created at load time. A browser refuses to start an
// AudioContext before the user has interacted with the page (autoplay
// policy), and a context constructed too early lands in 'suspended' and
// stays there — so the whole module stays inert until unlock() is called
// from the first real keydown/mousedown (see input.js). Until then, and in
// any environment with no Web Audio at all (the Node test harness — see
// tests/test_env.js, whose sandbox has no AudioContext), every public method
// below is a safe no-op. That's the module's central invariant: CALLING ANY
// SOUND IS ALWAYS SAFE, whether or not audio ever became available.

// Multiple enemies can be hit by a single swing — resolveAttack() loops over
// every enemy the hitbox overlaps (see main.js) and each one calls
// takeDamage(), which is where the hit sound is triggered. Firing one impact
// per enemy turns a good cleave through three bodies into a machine-gun
// rattle, so hits inside this window collapse into the single sound that
// started it. Tuned by ear to be long enough to swallow a multi-hit swing,
// short enough that two deliberate fast attacks still read as two hits (the
// fastest possible weapon cooldown is WEAPON_COOLDOWN_MIN = 0.18s).
const SFX_HIT_THROTTLE = 0.05; // s

// The player's own damage sound gets a much longer leash than the hit sound.
// Its job is "you got hurt", not "a hit landed" — repeating it on chip damage
// from overlapping sources (contact + a boss pattern in the same frame) reads
// as a glitch rather than as extra danger. Sits just under
// HIT_INVULN_DURATION so it can never swallow a genuinely new hit.
const SFX_HURT_COOLDOWN = 0.25; // s

// Master level for everything below. Every voice is mixed through this one
// node, so this is the single number to turn down if combat ever gets noisy.
const SFX_MASTER_GAIN = 0.35;

const Sfx = {
  ctx: null,
  master: null,
  noiseBuffer: null,
  // Set once if constructing an AudioContext throws or the API is absent, so
  // a browser without Web Audio is asked exactly once and never again.
  unavailable: false,

  lastHitAt: -Infinity,
  lastHurtAt: -Infinity,

  // Called from input.js on the first keydown/mousedown of the session. Safe
  // to call on every input after that: the first call builds the context, the
  // rest only resume it if the browser suspended it again (tab switch).
  unlock() {
    if (this.unavailable) return;
    if (!this.ctx) {
      const Ctor = typeof AudioContext !== 'undefined' ? AudioContext
        : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);
      if (!Ctor) { this.unavailable = true; return; }
      try {
        this.ctx = new Ctor();
      } catch (e) {
        this.unavailable = true;
        return;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = SFX_MASTER_GAIN;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },

  // One shared noise buffer for every noise-based voice in the module, built
  // on first use and then reused forever — the same "allocate lazily, never
  // per-event" approach spriteAnim.js's tint buffer uses. Half a second of
  // samples is longer than any voice here needs; short bursts just read a
  // random offset into it.
  noise() {
    if (!this.noiseBuffer) {
      const len = Math.floor(this.ctx.sampleRate * 0.5);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buf;
    }
    return this.noiseBuffer;
  },

  // --- (3) attack swing -----------------------------------------------
  //
  // Fired the moment the swing STARTS (the button press), which is correct
  // for this one: a whoosh is the sound of the blade moving, and the swing
  // begins on press. The sound of it CONNECTING is a separate event with a
  // separate trigger — see hit() below.
  //
  // Character is driven by the weapon's own cooldown, the stat that already
  // encodes "light or heavy" in this game (see weapons.js: a slow, expensive
  // swing is the heavy end of the speed axis). A light weapon gets a short,
  // high, thin whoosh; a heavy one a longer, lower one with an added
  // low-sine body so it lands with weight. Every voice is jittered slightly
  // so a fast weapon swung repeatedly never plays the identical sample twice.
  swing(weapon) {
    if (!this.ctx || !weapon) return;
    const t0 = this.ctx.currentTime;

    // 0 = lightest possible roll, 1 = heaviest. Clamped because a weapon's
    // effective cooldown is also scaled by the player's own cooldownMul
    // (archetypes/gear), which can push it outside the generator's range.
    const heavy = clamp(
      (weapon.cooldown - WEAPON_COOLDOWN_MIN) / (WEAPON_COOLDOWN_MAX - WEAPON_COOLDOWN_MIN), 0, 1);

    const dur = lerp(0.13, 0.26, heavy) * (0.9 + Math.random() * 0.2);
    const startHz = lerp(1900, 900, heavy) * (0.92 + Math.random() * 0.16);
    const endHz = lerp(700, 260, heavy);

    const src = this.ctx.createBufferSource();
    src.buffer = this.noise();
    // Random offset into the shared buffer: same buffer every time, different
    // slice of noise, so repeated swings aren't bit-identical.
    const offset = Math.random() * 0.4;

    // A bandpass swept downward is what turns flat noise into a swing rather
    // than a hiss — the ear reads the falling centre frequency as something
    // travelling past it.
    const band = this.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(startHz, t0);
    band.frequency.exponentialRampToValueAtTime(endHz, t0 + dur);
    band.Q.value = lerp(1.4, 0.8, heavy);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(lerp(0.5, 0.75, heavy), t0 + dur * 0.25);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);

    src.connect(band);
    band.connect(gain);
    gain.connect(this.master);
    src.start(t0, offset, dur);
    src.stop(t0 + dur);

    // Heavy weapons only: a short low sine under the whoosh. This is the
    // difference between "something moved" and "something MASSIVE moved", and
    // it's the main thing that makes a hammer and a dagger read as different
    // weapons rather than the same sound at two pitches.
    if (heavy > 0.35) {
      const body = this.ctx.createOscillator();
      body.type = 'sine';
      body.frequency.setValueAtTime(lerp(150, 90, heavy), t0);
      body.frequency.exponentialRampToValueAtTime(lerp(90, 55, heavy), t0 + dur);
      const bodyGain = this.ctx.createGain();
      bodyGain.gain.setValueAtTime(0.0001, t0);
      bodyGain.gain.exponentialRampToValueAtTime(0.35 * heavy, t0 + dur * 0.2);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      body.connect(bodyGain);
      bodyGain.connect(this.master);
      body.start(t0);
      body.stop(t0 + dur);
    }
  },

  // The bow's release. Not a swing and deliberately not routed through
  // swing(): a bowstring is a single sharp snap with no travel to it, so it
  // gets its own much shorter, drier voice. Without this the bow would be the
  // one attack in the game that makes no sound at all.
  bowRelease(bow) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const dur = 0.1;

    const src = this.ctx.createBufferSource();
    src.buffer = this.noise();
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1200;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.5, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);

    src.connect(hp);
    hp.connect(gain);
    gain.connect(this.master);
    src.start(t0, Math.random() * 0.4, dur);
    src.stop(t0 + dur);

    // The string itself: a fast downward pitch snap, the part that says
    // "released under tension" rather than just "a click".
    const str = this.ctx.createOscillator();
    str.type = 'triangle';
    str.frequency.setValueAtTime(420 * (0.95 + Math.random() * 0.1), t0);
    str.frequency.exponentialRampToValueAtTime(160, t0 + dur);
    const strGain = this.ctx.createGain();
    strGain.gain.setValueAtTime(0.3, t0);
    strGain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    str.connect(strGain);
    strGain.connect(this.master);
    str.start(t0);
    str.stop(t0 + dur);
  },

  // --- (4) hit connected ----------------------------------------------
  //
  // Triggered from the damage handlers themselves (Enemy/Bat takeDamage,
  // BossBase.takeDamage), NOT from the attack button — so it only ever plays
  // when a hitbox genuinely overlapped something. That distinction is the
  // whole point of this being separate from swing(): a swing that hits and a
  // swing that whiffs must not sound the same, and they can't be told apart
  // at the press. It sits directly alongside the existing Effects.hit() call
  // at each of those sites, which is already the game's "an impact happened"
  // hook (hit-stop, shake, particles).
  //
  // damage scales the voice within a tight band — a bigger hit is meatier,
  // but never so much louder that chip damage becomes inaudible. `big`
  // (bosses) deepens it further, mirroring Effects.hit()'s own `big` flag.
  hit(damage = 10, big = false) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    if (t0 - this.lastHitAt < SFX_HIT_THROTTLE) return;
    this.lastHitAt = t0;

    const weight = clamp(damage / 40, 0, 1);
    const dur = big ? 0.2 : lerp(0.09, 0.15, weight);

    // Transient: the crack of contact. Lowpassed so it's a thud against
    // flesh/armour rather than a bright ticking click.
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(lerp(2600, 1500, weight), t0);
    lp.frequency.exponentialRampToValueAtTime(400, t0 + dur);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(big ? 0.9 : lerp(0.55, 0.8, weight), t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);

    src.connect(lp);
    lp.connect(gain);
    gain.connect(this.master);
    src.start(t0, Math.random() * 0.4, dur);
    src.stop(t0 + dur);

    // Body: the low thump that gives the impact its mass. Pitched down for
    // heavier hits and further for boss hits.
    const body = this.ctx.createOscillator();
    body.type = 'sine';
    const bodyHz = big ? 70 : lerp(180, 110, weight);
    body.frequency.setValueAtTime(bodyHz * (0.95 + Math.random() * 0.1), t0);
    body.frequency.exponentialRampToValueAtTime(bodyHz * 0.55, t0 + dur);
    const bodyGain = this.ctx.createGain();
    bodyGain.gain.setValueAtTime(big ? 0.8 : lerp(0.4, 0.65, weight), t0);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    body.connect(bodyGain);
    bodyGain.connect(this.master);
    body.start(t0);
    body.stop(t0 + dur);
  },

  // --- (5) the player taking damage -----------------------------------
  //
  // Called from Player.takeDamage(), past its invuln check, so it can only
  // fire on damage actually applied. Deliberately the least pleasant sound in
  // the module and built to be unmistakable against hit(): where a landed hit
  // is a short dry thud, this is a longer, lower, detuned pair of saw voices
  // sliding downward — the player should never have to check the HP bar to
  // know which of the two just happened.
  playerHurt() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    if (t0 - this.lastHurtAt < SFX_HURT_COOLDOWN) return;
    this.lastHurtAt = t0;

    const dur = 0.3;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1400, t0);
    lp.frequency.exponentialRampToValueAtTime(300, t0 + dur);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.55, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    lp.connect(gain);
    gain.connect(this.master);

    // Two saws a few Hz apart. The beating between them is what makes this
    // read as "wrong/hurt" instead of as a musical note.
    for (const detune of [0, 7]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(190 + detune, t0);
      osc.frequency.exponentialRampToValueAtTime(70 + detune, t0 + dur);
      osc.connect(lp);
      osc.start(t0);
      osc.stop(t0 + dur);
    }
  },
};
