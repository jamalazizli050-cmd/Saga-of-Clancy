// Entry point: canvas setup, the fixed-timestep-ish game loop, rendering,
// and wiring buttons / hub interactions to Game methods.

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');

// Fixed logical draw space: all gameplay/render code below works in these
// units regardless of the canvas's actual on-screen size or the display's
// device pixel ratio — see fitToDisplaySize().
const BASE_W = 960 * WORLD_SCALE;
const BASE_H = 540 * WORLD_SCALE;
const CANVAS_W = BASE_W;
const CANVAS_H = BASE_H;

overlay.style.width = BASE_W + 'px';
overlay.style.height = BASE_H + 'px';

// Keeps the canvas's backing-store resolution matched to its actual CSS
// display size * devicePixelRatio (so shapes stay crisp instead of blurring
// when the responsive #stage is stretched), and re-derives the transform
// that maps our fixed BASE_W x BASE_H logical space onto that backing store.
// The DOM overlay (HUD, floating panels) is authored in the same logical
// space, so it's scaled by the same ratio to stay pixel-aligned with it.
// None of this touches input handling — mouse clicks are read as plain
// button state (see input.js), never as coordinates, so there's nothing
// here for a resize to desync.
function fitToDisplaySize() {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  const dpr = window.devicePixelRatio || 1;
  const pixelW = Math.round(rect.width * dpr);
  const pixelH = Math.round(rect.height * dpr);
  if (canvas.width !== pixelW || canvas.height !== pixelH) {
    canvas.width = pixelW;
    canvas.height = pixelH;
  }
  ctx.setTransform(canvas.width / BASE_W, 0, 0, canvas.height / BASE_H, 0, 0);

  overlay.style.transform = `scale(${rect.width / BASE_W})`;
}

new ResizeObserver(fitToDisplaySize).observe(canvas);
fitToDisplaySize();

let hubNearMerchant = false;
let hubNearPortal = false;
let hubNearObelisk = false;
let hubNearScrapper = false;
let hubNearEchoTrader = false;
let nearestChest = null;

// Inventory can open mid-run/mid-boss as well as in the hub; the scrapper
// only makes sense in the hub. Both fully pause update()/updateHub() (see
// loop()) while still rendering every frame, so the frozen world stays
// visible behind the modal instead of the screen going blank. Only one
// modal is ever open at a time.
let inventoryOpen = false;
let scrapperOpen = false;

// Escape (from hub/run/boss) opens this — same freeze mechanism as
// inventory/scrapper above. Chronicle/credits are opened FROM the pause
// menu (see openChronicle/openCredits below): they hide the pause panel's
// own DOM but leave pauseOpen (and the game-loop freeze) on, so closing
// either one returns to the pause menu rather than fully unpausing.
let pauseOpen = false;
let chronicleOpen = false;
let creditsOpen = false;

// Small punch-list-friendly stamp, not a real semver — just enough for a
// friends-and-testers beta build to say "which version is this" in a bug
// report. Shown in the title screen's bottom-right corner.
const GAME_VERSION_STAMP = 'v0.1 (бета) · сборка 2026-09-10';

function buildTitleScreenOpts() {
  return {
    hasSave: Game.hasSaveProgress(),
    gold: Game.save.gold,
    shards: Game.save.shards,
    prestige: Game.save.prestige,
    cycleCount: Game.save.cycleCount,
    version: GAME_VERSION_STAMP,
  };
}

// Treasure room's choice panel. Freezes the game the same way the inventory
// does (see `paused` in loop()) — there are no enemies in a treasure room,
// but a frozen world behind the panel is what every other modal here does,
// and consistency beats a special case.
let treasureOpen = false;

function openTreasurePanel() {
  treasureOpen = true;
  // Same display-accuracy fix as bandageStatus() (see its comment): Survivor
  // sees the heal option's REAL number here, not the nominal one every other
  // heir gets — TREASURE_CHOICES itself stays untouched (it's what every
  // other archetype actually sees), this only overrides the one line.
  const survivorMul = Game.player.archetype === 'survivor' ? SURVIVOR_HEAL_MUL : 1;
  const choices = TREASURE_CHOICES.map((c) => c.id === 'heal'
    ? { ...c, detail: `+${Math.round(TREASURE_HEAL_FRACTION * survivorMul * 100)}% HP` }
    : c);
  HUD.setTreasurePanel(true, {
    choices,
    onChoose: (id) => {
      const picked = Game.applyTreasureChoice(id);
      treasureOpen = false;
      HUD.setTreasurePanel(false);
      if (picked) {
        const p = Game.player;
        Effects.burst(p.x + p.w / 2, p.y + p.h / 2, '#d1b13c', 24, 8 * WORLD_SCALE);
      }
    },
  });
}

function openPause() {
  if (inventoryOpen || scrapperOpen || treasureOpen) return;
  pauseOpen = true;
  HUD.setPauseMenu(true, { showHubReturn: Game.state === 'run' || Game.state === 'boss' });
}

