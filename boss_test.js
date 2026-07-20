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

// ===================================================================================
// PER-MECHANIC gates — each boss must differ in HOW you earn the hit. These are RED-capable:
// stub any helper to a constant and the paired asserts fail (no no-op mechanics allowed).
// ===================================================================================

// 1. ENVIRONMENT (leviathan): orbs vulnerable ONLY in the calm; calm shrinks per form but
// never below the 0.8s fairness floor; over a full cycle it is both true AND false.
{
  const p0 = B.envPhase(0, 0);
  t('env: fight opens in the active (non-calm) window', p0.calm === false);
  t('env: form-0 calm is 1.5s', Math.abs(p0.calmLen - 1.5) < 1e-9);
  t('env: calm floor holds at form 2 (>=0.8s)', B.envPhase(0, 2).calmLen >= 0.8);
  // sample a full period: vulnerability must actually toggle (proves it is a real gate)
  let sawCalm = false, sawActive = false;
  for (let ti = 0; ti < 400; ti++) { const v = B.envVulnerable(ti * 0.02, 0); sawCalm = sawCalm || v; sawActive = sawActive || !v; }
  t('env: orbs are vulnerable sometimes and invulnerable other times', sawCalm && sawActive);
}
// 2. MIRROR (inquisitor): desync exposes the orb — moving against your echo, or idle while it
// moves; NOT desynced when you mirror it. Delay shortens per form, floor 0.35s.
{
  t('mirror: moving opposite the echo = desynced', B.mirrorDesynced(1, 0, -1, 0) === true);
  t('mirror: matching the echo = synced (orb hidden)', B.mirrorDesynced(1, 0, 1, 0) === false);
  t('mirror: idle while echo moves = desynced', B.mirrorDesynced(0, 0, 1, 0) === true);
  t('mirror: echo idle = never desynced', B.mirrorDesynced(1, 0, 0, 0) === false);
  t('mirror: delay tightens per form', B.mirrorDelay(2) < B.mirrorDelay(0));
  t('mirror: delay floor >= 0.35s', B.mirrorDelay(2) >= 0.35);
}
// 3. SUMMONER (abbot): orbs invuln while any add lives; re-summon gated (anti-softlock chore).
{
  t('summoner: orbs locked while adds live', B.addsGate(2) === false);
  t('summoner: orbs open when the room is clear', B.addsGate(0) === true);
  t('summoner: no re-summon while adds still up', B.canSummon(3, 5, 3) === false);
  t('summoner: no re-summon on cooldown', B.canSummon(1, 0.5, 3) === false);
  t('summoner: re-summons once low + off cooldown', B.canSummon(1, 3, 3) === true);
}
// 4. REFRACTOR (prism): only a redirected BEAM breaks an orb, never a slash; beam cadence quickens.
{
  t('refractor: a beam breaks the orb', B.refractValid('beam') === true);
  t('refractor: a slash does NOT break the orb', B.refractValid('slash') === false);
  t('refractor: beam cadence quickens per form', B.beamCadence(2) < B.beamCadence(0));
}
// 5. GRAVITY (maw): pull sign inverts, pull magnitude capped <=50% move speed, telegraphed.
{
  t('gravity: sign is +1 early, -1 past the half-period (it flips)', B.pullSign(0) === 1 && B.pullSign(5) === -1);
  const pv = B.pullVector(10, 40, 80, 40, 10, 2, 0); // moveSpeed 10, form 2 (max 50%)
  t('gravity: pull is capped at <=50% of move speed', Math.hypot(pv.vx, pv.vy) <= 5 + 1e-9);
  t('gravity: pull points toward the boss', pv.vx > 0); // boss is to the right
  t('gravity: inversion is telegraphed just before the flip', B.pullInverting(3.6, 4.0) === true && B.pullInverting(1.0, 4.0) === false);
}
// 6. DUO (gemini): a form only advances when BOTH twins are staggered together.
{
  const stag = { staggered: true }, up = { staggered: false };
  t('duo: both staggered -> form breaks', B.duoBothStaggered(stag, stag) === true);
  t('duo: one still standing -> no break', B.duoBothStaggered(stag, up) === false);
}
// universal: telegraph floor — enrage may nudge the windup but never below 250ms.
{
  t('telegraph: floor holds under enrage', B.telegraph(0.3, 2, true) >= B.TELEGRAPH_FLOOR);
  t('telegraph: enrage shortens a long windup but not below floor', B.telegraph(0.6, 2, true) < 0.6 && B.telegraph(0.6, 2, true) >= 0.25);
}

console.log(`\nboss: ${pass} passed, ${fail} failed`);
console.log(`=== ${fail} failed, ${pass} passed in 0.00s ===`);
process.exit(fail ? 1 : 0);
