// game.js — DUCK SOULS. Fast-paced ASCII roguelite judged by a pantheon.
// Everything world-side is drawn in pixels onto the Asciifier's scene canvas
// (1px = 1 char cell) and passes through the video->ASCII filter each frame.
window.addEventListener('error', e => (window.__errs = window.__errs || []).push(String(e.message)));

const COLS = 160, ROWS = 90, CELL = 8;
const A = new Asciifier(document.getElementById('screen'), COLS, ROWS, CELL);
const S = A.sctx;
const P = window.Pantheon;

// arena bounds (rows 0-3 reserved for HUD)
const X0 = 1, X1 = COLS - 2, Y0 = 5, Y1 = ROWS - 2;
const DOOR = 7; // door gap size

// ---------- named effect magnitudes (every key here is a real, applied effect;
// test.js verifies each boon/curse key is consumed below) ----------
const FX = {
  BOON_VELOX: 1.14,  // move speed multiplier
  CURSE_VELOX: 2.0,  // extra seconds doors stay barred after clear
  BOON_PLUMA: 1,     // +slash damage
  CURSE_PLUMA: 1,    // extra duck-dragons per room
  BOON_UMBRA: 1,     // +max HP
  CURSE_UMBRA: 1.4,  // dash cooldown multiplier
  BOON_AURUM: 2.5,   // drop chance multiplier
  CURSE_AURUM: 0,    // drop chance multiplier (nothing drops)
  BOON_MORS: 1,      // deaths refused per run
  CURSE_MORS: 0,     // heart heal multiplier (hearts heal nothing)
};

// ---------- rng ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ---------- input ----------
const keys = {};
window.addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  keys[e.key.toLowerCase()] = true;
  onKey(e.key.toLowerCase());
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
function inputVec() {
  let x = 0, y = 0;
  if (keys['arrowleft'] || keys['a']) x -= 1;
  if (keys['arrowright'] || keys['d']) x += 1;
  if (keys['arrowup'] || keys['w']) y -= 1;
  if (keys['arrowdown'] || keys['s']) y += 1;
  const m = Math.hypot(x, y);
  return m ? { x: x / m, y: y / m } : { x: 0, y: 0 };
}

// ---------- audio (tiny synth) ----------
let AC = null, muted = false;
function tone(f0, f1, dur, type = 'square', vol = 0.1, delay = 0) {
  if (muted) return;
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; } }
  const t0 = AC.currentTime + delay;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(1, f0), t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(AC.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
}
const SFX = {
  slash: () => tone(700, 180, 0.07, 'square', 0.06),
  hit: () => tone(220, 90, 0.07, 'square', 0.1),
  kill: () => { tone(160, 40, 0.18, 'sawtooth', 0.12); tone(90, 30, 0.25, 'square', 0.08, 0.03); },
  hurt: () => { tone(120, 40, 0.25, 'sawtooth', 0.16); },
  dash: () => tone(300, 600, 0.08, 'triangle', 0.05),
  pickup: () => { tone(660, 880, 0.09, 'triangle', 0.08); tone(880, 1320, 0.12, 'triangle', 0.07, 0.08); },
  door: () => tone(180, 320, 0.2, 'triangle', 0.08),
  stairs: () => { [330, 440, 550, 660].forEach((f, i) => tone(f, f * 1.2, 0.12, 'triangle', 0.07, i * 0.08)); },
  judge: () => { tone(110, 108, 0.6, 'sawtooth', 0.06); tone(165, 163, 0.6, 'sawtooth', 0.04, 0.05); },
  die: () => { [200, 150, 100, 60].forEach((f, i) => tone(f, f * 0.7, 0.3, 'sawtooth', 0.12, i * 0.18)); },
  cheat: () => { tone(60, 800, 0.5, 'sawtooth', 0.14); },
};

// ---------- scene drawing helpers ----------
function ink(ci, a) { S.globalAlpha = Math.max(0, Math.min(1, a)); S.fillStyle = PAL[ci]; }
function px(x, y, ci, a) { ink(ci, a); S.fillRect(x | 0, y | 0, 1, 1); }
function rect(x, y, w, h, ci, a) { ink(ci, a); S.fillRect(x | 0, y | 0, w, h); }

// 5x5 block font, drawn into the scene so titles pass through the ASCII filter
const FONT = {
  A: [' ### ', '#   #', '#####', '#   #', '#   #'],
  B: ['#### ', '#   #', '#### ', '#   #', '#### '],
  C: [' ####', '#    ', '#    ', '#    ', ' ####'],
  D: ['#### ', '#   #', '#   #', '#   #', '#### '],
  E: ['#####', '#    ', '#### ', '#    ', '#####'],
  F: ['#####', '#    ', '#### ', '#    ', '#    '],
  I: ['#####', '  #  ', '  #  ', '  #  ', '#####'],
  K: ['#   #', '#  # ', '###  ', '#  # ', '#   #'],
  L: ['#    ', '#    ', '#    ', '#    ', '#####'],
  O: [' ### ', '#   #', '#   #', '#   #', ' ### '],
  S: [' ####', '#    ', ' ### ', '    #', '#### '],
  U: ['#   #', '#   #', '#   #', '#   #', ' ### '],
  Y: ['#   #', ' # # ', '  #  ', '  #  ', '  #  '],
  ' ': ['     ', '     ', '     ', '     ', '     '],
};
function bigText(cx, y, str, scale, ci, a) {
  const w = str.length * 6 * scale - scale;
  let x = Math.round(cx - w / 2);
  for (const ch of str.toUpperCase()) {
    const gl = FONT[ch] || FONT[' '];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
      if (gl[r][c] === '#') rect(x + c * scale, y + r * scale, scale, scale, ci, a);
    }
    x += 6 * scale;
  }
}

