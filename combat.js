// combat.js — pure weapon hit-geometry (UMD; node-testable, used by game.js).
// The single source of truth for "does this weapon's swing reach that enemy, given the
// wall between us." combat_test.js executes these (real behavior, not a grep).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Combat = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {

  // Does weapon `kind` admit an enemy at offset (dx,dy) from the player facing (dirx,diry)?
  // Geometry only — ignores jitter (whip) and LOS (handled separately by weaponHits).
  function inReach(kind, dx, dy, dirx, diry, reach) {
    const d = Math.hypot(dx, dy);
    if (d === 0) return kind !== 'whip'; // point-blank: whip's dead zone excludes it
    const dot = (dx * dirx + dy * diry) / d; // 1 = dead ahead, -1 = behind
    if (kind === 'whip') return d >= 4 && d <= reach;          // long, with a dead zone
    if (kind === 'hammer') return d <= reach && dot >= 0;      // front half-plane
    if (kind === 'flail') return d <= reach + 1 && dot >= -0.2;// front-ish sweep
    // rapier + base sword: front cone
    return d <= reach && dot >= 0.35;
  }

  // Is the straight line (x0,y0)->(x1,y1) clear of solids? Samples 3 interior midpoints,
  // matching the game's original slash LOS check. isSolid(x,y) -> truthy if blocked.
  function losClear(x0, y0, x1, y1, isSolid) {
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      if (isSolid(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
    }
    return true;
  }

  // The real predicate the game uses: reach + arc AND an unobstructed line.
  function weaponHits(kind, px, py, ex, ey, dirx, diry, reach, isSolid) {
    if (!inReach(kind, ex - px, ey - py, dirx, diry, reach)) return false;
    return losClear(px, py, ex, ey, isSolid);
  }

  return { inReach, losClear, weaponHits };
});
