// Tile loading + tiled-rect rendering for static environment geometry
// (platforms/floor/walls, hub ground), plus every other sprite in the game
// (player, enemy, bosses, chests, hub props) — they all reuse this same
// generic name->Image preload/cache machinery even though most of it isn't
// a tileable dungeon texture, just to avoid a second loader.
const TILE_SRC_SIZE = 16; // native px per tile in the source PNGs
const TILE_DEST_SIZE = TILE_SRC_SIZE * WORLD_SCALE;

// 12 pre-drawn heir character designs, each with a pre-mirrored twin for
// facing left (see heirs.js's HEIR_SKIN_COUNT and Player.draw()) — 24 files,
// generated here rather than listed by hand so adding a 13th skin later is a
// one-line constant bump, not a 2-line copy-paste per file.
const HEIR_SKIN_SOURCES = {};
for (let i = 1; i <= 12; i++) {
  const id = String(i).padStart(2, '0');
  HEIR_SKIN_SOURCES[`heir_${id}`] = `assets/sprites/heirs/heir_${id}.png`;
  HEIR_SKIN_SOURCES[`heir_${id}_mirrored`] = `assets/sprites/heirs/heir_${id}_mirrored.png`;
}

const TILE_SOURCES = {
  // Hub ground + the Mirror-finale arena's floor — same Kenney Tiny Dungeon
  // brick set as before, but now used by role instead of as 3 interchangeable
  // random variants (see drawTiledRect below). Found by brightness-scanning
  // the source sheet the same way the boss tileset's 9-slice was found: tile
  // 36 has a dark border ONLY on its left edge, tile 38 ONLY on its right —
  // those are genuine left/right edge pieces, not alternates of tile 37
  // (which is a plain, borderless brick run — the true middle). Tile 40 is a
  // different, also-borderless brick bond, reused as the "fill" body beneath
  // the surface row, echoing Trench's Grass-on-top/Ground-underneath split.
  stone_edge_l: 'assets/tiles/hub/StoneEdge_L.png',
  stone_edge_r: 'assets/tiles/hub/StoneEdge_R.png',
  stone_mid: 'assets/tiles/hub/StoneMid.png',
  stone_fill: 'assets/tiles/hub/StoneFill.png',
  // Custom-drawn rubble decal (replaced the original Kenney-sourced
  // placeholder — same filename/path, so no code change was needed
  // anywhere this is used). The matching wall-brazier placeholder
  // (torch.png) is gone — boss arenas now use only the Grungy tileset's
  // own 4-frame torch (see biomes.js's drawBossArenaTorches), and nothing
  // else in the game used the old sconce sprite.
  debris: 'assets/tiles/debris.png',
  // Shared silhouette for all five district Bishops (Keons/Sakarver/Lisden/
  // Reysdro/Vetomo) — see BossBase.drawBody() in boss.js. The finale
  // (Mirror/Blairface) uses the player's own heir_* skin instead, not this.
  boss_bishop_common: 'assets/sprites/boss_bishop_common.png',
  boss_bishop_common_mirrored: 'assets/sprites/boss_bishop_common_mirrored.png',
  // Rank-and-file enemy — see GloriousGone.draw() in enemy.js.
  enemy_grunt: 'assets/sprites/enemy_grunt.png',
  enemy_grunt_mirrored: 'assets/sprites/enemy_grunt_mirrored.png',
  // Loot chest, closed/open — see LootChest.draw() in chest.js.
  chest_closed: 'assets/sprites/chest_closed.png',
  chest_open: 'assets/sprites/chest_open.png',
  // Hub props — see hub.js. These have no in-game "facing" concept (static
  // scenery/NPCs that never turn), so only the base file of each is used;
  // the _mirrored twins that shipped alongside them sit unused in
  // assets/sprites/ rather than being wired to a flip that nothing triggers.
  hub_merchant: 'assets/sprites/hub_merchant.png',
  hub_portal: 'assets/sprites/hub_portal.png',
  hub_obelisk: 'assets/sprites/hub_obelisk.png',
  hub_scrapper: 'assets/sprites/hub_scrapper.png',
  hub_campfire: 'assets/sprites/hub_campfire.png',
  hub_tent_a: 'assets/sprites/hub_tent_a.png',
  hub_tent_b: 'assets/sprites/hub_tent_b.png',

  // Bat — the second rank-and-file enemy (see enemy.js's Bat class). Each
  // entry is a whole animation strip (frames laid out side by side, all
  // BAT_FRAME_W x BAT_FRAME_H); Bat.draw() picks a sub-rectangle out of the
  // loaded Image per-frame rather than this being one image per frame.
  bat_idle: 'assets/sprites/enemies/bat/idle.png',
  bat_fly: 'assets/sprites/enemies/bat/fly.png',
  bat_bite: 'assets/sprites/enemies/bat/bite.png',
  bat_hit_and_death: 'assets/sprites/enemies/bat/hit_and_death.png',
  // idle_to_fly / formation strips shipped in the same pack but aren't
  // wired to a game state yet (no take-off transition or group-flight
  // behavior exists) — loading them anyway costs one extra request each
  // and means they're a one-line change to actually use later.
  bat_idle_to_fly: 'assets/sprites/enemies/bat/idle_to_fly.png',
  bat_formation: 'assets/sprites/enemies/bat/formation.png',

  // Trench (forest) biome — see biomes.js. Ground/platform tile variants,
  // a handful of static decorations, and the 4-frame animated ones
  // (flame/water/bush/crown/fireflies) all pulled from the same
  // individually-exported 16x16 environment set.
  trench_ground: 'assets/tiles/trench/environment/Ground.png',
  trench_grass: 'assets/tiles/trench/environment/Grass.png',
  // Edge roles for platform assembly (see biomes.js's TRENCH_EDGE) — cliff
  // (full rock face) for the ground platform, cliffEdge (shorter lip) for
  // floating ledges where the underside is also visible.
  trench_cliff_l: 'assets/tiles/trench/environment/GrassCliff_L.png',
  trench_cliff_r: 'assets/tiles/trench/environment/GrassCliff_R.png',
  trench_cliff_edge_l: 'assets/tiles/trench/environment/GrassCliffEdge_L.png',
  trench_cliff_edge_r: 'assets/tiles/trench/environment/GrassCliffEdge_R.png',
  trench_stone1: 'assets/tiles/trench/environment/LargeStone1.png',
  trench_stone2: 'assets/tiles/trench/environment/LargeStone2.png',
  trench_little_stone: 'assets/tiles/trench/environment/LittleStone.png',
  trench_moss_stone: 'assets/tiles/trench/environment/LittleMossStone.png',
  trench_round_stone: 'assets/tiles/trench/environment/RoundStone.png',
  trench_tombstone: 'assets/tiles/trench/environment/Tombstone.png',
  trench_fireplace: 'assets/tiles/trench/environment/Fireplace.png',
  trench_chest: 'assets/tiles/trench/environment/ChestClosed.png',
  trench_tent: 'assets/tiles/trench/environment/Tent.png',
  trench_flame: 'assets/tiles/trench/animations/flame.png',
  trench_water: 'assets/tiles/trench/animations/water.png',
  trench_bush1: 'assets/tiles/trench/animations/bush1.png',
  trench_fireflies: 'assets/tiles/trench/animations/fireflies.png',
  // Trench parallax layers, back to front (see biomes.js's drawTrenchBackdrop).
  trench_bg_starsky: 'assets/tiles/trench/backgrounds/starsky.png',
  trench_bg_mountains: 'assets/tiles/trench/backgrounds/mountains.png',
  trench_bg_farforest: 'assets/tiles/trench/backgrounds/farforest.png',
  trench_bg_forest: 'assets/tiles/trench/backgrounds/forest.png',
  trench_bg_clouds: 'assets/tiles/trench/backgrounds/Clouds.png',

  // Dema (urban decay) biome — hand-cropped from the one big
  // urban_decay_sheet.png (see the commit that added these for the exact
  // pixel coordinates each was cut from — the sheet itself isn't tiled by
  // code anywhere, only these pre-cut pieces are).
  // Platform surfaces are drawn procedurally now (see biomes.js's
  // drawDemaTiledRect) — wall_solid.png is gone, it was never a real edge/
  // middle tile pair, just one arbitrary flat crop.
  // Far layer: mountains_bg.png screen-blended with a light lavender tint
  // so it reads as a hazy, LIT skyline — clearly lighter than both the
  // background and the mid-ground buildings below, not another near-black
  // silhouette lost in the dark.
  dema_far_skyline: 'assets/tiles/dema/far_skyline.png',
  // Power-pole pair (with the wire between them already part of the same
  // crop) — its own mid-ground layer, between the far skyline and the
  // buildings in both parallax speed and tint (see drawDemaPowerPoles).
  dema_powerpole: 'assets/tiles/dema/powerpole.png',
  // Mid layer: building_silhouette.png recolored from solid black to a
  // medium navy/purple flat fill — distinct from both the light far
  // skyline above and the procedural asphalt floor below.
  dema_building: 'assets/tiles/dema/building_mid.png',
  // Re-cropped from the sheet — the old streetlamp.png here was actually a
  // power pole (now dema_powerpole above); this is the real gooseneck
  // street-lamp shape, recolored to the same near-black as the fence rail
  // it stands next to (see drawDemaNearForeground).
  dema_streetlamp: 'assets/tiles/dema/streetlamp.png',
  dema_bench: 'assets/tiles/dema/bench.png',
  dema_lightcone: 'assets/tiles/dema/lightcone.png',

  // Boss arena walls — one sheet, sliced by sub-rectangle at draw time (see
  // arenas.js's drawBossWallTiledRect) rather than pre-cut into 20 files,
  // since it's a regular 4x5 grid of 32x32 tiles — index math is simpler
  // than 20 filenames. Row 0 (indices 0-3) is the torch flame animation;
  // indices 4-17 are the 14 plain wall variants actually tiled; 18/19 are
  // the pack's "lit" variants, used behind/above the torch decoration.
  boss_wall_sheet: 'assets/tiles/boss/grungy_wall_tileset.png',

  ...HEIR_SKIN_SOURCES,
};

