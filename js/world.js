// Rooms, platform collision, and the shared physics step used by every
// grounded entity (player / enemy / boss) so gravity+collision logic lives
// in exactly one place.

const GRAVITY = 1800 * WORLD_SCALE; // px/s^2
const MAX_FALL_SPEED = 1200 * WORLD_SCALE; // px/s

class Room {
  constructor({ width, height, platforms, spawn, exitX = null, background = '#20242b' }) {
    this.width = width;
    this.height = height;
    this.platforms = platforms;
    this.spawn = spawn;
    this.exitX = exitX;
    this.background = background;
    // 0 (locked shut) -> 1 (open) — see drawExitDoor()/main.js's update(),
    // which ramps this toward 1 the instant the room's last enemy dies (not
    // gated on the player actually walking up to it), so the door swinging
    // open reads as "the way out just unlocked" rather than a static prop.
    this.doorOpenAmount = 0;
  }
}

const DOOR_WIDTH = 46 * WORLD_SCALE;
const DOOR_HEIGHT = 130 * WORLD_SCALE;
const DOOR_OPEN_SPEED = 1 / 0.45; // full swing over ~0.45s

// The room's exit, drawn as an actual door instead of a flat colored line:
// locked (dark leaves + a small red latch) while enemies remain, sliding
// open into its own frame posts to reveal the mustard glow behind once the
// room is cleared — keeping that glow as "the game's one color reward cue"
// (per the exit marker's original design intent) but now earned rather than
// always-on. A no-op for rooms with no exit (bosses/hub/mirror).
function drawExitDoor(ctx, room, camX, timestamp) {
  if (room.exitX === null) return;
  const groundY = room.platforms[0].y;
  const doorTop = groundY - DOOR_HEIGHT;
  const sx = room.exitX - camX;
  const openT = clamp(room.doorOpenAmount || 0, 0, 1);

  // Frame: two posts + a lintel, present regardless of open state.
  ctx.fillStyle = '#3a3226';
  ctx.fillRect(sx - DOOR_WIDTH / 2 - 5 * WORLD_SCALE, doorTop - 6 * WORLD_SCALE, DOOR_WIDTH + 10 * WORLD_SCALE, 6 * WORLD_SCALE);
  ctx.fillRect(sx - DOOR_WIDTH / 2 - 5 * WORLD_SCALE, doorTop, 5 * WORLD_SCALE, DOOR_HEIGHT);
  ctx.fillRect(sx + DOOR_WIDTH / 2, doorTop, 5 * WORLD_SCALE, DOOR_HEIGHT);

  // Glow behind the doorway — faint while locked, brightening (and gently
  // pulsing) as it opens.
  const glow = 0.12 + openT * 0.4 + Math.sin(timestamp / 260) * 0.05 * openT;
  ctx.fillStyle = `rgba(209, 177, 60, ${Math.max(0, glow)})`;
  ctx.fillRect(sx - DOOR_WIDTH / 2, doorTop, DOOR_WIDTH, DOOR_HEIGHT);

  // Two leaves, sliding apart into the posts as openT climbs toward 1.
  const leafW = DOOR_WIDTH / 2;
  const slide = leafW * openT;
  if (openT < 1) {
    ctx.fillStyle = openT > 0 ? '#5a4a35' : '#2b241c';
    ctx.fillRect(sx - DOOR_WIDTH / 2, doorTop, leafW - slide, DOOR_HEIGHT);
    ctx.fillRect(sx + slide, doorTop, leafW - slide, DOOR_HEIGHT);
  }

  // Locked-latch tell, distinct from the open glow — gone the instant the
  // door starts sliding.
  if (openT <= 0) {
    ctx.fillStyle = '#8a3a3a';
    ctx.beginPath();
    ctx.arc(sx, doorTop + DOOR_HEIGHT * 0.5, 4 * WORLD_SCALE, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Resolves gravity + platform collision for any entity with x,y,w,h,vx,vy.
// Axes are resolved separately (move+collide X, then move+collide Y) — doing
// both at once lets diagonal motion tunnel through platform corners.
function stepPhysics(entity, dt, room) {
  entity.x += entity.vx * dt;
  for (const p of room.platforms) {
    if (aabbIntersect(entity, p)) {
      if (entity.vx > 0) entity.x = p.x - entity.w;
      else if (entity.vx < 0) entity.x = p.x + p.w;
    }
  }
  entity.x = clamp(entity.x, 0, room.width - entity.w);

  entity.vy = Math.min(entity.vy + GRAVITY * dt, MAX_FALL_SPEED);
  entity.y += entity.vy * dt;
  entity.grounded = false;
  for (const p of room.platforms) {
    if (aabbIntersect(entity, p)) {
      if (entity.vy > 0) {
        entity.y = p.y - entity.h;
        entity.vy = 0;
        entity.grounded = true;
      } else if (entity.vy < 0) {
        entity.y = p.y + p.h;
        entity.vy = 0;
      }
    }
  }
}

// All literals below are the original design-space numbers * WORLD_SCALE —
// kept as the un-scaled value in a comment-free multiply so the layout's
// proportions are trivial to verify and retune.
function createRoom1() {
  const width = 2400 * WORLD_SCALE;
  const height = 540 * WORLD_SCALE;
  const groundY = 500 * WORLD_SCALE;
  return new Room({
    width,
    height,
    background: '#20242b',
    spawn: { x: 60 * WORLD_SCALE, y: groundY - 40 * WORLD_SCALE },
    exitX: width - 80 * WORLD_SCALE,
    platforms: [
      { x: 0, y: groundY, w: width, h: height - groundY },
      { x: 420 * WORLD_SCALE, y: 400 * WORLD_SCALE, w: 160 * WORLD_SCALE, h: 20 * WORLD_SCALE },
      { x: 720 * WORLD_SCALE, y: 320 * WORLD_SCALE, w: 140 * WORLD_SCALE, h: 20 * WORLD_SCALE },
      { x: 1050 * WORLD_SCALE, y: 420 * WORLD_SCALE, w: 200 * WORLD_SCALE, h: 20 * WORLD_SCALE },
      { x: 1400 * WORLD_SCALE, y: 340 * WORLD_SCALE, w: 160 * WORLD_SCALE, h: 20 * WORLD_SCALE },
      { x: 1700 * WORLD_SCALE, y: 420 * WORLD_SCALE, w: 180 * WORLD_SCALE, h: 20 * WORLD_SCALE },
      { x: 2050 * WORLD_SCALE, y: 380 * WORLD_SCALE, w: 160 * WORLD_SCALE, h: 20 * WORLD_SCALE },
    ],
  });
}

function createRoom2() {
  const width = 2400 * WORLD_SCALE;
  const height = 540 * WORLD_SCALE;
  const groundY = 500 * WORLD_SCALE;
  return new Room({
    width,
    height,
    background: '#22271f',
    spawn: { x: 60 * WORLD_SCALE, y: groundY - 40 * WORLD_SCALE },
    exitX: width - 80 * WORLD_SCALE,
    platforms: [
      { x: 0, y: groundY, w: width, h: height - groundY },
      { x: 380 * WORLD_SCALE, y: 420 * WORLD_SCALE, w: 150 * WORLD_SCALE, h: 20 * WORLD_SCALE },
      { x: 650 * WORLD_SCALE, y: 340 * WORLD_SCALE, w: 130 * WORLD_SCALE, h: 20 * WORLD_SCALE },
      { x: 900 * WORLD_SCALE, y: 420 * WORLD_SCALE, w: 160 * WORLD_SCALE, h: 20 * WORLD_SCALE },
      { x: 1200 * WORLD_SCALE, y: 300 * WORLD_SCALE, w: 140 * WORLD_SCALE, h: 20 * WORLD_SCALE },
      { x: 1500 * WORLD_SCALE, y: 400 * WORLD_SCALE, w: 180 * WORLD_SCALE, h: 20 * WORLD_SCALE },
      { x: 1850 * WORLD_SCALE, y: 340 * WORLD_SCALE, w: 150 * WORLD_SCALE, h: 20 * WORLD_SCALE },
      { x: 2150 * WORLD_SCALE, y: 420 * WORLD_SCALE, w: 150 * WORLD_SCALE, h: 20 * WORLD_SCALE },
    ],
  });
}

function createRoom3() {
  const width = 2400 * WORLD_SCALE;
  const height = 540 * WORLD_SCALE;
  const groundY = 500 * WORLD_SCALE;
  return new Room({
    width,
    height,
    background: '#241f22',
    spawn: { x: 60 * WORLD_SCALE, y: groundY - 40 * WORLD_SCALE },
    exitX: width - 80 * WORLD_SCALE,
    platforms: [
      { x: 0, y: groundY, w: width, h: height - groundY },
      { x: 400 * WORLD_SCALE, y: 380 * WORLD_SCALE, w: 120 * WORLD_SCALE, h: 20 * WORLD_SCALE },
      { x: 680 * WORLD_SCALE, y: 300 * WORLD_SCALE, w: 120 * WORLD_SCALE, h: 20 * WORLD_SCALE },
      { x: 950 * WORLD_SCALE, y: 420 * WORLD_SCALE, w: 140 * WORLD_SCALE, h: 20 * WORLD_SCALE },
      { x: 1250 * WORLD_SCALE, y: 340 * WORLD_SCALE, w: 120 * WORLD_SCALE, h: 20 * WORLD_SCALE },
      { x: 1550 * WORLD_SCALE, y: 260 * WORLD_SCALE, w: 140 * WORLD_SCALE, h: 20 * WORLD_SCALE },
      { x: 1850 * WORLD_SCALE, y: 380 * WORLD_SCALE, w: 160 * WORLD_SCALE, h: 20 * WORLD_SCALE },
      { x: 2150 * WORLD_SCALE, y: 300 * WORLD_SCALE, w: 140 * WORLD_SCALE, h: 20 * WORLD_SCALE },
    ],
  });
}

// Mid-chain boss arena (Sakarver) — same shape as createBossRoom but its own
// tint and, being earlier/smaller in scope, no exit needed either (boss
// rooms never have one; Game.continueAfterMidBoss() moves the run along
// programmatically once she's dead).
function createSakarverRoom() {
  const width = 1200 * WORLD_SCALE;
  const height = 540 * WORLD_SCALE;
  const groundY = 500 * WORLD_SCALE;
  return new Room({
    width,
    height,
    background: '#241c1c',
    spawn: { x: 60 * WORLD_SCALE, y: groundY - 40 * WORLD_SCALE },
    exitX: null,
    platforms: [
      { x: 0, y: groundY, w: width, h: height - groundY },
      { x: 260 * WORLD_SCALE, y: 400 * WORLD_SCALE, w: 140 * WORLD_SCALE, h: 20 * WORLD_SCALE },
      { x: 800 * WORLD_SCALE, y: 400 * WORLD_SCALE, w: 140 * WORLD_SCALE, h: 20 * WORLD_SCALE },
    ],
  });
}

function createRoom4() {
  const width = 2400 * WORLD_SCALE;
  const height = 540 * WORLD_SCALE;
  const groundY = 500 * WORLD_SCALE;
  return new Room({
    width,
    height,
    background: '#1f2429',
    spawn: { x: 60 * WORLD_SCALE, y: groundY - 40 * WORLD_SCALE },
    exitX: width - 80 * WORLD_SCALE,
    platforms: [
      { x: 0, y: groundY, w: width, h: height - groundY },
      { x: 340 * WORLD_SCALE, y: 400 * WORLD_SCALE, w: 170 * WORLD_SCALE, h: 20 * WORLD_SCALE },
      { x: 700 * WORLD_SCALE, y: 320 * WORLD_SCALE, w: 130 * WORLD_SCALE, h: 20 * WORLD_SCALE },
      { x: 1020 * WORLD_SCALE, y: 400 * WORLD_SCALE, w: 150 * WORLD_SCALE, h: 20 * WORLD_SCALE },
      { x: 1380 * WORLD_SCALE, y: 300 * WORLD_SCALE, w: 130 * WORLD_SCALE, h: 20 * WORLD_SCALE },
      { x: 1720 * WORLD_SCALE, y: 380 * WORLD_SCALE, w: 170 * WORLD_SCALE, h: 20 * WORLD_SCALE },
      { x: 2080 * WORLD_SCALE, y: 330 * WORLD_SCALE, w: 150 * WORLD_SCALE, h: 20 * WORLD_SCALE },
    ],
  });
}

function createRoom5() {
  const width = 2400 * WORLD_SCALE;
  const height = 540 * WORLD_SCALE;
  const groundY = 500 * WORLD_SCALE;
  return new Room({
    width,
    height,
    background: '#232026',
    spawn: { x: 60 * WORLD_SCALE, y: groundY - 40 * WORLD_SCALE },
    exitX: width - 80 * WORLD_SCALE,
    platforms: [
      { x: 0, y: groundY, w: width, h: height - groundY },
      { x: 300 * WORLD_SCALE, y: 340 * WORLD_SCALE, w: 130 * WORLD_SCALE, h: 20 * WORLD_SCALE },
      { x: 620 * WORLD_SCALE, y: 420 * WORLD_SCALE, w: 150 * WORLD_SCALE, h: 20 * WORLD_SCALE },
      { x: 960 * WORLD_SCALE, y: 300 * WORLD_SCALE, w: 130 * WORLD_SCALE, h: 20 * WORLD_SCALE },
      { x: 1300 * WORLD_SCALE, y: 400 * WORLD_SCALE, w: 160 * WORLD_SCALE, h: 20 * WORLD_SCALE },
      { x: 1660 * WORLD_SCALE, y: 260 * WORLD_SCALE, w: 140 * WORLD_SCALE, h: 20 * WORLD_SCALE },
      { x: 2000 * WORLD_SCALE, y: 380 * WORLD_SCALE, w: 160 * WORLD_SCALE, h: 20 * WORLD_SCALE },
    ],
  });
}

// Boss arenas. All share the same flat-with-two-ledges shape; only the
// width and the background tint differ, so each fight reads as its own
// place without needing bespoke geometry per Bishop.
function createReysdroRoom() {
  const width = 1300 * WORLD_SCALE;
  const height = 540 * WORLD_SCALE;
  const groundY = 500 * WORLD_SCALE;
  return new Room({
    width,
    height,
    background: '#1c2226',
    spawn: { x: 60 * WORLD_SCALE, y: groundY - 40 * WORLD_SCALE },
    exitX: null,
    platforms: [
      { x: 0, y: groundY, w: width, h: height - groundY },
      { x: 280 * WORLD_SCALE, y: 400 * WORLD_SCALE, w: 140 * WORLD_SCALE, h: 20 * WORLD_SCALE },
      { x: 880 * WORLD_SCALE, y: 400 * WORLD_SCALE, w: 140 * WORLD_SCALE, h: 20 * WORLD_SCALE },
    ],
  });
}

function createVetomoRoom() {
  const width = 1300 * WORLD_SCALE;
  const height = 540 * WORLD_SCALE;
  const groundY = 500 * WORLD_SCALE;
  return new Room({
    width,
    height,
    background: '#26221a',
    spawn: { x: 60 * WORLD_SCALE, y: groundY - 40 * WORLD_SCALE },
    exitX: null,
    platforms: [
      { x: 0, y: groundY, w: width, h: height - groundY },
      { x: 320 * WORLD_SCALE, y: 380 * WORLD_SCALE, w: 150 * WORLD_SCALE, h: 20 * WORLD_SCALE },
      { x: 840 * WORLD_SCALE, y: 380 * WORLD_SCALE, w: 150 * WORLD_SCALE, h: 20 * WORLD_SCALE },
    ],
  });
}

// Lisden's arena — wider than the other boss rooms (1600 vs 1200) so her
// 3 clone slots (see LisdenBoss.reclone in boss.js) have real separation
// instead of bunching together in a cramped space.
function createLisdenRoom() {
  const width = 1600 * WORLD_SCALE;
  const height = 540 * WORLD_SCALE;
  const groundY = 500 * WORLD_SCALE;
  return new Room({
    width,
    height,
    background: '#221f2a',
    spawn: { x: 60 * WORLD_SCALE, y: groundY - 40 * WORLD_SCALE },
    exitX: null,
    platforms: [
      { x: 0, y: groundY, w: width, h: height - groundY },
    ],
  });
}

function createBossRoom() {
  const width = 1200 * WORLD_SCALE;
  const height = 540 * WORLD_SCALE;
  const groundY = 500 * WORLD_SCALE;
  return new Room({
    width,
    height,
    background: '#262a25',
    spawn: { x: 60 * WORLD_SCALE, y: groundY - 40 * WORLD_SCALE },
    exitX: null,
    platforms: [
      { x: 0, y: groundY, w: width, h: height - groundY },
      { x: 300 * WORLD_SCALE, y: 400 * WORLD_SCALE, w: 140 * WORLD_SCALE, h: 20 * WORLD_SCALE },
      { x: 780 * WORLD_SCALE, y: 400 * WORLD_SCALE, w: 140 * WORLD_SCALE, h: 20 * WORLD_SCALE },
    ],
  });
}

// The finale arena — a flat, open stage befitting a duel with no distractions.
// Background stays neutral in phase 1 (mirror); the phase-2 Blairface
// palette swap is drawn on the boss sprite itself, not the room, so the
// arena doesn't need to change mid-fight.
function createMirrorRoom() {
  const width = 1400 * WORLD_SCALE;
  const height = 540 * WORLD_SCALE;
  const groundY = 500 * WORLD_SCALE;
  return new Room({
    width,
    height,
    background: '#1a1a20',
    spawn: { x: 60 * WORLD_SCALE, y: groundY - 40 * WORLD_SCALE },
    exitX: null,
    platforms: [
      { x: 0, y: groundY, w: width, h: height - groundY },
    ],
  });
}
