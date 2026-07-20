// test.js — imports the REAL pantheon.js (never a private copy) and enforces the
// honesty rules inherited from lotka-volterra:
//   1. every grade is a pure, finite function of the stat log
//   2. every advertised boon/curse key is actually consumed by game.js (no no-ops)
//   3. grades are monotonic where the fiction promises it
// Run: node test.js
const fs = require('fs');
const path = require('path');
const P = require('./pantheon.js');

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL: ' + name); }
}

const base = {
  time: 40, roomCount: 5, kills: 6, interrupts: 1, dmgTaken: 1,
  dashThroughs: 2, pickups: 1, treasureFound: 1, idleT: 2, depth: 2,
  rangedKills: 1, chestsOpened: 0, hotdogsEaten: 0, chaliceDelivered: 0, itemsStolen: 0,
  tuftsCut: 2, spent: 0, heartPieces: 0,
};
const perfect = { ...base, time: 20, idleT: 0, kills: 14, interrupts: 4, dmgTaken: 0, dashThroughs: 5, pickups: 3, treasureFound: 1, depth: 6, rangedKills: 0, chestsOpened: 1, chaliceDelivered: 0 };
const awful = { ...base, time: 300, idleT: 60, kills: 0, interrupts: 0, dmgTaken: 6, dashThroughs: 0, pickups: 0, treasureFound: 0, depth: 1, rangedKills: 0, chestsOpened: 0 };

const favor = P.defaultFavor();

for (const stats of [base, perfect, awful]) {
  const cards = P.judge(stats, favor);
  t('judge returns 5 cards', cards.length === 5);
  for (const c of cards) {
    t(`${c.id} score finite`, Number.isFinite(c.score));
    t(`${c.id} score in [0,1]`, c.score >= 0 && c.score <= 1);
    t(`${c.id} letter valid`, ['S', 'A', 'B', 'C', 'F'].includes(c.letter));
    t(`${c.id} delta matches letter`, c.delta === P.DELTA[c.letter]);
    t(`${c.id} favorAfter in [0,100]`, c.favorAfter >= 0 && c.favorAfter <= 100);
    t(`${c.id} stat line has a number`, /\d/.test(c.stat));
    t(`${c.id} has an in-character line`, typeof c.line === 'string' && c.line.length > 4);
  }
  t('verdict is a string', typeof P.verdict(cards) === 'string' && P.verdict(cards).length > 2);
}

// monotonicity: the perfect floor never grades below the awful floor on any god
{
  const cp = P.judge(perfect, favor), ca = P.judge(awful, favor);
  for (let i = 0; i < 5; i++) {
    t(`${cp[i].id} perfect >= awful`, cp[i].score >= ca[i].score);
  }
  t('perfect floor pleases the pantheon', cp.every(c => 'SAB'.includes(c.letter)));
  t('awful floor angers the pantheon', ca.filter(c => 'CF'.includes(c.letter)).length >= 3);
}

// favor application + thresholds
{
  const cards = P.judge(perfect, favor);
  const f2 = P.applyFavor(favor, cards);
  for (const c of cards) t(`${c.id} favor moved by delta`, f2[c.id] === Math.max(0, Math.min(100, favor[c.id] + c.delta)));
  t('boon threshold honest', P.boonActive({ velox: P.BOON_AT }, 'velox') && !P.boonActive({ velox: P.BOON_AT - 1 }, 'velox'));
  t('curse threshold honest', P.curseActive({ velox: P.CURSE_AT }, 'velox') && !P.curseActive({ velox: P.CURSE_AT + 1 }, 'velox'));
}

// no-op guard: every advertised boon/curse key must appear in game.js at least twice
// (once defined in FX with its magnitude, once applied at a gameplay site)
{
  const src = fs.readFileSync(path.join(__dirname, 'game.js'), 'utf8');
  for (const g of P.GODS) {
    for (const key of [g.boon.key, g.curse.key]) {
      const uses = src.split(key).length - 1;
      t(`${key} consumed by game.js (${uses} refs)`, uses >= 2);
    }
  }
}

// PLUMA: the gun is not the beak — same kills, more ranged => strictly less honor
{
  const melee6 = { ...base, kills: 6, rangedKills: 0 };
  const gun6 = { ...base, kills: 6, rangedKills: 6 };
  const sm = P.judge(melee6, favor).find(c => c.id === 'pluma').score;
  const sg = P.judge(gun6, favor).find(c => c.id === 'pluma').score;
  t('pluma dishonors gun kills', sg < sm);
}

// AURUM: opening the chest raises the grade
{
  const noChest = { ...base, chestsOpened: 0 };
  const chest = { ...base, chestsOpened: 1 };
  const a0 = P.judge(noChest, favor).find(c => c.id === 'aurum').score;
  const a1 = P.judge(chest, favor).find(c => c.id === 'aurum').score;
  t('aurum covets the chest', a1 > a0);
}

// AURUM: circulation — spending score at the toll raises the grade
{
  const frugal = { ...base, spent: 0, pickups: 0, tuftsCut: 0 };
  const spender = { ...frugal, spent: 200 };
  const a0 = P.judge(frugal, favor).find(c => c.id === 'aurum').score;
  const a1 = P.judge(spender, favor).find(c => c.id === 'aurum').score;
  t('aurum loves circulation', a1 > a0);
  const mower = { ...frugal, tuftsCut: 10 };
  t('aurum counts the grass', P.judge(mower, favor).find(c => c.id === 'aurum').score > a0);
}

// special verdicts derive from the stat log
{
  const cards = P.judge(base, favor);
  t('chalice verdict', P.verdict(cards, { ...base, chaliceDelivered: 1 }) === 'CHALICE BEARER');
  t('hotdog verdict', P.verdict(cards, { ...base, hotdogsEaten: 2 }) === 'HOTDOG PILGRIM');
  t('verdict without stats still works', typeof P.verdict(cards) === 'string');
}