// ---------- sprites (chars map to brightness) ----------
const B_OF = { '#': 1.0, '+': 0.7, '.': 0.4, 'o': -1 }; // 'o' = eye, drawn white
const SPR = {
  duck: [
    ['  ####  ', ' #o#### ', '<###### ', ' ###### ', ' ###### ', '  #  #  '],
    ['  ####  ', ' #o#### ', '<###### ', ' ###### ', '  ####  ', '  #  #  '],
  ],
  bat: [
    ['#   #', '#####', '#o#o#'],
    ['     ', '#####', '#o#o#'],
  ],
  turret: [
    [' ### ', '#   #', '# ###', '#    ', ' ###o'],
    [' ### ', '#   #', '# ###', '#    ', ' ###o'],
  ],
  heart: ['# #', '###', ' # '],
  sword: [' # ', ' # ', '###', ' # '],
  boots: ['# #', '# #', '###'],
};
function blit(spr, x, y, ci, bright, flipX) {
  const h = spr.length;
  for (let r = 0; r < h; r++) {
    const row = spr[r], w = row.length;
    for (let c = 0; c < w; c++) {
      const ch = row[flipX ? w - 1 - c : c];
      if (ch === ' ') continue;
      const b = B_OF[ch] !== undefined ? B_OF[ch] : 0.9;
      if (b === -1) px(x + c, y + r, 0, bright);
      else px(x + c, y + r, ci, b * bright);
    }
  }
}

// ---------- god portraits (11 wide x 7 tall, pure ASCII) ----------
const PORTRAIT = {
  velox: [
    '     __    ',
    '    /  \\   ',
    '   | >> |  ',
    '    \\__/   ',
    '   //||\\\\  ',
    '  // || \\\\ ',
    '    /  \\   '],
  pluma: [
    '    ____   ',
    '   / o  \\  ',
    ' =<      | ',
    '   \\  ___/ ',
    '   /+++\\   ',
    '  ( ### )  ',
    '   \\___/   '],
  umbra: [
    '   _____   ',
    '  /     \\  ',
    ' |  o o  | ',
    ' |   .   | ',
    '  \\ ___ /  ',
    '    | |    ',
    '   /   \\   '],
  aurum: [
    '    ($)    ',
    '   ($$$)   ',
    '  ($$$$$)  ',
    ' ($$$$$$$) ',
    '  \\ ^__^ / ',
    '   \\____/  ',
    '  $$$$$$$  '],
  mors: [
    '   _____   ',
    '  /     \\  ',
    ' | () () | ',
    ' |   ^   | ',
    '  \\ === /  ',
    '   |||||   ',
    '  .     .  '],
};

// ---------- game state ----------
const LS_BEST = 'ducksouls_best', LS_FAVOR = 'ducksouls_favor';
function loadFavor() {
  try { const f = JSON.parse(localStorage.getItem(LS_FAVOR)); if (f && f.velox !== undefined) return f; } catch (e) { }
  return P.defaultFavor();
}
const G = {
  state: 'title', t: 0,
  favor: loadFavor(),
  best: +(localStorage.getItem(LS_BEST) || 0),
  shake: 0, flash: 0, hitstop: 0,
  msgs: [],
};
window.__fps = 0;

const boon = id => P.boonActive(G.favor, id);
const curse = id => P.curseActive(G.favor, id);
function msg(text, ci = 5, t = 2) { G.msgs.push({ text, ci, t, t0: t }); }

function newRun() {
  G.seed = (Math.random() * 0xffffff) | 0;
  G.rng = mulberry32(G.seed);
  G.depth = 1;
  const maxhp = 3 + (boon('umbra') ? FX.BOON_UMBRA : 0);
  G.player = {
    x: 80, y: 47, hp: maxhp, maxhp,
    dir: { x: 1, y: 0 }, spdMult: 1, swords: 0,
    dashT: 0, dashCd: 0, dashHadDanger: false,
    atkT: 0, atkCd: 0, invulnT: 0,
  };
  G.morsUsed = false;
  G.run = { floors: 1, kills: 0, dmgTaken: 0, pickups: 0, score: 0 };
  G.state = 'play';
  genFloor();
}

function floorStatsInit(roomCount) {
  return { time: 0, roomCount, kills: 0, interrupts: 0, dmgTaken: 0, dashThroughs: 0, pickups: 0, treasureFound: 0, idleT: 0, depth: G.depth };
}

// ---------- floor / room generation ----------
function genFloor() {
  const rng = G.rng;
  const n = 4 + Math.min(G.depth, 4);
  const rooms = new Map();
  const put = (gx, gy) => rooms.set(gx + ',' + gy, { gx, gy, doors: {}, type: 'fight', cleared: false, spawned: false, entered: false, seed: (rng() * 1e9) | 0 });
  put(0, 0);
  const dirs = [[0, -1, 'n', 's'], [1, 0, 'e', 'w'], [0, 1, 's', 'n'], [-1, 0, 'w', 'e']];
  while (rooms.size < n) {
    const all = [...rooms.values()];
    const r = all[(rng() * all.length) | 0];
    const [dx, dy, d1, d2] = dirs[(rng() * 4) | 0];
    const k = (r.gx + dx) + ',' + (r.gy + dy);
    if (!rooms.has(k)) {
      put(r.gx + dx, r.gy + dy);
      r.doors[d1] = true; rooms.get(k).doors[d2] = true;
    } else if (rng() < 0.2) { // occasional loop
      r.doors[d1] = true; rooms.get(k).doors[d2] = true;
    }
  }
  // BFS farthest room = stairs
  const start = rooms.get('0,0');
  start.type = 'start'; start.cleared = true; start.spawned = true;
  const dist = new Map([['0,0', 0]]);
  const q = ['0,0'];
  while (q.length) {
    const k = q.shift(); const r = rooms.get(k); const d = dist.get(k);
    for (const [dx, dy, d1] of dirs) {
      if (!r.doors[d1]) continue;
      const nk = (r.gx + dx) + ',' + (r.gy + dy);
      if (rooms.has(nk) && !dist.has(nk)) { dist.set(nk, d + 1); q.push(nk); }
    }
  }
  let far = start, fd = -1;
  for (const [k, d] of dist) if (d > fd) { fd = d; far = rooms.get(k); }
  far.type = 'stairs';
  const others = [...rooms.values()].filter(r => r.type === 'fight');
  if (others.length) {
    const t = others[(rng() * others.length) | 0];
    t.type = 'treasure'; t.cleared = true; t.spawned = true;
  }
  G.rooms = rooms;
  G.floorStats = floorStatsInit(rooms.size);
  G.player.x = 80; G.player.y = 47;
  enterRoom(start, null);
  msg('FLOOR ' + G.depth, 5, 2.2);
}

