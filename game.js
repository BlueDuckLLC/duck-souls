// game.js — DUCK SOULS. Fast-paced ASCII roguelite judged by a pantheon.
// Everything world-side is drawn in pixels onto the Asciifier's scene canvas
// (1px = 1 char cell) and passes through the video->ASCII filter each frame.
window.addEventListener('error', e => (window.__errs = window.__errs || []).push(String(e.message)));

const COLS = 160, ROWS = 90, CELL = 8;
const A = new Asciifier(document.getElementById('screen'), COLS, ROWS, CELL);
const S = A.sctx;
const P = window.Pantheon;

// arena bounds — now PER ROOM (rows 0-3 reserved for HUD). enterRoom() sets these from
// the room's architecture, so a crypt is genuinely smaller than a cathedral.
let X0 = 1, X1 = COLS - 2, Y0 = 5, Y1 = ROWS - 2;
const DOOR = 7; // door gap size

// ---- ARCHITECTURE: rooms have shapes and sizes, not just contents ----
// Each entry gives an inset (how much smaller than the full arena) and a wall-builder
// that decorates the interior. Drawn through the ASCII filter like everything else.
const ARCH = {
  CAVE: { name: 'cave', inset: [2, 4], ci: 1, org: true },
  TEMPLE: { name: 'temple', inset: [10, 6], ci: 0 },
  CRYPT: { name: 'crypt', inset: [26, 14], ci: 8 },
  CATHEDRAL: { name: 'cathedral', inset: [34, 3], ci: 6 },
  HALL: { name: 'long hall', inset: [3, 22], ci: 1 },
  GARDEN: { name: 'garden', inset: [8, 8], ci: 4, org: true },
  ROTUNDA: { name: 'rotunda', inset: [22, 6], ci: 5, round: true },
  GROTTO: { name: 'grotto', inset: [30, 16], ci: 3, org: true, pool: true },
  LABYRINTH: { name: 'labyrinth', inset: [6, 6], ci: 1 },
  AQUEDUCT: { name: 'aqueduct', inset: [4, 10], ci: 6 },
  BONEYARD: { name: 'boneyard', inset: [2, 4], ci: 0 },
  OBSERVATORY: { name: 'observatory', inset: [12, 3], ci: 5, round: true },
  THORNWOOD: { name: 'thornwood', inset: [6, 6], ci: 4, org: true, dim: 0.6 },
};
const ARCH_KEYS = Object.keys(ARCH);

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

// ---------- room heuristics: THE ROOM IS WRONG ----------
// Each key must be consumed by real gameplay code below (test.js greps for >=2 refs).
const MUT = {
  LOWGRAV: { name: 'LOW GRAVITY', ci: 3, desc: 'you drift. hits float everyone.' },
  SIDEGRAV: { name: 'SIDEWAYS GRAVITY', ci: 6, desc: 'the room pulls. watch the dust.' },
  DARK: { name: 'PITCH DARK', ci: 8, desc: 'your light is a cone. they are still here.' },
  FLICKER: { name: 'BAD WIRING', ci: 5, desc: 'the lights are not on your side.' },
  HASTE: { name: 'HASTE', ci: 2, desc: 'everything is faster. everything.' },
  MOLASSES: { name: 'MOLASSES', ci: 4, desc: 'everything is slow except your dash.' },
  SWARM: { name: 'THE SWARM', ci: 7, desc: 'twice as many. half as sturdy.' },
  RUBBER: { name: 'RUBBER', ci: 0, desc: 'every hit is a launch. walls bounce.' },
  // the Zelda seven (v4)
  IRONFRONT: { name: 'IRONFRONT', ci: 1, desc: 'their faces are iron. go around.' },
  WOODS: { name: 'THE WOODS', ci: 4, desc: 'the edges lie. the room repeats into itself.' },
  ORDER: { name: 'THE ORDER', ci: 5, desc: 'numbered deaths. count, or repeat.' },
  PHASE: { name: 'PHASE', ci: 6, desc: 'they are not where they were.' },
  HUNGRY: { name: 'THE HUNGRY ONE', ci: 8, desc: 'it wants what you carry. kill it before it swallows.' },
  FOUNTAIN: { name: 'THE FOUNTAIN', ci: 3, desc: 'the water heals whoever stands in it. whoever.' },
  TOLL: { name: 'THE TOLL', ci: 2, desc: 'it is a secret to everybody. score is rupees here.' },
};
const mut = key => G.cur && G.cur.mut === key;
const liveScore = () => G.run ? G.run.floors * 100 + G.run.kills * 10 + (G.run.bonus || 0) : 0;
// angle helpers for iron faces that track you with a lag (so flanking works)
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
// ---- fairness primitives (playtest panel 2026-07-20; measured by fun_test.js) ----
const TURRET_AIM = 0.3;   // real-time seconds of aim telegraph, never scaled by room speed
const MAX_SWORDS = 3;     // damage can't outrun enemy HP forever
// Reach vs lunge is the core tension: the duck must out-threaten your sword (so you have
// to dodge, not just backpedal), but not so far that melee is a coin-flip you lose.
// Threat = LUNGE_TRAVEL + ellipse 4.2 must exceed SLASH_REACH by ~1-2 cells, not 4+.
const SLASH_REACH = 7.0;   // 8.5 made kiting free; 6.0 made melee suicidal
const LUNGE_MULT = 3.0, LUNGE_TIME = 0.22; // travel ~4.0 cells at depth 1 (was ~6.1)
// contact damage is state-aware: the lunge is what kills you, a shoulder-brush grazes
function contactHit(e, px2, py2) {
  const dx = px2 - e.x, dy = py2 - e.y;
  if (e.type === 'duck') {
    // A duck only DAMAGES you on the lunge it telegraphed. Walking into one shoves you
    // (separation handles that) but never costs HP — otherwise the windup is theatre and
    // deaths read as random. Measured: 0% of damage was telegraphed before this.
    if (e.state !== 'lunge') return false;
    return (dx * dx) / (4.2 * 4.2) + (dy * dy) / (3.2 * 3.2) < 1;
  }
  return Math.hypot(dx, dy) < e.r + 1.4;
}
// walls are walls: your sword respects what the enemies' bolts already respect
function losBlocked(x0, y0, x1, y1) {
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    if (solidAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return true;
  }
  return false;
}
function ironBlocked(e, ax, ay) {
  if (!mut('IRONFRONT') || e.faceA === undefined) return false;
  const d = Math.hypot(ax - e.x, ay - e.y) || 1;
  return ((ax - e.x) / d) * Math.cos(e.faceA) + ((ay - e.y) / d) * Math.sin(e.faceA) > 0.45;
}
function clink(e) {
  burst(e.x + Math.cos(e.faceA) * 3, e.y + Math.sin(e.faceA) * 2.5, 0, 5, 10, 0.25);
  tone(1500, 900, 0.05, 'square', 0.06);
}
// held-item glyphs for HUD + floor rendering
const ITEMS = {
  gun: { label: 'GUN', hint: 'C fires', ci: 0 },
  star: { label: 'NINJA STAR', hint: 'C throws', ci: 3 },
  hotdog: { label: 'HOTDOG', hint: 'C eats', ci: 2 },
  lantern: { label: 'LANTERN', hint: 'lights the dark', ci: 5 },
  key: { label: 'KEY', hint: 'opens the chest', ci: 5 },
  chalice: { label: 'CHALICE', hint: 'deliver it untouched', ci: 5 },
  bomb: { label: 'BOMB', hint: 'C throws. stand back.', ci: 7 },
  // the six signature weapons — each a distinct feel (chosen in the armory at run start)
  hammer: { label: 'HAMMER', hint: 'hold X: charge & SMASH', ci: 7, weapon: true, melee: true },
  whip: { label: 'WHIP', hint: 'X: long, wild, no close', ci: 2, weapon: true, melee: true },
  rapier: { label: 'RAPIER', hint: 'X: fast precise stab', ci: 3, weapon: true, melee: true },
  boomerang: { label: 'BOOMERANG', hint: 'X: throw & return', ci: 5, weapon: true },
  flail: { label: 'FLAIL', hint: 'orbits; X: front sweep', ci: 8, weapon: true, melee: true },
  sporebow: { label: 'SPORE-BOW', hint: 'X: lob a vine burst', ci: 4, weapon: true },
};
const WEAPONS = ['hammer', 'whip', 'rapier', 'boomerang', 'flail', 'sporebow'];
// One source of truth for weapon balance (fun_test asserts the DPS band off this).
// dmg × (multi hits) / cd = single-target DPS; kept in a 0.6..1.4× median band.
const WEAPON_STATS = {
  hammer: { dmg: 5, cd: 0.85, reach: 10, ci: 7, multi: 1 },   // 5.9 dps, but AoE + stun
  whip: { dmg: 3, cd: 0.42, reach: 13, ci: 2, multi: 1 },     // 7.1 dps, dead-zone + jitter
  rapier: { dmg: 1, cd: 0.14, reach: 5, ci: 3, multi: 1 },    // 7.1 dps, tiny reach
  boomerang: { dmg: 2, cd: 0.62, reach: 12, ci: 5, multi: 2 },// 6.5 dps, hits both legs
  flail: { dmg: 2, cd: 0.36, reach: 7, ci: 8, multi: 1 },     // 5.6 dps, front-arc, no aim
  sporebow: { dmg: 6, cd: 0.95, reach: 14, ci: 4, multi: 1 }, // 6.3 dps AoE, regenerating ammo
};

// ---------- rng ----------
function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ---------- input ----------
const keys = window.keys = {};
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
function bigText(cx, y, str, scale, ci, a, wave = 0) {
  const w = str.length * 6 * scale - scale;
  let x = Math.round(cx - w / 2), li = 0;
  for (const ch of str.toUpperCase()) {
    const gl = FONT[ch] || FONT[' '];
    const yo = wave ? Math.sin(G.t * 2.4 + li * 0.75) * wave : 0;
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
      if (gl[r][c] === '#') rect(x + c * scale, y + yo + r * scale, scale, scale, ci, a);
    }
    x += 6 * scale; li++;
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
  gun: ['#####', '  ## ', '  #  '],
  star: [' # ', '###', ' # '],
  hotdog: [' ####', '#####', '#### '],
  lantern: [' # ', '###', '###', ' # '],
  key: ['##   ', '#####', '#  # '],
  chalice: ['# #', '###', ' # ', '###'],
  chest: ['#####', '#o$o#', '#####', ' ### '],
  bomb: [' + ', '###', '###'],
  hammer: [' ###', ' ###', '  # ', '  # '],
  whip: ['#   ', ' ## ', '   #', '  ##'],
  rapier: ['   #', '  # ', ' #  ', '#   '],
  boomerang: ['##  ', '  # ', '  # ', ' ## '],
  flail: [' # ', '###', ' # '],
  sporebow: [' ##', '#  ', '# #', ' ##'],
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
const LS_BEST = 'ducksouls_best', LS_FAVOR = 'ducksouls_favor', LS_LEDGER = 'ducksouls_ledger', LS_SEEN = 'ducksouls_seen';
function loadFavor() {
  try { const f = JSON.parse(localStorage.getItem(LS_FAVOR)); if (f && f.velox !== undefined) return f; } catch (e) { }
  return P.defaultFavor();
}
function loadLedger() {
  const d = { runs: 0, deaths: 0, totalKills: 0, deepest: 0, bestScore: 0, floor1Deaths: 0, totalHotdogs: 0, totalChests: 0, totalChalices: 0, totalStolen: 0, totalTufts: 0, totalSpent: 0, totalPieces: 0, lastRuns: [] };
  try { const l = JSON.parse(localStorage.getItem(LS_LEDGER)); if (l && l.runs !== undefined) return { ...d, ...l }; } catch (e) { }
  return d;
}
function saveLedger() { localStorage.setItem(LS_LEDGER, JSON.stringify(G.ledger)); }
const G = {
  // a brand-new soul opens on the vine cutscene, then the story crawl
  state: localStorage.getItem(LS_SEEN) ? 'title' : 'cinema', t: 0,
  cineI: 0, cineT: 0, cineRet: 'intro-chain',
  favor: loadFavor(),
  ledger: loadLedger(),
  best: +(localStorage.getItem(LS_BEST) || 0),
  shake: 0, flash: 0, hitstop: 0,
  msgs: [],
};

// the story arrives like bad reception: cryptic, typed, glitching
const INTRO_LINES = [
  'THE KINGDOM DROWNED IN FEATHERS.',
  'FIVE GODS REMAINED. THEY GRADE WHAT THEY CANNOT RULE.',
  'A SQUARE DESCENDS. IT IS EASIER TO JUDGE.',
  'THE DUCKS REMEMBER BEING DRAGONS.',
  'DESCEND. BE GRADED. RETURN. AGAIN.',
];
// typewriter: centered on the FULL string so text never re-centers as it types
function typeText(y, str, ci, elapsed, cps = 28, alpha = 1, atX = null) {
  const n = Math.max(0, Math.min(str.length, Math.floor(elapsed * cps)));
  if (n <= 0) return false;
  const x = atX !== null ? Math.round(atX) : Math.round((COLS - str.length) / 2);
  A.text(x, y, str.slice(0, n), ci, alpha);
  if (n < str.length && ((G.t * 16) | 0) % 2 === 0) A.text(x + n, y, '_', ci, alpha);
  return n >= str.length;
}

// ---------- the rules, as a plant would hear them ----------
// A vine grows; each instruction blooms as a flower. Same rules. Slower. Greener.
const GROW_NODES = [
  { phrase: 'lean toward what light remains', key: 'ARROWS / WASD  --  move' },
  { phrase: 'every rose grows one thorn', key: 'X or SPACE  --  slash' },
  { phrase: 'be seed. be elsewhere.', key: 'Z or SHIFT  --  dash, untouchable' },
  { phrase: 'swallow the rain when it comes', key: 'C  --  use what you hold' },
  { phrase: 'a walled garden opens only when tended', key: 'doors bar until the room is clear' },
  { phrase: 'roots seek the deep dark', key: 'find the stairs >  — descend' },
  { phrase: 'one pot. one plant. choose.', key: 'touching a tool SWAPS what you hold' },
  { phrase: 'winter does not restore what summer spent', key: 'descending does NOT heal you' },
  { phrase: 'endure winter. rise again.', key: 'M mute    R restart    L memories' },
];
const vineX = t => 80 + Math.sin(t * 5.2) * 10 + Math.sin(t * 11) * 3;
const vineY = t => 82 - t * 64;
function drawHowto(dt) {
  G.howT = (G.howT || 0) + dt;
  plasma(G.t * 0.06, 0.08, [4, 6, 1]);
  A.textC(6, 'HOW A PLANT HEARS THE RULES', 4);
  A.textC(8, 'the same rules. slower. greener.', 1, 0.5);
  const pts = 110;
  const grown = Math.min(pts, G.howT * 42);
  // roots first: a seed remembers downward
  for (let i = 0; i < 5; i++) px(80 + (i - 2) * 2, 83 + (i % 2), 1, 0.25 * Math.min(1, G.howT * 2));
  for (let i = 0; i < grown; i++) {
    const t = i / pts;
    const sway = Math.sin(G.t * 1.4 + t * 6) * (t * 1.6); // alive, not drawn once
    px(vineX(t) + sway, vineY(t), 4, 0.5 + 0.3 * Math.sin(i * 0.7));
    if (i % 6 === 3) { // leaves unfurl as they age
      const age = Math.min(1, (grown - i) / 25);
      const side = (i % 12 === 3) ? 1 : -1;
      for (let k = 1; k <= Math.round(2 * age) + 1; k++) {
        px(vineX(t) + sway + side * k, vineY(t) - (k > 2 ? 1 : 0), 4, 0.35 * age);
      }
    }
  }
  GROW_NODES.forEach((nd, i) => {
    const ni = (0.10 + i * 0.098) * pts; // stem index where this one blooms
    if (grown < ni) { nd.bloomed = false; return; }
    const t = ni / pts;
    const x = vineX(t), y = vineY(t);
    const side = i % 2 ? -1 : 1;
    const bx = x + side * 8;
    const age = (grown - ni) / 30; // seconds since bloom
    if (!nd.bloomed) { nd.bloomed = true; A.startGlitch(0.35, 0.18); tone(300 + i * 90, 360 + i * 90, 0.35, 'triangle', 0.06); }
    for (let k = 1; k < 8; k++) px(x + side * k, y, 4, 0.5); // branch reaches out
    const r = Math.min(2.6, age * 5); // petals open
    for (let pt2 = 0; pt2 < 6; pt2++) {
      const a = pt2 / 6 * Math.PI * 2 + G.t * 0.6;
      px(bx + Math.cos(a) * r, y + Math.sin(a) * r * 0.8, [2, 8, 5][i % 3], 0.8);
    }
    px(bx, y, 5, 1);
    const w = Math.max(nd.phrase.length + 2, nd.key.length);
    const tx = side === 1 ? bx + 6 : bx - 6 - w;
    typeText(y - 1, '"' + nd.phrase + '"', 4, age, 20, 0.9, tx);
    const keyAt = age - (nd.phrase.length + 2) / 20 - 0.25;
    if (keyAt > 0) A.text(tx, y + 1, nd.key, 0, Math.min(1, keyAt * 2.5));
  });
  if (grown >= pts && ((G.t * 1.5) | 0) % 2 === 0) A.textC(88, '- ANY KEY: PHOTOSYNTHESIZE -', 5);
}
window.__fps = 0;
window.G = G; // exposed for the /tdd-fun bot harness (bot.js) and headless verification

// Boons must be EARNED THIS RUN: standing alone is not enough, or floor-1 suicide laps
// buy permanent god-mode (exploit-hunter seat, 2026-07-20). Curses need no such gate —
// punishment should never be dodgeable by dying early.
const BOON_DEPTH_GATE = 3;
const boon = id => P.boonActive(G.favor, id) && (G.run ? G.run.floors >= BOON_DEPTH_GATE : false);
const curse = id => P.curseActive(G.favor, id);
// favor drifts back toward the middle between runs: the gods forget a little
function decayFavor(favor) {
  const out = {};
  for (const g of P.GODS) out[g.id] = Math.round(favor[g.id] + (P.START_FAVOR - favor[g.id]) * 0.3);
  return out;
}
function msg(text, ci = 5, t = 2) { G.msgs.push({ text, ci, t, t0: t }); }

function newRun() {
  G.favor = decayFavor(G.favor);
  localStorage.setItem(LS_FAVOR, JSON.stringify(G.favor));
  G.seed = (Math.random() * 0xffffff) | 0;
  G.rng = mulberry32(G.seed);
  G.depth = 1;
  // reset the run BEFORE reading boons: boon() consults G.run.floors, so the old run's
  // depth used to leak a phantom max-HP into the new one (refutation seat, 2026-07-20)
  G.run = { floors: 1, kills: 0, dmgTaken: 0, pickups: 0, score: 0, bonus: 0, hotdogs: 0, chests: 0, chalices: 0, stolen: 0, tufts: 0, spent: 0, pieces: 0 };
  const maxhp = 4 + (boon('umbra') ? FX.BOON_UMBRA : 0);
  G.player = {
    x: 80, y: 47, hp: maxhp, maxhp,
    dir: { x: 1, y: 0 }, spdMult: 1, swords: 0,
    dashT: 0, dashCd: 0, dashHadDanger: false,
    atkT: 0, atkCd: 0, invulnT: 0,
    held: null, digestT: 0, ivx: 0, ivy: 0, chaliceClean: false,
    chargeT: 0, orbitA: 0,
  };
  G.pbolts = []; G.stars = []; G.bat = null; G.booms = []; G.patches = [];
  G.morsUsed = false;
  G.state = 'play';
  genFloor();
}

// fold the floor's counters into the run's aggregates (called before the floor resets)
function foldFloor() {
  const f = G.floorStats, r = G.run;
  r.hotdogs += f.hotdogsEaten; r.chests += f.chestsOpened;
  r.chalices += f.chaliceDelivered; r.stolen += f.itemsStolen;
  r.tufts += f.tuftsCut; r.spent += f.spent;
}

function floorStatsInit(roomCount) {
  return {
    time: 0, roomCount, kills: 0, interrupts: 0, dmgTaken: 0, dashThroughs: 0,
    pickups: 0, treasureFound: 0, idleT: 0, depth: G.depth,
    rangedKills: 0, chestsOpened: 0, hotdogsEaten: 0, chaliceDelivered: 0, itemsStolen: 0,
    tuftsCut: 0, spent: 0, heartPieces: 0,
  };
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
    } else if (rng() < 0.28) { // occasional loop — the graph isn't a pure tree
      r.doors[d1] = true; rooms.get(k).doors[d2] = true;
    }
  }
  // a couple of extra procedural edges: "this door goes somewhere different this run"
  const roomArr = [...rooms.values()];
  for (let extra = 0; extra < 2; extra++) {
    const a2 = roomArr[(rng() * roomArr.length) | 0];
    for (const [dx, dy, d1, d2] of dirs) {
      const k = (a2.gx + dx) + ',' + (a2.gy + dy);
      if (rooms.has(k) && !a2.doors[d1]) { a2.doors[d1] = true; rooms.get(k).doors[d2] = true; break; }
    }
  }
  // BFS farthest room = stairs
  const start = rooms.get('0,0');
  start.type = G.depth === 1 ? 'armory' : 'start'; start.cleared = true; start.spawned = true;
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
  // the treasure room must not sit next to the start, or the run opens combat-free
  const others = [...rooms.values()].filter(r => r.type === 'fight' && (dist.get(r.gx + ',' + r.gy) || 0) >= 2);
  const anyFight = [...rooms.values()].filter(r => r.type === 'fight');
  const pool = others.length ? others : anyFight;
  if (pool.length > 1 || (pool.length === 1 && anyFight.length > 1)) {
    const t = pool[(rng() * pool.length) | 0];
    t.type = 'treasure'; t.cleared = true; t.spawned = true;
  }
  // room heuristics + persistent per-room item lists
  // Mutators are drawn from a shuffled BAG without replacement, so a run can't hide
  // THE TOLL behind bad luck and can't show you RUBBER four times before FOUNTAIN once.
  if (!G.mutBag || !G.mutBag.length) G.mutBag = shuffle(Object.keys(MUT), rng);
  // Architecture is also bagged: every floor feels like a different building.
  if (!G.archBag || !G.archBag.length) G.archBag = shuffle(ARCH_KEYS, rng);
  for (const r of rooms.values()) {
    r.items = [];
    r.arch = G.archBag.length ? G.archBag.pop() : ARCH_KEYS[(rng() * ARCH_KEYS.length) | 0];
    if (!G.archBag.length) G.archBag = shuffle(ARCH_KEYS, rng);
    r.mut = (r.type === 'fight' || r.type === 'stairs') && rng() < 0.65 ? G.mutBag.pop() : null;
    if (!G.mutBag.length) G.mutBag = shuffle(Object.keys(MUT), rng);
  }
  // every floor is guaranteed one room that asks a question, not just a fight
  const eligible = [...rooms.values()].filter(r => r.type === 'fight');
  if (eligible.length && !eligible.some(r => ['TOLL', 'FOUNTAIN', 'HUNGRY', 'ORDER'].includes(r.mut))) {
    eligible[(rng() * eligible.length) | 0].mut = ['TOLL', 'FOUNTAIN', 'HUNGRY', 'ORDER'][(rng() * 4) | 0];
  }
  // guarantee a hot fight room adjacent to the start: the game opens in combat
  const startAdj = [...rooms.values()].filter(r => (dist.get(r.gx + ',' + r.gy) || 99) === 1);
  const hotAdjacent = startAdj.find(r => r.type === 'fight' && r.mut !== 'TOLL');
  if (!hotAdjacent && startAdj.length) {
    const pick = startAdj[0];
    pick.type = 'fight'; pick.cleared = false; pick.spawned = false;
    if (pick.mut === 'TOLL') pick.mut = null;
  }
  // challenge objects: key + chest pair from depth 2 (cross-room carrying), one tool, rare chalice
  // spawn points must respect the TARGET room's own architecture, not the current bounds
  const spot = r => {
    const [ix2, iy2] = (ARCH[r.arch] || ARCH.CAVE).inset;
    const rx0 = 1 + ix2, rx1 = COLS - 2 - ix2, ry0 = 5 + iy2, ry1 = ROWS - 2 - iy2;
    return [rx0 + 8 + rng() * Math.max(4, rx1 - rx0 - 16), ry0 + 6 + rng() * Math.max(4, ry1 - ry0 - 12)];
  };
  const fights = [...rooms.values()].filter(r => r.type === 'fight');
  if (fights.length >= 2) { // key+chest from floor 1: the reward loop starts immediately
    const ka = fights[(rng() * fights.length) | 0];
    let cb = fights[(rng() * fights.length) | 0];
    if (cb === ka) cb = fights[(fights.indexOf(ka) + 1) % fights.length];
    const [kx, ky] = spot(ka);
    ka.items.push({ x: kx, y: ky, kind: 'key', slot: true, ph: 0 });
    const [cx, cy] = spot(cb);
    cb.chest = { x: cx, y: cy, opened: false };
  }
  const toolRoom = [...rooms.values()][(rng() * rooms.size) | 0];
  const [tx, ty] = spot(toolRoom);
  // TWO tools per floor: with one hands slot, the second one is a real decision
  const toolBag = shuffle(['gun', 'star', 'hotdog', 'lantern', 'bomb'], rng);
  const allRooms = [...rooms.values()];
  for (let i = 0; i < 2; i++) {
    const rm = i === 0 ? toolRoom : allRooms[(rng() * allRooms.length) | 0];
    const [sx2, sy2] = spot(rm);
    const kind = toolBag[i];
    rm.items.push({ x: sx2, y: sy2, kind, slot: true, ph: 0, ammo: kind === 'bomb' ? 3 : 6 });
  }
  if (G.depth % 3 === 0) {
    const cr = fights.length ? fights[(rng() * fights.length) | 0] : start;
    const [gx, gy] = spot(cr);
    cr.items.push({ x: gx, y: gy, kind: 'chalice', slot: true, ph: 0 });
  }
  // a heart piece hides on every floor (4 quarters -> +1 max HP, capped at +2/run)
  if ((G.run.pieces || 0) < 8) {
    const prs = [...rooms.values()].filter(r => r.type !== 'start');
    const prm = prs[(rng() * prs.length) | 0];
    if (prm) { const [hx, hy] = spot(prm); prm.piece = { x: hx, y: hy }; }
  }
  G.rooms = rooms;
  G.floorStats = floorStatsInit(rooms.size);
  G.player.x = 80; G.player.y = 47;
  enterRoom(start, null);
  msg('FLOOR ' + G.depth, 5, 2.2);
}

