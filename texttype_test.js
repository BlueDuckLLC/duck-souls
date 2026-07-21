// texttype_test.js — every piece of big text in the game is DEPOSITED, not drawn.
//
// bigText() is the single funnel for all large text (title, boss names, YOU DIED, cutscene
// headers, menus). This module supplies the per-pixel offset that makes each glyph fall into
// place like sand instead of appearing whole. Pure so it can be certified; game.js only adds
// dx/dy/alpha to a rect() call it was already making.
//
// THE LOAD-BEARING CONSTRAINT: text is UI. It must become perfectly still and fully opaque at a
// known time and STAY there. An effect that never settles is unreadable, and unreadable text in
// a menu is a bug, not a style. Half these assertions exist to pin that down.
const Mod = (() => { try { return require('./texttype.js'); } catch (e) { return {}; } })();
const has = f => typeof Mod[f] === 'function';

let pass = 0, fail = 0;
function t(name, cond) { if (cond) pass++; else { fail++; console.error('FAIL: ' + name); } }

const P = (li, r, c, age, opts) => has('pixelState') ? Mod.pixelState(li, r, c, age, opts) : null;

// ── shape of the API ─────────────────────────────────────────────────────────────────────────
t('pixelState exposed', has('pixelState'));
t('SETTLE constant exposed', typeof Mod.SETTLE === 'number');
t('lineSettle exposed', has('lineSettle'));
if (has('pixelState')) {
  const s = P(0, 0, 0, 0);
  t('returns dx', s && typeof s.dx === 'number');
  t('returns dy', s && typeof s.dy === 'number');
  t('returns alpha', s && typeof s.a === 'number');
  t('returns on/off', s && typeof s.on === 'boolean');
}

// ── the settle guarantee — the whole reason this is testable ─────────────────────────────────
if (has('pixelState') && typeof Mod.SETTLE === 'number') {
  const LATE = Mod.SETTLE + 5;
  let allZero = true, allOpaque = true, allOn = true;
  for (let li = 0; li < 12; li++) for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
    const s = P(li, r, c, LATE);
    if (s.dx !== 0 || s.dy !== 0) allZero = false;
    if (s.a !== 1) allOpaque = false;
    if (!s.on) allOn = false;
  }
  t('SETTLED: every pixel offset is EXACTLY zero', allZero);
  t('SETTLED: every pixel is fully opaque', allOpaque);
  t('SETTLED: every pixel is on', allOn);
  t('settled state is stable — later is still zero', (() => {
    for (const age of [LATE, LATE + 10, LATE + 1000]) {
      const s = P(3, 2, 2, age);
      if (s.dx !== 0 || s.dy !== 0 || s.a !== 1) return false;
    }
    return true;
  })());
  t('lineSettle grows with line length', Mod.lineSettle(1) <= Mod.lineSettle(20));
  t('lineSettle is finite for a long line', Number.isFinite(Mod.lineSettle(200)));
  t('lineSettle(0) is still positive', Mod.lineSettle(0) > 0);
}

// ── arrival: pixels FALL IN from above ───────────────────────────────────────────────────────
if (has('pixelState')) {
  t('at age 0 a pixel is displaced', (() => { const s = P(0, 0, 0, 0); return s.dy !== 0 || !s.on; })());
  t('early displacement is ABOVE the target (it falls DOWN)', (() => {
    let above = 0, below = 0;
    for (let li = 0; li < 8; li++) for (let r = 0; r < 5; r++) {
      const s = P(li, r, 2, 0.02);
      if (s.dy < 0) above++; else if (s.dy > 0) below++;
    }
    return above > below;
  })());
  t('displacement shrinks as age grows', (() => {
    const a = Math.abs(P(2, 1, 1, 0.05).dy), b = Math.abs(P(2, 1, 1, 0.5).dy);
    return b <= a;
  })());
  t('alpha rises as age grows', P(2, 1, 1, 0.05).a <= P(2, 1, 1, 0.6).a);
  t('alpha is never above 1', (() => {
    for (let age = 0; age < 4; age += 0.05) if (P(1, 1, 1, age).a > 1) return false;
    return true;
  })());
  t('alpha is never below 0', (() => {
    for (let age = 0; age < 4; age += 0.05) if (P(1, 1, 1, age).a < 0) return false;
    return true;
  })());
  t('a negative age is clamped, not NaN', (() => { const s = P(0, 0, 0, -5); return Number.isFinite(s.dy) && Number.isFinite(s.a); })());
}