const TileImages = {};
let tilesReady = false;

// Loads every image in TILE_SOURCES, then calls onComplete() — once, after
// all of them have either loaded or failed. A failed image is left out of
// TileImages; drawTiledRect() falls back to a flat fill if none loaded at
// all, so a missing file degrades instead of throwing.
function preloadTiles(onComplete) {
  const keys = Object.keys(TILE_SOURCES);
  let remaining = keys.length;
  const done = () => {
    remaining -= 1;
    if (remaining <= 0) {
      tilesReady = true;
      onComplete();
    }
  };
  for (const key of keys) {
    const img = new Image();
    img.onload = () => { TileImages[key] = img; done(); };
    img.onerror = done;
    img.src = TILE_SOURCES[key];
  }
}

// Role-based, not random (see TILE_SOURCES comment above for how the roles
// were found): only the exposed top row gets edge/middle treatment — left
// column is stone_edge_l, right column is stone_edge_r, everything between
// is stone_mid, always the same tile, never alternated by a per-cell hash.
// Every row below is stone_fill straight down to the bottom of the rect,
// uniformly across every column — both Hub's ground and the Mirror-finale
// floor are plain full-width grounds with no floating ledges, so there's no
// "isFloating" split to make here the way Trench needed one.
function drawTiledRect(ctx, x, y, w, h, camX) {
  if (!tilesReady || Object.keys(TileImages).length === 0) {
    ctx.fillStyle = '#3a4150';
    ctx.fillRect(x - camX, y, w, h);
    return;
  }

  const startCol = Math.floor(x / TILE_DEST_SIZE);
  const endCol = Math.ceil((x + w) / TILE_DEST_SIZE);
  const startRow = Math.floor(y / TILE_DEST_SIZE);
  const endRow = Math.ceil((y + h) / TILE_DEST_SIZE);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x - camX, y, w, h);
  ctx.clip();

  for (let row = startRow; row < endRow; row++) {
    const isTop = row === startRow;
    for (let col = startCol; col < endCol; col++) {
      let key;
      if (isTop) {
        if (col === startCol) key = 'stone_edge_l';
        else if (col === endCol - 1) key = 'stone_edge_r';
        else key = 'stone_mid';
      } else {
        key = 'stone_fill';
      }
      const img = TileImages[key];
      if (!img) continue;
      const dx = col * TILE_DEST_SIZE - camX;
      const dy = row * TILE_DEST_SIZE;
      ctx.drawImage(img, dx, dy, TILE_DEST_SIZE, TILE_DEST_SIZE);
    }
  }

  ctx.restore();
}