function enterRoom(room, fromDir) {
  G.cur = room;
  G.enemies = []; G.bolts = []; G.parts = G.parts || [];
  G.pickups = room.items || (room.items = []); // persistent: dropped items stay put
  G.pbolts = []; G.stars = []; G.bombs = []; G.booms = []; G.patches = []; G.bat = null; G.hungry = null; G.pool = null; G.ordNext = 1;
  G.doorOpenAt = 0;
  const woods = room.mut === 'WOODS'; // Lost Woods: no edge walls, the screen wraps
  // this room's architecture decides how big it is and what shape it takes
  const arch = ARCH[room.arch] || ARCH.CAVE;
  const [ix, iy] = arch.inset;
  X0 = 1 + ix; X1 = COLS - 2 - ix; Y0 = 5 + iy; Y1 = ROWS - 2 - iy;
  G.X0 = X0; G.X1 = X1; G.Y0 = Y0; G.Y1 = Y1; // exposed for the bot harness
  G.arch = arch;
  G.growT = 0; // walls grow in like the tutorial vine
  // Place the player relative to THIS room's bounds — rooms differ in size now, so a
  // position computed from the previous room can land outside the new walls.
  if (fromDir) {
    const p0 = G.player;
    if (fromDir === 'n') { p0.y = Y1 - 5; p0.x = (X0 + X1) / 2; }
    if (fromDir === 's') { p0.y = Y0 + 5; p0.x = (X0 + X1) / 2; }
    if (fromDir === 'w') { p0.x = X1 - 5; p0.y = (Y0 + Y1) / 2; }
    if (fromDir === 'e') { p0.x = X0 + 5; p0.y = (Y0 + Y1) / 2; }
  } else {
    G.player.x = (X0 + X1) / 2; G.player.y = (Y0 + Y1) / 2;
  }
  const rng = mulberry32(room.seed);
  // walls + pillars
  const solid = new Uint8Array(COLS * ROWS);
  const walls = [];
  const doorAt = (side, i) => {
    const mid = side === 'n' || side === 's' ? (X0 + X1) / 2 : (Y0 + Y1) / 2;
    return Math.abs(i - mid) <= DOOR / 2;
  };
  if (!woods) {
    for (let x = X0; x <= X1; x++) {
      if (!(room.doors.n && doorAt('n', x))) { solid[Y0 * COLS + x] = 1; walls.push([x, Y0]); }
      if (!(room.doors.s && doorAt('s', x))) { solid[Y1 * COLS + x] = 1; walls.push([x, Y1]); }
    }
    for (let y = Y0; y <= Y1; y++) {
      if (!(room.doors.w && doorAt('w', y))) { solid[y * COLS + X0] = 1; walls.push([X0, y]); }
      if (!(room.doors.e && doorAt('e', y))) { solid[y * COLS + X1] = 1; walls.push([X1, y]); }
    }
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
  // interior architecture: each room type builds its own furniture
  const put = (x, y) => {
    x |= 0; y |= 0;
    if (x <= X0 || x >= X1 || y <= Y0 || y >= Y1) return;
    if (Math.abs(x - 80) < 7 && Math.abs(y - 47) < 5) return; // never wall in the entry
    if (solid[y * COLS + x]) return;
    solid[y * COLS + x] = 1; walls.push([x, y]);
  };
  const cx = (X0 + X1) / 2, cy = (Y0 + Y1) / 2;
  if (room.arch === 'TEMPLE') {
    // Greek colonnade: two rows of fluted columns with capitals
    for (const row of [Y0 + 7, Y1 - 9]) {
      for (let c = 0; c < 6; c++) {
        const x = X0 + 8 + c * ((X1 - X0 - 16) / 5);
        for (let h = 0; h < 6; h++) { put(x, row + h); put(x + 1, row + h); }
        for (let k = -2; k <= 3; k++) { put(x + k, row - 1); put(x + k, row + 6); } // capital + base
      }
    }
  } else if (room.arch === 'ROTUNDA') {
    // a ring of columns around an open center
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * Math.PI * 2;
      const rx = cx + Math.cos(a) * (X1 - X0) * 0.34, ry = cy + Math.sin(a) * (Y1 - Y0) * 0.34;
      for (let h = 0; h < 3; h++) { put(rx, ry + h - 1); put(rx + 1, ry + h - 1); }
    }
  } else if (room.arch === 'CATHEDRAL') {
    // tall narrow nave: buttresses down both long walls
    for (let y = Y0 + 6; y < Y1 - 4; y += 7) {
      for (let k = 0; k < 5; k++) { put(X0 + 2 + k, y); put(X1 - 2 - k, y); }
    }
  } else if (room.arch === 'HALL') {
    // a long hall wants obstacles you weave through, not blobs
    for (let c = 0; c < 5; c++) {
      const x = X0 + 14 + c * ((X1 - X0 - 28) / 4);
      const up = c % 2 === 0;
      for (let h = 0; h < 5; h++) put(x, up ? Y0 + 2 + h : Y1 - 2 - h);
    }
  } else if (room.arch === 'CRYPT') {
    // tight room, a few sarcophagi
    for (let i = 0; i < 3; i++) {
      const x = X0 + 6 + ((rng() * (X1 - X0 - 14)) | 0), y = Y0 + 4 + ((rng() * (Y1 - Y0 - 9)) | 0);
      for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 6; xx++) put(x + xx, y + yy);
    }
  } else if (room.arch === 'LABYRINTH') {
    // a maze of SHORT offset walls (max run 6) with wide lanes — never a soft-lock
    for (let gy = Y0 + 5; gy < Y1 - 4; gy += 6) {
      let x = X0 + 4 + ((rng() * 8) | 0);
      while (x < X1 - 4) {
        const len = 3 + ((rng() * 4) | 0); // <= 6 cells
        for (let k = 0; k < len; k++) put(x + k, gy);
        x += len + 7 + ((rng() * 6) | 0);
      }
    }
  } else if (room.arch === 'AQUEDUCT') {
    // parallel channel walls with WIDE arch gaps enemies can path through (14-cell gaps)
    for (const gy of [cy - 8, cy + 8]) {
      for (let x = X0 + 3; x < X1 - 3; x++) {
        if ((x - X0) % 20 < 6) { put(x, gy); put(x, gy + 1); } // 6 solid, 14 open
      }
    }
  } else if (room.arch === 'BONEYARD') {
    // scattered bone-pillar clusters, wide and sparse
    for (let i = 0; i < 7; i++) {
      const x = X0 + 6 + rng() * (X1 - X0 - 12), y = Y0 + 5 + rng() * (Y1 - Y0 - 10);
      put(x, y); put(x + 1, y); put(x, y + 1); put(x - 1, y); put(x, y - 1);
      if (rng() < 0.5) put(x + 1, y + 1);
    }
  } else if (room.arch === 'OBSERVATORY') {
    // a wide dome: columns spiralling inward
    for (let i = 0; i < 26; i++) {
      const a = i * 0.62, r = 6 + i * 1.4;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.62;
      if (Math.hypot(x - 80, y - 47) > 8) { put(x, y); if (i % 2) put(x, y - 1); }
    }
  } else {
    // CAVE / GARDEN / GROTTO / THORNWOOD: organic blobs grown from a seed point (vine logic, in rock)
    const nb = (room.arch === 'THORNWOOD' ? 5 : 3) + ((rng() * 3) | 0);
    for (let b = 0; b < nb; b++) {
      let bx = X0 + 10 + rng() * (X1 - X0 - 20), by = Y0 + 6 + rng() * (Y1 - Y0 - 12);
      const len = 14 + ((rng() * 22) | 0);
      let ang = rng() * Math.PI * 2;
      for (let s = 0; s < len; s++) {
        ang += (rng() - 0.5) * 0.9;
        bx += Math.cos(ang) * 1.6; by += Math.sin(ang) * 1.1;
        put(bx, by);
        if (rng() < 0.5) put(bx + 1, by);
        if (rng() < 0.3) put(bx, by + 1);
      }
    }
  }
  // floor speckle
  const speckles = [];
  for (let i = 0; i < 550; i++) {
    speckles.push([X0 + 1 + rng() * (X1 - X0 - 2), Y0 + 1 + rng() * (Y1 - Y0 - 2), 0.1 + rng() * 0.25]);
  }
  // bombed pillar cells stay bombed
  let wallsFinal = walls;
  if (room.blasted && room.blasted.size) {
    for (const k of room.blasted) { const [bcx, bcy] = k.split(',').map(Number); solid[bcy * COLS + bcx] = 0; }
    wallsFinal = walls.filter(([wx, wy]) => !room.blasted.has(wx + ',' + wy));
  }
  G.solid = solid; G.walls = wallsFinal; G.bars = bars; G.speckles = speckles;

  if (room.type === 'treasure' && !room.entered) {
    G.floorStats.treasureFound++;
    spawnPickup(80, 47, ['heart', 'sword', 'boots'][(rng() * 3) | 0]);
  }
  room.entered = true;

  // the armory: the six signature weapons on pedestals, pick one (one slot)
  if (room.type === 'armory' && !room.armorySet) {
    room.armorySet = true;
    WEAPONS.forEach((w, i) => {
      const a = i / WEAPONS.length * Math.PI * 2 - Math.PI / 2;
      room.items.push({ x: 80 + Math.cos(a) * 22, y: 47 + Math.sin(a) * 15, kind: w, slot: true, ph: 0, ammo: w === 'sporebow' ? 8 : undefined, pedestal: true });
    });
  }

  // cuttable grass: every room grows a little; it does not grow back
  if (!room.tufts) {
    room.tufts = [];
    const n = 10 + ((rng() * 9) | 0);
    for (let i = 0; i < n; i++) {
      const tx = X0 + 4 + rng() * (X1 - X0 - 8), ty = Y0 + 4 + rng() * (Y1 - Y0 - 8);
      if (!solid[(ty | 0) * COLS + (tx | 0)]) room.tufts.push({ x: tx, y: ty });
    }
  }

  // THE TOLL: an old duck and his prices instead of a fight
  if (room.mut === 'TOLL' && !room.spawned) {
    room.spawned = true; room.cleared = true;
    const wares = [['hotdog', 80], ['heart', 60], ['star', 90], ['lantern', 70], ['gun', 120], ['sword', 150], ['bomb', 100]];
    room.goods = [];
    for (let i = 0; i < 2; i++) {
      const [k, base] = wares.splice((rng() * wares.length) | 0, 1)[0];
      room.goods.push({ x: 70 + i * 20, y: 50, kind: k, price: Math.round(base * (1 + 0.15 * G.depth)) });
    }
    room.merchant = { x: 80, y: 42 };
  }

  if (!room.spawned) {
    room.spawned = true;
    spawnEnemies(room, rng, fromDir);
  }
  // THE ORDER: numbered deaths
  if (room.mut === 'ORDER' && G.enemies.length) {
    G.enemies.forEach((e, i) => { e.ord = i + 1; });
    G.ordNext = 1;
  }
  // THE FOUNTAIN: contested water
  if (room.mut === 'FOUNTAIN') G.pool = { x: 80, y: 47, r: 7 };
  // THE HUNGRY ONE (never shares a room with the bat)
  if (room.mut === 'HUNGRY' && !room.cleared) {
    G.hungry = { x: X0 + 6, y: Y0 + 6, hp: 5, r: 3.2, swallowed: null, digestT: 0, ph: 0 };
  }
  G.locked = !room.cleared && G.enemies.length > 0;
  if (G.locked && !woods) for (const [x, y] of G.bars) G.solid[y * COLS + x] = 1;

  // dust motes: ambient drift, or wind-driven under SIDEWAYS GRAVITY
  G.windDir = null;
  if (room.mut === 'SIDEGRAV') {
    const dirs2 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    G.windDir = dirs2[room.seed % 4];
  }
  // living vines for organic rooms (cave/garden) — same growth grammar as the tutorial
  G.vines = [];
  if (arch.org) {
    const nv = arch.name === 'garden' ? 14 : 6;
    for (let i = 0; i < nv; i++) {
      const side = rng() < 0.5;
      G.vines.push({
        x: X0 + 3 + rng() * (X1 - X0 - 6),
        y: side ? Y1 - 1 : Y0 + 1 + (Y1 - Y0) * 0.55,
        h: (side ? 1 : -1) * (6 + rng() * 14), len: 18, ph: rng() * 6,
        bloom: rng() < 0.4,
      });
    }
  }
  G.motes = [];
  for (let i = 0; i < 42; i++) {
    G.motes.push({
      x: X0 + 2 + rng() * (X1 - X0 - 4), y: Y0 + 2 + rng() * (Y1 - Y0 - 4),
      vx: (rng() - 0.5) * 1.5, vy: (rng() - 0.5) * 1.5,
    });
  }
  // Adventure's item-stealing bat (the Hungry One hunts alone)
  if (G.depth >= 2 && room.type === 'fight' && room.mut !== 'HUNGRY' && rng() < 0.2) {
    G.bat = { x: rng() < 0.5 ? X0 + 2 : X1 - 2, y: Y0 + 6 + rng() * 20, ph: rng() * 6, carrying: null, hp: 1, leaveT: 9 };
  }
  // announce the room's wrongness
  if (!room.archSeen) { room.archSeen = true; msg('- ' + arch.name + ' -', arch.ci, 1.4); }
  if (room.mut && !room.mutSeen) {
    room.mutSeen = true;
    msg('THE ROOM IS WRONG: ' + MUT[room.mut].name, MUT[room.mut].ci, 2.6);
    msg(MUT[room.mut].desc, 1, 2.6);
    A.startGlitch(0.8, 0.35);
    tone(80, 40, 0.5, 'sawtooth', 0.1);
  }
}

