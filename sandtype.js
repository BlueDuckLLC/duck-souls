// sandtype.js — TYPOGRAPHY DYNAMICS: letters as falling-sand cellular automata.
//
// The idea: a word is not drawn, it is DEPOSITED. Every glyph is a pile of grains obeying the
// same physics-pixel rules we learned from the sand box — sand slumps, water levels, moss creeps
// along whatever it touches, worms burrow through solids and leave tunnels, crabs walk the surface
// and carry a grain sideways. Type a word in SAND and it slumps into a dune. Type it in STONE and
// let MOSS in at one corner and the word greens over from that corner outward. Let a WORM in and
// the counters get eaten from the inside.
//
// Pure, deterministic, zero-dependency, UMD, node-testable — same discipline as boss.js/combat.js.
// The renderer (GIF, canvas, ASCII) is somebody else's problem; this file only owns the substrate.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SandType = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {

  // ---- SPECIES -------------------------------------------------------------------------------
  // Ordered so that a higher id never "sees" a lower one as empty. EMPTY must be 0.
  const EMPTY = 0, SAND = 1, WATER = 2, STONE = 3, MOSS = 4, WORM = 5, CRAB = 6, VOID = 7;
  const SPECIES = { EMPTY, SAND, WATER, STONE, MOSS, WORM, CRAB, VOID };
  const NAMES = ['EMPTY', 'SAND', 'WATER', 'STONE', 'MOSS', 'WORM', 'CRAB', 'VOID'];

  // A cell is SOLID if a walker can stand on it and moss can root in it.
  const SOLIDS = new Set([SAND, STONE, MOSS]);
  const isSolid = c => SOLIDS.has(c);
  // MOVABLE cells fall under gravity. STONE does not; MOSS is rooted; VOID is a hole.
  const MOVABLE = new Set([SAND, WATER]);
  const isMovable = c => MOVABLE.has(c);

  // ---- 5x7 FONT ------------------------------------------------------------------------------
  // Hand-set so every glyph has a closed counter or a clear spine — the features a worm can eat
  // and moss can trace. Rows top→bottom, '#' = ink.
  const FONT = {
    'A': ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    'B': ['####.', '#...#', '####.', '#...#', '#...#', '#...#', '####.'],
    'C': ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
    'D': ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
    'E': ['#####', '#....', '####.', '#....', '#....', '#....', '#####'],
    'F': ['#####', '#....', '####.', '#....', '#....', '#....', '#....'],
    'G': ['.####', '#....', '#....', '#..##', '#...#', '#...#', '.###.'],
    'H': ['#...#', '#...#', '#####', '#...#', '#...#', '#...#', '#...#'],
    'I': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
    'J': ['#####', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
    'K': ['#...#', '#..#.', '##...', '#.#..', '#..#.', '#...#', '#...#'],
    'L': ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
    'M': ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
    'N': ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
    'O': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    'P': ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
    'Q': ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
    'R': ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    'S': ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
    'T': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    'U': ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    'V': ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
    'W': ['#...#', '#...#', '#...#', '#...#', '#.#.#', '##.##', '#...#'],
    'X': ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
    'Y': ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
    'Z': ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
    '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
    '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
    '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
    '4': ['#..#.', '#..#.', '#..#.', '#####', '...#.', '...#.', '...#.'],
    '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
    '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
    '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
    '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
    '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
    ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
    '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
    '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
    '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
    '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
    ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
    "'": ['..#..', '..#..', '.....', '.....', '.....', '.....', '.....'],
  };
  const GLYPH_W = 5, GLYPH_H = 7;

  // ---- GRID ----------------------------------------------------------------------------------
  function newGrid(w, h, fill) {
    w = Math.max(1, w | 0); h = Math.max(1, h | 0);
    return { w, h, cells: new Uint8Array(w * h).fill(fill || EMPTY) };
  }
  function inBounds(g, x, y) { return x >= 0 && y >= 0 && x < g.w && y < g.h; }
  function get(g, x, y) { return inBounds(g, x, y) ? g.cells[y * g.w + x] : STONE; }  // OOB = wall
  function set(g, x, y, v) { if (inBounds(g, x, y)) g.cells[y * g.w + x] = v; return g; }
  function cloneGrid(g) { return { w: g.w, h: g.h, cells: Uint8Array.from(g.cells) }; }
  function count(g, species) {
    let n = 0;
    for (let i = 0; i < g.cells.length; i++) if (g.cells[i] === species) n++;
    return n;
  }

  // ---- TYPESETTING ---------------------------------------------------------------------------
  // measure/stamp are separate so a caller can centre a word before it exists as grains.
  function measure(text, opts) {
    opts = opts || {};
    const scale = Math.max(1, opts.scale | 0 || 1), track = opts.track == null ? 1 : opts.track | 0;
    const s = String(text == null ? '' : text).toUpperCase();
    if (!s.length) return { w: 0, h: GLYPH_H * scale, n: 0 };
    return { w: s.length * GLYPH_W * scale + (s.length - 1) * track * scale, h: GLYPH_H * scale, n: s.length };
  }

  /** Stamp text into the grid as grains of `species`. Unknown characters render as a space, so a
   *  stray character can never throw mid-animation. Returns the number of grains deposited. */
  function stamp(g, text, x, y, species, opts) {
    opts = opts || {};
    const scale = Math.max(1, opts.scale | 0 || 1), track = opts.track == null ? 1 : opts.track | 0;
    const sp = species == null ? SAND : species;
    const s = String(text == null ? '' : text).toUpperCase();
    let cx = x | 0, laid = 0;
    for (const ch of s) {
      const glyph = FONT[ch] || FONT[' '];
      for (let gy = 0; gy < GLYPH_H; gy++) {
        for (let gx = 0; gx < GLYPH_W; gx++) {
          if (glyph[gy][gx] !== '#') continue;
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              const px = cx + gx * scale + sx, py = (y | 0) + gy * scale + sy;
              if (inBounds(g, px, py)) { set(g, px, py, sp); laid++; }
            }
          }
        }
      }
      cx += (GLYPH_W + track) * scale;
    }
    return laid;
  }

  /** Convenience: a centred line of text on a fresh grid. The common case for a title card. */
  function typeset(w, h, text, opts) {
    opts = opts || {};
    const g = newGrid(w, h);
    const m = measure(text, opts);
    const x = opts.x == null ? Math.floor((w - m.w) / 2) : opts.x | 0;
    const y = opts.y == null ? Math.floor((h - m.h) / 2) : opts.y | 0;
    stamp(g, text, x, y, opts.species == null ? SAND : opts.species, opts);
    return g;
  }

  // ---- RNG (deterministic, seeded — no Math.random anywhere in this file) ---------------------
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // ---- THE RULES -----------------------------------------------------------------------------
  // One pass, BOTTOM-UP (so a falling grain cannot be moved twice in a tick), with per-row
  // alternating scan direction to kill the left-drift bias a naive left-to-right sweep produces.

  function stepSand(g, next, x, y, r) {
    const below = get(next, x, y + 1);
    if (below === EMPTY || below === WATER) {                  // sand sinks through water
      set(next, x, y, below === WATER ? WATER : EMPTY);
      set(next, x, y + 1, SAND);
      return true;
    }
    const dir = r() < 0.5 ? -1 : 1;                            // slump to the angle of repose
    for (const d of [dir, -dir]) {
      if (get(next, x + d, y + 1) === EMPTY && get(next, x + d, y) === EMPTY) {
        set(next, x, y, EMPTY); set(next, x + d, y + 1, SAND);
        return true;
      }
    }
    return false;
  }

  function stepWater(g, next, x, y, r) {
    if (get(next, x, y + 1) === EMPTY) {
      set(next, x, y, EMPTY); set(next, x, y + 1, WATER);
      return true;
    }
    const dir = r() < 0.5 ? -1 : 1;                            // then it levels
    for (const d of [dir, -dir]) {
      if (get(next, x + d, y + 1) === EMPTY) { set(next, x, y, EMPTY); set(next, x + d, y + 1, WATER); return true; }
      if (get(next, x + d, y) === EMPTY) { set(next, x, y, EMPTY); set(next, x + d, y, WATER); return true; }
    }
    return false;
  }

  /** MOSS creeps: it only colonises a cell ADJACENT to something solid, so it traces the outline
   *  of a word instead of blooming into the air. This is what makes it read as typography. */
  function stepMoss(g, next, x, y, r, p) {
    if (r() > (p == null ? 0.08 : p)) return false;
    const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    const d = dirs[(r() * 4) | 0];
    const tx = x + d[0], ty = y + d[1];
    if (!inBounds(next, tx, ty) || get(next, tx, ty) !== EMPTY) return false;
    let rooted = false;                                        // must touch a solid to take hold
    for (const e of dirs) if (isSolid(get(next, tx + e[0], ty + e[1]))) { rooted = true; break; }
    if (!rooted) return false;
    set(next, tx, ty, MOSS);
    return true;
  }

  /** WORM burrows through solids and leaves VOID behind — it eats counters out of letters. It
   *  prefers to keep going straight, which is why the tunnels read as tunnels and not as rot. */
  function stepWorm(g, next, x, y, r, headings) {
    const key = y * g.w + x;
    let h = headings.get(key);
    if (h === undefined) h = (r() * 4) | 0;
    const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    if (r() < 0.18) h = (h + (r() < 0.5 ? 1 : 3)) % 4;         // occasional turn
    for (let attempt = 0; attempt < 4; attempt++) {
      const d = dirs[h];
      const tx = x + d[0], ty = y + d[1];
      if (inBounds(next, tx, ty)) {
        const t = get(next, tx, ty);
        if (t !== WORM && t !== CRAB && t !== STONE) {
          set(next, x, y, VOID);                               // the tunnel it leaves
          set(next, tx, ty, WORM);
          headings.delete(key);
          headings.set(ty * g.w + tx, h);
          return true;
        }
      }
      h = (h + 1) % 4;
    }
    headings.set(key, h);
    return false;
  }

  /** CRAB walks the SURFACE of solids and carries one grain sideways — the slow redistribution
   *  that makes a settled word keep breathing instead of freezing. */
  function stepCrab(g, next, x, y, r, headings) {
    const key = y * g.w + x;
    let dir = headings.get(key);
    if (dir === undefined) dir = r() < 0.5 ? -1 : 1;
    if (!isSolid(get(next, x, y + 1))) {                       // no floor: fall
      if (get(next, x, y + 1) === EMPTY) {
        set(next, x, y, EMPTY); set(next, x, y + 1, CRAB);
        headings.delete(key); headings.set((y + 1) * g.w + x, dir);
        return true;
      }
      return false;
    }
    let tx = x + dir, ty = y;
    if (get(next, tx, ty) !== EMPTY) {                          // wall — try to climb, else turn
      if (get(next, tx, ty - 1) === EMPTY && inBounds(next, tx, ty - 1)) ty = y - 1;
      else { headings.set(key, -dir); return false; }
    }
    if (!inBounds(next, tx, ty) || get(next, tx, ty) !== EMPTY) { headings.set(key, -dir); return false; }
    const carried = get(next, x, y - 1) === SAND;               // pick up the grain above it
    if (carried) set(next, x, y - 1, EMPTY);
    set(next, x, y, EMPTY);
    set(next, tx, ty, CRAB);
    if (carried && get(next, tx, ty - 1) === EMPTY) set(next, tx, ty - 1, SAND);
    headings.delete(key);
    headings.set(ty * g.w + tx, dir);
    return true;
  }

  /** One tick. PURE: returns a new grid, never mutates the input. `state` carries walker headings
   *  between ticks; omit it and walkers simply re-pick a heading each tick. */
  function step(g, seed, opts) {
    opts = opts || {};
    const next = cloneGrid(g);
    const r = rng((seed | 0) || 1);
    const headings = (opts.state && opts.state.headings) || new Map();
    const mossP = opts.mossP == null ? 0.08 : opts.mossP;
    for (let y = g.h - 1; y >= 0; y--) {
      const ltr = (y + (seed | 0)) % 2 === 0;                   // alternate scan direction per row
      for (let i = 0; i < g.w; i++) {
        const x = ltr ? i : g.w - 1 - i;
        switch (get(next, x, y)) {
          case SAND: stepSand(g, next, x, y, r); break;
          case WATER: stepWater(g, next, x, y, r); break;
          case MOSS: stepMoss(g, next, x, y, r, mossP); break;
          case WORM: stepWorm(g, next, x, y, r, headings); break;
          case CRAB: stepCrab(g, next, x, y, r, headings); break;
          default: break;                                       // EMPTY / STONE / VOID are inert
        }
      }
    }
    if (opts.state) opts.state.headings = headings;
    return next;
  }

  /** Run n ticks. Convenience for tests and for pre-rolling a title card to a settled state. */
  function run(g, ticks, seed, opts) {
    opts = opts || {};
    const state = opts.state || { headings: new Map() };
    let cur = g;
    for (let i = 0; i < (ticks | 0); i++) {
      cur = step(cur, (seed | 0) + i, Object.assign({}, opts, { state }));
    }
    return cur;
  }

  /** settled(a, b) — has the simulation stopped moving? The loop-point detector for a GIF. */
  function settled(a, b) {
    if (!a || !b || a.cells.length !== b.cells.length) return false;
    for (let i = 0; i < a.cells.length; i++) if (a.cells[i] !== b.cells[i]) return false;
    return true;
  }

  // ---- RENDER (ASCII — the game's own second filter) ------------------------------------------
  const RAMP = { [EMPTY]: ' ', [SAND]: ':', [WATER]: '~', [STONE]: '#', [MOSS]: '*', [WORM]: 'o', [CRAB]: '%', [VOID]: '.' };
  function toAscii(g, ramp) {
    const R = ramp || RAMP;
    const out = [];
    for (let y = 0; y < g.h; y++) {
      let line = '';
      for (let x = 0; x < g.w; x++) line += R[get(g, x, y)] || ' ';
      out.push(line);
    }
    return out;
  }

  return {
    SPECIES, NAMES, EMPTY, SAND, WATER, STONE, MOSS, WORM, CRAB, VOID,
    FONT, GLYPH_W, GLYPH_H,
    newGrid, get, set, cloneGrid, count, inBounds, isSolid, isMovable,
    measure, stamp, typeset, rng,
    step, run, settled, toAscii, RAMP,
  };
});
