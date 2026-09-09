// Regular-chain room visuals: the Trench (forest) and Dema (urban decay)
// biomes, plus the district-Bishop boss arenas' own wall tileset. Room
// PHYSICS (platform rectangles) still comes from world.js's createRoomN()
// functions, completely unchanged — this file only decides what those same
// rectangles are painted with. Dispatches off `room.biome` ('trench'|'dema',
// set by generateRoomChain() in game.js) or off Game.boss being live (arena
// rooms), the same "room doesn't know its own identity, the caller tells
// this file" pattern arenas.js already uses for per-Bishop backgrounds.
//
// Everything here is the same two cheap techniques used everywhere else in
// the renderer: a hash-picked tile variant per grid cell (see tiles.js's
// pickStoneVariant) and a scrolling-strip parallax layer (see arenas.js's
// tower silhouette) — no per-frame allocation, no particle loops.

const BIOME_TILE_DEST_SIZE = TILE_DEST_SIZE; // same on-screen brick size as the stone tiles, for grid consistency across biomes

function biomeHash(seed) {
  return (seed * 928371 + 123457) >>> 0;
}

// --- Trench (forest) ----------------------------------------------------
// Role-based, not random: the environment set is built as edge/middle/fill
// pieces, not interchangeable variants (Grass.png's top-grass strip only
// lines up correctly at the very top row; Ground.png has no grass at all
// and is meant purely as what's underneath). GrassCliff_L/R (a full rock
// face) is for the ground platform, which extends off past the bottom of
// the screen; GrassCliffEdge_L/R (a shorter lip, grass wrapping slightly
// under) is for floating ledges, where the underside is actually visible —
// see the request for exactly this distinction.
const TRENCH_EDGE = {
  ground: { left: 'trench_cliff_l', right: 'trench_cliff_r' },
  floating: { left: 'trench_cliff_edge_l', right: 'trench_cliff_edge_r' },
};

// `isFloating` picks which edge-tile pair to use (see TRENCH_EDGE above).
// Only the TOP row gets edge/middle treatment — everything below it is
// Ground.png fill straight down to the bottom of the rect, uniformly
// across every column, exactly as asked (no tile continues a "side face"
// down multiple rows; there's no source art for that here).
function drawTrenchTiledRect(ctx, x, y, w, h, camX, isFloating) {
  const startCol = Math.floor(x / BIOME_TILE_DEST_SIZE);
  const endCol = Math.ceil((x + w) / BIOME_TILE_DEST_SIZE);
  const startRow = Math.floor(y / BIOME_TILE_DEST_SIZE);
  const endRow = Math.ceil((y + h) / BIOME_TILE_DEST_SIZE);
  const edge = isFloating ? TRENCH_EDGE.floating : TRENCH_EDGE.ground;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x - camX, y, w, h);
  ctx.clip();
  for (let row = startRow; row < endRow; row++) {
    const isTop = row === startRow;
    for (let col = startCol; col < endCol; col++) {
      let key;
      if (isTop) {
        if (col === startCol) key = edge.left;
        else if (col === endCol - 1) key = edge.right;
        else key = 'trench_grass';
      } else {
        key = 'trench_ground';
      }
      const img = TileImages[key];
      if (!img) continue;
      ctx.drawImage(img, col * BIOME_TILE_DEST_SIZE - camX, row * BIOME_TILE_DEST_SIZE, BIOME_TILE_DEST_SIZE, BIOME_TILE_DEST_SIZE);
    }
  }
  ctx.restore();
}

// Back-to-front parallax stack. `factor` < 1 means the layer scrolls slower
// than the camera (reads as farther away) — starsky barely moves, clouds
// drift past fastest.
const TRENCH_BG_LAYERS = [
  { key: 'trench_bg_starsky', factor: 0.04 },
  { key: 'trench_bg_mountains', factor: 0.12 },
  { key: 'trench_bg_farforest', factor: 0.28 },
  { key: 'trench_bg_forest', factor: 0.48 },
  { key: 'trench_bg_clouds', factor: 0.68 },
];

