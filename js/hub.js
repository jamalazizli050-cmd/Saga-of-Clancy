// The hub: a small static camp scene rendered on the same canvas as
// gameplay, instead of a DOM menu. The player can walk around a short
// platform; a merchant and a portal are world objects you approach to
// interact with, rather than always-visible DOM buttons.

const HUB_WIDTH = 960 * WORLD_SCALE;
const HUB_HEIGHT = 540 * WORLD_SCALE;
const HUB_GROUND_Y = 460 * WORLD_SCALE;
const HUB_INTERACT_RANGE = 90 * WORLD_SCALE;

// The player's own rendered height (see player.js: `h = 40 * WORLD_SCALE`)
// — every hub prop sprite's visual size is expressed as a multiple of this
// single reference instead of each prop guessing its own pixel height off
// its (unrelated) interact-hitbox size. Ratios below are "how tall is this
// relative to a standing person", picked from what each sprite actually
// depicts (see assets/sprites/hub_*.png — several of these files had their
// content swapped between filenames when they were dropped in; re-verified
// each one visually before setting its scale here). The merchant and the
// scrapper are both standing/crouching people, so both use person-scale;
// the obelisk is "a tall dark monolith" per its own lore, etc.
const PLAYER_VISUAL_H = 40 * WORLD_SCALE;
const PROP_VISUAL_SCALE = {
  merchant: 1.0, // a hooded person (see the corrected hub_merchant.png), not the chest it used to be
  portal: 1.4,
  obelisk: 2.3,
  scrapper: 1.0,
  echoTrader: 1.05,
  campfire: 0.65,
  tentA: 1.3,
  tentB: 1.45,
};

const HubProps = {
  merchant: { x: 150 * WORLD_SCALE, y: HUB_GROUND_Y - 52 * WORLD_SCALE, w: 26 * WORLD_SCALE, h: 52 * WORLD_SCALE },
  portal: { x: 800 * WORLD_SCALE, y: HUB_GROUND_Y - 100 * WORLD_SCALE, w: 64 * WORLD_SCALE, h: 100 * WORLD_SCALE },
  campfire: { x: 460 * WORLD_SCALE, y: HUB_GROUND_Y },
  // Prestige spending point. Deliberately placed on the opposite side of
  // the camp from the merchant so the two economies aren't visually mixed.
  obelisk: { x: 300 * WORLD_SCALE, y: HUB_GROUND_Y - 118 * WORLD_SCALE, w: 34 * WORLD_SCALE, h: 118 * WORLD_SCALE },
  // The scrapper: a third, independent NPC (not the merchant, not the
  // obelisk) that buys unequipped inventory items. Sits in the gap between
  // the campfire and the second tent — clear of every other prop's
  // interact radius.
  scrapper: { x: 545 * WORLD_SCALE, y: HUB_GROUND_Y - 46 * WORLD_SCALE, w: 30 * WORLD_SCALE, h: 46 * WORLD_SCALE },
  // 5th station: converts gold+shards into Эхо at a rate deliberately worse
  // than just finishing a cycle (see game.js's ECHO_EXCHANGE_* comment) —
  // a release valve for leftover currency, not a competing strategy. Sits
  // between the obelisk and the campfire (both interact ranges checked
  // clear of it) since it's thematically the obelisk's "little sibling".
  echoTrader: { x: 410 * WORLD_SCALE, y: HUB_GROUND_Y - 50 * WORLD_SCALE, w: 26 * WORLD_SCALE, h: 50 * WORLD_SCALE },
  tents: [
    { x: 30 * WORLD_SCALE, y: HUB_GROUND_Y, w: 130 * WORLD_SCALE, h: 95 * WORLD_SCALE },
    { x: 610 * WORLD_SCALE, y: HUB_GROUND_Y, w: 150 * WORLD_SCALE, h: 105 * WORLD_SCALE },
  ],
};

function createHubRoom() {
  return new Room({
    width: HUB_WIDTH,
    height: HUB_HEIGHT,
    background: '#171a1f',
    spawn: { x: 420 * WORLD_SCALE, y: HUB_GROUND_Y - 40 * WORLD_SCALE },
    exitX: null,
    platforms: [
      { x: 0, y: HUB_GROUND_Y, w: HUB_WIDTH, h: HUB_HEIGHT - HUB_GROUND_Y },
    ],
  });
}