function spawnEnemies(room, rng, fromDir) {
  let nDucks = 1 + Math.min(G.depth, 4) + (curse('pluma') ? FX.CURSE_PLUMA : 0);
  let nBats = G.depth >= 2 ? 1 + ((rng() * Math.min(G.depth, 3)) | 0) : 0;
  let nTurrets = G.depth >= 3 ? 1 + (G.depth >= 5 ? 1 : 0) : 0;
  if (room.mut === 'SWARM') { nDucks *= 2; nBats *= 2; } // half HP applied below
  // density cap: a tiny crypt/grotto can't fairly hold a full swarm (~1 enemy / 260 cells)
  const freeCells = (X1 - X0) * (Y1 - Y0);
  const cap = Math.max(3, Math.floor(freeCells / 260));
  { let total = nDucks + nBats + nTurrets; if (total > cap) { const s = cap / total; nDucks = Math.max(1, Math.round(nDucks * s)); nBats = Math.round(nBats * s); nTurrets = Math.round(nTurrets * s); } }
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
    if (type === 'duck') Object.assign(base, { hp: 3 + Math.floor(G.depth / 2), r: 3.2, spd: 5.5 + 0.5 * G.depth, ci: 2 });
    if (type === 'bat') Object.assign(base, { hp: 1 + Math.floor(G.depth / 4), r: 1.8, spd: 9 + 0.4 * G.depth, ci: 8, ph: rng() * 6 });
    if (type === 'turret') Object.assign(base, { hp: 4 + Math.floor(G.depth / 3), r: 2.6, spd: 0, ci: 4, cd: 1 + rng(), aimT: 0 });
    if (room.mut === 'SWARM') base.hp = Math.max(1, Math.ceil(base.hp / 2));
    base.hp0 = base.hp;
    G.enemies.push(base);
  };
  for (let i = 0; i < nDucks; i++) mk('duck');
  for (let i = 0; i < nBats; i++) mk('bat');
  for (let i = 0; i < nTurrets; i++) mk('turret');
}

function spawnPickup(x, y, kind) { G.pickups.push({ x, y, kind, ph: 0 }); }

// ---------- collision ----------
function solidAt(x, y) {
  if (x < X0 || x > X1 || y < Y0 || y > Y1) return !mut('WOODS'); // the woods have no edges
  return G.solid[(y | 0) * COLS + (x | 0)] === 1;
}
function wrapWoods(o) {
  if (!mut('WOODS')) return false;
  const W = X1 - X0, H = Y1 - Y0;
  let w = false;
  if (o.x < X0) { o.x += W; w = true; } else if (o.x > X1) { o.x -= W; w = true; }
  if (o.y < Y0) { o.y += H; w = true; } else if (o.y > Y1) { o.y -= H; w = true; }
  return w;
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
  const ts = mut('HASTE') ? 1.4 : mut('MOLASSES') ? 0.7 : 1; // room time-scale
  const base = 14 * p.spdMult * (boon('velox') ? FX.BOON_VELOX : 1);
  return {
    ts,
    spd: base * ts * (p.digestT > 0 ? 0.55 : 1),
    dashSpd: base * 3.1, // dash ignores MOLASSES — in the slow room, dash is king
    dmg: 1 + p.swords + (boon('pluma') ? FX.BOON_PLUMA : 0),
    dashCd: 0.45 * (curse('umbra') ? FX.CURSE_UMBRA : 1),
    kb: mut('RUBBER') ? 3 : mut('LOWGRAV') ? 2 : 1, // knockback scale for everyone
  };
}

function heldKind() { return G.player.held ? G.player.held.kind : null; }

function useItem() {
  const p = G.player;
  if (G.state !== 'play') return;
  // C at the merchant is a purchase, not an item use
  if (G.cur.goods && G.cur.goods.some(gd => !gd.dead && Math.hypot(gd.x - p.x, gd.y - p.y) <= 3)) {
    G.buyPressed = true;
    return;
  }
  if (!p.held) { msg('EMPTY HANDS', 1, 0.8); return; }
  const k = p.held.kind;
  if (k === 'gun') {
    p.held.ammo--;
    G.pbolts.push({ x: p.x + p.dir.x * 2.5, y: p.y + p.dir.y * 2.5, vx: p.dir.x * 34, vy: p.dir.y * 34 });
    G.shake = Math.max(G.shake, 1.2);
    tone(900, 120, 0.09, 'square', 0.12);
    if (p.held.ammo <= 0) { p.held = null; msg('GUN EMPTY', 1, 1.2); }
  } else if (k === 'bomb') {
    p.held.ammo--;
    G.bombs.push({ x: p.x + p.dir.x * 2, y: p.y + p.dir.y * 2, vx: p.dir.x * 16, vy: p.dir.y * 16, fuse: 1.2 });
    tone(400, 250, 0.08, 'triangle', 0.06);
    if (p.held.ammo <= 0) { p.held = null; msg('LAST BOMB', 1, 1.2); }
  } else if (k === 'star') {
    G.stars.push({ x: p.x, y: p.y, vx: p.dir.x * 28, vy: p.dir.y * 28, bounces: 0, hitCd: 0 });
    p.held = null;
    tone(500, 900, 0.08, 'triangle', 0.07);
  } else if (k === 'hotdog') {
    const heal = curse('mors') ? FX.CURSE_MORS : 1;
    if (heal > 0) { p.hp = p.maxhp; msg('HOTDOG: FULL HP. VELOX IS DISGUSTED.', 2, 2.2); }
    else msg('MORS: THE HOTDOG TASTES OF NOTHING', 1, 2);
    p.digestT = 4;
    G.floorStats.hotdogsEaten++;
    G.floorStats.idleT += 4; // VELOX bills digestion as idling
    p.held = null;
    SFX.pickup();
  } else if (ITEMS[k] && ITEMS[k].weapon) {
    // signature weapons attack with X (they own the attack + animation), not C
    if (!p.weaponHint) { p.weaponHint = true; msg('ATTACK WITH X / SPACE', ITEMS[k].ci, 1.4); }
  } else {
    msg(ITEMS[k].label + ': ' + ITEMS[k].hint, ITEMS[k].ci, 1.2);
  }
}

// Each signature weapon owns the X-attack: its own reach/cd/damage, LOS-gated, and a
// distinct color-matched animation (WFX). No base sword layered underneath.
function weaponAttack(kind) {
  const p = G.player;
  if (p.atkCd > 0) return;
  const w = WEAPON_STATS[kind];
  p.atkCd = w.cd;
  const baseA = Math.atan2(p.dir.y, p.dir.x);
  if (kind === 'rapier') {
    // fast precise short stab — reuse the base slash arc but on rapier reach/cd
    slashCore(w.reach, w.dmg, 0.35);
    G.wfx = { kind, a: baseA, t: 0.10, reach: w.reach };
    SFX.slash();
  } else if (kind === 'whip') {
    const jitter = (Math.random() - 0.5) * 0.98; // ±28° wild aim
    const a = baseA + jitter;
    let hit = false;
    for (const e of G.enemies) {
      if (e.telegraph > 0) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < 4 || d > w.reach) continue; // dead zone + max reach
      if (losBlocked(p.x, p.y, e.x, e.y)) continue;
      if (Math.abs(angDiff(Math.atan2(e.y - p.y, e.x - p.x), a)) < 0.24) {
        e.hp -= w.dmg; e.flash = 0.15; e.kx = (e.x - p.x) / d * 30; e.ky = (e.y - p.y) / d * 30; burst(e.x, e.y, e.ci, 6, 14, 0.3); hit = true; if (e.hp <= 0) killEnemy(e, 'melee');
      }
    }
    G.wfx = { kind, a, t: 0.18, reach: w.reach };
    G.shake = Math.max(G.shake, 1); tone(1400, 300, 0.07, 'sawtooth', 0.06); if (hit) SFX.hit();
  } else if (kind === 'flail') {
    // the flail's damage is its passive orbit (updatePlay); X is a flourish burst that
    // sweeps the FRONT arc harder — you must face the threat
    for (const e of G.enemies) {
      if (e.telegraph > 0) continue;
      const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
      if (d > w.reach + 1) continue;
      if ((dx * p.dir.x + dy * p.dir.y) / d < 0) continue; // front only
      if (losBlocked(p.x, p.y, e.x, e.y)) continue;
      e.hp -= w.dmg; e.flash = 0.15; e.kx = dx / d * 40; e.ky = dy / d * 40; burst(e.x, e.y, e.ci, 6, 16, 0.3); if (e.hp <= 0) killEnemy(e, 'melee');
    }
    G.wfx = { kind, a: baseA, t: 0.2, reach: w.reach };
    tone(600, 300, 0.08, 'square', 0.06);
  } else if (kind === 'boomerang') {
    if (G.booms.length) return;
    G.booms.push({ x: p.x, y: p.y, vx: p.dir.x * 30, vy: p.dir.y * 30, t: 0, back: false, hitCd: {}, dmg: w.dmg });
    G.wfx = { kind, a: baseA, t: 0.15, reach: w.reach };
    tone(600, 900, 0.1, 'triangle', 0.06);
  } else if (kind === 'sporebow') {
    if ((p.held.ammo || 0) <= 0) { msg('SPORE-BOW EMPTY (clear a room to grow)', 1, 1.2); return; }
    p.held.ammo--;
    G.booms.push({ spore: true, x: p.x, y: p.y, vx: p.dir.x * 22, vy: p.dir.y * 22, vz: 8, z: 0, dmg: w.dmg });
    G.wfx = { kind, a: baseA, t: 0.2, reach: w.reach };
    tone(300, 500, 0.12, 'triangle', 0.05);
  }
}

// shared arc hit used by base slash + rapier (LOS-gated)
function slashCore(reach, dmg, dot0) {
  const p = G.player;
  let hitAny = false;
  for (const e of G.enemies) {
    if (e.telegraph > 0) continue;
    const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy);
    if (d > reach) continue;
    if ((dx * p.dir.x + dy * p.dir.y) / (d || 1) < dot0) continue;
    if (losBlocked(p.x, p.y, e.x, e.y)) continue;
    if (ironBlocked(e, p.x, p.y)) { clink(e); hitAny = true; continue; }
    e.hp -= dmg; e.flash = 0.15; hitAny = true;
    if (e.state === 'windup') { G.floorStats.interrupts++; e.state = 'recover'; e.st = 0.5; msg('INTERRUPTED', 3, 0.7); }
    e.kx = dx / (d || 1) * 40 * playerStats().kb; e.ky = dy / (d || 1) * 40 * playerStats().kb;
    burst(e.x, e.y, e.ci, 8, 18, 0.4);
    if (e.hp <= 0) killEnemy(e, 'melee');
  }
  if (hitAny) { G.hitstop = 0.05; G.shake = Math.max(G.shake, 1.5); SFX.hit(); }
  return hitAny;
}

// HAMMER: charged overhead smash — big arc, damage scales with charge, stuns
function hammerSmash(charge) {
  const p = G.player;
  p.atkCd = WEAPON_STATS.hammer.cd; // the smash cannot be spammed
  const dmg = Math.round(2 + charge * 3); // 2..5 by charge
  const reach = WEAPON_STATS.hammer.reach * (0.7 + charge * 0.3);
  let hit = false;
  for (const e of G.enemies) {
    if (e.telegraph > 0) continue;
    const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
    if (d > reach) continue;
    if ((dx * p.dir.x + dy * p.dir.y) / d < 0) continue; // front arc
    if (losBlocked(p.x, p.y, e.x, e.y)) continue; // walls stop the hammer too
    e.hp -= dmg; e.flash = 0.2; e.state = 'recover'; e.st = 0.4; // stun
    e.kx = dx / d * 70; e.ky = dy / d * 70;
    burst(e.x, e.y, e.ci, 14, 24, 0.5); hit = true;
    if (e.hp <= 0) killEnemy(e, 'melee');
  }
  G.wfx = { kind: 'hammer', a: Math.atan2(p.dir.y, p.dir.x), t: 0.25, reach };
  G.smashFx = { x: p.x + p.dir.x * reach * 0.6, y: p.y + p.dir.y * reach * 0.6, r: reach, t: 0.25 };
  G.shake = Math.max(G.shake, 3 + charge * 3); G.hitstop = Math.max(G.hitstop, 0.08);
  A.startGlitch(0.5 + charge * 0.4, 0.25, 'pop');
  tone(90, 40, 0.35, 'sawtooth', 0.16); tone(160, 30, 0.3, 'square', 0.1, 0.02);
  if (hit) SFX.kill();
}

function hurtPlayer(from) {
  const p = G.player;
  if (p.invulnT > 0 || p.dashT > 0) return;
  p.hp -= 1;
  G.run.dmgTaken++; G.floorStats.dmgTaken++;
  p.invulnT = 1.0;
  p.chaliceClean = false; // the chalice felt that
  // an orb shatters: harder shake the lower you go, a burst of blue where it was
  G.shake = 4 + (p.maxhp - p.hp); G.flash = 0.2; G.hitstop = 0.1;
  const oa = p.hp / Math.max(1, p.maxhp) * Math.PI * 2 + G.t;
  burst(p.x + Math.cos(oa) * 6, p.y + Math.sin(oa) * 4, 6, 20, 22, 0.6);
  tone(300, 80, 0.2, 'sine', 0.12);
  A.startGlitch(1.0, 0.35, 'chroma');
  const st = playerStats();
  const kb = Math.hypot(p.x - from.x, p.y - from.y) || 1;
  p.kx = (p.x - from.x) / kb * 30 * st.kb; p.ky = (p.y - from.y) / kb * 30 * st.kb;
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
  foldFloor();
  G.run.score = G.run.floors * 100 + G.run.kills * 10 + (G.run.bonus || 0);
  if (G.run.score > G.best) { G.best = G.run.score; localStorage.setItem(LS_BEST, G.best); }
  G.epitaph = P.epitaph({ ...G.run, score: G.run.score }, G.best);
  // the ledger remembers; memories surface when they are earned
  const led = G.ledger;
  const before = new Set(P.unlockedLore(led).map(f => f.id));
  led.runs++; led.deaths++;
  led.totalKills += G.run.kills;
  led.deepest = Math.max(led.deepest, G.run.floors);
  led.bestScore = Math.max(led.bestScore, G.run.score);
  if (G.run.floors <= 1) led.floor1Deaths++;
  led.totalHotdogs += G.run.hotdogs; led.totalChests += G.run.chests;
  led.totalChalices += G.run.chalices; led.totalStolen += G.run.stolen;
  led.totalTufts += G.run.tufts; led.totalSpent += G.run.spent; led.totalPieces += G.run.pieces;
  led.lastRuns.unshift({ f: G.run.floors, k: G.run.kills, s: G.run.score });
  led.lastRuns.splice(5);
  const after = P.unlockedLore(led);
  const fresh = after.filter(f => !before.has(f.id));
  G.whisperNew = fresh.length > 0;
  G.whisper = fresh.length ? fresh[0].text
    : after.length ? after[(Math.random() * after.length) | 0].text : '';
  saveLedger();
  G.state = 'dead'; G.deadT = 0;
  G.shake = 6; G.flash = 0.6;
  burst(G.player.x, G.player.y, 7, 60, 30, 1.2);
  SFX.die();
}

function slash() {
  const p = G.player, st = playerStats();
  if (p.atkCd > 0) return;
  const rapier = heldKind() === 'rapier';
  p.atkCd = rapier ? 0.10 : 0.22; p.atkT = rapier ? 0.09 : 0.13; // rapier: fast, precise
  const reach = rapier ? 5 : SLASH_REACH;
  SFX.slash();
  let hitAny = false;
  // cuttable grass: the slash is never wasted
  if (G.cur.tufts) for (const tf of G.cur.tufts) {
    const dx = tf.x - p.x, dy = tf.y - p.y, d = Math.hypot(dx, dy);
    if (d > SLASH_REACH || (dx * p.dir.x + dy * p.dir.y) / (d || 1) < 0.35) continue;
    tf.dead = true;
    G.floorStats.tuftsCut++;
    burst(tf.x, tf.y, 4, 5, 10, 0.35);
    const roll = Math.random();
    if (roll < 0.22) { G.run.bonus = (G.run.bonus || 0) + 2; G.parts.push({ x: tf.x, y: tf.y, vx: 0, vy: -6, ci: 5, life: 0.6, t: 0 }); }
    else if (roll < 0.3 && !G.floorStats.grassHeart) { G.floorStats.grassHeart = true; G.pickups.push({ x: tf.x, y: tf.y, kind: 'heart', ph: 0 }); }
  }
  if (G.cur.tufts) G.cur.tufts = G.cur.tufts.filter(tf => !tf.dead);
  // the Hungry One can be cut open
  if (G.hungry) {
    const h = G.hungry;
    const dx = h.x - p.x, dy = h.y - p.y, d = Math.hypot(dx, dy);
    if (d < SLASH_REACH && (dx * p.dir.x + dy * p.dir.y) / (d || 1) > 0.35) {
      h.hp -= st.dmg; hitAny = true;
      burst(h.x, h.y, 8, 8, 14, 0.4);
      if (h.hp <= 0) {
        if (h.swallowed) { G.pickups.push({ x: h.x, y: h.y, kind: h.swallowed.kind, ammo: h.swallowed.ammo, slot: true, ph: 0, cd: 0.5 }); msg('IT SPITS IT OUT', 5, 1.6); }
        burst(h.x, h.y, 8, 24, 20, 0.7);
        G.floorStats.kills++; G.run.kills++;
        G.hungry = null; SFX.kill();
      }
    }
  }
  for (const e of G.enemies) {
    if (e.telegraph > 0) continue;
    const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy);
    if (d > reach) continue;
    const dot = (dx * p.dir.x + dy * p.dir.y) / (d || 1);
    if (dot < 0.35) continue;
    if (losBlocked(p.x, p.y, e.x, e.y)) continue; // no killing through pillars
    if (ironBlocked(e, p.x, p.y)) { clink(e); hitAny = true; continue; } // IRONFRONT
    e.hp -= st.dmg; e.flash = 0.15; hitAny = true;
    if (e.state === 'windup') { G.floorStats.interrupts++; e.state = 'recover'; e.st = 0.5; msg('INTERRUPTED', 3, 0.7); }
    e.kx = dx / (d || 1) * 40 * st.kb; e.ky = dy / (d || 1) * 40 * st.kb;
    burst(e.x, e.y, e.ci, 8, 18, 0.4);
    if (e.hp <= 0) killEnemy(e, 'melee');
  }
  // the thieving bat can be cut down
  const b = G.bat;
  if (b) {
    const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy);
    if (d < SLASH_REACH && (dx * p.dir.x + dy * p.dir.y) / (d || 1) > 0.35) {
      if (b.carrying) { G.pickups.push({ x: b.x, y: b.y, kind: b.carrying.kind, ammo: b.carrying.ammo, slot: true, ph: 0, cd: 0.6 }); msg('IT DROPPED YOUR ' + ITEMS[b.carrying.kind].label, 5, 1.6); }
      burst(b.x, b.y, 5, 18, 20, 0.6);
      G.floorStats.kills++; G.run.kills++;
      G.bat = null; hitAny = true;
      SFX.kill();
    }
  }
  if (hitAny) { G.hitstop = 0.05; G.shake = Math.max(G.shake, 1.5); SFX.hit(); }
}

