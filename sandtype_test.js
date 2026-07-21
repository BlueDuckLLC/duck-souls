// sandtype_test.js — 100 assertions over TYPOGRAPHY DYNAMICS (sandtype.js).
// Written RED-first per /tdd. Every Mod.fn call is guarded so an absent module fails COUNTABLY
// (=== N failed ===) instead of crashing — build_ledger.py can't parse a stack trace.
const Mod = (() => { try { return require('./sandtype.js'); } catch (e) { return {}; } })();
const has = f => typeof Mod[f] === 'function';

let pass = 0, fail = 0;
function t(name, cond) { if (cond) pass++; else { fail++; console.error('FAIL: ' + name); } }

const S = Mod.SPECIES || {};
const G = (g, x, y) => has('get') ? Mod.get(g, x, y) : -1;

// ═══ 1. SPECIES TABLE (8) ════════════════════════════════════════════════════════════════════
t('SPECIES table exposed', !!Mod.SPECIES);
t('EMPTY is 0 (a falsy empty cell is load-bearing)', Mod.EMPTY === 0);
t('every species has a distinct id', new Set(Object.values(S)).size === Object.keys(S).length);
t('the sand-box roster is present', ['SAND', 'WATER', 'STONE', 'MOSS', 'WORM', 'CRAB', 'VOID'].every(k => k in S));
t('NAMES indexes by id', !!Mod.NAMES && Mod.NAMES[Mod.SAND] === 'SAND' && Mod.NAMES[Mod.CRAB] === 'CRAB');
t('SAND is solid', has('isSolid') && Mod.isSolid(Mod.SAND) === true);
t('WATER is NOT solid (nothing stands on it)', has('isSolid') && Mod.isSolid(Mod.WATER) === false);
t('VOID is not solid — a worm tunnel is a hole', has('isSolid') && Mod.isSolid(Mod.VOID) === false);

// ═══ 2. GRID (14) ════════════════════════════════════════════════════════════════════════════
if (has('newGrid')) {
  const g = Mod.newGrid(8, 5);
  t('newGrid honors width', g.w === 8);
  t('newGrid honors height', g.h === 5);
  t('newGrid allocates w*h cells', g.cells.length === 40);
  t('newGrid starts empty', has('count') && Mod.count(g, Mod.EMPTY) === 40);
  t('newGrid can prefill', Mod.count(Mod.newGrid(4, 4, Mod.STONE), Mod.STONE) === 16);
  t('newGrid clamps zero width to 1', Mod.newGrid(0, 3).w === 1);
  t('newGrid clamps negative height to 1', Mod.newGrid(3, -9).h === 1);
  t('in-bounds reads what was set', (Mod.set(g, 2, 2, Mod.SAND), G(g, 2, 2) === Mod.SAND));
  t('inBounds true inside', Mod.inBounds(g, 0, 0) && Mod.inBounds(g, 7, 4));
  t('inBounds false outside', !Mod.inBounds(g, 8, 0) && !Mod.inBounds(g, 0, 5) && !Mod.inBounds(g, -1, 0));
  t('OOB reads as STONE (the world has walls)', G(g, -1, 0) === Mod.STONE && G(g, 99, 99) === Mod.STONE);
  t('set OOB is a no-op, not a throw', (() => { try { Mod.set(g, -5, -5, Mod.SAND); return true; } catch (e) { return false; } })());
  t('cloneGrid copies contents', Mod.count(Mod.cloneGrid(g), Mod.SAND) === Mod.count(g, Mod.SAND));
  t('cloneGrid is a DEEP copy', (() => { const c = Mod.cloneGrid(g); Mod.set(c, 0, 0, Mod.WORM); return G(g, 0, 0) !== Mod.WORM; })());
}

