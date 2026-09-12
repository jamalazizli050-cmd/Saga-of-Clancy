// Regression test for "Bat flies too high" — it used to be able to hover
// or chase all the way up to a flat 40*WORLD_SCALE (near the room's own
// top edge), well above anything a jump + swing could reach. The fix ties
// its flight ceiling to the player's own jump apex — and ONLY the jump
// apex: an earlier version of this fix also subtracted the player's current
// weapon range as "extra headroom", which was itself a bug (range is
// horizontal-only, see computeMeleeHitbox in utils.js) that could still
// leave the ceiling up to 117 world units above anywhere a full jump +
// swing could actually connect — which is exactly what the user's
// real-gameplay report ("они все еще не достают") was still seeing.
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

const groundTopY = run('ROOM_GROUND_SPAWN_Y * WORLD_SCALE');
const jumpHeight = run('(JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY)');
// weapon.range no longer factors into the vertical ceiling at all — range is
// horizontal-only (see computeMeleeHitbox in utils.js), so using it as
// vertical "headroom" was the actual bug: it let the ceiling sit up to 117
// world units above the player's real jump apex, i.e. somewhere a full jump
// + swing genuinely could not reach.
const weaponRange = 90; // kept only to prove the fake player's weapon field is now ignored
const expectedCeiling = groundTopY - jumpHeight;

console.log(`groundTopY=${groundTopY.toFixed(1)} jumpHeight=${jumpHeight.toFixed(1)} expectedCeiling=${expectedCeiling.toFixed(1)} (old buggy ceiling was ${(40 * run('WORLD_SCALE')).toFixed(1)})`);

check('the new ceiling is dramatically tighter than the old flat 40*WORLD_SCALE bug (jump+swing reachable, not the whole room)',
  expectedCeiling > 60 * run('WORLD_SCALE'), { expectedCeiling });

// --- THE user-reported scenario, end to end: a player standing normally on
// the ground, a bat aggro'd onto them. The bat must actually close to
// contact and bite. This is what stayed broken through two earlier rounds
// of "altitude" fixes: the ceiling was fine, but the FLOOR of the reachable
// band sat one full body-height too high (it subtracted the bat's own h from
// the ground line), so the bat's lowest legal spot was resting on the
// player's head — 60 units centre-to-centre against a 51-unit biteRange.
// It hovered right above them forever, unable to bite and unable to be hit. ---
{
  const bat = run(`new Bat(760, ${groundTopY}, 0, 3000, 1)`); // in aggro range, off to the right
  const room = { width: 3000, platforms: [{ x: 0, y: groundTopY + 60, w: 3000, h: 60 }] };
  // A player standing on the ground exactly the way the real one does:
  // ROOM_GROUND_SPAWN_Y is where a standing entity's TOP sits, and the real
  // Player is 40*WORLD_SCALE tall (see player.js).
  const player = {
    x: 600, y: groundTopY, w: 28 * run('WORLD_SCALE'), h: 40 * run('WORLD_SCALE'),
    weapon: { range: weaponRange },
    takeDamage(amount) { this.damageTaken = (this.damageTaken || 0) + amount; },
  };
  for (let i = 0; i < 300; i++) { // 5s to close the gap and bite
    vm.runInContext('bat.update(1/60, room, player)', Object.assign(ctx, { bat, room, player }));
  }
  check('an aggro\'d bat descends to the same vertical band as a player standing on the ground',
    bat.y < player.y + player.h && bat.y + bat.h > player.y,
    { batBox: [bat.y, bat.y + bat.h], playerBox: [player.y, player.y + player.h] });
  check('...and lands damage on them (the whole point — it used to hover just above their head forever)',
    player.damageTaken > 0, player.damageTaken);
  check('...repeatedly, rather than connecting once and then stalling out',
    player.damageTaken >= bat.contactDamage * 4, { damageTaken: player.damageTaken, perBite: bat.contactDamage });
  // The mirror image of the same problem: the player has to be able to hit
  // BACK. A standing swing's hitbox spans the player's own body (see
  // computeMeleeHitbox), so the bat has to end up inside that vertical band.
  const swingTop = player.y + 4 * run('WORLD_SCALE');
  const swingBottom = player.y + player.h - 4 * run('WORLD_SCALE');
  check('...and a standing (no-jump) swing can reach it back',
    bat.y < swingBottom && bat.y + bat.h > swingTop,
    { batBox: [bat.y, bat.y + bat.h], swingBox: [swingTop, swingBottom] });
}

