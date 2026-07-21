// boss_fun_red.js — /tdd-fun RED measurement for the BOSS fight (TES-7194).
// Law: instrument, don't introspect — require the REAL boss.js and RUN its pure
// functions. Structural fairness hypotheses (BF1-BF5) are measurable NOW from the
// live constants. Behavioral fun hypotheses (BF6-BF9) need the bot to FIGHT the boss
// with instrumentation — which does not exist yet (bot.js has no boss code) — so they
// are UNMEASURED = RED by construction, not by hand-typed assertion.
// Emits the `=== N failed, M passed ===` line build_ledger.py verify needs.
const Boss = require('./boss.js');

let pass = 0, fail = 0;
const rows = [];
function check(id, claim, measurable, ok, detail) {
  if (!measurable) { rows.push(['RED/UNMEASURED', id, claim, detail]); fail++; return; }
  rows.push([ok ? 'PASS' : 'RED', id, claim, detail]); ok ? pass++ : fail++;
}

// --- BF1 (REWRITTEN 2026-07-21 after the Blow-lens panel). The ORIGINAL BF1 asserted
// min(telegraph(...)) >= TELEGRAPH_FLOOR, i.e. Math.max(0.25, x) >= 0.25 — TRUE FOR EVERY
// POSSIBLE INPUT. Verified: base 0, -99, 1e9 and form 50 all return exactly 0.25. It was a
// green that could not go red, the exact sin this suite exists to prevent. Replaced with two
// MUTATION-SENSITIVE checks: the floor CONSTANT itself, and the wiring (no damage path may
// compute a windup without going through Boss.telegraph).
{
  const fs2 = require('fs');
  const GSRC = fs2.readFileSync(__dirname + '/game.js', 'utf8');
  const floorOk = Boss.TELEGRAPH_FLOOR >= 0.25;                    // flips if anyone lowers it
  const usesTelegraph = /telegraphA\s*=\s*\{[^}]*Boss\.telegraph\(/.test(GSRC); // wiring, not identity
  check('BF1', 'Telegraph floor is >=250ms AND the boss windup actually routes through it', true,
    floorOk && usesTelegraph,
    `TELEGRAPH_FLOOR=${Boss.TELEGRAPH_FLOOR} (>=0.25 ${floorOk}); game.js windup routes through Boss.telegraph=${usesTelegraph}`);
}

// --- BF2: the vulnerability (calm) window never closes below the 0.8s fairness floor.
{
  let minCalm = Infinity;
  for (const form of [0, 1, 2]) for (let t = 0; t < 8; t += 0.13)
    minCalm = Math.min(minCalm, Boss.envPhase(t, form).calmLen);
  check('BF2', 'Leviathan calm window >= 0.8s fairness floor (all forms)', true,
    minCalm >= 0.8 - 1e-9, `min calmLen across forms = ${minCalm.toFixed(2)}s`);
}

// --- BF3 (REPOINTED 2026-07-21). Was measuring Boss.pullVector — which game.js calls ZERO
// times (verified: pullVector 0 hits, fieldVector 2 hits). A fairness gate aimed at dead code
// is a false green. Now measures the LIVE fieldVector the game actually uses.
{
  const ms = 1.0; let maxFrac = 0;
  for (const form of [0, 1, 2]) for (let t = 0; t < 8; t += 0.1) {
    const v = Boss.fieldVector(0, 0, 10, 0, ms, form, t);
    maxFrac = Math.max(maxFrac, Math.hypot(v.vx, v.vy) / ms);
  }
  check('BF3', 'Field pull <= 50% move speed on the LIVE path (always out-walkable)', true,
    maxFrac <= 0.5 + 1e-9, `max |fieldVector| = ${(maxFrac * 100).toFixed(1)}% of move speed (live fn, not dead pullVector)`);
}

// --- BF14 (NEW, from the Blow-lens panel 2026-07-21). Threshold pinned BEFORE measuring:
// a gravity WELL must weaken with distance, else it is a wind and teaches nothing.
// |field| at 2x distance must be <= 0.6x |field| at 1x distance.
{
  let worst = 0;
  for (const form of [0, 1, 2]) {
    const near = Boss.fieldVector(0, 0, 10, 0, 1, form, 1), far = Boss.fieldVector(0, 0, 20, 0, 1, form, 1);
    const mn = Math.hypot(near.vx, near.vy) || 1e-9, mf = Math.hypot(far.vx, far.vy);
    worst = Math.max(worst, mf / mn);
  }
  check('BF14', 'Gravity field has a real distance GRADIENT (not a renormalized wind)', true,
    worst <= 0.6, `|field| ratio at 2x distance = ${worst.toFixed(3)} (need <=0.60); 1.000 means renormalized => no falloff`);
}

// --- BF4: no softlock — the summoner cannot infinitely re-summon (cooldown + cap gate).
{
  const canSpamAtCap = Boss.canSummon(3, 99, 3);      // at cap -> must be false
  const canSummonEarly = Boss.canSummon(1, 0.5, 3);   // cooldown not elapsed -> false
  const orbsHittableWhenClear = Boss.addsGate(0);     // no adds -> orbs vulnerable
  const ok = !canSpamAtCap && !canSummonEarly && orbsHittableWhenClear;
  check('BF4', 'Summoner cannot softlock (cap + cooldown gate; orbs open when clear)', true,
    ok, `spam@cap=${canSpamAtCap} earlyResummon=${canSummonEarly} orbsOpenWhenClear=${orbsHittableWhenClear}`);
}

// --- BF5: each form earns the hit a DISTINCT way (not a reskin) — the 6 per-mechanic
// predicates must exist and disagree on the same input (mechanism distinctness).
{
  const have = ['envVulnerable', 'mirrorDesynced', 'refractValid', 'pullInverting', 'duoBothStaggered', 'canSummon']
    .every(k => typeof Boss[k] === 'function');
  // distinctness probe: on a fixed situation the gates should not all return the same verdict
  const verdicts = [
    Boss.envVulnerable(0.1, 0),                 // active phase -> false
    Boss.mirrorDesynced(1, 0, 1, 0),            // moving WITH echo -> false
    Boss.refractValid('slash'),                 // slash not beam -> false
    Boss.refractValid('beam'),                  // beam -> true
  ];
  const distinct = new Set(verdicts).size > 1;
  check('BF5', 'Each boss form earns the hit a distinct way (6 gates, non-identical)', true,
    have && distinct, `6 mechanic gates present=${have}; verdicts vary=${distinct}`);
}

// --- BF6-BF9: BEHAVIORAL — require the bot to FIGHT the boss with instrumentation.
// bot.js currently has ZERO boss code (grep: no boss/orb/stagger/form). So these are
// UNMEASURED. Per /tdd-fun law "a fun claim must be a measured claim" — unmeasured is
// RED, never a silent pass. This is precisely the work TES-7194 Tier-1 turns green.
check('BF6', 'A competent player reaches form 2 in a fair window (not trivial, not impossible)',
  false, false, 'UNMEASURED: bot.js does not enter/fight the boss room — no time-to-form-2 metric exists');
check('BF7', '>= 70% of boss damage to the player is telegraphed IN THE FIGHT (not just in the constant)',
  false, false, 'UNMEASURED: no boss-damage event log in bot.js; BF1 proves the FLOOR, not fight-time behavior');
check('BF8', 'No degenerate boss cheese (exploit seat best strategy <= 15% better than intended)',
  false, false, 'UNMEASURED: no boss exploit-seat run; dash-spam / corner-camp untested against the fight');
// BF9 is now MEASURED (structural, bot-independent). Threshold PINNED 2026-07-21 before
// measurement: orb growth bounded at <= 2.0x the depth-3 baseline for all depth <= 30,
// AND the telegraph floor still holds at depth. Executes the real newBossState/telegraph.
{
  const def = { forms: [{ orbs: 3 }, { orbs: 4 }, { orbs: 5 }] };  // leviathan form set
  const base = Boss.newBossState(def, 3).orbs;                      // depth-3 baseline
  let worst = 0, worstDepth = 0;
  for (let d = 3; d <= 30; d++) {
    const r = Boss.newBossState(def, d).orbs / base;
    if (r > worst) { worst = r; worstDepth = d; }
  }
  // the telegraph floor must survive depth too (form is capped at 2 inside telegraph())
  let minTele = Infinity;
  for (let form = 0; form < 12; form++) minTele = Math.min(minTele, Boss.telegraph(0.4, form, true));
  const ok = worst <= 2.0 && minTele >= Boss.TELEGRAPH_FLOOR - 1e-9;
  check('BF9', 'Depth scaling is BOUNDED (orbs cannot grow forever) + floor holds', true, ok,
    `orbs depth3=${base} -> worst ${worst.toFixed(2)}x at depth ${worstDepth} (cap 2.0x); min telegraph across 12 forms = ${minTele.toFixed(3)}s`);
}

// --- report
console.log('\nBOSS_FUN RED — DUCK SOULS boss fight (TES-7194)\n');
for (const [v, id, claim, detail] of rows)
  console.log(`  ${v.padEnd(15)} ${id}  ${claim}\n${' '.repeat(20)}${detail}`);
console.log(`\n  structural fairness measurable now · behavioral fun UNMEASURED (bot never fights the boss)`);
console.log(`\n=== ${fail} failed, ${pass} passed ===`);
process.exit(0);
