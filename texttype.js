// texttype.js — TYPOGRAPHY DYNAMICS for the UI: every piece of big text is DEPOSITED.
//
// bigText() in game.js is the single funnel for all large text — the title, boss names, YOU DIED,
// cutscene headers, menu items. This module supplies a per-pixel offset so each glyph falls into
// place grain by grain instead of appearing whole, the same idea as sandtype.js but bounded and
// legible enough for an interface.
//
// THE RULE THAT OUTRANKS THE EFFECT: text is UI. Past SETTLE every pixel is at EXACTLY its target
// with alpha EXACTLY 1, forever. An effect that keeps moving is unreadable, and unreadable menu
// text is a bug wearing a style's clothes. `off:true` disables it entirely, so any surface that
// needs instant legibility can opt out without a second code path.
//
// Pure, deterministic (no Math.random — a replay looks identical), UMD, node-testable.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TextType = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {

  const FALL = 0.42;        // seconds a single pixel spends in the air
  const STAGGER = 0.055;    // seconds between adjacent letters starting
  const RISE = 26;          // pixels above target a grain starts
  const SETTLE = 2.2;       // by here, ANY line of any sane length is fully still

  // deterministic per-pixel scatter — same hash family as the rest of the codebase
  function hash(a, b, c) {
    let h = 2166136261 >>> 0;
    h ^= a + 0x9e37; h = Math.imul(h, 16777619) >>> 0;
    h ^= b + 0x85eb; h = Math.imul(h, 16777619) >>> 0;
    h ^= c + 0xc2b2; h = Math.imul(h, 16777619) >>> 0;
    return (h >>> 0) / 4294967296;
  }

  /** When is a whole line guaranteed still? Callers use this to time a cutscene beat. */
  function lineSettle(len, opts) {
    opts = opts || {};
    const stagger = opts.stagger == null ? STAGGER : opts.stagger;
    const fall = opts.fall == null ? FALL : opts.fall;
    return Math.max(0.05, (Math.max(0, len | 0) + 1) * stagger + fall * 2);
  }

  /**
   * pixelState(li, r, c, age, opts) — where one glyph pixel is right now.
   *   li   letter index in the line (drives the left-to-right sweep)
   *   r,c  row/col inside the 5x5 glyph
   *   age  seconds since the line appeared
   * Returns {dx, dy, a, on} — offsets to ADD to the position game.js already computed.
   */
  function pixelState(li, r, c, age, opts) {
    opts = opts || {};
    if (opts.off) return { dx: 0, dy: 0, a: 1, on: true };

    const fall = opts.fall == null ? FALL : opts.fall;
    const stagger = opts.stagger == null ? STAGGER : opts.stagger;
    const rise = opts.rise == null ? RISE : opts.rise;

    li = Math.max(0, li | 0); r = r | 0; c = c | 0;
    age = Math.max(0, +age || 0);                       // negative/NaN age clamps, never NaN out

    const n = hash(li, r, c);
    // the sweep is left-to-right by letter, with a per-pixel jitter so a glyph doesn't land as a
    // slab — that scatter is the difference between DEPOSITION and a slide transition
    const delay = li * stagger + n * stagger * 1.6 + r * stagger * 0.18;
    const p = (age - delay) / fall;

    if (p >= 1) return { dx: 0, dy: 0, a: 1, on: true }; // EXACT rest — the settle guarantee
    if (p <= 0) return { dx: 0, dy: -rise, a: 0, on: false };

    // ease-out cubic: fast arrival, soft landing. Bounded by construction — dy is rise*(something
    // in [0,1]) so it can never exceed `rise`, which is what keeps text on screen.
    const e = 1 - Math.pow(1 - p, 3);
    const dy = -rise * (1 - e);
    const dx = (n - 0.5) * 2.4 * (1 - e);               // a hair of lateral drift, ≤1.2px
    return { dx, dy, a: e, on: true };
  }

  return { pixelState, lineSettle, SETTLE, FALL, STAGGER, RISE, hash };
});
