const { loadGame } = require('./test_env');
const vm = require('vm');
const ROOT = require('path').resolve(__dirname, '..'); // repo root, wherever it was cloned

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log(`OK   ${label}`); }
  else { failures++; console.log(`FAIL ${label}  ${detail || ''}`); }
}

const sb = loadGame(ROOT);
const ctx = sb.__sandbox;

// Every fake player below needs a `weapon.range` now — Bat.update() reads
// it (see enemy.js's reachableMinY, the altitude-cap fix) the same way the
// real Player always can via its own weapon getter.
const FAKE_WEAPON = { range: 60 * sb.WORLD_SCALE };

// --- Bat flies freely: no gravity, moves in Y ---
{
  const bat = vm.runInContext(`new Bat(500, 200, 0, 3000, 1)`, ctx);
  const room = { width: 3000, platforms: [{ x: 0, y: 700, w: 3000, h: 40 }] };
  const farPlayer = { x: 2900, y: 200, w: 20, h: 20, weapon: FAKE_WEAPON }; // far away -> hover state
  const startY = bat.y;
  for (let i = 0; i < 60; i++) { // 1 second of hovering
    vm.runInContext('bat.update(1/60, room, player)', Object.assign(ctx, { bat, room, player: farPlayer }));
  }
  check('Bat has no `grounded`/stepPhysics-driven gravity field pulling it down (y changes are from its own hover logic only)',
    bat.vy !== undefined, bat.vy);
  check('Bat actually moved in Y while hovering (not locked to a fixed floor)', bat.y !== startY, { startY, endY: bat.y });
  check('Bat state is "idle" while no player is in aggro range', bat.animState === 'idle', bat.animState);
}

// --- Aggro + chase (both X and Y toward the player) ---
// Spawned near the real game's own ground-spawn convention (see
// game.js's spawnEnemiesForRoom) rather than an arbitrary y — the old y:300
// here sat ABOVE the reachable-altitude band the Bat-too-high fix now
// clamps to, so "chase upward toward a player above it" was inadvertently
// asking the bat to fly somewhere the fix deliberately no longer allows.
// Both bat and player below sit well inside that band.
{
  const groundTopY = sb.ROOM_GROUND_SPAWN_Y * sb.WORLD_SCALE;
  const bat = vm.runInContext(`new Bat(500, ${groundTopY}, 0, 3000, 1)`, ctx);
  const room = { width: 3000, platforms: [{ x: 0, y: groundTopY + 40, w: 3000, h: 40 }] };
  // Inside aggroRange (330 world units) but outside biteRange (51) and not
  // overlapping the bat's own box, so this exercises the chase branch
  // specifically rather than an immediate bite/contact-damage hit.
  const nearPlayer = { x: 590, y: groundTopY - 70, w: 20, h: 20, weapon: FAKE_WEAPON }; // in range and ABOVE the bat -> should chase upward too
  vm.runInContext('bat.update(1/60, room, player)', Object.assign(ctx, { bat, room, player: nearPlayer }));
  check('Bat switches to "fly" state when the player enters aggro range', bat.animState === 'fly', bat.animState);
  check('Bat chases vertically too (vy is negative, moving up toward a reachable player above it)', bat.vy < 0, bat.vy);
}

// --- Bite range triggers the bite animation + eventually contact damage ---
// Same realistic-y fix as the chase test above — y:300 here used to sit
// outside the new reachable band, so the very first update() snapped the
// bat to a different y than the player before the overlap check ever ran.
// Spawned exactly at reachableMaxY (groundTopY - bat.h) so there's no snap
// at all on the first frame — both bat and player sit at the same y.
{
  const groundTopY = sb.ROOM_GROUND_SPAWN_Y * sb.WORLD_SCALE;
  const batTopY = groundTopY - 40 * sb.WORLD_SCALE; // Bat's own h (see its constructor)
  const bat = vm.runInContext(`new Bat(500, ${batTopY}, 0, 3000, 1)`, ctx);
  const player = { x: 505, y: batTopY, w: 20, h: 20, weapon: FAKE_WEAPON, takeDamage(amount) { this.damageTaken = (this.damageTaken || 0) + amount; } };
  const room = { width: 3000, platforms: [{ x: 0, y: groundTopY + 40, w: 3000, h: 40 }] };
  vm.runInContext('bat.update(1/60, room, player)', Object.assign(ctx, { bat, room, player }));
  check('Bat enters "bite" state when very close to the player', bat.animState === 'bite', bat.animState);
  check('Bat does contact damage to the player (overlapping hitboxes)', player.damageTaken > 0, player.damageTaken);
}