function enterRoom(room, fromDir) {
  G.cur = room;
  G.enemies = []; G.bolts = []; G.pickups = []; G.parts = G.parts || [];
  G.doorOpenAt = 0;
  const rng = mulberry32(room.seed);
  // walls + pillars
  const solid = new Uint8Array(COLS * ROWS);
  const walls = [];
  const doorAt = (side, i) => {
    const mid = side === 'n' || side === 's' ? (X0 + X1) / 2 : (Y0 + Y1) / 2;
    return Math.abs(i - mid) <= DOOR / 2;
  };
  for (let x = X0; x <= X1; x++) {
    if (!(room.doors.n && doorAt('n', x))) { solid[Y0 * COLS + x] = 1; walls.push([x, Y0]); }
    if (!(room.doors.s && doorAt('s', x))) { solid[Y1 * COLS + x] = 1; walls.push([x, Y1]); }
  }
  for (let y = Y0; y <= Y1; y++) {
    if (!(room.doors.w && doorAt('w', y))) { solid[y * COLS + X0] = 1; walls.push([X0, y]); }
    if (!(room.doors.e && doorAt('e', y))) { solid[y * COLS + X1] = 1; walls.push([X1, y]); }
  }
  // door bar cells (solid while room hot)
  const bars = [];
  for (let x = X0; x <= X1; x++) {
    if (room.doors.n && doorAt('n', x)) bars.push([x, Y0]);
    if (room.doors.s && doorAt('s', x)) bars.push([x, Y1]);
  }
  for (let y = Y0; y <= Y1; y++) {
    if (room.doors.w && doorAt('w', y)) bars.push([X0, y]);
    if (room.doors.e && doorAt('e', y)) bars.push([X1, y]);
  }
  const pillars = [];
  const np = 2 + ((rng() * 3) | 0);
  for (let i = 0; i < np; i++) {
    const w = 3 + ((rng() * 4) | 0), h = 2 + ((rng() * 3) | 0);
    const x = X0 + 12 + ((rng() * (X1 - X0 - 24 - w)) | 0);
    const y = Y0 + 8 + ((rng() * (Y1 - Y0 - 16 - h)) | 0);
    if (Math.abs(x - 80) < 8 && Math.abs(y - 47) < 6) continue;
    pillars.push([x, y, w, h]);
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { solid[yy * COLS + xx] = 1; walls.push([xx, yy]); }
  }
  // floor speckle
  const speckles = [];
  for (let i = 0; i < 550; i++) {
    speckles.push([X0 + 1 + rng() * (X1 - X0 - 2), Y0 + 1 + rng() * (Y1 - Y0 - 2), 0.1 + rng() * 0.25]);
  }
  G.solid = solid; G.walls = walls; G.bars = bars; G.speckles = speckles;

  if (room.type === 'treasure' && !room.entered) {
    G.floorStats.treasureFound++;
    spawnPickup(80, 47, ['heart', 'sword', 'boots'][(rng() * 3) | 0]);
  }
  room.entered = true;

  if (!room.spawned) {
    room.spawned = true;
    spawnEnemies(room, rng, fromDir);
  }
  G.locked = !room.cleared && G.enemies.length > 0;
  if (G.locked) for (const [x, y] of G.bars) G.solid[y * COLS + x] = 1;
}

function spawnEnemies(room, rng, fromDir) {
  let nDucks = 1 + Math.min(G.depth, 4) + (curse('pluma') ? FX.CURSE_PLUMA : 0);
  let nBats = G.depth >= 2 ? 1 + ((rng() * Math.min(G.depth, 3)) | 0) : 0;
  let nTurrets = G.depth >= 3 ? 1 + (G.depth >= 5 ? 1 : 0) : 0;
  const p = G.player;
  const place = () => {
    for (let tries = 0; tries < 50; tries++) {
      const x = X0 + 6 + rng() * (X1 - X0 - 12), y = Y0 + 5 + rng() * (Y1 - Y0 - 10);
      if (Math.hypot(x - p.x, y - p.y) < 25) continue;
      if (G.solid[(y | 0) * COLS + (x | 0)]) continue;
      return { x, y };
    }
    return { x: 80, y: 20 };
  };
  const mk = (type) => {
    const pos = place();
    const base = { type, x: pos.x, y: pos.y, vx: 0, vy: 0, telegraph: 0.7 + rng() * 0.4, flash: 0, kx: 0, ky: 0, state: 'seek', st: 0 };
    if (type === 'duck') Object.assign(base, { hp: 3, r: 3.2, spd: 5.5 + 0.5 * G.depth, ci: 2 });
    if (type === 'bat') Object.assign(base, { hp: 1, r: 1.8, spd: 9 + 0.4 * G.depth, ci: 8, ph: rng() * 6 });
    if (type === 'turret') Object.assign(base, { hp: 4, r: 2.6, spd: 0, ci: 4, cd: 1 + rng() });
    G.enemies.push(base);
  };
  for (let i = 0; i < nDucks; i++) mk('duck');
  for (let i = 0; i < nBats; i++) mk('bat');
  for (let i = 0; i < nTurrets; i++) mk('turret');
}

