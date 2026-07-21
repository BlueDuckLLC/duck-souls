// Headless smoke: load duck-souls scripts, drive many random boss fights, assert no throw.
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = process.argv[2] || __dirname;
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
const store = {};
const sandbox = {
  console, Math, Date, JSON, Array, Object, String, Number, Boolean, Set, Map, RegExp, isNaN, parseInt, parseFloat,
  Uint8ClampedArray, Uint8Array, Uint32Array, Float32Array, performance: { now: () => Date.now() },
  document: { getElementById: () => canvas(), createElement: () => canvas(), addEventListener() {}, body: { appendChild() {} } },
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => store[k] = String(v), removeItem: k => delete store[k] },
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  AudioContext: function () { return { createOscillator: () => ({ connect() {}, start() {}, stop() {}, frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, type: '' }), createGain: () => ({ connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, value: 0 } }), destination: {}, currentTime: 0 }; },
  Image: function () { return { addEventListener() {}, set src(v) {} }; },
  addEventListener() {}, location: { search: '' },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
sandbox.webkitAudioContext = sandbox.AudioContext;
vm.createContext(sandbox);
for (const f of ['ascii.js', 'params.js', 'pantheon.js', 'combat.js', 'boss.js', 'game.js']) {
  try { vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), sandbox, { filename: f }); }
  catch (e) { console.error('LOAD FAIL in ' + f + ': ' + (e.stack || e.message)); process.exit(1); }
}
console.log('scripts loaded + booted OK');
let frames = 0;
try {
  for (let run = 0; run < 80; run++) {
    sandbox.newRun();
    sandbox.startBossFight();
    for (let i = 0; i < 2000; i++) { sandbox.updateBoss(1 / 60); frames++; }
  }
  console.log('OK: 80 random boss fights x 2000 frames = ' + frames + ' boss frames, no throw');
} catch (e) { console.error('RUNTIME FAIL: ' + (e.stack || e.message)); process.exit(2); }
console.log('SMOKE PASS');