function closePause() {
  pauseOpen = false;
  HUD.setPauseMenu(false);
}

// Re-opens the pause panel underneath — used by closeChronicle/closeCredits
// so "Закрыть" there reads as "back to the pause menu", not "unpause".
function reopenPauseMenu() {
  HUD.setPauseMenu(true, { showHubReturn: Game.state === 'run' || Game.state === 'boss' });
}

function openChronicle() {
  HUD.setPauseMenu(false);
  chronicleOpen = true;
  HUD.setChronicleScreen(true, Game.chronicleData());
}

function closeChronicle() {
  chronicleOpen = false;
  HUD.setChronicleScreen(false);
  reopenPauseMenu();
}

function openCredits() {
  HUD.setPauseMenu(false);
  creditsOpen = true;
  HUD.setCreditsScreen(true);
}

function closeCredits() {
  creditsOpen = false;
  HUD.setCreditsScreen(false);
  reopenPauseMenu();
}

function renderInventoryPanel() {
  const player = Game.player;
  HUD.setInventoryPanel(true, {
    equipment: player.equipment,
    weapon: player.weapon,
    bow: player.bow,
    accessorySlots: player.accessorySlots,
    items: player.unequippedItems(),
    isRare: (entry) => Game.isRareItem(entry),
    onEquip: (entry) => {
      if (entry.kind === 'weapon') player.manualEquipWeapon(entry.item);
      else player.manualEquipGear(entry.item);
      renderInventoryPanel();
    },
    onUnequipSlot: (slotKey) => {
      player.unequipToInventory(slotKey);
      renderInventoryPanel();
    },
  });
}

function toggleInventory() {
  if (scrapperOpen) return;
  inventoryOpen = !inventoryOpen;
  if (inventoryOpen) renderInventoryPanel();
  else HUD.setInventoryPanel(false);
}

function renderScrapperPanel() {
  const player = Game.player;
  const items = player.unequippedItems().map((entry) => ({ entry, value: Game.scrapValue(entry) }));
  HUD.setScrapperPanel(true, {
    items,
    onScrap: (entry) => {
      Game.scrapItem(entry);
      renderScrapperPanel();
    },
  });
}

function openScrapper() {
  if (inventoryOpen) return;
  scrapperOpen = true;
  HUD.setScrapperPrompt(false);
  renderScrapperPanel();
}

function closeScrapper() {
  scrapperOpen = false;
  HUD.setScrapperPanel(false);
}

// Berserker/Hunter: a flat multiplier that's the same for every target THIS
// hitbox can possibly hit (it depends only on the swing/shot itself — which
// weapon type, how many enemies are near the point of impact — never on a
// specific target), so it's computed once per hitbox rather than per target.
// `hitbox instanceof Arrow` is exactly what already distinguishes a bow shot
// from a melee swing everywhere else this hitbox shape is used — no new tag
// needed. Reads Game.enemies only, so it's a no-op during a boss fight
// (enemies=[] there) — Berserker's "surrounded" bonus is a trash-room read
// by construction, not something that also inflates boss damage.
function archetypeDamageMultiplier(hitbox) {
  const archetype = Game.player ? Game.player.archetype : null;
  if (archetype === 'berserker') {
    if (hitbox instanceof Arrow) return 1; // melee-only
    const cx = hitbox.x + hitbox.w / 2, cy = hitbox.y + hitbox.h / 2;
    let nearby = 0;
    for (const enemy of Game.enemies) {
      if (!enemy.alive) continue;
      const ex = enemy.x + enemy.w / 2, ey = enemy.y + enemy.h / 2;
      if (Math.hypot(ex - cx, ey - cy) <= BERSERKER_RADIUS) {
        nearby += 1;
        if (nearby >= BERSERKER_MIN_NEARBY) return 1 + BERSERKER_MELEE_BONUS;
      }
    }
    return 1;
  }
  if (archetype === 'hunter') {
    return hitbox instanceof Arrow ? 1 + HUNTER_BOW_BONUS : 1 - HUNTER_MELEE_PENALTY;
  }
  return 1;
}

// Executioner: the one archetype multiplier that genuinely depends on WHICH
// target got hit (its own hp/maxHp fraction at the moment of impact), so —
// unlike the one above — this has to be evaluated inside resolveAttack()'s
// per-target loop rather than folded into a single up-front `damage` value.
// Works identically against trash, an Elite champion, or a boss: all three
// expose the same hp/maxHp pair.
function executionerMultiplier(target) {
  if (!Game.player || Game.player.archetype !== 'executioner') return 1;
  const frac = target.hp / target.maxHp;
  if (frac <= EXECUTIONER_LOW_HP_FRACTION) return 1 + EXECUTIONER_LOW_HP_BONUS;
  if (frac >= EXECUTIONER_FULL_HP_FRACTION) return 1 - EXECUTIONER_FULL_HP_PENALTY;
  return 1;
}