// Draws `img` scaled to fill the canvas height exactly, tiled horizontally
// to cover the full width regardless of camX — shared by both biomes'
// backdrops below.
function drawParallaxLayer(ctx, img, camX, factor) {
  if (!img) return;
  const scale = CANVAS_H / img.height;
  const drawW = img.width * scale;
  const wrapped = (((camX * factor) % drawW) + drawW) % drawW;
  for (let x = -wrapped; x < CANVAS_W; x += drawW) {
    ctx.drawImage(img, x, 0, drawW, CANVAS_H);
  }
}

function drawTrenchBackdrop(ctx, camX) {
  for (const layer of TRENCH_BG_LAYERS) drawParallaxLayer(ctx, TileImages[layer.key], camX, layer.factor);
}

// 10-frame strips (160x16 native, 16px/frame) for the animated decor below.
const TRENCH_ANIM_FRAME = 16;
const TRENCH_ANIM_FRAMES = 10;
const TRENCH_ANIM_FPS = 8;

function drawTrenchAnimDecor(ctx, key, x, y, timestamp, size) {
  const img = TileImages[key];
  if (!img) return;
  const frame = Math.floor((timestamp / 1000) * TRENCH_ANIM_FPS) % TRENCH_ANIM_FRAMES;
  ctx.drawImage(img, frame * TRENCH_ANIM_FRAME, 0, TRENCH_ANIM_FRAME, TRENCH_ANIM_FRAME, x, y, size, size);
}

// Scatters a handful of static/animated decorations ON TOP of the already-
// assembled floor (drawn after drawTrenchTiledRect — see drawRoom() in
// main.js) — same deterministic-per-room-width approach as drawRoomDebris()
// in tiles.js. This is the one place in the biome that's still allowed to
// pick randomly per slot: small loose decor (stones, a campfire, a grave)
// scattered over a floor, not the floor's own tiling.
function drawTrenchDecor(ctx, room, camX, timestamp) {
  const ground = room.platforms[0];
  const decorSize = TILE_DEST_SIZE * 2.2;
  const smallDecorSize = TILE_DEST_SIZE * 1.1;
  const spacing = 260 * WORLD_SCALE;
  const slots = Math.max(1, Math.floor(room.width / spacing));
  for (let i = 0; i < slots; i++) {
    const roll = (biomeHash(i * 13 + 5) % 1000) / 1000;
    if (roll < 0.35) continue; // most slots stay empty, this is sparse dressing not wall-to-wall clutter
    const worldX = i * spacing + spacing * 0.5 - camX;
    if (worldX < -decorSize || worldX > CANVAS_W + decorSize) continue;
    const y = ground.y - decorSize;
    if (roll < 0.48) drawTrenchAnimDecor(ctx, 'trench_flame', worldX, y, timestamp, decorSize);
    else if (roll < 0.58) { const img = TileImages.trench_tombstone; if (img) ctx.drawImage(img, worldX, y, decorSize, decorSize); }
    else if (roll < 0.66) { const img = TileImages.trench_fireplace; if (img) ctx.drawImage(img, worldX, y, decorSize, decorSize); }
    else if (roll < 0.72) { const img = TileImages.trench_chest; if (img) ctx.drawImage(img, worldX, y, decorSize, decorSize); }
    // Loose rubble — small, sits lower/smaller than the "set piece" decor above.
    else if (roll < 0.79) { const img = TileImages.trench_stone1; if (img) ctx.drawImage(img, worldX, ground.y - smallDecorSize, smallDecorSize, smallDecorSize); }
    else if (roll < 0.86) { const img = TileImages.trench_stone2; if (img) ctx.drawImage(img, worldX, ground.y - smallDecorSize, smallDecorSize, smallDecorSize); }
    else if (roll < 0.91) { const img = TileImages.trench_little_stone; if (img) ctx.drawImage(img, worldX, ground.y - smallDecorSize, smallDecorSize, smallDecorSize); }
    else if (roll < 0.96) { const img = TileImages.trench_moss_stone; if (img) ctx.drawImage(img, worldX, ground.y - smallDecorSize, smallDecorSize, smallDecorSize); }
    else { const img = TileImages.trench_round_stone; if (img) ctx.drawImage(img, worldX, ground.y - smallDecorSize, smallDecorSize, smallDecorSize); }
  }
}

