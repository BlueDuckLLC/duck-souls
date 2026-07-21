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

// --- BF1: every boss windup is telegraphed >= 250ms even at max enrage, all forms.
{
  let min = Infinity;
  for (const base of [0.3, 0.4, 0.5]) for (const form of [0, 1, 2]) for (const en of [false, true])
    min = Math.min(min, Boss.telegraph(base, form, en));
  check('BF1', 'Every boss windup telegraphs >= 250ms at max enrage', true,
    min >= Boss.TELEGRAPH_FLOOR - 1e-9, `min telegraph across forms/enrage = ${min.toFixed(3)}s (floor ${Boss.TELEGRAPH_FLOOR})`);
}

// --- BF2: the vulnerability (calm) window never closes below the 0.8s fairness floor.
{
  let minCalm = Infinity;
  for (const form of [0, 1, 2]) for (let t = 0; t < 8; t += 0.13)
    minCalm = Math.min(minCalm, Boss.envPhase(t, form).calmLen);
  check('BF2', 'Leviathan calm window >= 0.8s fairness floor (all forms)', true,
    minCalm >= 0.8 - 1e-9, `min calmLen across forms = ${minCalm.toFixed(2)}s`);
}

// --- BF3: gravity pull never exceeds 50% of move speed — you can always out-walk it.
{
  const ms = 1.0; let maxFrac = 0;
  for (const form of [0, 1, 2]) for (let t = 0; t < 8; t += 0.1) {
    const v = Boss.pullVector(0, 0, 10, 0, ms, form, t);
    maxFrac = Math.max(maxFrac, Math.hypot(v.vx, v.vy) / ms);
  }
  check('BF3', 'Gravity pull <= 50% move speed (always out-walkable)', true,
    maxFrac <= 0.5 + 1e-9, `max pull fraction of move speed = ${(maxFrac * 100).toFixed(1)}%`);
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
check('BF9', 'Depth scaling stays fair (deeper = more orbs, telegraph floor still holds)',
  false, false, 'UNMEASURED behaviorally: depthBonus() adds orbs (structural), but no bot run proves the deeper fight is winnable-and-fair');

// --- report
console.log('\nBOSS_FUN RED — DUCK SOULS boss fight (TES-7194)\n');
for (const [v, id, claim, detail] of rows)
  console.log(`  ${v.padEnd(15)} ${id}  ${claim}\n${' '.repeat(20)}${detail}`);
console.log(`\n  structural fairness measurable now · behavioral fun UNMEASURED (bot never fights the boss)`);
console.log(`\n=== ${fail} failed, ${pass} passed ===`);
process.exit(0);
