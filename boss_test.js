// boss_test.js — the boss phase state machine, tested pure (RED first per /tdd).
// A boss has 3 forms; each form floats N orb weakpoints; destroying all orbs of a form
// BREAKS it (stagger window), then the next form begins. Breaking form 3 defeats the boss.
const B = require('./boss.js');

let pass = 0, fail = 0;
function t(name, cond) { if (cond) pass++; else { fail++; console.error('FAIL: ' + name); } }

// newBossState(bossDef, depth) -> initial state
const def = { id: 'test', forms: [{ orbs: 3 }, { orbs: 4 }, { orbs: 5 }] };
{
  const s = B.newBossState(def, 3);
  t('starts at form 0', s.form === 0);
  t('starts with form-0 orbs', s.orbs === 3);
  t('not staggered, not defeated', !s.staggered && !s.defeated);
}
// hitOrb: decrements; last orb breaks the form (stagger)
{
  let s = B.newBossState(def, 3);
  s = B.hitOrb(s, def);
  t('orb hit decrements', s.orbs === 2 && !s.staggered);
  s = B.hitOrb(B.hitOrb(s, def), def);
  t('last orb breaks the form', s.orbs === 0 && s.staggered && !s.defeated);
  t('form has not advanced during stagger', s.form === 0);
}
// endStagger advances the form and loads its orbs
{
  let s = B.newBossState(def, 3);
  for (let i = 0; i < 3; i++) s = B.hitOrb(s, def);
  s = B.endStagger(s, def);
  t('stagger ends into form 1', s.form === 1 && s.orbs === 4 && !s.staggered);
}
// breaking form 3 defeats
{
  let s = B.newBossState(def, 3);
  for (let f = 0; f < 3; f++) {
    const n = def.forms[f].orbs;
    for (let i = 0; i < n; i++) s = B.hitOrb(s, def);
    s = B.endStagger(s, def);
  }
  t('breaking all three forms defeats the boss', s.defeated === true);
}
// hits during stagger are ignored (no skipping a form mid-break)
{
  let s = B.newBossState(def, 3);
  for (let i = 0; i < 3; i++) s = B.hitOrb(s, def);
  const before = s;
  s = B.hitOrb(s, def);
  t('hits during stagger do nothing', s.orbs === before.orbs && s.form === before.form);
}
// depth scaling: deeper runs add orbs per form (loops get harder)
{
  const s3 = B.newBossState(def, 3), s9 = B.newBossState(def, 9);
  t('deeper bosses float more orbs', s9.orbs > s3.orbs);
}
// orbPositions: N positions on a ring around the boss, deterministic in t
{
  const pos = B.orbPositions(4, 80, 40, 0);
  t('orbPositions returns N points', pos.length === 4);
  t('points ring the boss', pos.every(o => Math.hypot(o.x - 80, o.y - 40) > 5));
  const pos2 = B.orbPositions(4, 80, 40, 0);
  t('deterministic at same t', JSON.stringify(pos) === JSON.stringify(pos2));
}

console.log(`\nboss: ${pass} passed, ${fail} failed`);
console.log(`=== ${fail} failed, ${pass} passed in 0.00s ===`);
process.exit(fail ? 1 : 0);