// --- Dema (urban decay) --------------------------------------------------
// There's no real edge/middle tile pair for platforms anywhere in
// urban_decay_sheet.png (the only piece ever cropped for that purpose,
// wall_solid.png, was one arbitrary flat crop from inside a building
// silhouette, not a designed tile) — so instead of leaning on that non-tile
// forever, platform surfaces are drawn procedurally: flat asphalt fill,
// a lighter top-edge cap stripe for readability, deterministic cracks/
// blotches scattered by world position (same hash technique as the rest of
// this file, not per-frame random) — the same idea as this game's very
// first (pre-texture) procedural platforms, just an asphalt palette.
const DEMA_ASPHALT_FILL = '#4a4d54';
const DEMA_ASPHALT_EDGE = '#8a8e98';
const DEMA_ASPHALT_EDGE_H = BIOME_TILE_DEST_SIZE * 0.22;
const DEMA_CRACK_SPACING = BIOME_TILE_DEST_SIZE * 2.5;

function drawDemaTiledRect(ctx, x, y, w, h, camX) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - camX, y, w, h);
  ctx.clip();

  ctx.fillStyle = DEMA_ASPHALT_FILL;
  ctx.fillRect(x - camX, y, w, h);
  ctx.fillStyle = DEMA_ASPHALT_EDGE;
  ctx.fillRect(x - camX, y, w, DEMA_ASPHALT_EDGE_H);

  const startSlot = Math.floor(x / DEMA_CRACK_SPACING);
  const endSlot = Math.ceil((x + w) / DEMA_CRACK_SPACING);
  ctx.strokeStyle = 'rgba(20,20,24,0.55)';
  ctx.lineWidth = 1.5;
  for (let i = startSlot; i < endSlot; i++) {
    const h1 = biomeHash(i * 31 + 7) % 1000;
    const slotX = i * DEMA_CRACK_SPACING - camX;
    if (h1 < 550) continue; // most slots stay clean asphalt, cracks are sparse wear
    const crackY = y + DEMA_ASPHALT_EDGE_H + (h1 % 100) / 100 * (h - DEMA_ASPHALT_EDGE_H) * 0.6;
    const crackLen = DEMA_CRACK_SPACING * (0.4 + (h1 % 37) / 37 * 0.5);
    ctx.beginPath();
    ctx.moveTo(slotX + DEMA_CRACK_SPACING * 0.2, crackY);
    ctx.lineTo(slotX + DEMA_CRACK_SPACING * 0.2 + crackLen, crackY + (h1 % 13) - 6);
    ctx.stroke();
    if (h1 > 800) {
      // an occasional dark stain blotch alongside the crack
      ctx.fillStyle = 'rgba(15,15,18,0.4)';
      ctx.beginPath();
      ctx.ellipse(slotX + DEMA_CRACK_SPACING * 0.6, crackY + 4, DEMA_CRACK_SPACING * 0.18, DEMA_CRACK_SPACING * 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// Five-layer parallax, back to front — atmospheric perspective: the
// farther a layer sits, the closer its brightness/contrast sits to the sky
// itself; the nearer, the darker and sharper its silhouette reads.
//   1. drawDemaFarFactory  — hazy factory-tower silhouette, barely apart
//      from the sky (procedural + a slight blur — see its own comment for
//      why this one isn't a cropped sprite).
//   2. drawDemaFarSkyline  — the hill/mountain-range silhouette, lighter
//      and slower than everything below it.
//   3. drawDemaPowerPoles  — power-pole-pairs-with-wire, mid-tint.
//   4. drawDemaMidBuildings — building silhouettes, darker still (no lit
//      windows — removed; the scene is fully monochrome blue-grey now).
//   5. drawDemaNearForeground — lamppost/bench/fence, darkest and fastest,
//      right in front of the player.
// See tiles.js for how each cropped sprite was recolored for its tier.
const DEMA_FACTORY_FACTOR = 0.03; // most distant thing in the scene — barely moves
const DEMA_FAR_FACTOR = 0.08;
const DEMA_POLE_FACTOR = 0.20;
const DEMA_MID_FACTOR = 0.28;
const DEMA_NEAR_FACTOR = 0.55;
const DEMA_NEAR_CELL_W = 260 * WORLD_SCALE;

// Farthest layer: two thin chimney tips, drawn as flat shapes rather than a
// cropped sprite — at this distance the request wants it "almost blending
// into the sky, but with a little contrast left". This used to be a full
// gantry-post-with-crossbeam silhouette, which — a lone vertical line with
// a horizontal bar near the top, repeated identically along the horizon —
// read as a row of grave markers on a hill, not a factory. Two unequal
// thin stacks, mostly tucked behind the hill peaks with only the taller
// one's tip clearing them, avoids that: there's no symmetric cross shape
// to misread, and which peak (if any) is visible drifts as the two layers
// scroll past each other at different parallax speeds, so it's never the
// same "floating object" twice. ctx.filter is reset immediately after so
// the blur never leaks into anything drawn afterward.
const DEMA_FACTORY_CELL_W = 340 * WORLD_SCALE;
const DEMA_FACTORY_COLOR = 'rgba(150, 148, 178, 0.42)';

function drawDemaFarFactory(ctx, camX) {
  const wrapped = (((camX * DEMA_FACTORY_FACTOR) % DEMA_FACTORY_CELL_W) + DEMA_FACTORY_CELL_W) % DEMA_FACTORY_CELL_W;
  // A little below the hills' own peak height (0.04, see
  // drawDemaFarSkyline) — most of each stack sits behind a hill peak, only
  // the tip of the taller one pokes clear of it.
  const groundY = CANVAS_H * 0.09;
  const stackW = CANVAS_H * 0.012;

  ctx.save();
  ctx.filter = 'blur(1.5px)';
  ctx.fillStyle = DEMA_FACTORY_COLOR;
  for (let x = -wrapped; x < CANVAS_W + DEMA_FACTORY_CELL_W; x += DEMA_FACTORY_CELL_W) {
    const pairX = x + DEMA_FACTORY_CELL_W * 0.35;
    ctx.fillRect(pairX, groundY - CANVAS_H * 0.05, stackW, CANVAS_H * 0.05);
    ctx.fillRect(pairX + CANVAS_H * 0.022, groundY - CANVAS_H * 0.07, stackW, CANVAS_H * 0.07);
  }
  ctx.filter = 'none';
  ctx.restore();
}

// Far layer: mountains_bg was cropped as a short silhouette strip, not a
// full-height sky image, so — unlike Trench's backgrounds, which ARE full-
// height art and use drawParallaxLayer directly — this one is anchored as
// a thin band near the horizon instead of stretched to fill the whole
// canvas (stretching it vertically blew its little peaks up into one giant
// wave across the entire screen). room.background (painted behind this by
// drawRoom() before drawBiomeBackdrop ever runs) is the actual dark sky.
function drawDemaFarSkyline(ctx, camX) {
  const img = TileImages.dema_far_skyline;
  if (!img) return;
  const targetH = CANVAS_H * 0.18;
  const scale = targetH / img.height;
  const drawW = img.width * scale;
  const wrapped = (((camX * DEMA_FAR_FACTOR) % drawW) + drawW) % drawW;
  // Anchored so it peeks above the mid-ground buildings' rooftop line
  // (baseY 0.16 there) rather than sitting fully behind them, unseen.
  const baseY = CANVAS_H * 0.22 - targetH;
  for (let x = -wrapped; x < CANVAS_W; x += drawW) {
    ctx.drawImage(img, x, baseY, drawW, targetH);
  }
}

// Power-pole-pairs-with-wire — its own mid-ground layer, sitting between
// the far hills and the mid buildings in both parallax speed and tint.
const DEMA_POLE_CELL_W = 300 * WORLD_SCALE;

function drawDemaPowerPoles(ctx, camX) {
  const img = TileImages.dema_powerpole;
  if (!img) return;
  // Taller than the buildings below (targetH there is 0.22) and based on
  // the same asphalt groundline — poles/wires read as sticking up above
  // the rooflines, the way they do in real life, instead of being hidden
  // behind them.
  const targetH = CANVAS_H * 0.30;
  const scale = targetH / img.height;
  const drawW = img.width * scale;
  const wrapped = (((camX * DEMA_POLE_FACTOR) % DEMA_POLE_CELL_W) + DEMA_POLE_CELL_W) % DEMA_POLE_CELL_W;
  const baseY = CANVAS_H * 0.58 - targetH;
  for (let x = -wrapped; x < CANVAS_W + DEMA_POLE_CELL_W; x += DEMA_POLE_CELL_W) {
    ctx.drawImage(img, x, baseY, drawW, targetH);
  }
}

// Mid layer: repeats the building silhouette like drawParallaxLayer would,
// but keyed off a stable per-instance SLOT index (not screen x, which
// shifts every frame as the camera pans) so the height-jitter hash below
// always picks the same value per building regardless of scroll position.
function drawDemaMidBuildings(ctx, camX) {
  const img = TileImages.dema_building;
  if (!img) return;
  // Shrunk from an earlier 0.42 (nearly half the screen, which read as one
  // flat wall rather than a building silhouette with a visible roofline) —
  // this keeps it clearly shorter than the power poles above and the far
  // hills further back.
  const targetH = CANVAS_H * 0.22;
  const scale = targetH / img.height;
  const drawW = img.width * scale;
  const groundY = CANVAS_H * 0.58; // feet stay on this line regardless of jitter below

  const parallaxX = camX * DEMA_MID_FACTOR;
  const firstSlot = Math.floor(parallaxX / drawW) - 1;
  const lastSlot = Math.ceil((parallaxX + CANVAS_W) / drawW) + 1;
  for (let slot = firstSlot; slot <= lastSlot; slot++) {
    const x = slot * drawW - parallaxX;
    // Per-building height jitter (feet fixed on groundY, only the roofline
    // moves) — with every instance the same fixed height, identical peaked
    // roofs tiled edge-to-edge lined up into one continuous zigzag "crown"
    // instead of reading as separate buildings. +-15% is enough to break
    // that without the row looking chaotic.
    const h = targetH * (0.85 + (biomeHash(slot * 13 + 29) % 1000) / 1000 * 0.3);
    const y = groundY - h;
    ctx.drawImage(img, x, y, drawW, h);
  }
}

// Near layer: lamppost + bench + a plain silhouette fence rail repeating
// every cell, darkest and fastest-scrolling of all five — the layer right
// in front of the player, deliberately unlit except for each lamp's own
// glow (and the light pool it casts on the ground beneath it).
function drawDemaNearForeground(ctx, camX) {
  const wrapped = (((camX * DEMA_NEAR_FACTOR) % DEMA_NEAR_CELL_W) + DEMA_NEAR_CELL_W) % DEMA_NEAR_CELL_W;
  const groundY = CANVAS_H * 0.58;
  const fenceH = TILE_DEST_SIZE * 1.6;
  const fenceTopY = groundY - fenceH;
  // Re-cropped — see tiles.js's comment: this used to be (by mistake) the
  // same power-pole shape now living in dema_powerpole above.
  const lampImg = TileImages.dema_streetlamp;
  const lampH = TILE_DEST_SIZE * 4.6;
  const lampW = lampImg ? lampH * (lampImg.width / lampImg.height) : 0;
  const lightconeImg = TileImages.dema_lightcone;
  const benchImg = TileImages.dema_bench;
  const benchH = TILE_DEST_SIZE * 1.4;
  const benchW = benchImg ? benchH * (benchImg.width / benchImg.height) : 0;

  ctx.save();
  ctx.fillStyle = '#0c0a12';
  for (let x = -wrapped; x < CANVAS_W + DEMA_NEAR_CELL_W; x += DEMA_NEAR_CELL_W) {
    ctx.fillRect(x, fenceTopY, DEMA_NEAR_CELL_W - 4, fenceH * 0.14);
    const postCount = 4;
    for (let p = 0; p < postCount; p++) {
      const px = x + (p / postCount) * DEMA_NEAR_CELL_W;
      ctx.fillRect(px, fenceTopY, TILE_DEST_SIZE * 0.18, fenceH);
    }
  }
  if (lampImg) {
    for (let x = -wrapped; x < CANVAS_W + DEMA_NEAR_CELL_W; x += DEMA_NEAR_CELL_W) {
      const lampX = x + DEMA_NEAR_CELL_W * 0.5;
      const lampTopY = groundY - lampH;
      const glowRadius = lampH * 0.55;
      const glow = ctx.createRadialGradient(lampX, lampTopY + lampH * 0.12, 2, lampX, lampTopY + lampH * 0.12, glowRadius);
      glow.addColorStop(0, 'rgba(120,150,255,0.35)');
      glow.addColorStop(1, 'rgba(120,150,255,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(lampX - glowRadius, lampTopY + lampH * 0.12 - glowRadius, glowRadius * 2, glowRadius * 2);
      // Light pool on the ground beneath the lamp — dema_lightcone existed
      // as a cropped asset already but was never actually drawn anywhere.
      if (lightconeImg) {
        const coneH = fenceH * 0.95;
        const coneW = coneH * (lightconeImg.width / lightconeImg.height);
        ctx.globalAlpha = 0.45;
        ctx.drawImage(lightconeImg, lampX - coneW / 2, groundY - coneH, coneW, coneH);
        ctx.globalAlpha = 1;
      }
      ctx.drawImage(lampImg, lampX - lampW / 2, lampTopY, lampW, lampH);
      // A bench sitting just inside the lamp's light pool.
      if (benchImg) ctx.drawImage(benchImg, lampX + lampW * 1.4, groundY - benchH, benchW, benchH);
    }
  }
  ctx.restore();
}

function drawDemaBackdrop(ctx, camX) {
  drawDemaFarFactory(ctx, camX);
  drawDemaFarSkyline(ctx, camX);
  drawDemaPowerPoles(ctx, camX);
  drawDemaMidBuildings(ctx, camX);
  drawDemaNearForeground(ctx, camX);
}

// --- Dispatchers, called from main.js's drawRoom() ----------------------
function drawBiomeBackdrop(ctx, room, camX, timestamp) {
  if (room.biome === 'trench') drawTrenchBackdrop(ctx, camX);
  else if (room.biome === 'dema') drawDemaBackdrop(ctx, camX);
}

function drawBiomeTiledRect(ctx, biome, x, y, w, h, camX, isFloating) {
  if (biome === 'trench') drawTrenchTiledRect(ctx, x, y, w, h, camX, isFloating);
  else drawDemaTiledRect(ctx, x, y, w, h, camX);
}

function drawBiomeDecor(ctx, room, camX, timestamp) {
  // Dema has no ground-level decor pass of its own anymore — its lamps and
  // neon windows are now part of the layered backdrop (see
  // drawDemaNearForeground/drawDemaMidBuildings above), not scattered
  // separately on top of the floor.
  if (room.biome === 'trench') drawTrenchDecor(ctx, room, camX, timestamp);
}

// --- Boss arenas: grungy_wall_tileset.png --------------------------------
// One sheet, a regular 4-col x 5-row grid of 32x32 tiles. Row 0 (indices
// 0-3) is the torch flame animation. Rows 1-4 (indices 4-19) looked like 16
// near-identical plain bricks at a glance, but the pack's own README says
// they're "modular wall variations including corners and edges" — a
// per-tile brightness scan (top/bottom/left/right strip vs. center) turned
// up a real, consistent 9-slice bank once measured objectively instead of
// eyeballed:
//   4=topLeft   5,6=topEdge     7=topRight
//   8=leftEdge  9=middle        11=rightEdge
//   12=bottomLeft 13,14=bottomEdge 15=bottomRight
// (10,16,17 are extra brighter interior variants, 18/19 are the pack's
// separate "fully lit" tiles for behind/above a torch — none of the three
// are used here: the request calls for ONE deterministic tile per role,
// not several to alternate between.)
//
// Unlike Trench/Dema (where only the exposed top row gets edge treatment,
// because the ground platform's sides/bottom are off-screen and there's no
// source art for them anyway), boss arena platforms are floating ledges
// with every side visible — so this uses the full 9-slice: real corners,
// real top/bottom/left/right edges, deterministic middle fill, no per-cell
// hash anywhere in the selection.
const BOSS_TILE_SRC = 32;
const BOSS_TILE_COLS = 4;
const BOSS_ROLE_TILE = {
  topLeft: 4, topEdge: 5, topRight: 7,
  leftEdge: 8, middle: 9, rightEdge: 11,
  bottomLeft: 12, bottomEdge: 13, bottomRight: 15,
};

function bossTileForCell(col, row, startCol, endCol, startRow, endRow) {
  const isTop = row === startRow;
  const isBottom = row === endRow - 1;
  const isLeft = col === startCol;
  const isRight = col === endCol - 1;

  if (isTop && isLeft) return BOSS_ROLE_TILE.topLeft;
  if (isTop && isRight) return BOSS_ROLE_TILE.topRight;
  if (isBottom && isLeft) return BOSS_ROLE_TILE.bottomLeft;
  if (isBottom && isRight) return BOSS_ROLE_TILE.bottomRight;
  if (isTop) return BOSS_ROLE_TILE.topEdge;
  if (isBottom) return BOSS_ROLE_TILE.bottomEdge;
  if (isLeft) return BOSS_ROLE_TILE.leftEdge;
  if (isRight) return BOSS_ROLE_TILE.rightEdge;
  return BOSS_ROLE_TILE.middle;
}

function drawBossWallTiledRect(ctx, x, y, w, h, camX) {
  const img = TileImages.boss_wall_sheet;
  const startCol = Math.floor(x / BIOME_TILE_DEST_SIZE);
  const endCol = Math.ceil((x + w) / BIOME_TILE_DEST_SIZE);
  const startRow = Math.floor(y / BIOME_TILE_DEST_SIZE);
  const endRow = Math.ceil((y + h) / BIOME_TILE_DEST_SIZE);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x - camX, y, w, h);
  ctx.clip();
  if (img) {
    for (let row = startRow; row < endRow; row++) {
      for (let col = startCol; col < endCol; col++) {
        const tileIdx = bossTileForCell(col, row, startCol, endCol, startRow, endRow);
        const srcCol = tileIdx % BOSS_TILE_COLS;
        const srcRow = Math.floor(tileIdx / BOSS_TILE_COLS);
        ctx.drawImage(
          img,
          srcCol * BOSS_TILE_SRC, srcRow * BOSS_TILE_SRC, BOSS_TILE_SRC, BOSS_TILE_SRC,
          col * BIOME_TILE_DEST_SIZE - camX, row * BIOME_TILE_DEST_SIZE, BIOME_TILE_DEST_SIZE, BIOME_TILE_DEST_SIZE,
        );
      }
    }
  } else {
    ctx.fillStyle = '#242c26';
    ctx.fillRect(x - camX, y, w, h);
  }
  ctx.restore();
}

// The 4-frame torch animation from the same sheet's top row — reuses the
// exact timestamp-driven frame-index pattern already established for the
// trench decor above (and, before that, arenas.js's torch flicker/Keons
// fog): `floor(timestamp/1000 * fps) % frameCount`, no stored timers needed.
const BOSS_TORCH_FRAMES = 4;
const BOSS_TORCH_FPS = 6;

function drawBossTorch(ctx, worldX, groundY, camX, timestamp) {
  const img = TileImages.boss_wall_sheet;
  if (!img) return;
  const frame = Math.floor((timestamp / 1000) * BOSS_TORCH_FPS) % BOSS_TORCH_FRAMES;
  const size = BIOME_TILE_DEST_SIZE * 2.4;
  const sx = worldX - camX;
  if (sx < -size || sx > CANVAS_W + size) return;
  ctx.drawImage(img, frame * BOSS_TILE_SRC, 0, BOSS_TILE_SRC, BOSS_TILE_SRC, sx - size / 2, groundY - size, size, size);
}

function drawBossArenaTorches(ctx, room, camX, timestamp) {
  const groundY = room.platforms[0].y;
  drawBossTorch(ctx, room.width * 0.18, groundY, camX, timestamp);
  drawBossTorch(ctx, room.width * 0.82, groundY, camX, timestamp);
}