// Returns whether anything actually got hit — melee's own caller ignores
// it, but the projectile loop below uses it to know an Arrow should
// disappear THIS frame rather than keep re-triggering every frame it still
// happens to overlap something (see the "hitbox" comment on Arrow.update).
function resolveAttack(hitbox, fromX = Game.player.x + Game.player.w / 2) {
  if (!hitbox) return false;
  // Two multipliers that aren't weapon stats, applied at the point of
  // impact rather than baked into the weapon: the permanent shard-bought
  // upgrade (meta progression) and the equipped gear's damageBonus. The
  // active heir's archetype (see heirs.js) is a third, same idea — none of
  // these are stored on the weapon itself, all three are read fresh here.
  const gearBonus = Game.player ? Game.player.equipMods.damageBonus : 0;
  const damage = hitbox.damage * Game.damageMultiplier() * (1 + gearBonus) * archetypeDamageMultiplier(hitbox);
  let hitSomething = false;
  for (const enemy of Game.enemies) {
    if (enemy.alive && aabbIntersect(hitbox, enemy)) {
      enemy.takeDamage(damage * executionerMultiplier(enemy), fromX);
      hitSomething = true;
    }
  }
  if (Game.boss && Game.boss.alive && aabbIntersect(hitbox, Game.boss)) {
    Game.boss.takeDamage(damage * executionerMultiplier(Game.boss));
    hitSomething = true;
  }
  return hitSomething;
}

function updateCamera(room, player) {
  Game.camera.x = clamp(player.x + player.w / 2 - CANVAS_W / 2, 0, Math.max(0, room.width - CANVAS_W));
}

function updateHub(dt) {
  const { room, player } = Game;
  player.update(dt, room, false);

  hubNearMerchant = entityDistance(player, HubProps.merchant) < HUB_INTERACT_RANGE;
  hubNearPortal = entityDistance(player, HubProps.portal) < HUB_INTERACT_RANGE;
  hubNearObelisk = entityDistance(player, HubProps.obelisk) < HUB_INTERACT_RANGE;
  hubNearScrapper = entityDistance(player, HubProps.scrapper) < HUB_INTERACT_RANGE;
  hubNearEchoTrader = entityDistance(player, HubProps.echoTrader) < HUB_INTERACT_RANGE;

  HUD.setHubHint(true);

  if (hubNearScrapper) {
    HUD.setScrapperPrompt(true, {
      left: HubProps.scrapper.x + HubProps.scrapper.w / 2,
      top: HubProps.scrapper.y - 14 * WORLD_SCALE,
    });
    if (Input.wasPressed('KeyE')) openScrapper();
  } else {
    HUD.setScrapperPrompt(false);
  }

  if (hubNearMerchant) {
    HUD.setMerchantPanel(true, {
      left: HubProps.merchant.x + HubProps.merchant.w / 2,
      top: HubProps.merchant.y - 20 * WORLD_SCALE,
      bandage: Game.bandageStatus(),
      arrows: Game.arrowBundleStatus(),
      offers: Game.merchantOfferStatuses(),
      reroll: { cost: MERCHANT_REROLL_COST, canAfford: Game.save.gold >= MERCHANT_REROLL_COST },
      onBuyOffer: (id) => Game.buyMerchantOffer(id),
    });
  } else {
    HUD.setMerchantPanel(false);
  }

  if (hubNearObelisk) {
    // "Постоянное" — everything that permanently strengthens the current
    // dynasty and used to be scattered across the merchant panel (hp/dmg/cd)
    // and the obelisk (prestige tree) separately. hpUpgradeStatus() etc
    // don't carry level/maxLevel themselves, so that part's read straight
    // off save/the *_MAX_LEVEL constants here.
    const hpStatus = Game.hpUpgradeStatus();
    const dmgStatus = Game.dmgUpgradeStatus();
    const cdStatus = Game.cdUpgradeStatus();
    const permanent = [
      {
        key: 'hp', title: 'Максимум HP', level: Game.save.hpLevel, maxLevel: HP_UPGRADE_MAX_LEVEL,
        desc: `Сейчас: ${hpStatus.maxHp} HP`, cost: hpStatus.cost, maxed: hpStatus.maxed, canAfford: hpStatus.canAfford,
        currency: 'золота', onBuy: () => Game.buyHpUpgrade(),
      },
      {
        key: 'dmg', title: 'Урон оружия', level: Game.save.dmgUpgradeLevel, maxLevel: DMG_UPGRADE_MAX_LEVEL,
        desc: `Сейчас: +${dmgStatus.bonusPct}%`, cost: dmgStatus.cost, maxed: dmgStatus.maxed, canAfford: dmgStatus.canAfford,
        currency: 'шардов', onBuy: () => Game.buyDmgUpgrade(),
      },
      {
        key: 'cd', title: 'Кулдауны', level: Game.save.cdUpgradeLevel, maxLevel: CD_UPGRADE_MAX_LEVEL,
        desc: `Сейчас: -${cdStatus.reductionPct}%`, cost: cdStatus.cost, maxed: cdStatus.maxed, canAfford: cdStatus.canAfford,
        currency: 'шардов', onBuy: () => Game.buyCdUpgrade(),
      },
    ];
    HUD.setObeliskPanel(true, {
      left: HubProps.obelisk.x + HubProps.obelisk.w / 2,
      top: HubProps.obelisk.y - 16 * WORLD_SCALE,
      permanent,
      prestige: Game.save.prestige,
      upgrades: Game.allPrestigeStatuses(),
      onBuy: (key) => Game.buyPrestigeUpgrade(key),
    });
  } else {
    HUD.setObeliskPanel(false);
  }

  if (hubNearEchoTrader) {
    HUD.setEchoPanel(true, {
      left: HubProps.echoTrader.x + HubProps.echoTrader.w / 2,
      top: HubProps.echoTrader.y - 14 * WORLD_SCALE,
      exchange: Game.echoExchangeStatus(),
      onBuy: () => Game.buyEchoExchange(),
    });
  } else {
    HUD.setEchoPanel(false);
  }

  if (hubNearPortal) {
    HUD.setPortalPrompt(true, {
      left: HubProps.portal.x + HubProps.portal.w / 2,
      top: HubProps.portal.y - 10 * WORLD_SCALE,
      label: Game.runInProgress ? 'E — вернуться в чащу' : 'E — путь в лес',
    });
    if (Input.wasPressed('KeyE')) {
      if (Game.runInProgress) Game.continueAfterMidBoss();
      else Game.startRun();
    }
  } else {
    HUD.setPortalPrompt(false);
  }
}

