// boss.js — pure boss phase state machine (UMD; node-testable, used by game.js).
// STUB: signatures only. boss_test.js goes RED against this, then we implement to GREEN.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Boss = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function newBossState(def, depth) { return undefined; }
  function hitOrb(state, def) { return undefined; }
  function endStagger(state, def) { return undefined; }
  function orbPositions(n, cx, cy, t) { return undefined; }
  return { newBossState, hitOrb, endStagger, orbPositions };
});