function spawnPickup(x, y, kind) { G.pickups.push({ x, y, kind, ph: 0 }); }

// ---------- collision ----------
function solidAt(x, y) {
  if (x < X0 || x > X1 || y < Y0 || y > Y1) return true;
  return G.solid[(y | 0) * COLS + (x | 0)] === 1;
}
function tryMove(e, nx, ny, hr) {
  if (!solidAt(nx - hr, e.y - hr) && !solidAt(nx + hr, e.y - hr) && !solidAt(nx - hr, e.y + hr) && !solidAt(nx + hr, e.y + hr)) e.x = nx;
  if (!solidAt(e.x - hr, ny - hr) && !solidAt(e.x + hr, ny - hr) && !solidAt(e.x - hr, ny + hr) && !solidAt(e.x + hr, ny + hr)) e.y = ny;
}

// ---------- particles ----------
function burst(x, y, ci, n, spd, life) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = spd * (0.3 + Math.random());
    G.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, ci, life: life * (0.5 + Math.random()), t: 0 });
  }
}

// ---------- combat / update ----------
function playerStats() {
  const p = G.player;
  return {
    spd: 14 * p.spdMult * (boon('velox') ? FX.BOON_VELOX : 1),
    dmg: 1 + p.swords + (boon('pluma') ? FX.BOON_PLUMA : 0),
    dashCd: 0.45 * (curse('umbra') ? FX.CURSE_UMBRA : 1),
  };
}

function hurtPlayer(from) {
  const p = G.player;
  if (p.invulnT > 0 || p.dashT > 0) return;
  p.hp -= 1;
  G.run.dmgTaken++; G.floorStats.dmgTaken++;
  p.invulnT = 1.0;
  G.shake = 3; G.flash = 0.18; G.hitstop = 0.09;
  const kb = Math.hypot(p.x - from.x, p.y - from.y) || 1;
  p.kx = (p.x - from.x) / kb * 30; p.ky = (p.y - from.y) / kb * 30;
  SFX.hurt();
  if (p.hp <= 0) {
    if (boon('mors') && !G.morsUsed && FX.BOON_MORS > 0) {
      G.morsUsed = true; p.hp = 1; p.invulnT = 2.2; G.flash = 0.5;
      msg('MORS REFUSES YOU', 1, 2.5); SFX.cheat();
      burst(p.x, p.y, 1, 40, 25, 0.8);
    } else {
      die();
    }
  }
}

function die() {
  G.run.score = G.run.floors * 100 + G.run.kills * 10;
  if (G.run.score > G.best) { G.best = G.run.score; localStorage.setItem(LS_BEST, G.best); }
  G.epitaph = P.epitaph({ ...G.run, score: G.run.score }, G.best);
  G.state = 'dead'; G.deadT = 0;
  G.shake = 6; G.flash = 0.6;
  burst(G.player.x, G.player.y, 7, 60, 30, 1.2);
  SFX.die();
}

function slash() {
  const p = G.player, st = playerStats();
  if (p.atkCd > 0) return;
  p.atkCd = 0.22; p.atkT = 0.13;
  SFX.slash();
  let hitAny = false;
  for (const e of G.enemies) {
    if (e.telegraph > 0) continue;
    const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy);
    if (d > 8.5) continue;
    const dot = (dx * p.dir.x + dy * p.dir.y) / (d || 1);
    if (dot < 0.35) continue;
    e.hp -= st.dmg; e.flash = 0.15; hitAny = true;
    if (e.state === 'windup') { G.floorStats.interrupts++; e.state = 'recover'; e.st = 0.5; msg('INTERRUPTED', 3, 0.7); }
    e.kx = dx / (d || 1) * 40; e.ky = dy / (d || 1) * 40;
    burst(e.x, e.y, e.ci, 8, 18, 0.4);
    if (e.hp <= 0) killEnemy(e);
  }
  if (hitAny) { G.hitstop = 0.05; G.shake = Math.max(G.shake, 1.5); SFX.hit(); }
}

function killEnemy(e) {
  e.dead = true;
  G.run.kills++; G.floorStats.kills++;
  burst(e.x, e.y, e.ci, 22, 22, 0.7);
  burst(e.x, e.y, 0, 8, 14, 0.5);
  G.shake = Math.max(G.shake, 2.5);
  SFX.kill();
}

function roomCleared() {
  G.cur.cleared = true;
  const delay = curse('velox') ? FX.CURSE_VELOX : 0;
  G.doorOpenAt = G.t + delay;
  if (delay > 0) msg('VELOX BARS THE DOORS', 3, delay);
  // drops (AURUM watches)
  const mult = curse('aurum') ? FX.CURSE_AURUM : (boon('aurum') ? FX.BOON_AURUM : 1);
  if (G.rng() < 0.22 * mult) {
    spawnPickup(80 + (G.rng() * 20 - 10), 47 + (G.rng() * 10 - 5), ['heart', 'heart', 'sword', 'boots'][(G.rng() * 4) | 0]);
  }
}

