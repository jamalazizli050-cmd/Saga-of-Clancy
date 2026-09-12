// Sprint 1 sound pass (HANDOFF items 3-5). Covers the two things that are
// easy to get wrong and impossible to notice by ear until much later: the
// "never throws without audio" invariant that keeps the whole game runnable
// in environments with no Web Audio at all, and the throttle/cooldown rules
// that stop one cleave through three bodies from machine-gunning.
//
// Web Audio is faked here rather than driven for real — Node has no
// AudioContext, and what's being asserted is the SHAPE of what gets built
// (how many voices, at what frequencies, under which conditions), which a
// recording stub captures exactly.
const { loadGame } = require('./test_env');
const vm = require('vm');
const ROOT = require('path').resolve(__dirname, '..'); // repo root, wherever it was cloned

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`OK   ${label}`);
  else { failures++; console.log(`FAIL ${label}  ${detail !== undefined ? JSON.stringify(detail) : ''}`); }
}

const sb = loadGame(ROOT);
const ctx = sb.__sandbox;
const run = (code) => vm.runInContext(code, ctx);

// --- 1. The central invariant: sound is always safe to call ---------------
//
// This is what lets every combat call site fire a sound unconditionally. The
// sandbox has no AudioContext, exactly like the harness every other suite
// runs under, so this is the real unlocked-never-happened path.
check('без AudioContext Sfx.ctx остаётся null', run('Sfx.ctx') === null);

let threw = null;
try {
  run('Sfx.swing(STARTING_WEAPON); Sfx.bowRelease(STARTING_BOW); Sfx.hit(10); Sfx.hit(30, true); Sfx.playerHurt();');
} catch (e) { threw = e.message; }
check('все звуковые вызовы — безопасный no-op без аудио', threw === null, threw);

run('Sfx.unlock();');
check('unlock() без AudioContext помечает unavailable, а не падает', run('Sfx.unavailable') === true);
run('Sfx.unlock(); Sfx.unlock();');
check('повторный unlock() остаётся no-op (спрашиваем браузер один раз)',
  run('Sfx.ctx') === null && run('Sfx.unavailable') === true);

// --- 2. Fake Web Audio, then unlock for real ------------------------------
//
// currentTime is a plain writable field here so the throttle tests below can
// jump the audio clock forward instead of sleeping.
run(`
  __nodes = [];
  function fakeParam(name, owner) {
    return {
      _name: name, _owner: owner,
      set value(v) { owner.events.push({ param: name, kind: 'value', value: v }); },
      get value() { return 0; },
      setValueAtTime(v, t) { owner.events.push({ param: name, kind: 'set', value: v, t }); return this; },
      linearRampToValueAtTime(v, t) { owner.events.push({ param: name, kind: 'linear', value: v, t }); return this; },
      exponentialRampToValueAtTime(v, t) { owner.events.push({ param: name, kind: 'exp', value: v, t }); return this; },
    };
  }
  function fakeNode(type) {
    const n = { type, kind: type, events: [], started: false, connect() {}, disconnect() {} };
    n.frequency = fakeParam('frequency', n);
    n.gain = fakeParam('gain', n);
    n.Q = fakeParam('Q', n);
    n.start = (t, off, dur) => { n.started = true; n.startArgs = [t, off, dur]; };
    n.stop = () => {};
    __nodes.push(n);
    return n;
  }
  AudioContext = function () {
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.state = 'running';
    this.destination = { kind: 'destination', connect() {} };
    this.resume = () => { this.state = 'running'; };
    this.createGain = () => fakeNode('gain');
    this.createOscillator = () => fakeNode('oscillator');
    this.createBiquadFilter = () => fakeNode('biquad');
    this.createBufferSource = () => fakeNode('bufferSource');
    this.createBuffer = (ch, len) => ({ getChannelData: () => new Float32Array(len) });
  };
  // Clear the unavailable latch set by the no-audio probe above.
  Sfx.unavailable = false;
  Sfx.unlock();
`);
check('unlock() с доступным AudioContext создаёт контекст и мастер-шину',
  run('!!Sfx.ctx && !!Sfx.master') === true);
check('мастер-громкость выставлена в SFX_MASTER_GAIN',
  run('Sfx.master.events.some((e) => e.param === "gain" && e.value === SFX_MASTER_GAIN)'));

// --- 3. Swing character: light vs heavy ----------------------------------
//
// The stat that encodes "heavy" in this game is cooldown (see weapons.js), so
// that's what the sound has to read. Two weapons at the extremes of the
// generator's range must not produce the same voice.
run(`
  __light = { name: 'l', cooldown: WEAPON_COOLDOWN_MIN, damage: 8, range: 30 };
  __heavy = { name: 'h', cooldown: WEAPON_COOLDOWN_MAX, damage: 26, range: 30 };
  function voicesFor(fn) { __nodes = []; fn(); return __nodes; }
  // Lowest frequency any biquad/oscillator in the voice was asked to reach —
  // the single number that best captures "how deep does this sound".
  function lowestHz(nodes) {
    let lo = Infinity;
    for (const n of nodes) for (const e of n.events) {
      if (e.param === 'frequency' && typeof e.value === 'number') lo = Math.min(lo, e.value);
    }
    return lo;
  }
`);

