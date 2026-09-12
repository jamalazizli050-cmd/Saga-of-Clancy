// Sprint 1 death-animation pass (HANDOFF item 6). The animation itself is
// cosmetic; what these tests actually guard is the line between the VISUAL
// death and the LOGICAL one, which is the thing HANDOFF explicitly warns must
// not blur:
//
//   alive = false  -> immediate, on the frame HP runs out. Stops the AI,
//                     counts toward room clear, pays the reward, and makes
//                     the entity untargetable.
//   dying = true   -> visual only, outlives `alive` by a fixed duration.
//
// Every check below is some form of "the second one did not leak into the
// first". Enemies are never spliced out of Game.enemies mid-room, so a
// corpse still animating can't leak or be double-counted either.
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

// --- GloriousGone: used to vanish instantly, now collapses ---------------
run('Game.enterHub(); Game.startRun();');
run(`
  __g = new GloriousGone(100, ROOM_GROUND_SPAWN_Y, 50, 300, 1);
  __g.takeDamage(9999, null);
`);
check('смерть немедленно ставит alive = false (логика не ждёт анимацию)', run('__g.alive') === false);
check('при этом тело ещё на экране: dying = true', run('__g.dying') === true);
check('прогресс анимации стартует с нуля', run('__g.deathHold') === 0);

// The AI is off: a corpse must not move, patrol, or deal contact damage.
run(`
  __g.vx = 999; __g.contactCooldown = 0;
  __xBefore = __g.x;
  __player = Game.player;
  __hpBefore = __player.hp;
  // Put the player exactly on top of the corpse — contact damage would fire
  // here if the dead body were still running its update logic.
  __player.x = __g.x; __player.y = __g.y; __player.invulnTimer = 0;
  __g.update(0.1, Game.room, __player);
`);
check('труп не двигается (физика/ИИ выключены)', run('__g.x === __xBefore'));
check('труп не наносит контактный урон', run('Game.player.hp === __hpBefore'),
  { before: run('__hpBefore'), after: run('Game.player.hp') });
check('но анимация смерти тикает', run('__g.deathHold') > 0);

// The killing blow's hit-flash has to keep decaying after death. It's set in
// takeDamage() but was only ever decayed in the alive-only half of update(),
// so once bodies started lingering the corpse stayed lit up red for the whole
// collapse — found by instrumenting the real draw calls in the browser.
run(`
  __f = new GloriousGone(100, ROOM_GROUND_SPAWN_Y, 50, 300, 1);
  __f.takeDamage(9999, null);
  __flashAtDeath = __f.hitFlash;
  __f.update(0.1, Game.room, Game.player);
`);
check('вспышка от смертельного удара гаснет и после смерти (труп не остаётся красным)',
  run('__f.hitFlash') < run('__flashAtDeath'),
  { atDeath: run('__flashAtDeath'), after: run('__f.hitFlash') });

// Already dead: further hits do nothing at all (no re-kill, no re-trigger).
run('__holdBefore = __g.deathHold; __g.takeDamage(50, null);');
check('повторный удар по трупу игнорируется (takeDamage выходит сразу)',
  run('__g.deathHold === __holdBefore && __g.hp <= 0'));

// The animation ends on its own and never runs backwards or forever.
run('__g.update(GRUNT_DEATH_DURATION + 0.01, Game.room, Game.player);');
check('по истечении длительности dying выключается сам', run('__g.dying') === false);
check('alive при этом так и остаётся false', run('__g.alive') === false);

// --- Room clear does NOT wait for the animation -------------------------
//
// This is the invariant most at risk: if the clear check ever started
// consulting `dying`, a room would stay locked for the length of every
// corpse's animation.
run(`
  Game.enterHub(); Game.startRun();
  for (const e of Game.enemies) e.takeDamage(99999, null);
  __allDead = Game.enemies.every((e) => !e.alive);
  __someStillAnimating = Game.enemies.some((e) => e.dying);
`);
check('комната считается зачищенной сразу, ещё до конца анимаций',
  run('__allDead') === true && run('__someStillAnimating') === true,
  { allDead: run('__allDead'), animating: run('__someStillAnimating') });

// --- Gold is paid once, and the animation doesn't re-trigger it ----------
//
// main.js pays on `!alive && !goldGranted` (see the fix earlier this sprint).
// A corpse ticking its animation for many frames must not pay again.
run(`
  __e = Game.enemies[0];
  __paid = 0;
  // The exact payout rule from main.js's enemy loop, run repeatedly across
  // the whole death animation.
  function payOnce(en) {
    if (!en.alive && !en.goldGranted) { en.goldGranted = true; __paid += 1; }
  }
  for (let i = 0; i < 30; i++) { __e.update(0.05, Game.room, Game.player); payOnce(__e); }
`);
check('золото за смерть начисляется ровно один раз за всю анимацию', run('__paid') === 1, run('__paid'));