function updatePlay(dt) {
  const p = G.player, st = playerStats();
  G.floorStats.time += dt;
  const iv = inputVec();
  const hot = G.enemies.length > 0;
  if (iv.x === 0 && iv.y === 0 && hot) G.floorStats.idleT += dt;
  if (iv.x || iv.y) p.dir = { x: iv.x, y: iv.y };

  // dash
  p.dashCd -= dt;
  if ((keys['z'] || keys['shift']) && p.dashCd <= 0 && p.dashT <= 0) {
    p.dashT = 0.13; p.dashCd = st.dashCd + 0.13; p.dashHadDanger = false;
    p.dashDir = (iv.x || iv.y) ? { ...iv } : { ...p.dir };
    SFX.dash();
  }
  let vx, vy;
  if (p.dashT > 0) {
    p.dashT -= dt;
    vx = p.dashDir.x * st.spd * 3.1; vy = p.dashDir.y * st.spd * 3.1;
    G.parts.push({ x: p.x, y: p.y, vx: 0, vy: 0, ci: 3, life: 0.25, t: 0, ghost: true });
    for (const e of G.enemies) if (!e.dead && Math.hypot(e.x - p.x, e.y - p.y) < 4) p.dashHadDanger = true;
    for (const b of G.bolts) if (Math.hypot(b.x - p.x, b.y - p.y) < 3) p.dashHadDanger = true;
    if (p.dashT <= 0 && p.dashHadDanger) { G.floorStats.dashThroughs++; msg('SLIPPED', 8, 0.6); }
  } else {
    vx = iv.x * st.spd; vy = iv.y * st.spd;
  }
  // knockback decay
  p.kx = (p.kx || 0) * Math.pow(0.001, dt); p.ky = (p.ky || 0) * Math.pow(0.001, dt);
  tryMove(p, p.x + (vx + p.kx) * dt, p.y + (vy + p.ky) * dt, 1.3);
  p.invulnT -= dt; p.atkCd -= dt; p.atkT -= dt;

  if (keys['x'] || keys[' ']) slash();

  // enemies
  for (const e of G.enemies) {
    if (e.telegraph > 0) { e.telegraph -= dt; continue; }
    e.flash -= dt;
    e.kx = (e.kx || 0) * Math.pow(0.001, dt); e.ky = (e.ky || 0) * Math.pow(0.001, dt);
    const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
    if (e.type === 'duck') {
      e.st -= dt;
      if (e.state === 'seek') {
        e.vx = dx / d * e.spd; e.vy = dy / d * e.spd;
        if (d < 14 && e.st <= 0) { e.state = 'windup'; e.st = 0.35; e.vx = e.vy = 0; }
      } else if (e.state === 'windup') {
        e.vx = e.vy = 0;
        if (e.st <= 0) { e.state = 'lunge'; e.st = 0.28; e.lx = dx / d; e.ly = dy / d; }
      } else if (e.state === 'lunge') {
        e.vx = e.lx * e.spd * 3.6; e.vy = e.ly * e.spd * 3.6;
        if (e.st <= 0) { e.state = 'recover'; e.st = 0.4; }
      } else { // recover
        e.vx = e.vy = 0;
        if (e.st <= 0) { e.state = 'seek'; e.st = 0.3; }
      }
    } else if (e.type === 'bat') {
      e.ph += dt * 7;
      const wob = Math.sin(e.ph) * 6;
      e.vx = dx / d * e.spd - dy / d * wob; e.vy = dy / d * e.spd + dx / d * wob;
    } else if (e.type === 'turret') {
      e.vx = e.vy = 0;
      e.cd -= dt;
      if (e.cd <= 0) {
        e.cd = Math.max(0.9, 1.7 - 0.08 * G.depth);
        const n = G.depth >= 4 ? 3 : 1;
        for (let i = 0; i < n; i++) {
          const spread = (i - (n - 1) / 2) * 0.25;
          const ca = Math.cos(spread), sa = Math.sin(spread);
          G.bolts.push({ x: e.x, y: e.y, vx: (dx / d * ca - dy / d * sa) * 16, vy: (dy / d * ca + dx / d * sa) * 16 });
        }
        e.flash = 0.1;
        tone(500, 300, 0.06, 'square', 0.05);
      }
    }
    tryMove(e, e.x + (e.vx + e.kx) * dt, e.y + (e.vy + e.ky) * dt, e.type === 'bat' ? 0.8 : 1.6);
    if (Math.hypot(p.x - e.x, p.y - e.y) < e.r + 1.4) hurtPlayer(e);
  }
  // enemy separation
  for (let i = 0; i < G.enemies.length; i++) for (let j = i + 1; j < G.enemies.length; j++) {
    const a = G.enemies[i], b = G.enemies[j];
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d > 0 && d < 4) { const push = (4 - d) * 0.5; a.x -= dx / d * push; a.y -= dy / d * push; b.x += dx / d * push; b.y += dy / d * push; }
  }
  const before = G.enemies.length;
  G.enemies = G.enemies.filter(e => !e.dead);
  if (before > 0 && G.enemies.length === 0 && !G.cur.cleared) roomCleared();

  // unlock doors
  if (G.locked && G.cur.cleared && G.t >= G.doorOpenAt) {
    G.locked = false;
    for (const [x, y] of G.bars) G.solid[y * COLS + x] = 0;
    SFX.door();
  }

  // bolts
  for (const b of G.bolts) {
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (solidAt(b.x, b.y)) b.dead = true;
    else if (Math.hypot(b.x - p.x, b.y - p.y) < 1.8) { hurtPlayer(b); b.dead = true; }
  }
  G.bolts = G.bolts.filter(b => !b.dead);

  // pickups
  for (const pk of G.pickups) {
    pk.ph += dt * 3;
    if (Math.hypot(pk.x - p.x, pk.y - p.y) < 3) {
      pk.dead = true;
      G.run.pickups++; G.floorStats.pickups++;
      SFX.pickup();
      burst(pk.x, pk.y, 5, 12, 12, 0.5);
      if (pk.kind === 'heart') {
        const heal = 1 * (curse('mors') ? FX.CURSE_MORS : 1);
        if (heal > 0) { p.hp = Math.min(p.maxhp, p.hp + heal); msg('+1 HP', 7, 1); }
        else msg('MORS: NOTHING', 1, 1.4);
      }
      if (pk.kind === 'sword') { p.swords++; msg('SWORD +1 DMG', 0, 1.4); }
      if (pk.kind === 'boots') { p.spdMult *= 1.08; msg('BOOTS +SPEED', 3, 1.4); }
    }
  }
  G.pickups = G.pickups.filter(pk => !pk.dead);

  // room transitions (only through open doors — bars are solid anyway)
  const mid = (X0 + X1) / 2, midY = (Y0 + Y1) / 2;
  let moved = null;
  if (p.y <= Y0 + 2.5 && Math.abs(p.x - mid) <= DOOR / 2 && G.cur.doors.n && !G.locked) moved = ['n', 0, -1];
  if (p.y >= Y1 - 2.5 && Math.abs(p.x - mid) <= DOOR / 2 && G.cur.doors.s && !G.locked) moved = ['s', 0, 1];
  if (p.x <= X0 + 2.5 && Math.abs(p.y - midY) <= DOOR / 2 && G.cur.doors.w && !G.locked) moved = ['w', -1, 0];
  if (p.x >= X1 - 2.5 && Math.abs(p.y - midY) <= DOOR / 2 && G.cur.doors.e && !G.locked) moved = ['e', 1, 0];
  if (moved) {
    const [dir, dx, dy] = moved;
    const next = G.rooms.get((G.cur.gx + dx) + ',' + (G.cur.gy + dy));
    if (next) {
      if (dir === 'n') p.y = Y1 - 4; if (dir === 's') p.y = Y0 + 4;
      if (dir === 'w') p.x = X1 - 4; if (dir === 'e') p.x = X0 + 4;
      enterRoom(next, dir);
    }
  }

  // stairs
  if (G.cur.type === 'stairs' && G.cur.cleared) {
    if (Math.abs(p.x - 80) < 3 && Math.abs(p.y - 47) < 3) beginJudgment();
  }
}