// Previous frame's HP, so a drop can be spotted without Player having to
// report damage upward (see the 'nohit' challenge in the run block below).
// Starts at 0 so the very first frame of a session can't read as a drop;
// across a room transition it carries the real value, and entering a room
// never changes HP, so the comparison stays honest there.
let hpLastFrame = 0;

function update(dt) {
  const { room, player } = Game;
  const canAttack = !(Game.boss && Game.boss.inSmoke);

  player.update(dt, room, canAttack);
  resolveAttack(player.pendingHitbox);
  if (player.pendingProjectile) {
    const p = player.pendingProjectile;
    Game.projectiles.push(new Arrow(p.x, p.y, p.facing, p.damage, p.range, p.color));
  }

  // Arrows update/resolve every frame regardless of run/boss state (a bow
  // works against both). An Arrow's own shape (x/y/w/h/damage) already
  // matches what resolveAttack() expects from a melee hitbox, so it's
  // passed straight through rather than needing its own resolution path —
  // the moment it actually connects, it's marked dead so it can never hit
  // twice while overlapping something on its way to disappearing anyway.
  //
  // Blairface's phase-2 reflection (see MirrorBoss.reflectsArrows()) branches
  // BEFORE that resolution: a 'player' arrow that hits her while she's
  // reflecting is handed to reflectArrow() instead of resolveAttack() — she
  // takes no damage and the arrow survives, just re-flagged 'enemy' and
  // re-aimed. An 'enemy' arrow never reaches resolveAttack() at all (that
  // would resolve against enemies/the boss, not the player); it's checked
  // against the player directly, right here, same takeDamage() call every
  // other hazard in the game already uses.
  for (const arrow of Game.projectiles) {
    if (!arrow.alive) continue;
    arrow.update(dt, room);
    if (!arrow.alive) continue;

    if (arrow.owner === 'enemy') {
      if (aabbIntersect(arrow, player)) {
        player.takeDamage(arrow.damage, arrow.x);
        arrow.alive = false;
      }
      continue;
    }

    if (Game.boss && Game.boss.alive && Game.boss.reflectsArrows() && aabbIntersect(arrow, Game.boss)) {
      Game.boss.reflectArrow(arrow, player);
      continue;
    }

    if (resolveAttack(arrow, arrow.x)) arrow.alive = false;
  }
  if (Game.projectiles.length > 0) Game.projectiles = Game.projectiles.filter((a) => a.alive);

  if (Game.state === 'run') {
    // The 'nohit' challenge's whole rule, in one line: any drop in HP this
    // room forfeits the bonus. Watched here rather than hooked into
    // Player.takeDamage so the player class stays unaware of room kinds.
    if (player.hp < hpLastFrame) Game.roomHitTaken = true;

    if (Game.roomBannerTimer > 0) Game.roomBannerTimer -= dt;

    for (const enemy of Game.enemies) {
      const wasAlive = enemy.alive;
      enemy.update(dt, room, player);
      if (wasAlive && !enemy.alive && !enemy.goldGranted) {
        enemy.goldGranted = true;
        Game.addGold(enemy.deathGold);
      }
    }

    nearestChest = null;
    let nearestDist = Infinity;
    for (const chest of Game.chests) {
      if (chest.opened) continue;
      const dist = entityDistance(player, chest);
      if (dist < CHEST_INTERACT_RANGE && dist < nearestDist) {
        nearestChest = chest;
        nearestDist = dist;
      }
    }
    if (nearestChest) {
      HUD.setChestPrompt(true, {
        left: nearestChest.x + nearestChest.w / 2 - Game.camera.x,
        top: nearestChest.y - 10 * WORLD_SCALE,
      });
      if (Input.wasPressed('KeyE')) {
        Game.openChest(nearestChest);
        if (Game.treasureChoiceOpen) openTreasurePanel();
        else if (Game.lastRoomReward) {
          Effects.burst(nearestChest.x + nearestChest.w / 2, nearestChest.y, '#b58ac9', 26, 10 * WORLD_SCALE);
        }
      }
    } else {
      HUD.setChestPrompt(false);
    }

    const allCleared = Game.enemies.every((e) => !e.alive);

    // A 'waves' challenge reuses the room's own spawn table for its next
    // wave rather than carrying a second one — clearing the floor summons
    // the next set instead of opening the door.
    if (allCleared && Game.pendingWaves > 0) {
      Game.pendingWaves -= 1;
      Game.waveIndex += 1;
      Game.enemies = spawnEnemiesForRoom(Game.roomIndex);
      Effects.burst(player.x + player.w / 2, player.y + player.h / 2, '#6fa3b8', 18, 8 * WORLD_SCALE);
    }

    // The door only counts a room as finished once no waves are pending, so
    // a half-fought challenge can't be walked out of.
    const roomFinished = allCleared && Game.pendingWaves === 0;
    if (roomFinished && !Game.roomRewardGranted) {
      const reward = Game.grantRoomClearReward();
      if (reward) {
        Game.lastRoomReward = reward;
        Effects.burst(player.x + player.w / 2, player.y + player.h / 2, '#d1b13c', 22, 9 * WORLD_SCALE);
      }
    }
    room.doorOpenAmount = clamp(room.doorOpenAmount + (roomFinished ? 1 : -1) * DOOR_OPEN_SPEED * dt, 0, 1);
    if (roomFinished && player.x + player.w >= room.exitX) {
      Game.advanceRoom();
    }
  } else if (Game.state === 'boss') {
    Game.boss.update(dt, room, player);
    HUD.updateBoss(Game.boss.hp, Game.boss.maxHp);
    // Refreshed every frame (not just at fight-entry) because MirrorBoss
    // renames herself to "Блэрифейс" mid-fight on the phase 1->2 transform.
    HUD.setBossVisible(true, Game.boss.name);
    HUD.setSmoke(Game.boss.inSmoke);
    if (!Game.boss.alive) {
      Game.onBossDefeated();
      return;
    }
  }

  if (player.hp <= 0) {
    Game.onPlayerDeath();
    return;
  }

  hpLastFrame = player.hp;
  updateCamera(room, player);
}