// --- Bosses: same split, plus the victory hold --------------------------
run(`
  Game.enterHub();
  Game.debugFightBoss('vetomo');
  __boss = Game.boss;
  __boss.takeDamage(999999);
`);
check('босс: alive = false сразу', run('__boss.alive') === false);
check('босс: dying = true (тело ещё падает)', run('__boss.dying') === true);
check('deathProgress() стартует около нуля', run('__boss.deathProgress()') < 0.01);

run('__boss.takeDamage(999999);');
check('епископа нельзя убить дважды — повторный урон не сбрасывает анимацию',
  run('__boss.deathHold') === 0 && run('__boss.alive') === false);

run('__bossFlashAtDeath = __boss.hitFlash; __boss.update(0.05, Game.room, Game.player);');
check('вспышка у босса тоже гаснет во время падения',
  run('__boss.hitFlash') < run('__bossFlashAtDeath'),
  { atDeath: run('__bossFlashAtDeath'), after: run('__boss.hitFlash') });

run('__boss.update(BOSS_DEATH_DURATION * 0.5, Game.room, Game.player);');
check('анимация смерти босса тикает через update()', run('__boss.deathProgress()') > 0.4);
run('__boss.update(BOSS_DEATH_DURATION, Game.room, Game.player);');
check('и завершается сама', run('__boss.dying') === false);
check('deathProgress() возвращается к 0 после завершения', run('__boss.deathProgress()') === 0);
check('босс остаётся мёртвым', run('__boss.alive') === false);

// --- Blairface: phase 1 must NOT play a death animation -----------------
//
// Her phase-1 depletion is a transform, not a death. If onDepleted() ever
// fell through to the base implementation there, she'd collapse mid-fight.
run(`
  Game.enterHub();
  Game.debugFightBoss('mirror');
  __mirror = Game.boss;
  __mirror.takeDamage(999999); // empties phase 1
`);
check('Блэрифейс: опустошение 1-й фазы НЕ убивает и НЕ запускает анимацию смерти',
  run('__mirror.alive') === true && run('__mirror.dying') === false && run('__mirror.transforming') === true,
  { alive: run('__mirror.alive'), dying: run('__mirror.dying'), transforming: run('__mirror.transforming') });

run(`
  __mirror.completeTransformation();
  __mirror.takeDamage(999999); // now phase 2 — this one is a real death
`);
check('Блэрифейс: 2-я фаза умирает по-настоящему и с анимацией',
  run('__mirror.alive') === false && run('__mirror.dying') === true,
  { alive: run('__mirror.alive'), dying: run('__mirror.dying') });

// --- Lisden: the decoys die with her ------------------------------------
run(`
  Game.enterHub();
  Game.debugFightBoss('lisden');
  __lis = Game.boss;
  __lis.reclone();
  __decoysBefore = __lis.decoys.length;
  __lis.takeDamage(999999);
`);
check('у Лисден до смерти есть клоны', run('__decoysBefore') > 0, run('__decoysBefore'));
check('смерть Лисден очищает клонов (иллюзия рушится вместе с ней)',
  run('__lis.decoys.length') === 0, run('__lis.decoys.length'));

// --- The animator's living path is untouched ----------------------------
//
// dying defaults to 0, so every entity that isn't dying must go through the
// exact transform it always did — the death branch must not have changed the
// look of anything alive.
run(`
  __calls = [];
  __fakeCtx = {
    save() { __calls.push('save'); }, restore() { __calls.push('restore'); },
    translate(x, y) { __calls.push(['translate', Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]); },
    rotate(r) { __calls.push(['rotate', r]); },
    scale(x, y) { __calls.push(['scale', x, y]); },
    globalAlpha: 1,
  };
  __anim = new SpriteAnimator();
  __anim.draw(__fakeCtx, 0, 0, 40, 60, { moving: false, grounded: true, facing: 1 }, () => {});
  __aliveCalls = JSON.stringify(__calls);
  __zeroTranslates = __calls.filter((c) => Array.isArray(c) && c[0] === 'translate' && c[1] === 0 && c[2] === 0).length;
`);
check('живой путь: поворот вокруг центра сохранён (сдвиг пивота нулевой)',
  run('__zeroTranslates') >= 2, { calls: run('__aliveCalls') });
check('живой путь не трогает globalAlpha', run('__fakeCtx.globalAlpha') === 1);

run(`
  __calls = [];
  __fakeCtx.globalAlpha = 1;
  __anim.draw(__fakeCtx, 0, 0, 40, 60, { facing: 1, dying: 0.9 }, () => {});
  __dyingRot = __calls.find((c) => Array.isArray(c) && c[0] === 'rotate')[1];
`);
check('умирающий путь реально поворачивает тело', run('Math.abs(__dyingRot)') > 0.5, run('__dyingRot'));
check('умирающий путь гасит прозрачность к концу анимации',
  run('__fakeCtx.globalAlpha') < 1, run('__fakeCtx.globalAlpha'));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
