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

  return { newBossState, hitOrb, endStagger, orbPositions };
});
