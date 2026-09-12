// The Arrow projectile itself: flight physics, termination conditions, and
// the tooltip labelling that goes with it.
//
// Slot/equip/ammo behaviour used to live here too, back when a bow shared
// the single melee weapon slot. That design is gone — the bow is its own
// equipment slot now — and all of it moved to test_bow_slot.js. What's left
// here is deliberately only what that file doesn't cover: the flying object.
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

// --- describeWeaponFull: range means different things per weapon type ---
{
  run('bowSample = generateBow();');
  check('describeWeaponFull labels a bow\'s range as arrow speed, not "Дистанция"',
    run('describeWeaponFull(bowSample)').includes('Скорость стрелы'));
  check('describeWeaponFull keeps "Дистанция" for a melee weapon',
    run('describeWeaponFull(STARTING_WEAPON)').includes('Дистанция'));
  check('isRangedWeapon() agrees with the type field',
    run('isRangedWeapon(bowSample)') === true && run('isRangedWeapon(STARTING_WEAPON)') === false);
}

// --- Arrow: real projectile — flies under gravity (arcs downward over
// time), lands the instant it touches a platform/floor, and leaves the
// room if nothing is in its way. `range` is not a distance cap (that was
// the original bug: it made a bow's shot cover the same ~melee-scale
// distance as a sword swing, in well under a tenth of a second) — it
// scales the arrow's launch speed instead. ---
{
  const room = { width: 10000, platforms: [] }; // wide + no floor -> it just keeps falling/flying
  const arrow = run(`new Arrow(100, 200, 1, 20, ${run('WEAPON_RANGE_MAX')}, '#c9b98a')`);
  check('a fresh Arrow starts alive', arrow.alive === true);
  check('a fresh Arrow starts with no vertical velocity (launches flat, not lobbed)', arrow.vy === 0);
  const startX = arrow.x, startY = arrow.y;
  vm.runInContext('arrow.update(1/60, room)', Object.assign(ctx, { arrow, room }));
  check('Arrow moves in its facing direction each frame', arrow.x > startX, { startX, x: arrow.x });
  check('Arrow picks up downward velocity from gravity immediately', arrow.vy > 0, arrow.vy);

  for (let i = 0; i < 120; i++) { // 2s of unobstructed flight
    vm.runInContext('arrow.update(1/60, room)', Object.assign(ctx, { arrow, room }));
  }
  check('over time, gravity visibly arcs the arrow downward (y increases)', arrow.y > startY, { startY, y: arrow.y });
  check('an Arrow with no floor in its way stays alive (no artificial distance cap kills it)', arrow.alive === true);
}
{
  // A higher-range weapon fires a faster arrow (range scales speed, not
  // distance) — same direction, more ground covered in the same time.
  const room = { width: 20000, platforms: [] };
  const slowArrow = run(`new Arrow(100, 200, 1, 20, ${run('WEAPON_RANGE_MIN')}, '#c9b98a')`);
  const fastArrow = run(`new Arrow(100, 200, 1, 20, ${run('WEAPON_RANGE_MAX')}, '#c9b98a')`);
  vm.runInContext('slowArrow.update(1/60, room); fastArrow.update(1/60, room)', Object.assign(ctx, { slowArrow, fastArrow, room }));
  check('a max-range bow fires a faster arrow than a min-range bow (range scales speed now, not distance)',
    fastArrow.x > slowArrow.x, { slowArrowX: slowArrow.x, fastArrowX: fastArrow.x });
}
{
  // Lands the instant it touches a platform underneath its flight path.
  const room = { width: 2000, platforms: [{ x: 0, y: 260, w: 2000, h: 40 }] };
  const arrow = run(`new Arrow(100, 200, 1, 20, ${run('WEAPON_RANGE_MIN')}, '#c9b98a')`);
  let landed = false;
  for (let i = 0; i < 300 && !landed; i++) {
    vm.runInContext('arrow.update(1/60, room)', Object.assign(ctx, { arrow, room }));
    if (!arrow.alive) landed = true;
  }
  check('Arrow disappears (lands) once its downward arc brings it into the floor', landed);
}
{
  // A wall/room edge still stops it if nothing else does first.
  const room = { width: 150, platforms: [] };
  const arrow = run(`new Arrow(100, 200, 1, 20, ${run('WEAPON_RANGE_MAX')}, '#c9b98a')`);
  for (let i = 0; i < 60 && arrow.alive; i++) {
    vm.runInContext('arrow.update(1/60, room)', Object.assign(ctx, { arrow, room }));
  }
  check('Arrow disappears once it flies past the room edge', arrow.alive === false);
}
{
  const room = { width: 2000, platforms: [] };
  const arrow = run(`new Arrow(100, 200, -1, 20, ${run('WEAPON_RANGE_MAX')}, '#c9b98a')`);
  const startX = arrow.x;
  vm.runInContext('arrow.update(1/60, room)', Object.assign(ctx, { arrow, room }));
  check('facing -1 flies leftward (decreasing x)', arrow.x < startX);
}
{
  // Arrow's own x/y/w/h/damage already match a melee hitbox's shape — that
  // structural compatibility is what lets main.js pass an Arrow straight
  // into resolveAttack() with no adapter.
  const arrow = run(`new Arrow(100, 200, 1, 20, ${run('WEAPON_RANGE_MAX')}, '#c9b98a')`);
  check('Arrow exposes x/y/w/h/damage — the exact shape resolveAttack() expects from a hitbox',
    ['x', 'y', 'w', 'h', 'damage'].every((k) => arrow[k] !== undefined));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
