// Per-boss-arena visual identity. The arena's actual walls/floor are the
// Grungy 9-slice tileset (see biomes.js's drawBossWallTiledRect) — this
// file only adds what sits behind and around that: a darkened "deep wall"
// backdrop built from the same tileset (so the room reads as continuing
// back into the dark instead of a flat color), a per-Bishop colour wash,
// a screen-space vignette, and (Sakarver only) her HP-tied bleeding walls.
//
// This used to draw a hand-coded tower silhouette + a warm gradient blob and
// hang torch.png sconces off it — all placeholder art from before the
// Grungy tileset existed. Removed outright: the tileset's own 4-frame torch
// (drawBossArenaTorches in biomes.js, called from main.js) already covers
// the "torches on the arena" job, and the tower had no connection to the
// tileset's actual walls at all.

// Per-Bishop tint wash — a low-alpha colour cast over the whole arena, kept
// from the old tower's per-style colour field but repurposed (there's no
// tower to paint anymore). Vetomo stays yellow-ochre, Sakarver stays a
// blood red, etc. — same identity, just applied as atmosphere instead of a
// silhouette's fill colour.
const ARENA_TINT = {
  keons: { r: 95, g: 102, b: 118 },
  sakarver: { r: 150, g: 42, b: 46 },
  lisden: { r: 122, g: 88, b: 168 },
  reysdro: { r: 58, g: 104, b: 108 },
  vetomo: { r: 226, g: 182, b: 84 },
};

// Deep background: the same wall tileset's plain middle tile (see biomes.js's
// BOSS_ROLE_TILE), repeated at a slightly larger scale and lightly
// parallaxed, then darkened back down — reads as more of the same wall
// receding into the distance rather than another foreground surface.
const ARENA_DEEP_TILE_SCALE = 1.7;
const ARENA_DEEP_PARALLAX = 0.18;