// --- Hovering never drifts above the reachable ceiling, however long it runs ---
{
  const bat = run(`new Bat(500, ${groundTopY}, 0, 3000, 1)`);
  const room = { width: 3000, platforms: [] };
  const farPlayer = { x: 2900, y: groundTopY, w: 20, h: 20, weapon: { range: weaponRange } };
  let maxAltitudeY = Infinity; // smaller y = higher; track the highest point reached
  for (let i = 0; i < 600; i++) { // 10s of undisturbed hovering
    vm.runInContext('bat.update(1/60, room, player)', Object.assign(ctx, { bat, room, player: farPlayer }));
    maxAltitudeY = Math.min(maxAltitudeY, bat.y);
  }
  check('after 10s of hovering with nothing to disturb it, the bat never flew higher (smaller y) than the reachable ceiling',
    maxAltitudeY >= expectedCeiling - 1, { maxAltitudeY, expectedCeiling });
}

// --- Aggro toward a player who is above the reachable ceiling (but still
// within aggro range by raw distance — e.g. standing on a tall platform)
// pulls the bat UP TO the ceiling and settles it there, instead of
// continuing to press past it to match the player's exact y ---
{
  const bat = run(`new Bat(500, ${groundTopY - 60}, 0, 3000, 1)`); // spawned at the bottom of the reachable band
  const room = { width: 3000, platforms: [] };
  // pcy sits ~80 world units above expectedCeiling, and close enough
  // horizontally/vertically to stay within aggroRange (330) the whole
  // approach — a real "player is somewhere above the jump+swing band, but
  // not impossibly far" scenario, not a player who's simply out of aggro
  // range entirely (which is a separate, unrelated case).
  const playerPcy = expectedCeiling - 80;
  const closePlayer = { x: 505, y: playerPcy - 10, w: 20, h: 20, weapon: { range: weaponRange } };
  for (let i = 0; i < 300; i++) { // 5s — plenty of time to converge and settle
    vm.runInContext('bat.update(1/60, room, player)', Object.assign(ctx, { bat, room, player: closePlayer }));
  }
  check('chasing a player above the reachable band settles the bat AT the ceiling, not pressed past it',
    bat.y >= expectedCeiling - 1 && bat.y <= expectedCeiling + 5, { finalY: bat.y, expectedCeiling, playerPcy });
}

// --- Regression guard: the ceiling must NOT depend on the player's current
// weapon range at all anymore — that was the actual bug (range is
// horizontal-only; using it as vertical headroom let the ceiling sit above
// the player's real jump apex, unreachably high, for any longer-range
// weapon). A short-range and a long-range weapon must produce the exact
// same ceiling, and neither bat should ever fly higher than a range-blind
// jump-apex-only ceiling. ---
{
  const bat1 = run(`new Bat(500, ${groundTopY}, 0, 3000, 1)`);
  const bat2 = run(`new Bat(500, ${groundTopY}, 0, 3000, 1)`);
  const room = { width: 3000, platforms: [] };
  const shortWeaponPlayer = { x: 2900, y: groundTopY, w: 20, h: 20, weapon: { range: 33 } }; // WEAPON_RANGE_MIN-ish
  const longWeaponPlayer = { x: 2900, y: groundTopY, w: 20, h: 20, weapon: { range: 117 } }; // WEAPON_RANGE_MAX-ish
  let minY1 = Infinity, minY2 = Infinity;
  for (let i = 0; i < 300; i++) {
    vm.runInContext('bat1.update(1/60, room, p1)', Object.assign(ctx, { bat1, room, p1: shortWeaponPlayer }));
    vm.runInContext('bat2.update(1/60, room, p2)', Object.assign(ctx, { bat2, room, p2: longWeaponPlayer }));
    minY1 = Math.min(minY1, bat1.y);
    minY2 = Math.min(minY2, bat2.y);
  }
  check('a short-range weapon does not change the ceiling from the jump-apex-only value', minY1 >= expectedCeiling - 1, { minY1, expectedCeiling });
  check('a long-range (up to WEAPON_RANGE_MAX) weapon does NOT push the ceiling any higher — this was the actual bug', minY2 >= expectedCeiling - 1, { minY2, expectedCeiling });
  check('short- and long-range weapons produce the identical ceiling (range no longer factors in at all)', Math.abs(minY1 - minY2) < 1, { minY1, minY2 });
}

// --- The Bat-too-high bug is specifically fixed: hovering never reaches
// anywhere near the old buggy ceiling (40*WORLD_SCALE) ---
{
  const oldBuggyCeiling = 40 * run('WORLD_SCALE');
  const bat = run(`new Bat(500, ${groundTopY}, 0, 3000, 1)`);
  const room = { width: 3000, platforms: [] };
  const farPlayer = { x: 2900, y: groundTopY, w: 20, h: 20, weapon: { range: weaponRange } };
  let everNearOldCeiling = false;
  for (let i = 0; i < 600; i++) {
    vm.runInContext('bat.update(1/60, room, player)', Object.assign(ctx, { bat, room, player: farPlayer }));
    if (bat.y < oldBuggyCeiling + 50) everNearOldCeiling = true;
  }
  check('the bat never gets anywhere close to the old (buggy) near-ceiling altitude', !everNearOldCeiling, { oldBuggyCeiling });
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
