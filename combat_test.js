// combat_test.js — behavioral tests for the pure weapon hit-geometry (combat.js).
// This replaces fun_test's grep-based F22 ("weapons respect walls") with real assertions
// that EXECUTE the geometry: reach boundaries, per-weapon arcs, dead zones, and
// line-of-sight. We are doing TDD — combat.js does not exist yet; this must go RED first.
const C = require('./combat.js');

let pass = 0, fail = 0;
function t(name, cond) { if (cond) pass++; else { fail++; console.error('FAIL: ' + name); } }

// facing east
const E = { x: 1, y: 0 };

// ---- inReach: reach boundaries per weapon ----
// rapier: short (5), front arc only
t('rapier hits at reach 5 in front', C.inReach('rapier', 5, 0, E.x, E.y, 5));
t('rapier misses just past reach', !C.inReach('rapier', 6, 0, E.x, E.y, 5));
t('rapier misses behind you', !C.inReach('rapier', -4, 0, E.x, E.y, 5));

// whip: long (13) WITH a dead zone < 4
t('whip dead zone: misses point-blank', !C.inReach('whip', 3, 0, E.x, E.y, 13));
t('whip hits at mid range', C.inReach('whip', 10, 0, E.x, E.y, 13));
t('whip misses past max reach', !C.inReach('whip', 14, 0, E.x, E.y, 13));

// hammer: front arc (half plane), reach 10
t('hammer hits in front', C.inReach('hammer', 8, 0, E.x, E.y, 10));
t('hammer misses behind', !C.inReach('hammer', -8, 0, E.x, E.y, 10));
t('hammer misses past reach', !C.inReach('hammer', 11, 0, E.x, E.y, 10));

// flail: front-ish sweep, reach 7 (+1 tolerance)
t('flail hits in front', C.inReach('flail', 7, 0, E.x, E.y, 7));
t('flail misses directly behind', !C.inReach('flail', -7, 0, E.x, E.y, 7));

// base sword: reach 7, front cone
t('sword hits in front cone', C.inReach('sword', 6, 1, E.x, E.y, 7));
t('sword misses to the side/back', !C.inReach('sword', -6, 0, E.x, E.y, 7));

// ---- losClear: 3-point midline sampling ----
{
  const clear = () => false;                  // nothing solid
  const wallMid = (x, y) => Math.abs(x - 5) < 1 && Math.abs(y - 0) < 1; // a cell at (5,0)
  t('LOS clear on an empty line', C.losClear(0, 0, 10, 0, clear));
  t('LOS blocked by a midpoint wall', !C.losClear(0, 0, 10, 0, wallMid));
  t('LOS clear when wall is off the line', C.losClear(0, 0, 10, 0, (x, y) => Math.abs(x - 5) < 1 && Math.abs(y - 8) < 1));
}

// ---- weaponHits: reach + arc + LOS combined (the real predicate the game uses) ----
{
  const noWall = () => false;
  const wallBetween = (x, y) => Math.abs(x - 3) < 1 && Math.abs(y - 0) < 1;
  // rapier at reach 5, clear line -> hit
  t('weaponHits: rapier clear line hits', C.weaponHits('rapier', 0, 0, 5, 0, E.x, E.y, 5, noWall));
  // same, but a wall on the midline -> NO hit (the F22 behavior, now real)
  t('weaponHits: wall blocks the rapier', !C.weaponHits('rapier', 0, 0, 5, 0, E.x, E.y, 5, wallBetween));
  // every weapon must respect the wall, not just the sword
  for (const w of ['sword', 'rapier', 'whip', 'hammer', 'flail']) {
    t(`weaponHits: wall blocks the ${w}`, !C.weaponHits(w, 0, 0, w === 'whip' ? 10 : 5, 0, E.x, E.y, 13, wallBetween));
  }
}

console.log(`\ncombat: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