// no-op guard for room heuristics: every MUT key must be consumed by game.js
// (once defining the room's rule, at least once applying it to real gameplay)
{
  const src = fs.readFileSync(path.join(__dirname, 'game.js'), 'utf8');
  for (const key of ['LOWGRAV', 'SIDEGRAV', 'DARK', 'FLICKER', 'HASTE', 'MOLASSES', 'SWARM', 'RUBBER',
    'IRONFRONT', 'WOODS', 'ORDER', 'PHASE', 'HUNGRY', 'FOUNTAIN', 'TOLL']) {
    const uses = src.split(`'${key}'`).length - 1 + src.split(`${key}:`).length - 1;
    t(`MUT ${key} consumed by game.js (${uses} refs)`, uses >= 2);
  }
  // challenge objects all reachable in code
  for (const kind of ['gun', 'star', 'hotdog', 'lantern', 'key', 'chalice', 'bomb',
    'hammer', 'whip', 'rapier', 'boomerang', 'flail', 'sporebow']) {
    const uses = src.split(`'${kind}'`).length - 1;
    t(`item ${kind} wired into game.js (${uses} refs)`, uses >= 2);
  }
  // 13 room architectures, each with a real builder or the organic fallback
  const archs = ['CAVE', 'TEMPLE', 'CRYPT', 'CATHEDRAL', 'HALL', 'GARDEN', 'ROTUNDA',
    'GROTTO', 'LABYRINTH', 'AQUEDUCT', 'BONEYARD', 'OBSERVATORY', 'THORNWOOD'];
  t(`thirteen room architectures defined`, archs.every(a => src.includes(a + ':')));
  for (const a of archs) {
    const uses = src.split(a).length - 1;
    t(`arch ${a} consumed by game.js (${uses} refs)`, uses >= 2);
  }
  // six signature weapons declared as a set
  t(`six signature weapons`, /WEAPONS = \['hammer', 'whip', 'rapier', 'boomerang', 'flail', 'sporebow'\]/.test(src));

  // the arcade roster: every ENEMIES key must map to a real archetype the AI consumes
  const enemyKeys = ['grunt', 'ghost', 'hopper', 'strafer', 'rider', 'splitter', 'inflater',
    'diver', 'marcher', 'spinner', 'lobber', 'waller', 'bubbler', 'otto', 'burner', 'slinky',
    'octorok', 'moblin', 'tektite', 'gibdo', 'rope', 'leever', 'darknut', 'peahat'];
  const archMatch = src.match(/function arcadeAI[\s\S]*?\n\}/);
  const archBody = archMatch ? archMatch[0] : '';
  const usedArchs = new Set((src.match(/arch: '(\w+)'/g) || []).map(s => s.replace(/arch: '|'/g, '')));
  for (const k of enemyKeys) {
    const declared = new RegExp(`${k}: \\{ arch:`).test(src);
    t(`enemy ${k} declared with an archetype`, declared);
  }
  // every archetype used in ENEMIES must have a case in arcadeAI (no dead archetype)
  for (const a of usedArchs) {
    if (['chase', 'ghost', 'hop', 'strafe', 'joust', 'split', 'dive', 'march', 'spin', 'lob', 'wall', 'shoot', 'bounce', 'burn', 'slink', 'burrow', 'peahat'].includes(a)) {
      t(`archetype ${a} handled in arcadeAI`, archBody.includes(`case '${a}'`) || (a === 'slink' && /slinkAI/.test(src)));
    }
  }
  t(`24 arcade+zelda enemies + prime slinky`, enemyKeys.length === 24 && /PRIMES = \[2, 3, 5, 7/.test(src));
  // Zelda flavor: the Darknut's shield blocks frontal hits (reuses ironBlocked)
  t(`darknut shield reuses ironBlocked`, /!mut\('IRONFRONT'\) && !e\.shield/.test(src));
  // and the shield flag must actually reach the spawned entity (not just live in the table)
  t(`spawnOne copies the shield flag onto the enemy`, /if \(d\.shield\) base\.shield = true/.test(src));
}

// lore: every memory is earned by a pure function over the lifetime ledger
{
  const ids = new Set(P.LORE.map(f => f.id));
  t('lore ids unique', ids.size === P.LORE.length);
  t('lore texts present', P.LORE.every(f => typeof f.text === 'string' && f.text.length > 10));
  const empty = { runs: 0, deaths: 0, totalKills: 0, deepest: 0, bestScore: 0, floor1Deaths: 0, totalHotdogs: 0, totalChests: 0, totalChalices: 0, totalStolen: 0, totalTufts: 0, totalSpent: 0, totalPieces: 0 };
  t('fresh ledger has no memories', P.unlockedLore(empty).length === 0);
  const rich = { runs: 10, deaths: 10, totalKills: 100, deepest: 6, bestScore: 900, floor1Deaths: 4, totalHotdogs: 2, totalChests: 3, totalChalices: 1, totalStolen: 2, totalTufts: 30, totalSpent: 250, totalPieces: 5 };
  t('a full life surfaces every memory', P.unlockedLore(rich).length === P.LORE.length);
  t('the lore is fifteen strong', P.LORE.length === 15);
  t('unlockedLore survives a broken ledger', Array.isArray(P.unlockedLore({})));
}

// epitaph always speaks
{
  t('epitaph exists', P.epitaph({ floors: 3, kills: 9, dmgTaken: 2, score: 320 }, 500).length > 5);
  t('epitaph first floor', P.epitaph({ floors: 1, kills: 0, dmgTaken: 1, score: 100 }, 0).includes('first floor'));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