function killEnemy(e, how = 'melee') {
  // THE ORDER: die out of turn and the death is refused
  if (mut('ORDER') && e.ord) {
    if (e.ord !== G.ordNext) {
      e.hp = Math.max(1, Math.ceil((e.hp0 || 2) / 2));
      for (let tries = 0; tries < 30; tries++) {
        const nx = X0 + 5 + Math.random() * (X1 - X0 - 10), ny = Y0 + 5 + Math.random() * (Y1 - Y0 - 10);
        if (!G.solid[(ny | 0) * COLS + (nx | 0)]) { e.x = nx; e.y = ny; break; }
      }
      e.telegraph = 0.6; e.state = 'seek'; e.st = 0.3;
      msg('no.', 1, 1.1);
      A.startGlitch(0.5, 0.2, 'scramble');
      tone(120, 55, 0.3, 'sawtooth', 0.1);
      return;
    }
    G.ordNext++;
  }
  e.dead = true;
  G.run.kills++; G.floorStats.kills++;
  if (how === 'ranged') G.floorStats.rangedKills++;
  // dissolve down the density ramp instead of popping
  const spr = SPR[e.type] ? SPR[e.type][0] : null;
  if (spr) G.parts.push({ dissolve: spr, x: e.x - spr[0].length / 2, y: e.y - spr.length / 2, ci: e.ci, flip: e.vx > 0.5, t: 0, life: 0.55 });
  burst(e.x, e.y, e.ci, 16, 22, 0.7);
  burst(e.x, e.y, 0, 6, 14, 0.5);
  G.shake = Math.max(G.shake, 2.5);
  G.hitstop = Math.max(G.hitstop, 0.11); // reward must out-freeze punishment (hurt = 0.09)
  SFX.kill();
}

// the bomb does not respect iron faces, walls, or personal space
function explode(bx, by) {
  const R = 9;
  const p = G.player;
  burst(bx, by, 2, 30, 30, 0.8);
  burst(bx, by, 5, 20, 20, 0.6);
  burst(bx, by, 0, 12, 40, 0.4);
  G.shake = 6; G.flash = Math.max(G.flash, 0.35); G.hitstop = 0.06;
  A.startGlitch(1, 0.35, 'pop');
  tone(50, 18, 0.6, 'sawtooth', 0.22);
  tone(160, 25, 0.4, 'square', 0.12, 0.02);
  for (const e of G.enemies) {
    if (e.dead || e.telegraph > 0) continue;
    const d = Math.hypot(e.x - bx, e.y - by);
    if (d < R) { // no ironBlocked check: explosions do not care which way you face
      e.hp -= 3; e.flash = 0.2;
      e.kx = (e.x - bx) / (d || 1) * 60; e.ky = (e.y - by) / (d || 1) * 60;
      if (e.hp <= 0) killEnemy(e, 'ranged');
    }
  }
  if (G.hungry && Math.hypot(G.hungry.x - bx, G.hungry.y - by) < R) {
    if (G.hungry.swallowed) { G.pickups.push({ x: G.hungry.x, y: G.hungry.y, kind: G.hungry.swallowed.kind, ammo: G.hungry.swallowed.ammo, slot: true, ph: 0, cd: 0.5 }); msg('IT SPITS IT OUT', 5, 1.6); }
    G.floorStats.kills++; G.run.kills++; G.floorStats.rangedKills++;
    G.hungry = null;
  }
  if (G.bat && Math.hypot(G.bat.x - bx, G.bat.y - by) < R) {
    if (G.bat.carrying) G.pickups.push({ x: G.bat.x, y: G.bat.y, kind: G.bat.carrying.kind, ammo: G.bat.carrying.ammo, slot: true, ph: 0, cd: 0.6 });
    G.floorStats.kills++; G.run.kills++;
    G.bat = null;
  }
  if (Math.hypot(p.x - bx, p.y - by) < R * 0.75 && p.invulnT <= 0 && p.dashT <= 0) hurtPlayer({ x: bx, y: by });
  // pillar walls crumble and STAY crumbled (border walls hold)
  G.cur.blasted = G.cur.blasted || new Set();
  const gone = new Set();
  for (let y = Math.max(Y0 + 1, (by - R) | 0); y <= Math.min(Y1 - 1, (by + R) | 0); y++) {
    for (let x = Math.max(X0 + 1, (bx - R) | 0); x <= Math.min(X1 - 1, (bx + R) | 0); x++) {
      if (G.solid[y * COLS + x] && Math.hypot(x - bx, y - by) < R * 0.8) {
        G.solid[y * COLS + x] = 0;
        const k = x + ',' + y;
        G.cur.blasted.add(k); gone.add(k);
        burst(x, y, 1, 2, 12, 0.5);
      }
    }
  }
  if (gone.size) G.walls = G.walls.filter(([wx, wy]) => !gone.has(wx + ',' + wy));
  // the grass does not survive
  if (G.cur.tufts) G.cur.tufts = G.cur.tufts.filter(tf => Math.hypot(tf.x - bx, tf.y - by) >= R);
}