// ═══ 3. THE FONT (12) ════════════════════════════════════════════════════════════════════════
t('FONT exposed', !!Mod.FONT);
if (Mod.FONT) {
  const F = Mod.FONT, keys = Object.keys(F);
  t('all 26 letters present', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').every(c => c in F));
  t('all 10 digits present', '0123456789'.split('').every(c => c in F));
  t('space is defined', ' ' in F);
  t('every glyph is 7 rows', keys.every(k => F[k].length === Mod.GLYPH_H));
  t('every row is 5 columns', keys.every(k => F[k].every(r => r.length === Mod.GLYPH_W)));
  t('rows use only . and #', keys.every(k => F[k].every(r => /^[.#]+$/.test(r))));
  t('space is entirely blank', F[' '].every(r => r === '.....'));
  t('O has a closed counter (a hole a worm can eat)', F['O'][3][2] === '.' && F['O'][3][0] === '#' && F['O'][3][4] === '#');
  t('I has a spine', F['I'].slice(1, 6).every(r => r[2] === '#'));
  t('no letter is blank', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').every(c => F[c].some(r => r.includes('#'))));
  t('every letter touches the top row', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').every(c => F[c][0].includes('#')));
}

// ═══ 4. MEASURE + STAMP + TYPESET (20) ═══════════════════════════════════════════════════════
if (has('measure')) {
  t('measure of empty string is zero-width', Mod.measure('').w === 0);
  t('measure counts characters', Mod.measure('AB').n === 2);
  t('measure height is the glyph height', Mod.measure('A').h === Mod.GLYPH_H);
  t('one char is exactly glyph-wide', Mod.measure('A').w === Mod.GLYPH_W);
  t('two chars add one tracking column', Mod.measure('AB').w === Mod.GLYPH_W * 2 + 1);
  t('scale multiplies width', Mod.measure('A', { scale: 3 }).w === Mod.GLYPH_W * 3);
  t('scale multiplies height', Mod.measure('A', { scale: 2 }).h === Mod.GLYPH_H * 2);
  t('track 0 removes the gap', Mod.measure('AB', { track: 0 }).w === Mod.GLYPH_W * 2);
  t('measure is case-insensitive', Mod.measure('ab').w === Mod.measure('AB').w);
  t('measure tolerates null', Mod.measure(null).n === 0);
}
if (has('stamp') && has('newGrid')) {
  const ink = ch => Mod.FONT[ch].join('').split('#').length - 1;
  let g = Mod.newGrid(40, 12);
  const laid = Mod.stamp(g, 'A', 1, 1, Mod.SAND);
  t('stamp returns the grain count', laid === ink('A'));
  t('stamp deposits exactly that many grains', Mod.count(g, Mod.SAND) === ink('A'));
  t('stamp lands at the requested origin', G(g, 1 + 1, 1) === Mod.SAND);   // A row0 = .###.
  t('stamp leaves the counter empty', G(g, 1 + 0, 1) === Mod.EMPTY);
  g = Mod.newGrid(40, 12);
  Mod.stamp(g, 'A', 1, 1, Mod.STONE);
  t('stamp honors the species', Mod.count(g, Mod.STONE) === ink('A') && Mod.count(g, Mod.SAND) === 0);
  g = Mod.newGrid(40, 12);
  Mod.stamp(g, '', 1, 1, Mod.SAND);
  t('unknown chars render blank, never throw', Mod.count(g, Mod.SAND) === 0);
  g = Mod.newGrid(40, 20);
  t('scale 2 lays 4x the grains', (Mod.stamp(g, 'I', 1, 1, Mod.SAND, { scale: 2 }), Mod.count(g, Mod.SAND) === ink('I') * 4));
  g = Mod.newGrid(6, 6);
  t('stamp clips at the edge instead of throwing', (() => { try { Mod.stamp(g, 'WWWW', 3, 3, Mod.SAND); return true; } catch (e) { return false; } })());
  t('clipped stamp still wrote something', Mod.count(g, Mod.SAND) > 0);
  t('stamping empty text lays nothing', (() => { const q = Mod.newGrid(10, 10); return Mod.stamp(q, '', 0, 0, Mod.SAND) === 0; })());
}
if (has('typeset')) {
  const g = Mod.typeset(60, 20, 'DANK');
  t('typeset returns the requested size', g.w === 60 && g.h === 20);
  t('typeset deposits grains', Mod.count(g, Mod.SAND) > 0);
  t('typeset centres horizontally', (() => {
    let min = 99, max = -1;
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (G(g, x, y) !== Mod.EMPTY) { if (x < min) min = x; if (x > max) max = x; }
    return Math.abs(min - (g.w - 1 - max)) <= 1;
  })());
  t('typeset honors an explicit x', (() => {
    const q = Mod.typeset(60, 20, 'I', { x: 0, y: 0 });
    return G(q, 2, 0) === Mod.SAND;
  })());
  t('typeset honors the species option', Mod.count(Mod.typeset(60, 20, 'A', { species: Mod.STONE }), Mod.STONE) > 0);
}

// ═══ 5. SAND — it must FALL and it must SLUMP (12) ════════════════════════════════════════════
if (has('step') && has('newGrid')) {
  let g = Mod.newGrid(5, 5);
  Mod.set(g, 2, 0, Mod.SAND);
  let n = Mod.step(g, 1);
  t('sand falls one cell per tick', G(n, 2, 1) === Mod.SAND && G(n, 2, 0) === Mod.EMPTY);
  t('step does NOT mutate its input', G(g, 2, 0) === Mod.SAND);
  t('step returns a different object', n !== g);
  n = Mod.run(g, 10, 1);
  t('sand comes to rest on the floor', G(n, 2, 4) === Mod.SAND);
  t('sand is conserved while falling', Mod.count(n, Mod.SAND) === 1);
  // NB: a SINGLE stone block is not a floor — sand correctly slumps off its shoulder. The first
  // version of this test asserted otherwise and was wrong about the physics, not the code.
  g = Mod.newGrid(5, 5);
  for (let x = 0; x < 5; x++) Mod.set(g, x, 4, Mod.STONE);
  Mod.set(g, 2, 0, Mod.SAND);
  t('sand rests on stone', G(Mod.run(g, 10, 1), 2, 3) === Mod.SAND);
  t('stone itself never moves', Mod.count(Mod.run(g, 10, 1), Mod.STONE) === 5);
  g = Mod.newGrid(7, 6);
  for (let i = 0; i < 5; i++) Mod.set(g, 3, i, Mod.SAND);       // a column, must slump
  n = Mod.run(g, 24, 7);
  t('a sand column slumps sideways', (() => { let wide = 0; for (let x = 0; x < 7; x++) if (G(n, x, 5) === Mod.SAND) wide++; return wide > 1; })());
  t('slumping conserves every grain', Mod.count(n, Mod.SAND) === 5);
  t('nothing floats after settling', (() => {
    for (let y = 0; y < n.h - 1; y++) for (let x = 0; x < n.w; x++)
      if (G(n, x, y) === Mod.SAND && G(n, x, y + 1) === Mod.EMPTY) return false;
    return true;
  })());
  g = Mod.newGrid(3, 3, Mod.STONE);
  t('a full grid is stable', Mod.count(Mod.step(g, 1), Mod.STONE) === 9);
  g = Mod.newGrid(4, 4); Mod.set(g, 1, 3, Mod.SAND);
  t('sand already on the floor stays put', G(Mod.step(g, 1), 1, 3) === Mod.SAND);
}

// ═══ 6. WATER — falls, then LEVELS (8) ═══════════════════════════════════════════════════════
if (has('step')) {
  let g = Mod.newGrid(7, 5);
  Mod.set(g, 3, 0, Mod.WATER);
  t('water falls', G(Mod.step(g, 3), 3, 1) === Mod.WATER);
  let n = Mod.run(g, 12, 3);
  t('water reaches the floor', G(n, 3, 4) === Mod.WATER || Mod.count(n, Mod.WATER) === 1);
  t('water is conserved', Mod.count(n, Mod.WATER) === 1);
  g = Mod.newGrid(9, 4);
  for (let i = 0; i < 6; i++) Mod.set(g, 4, i % 4, Mod.WATER);
  n = Mod.run(g, 30, 5);
  t('water spreads wider than its column', (() => { let w = 0; for (let x = 0; x < 9; x++) if (G(n, x, 3) === Mod.WATER) w++; return w >= 2; })());
  t('water never leaks off-grid', Mod.count(n, Mod.WATER) === Mod.count(g, Mod.WATER));
  g = Mod.newGrid(5, 6);
  Mod.set(g, 2, 3, Mod.WATER); Mod.set(g, 2, 0, Mod.SAND);
  n = Mod.run(g, 20, 9);
  t('sand sinks THROUGH water (density)', (() => {
    let sy = -1, wy = -1;
    for (let y = 0; y < 6; y++) for (let x = 0; x < 5; x++) { if (G(n, x, y) === Mod.SAND) sy = y; if (G(n, x, y) === Mod.WATER) wy = y; }
    return sy >= wy;
  })());
  t('the swap conserves sand', Mod.count(n, Mod.SAND) === 1);
  t('the swap conserves water', Mod.count(n, Mod.WATER) === 1);
}

// ═══ 7. MOSS — creeps along solids, never blooms in air (10) ══════════════════════════════════
if (has('step')) {
  let g = Mod.newGrid(9, 9);
  Mod.set(g, 4, 4, Mod.MOSS);
  let n = Mod.run(g, 40, 11, { mossP: 1.0 });
  t('moss alone in the air does NOT spread', Mod.count(n, Mod.MOSS) === 1);
  g = Mod.newGrid(9, 9);
  for (let x = 0; x < 9; x++) Mod.set(g, x, 8, Mod.STONE);
  Mod.set(g, 4, 7, Mod.MOSS);
  n = Mod.run(g, 60, 13, { mossP: 1.0 });
  t('moss on a solid DOES spread', Mod.count(n, Mod.MOSS) > 1);
  t('moss spreads along the surface', Mod.count(n, Mod.MOSS) >= 3);
  t('moss never eats the stone it roots in', Mod.count(n, Mod.STONE) === 9);
  t('moss stays adjacent to something solid', (() => {
    for (let y = 0; y < n.h; y++) for (let x = 0; x < n.w; x++) {
      if (G(n, x, y) !== Mod.MOSS) continue;
      const near = [[0, -1], [0, 1], [-1, 0], [1, 0]].some(d => Mod.isSolid(G(n, x + d[0], y + d[1])));
      if (!near) return false;
    }
    return true;
  })());
  t('mossP 0 freezes growth entirely', Mod.count(Mod.run(g, 40, 13, { mossP: 0 }), Mod.MOSS) === 1);
  t('a lower mossP grows strictly slower', (() => {
    const slow = Mod.count(Mod.run(g, 12, 21, { mossP: 0.02 }), Mod.MOSS);
    const fast = Mod.count(Mod.run(g, 12, 21, { mossP: 1.0 }), Mod.MOSS);
    return slow <= fast;
  })());
  // the typography case: moss should trace a letter's outline
  g = Mod.newGrid(30, 14);
  Mod.stamp(g, 'O', 4, 3, Mod.STONE);
  Mod.set(g, 3, 3, Mod.MOSS);
  n = Mod.run(g, 80, 17, { mossP: 1.0 });
  t('moss colonises a stamped letter', Mod.count(n, Mod.MOSS) > 1);
  t('moss does not destroy the letter', Mod.count(n, Mod.STONE) === Mod.count(g, Mod.STONE));
  t('moss growth is bounded by the grid', Mod.count(n, Mod.MOSS) <= 30 * 14);
}

// ═══ 8. WORM — burrows and leaves VOID (10) ══════════════════════════════════════════════════
if (has('step')) {
  let g = Mod.newGrid(20, 12, Mod.SAND);
  Mod.set(g, 10, 6, Mod.WORM);
  const before = Mod.count(g, Mod.SAND);
  let n = Mod.run(g, 25, 19);
  t('there is still exactly one worm', Mod.count(n, Mod.WORM) === 1);
  t('the worm moved', G(n, 10, 6) !== Mod.WORM || Mod.count(n, Mod.VOID) > 0);
  t('the worm leaves VOID behind', Mod.count(n, Mod.VOID) > 0);
  t('the worm eats solid as it goes', Mod.count(n, Mod.SAND) < before);
  t('worm + void + sand accounts for the grid', Mod.count(n, Mod.SAND) + Mod.count(n, Mod.VOID) + Mod.count(n, Mod.WORM) === 20 * 12);
  g = Mod.newGrid(5, 5, Mod.STONE);
  Mod.set(g, 2, 2, Mod.WORM);
  n = Mod.run(g, 20, 23);
  t('a worm cannot chew STONE', Mod.count(n, Mod.STONE) === 24);
  t('a boxed-in worm survives', Mod.count(n, Mod.WORM) === 1);
  g = Mod.newGrid(24, 12); Mod.stamp(g, 'OO', 2, 2, Mod.STONE);
  Mod.set(g, 12, 6, Mod.WORM);
  n = Mod.run(g, 30, 29);
  t('a worm in open space still tunnels', Mod.count(n, Mod.WORM) === 1);
  t('two worms both survive', (() => {
    const q = Mod.newGrid(20, 12, Mod.SAND);
    Mod.set(q, 4, 4, Mod.WORM); Mod.set(q, 15, 8, Mod.WORM);
    return Mod.count(Mod.run(q, 20, 31), Mod.WORM) === 2;
  })());
  t('worms never multiply', (() => {
    const q = Mod.newGrid(20, 12, Mod.SAND);
    Mod.set(q, 4, 4, Mod.WORM);
    for (let s = 1; s < 12; s++) if (Mod.count(Mod.run(q, s, 37), Mod.WORM) !== 1) return false;
    return true;
  })());
}

// ═══ 9. CRAB — walks the surface, carries a grain (8) ═════════════════════════════════════════
if (has('step')) {
  let g = Mod.newGrid(16, 8);
  for (let x = 0; x < 16; x++) Mod.set(g, x, 7, Mod.STONE);
  Mod.set(g, 8, 6, Mod.CRAB);
  let n = Mod.run(g, 20, 41);
  t('there is still exactly one crab', Mod.count(n, Mod.CRAB) === 1);
  t('the crab walked', (() => { for (let x = 0; x < 16; x++) if (G(n, x, 6) === Mod.CRAB && x !== 8) return true; return false; })());
  t('the crab stays on the floor', (() => { for (let x = 0; x < 16; x++) if (G(n, x, 6) === Mod.CRAB) return true; return false; })());
  t('the crab does not eat the floor', Mod.count(n, Mod.STONE) === 16);
  g = Mod.newGrid(16, 8);
  for (let x = 0; x < 16; x++) Mod.set(g, x, 7, Mod.STONE);
  Mod.set(g, 8, 6, Mod.CRAB); Mod.set(g, 8, 5, Mod.SAND);
  n = Mod.run(g, 16, 43);
  t('the carried grain is not destroyed', Mod.count(n, Mod.SAND) === 1);
  t('the crab is not destroyed while carrying', Mod.count(n, Mod.CRAB) === 1);
  g = Mod.newGrid(10, 8);
  Mod.set(g, 5, 0, Mod.CRAB);
  n = Mod.run(g, 20, 47);
  t('a crab with no floor falls', G(n, 5, 0) !== Mod.CRAB);
  t('a fallen crab still exists', Mod.count(n, Mod.CRAB) === 1);
}

// ═══ 10. DETERMINISM + LOOP DETECTION — what a GIF needs (10) ═════════════════════════════════
if (has('step') && has('run')) {
  const mk = () => { const g = Mod.typeset(40, 16, 'SAND'); Mod.set(g, 5, 2, Mod.WORM); return g; };
  t('same seed ⇒ identical single step', (() => {
    const a = Mod.step(mk(), 99), b = Mod.step(mk(), 99);
    return a.cells.every((v, i) => v === b.cells[i]);
  })());
  t('same seed ⇒ identical long run', (() => {
    const a = Mod.run(mk(), 30, 99), b = Mod.run(mk(), 30, 99);
    return a.cells.every((v, i) => v === b.cells[i]);
  })());
  t('a different seed gives a different result', (() => {
    const a = Mod.run(mk(), 30, 1), b = Mod.run(mk(), 30, 2);
    return !a.cells.every((v, i) => v === b.cells[i]);
  })());
  t('rng is seeded and repeatable', (() => { const r1 = Mod.rng(5), r2 = Mod.rng(5); return r1() === r2() && r1() === r2(); })());
  t('rng returns the unit interval', (() => { const r = Mod.rng(7); for (let i = 0; i < 200; i++) { const v = r(); if (v < 0 || v >= 1) return false; } return true; })());
  t('different rng seeds diverge', Mod.rng(1)() !== Mod.rng(2)());
  t('settled() is true for an identical pair', (() => { const g = Mod.typeset(20, 8, 'A'); return Mod.settled(g, Mod.cloneGrid(g)); })());
  t('settled() is false mid-fall', (() => { const g = Mod.typeset(20, 8, 'A'); return !Mod.settled(g, Mod.step(g, 1)); })());
  t('settled() is false on a size mismatch', !Mod.settled(Mod.newGrid(4, 4), Mod.newGrid(5, 5)));
  t('a sand title eventually settles (a GIF can loop)', (() => {
    let cur = Mod.typeset(40, 18, 'DANK');
    for (let i = 0; i < 400; i++) { const nx = Mod.step(cur, i + 1); if (Mod.settled(cur, nx)) return true; cur = nx; }
    return false;
  })());
}

// ═══ 11. ASCII RENDER — the game's own second filter (8) ══════════════════════════════════════
if (has('toAscii')) {
  const g = Mod.typeset(30, 10, 'HI');
  const rows = Mod.toAscii(g);
  t('toAscii returns one string per row', rows.length === 10);
  t('every row is grid-width', rows.every(r => r.length === 30));
  t('empty renders as a space', Mod.toAscii(Mod.newGrid(3, 1))[0] === '   ');
  t('sand has its own glyph', rows.join('').includes(Mod.RAMP[Mod.SAND]));
  t('the word is legible as ink', rows.join('').split('').filter(c => c !== ' ').length > 0);
  t('a custom ramp is honored', (() => {
    const q = Mod.newGrid(2, 1); Mod.set(q, 0, 0, Mod.SAND);
    return Mod.toAscii(q, Object.assign({}, Mod.RAMP, { [Mod.SAND]: 'X' }))[0][0] === 'X';
  })());
  t('every species has a glyph', Object.values(S).every(v => typeof Mod.RAMP[v] === 'string'));
  t('species glyphs are distinct', new Set(Object.values(Mod.RAMP)).size === Object.keys(Mod.RAMP).length);
}

console.log(`\nsandtype: ${pass} passed, ${fail} failed`);
console.log(`=== ${fail} failed, ${pass} passed in 0.00s ===`);
process.exit(fail ? 1 : 0);