// ── bounded: text must never fly off screen ──────────────────────────────────────────────────
if (has('pixelState')) {
  t('|dy| is bounded across the whole animation', (() => {
    for (let li = 0; li < 16; li++) for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++)
      for (let age = 0; age < 3; age += 0.05)
        if (Math.abs(P(li, r, c, age).dy) > 40) return false;
    return true;
  })());
  t('|dx| is bounded and small (text must not smear sideways)', (() => {
    for (let li = 0; li < 16; li++) for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++)
      for (let age = 0; age < 3; age += 0.05)
        if (Math.abs(P(li, r, c, age).dx) > 4) return false;
    return true;
  })());
  t('every value is finite for every input', (() => {
    for (let li = 0; li < 10; li++) for (let age = 0; age < 3; age += 0.1) {
      const s = P(li, 3, 3, age);
      if (!Number.isFinite(s.dx) || !Number.isFinite(s.dy) || !Number.isFinite(s.a)) return false;
    }
    return true;
  })());
}

// ── stagger: this is what makes it read as DEPOSITION, not a slide ───────────────────────────
if (has('pixelState')) {
  t('pixels do NOT all land at once', (() => {
    const at = age => { let landed = 0; for (let li = 0; li < 8; li++) for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) if (P(li, r, c, age).dy === 0) landed++; return landed; };
    const mid = at(0.35);
    return mid > 0 && mid < 8 * 25;
  })());
  t('later letters land after earlier ones', (() => {
    let firstDone = 0, lastDone = 0;
    for (let age = 0; age < 4; age += 0.02) {
      if (!firstDone && P(0, 2, 2, age).dy === 0) firstDone = age;
      if (!lastDone && P(9, 2, 2, age).dy === 0) lastDone = age;
    }
    return firstDone > 0 && lastDone > 0 && lastDone >= firstDone;
  })());
  t('different pixels in one glyph differ mid-flight', (() => {
    const a = P(0, 0, 0, 0.1).dy, b = P(0, 4, 4, 0.1).dy;
    return a !== b;
  })());
}

// ── determinism: no Math.random, so a replay looks identical ─────────────────────────────────
if (has('pixelState')) {
  t('same inputs give the same output', (() => {
    const a = P(3, 2, 1, 0.22), b = P(3, 2, 1, 0.22);
    return a.dx === b.dx && a.dy === b.dy && a.a === b.a;
  })());
  t('different pixels give different arrivals', (() => {
    const seen = new Set();
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) seen.add(P(0, r, c, 0.12).dy);
    return seen.size > 1;
  })());
  t('the module holds no Math.random', !/Math\.random/.test(require('fs').readFileSync(__dirname + '/texttype.js', 'utf8')));
}

// ── options: a caller can turn it off or retune it ───────────────────────────────────────────
if (has('pixelState')) {
  t('opts.off disables the effect entirely', (() => {
    const s = P(0, 0, 0, 0, { off: true });
    return s.dx === 0 && s.dy === 0 && s.a === 1 && s.on === true;
  })());
  t('opts.rise scales the fall distance', (() => {
    const small = Math.abs(P(0, 0, 0, 0.02, { rise: 4 }).dy);
    const big = Math.abs(P(0, 0, 0, 0.02, { rise: 40 }).dy);
    return big > small;
  })());
  t('opts.stagger 0 lands everything together', (() => {
    const s0 = P(0, 0, 0, 0.5, { stagger: 0 }), s9 = P(9, 4, 4, 0.5, { stagger: 0 });
    return (s0.dy === 0) === (s9.dy === 0);
  })());
  t('a huge stagger still settles by lineSettle', (() => {
    const opts = { stagger: 0.5 };
    const end = Mod.lineSettle(10, opts) + 0.1;
    for (let li = 0; li < 10; li++) if (P(li, 2, 2, end, opts).dy !== 0) return false;
    return true;
  })());
}

console.log(`\ntexttype: ${pass} passed, ${fail} failed`);
console.log(`=== ${fail} failed, ${pass} passed in 0.00s ===`);
process.exit(fail ? 1 : 0);
