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
};
const perfect = { ...base, time: 20, idleT: 0, kills: 14, interrupts: 4, dmgTaken: 0, dashThroughs: 5, pickups: 3, treasureFound: 1, depth: 6 };
const awful = { ...base, time: 300, idleT: 60, kills: 0, interrupts: 0, dmgTaken: 6, dashThroughs: 0, pickups: 0, treasureFound: 0, depth: 1 };

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

// epitaph always speaks
{
  t('epitaph exists', P.epitaph({ floors: 3, kills: 9, dmgTaken: 2, score: 320 }, 500).length > 5);
  t('epitaph first floor', P.epitaph({ floors: 1, kills: 0, dmgTaken: 1, score: 100 }, 0).includes('first floor'));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