function roomCleared() {
  G.cur.cleared = true;
  // the spore-bow grows back a seed each cleared room, so it stays a weapon not a consumable
  const p = G.player;
  if (heldKind() === 'sporebow') p.held.ammo = Math.min(8, (p.held.ammo || 0) + 1);
  A.startGlitch(0.6, 0.25, 'pop');
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
    vx = p.dashDir.x * st.dashSpd; vy = p.dashDir.y * st.dashSpd;
    G.parts.push({ x: p.x, y: p.y, vx: 0, vy: 0, ci: 3, life: 0.25, t: 0, ghost: true });
    for (const e of G.enemies) if (!e.dead && Math.hypot(e.x - p.x, e.y - p.y) < 4) p.dashHadDanger = true;
    for (const b of G.bolts) if (Math.hypot(b.x - p.x, b.y - p.y) < 3) p.dashHadDanger = true;
    if (p.dashT <= 0 && p.dashHadDanger) { G.floorStats.dashThroughs++; msg('SLIPPED', 8, 0.6); }
  } else {
    vx = iv.x * st.spd; vy = iv.y * st.spd;
  }
  // LOW GRAVITY: velocity is chased, not set — icy inertial drift
  if (mut('LOWGRAV') && p.dashT <= 0) {
    const lerp = Math.min(1, dt * 3.2);
    p.ivx += (vx - p.ivx) * lerp; p.ivy += (vy - p.ivy) * lerp;
    vx = p.ivx; vy = p.ivy;
  } else { p.ivx = vx; p.ivy = vy; }
  // SIDEWAYS GRAVITY: the room pulls
  if (G.windDir) { vx += G.windDir[0] * 6; vy += G.windDir[1] * 6; }
  // knockback decay (floats farther in LOW GRAVITY)
  const decay = mut('LOWGRAV') ? 0.01 : 0.001;
  p.kx = (p.kx || 0) * Math.pow(decay, dt); p.ky = (p.ky || 0) * Math.pow(decay, dt);
  const preX = p.x, preY = p.y;
  tryMove(p, p.x + (vx + p.kx) * dt, p.y + (vy + p.ky) * dt, 1.3);
  if (mut('RUBBER')) { // walls bounce you
    if (p.x === preX && Math.abs(vx + p.kx) > 6) { p.kx = -(p.kx + vx * 0.5) * 0.8; p.ivx = -p.ivx; }
    if (p.y === preY && Math.abs(vy + p.ky) > 6) { p.ky = -(p.ky + vy * 0.5) * 0.8; p.ivy = -p.ivy; }
  }
  G.wrapCd = Math.max(0, (G.wrapCd || 0) - dt);
  if (wrapWoods(p)) { A.startGlitch(0.4, 0.12, 'shear'); G.wrapCd = 0.45; } // through the seam; don't chain into a door
  p.invulnT -= dt; p.atkCd -= dt; p.atkT -= dt;
  if (p.digestT > 0) p.digestT -= dt;

  const heldK = heldKind();
  const wpn = ITEMS[heldK] && ITEMS[heldK].weapon;
  // X/SPACE is the ATTACK button. A held weapon OWNS it (its own hit + animation);
  // bare-handed (or holding a non-weapon) you get the base sword. No free sword underneath.
  const atkPressed = keys['x'] || keys[' '];
  if (wpn) { if (heldK !== 'hammer') { if (atkPressed) weaponAttack(heldK); } }
  else if (atkPressed) slash();

  // HAMMER: hold X to charge, release to smash (its "attack" is the charge)
  if (heldK === 'hammer') {
    if (atkPressed) { p.chargeT = Math.min(1.2, p.chargeT + dt); p.charging = true; }
    else if (p.charging) { if (p.atkCd <= 0) hammerSmash(Math.min(1, p.chargeT / 1.2)); p.charging = false; p.chargeT = 0; }
    if (p.charging) { vx *= 0.6; vy *= 0.6; if (Math.random() < p.chargeT * 0.3) G.shake = Math.max(G.shake, p.chargeT * 1.5); }
  } else { p.charging = false; p.chargeT = 0; }
  // FLAIL: a head orbits you, sweeping enemies IN FRONT (you must face the threat)
  if (heldK === 'flail') {
    p.orbitA += dt * 6.5;
    const fx = p.x + Math.cos(p.orbitA) * 7, fy = p.y + Math.sin(p.orbitA) * 5;
    p.flailPos = { x: fx, y: fy };
    const fw = WEAPON_STATS.flail;
    for (const e of G.enemies) {
      if (e.telegraph > 0) continue;
      e.flailCd = Math.max(0, (e.flailCd || 0) - dt);
      const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
      const inFront = (dx * p.dir.x + dy * p.dir.y) / d > -0.2;
      if (e.flailCd <= 0 && inFront && !losBlocked(p.x, p.y, e.x, e.y) && Math.hypot(e.x - fx, e.y - fy) < e.r + 1.5) {
        e.hp -= fw.dmg; e.flash = 0.15; e.flailCd = fw.cd;
        e.kx = dx * 2.5; e.ky = dy * 2.5;
        burst(e.x, e.y, e.ci, 5, 12, 0.25); tone(700, 400, 0.05, 'square', 0.05);
        if (e.hp <= 0) killEnemy(e, 'melee');
      }
    }
  } else p.flailPos = null;
  if (G.wfx) { G.wfx.t -= dt; if (G.wfx.t <= 0) G.wfx = null; }
  if (G.smashFx) { G.smashFx.t -= dt; if (G.smashFx.t <= 0) G.smashFx = null; }

  // boomerangs + spore lobs
  for (const b of G.booms) {
    if (b.spore) {
      b.z += b.vz * dt; b.vz -= 26 * dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.z <= 0 || solidAt(b.x, b.y)) { b.dead = true; G.patches.push({ x: b.x, y: b.y, r: 6, t: 2 }); tone(200, 120, 0.15, 'sawtooth', 0.06); burst(b.x, b.y, 4, 16, 12, 0.5); }
      continue;
    }
    b.t += dt;
    if (!b.back && b.t > 0.4) { b.back = true; }
    if (b.back) { const dx = p.x - b.x, dy = p.y - b.y, d = Math.hypot(dx, dy) || 1; b.vx += dx / d * 120 * dt; b.vy += dy / d * 120 * dt; if (d < 3) { b.dead = true; p.thrown = false; } }
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (solidAt(b.x, b.y)) { b.vx *= -0.6; b.vy *= -0.6; b.back = true; }
    for (const e of G.enemies) {
      if (e.telegraph > 0) continue;
      b.hitCd[e.__i = e.__i || Math.random()] = Math.max(0, (b.hitCd[e.__i] || 0) - dt);
      if (b.hitCd[e.__i] <= 0 && Math.hypot(e.x - b.x, e.y - b.y) < e.r + 1) {
        e.hp -= (b.dmg || 2); e.flash = 0.15; b.hitCd[e.__i] = 0.3; burst(e.x, e.y, e.ci, 5, 12, 0.3);
        if (e.hp <= 0) killEnemy(e, 'ranged');
      }
    }
    if (b.t > 2.5) { b.dead = true; if (!b.spore) { G.pickups.push({ x: b.x, y: b.y, kind: 'boomerang', slot: true, ph: 0, cd: 0.4 }); p.thrown = false; } }
  }
  G.booms = G.booms.filter(b => !b.dead);
  // spore vine-patches damage what stands in them
  for (const pc of G.patches) {
    pc.t -= dt;
    for (const e of G.enemies) {
      if (e.telegraph > 0) continue;
      if (Math.hypot(e.x - pc.x, e.y - pc.y) < pc.r) { e.hp -= 3 * dt; if (e.hp <= 0) killEnemy(e, 'ranged'); }
    }
  }
  G.patches = G.patches.filter(pc => pc.t > 0);

  // enemies
  for (const e of G.enemies) {
    if (e.telegraph > 0) { e.telegraph -= dt; continue; }
    e.flash -= dt;
    e.kx = (e.kx || 0) * Math.pow(0.001, dt); e.ky = (e.ky || 0) * Math.pow(0.001, dt);
    const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
    // iron faces track you with a lag — dash around them
    const ta = Math.atan2(dy, dx);
    e.faceA = e.faceA === undefined ? ta : e.faceA + angDiff(ta, e.faceA) * Math.min(1, dt * 1.8);
    // PHASE: blink out, shimmer in elsewhere
    if (mut('PHASE')) {
      e.phaseT = (e.phaseT === undefined ? 1 + Math.random() : e.phaseT) - dt;
      if (e.phaseT <= 0) {
        burst(e.x, e.y, e.ci, 8, 14, 0.3);
        for (let tries = 0; tries < 30; tries++) {
          const nx = X0 + 5 + Math.random() * (X1 - X0 - 10), ny = Y0 + 5 + Math.random() * (Y1 - Y0 - 10);
          if (!G.solid[(ny | 0) * COLS + (nx | 0)]) { e.x = nx; e.y = ny; break; }
        }
        e.telegraph = 0.45; e.state = 'seek'; e.st = 0.2;
        e.phaseT = 1.6 + Math.random() * 0.8;
        continue;
      }
    }
    if (e.type === 'duck') {
      e.st -= dt;
      if (e.state === 'seek') {
        e.vx = dx / d * e.spd; e.vy = dy / d * e.spd;
        if (d < 14 && e.st <= 0) { e.state = 'windup'; e.st = 0.35; e.vx = e.vy = 0; }
      } else if (e.state === 'windup') {
        e.vx = e.vy = 0;
        if (e.st <= 0) { e.state = 'lunge'; e.st = LUNGE_TIME; e.lx = dx / d; e.ly = dy / d; }
      } else if (e.state === 'lunge') {
        e.vx = e.lx * e.spd * LUNGE_MULT; e.vy = e.ly * e.spd * LUNGE_MULT;
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
      // aim phase runs in REAL time so HASTE can't shrink your reaction window
      e.aimT = e.cd <= TURRET_AIM ? Math.max(0, e.cd) : 0;
      if (e.cd <= 0) {
        e.cd = Math.max(0.9, 1.7 - 0.08 * G.depth) + TURRET_AIM;
        const n = G.depth >= 4 ? 3 : 1;
        for (let i = 0; i < n; i++) {
          const spread = (i - (n - 1) / 2) * 0.25;
          const ca = Math.cos(spread), sa = Math.sin(spread);
          G.bolts.push({ x: e.x, y: e.y, vx: (dx / d * ca - dy / d * sa) * 16 * st.ts, vy: (dy / d * ca + dx / d * sa) * 16 * st.ts });
        }
        e.flash = 0.1;
        tone(500, 300, 0.06, 'square', 0.05);
      }
    }
    const wfx = G.windDir ? G.windDir[0] * 6 : 0, wfy = G.windDir ? G.windDir[1] * 6 : 0;
    tryMove(e, e.x + (e.vx * st.ts + e.kx + wfx) * dt, e.y + (e.vy * st.ts + e.ky + wfy) * dt, e.type === 'bat' ? 0.8 : 1.6);
    wrapWoods(e);
    if (contactHit(e, p.x, p.y)) hurtPlayer(e);
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
    for (const [x, y] of G.bars) {
      G.solid[y * COLS + x] = 0;
      G.parts.push({ x, y, vx: (Math.random() - 0.5) * 4, vy: -6 - Math.random() * 5, ci: 7, life: 0.6, t: 0 });
    }
    SFX.door();
  }

  // bolts
  for (const b of G.bolts) {
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (mut('WOODS')) { wrapWoods(b); b.life = (b.life === undefined ? 2.5 : b.life) - dt; if (b.life <= 0) b.dead = true; }
    if (solidAt(b.x, b.y)) b.dead = true;
    else if (Math.hypot(b.x - p.x, b.y - p.y) < 1.8) { hurtPlayer(b); b.dead = true; }
  }
  G.bolts = G.bolts.filter(b => !b.dead);

  // player bullets (gun) — ranged kills are recorded; PLUMA is watching
  for (const b of G.pbolts) {
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (mut('WOODS')) { wrapWoods(b); b.life = (b.life === undefined ? 1.5 : b.life) - dt; if (b.life <= 0) { b.dead = true; continue; } }
    if (solidAt(b.x, b.y)) { b.dead = true; burst(b.x, b.y, 1, 4, 8, 0.3); continue; }
    if (G.hungry && Math.hypot(G.hungry.x - b.x, G.hungry.y - b.y) < G.hungry.r + 0.8) {
      b.dead = true; G.hungry.hp -= 1; burst(G.hungry.x, G.hungry.y, 8, 6, 12, 0.35);
      if (G.hungry.hp <= 0) {
        if (G.hungry.swallowed) { G.pickups.push({ x: G.hungry.x, y: G.hungry.y, kind: G.hungry.swallowed.kind, ammo: G.hungry.swallowed.ammo, slot: true, ph: 0, cd: 0.5 }); msg('IT SPITS IT OUT', 5, 1.6); }
        G.floorStats.kills++; G.run.kills++; G.floorStats.rangedKills++;
        G.hungry = null; SFX.kill();
      }
      continue;
    }
    for (const e of G.enemies) {
      if (e.dead || e.telegraph > 0) continue;
      if (Math.hypot(e.x - b.x, e.y - b.y) < e.r + 0.8) {
        if (ironBlocked(e, b.x - b.vx * 0.03, b.y - b.vy * 0.03)) { clink(e); b.dead = true; break; } // IRONFRONT stops bullets too
        b.dead = true; e.hp -= 1; e.flash = 0.15;
        e.kx = b.vx * 0.4; e.ky = b.vy * 0.4;
        burst(e.x, e.y, e.ci, 6, 14, 0.35);
        if (e.hp <= 0) killEnemy(e, 'ranged');
        break;
      }
    }
    if (!b.dead && G.bat && Math.hypot(G.bat.x - b.x, G.bat.y - b.y) < 2.5) {
      b.dead = true;
      if (G.bat.carrying) G.pickups.push({ x: G.bat.x, y: G.bat.y, kind: G.bat.carrying.kind, ammo: G.bat.carrying.ammo, slot: true, ph: 0, cd: 0.6 });
      burst(G.bat.x, G.bat.y, 5, 14, 18, 0.5);
      G.floorStats.kills++; G.run.kills++; G.floorStats.rangedKills++;
      G.bat = null; SFX.kill();
    }
  }
  G.pbolts = G.pbolts.filter(b => !b.dead);

  // ninja stars: pierce, bounce off walls twice, then lie where they fall
  for (const s2 of G.stars) {
    s2.hitCd -= dt;
    const nx = s2.x + s2.vx * dt, ny = s2.y + s2.vy * dt;
    let bounced = false;
    if (solidAt(nx, s2.y)) { s2.vx = -s2.vx; bounced = true; }
    if (solidAt(s2.x, ny)) { s2.vy = -s2.vy; bounced = true; }
    if (bounced) { s2.bounces++; tone(700, 400, 0.05, 'square', 0.05); }
    s2.x += s2.vx * dt; s2.y += s2.vy * dt;
    if (mut('WOODS')) { // no walls to bounce off — the star tires instead
      wrapWoods(s2);
      s2.life = (s2.life === undefined ? 2.5 : s2.life) - dt;
      if (s2.life <= 0) s2.bounces = 3;
    }
    if (s2.hitCd <= 0) for (const e of G.enemies) {
      if (e.dead || e.telegraph > 0) continue;
      if (Math.hypot(e.x - s2.x, e.y - s2.y) < e.r + 1) {
        if (ironBlocked(e, s2.x - s2.vx * 0.03, s2.y - s2.vy * 0.03)) { clink(e); s2.hitCd = 0.2; continue; }
        e.hp -= 2; e.flash = 0.15; s2.hitCd = 0.15;
        burst(e.x, e.y, e.ci, 8, 16, 0.4);
        if (e.hp <= 0) killEnemy(e, 'ranged');
      }
    }
    if (s2.bounces > 2) {
      s2.dead = true;
      G.pickups.push({ x: s2.x, y: s2.y, kind: 'star', slot: true, ph: 0, cd: 0.4 });
    }
  }
  G.stars = G.stars.filter(s2 => !s2.dead);

  // bombs: slide, sputter, level the room
  for (const bm of G.bombs) {
    const nbx = bm.x + bm.vx * dt, nby = bm.y + bm.vy * dt;
    if (!solidAt(nbx, bm.y)) bm.x = nbx; else bm.vx = 0;
    if (!solidAt(bm.x, nby)) bm.y = nby; else bm.vy = 0;
    bm.vx *= Math.pow(0.05, dt); bm.vy *= Math.pow(0.05, dt);
    wrapWoods(bm);
    bm.fuse -= dt;
    if (bm.fuse <= 0) { bm.dead = true; explode(bm.x, bm.y); }
  }
  G.bombs = G.bombs.filter(bm => !bm.dead);

  // THE BAT (Atari Adventure's finest): steals what you hold, flies it elsewhere
  if (G.bat) {
    const b = G.bat;
    b.ph += dt * 9; b.leaveT -= dt;
    const wantsYou = !b.carrying && p.held;
    const tx = wantsYou ? p.x : (b.x < 80 ? X1 + 6 : X0 - 6);
    const ty = wantsYou ? p.y : b.y + Math.sin(b.ph * 0.5) * 8;
    const d = Math.hypot(tx - b.x, ty - b.y) || 1;
    b.x += ((tx - b.x) / d * 13 + Math.cos(b.ph) * 4) * dt;
    b.y += ((ty - b.y) / d * 13 + Math.sin(b.ph) * 4) * dt;
    if (wantsYou && Math.hypot(b.x - p.x, b.y - p.y) < 2.6) {
      b.carrying = p.held; p.held = null;
      G.floorStats.itemsStolen++;
      msg('THE BAT TOOK YOUR ' + ITEMS[b.carrying.kind].label + '!', 7, 2.2);
      A.startGlitch(0.7, 0.25, 'shear');
      tone(1200, 300, 0.3, 'sawtooth', 0.09);
      b.leaveT = Math.min(b.leaveT, 2.5);
    }
    if (b.leaveT <= 0 || b.x < X0 - 5 || b.x > X1 + 5) {
      if (b.carrying) {
        const others = [...G.rooms.values()].filter(r => r !== G.cur);
        const dst = others[(Math.random() * others.length) | 0] || G.cur;
        dst.items = dst.items || [];
        dst.items.push({ x: X0 + 10 + Math.random() * (X1 - X0 - 20), y: Y0 + 8 + Math.random() * (Y1 - Y0 - 16), kind: b.carrying.kind, ammo: b.carrying.ammo, slot: true, ph: 0 });
        msg('THE BAT FLEW YOUR ' + ITEMS[b.carrying.kind].label + ' TO ANOTHER ROOM', 1, 2.2);
      }
      G.bat = null;
    }
  }

  // THE FOUNTAIN heals whoever stands in it. whoever.
  if (G.pool) {
    const pl = G.pool;
    if (Math.hypot(p.x - pl.x, p.y - pl.y) < pl.r) {
      p.healAcc = (p.healAcc || 0) + 0.8 * dt;
      if (p.healAcc >= 1) {
        p.healAcc = 0;
        G.cur.poolGiven = G.cur.poolGiven || 0;
        if (p.hp < p.maxhp && G.cur.poolGiven < 2) { // the spring is not a battery
          p.hp++; G.cur.poolGiven++;
          burst(p.x, p.y, 3, 8, 8, 0.4); msg('+1 HP', 3, 0.8); tone(700, 900, 0.1, 'triangle', 0.05);
        } else if (G.cur.poolGiven >= 2) msg('THE SPRING IS SPENT', 1, 1);
      }
    }
    for (const e of G.enemies) {
      // enemies drink from the same finite spring you do — no infinite regen tank
      if (e.telegraph <= 0 && Math.hypot(e.x - pl.x, e.y - pl.y) < pl.r) {
        e.poolHeal = (e.poolHeal || 0);
        if (e.poolHeal < 2) { const inc = Math.min(0.8 * dt, 2 - e.poolHeal); e.poolHeal += inc; e.hp = Math.min(e.hp0 || e.hp, e.hp + inc); }
      }
    }
  }

  // THE HUNGRY ONE homes on your hands
  if (G.hungry) {
    const h = G.hungry;
    h.ph += dt * 4;
    if (h.swallowed) {
      h.digestT -= dt;
      const fx = h.x - p.x, fy = h.y - p.y, fd = Math.hypot(fx, fy) || 1;
      tryMove(h, h.x + fx / fd * 3 * dt, h.y + fy / fd * 3 * dt, 2);
      if (h.digestT <= 0) {
        G.floorStats.itemsStolen++;
        msg('DIGESTED. THE ' + ITEMS[h.swallowed.kind].label + ' IS GONE.', 7, 2.2);
        A.startGlitch(0.7, 0.3, 'scramble');
        burst(h.x, h.y, 8, 20, 10, 0.8);
        G.hungry = null;
      }
    } else {
      const tx2 = p.x - h.x, ty2 = p.y - h.y, td = Math.hypot(tx2, ty2) || 1;
      tryMove(h, h.x + tx2 / td * 4.2 * dt, h.y + ty2 / td * 4.2 * dt, 2);
      if (p.held && td < h.r + 1.5) {
        h.swallowed = p.held; p.held = null;
        h.digestT = 6;
        msg('SWALLOWED! KILL IT IN 6s', 7, 2.2);
        A.startGlitch(0.8, 0.3, 'chroma');
        tone(200, 40, 0.6, 'sawtooth', 0.12);
      }
    }
  }

  // THE TOLL: walk over the goods to buy them with score
  if (G.cur.goods) {
    for (const gd of G.cur.goods) {
      if (gd.dead || Math.hypot(gd.x - p.x, gd.y - p.y) > 3) continue;
      G.buyHint = gd;                       // browsing is free
      if (!G.buyPressed) continue;          // buying takes intent: press C
      G.buyPressed = false;
      if (liveScore() >= gd.price) {
        gd.dead = true;
        G.run.bonus = (G.run.bonus || 0) - gd.price;
        G.floorStats.spent += gd.price;
        if (ITEMS[gd.kind]) { // hands item
          if (p.held) G.pickups.push({ x: p.x, y: p.y, kind: p.held.kind, ammo: p.held.ammo, slot: true, ph: 0, cd: 1.2 });
          p.held = { kind: gd.kind, ammo: gd.kind === 'gun' ? 6 : gd.kind === 'bomb' ? 3 : undefined };
        } else if (gd.kind === 'heart') p.hp = Math.min(p.maxhp, p.hp + 1);
        else if (gd.kind === 'sword') p.swords = Math.min(MAX_SWORDS, p.swords + 1);
        msg('"THANK YOU." (-' + gd.price + ')  AURUM APPROVES', 5, 2);
        SFX.pickup();
      } else if (!G.cur.alarmed) {
        G.cur.alarmed = true;
        msg('THE OLD DUCK SCREAMS: THIEF', 7, 2.2);
        A.startGlitch(0.9, 0.35, 'shear');
        SFX.hurt();
        G.cur.cleared = false;
        spawnEnemies(G.cur, mulberry32(G.cur.seed ^ 0xBEEF), null);
        G.locked = true;
        if (G.cur.mut !== 'WOODS') for (const [bx, by] of G.bars) G.solid[by * COLS + bx] = 1;
      }
    }
    G.cur.goods = G.cur.goods.filter(gd => !gd.dead);
  }

  // a heart piece, if you can see it
  if (G.cur.piece && Math.hypot(G.cur.piece.x - p.x, G.cur.piece.y - p.y) < 2.6) {
    G.cur.piece = null;
    G.run.pieces = (G.run.pieces || 0) + 1;
    G.floorStats.heartPieces++;
    burst(p.x, p.y, 7, 16, 14, 0.6);
    if (G.run.pieces % 4 === 0) {
      p.maxhp++; p.hp = Math.min(p.maxhp, p.hp + 1);
      msg('A HEART ASSEMBLES. +1 MAX HP', 7, 2.6);
      SFX.stairs();
    } else {
      msg('HEART PIECE (' + (G.run.pieces % 4) + '/4)', 7, 1.6);
      SFX.pickup();
    }
  }

  // the lantern dowses for secrets
  if (heldKind() === 'lantern' && (G.cur.piece || (G.cur.chest && !G.cur.chest.opened))) {
    G.dowseT = (G.dowseT || 0) - dt;
    if (G.dowseT <= 0) { G.dowseT = 1.2; tone(1200, 1180, 0.06, 'sine', 0.05); }
  }

  // the chest wants the key
  const ch = G.cur.chest;
  if (ch && !ch.opened) {
    ch.msgCd = (ch.msgCd || 0) - dt;
    if (Math.hypot(ch.x - p.x, ch.y - p.y) < 4.5) {
      if (heldKind() === 'key') {
        ch.opened = true; p.held = null;
        G.floorStats.chestsOpened++;
        G.run.bonus = (G.run.bonus || 0) + 100;
        const jack = ['heart', Math.random() < 0.5 ? 'sword' : 'boots', 'heart'];
        jack.forEach((k, i) => G.pickups.push({ x: ch.x - 4 + i * 4, y: ch.y + 4, kind: k, ph: 0 }));
        burst(ch.x, ch.y, 5, 40, 26, 0.9);
        A.startGlitch(0.8, 0.35, 'pop');
        G.shake = 3;
        msg('THE CHEST OPENS. AURUM HOWLS WITH JOY. +100', 5, 2.6);
        SFX.stairs();
      } else if (ch.msgCd <= 0) { ch.msgCd = 2.5; msg('LOCKED. THE KEY IS IN ANOTHER ROOM.', 1, 1.6); }
    }
  }

  // pickups (instant powerups + slot items with the one-hands-slot Adventure law)
  for (const pk of G.pickups) {
    pk.ph += dt * 3;
    if (pk.cd > 0) { pk.cd -= dt; continue; }
    if (Math.hypot(pk.x - p.x, pk.y - p.y) < 3) {
      pk.dead = true;
      G.run.pickups++; G.floorStats.pickups++;
      SFX.pickup();
      burst(pk.x, pk.y, 5, 12, 12, 0.5);
      if (pk.slot) {
        if (p.held) G.pickups.push({ x: p.x, y: p.y, kind: p.held.kind, ammo: p.held.ammo, slot: true, ph: 0, cd: 1.2 });
        p.held = { kind: pk.kind, ammo: pk.ammo };
        if (pk.kind === 'chalice') { p.chaliceClean = true; msg('THE CHALICE. DELIVER IT UNTOUCHED.', 5, 2.4); }
        else msg('TOOK ' + ITEMS[pk.kind].label + ' (' + ITEMS[pk.kind].hint + ')', ITEMS[pk.kind].ci, 1.6);
      } else if (pk.kind === 'heart') {
        const heal = 1 * (curse('mors') ? FX.CURSE_MORS : 1);
        if (heal > 0) { p.hp = Math.min(p.maxhp, p.hp + heal); msg('+1 HP', 7, 1); }
        else msg('MORS: NOTHING', 1, 1.4);
      }
      else if (pk.kind === 'sword') {
        if (p.swords < MAX_SWORDS) { p.swords = Math.min(MAX_SWORDS, p.swords + 1); msg('SWORD +1 DMG', 0, 1.4); }
        else { G.run.bonus = (G.run.bonus || 0) + 40; msg('THE BLADE IS ALREADY KEEN (+40)', 5, 1.4); }
      }
      else if (pk.kind === 'boots') { p.spdMult *= 1.08; msg('BOOTS +SPEED', 3, 1.4); }
    }
  }
  G.pickups = G.pickups.filter(pk => !pk.dead);
  G.cur.items = G.pickups; // keep the room's persistent list in sync

  // room transitions (only through open doors — bars are solid anyway)
  const mid = (X0 + X1) / 2, midY = (Y0 + Y1) / 2;
  let moved = null;
  if (G.wrapCd > 0) { /* just crossed the woods seam — no door chaining */ }
  else {
  if (p.y <= Y0 + 3.5 && Math.abs(p.x - mid) <= DOOR / 2 && G.cur.doors.n && !G.locked) moved = ['n', 0, -1];
  if (p.y >= Y1 - 3.5 && Math.abs(p.x - mid) <= DOOR / 2 && G.cur.doors.s && !G.locked) moved = ['s', 0, 1];
  if (p.x <= X0 + 3.5 && Math.abs(p.y - midY) <= DOOR / 2 && G.cur.doors.w && !G.locked) moved = ['w', -1, 0];
  if (p.x >= X1 - 3.5 && Math.abs(p.y - midY) <= DOOR / 2 && G.cur.doors.e && !G.locked) moved = ['e', 1, 0];
  if (moved) {
    const [dir, dx, dy] = moved;
    const next = G.rooms.get((G.cur.gx + dx) + ',' + (G.cur.gy + dy));
    if (next) enterRoom(next, dir); // enterRoom repositions using the new room's bounds
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
  foldFloor();
  const p = G.player;
  G.chaliceNote = null;
  if (heldKind() === 'chalice') {
    if (p.chaliceClean) {
      G.floorStats.chaliceDelivered = 1;
      G.run.bonus = (G.run.bonus || 0) + 300;
      G.chaliceNote = 'THE CHALICE ARRIVES UNTOUCHED -- THE PANTHEON IS MOVED (+3 ALL, +300)';
    } else {
      G.chaliceNote = 'THE CHALICE ARRIVES TARNISHED. STILL, IT ARRIVES. (+1 ALL)';
    }
    p.held = null;
  }
  G.cards = P.judge(G.floorStats, G.favor);
  G.favor = P.applyFavor(G.favor, G.cards);
  if (G.chaliceNote) {
    const d = G.floorStats.chaliceDelivered ? 3 : 1;
    for (const g of P.GODS) G.favor[g.id] = Math.max(0, Math.min(100, G.favor[g.id] + d));
  }
  localStorage.setItem(LS_FAVOR, JSON.stringify(G.favor));
  G.verdictText = P.verdict(G.cards, G.floorStats);
  G.state = 'judgment'; G.judgeT = 0;
  SFX.judge();
}
function nextFloor() {
  G.depth++; G.run.floors = G.depth;
  const p = G.player;
  p.maxhp = 4 + (boon('umbra') ? FX.BOON_UMBRA : 0);
  p.hp = Math.min(p.maxhp, p.hp + 1);
  // fall between floors: fake-3D character tunnel
  G.state = 'descend'; G.descT = 0;
  G.streaks = Array.from({ length: 150 }, () => ({
    a: Math.random() * Math.PI * 2, d: 1 + Math.random() * 12,
    s: 18 + Math.random() * 40, ci: [3, 6, 8, 0][(Math.random() * 4) | 0],
  }));
  tone(120, 700, 1.0, 'sawtooth', 0.06);
  A.startGlitch(0.7, 0.3, 'pop');
}

// ---------- the cutscene library: 12 watchable ASCII cinematics ----------
// Each {title, dur, draw(t)} paints the scene canvas over t in [0,dur]; the vine is the
// opener. Watch them all from the title via [V]. Progress persists (which you've seen).
function loadCine() { try { return new Set(JSON.parse(localStorage.getItem('ducksouls_cine')) || []); } catch (e) { return new Set(); } }
function saveCine() { localStorage.setItem('ducksouls_cine', JSON.stringify([...G.cineSeen])); }

function cineVineDraw(t, withText) {
  plasma(t * 0.06, 0.07, [4, 6, 1]);
  const pts = 110, grown = Math.min(pts, t * 34);
  for (let i = 0; i < 5; i++) px(80 + (i - 2) * 2, 83 + (i % 2), 1, 0.25);
  for (let i = 0; i < grown; i++) {
    const tt = i / pts, sway = Math.sin(G.t * 1.4 + tt * 6) * (tt * 1.6);
    px(vineX(tt) + sway, vineY(tt), 4, 0.5 + 0.3 * Math.sin(i * 0.7));
    if (i % 6 === 3) { const side = (i % 12 === 3) ? 1 : -1; for (let kk = 1; kk <= 2; kk++) px(vineX(tt) + sway + side * kk, vineY(tt), 4, 0.3); }
  }
  GROW_NODES.slice(0, 5).forEach((nd, i) => {
    const ni = (0.12 + i * 0.17) * pts; if (grown < ni) return;
    const tt = ni / pts, x = vineX(tt), side = i % 2 ? -1 : 1, bx = x + side * 8, y = vineY(tt);
    const age = (grown - ni) / 30, r = Math.min(2.6, age * 5);
    for (let q = 0; q < 6; q++) { const a = q / 6 * Math.PI * 2 + G.t * 0.6; px(bx + Math.cos(a) * r, y + Math.sin(a) * r * 0.8, [2, 8, 5][i % 3], 0.8); }
    px(bx, y, 5, 1);
    if (withText) A.text(side === 1 ? bx + 4 : bx - 4 - nd.phrase.length, y, nd.phrase, 4, 0.85 * Math.min(1, age));
  });
}

const CUTSCENES = [
  { title: 'THE FIRST GROWTH', dur: 7, draw: t => { cineVineDraw(t, true); A.textC(6, 'in the beginning, something grew', 4, 0.6); } },
  {
    title: 'THE DROWNING', dur: 7, draw: t => {
      S.fillStyle = '#000'; S.fillRect(0, 0, COLS, ROWS);
      const fall = t * 12;
      for (let i = 0; i < 120; i++) { const fx = (i * 37) % COLS, fy = ((i * 13 + fall) % (ROWS + 20)) - 10; px(fx, fy, 0, 0.4); }
      const water = ROWS - 6 - Math.max(0, (5 - t)) * 8; // rising tide
      for (let y = water; y < ROWS; y++) for (let x = 2; x < COLS - 2; x += 1) px(x, y, 6, 0.25 + 0.1 * Math.sin(x * 0.3 + G.t * 3));
      bigText(80, 30, 'FEATHERS', 1, 0, Math.min(1, t));
      A.textC(50, 'the kingdom drowned in feathers', 1, Math.min(1, t * 0.5));
    }
  },
  {
    title: 'THE FIVE REMAIN', dur: 8, draw: t => {
      plasma(t * 0.1, 0.1, [6, 8, 1]);
      P.GODS.forEach((g, i) => {
        if (t < i * 1.2) return;
        const x0 = 12 + i * 29, port = PORTRAIT[g.id], al = Math.min(1, (t - i * 1.2) * 2);
        if (al < 1) for (let q = 0; q < 30; q++) px(x0 + Math.random() * 12, 30 + Math.random() * 8, g.ci, Math.random() * 0.5);
        port.forEach((row, r) => A.text(x0, 28 + r, row, g.ci, al));
        A.text(x0, 36, g.name, g.ci, al);
      });
      A.textC(6, 'five gods remained. they grade what they cannot rule.', 0, Math.min(1, t * 0.4));
    }
  },
  {
    title: 'THE SQUARE DESCENDS', dur: 7, draw: t => {
      S.fillStyle = '#000'; S.fillRect(0, 0, COLS, ROWS);
      for (let i = 0; i < 120; i++) { const a = i * 0.7, d = ((i * 5 + t * 40) % 100); px(80 + Math.cos(a) * d, 45 + Math.sin(a) * d * 0.62, [3, 6, 8][i % 3], Math.min(1, d / 30)); }
      const sq = 3 + Math.sin(t * 3) * 0.5;
      rect(80 - sq / 2, 45 - sq / 2, sq, sq, 0, 1);
      A.textC(60, 'a square descends. it is easier to judge.', 0, Math.min(1, t * 0.5));
    }
  },
  {
    title: 'DUCK INTO DRAGON', dur: 7, draw: t => {
      plasma(t * 0.05, 0.06, [2, 7, 1]);
      const morph = (Math.sin(t * 1.5) + 1) / 2;
      const spr = morph > 0.5 ? SPR.duck[0] : ['  ####  ', ' #o###\\ ', '<#######', ' #######', ' ##  ## ', ' #    # '];
      for (let s = 0; s < 6; s++) blit(spr, 76 + Math.sin(G.t + s) * (1 - morph) * 3, 40, morph > 0.5 ? 2 : 7, 1, false), s = 5;
      A.textC(58, morph > 0.5 ? 'the ducks...' : '...remember being dragons', morph > 0.5 ? 2 : 7, 0.9);
    }
  },
  {
    title: "VELOX'S DOOR", dur: 7, draw: t => {
      plasma(t * 0.04, 0.05, [3, 1]);
      rect(88, 34, 10, 20, 1, 0.5); // a door
      const px2 = 70 + Math.min(14, t * 4); // courier approaching, never arriving
      rect(px2, 46, 3, 3, 3, 1);
      if (t > 4) A.textC(62, 'he starved at a door that never opened', 3, Math.min(1, (t - 4)));
      A.textC(8, 'VELOX, god of haste', 3, 0.7);
    }
  },
  {
    title: "PLUMA'S BROOD", dur: 7, draw: t => {
      S.fillStyle = '#000'; S.fillRect(0, 0, COLS, ROWS);
      for (let i = 0; i < 8; i++) { if (t < i * 0.7) continue; const x = 20 + i * 15, hatch = Math.min(1, (t - i * 0.7)); if (hatch < 0.5) { A.text(x, 44, 'o', 5, 1); } else blit(SPR.duck[0], x - 4, 42, 2, hatch, false); }
      A.textC(60, 'mother of every duck-dragon', 2, Math.min(1, t * 0.4));
      A.textC(8, 'PLUMA, the duck-mother', 2, 0.7);
    }
  },
  {
    title: 'UMBRA UNTOUCHED', dur: 6, draw: t => {
      plasma(t * 0.06, 0.06, [8, 6]);
      const cx2 = 80, cy2 = 45;
      for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2, r = 8 + Math.sin(G.t * 3 + i) * 2; px(cx2 + Math.cos(a) * r, cy2 + Math.sin(a) * r * 0.7, 8, 0.6); } // it recoils from everything
      rect(cx2 - 1, cy2 - 1, 3, 3, 0, 1);
      A.textC(60, 'never touched by anything. obsessed with your skin.', 8, Math.min(1, t * 0.5));
      A.textC(8, 'UMBRA, keeper of the untouched', 8, 0.7);
    }
  },
  {
    title: "AURUM'S SALE", dur: 6, draw: t => {
      S.fillStyle = '#000'; S.fillRect(0, 0, COLS, ROWS);
      for (let i = 0; i < 60; i++) { const fx = 20 + (i * 41) % 120, fy = 20 + ((i * 17 + t * 20) % 50); A.text(fx, fy, '$', 5, 0.7); }
      bigText(80, 30, 'SOLD', 2, 5, Math.min(1, t * 0.6));
      A.textC(58, 'sold his own temple. then the sixth god.', 5, Math.min(1, t * 0.4));
      A.textC(8, 'AURUM, the hoarder', 5, 0.7);
    }
  },
  {
    title: 'MORS WAITS', dur: 8, draw: t => {
      plasma(t * 0.03, 0.04, [1]);
      for (let i = 0; i < Math.min(18, t * 3); i++) rect(14 + i * 7, 46, 2, 3, 1, 0.5); // the line of the dead
      const port = PORTRAIT.mors; port.forEach((row, r) => A.text(130, 42 + r, row, 1, Math.min(1, t * 0.5)));
      A.textC(62, 'death itself. it grades everyone, eventually.', 1, Math.min(1, t * 0.4));
      if (t > 5) A.textC(66, '"back so soon?"', 1, Math.min(1, t - 5));
    }
  },
  {
    title: 'THE CHALICE', dur: 6, draw: t => {
      plasma(t * 0.05, 0.05, [5, 8]);
      blit(SPR.chalice, 78, 38, 5, 1, false);
      const drain = Math.max(0, 1 - t / 5);
      for (let y = 0; y < drain * 6; y++) px(80, 40 + y, 6, 0.6); // draining
      A.textC(58, 'the chalice was full once. ask who drank.', 5, Math.min(1, t * 0.5));
    }
  },
  {
    title: 'THE RETURN', dur: 8, draw: t => {
      S.fillStyle = '#000'; S.fillRect(0, 0, COLS, ROWS);
      if (t < 3) { bigText(80, 30, 'YOU', 2, 7, Math.min(1, t)); bigText(80, 42, 'DIED', 2, 7, Math.min(1, t - 0.5)); }
      else if (t < 5.5) { cineVineDraw(t - 3, false); A.textC(40, 'the gods remember you', 4, Math.min(1, t - 3)); }
      else { for (let i = 0; i < 80; i++) { const a = i * 0.7, d = ((i * 5 + t * 40) % 100); px(80 + Math.cos(a) * d, 45 + Math.sin(a) * d * 0.62, 3, Math.min(1, d / 30)); } A.textC(46, 'descend. be graded. return. again.', 5, Math.min(1, t - 5.5)); }
    }
  },
];

function playCine(i, ret) {
  G.cineI = i; G.cineT = 0; G.cineRet = ret || 'gallery';
  G.state = 'cinema';
  G.cineSeen = G.cineSeen || loadCine(); G.cineSeen.add(i); saveCine();
}

function drawCinema(dt) {
  G.cineT += dt;
  const c = CUTSCENES[G.cineI];
  c.draw(G.cineT);
  A.textC(2, c.title, 0, 0.8);
  if (G.cineT > c.dur) { if (((G.t * 1.5) | 0) % 2 === 0) A.textC(86, '- any key -', 5); }
  else A.textC(86, 'any key skips', 1, 0.35);
}

function drawGallery(dt) {
  plasma(G.t * 0.05, 0.08, [6, 8, 1]);
  G.cineSeen = G.cineSeen || loadCine();
  A.textC(6, 'THE CUTSCENE LIBRARY', 0);
  A.textC(8, G.cineSeen.size + ' / 12 witnessed   -   number keys to watch, any other to leave', 1, 0.7);
  CUTSCENES.forEach((c, i) => {
    const col = i % 2, row = (i / 2) | 0;
    const x = 20 + col * 62, y = 14 + row * 5;
    const seen = G.cineSeen.has(i);
    const label = (i + 1).toString().padStart(2, ' ') + '. ' + (seen ? c.title : '???  (unwatched)');
    A.text(x, y, label, seen ? (i % 5) + 2 : 1, seen ? 0.9 : 0.4);
  });
  A.textC(80, 'the first plays automatically when a new soul begins', 4, 0.5);
}

// the credits — a scrolling scene using every animation trick in the box
const CREDIT_LINES = [
  '', '', 'DUCK SOULS', '', 'a fast-paced ASCII roguelite', 'judged by a pantheon', '',
  '~', '', 'EVERYTHING YOU SAW', 'was pixels drawn to a 160x90 canvas', 'and read back as characters',
  'luminance picks the glyph', 'hue picks the color', '', '~', '',
  'THE PANTHEON', 'VELOX, god of haste', 'PLUMA, the duck-mother',
  'UMBRA, keeper of the untouched', 'AURUM, the hoarder', 'MORS, the patient', '', '~', '',
  'THE ARSENAL', 'hammer  whip  rapier', 'boomerang  flail  spore-bow', '', '~', '',
  'BUILT WITH', 'a video->ASCII filter', 'a pantheon that grades honestly',
  'a fun-harness that measured itself', 'and would not let a vibe pass for a result', '',
  '~', '', 'the ducks are dragons', 'the dragons are ducks', '', '',
  'BlueDuck LLC', '', '', 'press any key to return', '', '', '',
];
function drawCredits(dt) {
  G.credT += dt;
  // a deep plasma starfield behind, with a rising glyph tunnel
  plasma(G.t * 0.08, 0.09, [6, 8, 4, 1]);
  for (let i = 0; i < 40; i++) { const a = i * 0.6, d = ((i * 6 + G.t * 20) % 90); px(80 + Math.cos(a) * d, 45 + Math.sin(a) * d * 0.6, 3, Math.min(0.5, d / 40)); }
  // the scroll
  const scroll = G.credT * 4.2;
  CREDIT_LINES.forEach((line, i) => {
    const y = i * 2 - scroll + ROWS;
    if (y < 2 || y > ROWS - 2) return;
    if (line === '~') { for (let x = 60; x < 100; x++) px(x, y, 4, 0.4 + 0.3 * Math.sin(x * 0.3 + G.t * 4)); return; }
    const big = line === 'DUCK SOULS' || line === 'BlueDuck LLC';
    A.textC(y, line, big ? 5 : line === line.toUpperCase() && line.length > 2 ? 2 : 0, big ? 1 : 0.85);
  });
  // a couple of orbiting blue orbs, because that's the game now
  for (let i = 0; i < 4; i++) { const a = G.t * 2 + i * Math.PI / 2; px(80 + Math.cos(a) * 10, 6 + Math.sin(a) * 2, 6, 0.6 + 0.4 * Math.sin(a)); }
  A.textC(2, 'CREDITS', 0, 0.7);
  // loop the scroll
  if (scroll > CREDIT_LINES.length * 2 + ROWS) G.credT = 0;
  if (G.credT > 0.4 && ((G.t * 1.5) | 0) % 2 === 0) A.text(2, ROWS - 3, 'any key: back', 1, 0.5);
}

// ---------- key routing ----------
function onKey(k) {
  if (k === 'm') { muted = !muted; return; }
  if (k === 'c') { useItem(); return; }
  const mod = ['shift', 'meta', 'control', 'alt'].includes(k);
  if (G.state === 'cinema') {
    if (!mod && G.cineT > 0.4) {
      if (G.cineRet === 'intro-chain') { G.state = 'intro'; G.introT = 0; }
      else { G.state = G.cineRet || 'gallery'; if (G.state === 'gallery') G.galT = 0; }
    }
    return;
  }
  if (G.state === 'gallery') {
    if (k >= '1' && k <= '9') { playCine(+k - 1, 'gallery'); return; }
    if (k === '0') { playCine(9, 'gallery'); return; }
    if (k === '-') { playCine(10, 'gallery'); return; }
    if (k === '=') { playCine(11, 'gallery'); return; }
    if (!mod) { G.state = 'title'; G.titleT = 0; }
    return;
  }
  if (G.state === 'intro') {
    if (!mod && G.introT > 0.6) {
      localStorage.setItem(LS_SEEN, '1');
      if (!localStorage.getItem('ducksouls_grown')) { G.state = 'howto'; G.howT = 0; }
      else { G.state = 'title'; G.titleT = 0; }
    }
    return;
  }
  if (G.state === 'lore' || G.state === 'howto') {
    if (!mod && (G.state === 'lore' || G.howT > 0.6)) {
      if (G.state === 'howto') localStorage.setItem('ducksouls_grown', '1');
      G.state = 'title'; G.titleT = 0;
    }
    return;
  }
  if (G.state === 'title') {
    const MENU = ['start', 'library', 'credits', 'rules', 'memories'];
    if (k === 'arrowdown' || k === 's') { G.menuI = ((G.menuI || 0) + 1) % MENU.length; return; }
    if (k === 'arrowup' || k === 'w') { G.menuI = ((G.menuI || 0) + MENU.length - 1) % MENU.length; return; }
    // shortcuts still work
    if (k === 'l') { G.state = 'lore'; G.loreT = 0; return; }
    if (k === 'h') { G.state = 'howto'; G.howT = 0; GROW_NODES.forEach(n => n.bloomed = false); return; }
    if (k === 'v') { G.state = 'gallery'; G.galT = 0; return; }
    if (k === 'c') { G.state = 'credits'; G.credT = 0; return; }
    if (k === 'enter' || k === ' ' || k === 'x') {
      const sel = MENU[G.menuI || 0];
      if (sel === 'start') newRun();
      else if (sel === 'library') { G.state = 'gallery'; G.galT = 0; }
      else if (sel === 'credits') { G.state = 'credits'; G.credT = 0; }
      else if (sel === 'rules') { G.state = 'howto'; G.howT = 0; GROW_NODES.forEach(n => n.bloomed = false); }
      else if (sel === 'memories') { G.state = 'lore'; G.loreT = 0; }
      return;
    }
    if (!mod) newRun();
    return;
  }
  if (G.state === 'credits') { if (!mod && G.credT > 0.4) { G.state = 'title'; G.titleT = 0; } return; }
  if (G.state === 'judgment' && (k === ' ' || k === 'enter' || k === 'x')) {
    if (G.judgeT < 0.8) { G.judgeT = 1.1; return; } // first press: land every card now
    nextFloor(); return;                            // second press: descend
  }
  if (G.state === 'dead') {
    if (k === 'r') { newRun(); return; }
    if (!mod && G.deadT > 1.2) { G.state = 'title'; G.titleT = 0; return; } // return to the beginning
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

// unique per-weapon attack animation, colored to the weapon (WEAPON_STATS.ci)
function drawWeaponFx(p) {
  const w = G.wfx;
  if (!w) return;
  const st = WEAPON_STATS[w.kind], ci = st.ci;
  const dur = { hammer: 0.25, whip: 0.18, rapier: 0.10, boomerang: 0.15, flail: 0.2, sporebow: 0.2 }[w.kind];
  const prog = 1 - w.t / dur;
  if (w.kind === 'whip') { // vermillion lash snaking out to full reach
    for (let r = 1; r < w.reach * Math.min(1, prog * 1.4); r += 0.7) {
      const wob = Math.sin(r * 0.7 - G.t * 30) * (1 - r / w.reach) * 2;
      px(p.x + Math.cos(w.a) * r - Math.sin(w.a) * wob, p.y + (Math.sin(w.a) * r + Math.cos(w.a) * wob) * 0.9, ci, 1 - prog * 0.5);
    }
  } else if (w.kind === 'rapier') { // a thin blue lance stabbing forward + recoil
    const ext = w.reach * Math.sin(prog * Math.PI);
    for (let r = 1; r < ext; r += 0.5) px(p.x + Math.cos(w.a) * r, p.y + Math.sin(w.a) * r * 0.9, ci, 1);
    px(p.x + Math.cos(w.a) * ext, p.y + Math.sin(w.a) * ext * 0.9, 0, 1);
  } else if (w.kind === 'hammer') { // a heavy overhead arc sweeping down (vermillion)
    for (let da = -1.0; da <= 1.0; da += 0.12) {
      const a = w.a + da * (1 - prog); // the arc closes as it lands
      for (let r = 3; r < w.reach; r += 1.2) px(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r * 0.85, ci, (1 - prog) * (1 - Math.abs(da) * 0.4));
    }
  } else if (w.kind === 'flail') { // a purple full sweep flourish
    for (let a = 0; a < Math.PI * 2; a += 0.25) { const r = w.reach * (0.6 + 0.4 * prog); px(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r * 0.75, ci, (1 - prog) * 0.8); }
  } else if (w.kind === 'boomerang') { // a golden wind-up arc at the throw
    for (let a = w.a - 1; a < w.a + 1; a += 0.2) px(p.x + Math.cos(a) * 3, p.y + Math.sin(a) * 2.4, ci, (1 - prog) * 0.7);
  } else if (w.kind === 'sporebow') { // a green launch puff
    for (let i = 0; i < 8; i++) px(p.x + Math.cos(w.a) * (2 + i * 0.5) + (Math.random() - 0.5), p.y + Math.sin(w.a) * (2 + i * 0.5), ci, (1 - prog) * 0.6);
  }
}

function drawWorld() {
  const p = G.player;
  const shx = G.shake > 0.3 ? ((Math.random() * G.shake * 2 - G.shake) | 0) : 0;
  const shy = G.shake > 0.3 ? ((Math.random() * G.shake * 2 - G.shake) | 0) : 0;
  S.save(); S.translate(shx, shy);

  // light model: torch + lantern + PITCH DARK flashlight cone + BAD WIRING + grit stutter
  G.dimMul = 1;
  if (mut('FLICKER')) {
    const ph = G.t * 7 + (G.cur.seed % 100);
    G.dimMul *= (Math.sin(ph) > -0.25 ? 1 : 0.28) * (0.88 + 0.12 * Math.sin(ph * 5.3));
  }
  if (Math.random() < 0.01) G.dimMul *= 0.55; // the dark breathes
  const lightAt = (x, y) => {
    const dx = x - p.x, dy = y - p.y, d2 = dx * dx + dy * dy;
    const rad = (mut('DARK') ? 0.3 : 1) * (heldKind() === 'lantern' ? 2 : 1);
    let l = Math.min(1, 1.55 / (1 + d2 * 0.0019 / (rad * rad)));
    if (mut('DARK')) {
      const d = Math.sqrt(d2) || 1;
      const dot = (dx * p.dir.x + dy * p.dir.y) / d;
      if (dot > 0.72) l = Math.max(l, Math.min(1, 2.4 / (1 + d2 * 0.0007)) * ((dot - 0.72) / 0.28));
    }
    return l * G.dimMul;
  };
  G.lightAt = lightAt;
  for (const [x, y, b] of G.speckles) px(x, y, 1, b * lightAt(x, y));
  // the room GROWS in when you enter — walls unfurl outward from the center like the vine
  G.growT = Math.min(1.6, (G.growT || 0) + 1 / 60);
  const grow = Math.min(1, G.growT / 0.7);
  const archCi = (G.arch && G.arch.ci) || 1;
  for (const [x, y] of G.walls) {
    const d = Math.hypot(x - 80, y - 47) / 90;
    const k = Math.min(1, Math.max(0, (grow - d * 0.55) * 2.2));
    if (k <= 0) continue;
    const lit = (0.28 + 0.5 * lightAt(x, y)) * (mut('DARK') ? Math.max(0.25, lightAt(x, y) * 2) : 1);
    px(x, y, archCi, lit * k);
    if (k < 1 && Math.random() < 0.25) px(x, y - 1, archCi, 0.4 * k); // growth sparkle
  }
  // GARDEN/CAVE rooms breathe: living vines sway on the walls, tutorial-style
  if (G.arch && G.arch.org && G.vines) {
    for (const v of G.vines) {
      for (let s = 0; s < v.len; s++) {
        const t = s / v.len;
        const sway = Math.sin(G.t * 1.3 + t * 5 + v.ph) * (t * 2.2);
        const vx = v.x + sway, vy = v.y - t * v.h;
        px(vx, vy, 4, (0.35 - t * 0.15) * grow * Math.max(0.35, lightAt(vx, vy) * 1.5));
        if (s % 5 === 2) px(vx + (s % 10 < 5 ? 1 : -1), vy, 4, 0.25 * grow); // leaves
      }
      if (v.bloom) px(v.x + Math.sin(G.t * 1.3 + 5 + v.ph) * 2.2, v.y - v.h, 8, 0.55 + 0.25 * Math.sin(G.t * 2));
    }
  }
  // temple/rotunda columns catch the light along their capitals
  if (G.arch && (G.arch.name === 'temple' || G.arch.name === 'rotunda')) {
    for (let i = 0; i < 26; i++) {
      const gx2 = X0 + 2 + ((i * 37) % (X1 - X0 - 4));
      px(gx2, Y0 + 1, 5, (0.12 + 0.08 * Math.sin(G.t + i)) * grow);
    }
  }
  // dust motes drift (and show the wind under SIDEWAYS GRAVITY)
  for (const m of G.motes) {
    if (G.windDir) { m.vx += (G.windDir[0] * 9 - m.vx) * 0.06; m.vy += (G.windDir[1] * 9 - m.vy) * 0.06; }
    m.x += m.vx / 60; m.y += m.vy / 60;
    if (m.x < X0 + 1) m.x = X1 - 1; if (m.x > X1 - 1) m.x = X0 + 1;
    if (m.y < Y0 + 1) m.y = Y1 - 1; if (m.y > Y1 - 1) m.y = Y0 + 1;
    px(m.x, m.y, 1, (G.windDir ? 0.3 : 0.13) * (0.4 + lightAt(m.x, m.y)));
  }
  if (G.locked) {
    const pulse = 0.6 + 0.4 * Math.sin(G.t * 8);
    for (const [x, y] of G.bars) px(x, y, 7, pulse);
  } else {
    // open doorways glow faintly so exits read at a glance
    const pulse = 0.3 + 0.15 * Math.sin(G.t * 3);
    for (const [x, y] of G.bars) px(x, y, 3, pulse);
  }
  // grass: dim green tufts (render as ',' via the ramp)
  if (G.cur.tufts) for (const tf of G.cur.tufts) {
    px(tf.x, tf.y, 4, (0.24 + 0.08 * Math.sin(G.t * 2 + tf.x)) * Math.max(0.3, lightAt(tf.x, tf.y) * 1.5));
  }
  // the fountain pool
  if (G.pool) {
    for (let i = 0; i < 70; i++) {
      const a = i / 70 * Math.PI * 2;
      const rr = G.pool.r * (0.35 + 0.65 * ((i * 7) % 10) / 10);
      px(G.pool.x + Math.cos(a + G.t * 0.4) * rr, G.pool.y + Math.sin(a + G.t * 0.4) * rr * 0.6, i % 3 ? 6 : 3, 0.3 + 0.18 * Math.sin(G.t * 3 + i));
    }
  }
  // a heart piece shimmers, barely (the lantern makes it honest)
  if (G.cur.piece) {
    const pc = G.cur.piece;
    const dowsing = heldKind() === 'lantern';
    const al = dowsing ? 0.7 + 0.3 * Math.sin(G.t * 6) : 0.14 + 0.12 * Math.sin(G.t * 1.7);
    px(pc.x, pc.y, 7, al); px(pc.x + 1, pc.y, 7, al * 0.7); px(pc.x, pc.y - 1, 7, al * 0.7);
  }
  // the old duck and his wares
  if (G.cur.merchant) {
    blit(SPR.duck[0], G.cur.merchant.x - 4, G.cur.merchant.y - 3, 1, 0.9, false);
    A.text(G.cur.merchant.x - 1, G.cur.merchant.y - 6, '$', 5, 0.8 + 0.2 * Math.sin(G.t * 2));
  }
  if (G.cur.goods) for (const gd of G.cur.goods) {
    const spr = SPR[gd.kind];
    if (spr) blit(spr, gd.x - spr[0].length / 2, gd.y - spr.length / 2 + Math.sin(G.t * 2 + gd.x) * 0.8, ITEMS[gd.kind] ? ITEMS[gd.kind].ci : 7, 0.9, false);
    A.text(gd.x - 2, gd.y + 3, String(gd.price), liveScore() >= gd.price ? 5 : 7, 0.85);
    if (Math.hypot(gd.x - G.player.x, gd.y - G.player.y) <= 3) {
      A.text(gd.x - 6, gd.y + 5, liveScore() >= gd.price ? '[C] BUY' : '[C] TOO POOR', liveScore() >= gd.price ? 5 : 7, 0.9);
    }
  }
  // stairs + orbiting glyph vortex
  if (G.cur.type === 'stairs' && G.cur.cleared) {
    const pulse = 0.5 + 0.5 * Math.sin(G.t * 4);
    rect(77, 44, 7, 6, 6, 0.35 + 0.2 * pulse);
    A.text(79, 46, '>>', 5, 0.7 + 0.3 * pulse);
    for (let i = 0; i < 8; i++) {
      const a = G.t * 2.6 + i * Math.PI / 4;
      const r = 6 + Math.sin(G.t * 1.8 + i) * 2;
      px(80.5 + Math.cos(a) * r, 47 + Math.sin(a) * r * 0.7, 6, 0.35 + 0.3 * pulse);
    }
  }
  // the chest
  const ch = G.cur.chest;
  if (ch) {
    const glow = ch.opened ? 0.35 : 0.7 + 0.3 * Math.sin(G.t * 3);
    blit(SPR.chest, ch.x - 2.5, ch.y - 2, 5, glow * Math.max(0.3, lightAt(ch.x, ch.y) * 1.6), false);
    if (!ch.opened && Math.random() < 0.1) px(ch.x - 3 + Math.random() * 6, ch.y - 3 + Math.random() * 5, 5, 0.5);
  }
  // pickups (slot items sparkle)
  for (const pk of G.pickups) {
    const bob = Math.sin(pk.ph) * 1.2;
    const spr = SPR[pk.kind];
    const ci = pk.slot ? ITEMS[pk.kind].ci : pk.kind === 'heart' ? 7 : pk.kind === 'sword' ? 0 : 3;
    if (spr) blit(spr, pk.x - spr[0].length / 2, pk.y - spr.length / 2 + bob, ci, 0.9 * Math.max(0.3, lightAt(pk.x, pk.y) * 1.6), false);
    if (pk.slot && Math.random() < 0.08) {
      const a = Math.random() * Math.PI * 2;
      G.parts.push({ x: pk.x + Math.cos(a) * 3, y: pk.y + Math.sin(a) * 2.5, vx: 0, vy: -2, ci: 5, life: 0.4, t: 0 });
    }
    // armory pedestals wear their name; the nearest one shows its hint
    if (pk.pedestal) {
      rect(pk.x - 2, pk.y + 2, 5, 1, 1, 0.4); // plinth
      const near = Math.hypot(pk.x - p.x, pk.y - p.y) < 6;
      A.text(pk.x - ITEMS[pk.kind].label.length / 2, pk.y - 4, ITEMS[pk.kind].label, ci, near ? 1 : 0.7);
      if (near) A.text(pk.x - ITEMS[pk.kind].hint.length / 2, pk.y + 4, ITEMS[pk.kind].hint, 1, 0.8);
    }
  }
  // enemies (in PITCH DARK, the unseen render as faint static — but telegraphs stay honest)
  for (const e of G.enemies) {
    if (e.telegraph > 0) { // materialize static
      for (let i = 0; i < 14; i++) px(e.x + Math.random() * 8 - 4, e.y + Math.random() * 6 - 3, e.ci, Math.random() * 0.7);
      continue;
    }
    const lv = lightAt(e.x, e.y);
    if (mut('DARK') && lv < 0.2 && e.state !== 'windup') {
      for (let i = 0; i < 6; i++) px(e.x + Math.random() * 6 - 3, e.y + Math.random() * 5 - 2.5, e.ci, Math.random() * 0.16);
      continue;
    }
    let bright = 0.85 * Math.max(0.35, Math.min(1, lv * 1.7));
    if (e.state === 'windup') bright = 0.55 + Math.sin(G.t * 24) * 0.45; // full-depth pulse (never clamps) beats darkness
    if (e.flash > 0) bright = 1.6;
    const frame = ((G.t * 6) | 0) % 2;
    const spr = SPR[e.type][frame];
    blit(spr, e.x - spr[0].length / 2, e.y - spr.length / 2, e.ci, bright, e.vx > 0.5);
    // the windup draws its OWN reach: a chevron as long as the lunge will actually travel
    if (e.state === 'windup') {
      const la = Math.atan2(p.y - e.y, p.x - e.x);
      const reach = e.spd * LUNGE_MULT * LUNGE_TIME * (mut('HASTE') ? 1.4 : mut('MOLASSES') ? 0.7 : 1);
      for (let r2 = 2; r2 < reach; r2 += 1.2) {
        px(e.x + Math.cos(la) * r2, e.y + Math.sin(la) * r2 * 0.8, 0, 0.8);
      }
      px(e.x + Math.cos(la + 0.4) * (reach - 1), e.y + Math.sin(la + 0.4) * (reach - 1) * 0.8, 0, 0.7);
      px(e.x + Math.cos(la - 0.4) * (reach - 1), e.y + Math.sin(la - 0.4) * (reach - 1) * 0.8, 0, 0.7);
    }
    // turret aim: 0.3s of real time before the bolt, at every room speed
    if (e.type === 'turret' && e.aimT > 0) {
      const aa = Math.atan2(p.y - e.y, p.x - e.x);
      const k = 1 - e.aimT / TURRET_AIM;
      for (let r2 = 3; r2 < 3 + 4 * k; r2 += 1) px(e.x + Math.cos(aa) * r2, e.y + Math.sin(aa) * r2 * 0.8, 5, 0.9);
      if (((G.t * 20) | 0) % 2 === 0) px(e.x, e.y - 3.5, 5, 1);
    }
    // IRONFRONT: the iron face gleams on the guarded side
    if (mut('IRONFRONT') && e.faceA !== undefined) {
      px(e.x + Math.cos(e.faceA) * 3.4, e.y + Math.sin(e.faceA) * 2.8, 0, 0.9);
      px(e.x + Math.cos(e.faceA + 0.5) * 3.2, e.y + Math.sin(e.faceA + 0.5) * 2.6, 0, 0.6);
      px(e.x + Math.cos(e.faceA - 0.5) * 3.2, e.y + Math.sin(e.faceA - 0.5) * 2.6, 0, 0.6);
    }
    // THE ORDER: numbered deaths, next one lit
    if (mut('ORDER') && e.ord) A.text(e.x - 0.5, e.y - 5, String(e.ord), e.ord === G.ordNext ? 5 : 1, e.ord === G.ordNext ? 1 : 0.5);
  }
  // THE HUNGRY ONE: a fat wobbling gullet
  if (G.hungry) {
    const h = G.hungry;
    for (let yy = -2; yy <= 2; yy++) for (let xx = -3; xx <= 3; xx++) {
      const w = Math.sin(G.t * 5 + xx + yy) * 0.4;
      if (xx * xx / 9 + yy * yy / 4 <= 1) px(h.x + xx + w, h.y + yy, 8, 0.75 + 0.15 * Math.sin(G.t * 4 + xx * yy));
    }
    px(h.x - 1, h.y - 1, 0, 1); px(h.x + 1, h.y - 1, 0, 1);
    if (h.swallowed) {
      px(h.x, h.y + 0.5, ITEMS[h.swallowed.kind].ci, 0.9);
      A.text(h.x - 0.5, h.y - 5, h.digestT.toFixed(1), 7, 0.9);
    }
  }
  // THE BAT (gold, so you know it's trouble)
  if (G.bat) {
    const b = G.bat;
    const frame = ((G.t * 10) | 0) % 2;
    blit(SPR.bat[frame], b.x - 2.5, b.y - 1.5, 5, 1, b.x < p.x);
    if (b.carrying) px(b.x, b.y + 2.2, ITEMS[b.carrying.kind].ci, 0.9);
  }
  // bolts
  for (const b of G.bolts) {
    px(b.x, b.y, 4, 1);
    px(b.x - b.vx * 0.02, b.y - b.vy * 0.02, 4, 0.5);
  }
  // player bullets + ninja stars + bombs
  for (const b of G.pbolts) { px(b.x, b.y, 0, 1); px(b.x - b.vx * 0.015, b.y - b.vy * 0.015, 2, 0.6); }
  for (const bm of G.bombs || []) {
    blit(SPR.bomb, bm.x - 1, bm.y - 1, 7, 0.9, false);
    // the fuse sputters faster as it shortens
    if (((G.t * (4 + (1.4 - bm.fuse) * 14)) | 0) % 2 === 0) px(bm.x + (Math.random() - 0.5), bm.y - 2, 5, 1);
    if (bm.fuse < 0.35) rect(bm.x - 1, bm.y - 1, 3, 3, 0, 0.5 + 0.5 * Math.sin(G.t * 40)); // white panic flash
  }
  for (const s2 of G.stars) {
    const sp = ((G.t * 14) | 0) % 2;
    if (sp) { px(s2.x - 1, s2.y, 3, 1); px(s2.x + 1, s2.y, 3, 1); px(s2.x, s2.y, 0, 1); }
    else { px(s2.x, s2.y - 1, 3, 1); px(s2.x, s2.y + 1, 3, 1); px(s2.x, s2.y, 0, 1); }
  }
  // ---- weapon animations ----
  // boomerangs (spinning arc) + spore lobs (shadow + rising seed)
  for (const b of G.booms) {
    if (b.spore) {
      px(b.x, b.y, 1, 0.3); // ground shadow
      px(b.x, b.y - b.z, 4, 1); px(b.x, b.y - b.z - 1, 4, 0.5);
    } else {
      const sp = ((G.t * 20) | 0) % 4;
      const g = ['/', '-', '\\', '|'][sp];
      A.text(b.x, b.y, g, 5, 1);
      px(b.x - b.vx * 0.02, b.y - b.vy * 0.02, 5, 0.4);
    }
  }
  // spore vine-patches: a writhing bramble
  for (const pc of G.patches) {
    const a = Math.min(1, pc.t) * Math.min(1, (2 - pc.t) * 2);
    for (let i = 0; i < 22; i++) {
      const ang = i / 22 * Math.PI * 2 + G.t * 0.8, rr = pc.r * (0.4 + 0.5 * ((i * 7) % 10) / 10);
      px(pc.x + Math.cos(ang) * rr, pc.y + Math.sin(ang) * rr * 0.7, 4, 0.5 * a * (0.5 + 0.5 * Math.sin(G.t * 4 + i)));
    }
  }
  // each weapon draws its OWN color-matched attack animation
  drawWeaponFx(p);
  // hammer smash shockwave (paired with the hammer wfx)
  if (G.smashFx) {
    const s = G.smashFx, k = 1 - s.t / 0.25;
    for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2; px(s.x + Math.cos(a) * s.r * k, s.y + Math.sin(a) * s.r * k * 0.8, 7, 1 - k); }
  }
  // flail head orbiting
  if (p.flailPos) {
    px(p.flailPos.x, p.flailPos.y, 8, 1); px(p.flailPos.x, p.flailPos.y - 1, 8, 0.7);
    // chain
    for (let s = 0.25; s < 1; s += 0.25) px(p.x + (p.flailPos.x - p.x) * s, p.y + (p.flailPos.y - p.y) * s, 1, 0.4);
  }
  // player (breathing bob at rest, squash-stretch stepping when moving)
  const blink = p.invulnT > 0 && ((G.t * 12) | 0) % 2 === 0;
  if (!blink && G.state === 'play') {
    const ci = p.dashT > 0 ? 3 : 0;
    const moving = Math.hypot(p.ivx || 0, p.ivy || 0) > 2;
    const bobY = moving ? 0 : Math.sin(G.t * 3) * 0.45;
    if (moving && ((G.t * 9) | 0) % 2 === 0) rect(p.x - 1.5, p.y - 0.5, 4, 2, ci, 1);
    else rect(p.x - 1, p.y - 1 + bobY, 3, 3, ci, 1);
    px(p.x + p.dir.x * 2, p.y + p.dir.y * 2 + bobY, ci, 0.8);
    if (p.digestT > 0 && Math.random() < 0.15) px(p.x + Math.random() * 3 - 1.5, p.y - 2.5, 2, 0.5); // hotdog steam
    // hammer charging: a growing head over your shoulder + a charge bar
    if (p.charging && p.chargeT > 0.05) {
      const c = Math.min(1, p.chargeT / 1.2);
      const hx = p.x - p.dir.x * 3, hy = p.y - p.dir.y * 3 - 2 - c * 3;
      rect(hx - 1 - c, hy - 1 - c, 2 + c * 2, 2 + c * 2, 7, 0.8 + 0.2 * Math.sin(G.t * 30));
      for (let i = 0; i < c * 10; i++) px(p.x + Math.random() * 6 - 3, p.y + Math.random() * 6 - 3, 7, Math.random() * c);
      A.text(p.x - 2, p.y - 6, c >= 1 ? 'FULL' : '=' .repeat(Math.round(c * 4)), c >= 1 ? 5 : 7, 1);
    }
  }
  // ---- health as blue orbs orbiting in fake-3D ----
  // Each orb rides a tilted ring; sin(depth) scales its size and brightness so it reads as
  // circling behind and in front of you. The last orb runs red and stutters (crisis).
  if (G.state === 'play') {
    const crisis = p.hp <= 1;
    for (let i = 0; i < p.maxhp; i++) {
      if (i >= p.hp) continue; // spent orbs are gone
      const a = G.t * 2.2 + i / p.maxhp * Math.PI * 2;
      const depth = Math.sin(a); // -1 behind, +1 front
      const ox = p.x + Math.cos(a) * 7;
      const oy = p.y + depth * 3.2 - 0.5; // vertical bob from the tilt
      const sz = 0.6 + (depth + 1) * 0.5; // perspective size
      const ci = crisis ? 7 : 6;
      const jit = crisis ? (Math.random() - 0.5) * 1.2 : 0;
      const al = (0.55 + (depth + 1) * 0.22) * (crisis ? 0.6 + 0.4 * Math.abs(Math.sin(G.t * 12)) : 1);
      rect(ox - sz + jit, oy - sz * 0.7, sz * 2, sz * 1.4, ci, al);
      px(ox + jit, oy - sz * 0.7, 0, al * 0.6); // glint
      if (depth > 0.3 && Math.random() < 0.2) px(ox + Math.random() * 2 - 1, oy + 1, ci, 0.3); // trail
    }
    if (crisis && p.hp > 0) { // the world starts to fray at one orb
      for (let i = 0; i < 40; i++) px(Math.random() * COLS, Math.random() * ROWS, 7, Math.random() * 0.12);
    }
  }
  // slash arc with a lagging ghost trail
  if (p.atkT > 0) {
    const prog = 1 - p.atkT / 0.13;
    const baseA = Math.atan2(p.dir.y, p.dir.x);
    for (const [lag, dim] of [[0, 1], [0.28, 0.35]]) {
      const pr = prog - lag;
      if (pr < 0) continue;
      for (let da = -0.7; da <= 0.7; da += 0.12) {
        const a = baseA + da * (1 - pr * 0.3);
        for (let r = 3 + pr * 2; r < 8; r += 1) {
          px(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r * 0.9, da > -0.15 && da < 0.15 ? 0 : 5, (1 - pr) * (1 - Math.abs(da) * 0.6) * dim);
        }
      }
    }
  }
  // particles (incl. enemy dissolve-down-the-ramp deaths)
  for (const pt of G.parts) {
    pt.t += 1 / 60;
    if (pt.ghost) { rect(pt.x - 1, pt.y - 1, 3, 3, pt.ci, (1 - pt.t / pt.life) * 0.5); continue; }
    if (pt.dissolve) {
      const k = pt.t / pt.life;
      const spr = pt.dissolve;
      for (let r = 0; r < spr.length; r++) for (let c = 0; c < spr[r].length; c++) {
        if (spr[r][pt.flip ? spr[r].length - 1 - c : c] === ' ') continue;
        if (((r * 31 + c * 17 + ((pt.t * 60) | 0) * 3) % 97) < k * 130) continue; // cells flake away
        px(pt.x + c, pt.y + r + k * 2, pt.ci, (1 - k) * 0.8);
      }
      continue;
    }
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
  // HUD orbs: filled blue O = full, spent = dim. Last one runs red and pulses.
  let orbs = '';
  for (let i = 0; i < p.maxhp; i++) orbs += i < p.hp ? 'O' : '.';
  A.text(2, 0, 'DUCK SOULS', 1);
  A.text(14, 0, 'FLOOR ' + G.depth, 5);
  A.text(24, 0, 'LIFE ' + orbs, p.hp <= 1 ? 7 : 6, p.hp <= 1 ? 0.4 + 0.6 * Math.abs(Math.sin(G.t * 10)) : 1);
  if (p.dashCd <= 0) A.text(38, 0, 'DASH READY', 3);
  else { // live cooldown bar
    const frac = Math.max(0, Math.min(1, 1 - p.dashCd / (st.dashCd + 0.13)));
    A.text(38, 0, 'DASH [' + '#'.repeat(Math.round(frac * 5)) + '-'.repeat(5 - Math.round(frac * 5)) + ']', 1);
  }
  A.text(52, 0, 'SCORE ' + liveScore(), 2);
  A.text(66, 0, 'K ' + G.run.kills, 1, 0.7);
  A.text(88, 2, 'SEED ' + G.seed.toString(16).toUpperCase() + '  BEST ' + G.best, 1, 0.4);
  // pantheon strip: glyph lit if boon, barred if curse (shape = second channel)
  let x = 96;
  for (const g of P.GODS) {
    const b = boon(g.id), c = curse(g.id);
    const tag = g.glyph + (b ? '+' : c ? 'x' : ' ');
    A.text(x, 0, g.name.slice(0, 2) + tag, b ? g.ci : c ? 7 : 1, b || c ? 1 : 0.45);
    x += 6;
  }
  A.text(128, 0, muted ? 'MUTED' : '', 1, 0.5);
  // row 2: what you hold + what's wrong with this room
  const hk = p.held && p.held.kind;
  const ammoTxt = p.held && (hk === 'gun' || hk === 'bomb' || hk === 'sporebow') && p.held.ammo != null ? ' x' + p.held.ammo : '';
  const useBtn = p.held ? (ITEMS[hk].weapon ? '  ' : '  [C] ') : '';
  const heldTxt = p.held
    ? 'HELD: ' + ITEMS[hk].label + ammoTxt + useBtn + ITEMS[hk].hint
    : 'HELD: -- (bare fists: X slash)';
  A.text(2, 2, heldTxt, p.held ? ITEMS[p.held.kind].ci : 1, p.held ? 1 : 0.5);
  if (G.cur.mut) A.text(46, 2, '[ ' + MUT[G.cur.mut].name + ' ]', MUT[G.cur.mut].ci, 0.8 + 0.2 * Math.sin(G.t * 3));
  if (p.digestT > 0) A.text(72, 2, 'DIGESTING ' + p.digestT.toFixed(1), 2, 0.8);
  // minimap with actual geometry: rooms sit where they sit, so you can navigate back
  // to a chest instead of guessing (a flat list encodes zero adjacency)
  const cur = G.cur;
  const rs = [...G.rooms.values()];
  const gx0 = Math.min(...rs.map(r => r.gx)), gy0 = Math.min(...rs.map(r => r.gy));
  const gw = Math.max(...rs.map(r => r.gx)) - gx0 + 1;
  const mmx = COLS - gw * 4 - 3, mmy = 2;
  for (const r of rs) {
    const known = r.entered || [...G.rooms.values()].some(o => o.entered &&
      Math.abs(o.gx - r.gx) + Math.abs(o.gy - r.gy) === 1);
    if (!known) continue;
    const g = r === cur ? '#' : !r.entered ? '?' :
      r.type === 'stairs' ? '>' :
        (r.chest && !r.chest.opened) || (r.type === 'treasure' && r.items && r.items.length) ? '$' :
          r.cleared ? '=' : '!';
    const ci = r === cur ? 5 : g === '>' ? 6 : g === '$' ? 5 : g === '!' ? 7 : 1;
    A.text(mmx + (r.gx - gx0) * 4, mmy + (r.gy - gy0) * 2, '[' + g + ']', ci, r === cur ? 1 : 0.65);
  }
  // messages
  let my = 7;
  for (const m of G.msgs) {
    m.t -= 1 / 60;
    A.textC(my, m.text, m.ci, Math.min(1, m.t / (m.t0 * 0.4)));
    my += 2;
  }
  G.msgs = G.msgs.filter(m => m.t > 0);
}

function drawIntro(dt) {
  G.introT = (G.introT || 0) + dt;
  plasma(G.t * 0.08, 0.18, [6, 8, 1]);
  G.introGl = G.introGl || 0;
  let done = 0;
  INTRO_LINES.forEach((line, i) => {
    const el = G.introT - i * 1.4;
    if (el <= 0) return;
    const finished = typeText(26 + i * 5, line, i === INTRO_LINES.length - 1 ? 5 : 0, el, 26, Math.min(1, el * 2));
    if (finished) {
      done++;
      if (G.introGl < done) { G.introGl = done; A.startGlitch(0.6, 0.25); tone(70 + i * 12, 60, 0.5, 'sawtooth', 0.06); }
    }
  });
  if (done === INTRO_LINES.length && ((G.t * 1.5) | 0) % 2 === 0) A.textC(60, '- ANY KEY: WAKE -', 5);
  if (G.introT > 0.4) A.textC(84, 'any key skips', 1, 0.7);
}

function drawLore(dt) {
  G.loreT = (G.loreT || 0) + dt;
  plasma(G.t * 0.08, 0.1, [8, 6, 1]);
  const unlocked = P.unlockedLore(G.ledger);
  const ids = new Set(unlocked.map(f => f.id));
  A.textC(8, 'M E M O R I E S', 0);
  A.textC(11, unlocked.length + ' OF ' + P.LORE.length + ' SURFACED', 1, 0.7);
  P.LORE.forEach((f, i) => {
    const el = G.loreT - i * 0.25;
    if (el <= 0) return;
    const al = Math.min(1, el * 3);
    if (ids.has(f.id)) typeText(16 + i * 4, f.text, i % 2 ? 3 : 0, el, 60, al);
    else A.textC(16 + i * 4, '. . . ' + '. '.repeat(8) + '(not yet earned)', 1, al * 0.3);
  });
  if (((G.t * 1.5) | 0) % 2 === 0) A.textC(66, '- ANY KEY: BACK -', 5);
}

function drawTitle() {
  plasma(G.t * 0.7, 0.5, [6, 3, 8, 2]);
  bigText(80, 14, 'DUCK', 2, 5, 0.95, 1.1);
  bigText(80, 26, 'SOULS', 2, 7, 0.95, 1.1);
  // dim the plasma behind the menu block so text pops
  S.globalAlpha = 0.72; S.fillStyle = '#000';
  S.fillRect(22, 38, 116, 44);
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
  // the menu: Start / Cutscene Library / Credits (+ rules, memories)
  G.titleT = (G.titleT || 0) + 1 / 60;
  const led = G.ledger;
  const nLore = P.unlockedLore(led).length;
  const MENU = [['start', 'DESCEND'], ['library', 'CUTSCENE LIBRARY (' + (G.cineSeen ? G.cineSeen.size : loadCine().size) + '/12)'],
  ['credits', 'CREDITS'], ['rules', 'HOW A PLANT HEARS THE RULES'], ['memories', 'MEMORIES (' + nLore + '/' + P.LORE.length + ')']];
  const mi = G.menuI || 0;
  MENU.forEach((m, i) => {
    const on = i === mi;
    const lbl = (on ? '> ' : '  ') + m[1] + (on ? ' <' : '');
    A.textC(60 + i * 2, lbl, on ? 5 : 1, on ? 1 : 0.55);
  });
  A.textC(71, 'arrows to choose, ENTER to select', 1, 0.5);
  if (led.runs > 0) {
    const lr = led.lastRuns[0];
    A.textC(74, 'RUNS ' + led.runs + '   DEEPEST FLOOR ' + led.deepest + '   BEST ' + led.bestScore +
      (lr ? '   LAST: F' + lr.f + ' / ' + lr.k + ' KILLS / ' + lr.s : ''), 1, 0.75);
    const latest = P.unlockedLore(led).slice(-1)[0];
    if (latest) typeText(77, '"' + latest.text + '"', 1, G.titleT - 1, 24, 0.6);
  }
  A.textC(86, 'BlueDuck LLC / the ducks are dragons / the dragons are ducks', 1, 0.4);
}

function drawJudgment(dt) {
  G.judgeT += dt;
  plasma(G.t * 0.15, 0.15 * (1 + (G.surge || 0) * 1.6), [6, 8, 1]);
  A.textC(8, 'THE PANTHEON PASSES JUDGMENT', 0);
  A.textC(11, 'FLOOR ' + G.depth + ' CLEARED  --  ' + G.verdictText, 5);
  const pw = 31, py = 20;
  G.cards.forEach((c, i) => {
    const t = G.judgeT - i * 0.22;
    if (t < 0) return;
    if (!c.landed) { // the god arrives: reality flinches
      c.landed = true;
      G.surge = 1;
      A.startGlitch(0.55, 0.22, i % 2 ? 'chroma' : 'shear');
      tone(180 + i * 55, 175 + i * 55, 0.3, 'sawtooth', 0.07);
    }
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
    if (P.boonActive({ [c.id]: c.favorAfter }, c.id)) A.text(x0 + 2, py + 31, ('BOON: ' + P.GODS[i].boon.desc).slice(0, pw - 3), c.ci, al);
    else if (P.curseActive({ [c.id]: c.favorAfter }, c.id)) A.text(x0 + 2, py + 31, ('CURSE: ' + P.GODS[i].curse.desc).slice(0, pw - 3), 7, al);
  });
  if (G.chaliceNote) A.textC(64, G.chaliceNote, 5, 0.9);
  if (G.judgeT > 1.4 && ((G.t * 1.5) | 0) % 2 === 0) A.textC(68, '- SPACE: DESCEND TO FLOOR ' + (G.depth + 1) + ' -', 5);
  // stat legend
  A.textC(74, 'every grade is a pure function over this floor\'s numbers -- no vibes', 1, 0.5);
}

function drawDead(dt) {
  G.deadT += dt;
  plasma(G.t * 0.1, 0.15, [7, 1]);
  drawWorld(); // corpse particles keep raining
  bigText(80, 18, 'YOU', 3, 7, Math.min(1, G.deadT * 2), 0.7);
  bigText(80, 36, 'DIED', 3, 7, Math.min(1, Math.max(0, G.deadT - 0.3) * 2), 0.7);
  if (G.deadT > 1) {
    A.textC(54, G.epitaph, 1);
    const r = G.run;
    const extras = [r.chests ? r.chests + ' CHEST' : '', r.chalices ? 'CHALICE' : '', r.hotdogs ? r.hotdogs + ' HOTDOG' : '', r.stolen ? r.stolen + ' STOLEN' : ''].filter(Boolean).join('   ');
    A.textC(57, 'RUN ' + G.ledger.runs + ':  FLOOR ' + r.floors + '   KILLS ' + r.kills + '   SCORE ' + r.score + '   BEST ' + G.best, 0);
    if (extras) A.textC(59, extras, 5, 0.8);
    let x = 40, y = 62;
    for (const g of P.GODS) {
      A.text(x, y, g.glyph + ' ' + String(G.favor[g.id]).padStart(3), boon(g.id) ? g.ci : curse(g.id) ? 7 : 1);
      x += 16;
    }
    // what you're closer to than you were — the reason to press R
    const led = G.ledger;
    const unlocked = P.unlockedLore(led).length;
    const goals = [
      led.deepest < 3 ? 'DEEPEST ' + led.deepest + '/3 — one more floor unlocks the gods\' boons' : null,
      (led.totalChests || 0) < 1 ? 'NO CHEST OPENED YET — the key is always on the floor' : null,
      (led.totalPieces || 0) % 4 !== 0 || !led.totalPieces ? 'HEART PIECES ' + ((led.totalPieces || 0) % 4) + '/4 — four make a heart' : null,
      led.deepest < 5 ? 'DEEPEST ' + led.deepest + '/5 — the sixth god is buried deeper' : null,
    ].filter(Boolean);
    A.textC(64, 'MEMORIES ' + unlocked + '/' + P.LORE.length + '   ' + (goals[0] || 'THE PANTHEON IS WATCHING'), 8, 0.9);
    // a memory surfaces, typed like a bad signal
    if (G.whisper) {
      if (G.whisperNew) A.textC(66, '- A MEMORY SURFACES -', 8, 0.8);
      typeText(68, '"' + G.whisper + '"', G.whisperNew ? 8 : 1, G.deadT - 1.5, 22, 0.85);
    }
    if (((G.t * 1.5) | 0) % 2 === 0) A.textC(74, '- R: DESCEND AGAIN  /  ANY KEY: RETURN TO THE BEGINNING -', 5);
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
  G.surge = Math.max(0, (G.surge || 0) - dt * 2);
  // ambient reality failure: the world glitches on its own schedule
  G.glitchT = (G.glitchT === undefined ? 6 : G.glitchT) - dt;
  if (G.glitchT <= 0) {
    A.startGlitch(0.3 + Math.random() * 0.45, 0.15 + Math.random() * 0.2);
    G.glitchT = 8 + Math.random() * 12;
  }

  A.beginFrame();
  if (G.state === 'cinema') drawCinema(dt);
  else if (G.state === 'gallery') drawGallery(dt);
  else if (G.state === 'credits') drawCredits(dt);
  else if (G.state === 'intro') drawIntro(dt);
  else if (G.state === 'howto') drawHowto(dt);
  else if (G.state === 'lore') drawLore(dt);
  else if (G.state === 'title') drawTitle();
  else if (G.state === 'judgment') drawJudgment(dt);
  else if (G.state === 'dead') { drawDead(dt); drawHud(); }
  else if (G.state === 'descend') {
    // falling between floors: fake-3D character tunnel
    G.descT += dt;
    for (const s of G.streaks) {
      s.d += (s.s + s.d * 3.5) * dt;
      if (s.d > 100) s.d = 1 + Math.random() * 5;
      px(80 + Math.cos(s.a) * s.d, 45 + Math.sin(s.a) * s.d * 0.62, s.ci, Math.min(1, s.d / 25));
      px(80 + Math.cos(s.a) * s.d * 0.86, 45 + Math.sin(s.a) * s.d * 0.86 * 0.62, s.ci, Math.min(0.5, s.d / 40));
    }
    A.textC(44, 'F L O O R   ' + G.depth, 0, Math.min(1, G.descT * 2));
    if (G.descT > 1.15) { genFloor(); G.state = 'play'; }
  }
  else {
    if (G.hitstop > 0) G.hitstop -= dt;
    else updatePlay(dt);
    if (G.state === 'play' || G.state === 'dead') { drawWorld(); drawHud(); }
  }
  A.render();
}
requestAnimationFrame(frame);