function drawArenaDeepWall(ctx, camX) {
  const img = TileImages.boss_wall_sheet;
  if (!img) return;
  const tileSize = TILE_DEST_SIZE * ARENA_DEEP_TILE_SCALE;
  const offset = (((camX * ARENA_DEEP_PARALLAX) % tileSize) + tileSize) % tileSize;
  const midIdx = BOSS_ROLE_TILE.middle;
  const midCol = midIdx % BOSS_TILE_COLS;
  const midRow = Math.floor(midIdx / BOSS_TILE_COLS);

  ctx.save();
  ctx.globalAlpha = 0.55;
  for (let y = 0; y < CANVAS_H; y += tileSize) {
    for (let x = -offset - tileSize; x < CANVAS_W + tileSize; x += tileSize) {
      ctx.drawImage(img, midCol * BOSS_TILE_SRC, midRow * BOSS_TILE_SRC, BOSS_TILE_SRC, BOSS_TILE_SRC, x, y, tileSize, tileSize);
    }
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(4,4,6,0.55)'; // pushed back into shadow so it reads as distant, not a second set of foreground walls
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.restore();
}

function drawArenaTint(ctx, bishopKey) {
  const tint = ARENA_TINT[bishopKey];
  if (!tint) return;
  ctx.save();
  ctx.fillStyle = `rgba(${tint.r},${tint.g},${tint.b},0.11)`;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.restore();
}

// Sakarver's arena "bleeding" alongside her: a handful of red drip streaks
// down the back wall, longer/brighter the lower her HP fraction is (she has
// hurt herself more). hpFraction is undefined when she isn't the live boss
// (already-decided caller guards that), so this only needs the number.
const SAKARVER_DRIP_SLOTS = [0.15, 0.34, 0.55, 0.78, 0.92];
function drawBleedingWalls(ctx, room, camX, hpFraction) {
  const severity = clamp(1 - hpFraction, 0, 1);
  if (severity <= 0.02) return;
  const groundY = room.platforms[0].y;

  ctx.save();
  for (let i = 0; i < SAKARVER_DRIP_SLOTS.length; i++) {
    const worldX = room.width * SAKARVER_DRIP_SLOTS[i];
    const sx = worldX - camX;
    if (sx < -20 || sx > CANVAS_W + 20) continue;
    const dripLen = (40 + i * 17) * WORLD_SCALE * (0.3 + severity * 0.7);
    const grad = ctx.createLinearGradient(sx, 0, sx, dripLen);
    grad.addColorStop(0, `rgba(150, 30, 30, ${0.05 + severity * 0.1})`);
    grad.addColorStop(1, `rgba(150, 30, 30, ${0.35 + severity * 0.4})`);
    ctx.fillStyle = grad;
    ctx.fillRect(sx - 2 * WORLD_SCALE, 0, 4 * WORLD_SCALE, Math.min(dripLen, groundY));
  }
  ctx.restore();
}

// Backdrop layer: deep wall + tint wash + (Sakarver only) bleeding walls.
// Drawn right after the flat background fill, before platform tiles, so it
// reads as distant scenery behind the playable space. `boss` may be
// null/dead — every lookup below already tolerates that.
function drawArenaBackdrop(ctx, room, camX, timestamp, boss) {
  const bishopKey = boss && boss.bishopKey;
  if (!ARENA_TINT[bishopKey]) return; // non-boss rooms (chain rooms 1-5, hub, mirror finale) stay undecorated here

  drawArenaDeepWall(ctx, camX);
  drawArenaTint(ctx, bishopKey);

  if (bishopKey === 'sakarver' && boss.alive) {
    drawBleedingWalls(ctx, room, camX, boss.hp / boss.maxHp);
  }
}

// Screen-space vignette — darkens the canvas edges so focus stays on the
// arena's center regardless of camera scroll. Drawn as a post-process pass
// after everything else (see main.js), same as the old tower's glow blob
// was meant to draw the eye but, unlike that blob, this doesn't depend on
// any one Bishop's tower position.
const ARENA_VIGNETTE_CACHE = {};
function getArenaVignette(ctx) {
  if (!ARENA_VIGNETTE_CACHE.gradient) {
    const cx = CANVAS_W / 2, cy = CANVAS_H / 2;
    const inner = Math.min(CANVAS_W, CANVAS_H) * 0.35;
    const outer = Math.max(CANVAS_W, CANVAS_H) * 0.72;
    const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.45)');
    ARENA_VIGNETTE_CACHE.gradient = grad;
  }
  return ARENA_VIGNETTE_CACHE.gradient;
}

function drawArenaVignette(ctx, boss) {
  const bishopKey = boss && boss.bishopKey;
  if (!ARENA_TINT[bishopKey]) return;
  ctx.save();
  ctx.fillStyle = getArenaVignette(ctx);
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.restore();
}

// Keons only: a low, permanent, sickly-yellow fog band along the arena
// floor — present at all times (not just during the fear-mechanic smoke
// phase, which is the separate full-screen drawSmoke() in main.js), drawn
// AFTER platforms/entities so it sits in front like real ground haze.
const KEONS_FOG_HEIGHT = 90 * WORLD_SCALE;
function drawArenaFog(ctx, room, camX, timestamp, boss) {
  if (!boss || boss.bishopKey !== 'keons') return;
  const groundY = room.platforms[0].y;
  const drift = Math.sin(timestamp / 900) * 6 * WORLD_SCALE;
  const alpha = 0.16 + Math.sin(timestamp / 1500) * 0.04;

  ctx.save();
  const grad = ctx.createLinearGradient(0, groundY - KEONS_FOG_HEIGHT, 0, groundY);
  grad.addColorStop(0, 'rgba(196, 178, 94, 0)');
  grad.addColorStop(1, `rgba(196, 178, 94, ${alpha})`);
  ctx.fillStyle = grad;
  ctx.fillRect(drift, groundY - KEONS_FOG_HEIGHT, CANVAS_W, KEONS_FOG_HEIGHT);
  ctx.restore();
}