// ---------- judgment ----------
function beginJudgment() {
  SFX.stairs();
  G.cards = P.judge(G.floorStats, G.favor);
  G.favor = P.applyFavor(G.favor, G.cards);
  localStorage.setItem(LS_FAVOR, JSON.stringify(G.favor));
  G.verdictText = P.verdict(G.cards);
  G.state = 'judgment'; G.judgeT = 0;
  SFX.judge();
}
function nextFloor() {
  G.depth++; G.run.floors = G.depth;
  const p = G.player;
  p.maxhp = 3 + (boon('umbra') ? FX.BOON_UMBRA : 0);
  p.hp = Math.min(p.maxhp, p.hp + 1);
  G.state = 'play';
  genFloor();
}

// ---------- key routing ----------
function onKey(k) {
  if (k === 'm') { muted = !muted; return; }
  if (G.state === 'title') { if (!['shift', 'meta', 'control', 'alt'].includes(k)) newRun(); return; }
  if (G.state === 'judgment' && G.judgeT > 0.8 && (k === ' ' || k === 'enter' || k === 'x')) { nextFloor(); return; }
  if (G.state === 'dead') {
    if (k === 'r') { newRun(); return; }
    if (k === 'escape') { G.state = 'title'; return; }
  }
  if (G.state === 'play' && k === 'escape') G.state = 'title';
}

// ---------- drawing ----------
function drawFavorBar(x, y, ci, favor, extra) {
  const n = Math.round(favor / 10);
  A.text(x, y, '[' + '#'.repeat(n) + '-'.repeat(10 - n) + '] ' + String(favor).padStart(3) + (extra || ''), ci);
}

function plasma(t, dim, bandCols) {
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x += 1) {
      const v = Math.sin(x * 0.055 + t) + Math.sin(y * 0.09 - t * 1.25) + Math.sin((x + y) * 0.042 + t * 0.6) + Math.sin(Math.hypot(x - 80, y - 45) * 0.1 - t * 1.5);
      const b = (v + 4) / 8;
      if (b < 0.42) continue;
      const ci = bandCols[Math.abs((v * 1.5 + t) | 0) % bandCols.length];
      px(x, y, ci, (b - 0.4) * dim);
    }
  }
}

