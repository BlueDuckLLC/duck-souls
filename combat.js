// combat.js — pure weapon hit-geometry (UMD; node-testable, used by game.js).
// STUB: signatures only. combat_test.js goes RED against this, then we implement to GREEN.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Combat = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function inReach(kind, dx, dy, dirx, diry, reach) { return undefined; }
  function losClear(x0, y0, x1, y1, isSolid) { return undefined; }
  function weaponHits(kind, px, py, ex, ey, dirx, diry, reach, isSolid) { return undefined; }
  return { inReach, losClear, weaponHits };
});