// Deterministic hash -> [0,1), same technique as pickStoneVariant: has to
// give the same scatter every frame (and every re-visit of the same room)
// or the debris would swim/flicker as the camera pans.
function hash01(seed) {
  const h = (seed * 2654435761) >>> 0;
  return (h % 100000) / 100000;
}

// Scatters a handful of debris tiles along a room's ground platform — cheap
// per-room-width variety (point 1: every arena otherwise reuses the exact
// same 3 stone tiles). Positions are derived from the room's own width via
// hash01 rather than stored anywhere, so this needs no changes to Room
// construction and costs nothing beyond N drawImage calls per frame.
const DEBRIS_SPACING = 210; // design-space px between scatter slots (pre-WORLD_SCALE)
function drawRoomDebris(ctx, room, camX) {
  const img = TileImages.debris;
  if (!img) return;
  const ground = room.platforms[0]; // convention: every room's first platform is the full-width floor
  const slotWidth = DEBRIS_SPACING * WORLD_SCALE;
  const slotCount = Math.floor(room.width / slotWidth);

  ctx.save();
  ctx.globalAlpha = 0.8;
  for (let i = 0; i < slotCount; i++) {
    // Skip roughly a third of slots so the debris reads as scattered rather
    // than a regular repeating row.
    if (hash01(i * 7 + 1) < 0.35) continue;
    const jitter = (hash01(i * 13 + 5) - 0.5) * slotWidth * 0.6;
    const x = i * slotWidth + slotWidth * 0.5 + jitter - camX;
    const y = ground.y - TILE_DEST_SIZE * 0.55;
    ctx.drawImage(img, x, y, TILE_DEST_SIZE, TILE_DEST_SIZE);
  }
  ctx.restore();
}

