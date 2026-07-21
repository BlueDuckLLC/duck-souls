// boss.js — pure boss phase state machine (UMD; node-testable, used by game.js).
// Saros-style: each of 3 forms floats orb weakpoints; break all orbs -> stagger -> next
// form; break form 3 -> defeated. Pure functions over plain state, like pantheon.js.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Boss = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {

  // deeper runs float extra orbs per form (loops get harder)
  const depthBonus = depth => Math.max(0, Math.floor((depth - 3) / 3));

  function newBossState(def, depth) {
    return { form: 0, orbs: def.forms[0].orbs + depthBonus(depth), depth, staggered: false, defeated: false };
  }

  function hitOrb(state, def) {
    if (state.staggered || state.defeated || state.orbs <= 0) return state;
    const orbs = state.orbs - 1;
    if (orbs > 0) return { ...state, orbs };
    return { ...state, orbs: 0, staggered: true }; // the form breaks
  }

  function endStagger(state, def) {
    if (!state.staggered) return state;
    const next = state.form + 1;
    if (next >= def.forms.length) return { ...state, staggered: false, defeated: true };
    return { ...state, form: next, orbs: def.forms[next].orbs + depthBonus(state.depth), staggered: false };
  }

  // N orb positions on a tilted ring around (cx,cy); deterministic in t so the game can
  // draw and hit-test the same points.
  function orbPositions(n, cx, cy, t) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = t * 1.4 + i / n * Math.PI * 2;
      out.push({ x: cx + Math.cos(a) * 14, y: cy + Math.sin(a) * 8, depth: Math.sin(a) });
    }
    return out;
  }

  // ===================================================================================
  // PER-MECHANIC pure helpers. Each boss keeps the SAME damage verb (break the orbs) but
  // differs in HOW you earn the hit. These are the testable gates — an advertised mechanic
  // must be a real effect (pantheon honesty law). All pure & deterministic in their inputs.
  // ===================================================================================

  // --- 1. ENVIRONMENT (leviathan): arena cycles active -> calm -> active. Orbs are ONLY
  // vulnerable during the calm; calm shrinks per form (fairness floor 0.8s), active is fixed.
  const CALM_LEN = [1.5, 1.0, 0.8], ACTIVE_LEN = 2.2;
  function envPhase(t, form) {
    const calm = CALM_LEN[Math.min(form, CALM_LEN.length - 1)];
    const period = ACTIVE_LEN + calm;
    const p = ((t % period) + period) % period;
    const inCalm = p >= ACTIVE_LEN;
    return { calm: inCalm, calmLen: calm, activeLen: ACTIVE_LEN, tLeft: inCalm ? period - p : ACTIVE_LEN - p };
  }
  function envVulnerable(t, form) { return envPhase(t, form).calm; }

  // --- 2. MIRROR (inquisitor): a delayed clone replays your inputs. You're DESYNCED (orb
  // exposed) when you move against your own echo, or stand still while it moves.
  function mirrorDesynced(pvx, pvy, evx, evy) {
    const pm = Math.hypot(pvx, pvy), em = Math.hypot(evx, evy);
    if (em < 0.05) return false;                 // echo idle -> nothing to break from
    if (pm < 0.05) return true;                  // you idle while it moves -> desynced
    return (pvx * evx + pvy * evy) / (pm * em) < -0.2;  // moving against your echo
  }
  const MIRROR_DELAY = [0.75, 0.5, 0.35];
  function mirrorDelay(form) { return MIRROR_DELAY[Math.min(form, MIRROR_DELAY.length - 1)]; }

  // --- 3. SUMMONER (abbot): orbs invulnerable while any add lives. Re-summon only when adds
  // run low AND a cooldown elapsed AND under the cap -> anti-chore + anti-softlock.
  function addsGate(nAlive) { return (nAlive | 0) <= 0; }
  function canSummon(nAlive, sinceLast, cap) { return nAlive <= 1 && sinceLast >= 2.0 && nAlive < (cap || 3); }

  // --- 4. REFRACTOR (prism): orbs break ONLY from a redirected light beam, never a slash.
  function refractValid(hitKind) { return hitKind === 'beam'; }
  const BEAM_CADENCE = [2.5, 2.0, 1.5];
  function beamCadence(form) { return BEAM_CADENCE[Math.min(form, BEAM_CADENCE.length - 1)]; }

  // --- 5. GRAVITY (maw): constant pull toward the boss, capped <=50% of move speed, sign
  // inverts on a telegraphed cycle. Pure vector so the game and the test agree.
  const PULL_FRAC = [0.35, 0.45, 0.5], PULL_PERIOD = 4.0, PULL_WINDUP = 0.5;
  function pullSign(t, period) { period = period || PULL_PERIOD; const w = period * 2, p = ((t % w) + w) % w; return p < period ? 1 : -1; }
  function pullInverting(t, period) { period = period || PULL_PERIOD; const p = ((t % period) + period) % period; return p >= period - PULL_WINDUP; }
  function pullVector(px, py, bx, by, moveSpeed, form, t) {
    const frac = PULL_FRAC[Math.min(form, PULL_FRAC.length - 1)];
    const dx = bx - px, dy = by - py, d = Math.hypot(dx, dy) || 1;
    const s = pullSign(t) * frac * moveSpeed;
    return { vx: dx / d * s, vy: dy / d * s, frac };
  }

  // --- 5b. GRAVITY AS LANGUAGE (Blow: "the environment IS the language"). Boss and player speak
  // ONE grammar — the field. Vocabulary is ADDITIVE (Witness-style): form N keeps every rule of
  // N-1 and adds exactly one, so you learn sentences instead of memorising arenas. Every rule is
  // a real transform of the field — never decoration (the no-op-guard law).
  const FIELD_VOCAB = ['pull', 'well2', 'rotate'];
  function fieldRules(form) { return FIELD_VOCAB.slice(0, Math.max(1, Math.min(FIELD_VOCAB.length, ((form | 0) + 1)))); }

  function fieldVector(px, py, bx, by, moveSpeed, form, t) {
    const rules = fieldRules(form);
    let vx = 0, vy = 0;
    // rule 1 — THE PULL: one vector toward the boss; its sign flips on the telegraphed cycle.
    if (rules.indexOf('pull') >= 0) {
      const dx = bx - px, dy = by - py, d = Math.hypot(dx, dy) || 1, s = pullSign(t);
      vx += dx / d * s; vy += dy / d * s;
    }
    // rule 2 — A SECOND COMPETING WELL: the field stops being one direction; you must read which
    // well owns you right now (orbiting offset so the answer keeps changing).
    if (rules.indexOf('well2') >= 0) {
      const wx = bx + Math.cos(t * 0.6) * 26, wy = by + Math.sin(t * 0.6) * 16;
      const dx = wx - px, dy = wy - py, d = Math.hypot(dx, dy) || 1;
      vx += dx / d * 0.7; vy += dy / d * 0.7;
    }
    // rule 3 — ROTATION: a tangential component turns the whole field, so straight lines stop working.
    if (rules.indexOf('rotate') >= 0) {
      const dx = bx - px, dy = by - py, d = Math.hypot(dx, dy) || 1;
      vx += -dy / d * 0.8; vy += dx / d * 0.8;
    }
    // the fairness cap survives the grammar: never more than 50% of move speed (dash still wins)
    const mag = Math.hypot(vx, vy) || 1, cap = PULL_FRAC[Math.min(form, PULL_FRAC.length - 1)] * moveSpeed;
    return { vx: vx / mag * cap, vy: vy / mag * cap };
  }

  // --- 6. DUO (gemini wardens): two twins, each its OWN Boss state. A shared form advances
  // only when BOTH are staggered together; otherwise the standing twin revives its partner.
  function duoBothStaggered(a, b) { return !!(a && b && a.staggered && b.staggered); }

  // --- universal fairness: telegraph floor. Any lethal windup must be >= 250ms; enrage may
  // shorten the GAP/recovery, never the windup below the floor.
  const TELEGRAPH_FLOOR = 0.25;
  function telegraph(base, form, enrage) {
    const w = enrage ? base * (1 - 0.12 * form) : base;   // enrage nudges, floor protects
    return Math.max(TELEGRAPH_FLOOR, w);
  }

  return {
    newBossState, hitOrb, endStagger, orbPositions,
    // per-mechanic gates + tunables
    envPhase, envVulnerable, mirrorDesynced, mirrorDelay,
    addsGate, canSummon, refractValid, beamCadence,
    pullSign, pullInverting, pullVector, duoBothStaggered, fieldRules, fieldVector,
    telegraph, TELEGRAPH_FLOOR,
  };
});
