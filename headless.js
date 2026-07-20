// headless.js — the canvas-free sim core for DUCK SOULS (Phase A of RL_FUN.md).
// Loads the REAL game.js under a no-op render/audio shim (game exposes window.G + window.keys
// "for the bot harness and headless verification"), and exposes a Gym-style API so tests, bots,
// and RL agents share ONE fast environment. A step is pure sim (updatePlay) — NO 160x90 render.
//
// Determinism: Math.random is replaced by a seeded mulberry32 so episodes reproduce.
// Usage (node):
//   const { Env } = require('./headless.js');
//   const env = new Env();               // loads game.js once
//   env.reset(1234);                      // fresh run on a seed
//   const obs = env.observe();            // Float64Array
//   const { done, reward } = env.step(6); // action 6 = attack; returns transition
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = __dirname;

// ---- browser shim (promoted from boss_smoke.js) ----
function ctx2d() {
  const noop = () => {}; const grad = { addColorStop: noop };
  return new Proxy({}, { get(_, k) {
    if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(((w | 0) || 1) * ((h | 0) || 1) * 4) });
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
    if (k === 'measureText') return () => ({ width: 4 });
    if (k === 'canvas') return { width: 1280, height: 720 };
    return noop;
  } });
}
function canvas() { return { width: 1280, height: 720, getContext: () => ctx2d(), style: {}, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) }; }

// a seedable PRNG we can install as Math.random for reproducible episodes
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const COLS = 160, ROWS = 90;
const ACTIONS = ['idle', 'left', 'right', 'up', 'down', 'attack', 'dash', 'use']; // 8 discrete
const MOVE_KEY = { left: 'arrowleft', right: 'arrowright', up: 'arrowup', down: 'arrowdown' };