function drawRoom(room, camX, timestamp) {
  ctx.fillStyle = room.background;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Boss-arena identity (tower silhouette, torches, Sakarver's bleeding
  // walls / Lisden's ghost double) — a no-op for every non-boss room, see
  // arenas.js. Behind the platform tiles on purpose, so it reads as distant
  // scenery rather than sitting on top of the playable space.
  drawArenaBackdrop(ctx, room, camX, timestamp, Game.boss);

  // Every Bishop fight (all 5 — Keons included, see MID_CHAIN_BOSS_ORDER)
  // gets the new tileset. The Mirror/Blairface finale is
  // deliberately excluded — createMirrorRoom()'s own comment calls it "a
  // flat, open stage befitting a duel with no distractions", and she isn't
  // in BISHOP_REGISTRY to begin with (see MirrorBoss's constructor comment)
  // — reskinning that stage wasn't part of this request and would cut
  // against its own stated design intent.
  if (Game.boss && Game.boss.bishopKey !== 'mirror') {
    // District-Bishop arena: grungy_wall_tileset.png walls + its animated
    // torch (see biomes.js) instead of the plain stone tiles.
    for (const p of room.platforms) drawBossWallTiledRect(ctx, p.x, p.y, p.w, p.h, camX);
    drawBossArenaTorches(ctx, room, camX, timestamp);
  } else if (room.biome) {
    // Regular chain room — Trench (forest) or Dema (urban decay), picked
    // per-room by generateRoomChain() in game.js. Backdrop first (behind
    // the platforms), then the tiles themselves, then sparse decoration on
    // top of the ground.
    drawBiomeBackdrop(ctx, room, camX, timestamp);
    // room.platforms[0] is always the full-width ground, by the same
    // convention drawRoomDebris()/drawTrenchDecor() already rely on —
    // everything else in the array is a floating ledge (see TRENCH_EDGE).
    room.platforms.forEach((p, i) => drawBiomeTiledRect(ctx, room.biome, p.x, p.y, p.w, p.h, camX, i !== 0));
    drawBiomeDecor(ctx, room, camX, timestamp);
  } else {
    // Hub / mirror finale / anything else with no biome tag — unchanged
    // original stone tiling.
    for (const p of room.platforms) drawTiledRect(ctx, p.x, p.y, p.w, p.h, camX);
    drawRoomDebris(ctx, room, camX);
  }

  // A real door instead of a flat colored line — locked while enemies
  // remain, sliding open once the room's cleared (see world.js's
  // drawExitDoor()/Room.doorOpenAmount, driven by update() below).
  drawExitDoor(ctx, room, camX, timestamp);
}

// Smoke fear-mechanic: darken the whole arena, then punch a small visibility
// hole around the player with a radial gradient so dodging still feels
// readable while attacking is blocked (see canAttack in update()).
function drawSmoke(player, camX) {
  ctx.save();
  ctx.fillStyle = 'rgba(60, 66, 58, 0.92)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const px = player.x + player.w / 2 - camX;
  const py = player.y + player.h / 2;
  const visRadius = 140 * WORLD_SCALE;
  const gradient = ctx.createRadialGradient(px, py, 20 * WORLD_SCALE, px, py, visRadius);
  gradient.addColorStop(0, 'rgba(0,0,0,1)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(px, py, visRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Title screen: no room/player exists yet (Game.enterHub() hasn't run —
// see main.js's boot sequence), so this just paints a static Trench scene
// behind the DOM title screen's own semi-transparent vignette (see
// .title-screen in style.css) instead of the usual drawRoom() pipeline. A
// slow camX drift (not 0) is the "тихая фоновая атмосфера" the request
// asked for — enough to feel alive without drawing attention to itself.
function renderTitle(timestamp) {
  ctx.fillStyle = '#22271f';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  drawTrenchBackdrop(ctx, timestamp * 0.01);
}

function renderHub(timestamp) {
  const { player } = Game;
  drawHubScene(ctx, timestamp, hubNearMerchant, hubNearPortal, hubNearObelisk, hubNearScrapper, hubNearEchoTrader);
  player.draw(ctx, 0);

  HUD.update({
    hp: player.hp,
    maxHp: player.maxHp,
    gold: Game.save.gold,
    shards: Game.save.shards,
    prestige: Game.save.prestige,
    arrows: player.arrows,
    weaponName: player.weapon.name,
    bowName: player.bow.name,
    heirName: Game.activeHeir.name,
    equipment: player.equipment,
  });
}

function render(timestamp) {
  const { room, player } = Game;
  const camX = Game.camera.x;

  // Screen shake: a small decaying pixel offset around every world-content
  // draw call (room/entities/particles), applied and undone here so it
  // never touches the vignette/HUD below — those stay screen-locked. See
  // effects.js's Effects.hit()/shakeOffset().
  const shake = Effects.shakeOffset();
  ctx.save();
  ctx.translate(shake.x, shake.y);

  drawRoom(room, camX, timestamp);

  for (const chest of Game.chests) chest.draw(ctx, camX, chest === nearestChest, timestamp);
  for (const enemy of Game.enemies) enemy.draw(ctx, camX);
  if (Game.boss) Game.boss.draw(ctx, camX);
  for (const arrow of Game.projectiles) arrow.draw(ctx, camX);
  player.draw(ctx, camX);
  Effects.draw(ctx, camX);

  // Keons' permanent low fog band — foreground, drawn after the player so it
  // reads as ground haze in front rather than scenery behind. A no-op for
  // every other bishop (see arenas.js). Separate from the fear-mechanic
  // full-arena smoke below, which only exists during his smoke phase.
  drawArenaFog(ctx, room, camX, timestamp, Game.boss);

  if (Game.boss && Game.boss.inSmoke) drawSmoke(player, camX);

  ctx.restore();

  // Screen-space post-process, drawn last so it frames everything above —
  // a no-op outside a district-Bishop fight (see arenas.js). Outside the
  // shake transform on purpose: the vignette is a fixed screen overlay, not
  // world content, and shaking it too would look like the UI itself glitching.
  drawArenaVignette(ctx, Game.boss);
  drawRoomBanner(timestamp);

  HUD.update({
    hp: player.hp,
    maxHp: player.maxHp,
    gold: Game.save.gold,
    shards: Game.save.shards,
    prestige: Game.save.prestige,
    arrows: player.arrows,
    weaponName: player.weapon.name,
    bowName: player.bow.name,
    heirName: Game.activeHeir.name,
    equipment: player.equipment,
  });
}

// A special room announces itself on arrival and then gets out of the way:
// a symbol, its name, and the rule in one line, fading out over the last
// second. Challenge rooms additionally keep a small live status pinned under
// it for as long as the room lasts, because their rule is something the
// player has to keep track of, not just read once.
function drawRoomBanner(timestamp) {
  if (Game.state !== 'run') return;
  const entry = Game.roomChain[Game.roomIndex];
  if (!entry) return;

  // While a room's own panel is up, the panel IS the announcement — drawing
  // the banner behind it stacks two copies of the same title. The timer is
  // frozen along with the rest of the run meanwhile, so the banner still gets
  // its full moment once the player has answered.
  const panelUp = Game.bloodOfferOpen || treasureOpen;
  const banner = Game.roomBanner;
  if (banner && Game.roomBannerTimer > 0 && !panelUp) {
    const t = Game.roomBannerTimer / ROOM_BANNER_DURATION;
    const alpha = clamp(t * 3, 0, 1); // hold, then fade over the last third
    const cx = CANVAS_W / 2;
    const y = CANVAS_H * 0.2;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';

    ctx.fillStyle = banner.color;
    ctx.font = `${34 * WORLD_SCALE}px 'Courier New', monospace`;
    ctx.fillText(banner.symbol, cx, y - 34 * WORLD_SCALE);

    ctx.font = `${26 * WORLD_SCALE}px 'Courier New', monospace`;
    ctx.fillText(banner.label, cx, y);

    if (banner.sub) {
      ctx.fillStyle = '#c7ccd6';
      ctx.font = `${13 * WORLD_SCALE}px 'Courier New', monospace`;
      ctx.fillText(banner.sub, cx, y + 22 * WORLD_SCALE);
    }
    ctx.restore();
  }

  if (entry.kind !== 'challenge') return;
  const variant = CHALLENGE_VARIANTS[entry.challenge];
  const intact = Game.challengeHonoured(entry);
  const text = entry.challenge === 'waves'
    ? `${variant.status} ${Game.waveIndex}/${CHALLENGE_WAVE_COUNT}`
    : `${variant.status}: ${intact ? 'ЦЕЛО' : 'ПРОВАЛЕНО'}`;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = `${14 * WORLD_SCALE}px 'Courier New', monospace`;
  ctx.fillStyle = intact ? '#6fa3b8' : '#7a2d2d';
  ctx.fillText(text, CANVAS_W / 2, CANVAS_H * 0.08);
  ctx.restore();
}

let lastTime = 0;
function loop(timestamp) {
  const rawDt = Math.min(0.05, (timestamp - lastTime) / 1000);
  lastTime = timestamp;

  // Effects (particles/shake decay) always run on the RAW, unfrozen delta —
  // see effects.js's own comment on why: if hit-stop itself paused this
  // update, hitStopTimer could never count back down and the freeze would
  // never end. Gameplay's own dt is what actually gets zeroed below.
  Effects.update(rawDt);
  const dt = Effects.hitStopTimer > 0 ? 0 : rawDt;

  // Inventory: I or Tab opens/closes from hub, run, or mid-boss. Scrapper:
  // hub-only, opened via its own E prompt (see updateHub). Only one modal
  // at a time — see toggleInventory()/openScrapper()'s mutual guards, and
  // pauseOpen blocks both from opening while the pause menu is up.
  // The blood offer is driven off Game state rather than a local flag,
  // because beginRoomKind() is what raises it — the panel just mirrors it.
  // Handled here, above the `paused` gate, since the offer itself is what's
  // pausing the run.
  HUD.setBloodOffer(Game.bloodOfferOpen, Game.bloodOfferOpen ? { cost: bloodCovenantCost(Game.player) } : undefined);
  if (Game.bloodOfferOpen) {
    if (Input.wasPressed('KeyE')) Game.acceptBloodCovenant();
    else if (Input.wasPressed('KeyQ')) Game.declineBloodCovenant();
  }

  const canToggleInventory = Game.state === 'hub' || Game.state === 'run' || Game.state === 'boss';
  if (canToggleInventory && !scrapperOpen && !pauseOpen && !treasureOpen && !Game.bloodOfferOpen
      && Input.wasPressedAny(['KeyI', 'Tab'])) {
    toggleInventory();
  }
  // KeyI/Tab deliberately excluded here: closing on I/Tab would read the
  // same justPressed flag the check above uses to OPEN inventory, and the
  // two would cancel out in the same frame. I/Tab only open; Escape and
  // the panel's own button close (via the unified Escape chain below,
  // NOT a second independent check — a second check here could fire in
  // the same frame this one already closed scrapperOpen, since closing it
  // doesn't consume the Escape justPressed flag until Input.clearFrame()).
  if (scrapperOpen && Input.wasPressedAny(['KeyI', 'Tab'])) {
    closeScrapper();
  }

  // Escape: exactly one thing happens per press, picked by what's
  // currently open, innermost-first — chronicle/credits (nested inside the
  // pause menu) close back to the pause menu; the pause menu itself closes
  // to gameplay; and with nothing else open, Escape from hub/run/boss OPENS
  // the pause menu. A single if/else-if chain (not independent checks per
  // modal) so exactly one of these fires, never two in the same frame.
  if (Input.wasPressed('Escape')) {
    if (chronicleOpen) closeChronicle();
    else if (creditsOpen) closeCredits();
    else if (inventoryOpen) toggleInventory();
    else if (scrapperOpen) closeScrapper();
    else if (pauseOpen) closePause();
    else if (Game.state === 'hub' || Game.state === 'run' || Game.state === 'boss') openPause();
  }

  // The blood offer freezes the run too: it's a decision about a room you
  // haven't entered the fight of yet, so letting enemies close in while the
  // panel is up would turn a choice into a penalty for reading it.
  const paused = inventoryOpen || scrapperOpen || pauseOpen || treasureOpen || Game.bloodOfferOpen;

  if (Game.state === 'title') {
    renderTitle(timestamp);
  } else if (Game.state === 'hub') {
    if (!paused) updateHub(dt);
    if (Game.state === 'hub') renderHub(timestamp);
  } else if (Game.state === 'run' || Game.state === 'boss') {
    if (!paused) update(dt);
    if (Game.state === 'run' || Game.state === 'boss') render(timestamp);
  }

  Input.clearFrame();
  requestAnimationFrame(loop);
}

document.getElementById('btn-cycle-continue').addEventListener('click', () => Game.showCycleHeirChoice());
document.getElementById('btn-buy-bandage').addEventListener('click', () => Game.buyBandage());
document.getElementById('btn-buy-arrows').addEventListener('click', () => Game.buyArrows());
document.getElementById('btn-blood-accept').addEventListener('click', () => Game.acceptBloodCovenant());
document.getElementById('btn-blood-decline').addEventListener('click', () => Game.declineBloodCovenant());
document.getElementById('btn-merchant-reroll').addEventListener('click', () => Game.rerollMerchantOffers());
document.getElementById('btn-inventory-close').addEventListener('click', () => toggleInventory());
document.getElementById('btn-scrapper-close').addEventListener('click', () => closeScrapper());

// --- Title screen ---------------------------------------------------------

document.getElementById('btn-title-continue').addEventListener('click', () => Game.continueGame());
document.getElementById('btn-title-newgame').addEventListener('click', () => {
  // Only worth confirming if there's actually something to lose — a save
  // that was never written yet (very first launch) doesn't need one.
  if (Game.hasSaveProgress() && !window.confirm(
    'Начать новую игру? Весь текущий прогресс (золото, шарды, эхо, вся история рода) будет стёрт безвозвратно.'
  )) return;
  Game.startNewGame();
});

// --- Тест-меню (см. index.html's debug-overlay, Game.debugFightBoss/
// debugTestRoom в game.js). Кнопки статичные — читаем их data-атрибуты
// вместо построения списка в HUD, поскольку набор боссов/комнат не меняется
// во время игры.
document.getElementById('btn-title-debug').addEventListener('click', () => {
  document.getElementById('debug-overlay').classList.remove('hidden');
});
document.getElementById('btn-debug-close').addEventListener('click', () => {
  document.getElementById('debug-overlay').classList.add('hidden');
});
for (const btn of document.querySelectorAll('.debug-btn')) {
  btn.addEventListener('click', () => {
    document.getElementById('debug-overlay').classList.add('hidden');
    if (btn.dataset.debugBoss) {
      Game.debugFightBoss(btn.dataset.debugBoss);
    } else if (btn.dataset.debugRoom) {
      Game.debugTestRoom(btn.dataset.debugRoom, btn.dataset.debugChallenge || null);
    }
  });
}

// --- Pause menu -------------------------------------------------------------

document.getElementById('btn-pause-continue').addEventListener('click', () => closePause());
document.getElementById('btn-pause-hub').addEventListener('click', () => {
  // Deliberately NOT Game.onPlayerDeath() — giving up via the pause menu is
  // treated the same as the already-documented "closed the tab mid-run"
  // case in game.js's top-of-file comment: no heir change, no gold-to-shard
  // conversion. Only the in-progress run itself (whatever gear/weapons were
  // found this attempt) is lost, same as it would be on any other hub visit.
  if (!window.confirm(
    'Вернуться в хаб? Прогресс этого забега (найденное оружие и снаряжение) будет потерян, но золото, шарды и текущий наследник останутся при вас — это НЕ считается смертью.'
  )) return;
  closePause();
  Game.enterHub();
});
document.getElementById('btn-pause-settings').addEventListener('click', () => HUD.togglePauseSettings());
document.getElementById('btn-pause-chronicle').addEventListener('click', () => openChronicle());
document.getElementById('btn-pause-credits').addEventListener('click', () => openCredits());
document.getElementById('btn-pause-title').addEventListener('click', () => {
  if (!window.confirm(
    'Выйти на титульный экран? Текущий забег (если он идёт) будет прерван так же, как при возврате в хаб — без потери наследника.'
  )) return;
  closePause();
  Game.enterTitle();
  HUD.setTitleScreen(buildTitleScreenOpts());
});

document.getElementById('btn-chronicle-close').addEventListener('click', () => closeChronicle());
document.getElementById('btn-credits-close').addEventListener('click', () => closeCredits());

// Gate the whole startup (including the very first render) behind the tile
// preload so there's no flash of the flat-color fallback fill on frame one
// — see tiles.js. Boots into the title screen now instead of straight into
// the hub — see Game.enterTitle()'s own comment.
preloadTiles(() => {
  Game.enterTitle();
  HUD.setTitleScreen(buildTitleScreenOpts());
  requestAnimationFrame((t) => { lastTime = t; requestAnimationFrame(loop); });
});