run('__lightNodes = voicesFor(() => Sfx.swing(__light));');
run('Sfx.lastHitAt = -Infinity; __heavyNodes = voicesFor(() => Sfx.swing(__heavy));');

check('замах лёгким оружием звучит выше, чем тяжёлым',
  run('lowestHz(__lightNodes) > lowestHz(__heavyNodes)'),
  { light: run('lowestHz(__lightNodes)'), heavy: run('lowestHz(__heavyNodes)') });
check('у тяжёлого оружия есть дополнительный низкий осциллятор («вес»), у лёгкого — нет',
  run('__heavyNodes.filter((n) => n.kind === "oscillator").length > __lightNodes.filter((n) => n.kind === "oscillator").length'),
  { heavyOsc: run('__heavyNodes.filter((n) => n.kind === "oscillator").length'),
    lightOsc: run('__lightNodes.filter((n) => n.kind === "oscillator").length') });

// Variation: the same weapon swung repeatedly must not be bit-identical.
run(`
  __a = voicesFor(() => Sfx.swing(__light));
  __b = voicesFor(() => Sfx.swing(__light));
  function freqSignature(nodes) {
    return nodes.flatMap((n) => n.events.filter((e) => e.param === 'frequency').map((e) => e.value)).join(',');
  }
`);
check('два одинаковых замаха подряд звучат не идентично (есть вариации)',
  run('freqSignature(__a) !== freqSignature(__b)'));

// --- 4. Hit sound: tied to the collision, throttled ----------------------
run('Sfx.lastHitAt = -Infinity; __hit1 = voicesFor(() => Sfx.hit(12));');
check('попадание порождает звук', run('__hit1.length') > 0);

run('__hit2 = voicesFor(() => Sfx.hit(12));'); // same audio clock instant
check('второе попадание в окне троттлинга проглатывается (один взмах — один удар)',
  run('__hit2.length') === 0, { voices: run('__hit2.length') });

run(`Sfx.ctx.currentTime += SFX_HIT_THROTTLE + 0.001; __hit3 = voicesFor(() => Sfx.hit(12));`);
check('после окна троттлинга следующее попадание снова звучит', run('__hit3.length') > 0);

// A boss hit is deeper than a trash hit — mirrors Effects.hit()'s own `big`.
run(`
  Sfx.ctx.currentTime += 1; __small = voicesFor(() => Sfx.hit(6, false));
  Sfx.ctx.currentTime += 1; __big = voicesFor(() => Sfx.hit(6, true));
`);
check('удар по боссу (big) звучит ниже, чем по рядовому',
  run('lowestHz(__big) < lowestHz(__small)'),
  { big: run('lowestHz(__big)'), small: run('lowestHz(__small)') });

// --- 5. Player damage: its own, longer cooldown --------------------------
run('Sfx.lastHurtAt = -Infinity; __hurt1 = voicesFor(() => Sfx.playerHurt());');
check('получение урона игроком порождает звук', run('__hurt1.length') > 0);
run('__hurt2 = voicesFor(() => Sfx.playerHurt());');
check('повторный урон в окне кулдауна проглатывается', run('__hurt2.length') === 0);
run('Sfx.ctx.currentTime += SFX_HURT_COOLDOWN + 0.001; __hurt3 = voicesFor(() => Sfx.playerHurt());');
check('после кулдауна урон снова звучит', run('__hurt3.length') > 0);
check('кулдаун урона заметно длиннее троттлинга попаданий (это разные события)',
  run('SFX_HURT_COOLDOWN > SFX_HIT_THROTTLE'));

// --- 6. The hit sound fires on the COLLISION, not on the button ----------
//
// HANDOFF is explicit that this is the point of separating hit() from
// swing(): a whiffed swing and a landed one must not sound the same. The
// only way to prove that is to damage an enemy through the real damage path
// and see the sound appear without any attack input at all.
run('Game.enterHub(); Game.startRun();');
run(`
  __enemy = Game.enemies.find((e) => e.alive);
  Sfx.lastHitAt = -Infinity;
  __onDamage = voicesFor(() => __enemy.takeDamage(5, null));
`);
check('Enemy.takeDamage() сам по себе (без нажатия атаки) порождает звук попадания',
  run('__onDamage.length') > 0);

run(`
  Sfx.lastHitAt = -Infinity;
  __dead = Game.enemies.find((e) => e.alive);
  __dead.alive = false;
  __onDeadHit = voicesFor(() => __dead.takeDamage(5, null));
`);
check('удар по уже мёртвому врагу не звучит (takeDamage выходит раньше)',
  run('__onDeadHit.length') === 0);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