class Env {
  constructor() {
    this._rand = Math.random;
    const RM = this._realMath = Object.create(Math);
    const sb = this.sb = {
      console, Math: RM, Date, JSON, Array, Object, String, Number, Boolean, RegExp, Set, Map,
      isNaN, parseInt, parseFloat, Uint8ClampedArray, Uint8Array, Uint32Array, Float32Array,
      performance: { now: () => this._simMs },
      document: { getElementById: () => canvas(), createElement: () => canvas(), addEventListener() {}, body: { appendChild() {} } },
      localStorage: (() => { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => s[k] = String(v), removeItem: k => delete s[k] }; })(),
      requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
      setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
      AudioContext: function () { return { createOscillator: () => ({ connect() {}, start() {}, stop() {}, frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, type: '' }), createGain: () => ({ connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, value: 0 } }), destination: {}, currentTime: 0 }; },
      Image: function () { return { addEventListener() {}, set src(v) {} }; },
      addEventListener() {}, location: { search: '' },
    };
    sb.window = sb; sb.globalThis = sb; sb.self = sb; sb.webkitAudioContext = sb.AudioContext;
    // seed BEFORE loading (newRun/genFloor at boot consume randomness). Reseeded per reset().
    this._seedMath(1);
    vm.createContext(sb);
    this._simMs = 0;
    for (const f of ['ascii.js', 'params.js', 'pantheon.js', 'combat.js', 'boss.js', 'game.js']) {
      vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), sb, { filename: f });
    }
    // draws are pure render — no-op them so any code path that calls them stays cheap
    for (const d of ['drawWorld', 'drawHud', 'render']) if (typeof sb[d] === 'function') sb[d] = () => {};
    if (sb.A) sb.A.render = () => {};
  }
  _seedMath(seed) { const r = mulberry32((seed >>> 0) || 1); this._realMath.random = r; }

  // --- lifecycle ---
  reset(seed = 1) {
    this._seedMath(seed);
    this._simMs = 0; this._steps = 0;
    this.sb.newRun();                 // jump straight into a fresh run (skips menus)
    this._advance();                  // fast-forward any transition into 'play'
    this._prevScore = this._score();
    return this.observe();
  }

  // fast-forward non-play states deterministically (draws that hold transition logic are skipped)
  _advance(cap = 40) {
    const G = this.sb.G;
    for (let i = 0; i < cap; i++) {
      const s = G.state;
      if (s === 'play' || s === 'dead') return;
      if (s === 'pool' || s === 'trance') { this.sb.enterBossArena(); }
      else if (s === 'judgment') { this.sb.nextFloor(); }
      else if (s === 'descend') { this.sb.genFloor(); G.state = 'play'; }
      else { this.sb.newRun(); }       // title/intro/howto/lore/gallery/cinema/credits/bestiary
    }
  }

  // --- stepping ---
  // one action held for `frames` sim frames (frameskip = temporal abstraction). Pure sim.
  step(actionIdx, frames = 4, dt = 1 / 60) {
    const G = this.sb.G, keys = this.sb.keys;
    const a = ACTIONS[actionIdx] || 'idle';
    // clear all held inputs, then set this action's
    for (const k of ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'x', ' ', 'z', 'shift', 'c']) keys[k] = false;
    if (MOVE_KEY[a]) keys[MOVE_KEY[a]] = true;
    if (a === 'attack') keys['x'] = true;
    if (a === 'dash') keys['z'] = true;
    if (a === 'use') { try { this.sb.onKey('c'); } catch (e) {} }
    for (let f = 0; f < frames; f++) {
      this._simMs += dt * 1000; G.t += dt;
      if (G.hitstop > 0) G.hitstop -= dt;
      else if (G.state === 'play') { try { this.sb.updatePlay(dt); } catch (e) { this._err = String(e && e.message); } }
      if (G.state !== 'play') break;   // died or hit a transition
    }
    if (G.state !== 'play' && G.state !== 'dead') this._advance();
    this._steps++;
    const score = this._score();
    const reward = score - this._prevScore; this._prevScore = score;
    return { obs: this.observe(), reward, done: this.done(), score, depth: G.run ? G.run.floors : 0 };
  }

  done() { const G = this.sb.G; return G.state === 'dead' || this._steps > 4000; }
  _score() { const G = this.sb.G; if (!G.run) return 0; return (G.run.floors || 0) * 100 + (G.run.kills || 0) * 5 + (G.run.score || 0) * 0.1; }
  score() { return this._score(); }

  // --- observation: a compact normalized vector the policy reads ---
  observe() {
    const G = this.sb.G, p = G.player || {}, o = [];
    const px = (p.x || 0) / COLS, py = (p.y || 0) / ROWS;
    o.push((p.hp || 0) / (p.maxhp || 4), px, py,
      Math.max(0, p.dashCd || 0), Math.max(0, p.dashT || 0), Math.max(0, p.invulnT || 0), Math.max(0, p.atkCd || 0));
    // nearest 3 enemies: rel dx, dy, dist
    const es = (G.enemies || []).filter(e => !e.dead).map(e => ({ e, d: Math.hypot((e.x - p.x) || 0, (e.y - p.y) || 0) })).sort((a, b) => a.d - b.d);
    for (let i = 0; i < 3; i++) { const it = es[i]; if (it) o.push((it.e.x - p.x) / COLS, (it.e.y - p.y) / ROWS, Math.min(1, it.d / 80)); else o.push(0, 0, 1); }
    // nearest 2 enemy bolts (incoming threat)
    const bs = (G.bolts || []).map(b => ({ b, d: Math.hypot((b.x - p.x) || 0, (b.y - p.y) || 0) })).sort((a, b) => a.d - b.d);
    for (let i = 0; i < 2; i++) { const it = bs[i]; if (it) o.push((it.b.x - p.x) / COLS, (it.b.y - p.y) / ROWS); else o.push(0, 0); }
    // boss: present, form, orbs, open, rel pos
    const b = G.boss;
    if (b && b.def) { o.push(1, (b.st ? b.st.form : 0) / 3, (b.st ? b.st.orbs : 0) / 6, b.orbsOpen === false ? 0 : 1, ((b.x || 0) - p.x) / COLS, ((b.y || 0) - p.y) / ROWS); }
    else o.push(0, 0, 0, 0, 0, 0);
    // context
    o.push(Math.min(1, (G.depth || 0) / 10), G.cur && G.cur.cleared ? 1 : 0, Math.min(1, (G.enemies || []).length / 8), G.locked ? 1 : 0);
    return o; // length = 7 + 9 + 4 + 6 + 4 = 30
  }

  get actionCount() { return ACTIONS.length; }
  get obsSize() { return this.observe().length; }
  get state() { return this.sb.G.state; }
}

module.exports = { Env, ACTIONS };

// CLI: `node headless.js bench` (throughput) or `node headless.js determinism`
if (require.main === module) {
  const mode = process.argv[2] || 'bench';
  if (mode === 'determinism') {
    const runTrace = (seed) => { const e = new Env(); e.reset(seed); const acts = []; let r = mulberry32(seed * 3 + 1); for (let i = 0; i < 200; i++) { const a = (r() * 8) | 0; acts.push(a); e.step(a); } return e.score() + '|' + e.state; };
    const a = runTrace(42), b = runTrace(42), c = runTrace(43);
    console.log('seed42 run1:', a); console.log('seed42 run2:', b); console.log('seed43    :', c);
    console.log(a === b ? 'DETERMINISTIC (same seed -> same trajectory)' : 'NON-DETERMINISTIC (FAIL)');
    console.log(a !== c ? 'seeds diverge (good)' : 'seeds identical (suspicious)');
    process.exit(a === b ? 0 : 1);
  } else {
    const env = new Env();
    const t0 = Date.now(); let steps = 0, eps = 0; let r = mulberry32(7);
    for (let ep = 0; ep < 20; ep++) { env.reset(ep + 1); eps++; for (let i = 0; i < 500; i++) { env.step((r() * 8) | 0); steps++; if (env.done()) break; } }
    const secs = (Date.now() - t0) / 1000;
    console.log(`obs=${env.obsSize} actions=${env.actionCount}`);
    console.log(`${eps} episodes, ${steps} steps in ${secs.toFixed(2)}s → ${(steps / secs | 0)} steps/s, ${(steps * 4 / secs | 0)} sim-frames/s`);
  }
}