function drawWorld() {
  const p = G.player;
  const shx = G.shake > 0.3 ? ((Math.random() * G.shake * 2 - G.shake) | 0) : 0;
  const shy = G.shake > 0.3 ? ((Math.random() * G.shake * 2 - G.shake) | 0) : 0;
  S.save(); S.translate(shx, shy);

  const torch = (x, y) => { const d2 = (x - p.x) ** 2 + (y - p.y) ** 2; return Math.min(1, 1.6 / (1 + d2 * 0.0016)); };
  for (const [x, y, b] of G.speckles) px(x, y, 1, b * torch(x, y));
  for (const [x, y] of G.walls) px(x, y, 1, 0.28 + 0.5 * torch(x, y));
  if (G.locked) {
    const pulse = 0.6 + 0.4 * Math.sin(G.t * 8);
    for (const [x, y] of G.bars) px(x, y, 7, pulse);
  } else {
    // open doorways glow faintly so exits read at a glance
    const pulse = 0.3 + 0.15 * Math.sin(G.t * 3);
    for (const [x, y] of G.bars) px(x, y, 3, pulse);
  }
  // stairs
  if (G.cur.type === 'stairs' && G.cur.cleared) {
    const pulse = 0.5 + 0.5 * Math.sin(G.t * 4);
    rect(77, 44, 7, 6, 6, 0.35 + 0.2 * pulse);
    A.text(79, 46, '>>', 5, 0.7 + 0.3 * pulse);
  }
  // pickups
  for (const pk of G.pickups) {
    const bob = Math.sin(pk.ph) * 1.2;
    const spr = SPR[pk.kind];
    const ci = pk.kind === 'heart' ? 7 : pk.kind === 'sword' ? 0 : 3;
    blit(spr, pk.x - 1, pk.y - 1 + bob, ci, 0.9, false);
  }
  // enemies
  for (const e of G.enemies) {
    if (e.telegraph > 0) { // materialize static
      for (let i = 0; i < 14; i++) px(e.x + Math.random() * 8 - 4, e.y + Math.random() * 6 - 3, e.ci, Math.random() * 0.7);
      continue;
    }
    let bright = 0.85;
    if (e.state === 'windup') bright = 1.0 + Math.sin(G.t * 30) * 0.3; // telegraph flash
    if (e.flash > 0) bright = 1.6;
    const frame = ((G.t * 6) | 0) % 2;
    const spr = SPR[e.type][frame];
    blit(spr, e.x - spr[0].length / 2, e.y - spr.length / 2, e.ci, bright, e.vx > 0.5);
  }
  // bolts
  for (const b of G.bolts) {
    px(b.x, b.y, 4, 1);
    px(b.x - b.vx * 0.02, b.y - b.vy * 0.02, 4, 0.5);
  }
  // player
  const blink = p.invulnT > 0 && ((G.t * 12) | 0) % 2 === 0;
  if (!blink && G.state === 'play') {
    const ci = p.dashT > 0 ? 3 : 0;
    rect(p.x - 1, p.y - 1, 3, 3, ci, 1);
    px(p.x + p.dir.x * 2, p.y + p.dir.y * 2, ci, 0.8);
  }
  // slash arc
  if (p.atkT > 0) {
    const prog = 1 - p.atkT / 0.13;
    const baseA = Math.atan2(p.dir.y, p.dir.x);
    for (let da = -0.7; da <= 0.7; da += 0.12) {
      const a = baseA + da * (1 - prog * 0.3);
      for (let r = 3 + prog * 2; r < 8; r += 1) {
        px(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r * 0.9, da > -0.15 && da < 0.15 ? 0 : 5, (1 - prog) * (1 - Math.abs(da) * 0.6));
      }
    }
  }
  // particles
  for (const pt of G.parts) {
    pt.t += 1 / 60;
    if (pt.ghost) { rect(pt.x - 1, pt.y - 1, 3, 3, pt.ci, (1 - pt.t / pt.life) * 0.5); continue; }
    pt.x += pt.vx / 60; pt.y += pt.vy / 60;
    pt.vx *= 0.94; pt.vy *= 0.94;
    px(pt.x, pt.y, pt.ci, 1 - pt.t / pt.life);
  }
  G.parts = G.parts.filter(pt => pt.t < pt.life);

  if (G.flash > 0) { rect(X0, Y0, X1 - X0 + 1, Y1 - Y0 + 1, 0, G.flash * 0.9); }
  S.restore();
}

function drawHud() {
  const p = G.player, st = playerStats();
  const hearts = '#'.repeat(p.hp) + '-'.repeat(Math.max(0, p.maxhp - p.hp));
  A.text(2, 0, 'DUCK SOULS', 1);
  A.text(14, 0, 'FLOOR ' + G.depth, 5);
  A.text(24, 0, 'HP [' + hearts + ']', p.hp <= 1 ? 7 : 0);
  const dash = p.dashCd <= 0 ? 'DASH READY' : 'DASH ....';
  A.text(38, 0, dash, p.dashCd <= 0 ? 3 : 1);
  A.text(52, 0, 'KILLS ' + G.run.kills, 2);
  A.text(64, 0, 'SEED ' + G.seed.toString(16).toUpperCase(), 1, 0.6);
  A.text(80, 0, 'BEST ' + G.best, 1, 0.6);
  // pantheon strip: glyph lit if boon, barred if curse (shape = second channel)
  let x = 96;
  for (const g of P.GODS) {
    const b = boon(g.id), c = curse(g.id);
    const tag = g.glyph + (b ? '+' : c ? 'x' : ' ');
    A.text(x, 0, g.name.slice(0, 2) + tag, b ? g.ci : c ? 7 : 1, b || c ? 1 : 0.45);
    x += 6;
  }
  A.text(128, 0, muted ? 'MUTED' : '', 1, 0.5);
  // minimap: rooms as boxes
  let mm = '';
  const cur = G.cur;
  for (const r of G.rooms.values()) mm += (r === cur ? '[#]' : r.cleared ? '[=]' : '[ ]');
  A.text(COLS - mm.length - 2, 2, mm, 1, 0.6);
  // messages
  let my = 7;
  for (const m of G.msgs) {
    m.t -= 1 / 60;
    A.textC(my, m.text, m.ci, Math.min(1, m.t / (m.t0 * 0.4)));
    my += 2;
  }
  G.msgs = G.msgs.filter(m => m.t > 0);
}

function drawTitle() {
  plasma(G.t * 0.7, 0.5, [6, 3, 8, 2]);
  bigText(80, 14, 'DUCK', 2, 5, 0.95);
  bigText(80, 26, 'SOULS', 2, 7, 0.95);
  A.textC(40, 'a fast-paced roguelite judged by a pantheon', 0);
  A.textC(42, 'every frame renders through a live video->ASCII filter', 1, 0.7);
  // pantheon disposition
  A.textC(47, 'THE PANTHEON REMEMBERS YOU', 1, 0.8);
  let y = 50;
  for (const g of P.GODS) {
    const f = G.favor[g.id];
    const state = boon(g.id) ? ' BOON: ' + g.boon.desc : curse(g.id) ? ' CURSE: ' + g.curse.desc : '';
    A.text(36, y, (g.glyph + ' ' + g.name).padEnd(10) + g.title.padEnd(26), g.ci);
    drawFavorBar(72, y, boon(g.id) ? g.ci : curse(g.id) ? 7 : 1, f, state);
    y += 2;
  }
  A.textC(64, 'ARROWS / WASD move    X or SPACE slash    Z or SHIFT dash    M mute', 0, 0.8);
  if (((G.t * 1.5) | 0) % 2 === 0) A.textC(70, '- PRESS ANY KEY -', 5);
  if (G.best > 0) A.textC(74, 'BEST ' + G.best, 1, 0.7);
  A.textC(86, 'BlueDuck LLC / the ducks are dragons / the dragons are ducks', 1, 0.4);
}