// Distance between entity centers, used for merchant/portal proximity checks.
function entityDistance(a, b) {
  const ax = a.x + a.w / 2, ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2, by = b.y + b.h / 2;
  return Math.hypot(ax - bx, ay - by);
}

// Draws `img` centered horizontally at `cx` with its bottom edge pinned to
// `bottomY`, scaled to `targetH` while preserving the source's own aspect
// ratio — used for every hub prop sprite below instead of stretching to a
// fixed w/h box, since (unlike the player/bosses) none of these have a
// gameplay hitbox tied to their exact pixel size, so there's no reason to
// distort bespoke art to fit one. Returns the drawn box so callers can use
// it for a highlight outline. `bob` optionally nudges bottomY for idle sway.
function drawAspectSprite(ctx, img, cx, bottomY, targetH, bob = 0) {
  const ratio = img.width / img.height;
  const w = targetH * ratio;
  const y = bottomY - targetH + bob;
  ctx.drawImage(img, cx - w / 2, y, w, targetH);
  return { x: cx - w / 2, y, w, h: targetH };
}

function drawTentSilhouette(ctx, tent, key, visualScale) {
  const img = TileImages[key];
  if (img) {
    drawAspectSprite(ctx, img, tent.x + tent.w / 2, HUB_GROUND_Y, PLAYER_VISUAL_H * visualScale);
    return;
  }
  ctx.fillStyle = '#20242b';
  ctx.beginPath();
  ctx.moveTo(tent.x, tent.y);
  ctx.lineTo(tent.x + tent.w / 2, tent.y - tent.h);
  ctx.lineTo(tent.x + tent.w, tent.y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#2c313b';
  ctx.beginPath();
  ctx.moveTo(tent.x + tent.w / 2, tent.y - tent.h);
  ctx.lineTo(tent.x + tent.w / 2, tent.y);
  ctx.stroke();
}

function drawCampfire(ctx, pos, t) {
  const flicker = 0.8 + Math.sin(t / 110) * 0.15 + Math.sin(t / 47) * 0.05;
  const glowRadius = 170 * WORLD_SCALE * flicker;

  const glow = ctx.createRadialGradient(pos.x, pos.y - 10 * WORLD_SCALE, 6 * WORLD_SCALE, pos.x, pos.y - 10 * WORLD_SCALE, glowRadius);
  glow.addColorStop(0, 'rgba(209, 177, 60, 0.30)');
  glow.addColorStop(1, 'rgba(209, 177, 60, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(pos.x - glowRadius, pos.y - 10 * WORLD_SCALE - glowRadius, glowRadius * 2, glowRadius * 2);

  const img = TileImages.hub_campfire;
  if (img) {
    // The glow (above) stays procedural either way — it's cheap, already
    // reacts to the flicker timing, and layering it under a static sprite
    // still sells "this is a light source" without needing an animated asset.
    drawAspectSprite(ctx, img, pos.x, pos.y, PLAYER_VISUAL_H * PROP_VISUAL_SCALE.campfire);
    return;
  }

  ctx.fillStyle = '#4a3d33';
  ctx.fillRect(pos.x - 16 * WORLD_SCALE, pos.y - 6 * WORLD_SCALE, 10 * WORLD_SCALE, 6 * WORLD_SCALE);
  ctx.fillRect(pos.x + 6 * WORLD_SCALE, pos.y - 6 * WORLD_SCALE, 10 * WORLD_SCALE, 6 * WORLD_SCALE);

  const flameH = (16 + Math.sin(t / 90) * 4) * WORLD_SCALE;
  ctx.fillStyle = '#c9a233';
  ctx.beginPath();
  ctx.moveTo(pos.x - 7 * WORLD_SCALE, pos.y - 6 * WORLD_SCALE);
  ctx.quadraticCurveTo(pos.x, pos.y - 6 * WORLD_SCALE - flameH, pos.x + 7 * WORLD_SCALE, pos.y - 6 * WORLD_SCALE);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#eddca0';
  ctx.beginPath();
  ctx.moveTo(pos.x - 3 * WORLD_SCALE, pos.y - 6 * WORLD_SCALE);
  ctx.quadraticCurveTo(pos.x, pos.y - 6 * WORLD_SCALE - flameH * 0.55, pos.x + 3 * WORLD_SCALE, pos.y - 6 * WORLD_SCALE);
  ctx.closePath();
  ctx.fill();
}

// Merchant/scrapper (the two actual people in the hub) get a slow idle sway
// on top of the sprite draw — see spriteAnim.js's constants, reused here
// via a plain sine rather than a full SpriteAnimator since these props are
// drawn from stateless functions (no per-frame update() to accumulate a
// phase in) and never do anything BUT idle (no walk/jump to animate).
function idleBob(t, phaseOffset) {
  return Math.sin(t / (1000 / IDLE_BOB_RATE) + phaseOffset) * IDLE_BOB_AMPLITUDE;
}

function drawMerchant(ctx, m, highlighted, t = 0) {
  const img = TileImages.hub_merchant;
  if (img) {
    const box = drawAspectSprite(ctx, img, m.x + m.w / 2, HUB_GROUND_Y, PLAYER_VISUAL_H * PROP_VISUAL_SCALE.merchant, idleBob(t, 0));
    if (highlighted) {
      ctx.strokeStyle = '#d1b13c';
      ctx.strokeRect(box.x - 3 * WORLD_SCALE, box.y - 3 * WORLD_SCALE, box.w + 6 * WORLD_SCALE, box.h + 6 * WORLD_SCALE);
    }
    return;
  }

  ctx.fillStyle = highlighted ? '#7a5252' : '#5a3d3d';
  ctx.fillRect(m.x, m.y, m.w, m.h);
  ctx.fillStyle = '#caa96a';
  ctx.beginPath();
  ctx.arc(m.x + m.w / 2, m.y - 6 * WORLD_SCALE, 8 * WORLD_SCALE, 0, Math.PI * 2);
  ctx.fill();
  if (highlighted) {
    ctx.strokeStyle = '#d1b13c';
    ctx.strokeRect(m.x - 3 * WORLD_SCALE, m.y - 15 * WORLD_SCALE, m.w + 6 * WORLD_SCALE, m.h + 15 * WORLD_SCALE);
  }
}

function drawPortal(ctx, p, t, highlighted) {
  const img = TileImages.hub_portal;
  if (img) {
    const box = drawAspectSprite(ctx, img, p.x + p.w / 2, HUB_GROUND_Y, PLAYER_VISUAL_H * PROP_VISUAL_SCALE.portal);
    // The pulsing glow stays procedural — it's the "is this thing active"
    // readout, cheap, and reacts live to `highlighted` every frame. Inset
    // proportionally to the actual drawn box (not the unrelated interact
    // hitbox) so it still sits inside the archway at any scale.
    const pulse = (highlighted ? 0.35 : 0.18) + Math.sin(t / 260) * 0.1;
    ctx.fillStyle = `rgba(209, 177, 60, ${pulse})`;
    ctx.fillRect(box.x + box.w * 0.16, box.y + box.h * 0.07, box.w * 0.68, box.h * 0.86);
    if (highlighted) {
      ctx.strokeStyle = '#d1b13c';
      ctx.strokeRect(box.x - 4 * WORLD_SCALE, box.y - 4 * WORLD_SCALE, box.w + 8 * WORLD_SCALE, box.h + 4 * WORLD_SCALE);
    }
    return;
  }

  ctx.fillStyle = '#3a4150';
  ctx.fillRect(p.x, p.y, 10 * WORLD_SCALE, p.h);
  ctx.fillRect(p.x + p.w - 10 * WORLD_SCALE, p.y, 10 * WORLD_SCALE, p.h);
  ctx.fillRect(p.x, p.y, p.w, 10 * WORLD_SCALE);

  const pulse = (highlighted ? 0.85 : 0.55) + Math.sin(t / 260) * 0.2;
  ctx.fillStyle = `rgba(209, 177, 60, ${pulse})`;
  ctx.fillRect(p.x + 10 * WORLD_SCALE, p.y + 10 * WORLD_SCALE, p.w - 20 * WORLD_SCALE, p.h - 10 * WORLD_SCALE);

  if (highlighted) {
    ctx.strokeStyle = '#d1b13c';
    ctx.strokeRect(p.x - 4 * WORLD_SCALE, p.y - 4 * WORLD_SCALE, p.w + 8 * WORLD_SCALE, p.h + 4 * WORLD_SCALE);
  }
}

// The obelisk: a tall dark monolith with a slow-pulsing seam. Cool-toned
// on purpose — it reads as a different economy from the mustard merchant.
function drawObelisk(ctx, o, t, highlighted) {
  const img = TileImages.hub_obelisk;
  if (img) {
    const box = drawAspectSprite(ctx, img, o.x + o.w / 2, HUB_GROUND_Y, PLAYER_VISUAL_H * PROP_VISUAL_SCALE.obelisk);
    const pulse = (highlighted ? 0.4 : 0.2) + Math.sin(t / 420) * 0.12;
    ctx.fillStyle = `rgba(111, 163, 184, ${pulse})`;
    ctx.fillRect(box.x + box.w / 2 - 2 * WORLD_SCALE, box.y + box.h * 0.1, 4 * WORLD_SCALE, box.h * 0.8);
    if (highlighted) {
      ctx.strokeStyle = '#6fa3b8';
      ctx.strokeRect(box.x - 4 * WORLD_SCALE, box.y - 4 * WORLD_SCALE, box.w + 8 * WORLD_SCALE, box.h + 4 * WORLD_SCALE);
    }
    return;
  }

  ctx.fillStyle = '#22262e';
  ctx.fillRect(o.x, o.y, o.w, o.h);
  ctx.fillStyle = '#2b3038';
  ctx.fillRect(o.x + 4 * WORLD_SCALE, o.y + 6 * WORLD_SCALE, o.w - 8 * WORLD_SCALE, o.h - 6 * WORLD_SCALE);

  const pulse = (highlighted ? 0.85 : 0.45) + Math.sin(t / 420) * 0.18;
  ctx.fillStyle = `rgba(111, 163, 184, ${pulse})`;
  ctx.fillRect(o.x + o.w / 2 - 2 * WORLD_SCALE, o.y + 14 * WORLD_SCALE, 4 * WORLD_SCALE, o.h - 28 * WORLD_SCALE);

  if (highlighted) {
    ctx.strokeStyle = '#6fa3b8';
    ctx.strokeRect(o.x - 4 * WORLD_SCALE, o.y - 4 * WORLD_SCALE, o.w + 8 * WORLD_SCALE, o.h + 4 * WORLD_SCALE);
  }
}

// The scrapper: a junk-crate stall, olive/rust toned so it reads as a third,
// distinct economy from the merchant's mustard and the obelisk's cool blue.
function drawScrapper(ctx, s, highlighted, t = 0) {
  const img = TileImages.hub_scrapper;
  if (img) {
    const box = drawAspectSprite(ctx, img, s.x + s.w / 2, HUB_GROUND_Y, PLAYER_VISUAL_H * PROP_VISUAL_SCALE.scrapper, idleBob(t, 2));
    if (highlighted) {
      ctx.strokeStyle = '#c9b96a';
      ctx.strokeRect(box.x - 3 * WORLD_SCALE, box.y - 3 * WORLD_SCALE, box.w + 6 * WORLD_SCALE, box.h + 6 * WORLD_SCALE);
    }
    return;
  }

  ctx.fillStyle = highlighted ? '#7a7a45' : '#5c5c34';
  ctx.fillRect(s.x, s.y, s.w, s.h);
  ctx.fillStyle = '#8a6a3d';
  ctx.fillRect(s.x - 4 * WORLD_SCALE, s.y + s.h - 10 * WORLD_SCALE, s.w + 8 * WORLD_SCALE, 10 * WORLD_SCALE);
  // A little pile of junk on top: a couple of mismatched rusty scraps.
  ctx.fillStyle = '#a3927a';
  ctx.fillRect(s.x + 4 * WORLD_SCALE, s.y - 8 * WORLD_SCALE, 10 * WORLD_SCALE, 8 * WORLD_SCALE);
  ctx.fillStyle = '#79614a';
  ctx.fillRect(s.x + s.w - 14 * WORLD_SCALE, s.y - 5 * WORLD_SCALE, 9 * WORLD_SCALE, 5 * WORLD_SCALE);
  if (highlighted) {
    ctx.strokeStyle = '#c9b96a';
    ctx.strokeRect(s.x - 3 * WORLD_SCALE, s.y - 12 * WORLD_SCALE, s.w + 6 * WORLD_SCALE, s.h + 12 * WORLD_SCALE);
  }
}

// The Echo trader: a robed figure like the merchant/scrapper, but tinted
// to match the prestige stat's own violet (--prestige in style.css) so it
// visually reads as "the same currency as the obelisk" at a glance,
// distinct from the merchant's mustard and the scrapper's olive/rust.
function drawEchoTrader(ctx, e, highlighted, t = 0) {
  const img = TileImages.hub_echo_trader;
  if (img) {
    const box = drawAspectSprite(ctx, img, e.x + e.w / 2, HUB_GROUND_Y, PLAYER_VISUAL_H * PROP_VISUAL_SCALE.echoTrader, idleBob(t, 4));
    if (highlighted) {
      ctx.strokeStyle = '#b58ac9';
      ctx.strokeRect(box.x - 3 * WORLD_SCALE, box.y - 3 * WORLD_SCALE, box.w + 6 * WORLD_SCALE, box.h + 6 * WORLD_SCALE);
    }
    return;
  }

  ctx.fillStyle = highlighted ? '#6a5578' : '#4a3d54';
  ctx.fillRect(e.x, e.y, e.w, e.h);
  // A small floating "echo" glint above the head — cheap, but distinct
  // from every other prop's silhouette at a glance.
  const glintY = e.y - 10 * WORLD_SCALE + Math.sin(t / 260) * 2 * WORLD_SCALE;
  ctx.fillStyle = 'rgba(181, 138, 201, 0.85)';
  ctx.beginPath();
  ctx.arc(e.x + e.w / 2, glintY, 5 * WORLD_SCALE, 0, Math.PI * 2);
  ctx.fill();
  if (highlighted) {
    ctx.strokeStyle = '#b58ac9';
    ctx.strokeRect(e.x - 3 * WORLD_SCALE, e.y - 16 * WORLD_SCALE, e.w + 6 * WORLD_SCALE, e.h + 16 * WORLD_SCALE);
  }
}

function drawHubScene(ctx, timestamp, nearMerchant, nearPortal, nearObelisk, nearScrapper, nearEchoTrader) {
  const sky = ctx.createLinearGradient(0, 0, 0, HUB_GROUND_Y);
  sky.addColorStop(0, '#12141a');
  sky.addColorStop(1, '#20242b');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, HUB_WIDTH, HUB_GROUND_Y);

  // Hub never scrolls, so camX is always 0 here.
  drawTiledRect(ctx, 0, HUB_GROUND_Y, HUB_WIDTH, HUB_HEIGHT - HUB_GROUND_Y, 0);

  const tentKeys = ['hub_tent_a', 'hub_tent_b'];
  const tentScales = [PROP_VISUAL_SCALE.tentA, PROP_VISUAL_SCALE.tentB];
  HubProps.tents.forEach((tent, i) => drawTentSilhouette(ctx, tent, tentKeys[i], tentScales[i]));
  drawCampfire(ctx, HubProps.campfire, timestamp);
  drawObelisk(ctx, HubProps.obelisk, timestamp, nearObelisk);
  drawMerchant(ctx, HubProps.merchant, nearMerchant, timestamp);
  drawScrapper(ctx, HubProps.scrapper, nearScrapper, timestamp);
  drawEchoTrader(ctx, HubProps.echoTrader, nearEchoTrader, timestamp);
  drawPortal(ctx, HubProps.portal, timestamp, nearPortal);
}