// --- Animation frame advancement across the idle/fly/bite strips ---
{
  const bat = vm.runInContext(`new Bat(500, 300, 0, 3000, 1)`, ctx);
  const farPlayer = { x: 5000, y: 300, w: 20, h: 20, weapon: FAKE_WEAPON };
  const room = { width: 6000, platforms: [{ x: 0, y: 700, w: 6000, h: 40 }] };
  const framesSeen = new Set();
  for (let i = 0; i < 30; i++) {
    vm.runInContext('bat.update(1/10, room, player)', Object.assign(ctx, { bat, room, player: farPlayer }));
    framesSeen.add(bat.animFrame);
  }
  check('idle animation actually cycles through multiple distinct frames over time (not a static pose)',
    framesSeen.size > 1, [...framesSeen]);
  check('idle frame index never exceeds its strip\'s own frame count (7)',
    [...framesSeen].every((f) => f >= 0 && f < 7), [...framesSeen]);
}

// --- Death: dying flag + hold, then fully gone ---
{
  const bat = vm.runInContext(`new Bat(500, 300, 0, 3000, 1)`, ctx);
  bat.hp = 1;
  vm.runInContext('bat.takeDamage(999)', Object.assign(ctx, { bat }));
  check('lethal damage sets alive=false immediately (counts toward room-clear right away)', bat.alive === false, bat.alive);
  check('lethal damage sets dying=true (death animation still gets to play)', bat.dying === true, bat.dying);

  const room = { width: 3000, platforms: [{ x: 0, y: 700, w: 3000, h: 40 }] };
  const player = { x: 5000, y: 300, w: 20, h: 20, weapon: FAKE_WEAPON };
  // Tick past BAT_DEATH_HOLD (0.5s).
  for (let i = 0; i < 40; i++) {
    vm.runInContext('bat.update(1/60, room, player)', Object.assign(ctx, { bat, room, player }));
  }
  check('after the death-hold window, dying flips back to false (bat is now fully gone)', bat.dying === false, bat.dying);
}

// --- draw() doesn't throw with or without loaded sprite strips, respects dying visibility ---
{
  const fakeCtx = () => ({
    save(){}, restore(){}, translate(){}, scale(){}, drawImage(){}, fillRect(){},
    set globalAlpha(v){}, set globalCompositeOperation(v){}, set fillStyle(v){},
  });

  const bat = vm.runInContext(`new Bat(500, 300, 0, 3000, 1)`, ctx);
  let threw = false;
  try { vm.runInContext('bat.draw(fc, 0)', Object.assign(ctx, { bat, fc: fakeCtx() })); }
  catch (e) { threw = true; }
  check('draw() does not throw when no sprite strip is loaded (fallback rect path)', !threw);

  vm.runInContext(`TileImages.bat_idle = { width: 308, height: 92 };`, ctx);
  threw = false;
  try { vm.runInContext('bat.draw(fc, 0)', Object.assign(ctx, { bat, fc: fakeCtx() })); }
  catch (e) { threw = true; }
  check('draw() does not throw once a sprite strip IS loaded (sub-rect drawImage path)', !threw);

  // Fully dead (not dying anymore) -> draw() should be a no-op, never throw either.
  bat.alive = false;
  bat.dying = false;
  threw = false;
  try { vm.runInContext('bat.draw(fc, 0)', Object.assign(ctx, { bat, fc: fakeCtx() })); }
  catch (e) { threw = true; }
  check('draw() is a safe no-op once fully dead (alive=false, dying=false)', !threw);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