function drawJudgment(dt) {
  G.judgeT += dt;
  plasma(G.t * 0.15, 0.15, [6, 8, 1]);
  A.textC(8, 'THE PANTHEON PASSES JUDGMENT', 0);
  A.textC(11, 'FLOOR ' + G.depth + ' CLEARED  --  ' + G.verdictText, 5);
  const pw = 31, py = 20;
  G.cards.forEach((c, i) => {
    const t = G.judgeT - i * 0.22;
    if (t < 0) return;
    const x0 = 3 + i * pw;
    const al = Math.min(1, t * 3);
    // blackout behind the card so the plasma never muddies it
    S.globalAlpha = 1; S.fillStyle = '#000';
    S.fillRect(x0 - 1, py - 2, pw - 1, 42);
    if (al < 1) { // materialize static
      for (let k = 0; k < 60; k++) px(x0 + Math.random() * (pw - 2), py + Math.random() * 36, c.ci, Math.random() * 0.5);
    }
    const port = PORTRAIT[c.id];
    port.forEach((row, r) => A.text(x0 + (pw - 13) / 2, py + r, row, c.ci, al));
    A.text(x0 + (pw - c.name.length) / 2, py + 8, c.name, c.ci, al);
    A.text(x0 + (pw - c.title.length) / 2, py + 10, c.title, 1, al * 0.8);
    // grade letter through the ascii filter
    const gradeCi = c.letter === 'S' ? 5 : c.letter === 'A' ? 0 : c.letter === 'B' ? 3 : c.letter === 'C' ? 2 : 7;
    bigText(x0 + pw / 2, py + 13, c.letter, 1, gradeCi, al);
    const dtxt = (c.delta >= 0 ? '+' : '') + c.delta + ' FAVOR';
    A.text(x0 + (pw - dtxt.length) / 2, py + 20, dtxt, c.delta >= 0 ? 3 : 7, al);
    // the vital stats under the grade — the number the god is pointing at
    A.text(x0 + Math.max(1, (pw - c.stat.length) / 2), py + 22, c.stat.slice(0, pw - 2), 1, al * 0.9);
    drawFavorBar(x0 + (pw - 16) / 2, py + 24, c.ci, c.favorAfter, '');
    // god's line, wrapped
    const words = c.line.split(' ');
    let line = '', ly = py + 27;
    for (const w of words) {
      if ((line + ' ' + w).length > pw - 4) { A.text(x0 + 2, ly, line, c.ci, al * 0.85); ly += 1; line = w; }
      else line = line ? line + ' ' + w : w;
    }
    if (line) A.text(x0 + 2, ly, line, c.ci, al * 0.85);
    // boon/curse status line
    if (P.boonActive({ [c.id]: c.favorAfter }, c.id)) A.text(x0 + 2, py + 31, 'BOON: ' + P.GODS[i].boon.desc, c.ci, al);
    else if (P.curseActive({ [c.id]: c.favorAfter }, c.id)) A.text(x0 + 2, py + 31, 'CURSE: ' + P.GODS[i].curse.desc, 7, al);
  });
  if (G.judgeT > 1.4 && ((G.t * 1.5) | 0) % 2 === 0) A.textC(68, '- SPACE: DESCEND TO FLOOR ' + (G.depth + 1) + ' -', 5);
  // stat legend
  A.textC(74, 'every grade is a pure function over this floor\'s numbers -- no vibes', 1, 0.5);
}

function drawDead(dt) {
  G.deadT += dt;
  plasma(G.t * 0.1, 0.15, [7, 1]);
  drawWorld(); // corpse particles keep raining
  bigText(80, 18, 'YOU', 3, 7, Math.min(1, G.deadT * 2));
  bigText(80, 36, 'DIED', 3, 7, Math.min(1, Math.max(0, G.deadT - 0.3) * 2));
  if (G.deadT > 1) {
    A.textC(56, G.epitaph, 1);
    A.textC(59, 'FLOOR ' + G.run.floors + '   KILLS ' + G.run.kills + '   SCORE ' + G.run.score + '   BEST ' + G.best, 0);
    let x = 40, y = 63;
    for (const g of P.GODS) {
      A.text(x, y, g.glyph + ' ' + String(G.favor[g.id]).padStart(3), boon(g.id) ? g.ci : curse(g.id) ? 7 : 1);
      x += 16;
    }
    if (((G.t * 1.5) | 0) % 2 === 0) A.textC(70, '- R: THE GODS REMEMBER YOU -', 5);
  }
}

// ---------- main loop ----------
let last = performance.now(), fpsEma = 60;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  fpsEma = fpsEma * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05;
  window.__fps = Math.round(fpsEma);
  G.t += dt;
  G.shake = Math.max(0, G.shake - dt * 12);
  G.flash = Math.max(0, G.flash - dt * 2.5);

  A.beginFrame();
  if (G.state === 'title') drawTitle();
  else if (G.state === 'judgment') drawJudgment(dt);
  else if (G.state === 'dead') { drawDead(dt); drawHud(); }
  else {
    if (G.hitstop > 0) G.hitstop -= dt;
    else updatePlay(dt);
    if (G.state === 'play' || G.state === 'dead') { drawWorld(); drawHud(); }
  }
  A.render();
}
requestAnimationFrame(frame);
