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
const SLASH_REACH = PARAMS.combat.slashReach;   // v1 default 7.0 (8.5 kiting-free, 6.0 suicidal)
const LUNGE_MULT = PARAMS.combat.lungeMult, LUNGE_TIME = PARAMS.combat.lungeTime; // travel ~4.0 cells at d1
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
  // frontal hits bounce off iron faces (IRONFRONT room) AND off a Darknut's shield — flank it
  if ((!mut('IRONFRONT') && !e.shield) || e.faceA === undefined) return false;
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
  whip: { label: 'WHIP', hint: 'hold X: wind, release: CRACK', ci: 2, weapon: true, melee: true },
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
  whip: { dmg: 3, cd: 0.42, reach: 26, ci: 2, multi: 1 },     // 7.1 dps, physical chain: tip-speed damage
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
// double-click (or double-tap C) -> the JELLY transformation
window.addEventListener('dblclick', () => tryJelly());
function tryJelly() {
  const p = G.player;
  if (!p || G.state !== 'play') return;
  if (p.jellyT > 0 || (p.jellyCd || 0) > 0) return;
  p.jellyT = 6; p.jellyCd = 16;
  p.jvx = p.dir.x * 10; p.jvy = p.dir.y * 8;
  fw('pinwheel', p.x, p.y, 8); fw('ringlet', p.x, p.y, 3);
  msg('JELLY FORM: roll! X = BOUNCE-SLAM', 8, 2.2);
  A.startGlitch(0.8, 0.3, 'chroma');
  tone(200, 900, 0.3, 'sine', 0.1);
}
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
  N: ['#   #', '##  #', '# # #', '#  ##', '#   #'],
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
  // --- arcade homage roster (compact sprites; one frame each unless animated) ---
  grunt: [['#o#o#', '#####', '#   #']],                       // Robotron grunt
  ghost: [[' ### ', '#o#o#', '#####', '# # #']],              // Pac ghost
  hopper: [[' o o ', '#####', ' # # ']],                      // Q*bert hopper
  strafer: [['>####', '#o##<', '>####']],                     // Defender strafer
  rider: [[' ^^ ', '#oo#', '####', '/  \\']],                 // Joust mount-rider
  splitter: [[' ## ', '####', '####', ' ## ']],               // Asteroids splitter
  inflater: [[' ## ', '#oo#', '####']],                       // Dig Dug inflater
  diver: [['\\   /', ' #o# ', '  #  ']],                      // Galaga diver
  marcher: [['#o#o#', ' ### ', '# # #']],                     // Space Invaders marcher
  spinner: [[' /#\\ ', '#o#o#', ' \\#/ ']],                    // Tempest spinner
  lobber: [[' ### ', '#ooo#', ' ### ', '  ^  ']],             // Missile Command lobber
  waller: [[' ## ', '#oo#', '#==#']],                         // Tron waller
  bubbler: [[' () ', '(oo)', ' () ']],                        // Bubble Bobble bubbler
  otto: [[' :) ', '####', '####']],                           // Berzerk Otto (a grinning bouncer)
  burner: [['  #  ', ' ### ', '#####', ' ### ']],             // Dragon's Lair flash-burner
  slinky: [['@']],                                            // prime slinky segment (drawn as a chain)
  // --- Zelda 1 (top-down) sprites ---
  octorok: [[' ## ', '#oo#', '####', '# # ']],                // Octorok
  moblin: [[' ^^ ', '#oo#', '####', '/##\\']],                // Moblin (snout + spear)
  tektite: [['# #', '#o#', '/ \\']],                          // Tektite (spider)
  gibdo: [['####', '#oo#', '####', '####', '#  #']],          // Gibdo (mummy, tall)
  rope: [['#o~~~', ' ####']],                                 // Rope (snake)
  leever: [[' ## ', '#oo#', ' ## ']],                         // Leever (surfaced)
  darknut: [['####', '#oo#', '#||#', '#  #']],                // Darknut (armored, shield bars)
  peahat: [[' \\|/ ', '-#o#-', ' /|\\ ']],                    // Peahat (spinning flower)
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
  potion: [' # ', '###', '#o#', '###'],
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
  // safe default; a fresh soul is booted INTO the cutscene via playCine() below (which
  // builds G.stage — setting state:'cinema' directly here left it undefined => black screen)
  state: 'title', t: 0,
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
  const n = G.depth >= 4 ? PARAMS.room.countFloor4up : PARAMS.room.countFloor1_3; // v10 + tunable
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
    r.mut = (r.type === 'fight' || r.type === 'stairs') && rng() < PARAMS.room.mutRoll ? G.mutBag.pop() : null;
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
    const insc = PARAMS.room.insetScale;
    const ix2 = Math.min(46, Math.round((ARCH[r.arch] || ARCH.CAVE).inset[0] * insc)), iy2 = Math.min(28, Math.round((ARCH[r.arch] || ARCH.CAVE).inset[1] * insc));
    const rx0 = 1 + ix2, rx1 = COLS - 2 - ix2, ry0 = 5 + iy2, ry1 = ROWS - 2 - iy2;
    return [rx0 + 8 + rng() * Math.max(4, rx1 - rx0 - 16), ry0 + 6 + rng() * Math.max(4, ry1 - ry0 - 12)];
  };
  const fights = [...rooms.values()].filter(r => r.type === 'fight');
  if (fights.length >= 1) { // v10: one minion room is enough — it holds key AND chest
    // the ritual, simplified: key and chest share ONE room (clear it, take both)
    const ka = fights[(rng() * fights.length) | 0];
    const [kx, ky] = spot(ka);
    ka.items.push({ x: kx, y: ky, kind: 'key', slot: true, ph: 0 });
    const [cx, cy] = spot(ka);
    ka.chest = { x: Math.abs(cx - kx) < 8 ? cx + 10 : cx, y: cy, opened: false };
  }
  const toolRoom = [...rooms.values()][(rng() * rooms.size) | 0];
  const [tx, ty] = spot(toolRoom);
  // (floor tool clutter pruned v9: weapons live in the ARMORY; the floor's story is key->chest)
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
  msg('find the KEY. open the CHEST. face what answers.', 1, 3);
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
  // PARAMS.room.insetScale shapes room SIZE (>1 = tighter); clamped so the arena stays playable
  const isc = PARAMS.room.insetScale;
  const ix = Math.min(46, Math.round(arch.inset[0] * isc)), iy = Math.min(28, Math.round(arch.inset[1] * isc));
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
    const wares = [['heart', 60], ['sword', 150], ['heart', 70]];
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
    msg(MUT[room.mut].desc, 1, 2.6); fw('spiral', 80, 20, MUT[room.mut].ci);
    A.startGlitch(0.8, 0.35);
    tone(80, 40, 0.5, 'sawtooth', 0.1);
  }
}

// 21 arcade-homage enemies as archetype + stats (the difficulty knob). Each has a real
// distinct behavior (archetype AI below); test.js guards every key is consumed. `at` = the
// depth it starts appearing, `cost` = its DANGER-budget weight, `arch` = its AI archetype.
const ENEMIES = {
  grunt: { arch: 'chase', ci: 8, hp: 1, spd: 6, r: 2.2, at: 1, cost: 1, homage: 'Robotron' },
  ghost: { arch: 'ghost', ci: 8, hp: 2, spd: 7, r: 2.2, at: 2, cost: 2, homage: 'Pac-Man' },
  hopper: { arch: 'hop', ci: 5, hp: 2, spd: 0, r: 2.0, at: 2, cost: 2, homage: 'Q*bert' },
  strafer: { arch: 'strafe', ci: 3, hp: 2, spd: 13, r: 2.2, at: 3, cost: 2, homage: 'Defender' },
  rider: { arch: 'joust', ci: 2, hp: 2, spd: 8, r: 2.4, at: 4, cost: 3, homage: 'Joust' },
  splitter: { arch: 'split', ci: 1, hp: 2, spd: 4, r: 2.6, at: 3, cost: 2, homage: 'Asteroids' },
  inflater: { arch: 'chase', ci: 4, hp: 3, spd: 3, r: 2.4, at: 2, cost: 2, homage: 'Dig Dug' },
  diver: { arch: 'dive', ci: 2, hp: 2, spd: 10, r: 2.2, at: 3, cost: 3, homage: 'Galaga' },
  marcher: { arch: 'march', ci: 4, hp: 2, spd: 3, r: 2.2, at: 4, cost: 2, homage: 'Space Invaders' },
  spinner: { arch: 'spin', ci: 6, hp: 3, spd: 6, r: 2.4, at: 5, cost: 3, homage: 'Tempest' },
  lobber: { arch: 'lob', ci: 7, hp: 3, spd: 2, r: 2.6, at: 4, cost: 3, homage: 'Missile Command' },
  waller: { arch: 'wall', ci: 6, hp: 3, spd: 7, r: 2.2, at: 5, cost: 3, homage: 'Tron' },
  bubbler: { arch: 'shoot', ci: 3, hp: 2, spd: 3, r: 2.2, at: 4, cost: 3, homage: 'Bubble Bobble', bubble: true },
  otto: { arch: 'bounce', ci: 7, hp: 99, spd: 6, r: 2.4, at: 6, cost: 4, homage: 'Berzerk', invuln: true },
  burner: { arch: 'burn', ci: 7, hp: 4, spd: 0, r: 2.6, at: 5, cost: 3, homage: "Dragon's Lair" },
  slinky: { arch: 'slink', ci: 5, hp: 5, spd: 8, r: 2.0, at: 3, cost: 4, homage: 'a prime slinky', segments: 8 },
  // --- The Legend of Zelda (1986, top-down) roster ---
  octorok: { arch: 'shoot', ci: 2, hp: 2, spd: 4, r: 2.2, at: 2, cost: 2, homage: 'Zelda: Octorok' },
  moblin: { arch: 'chase', ci: 4, hp: 3, spd: 6, r: 2.4, at: 3, cost: 2, homage: 'Zelda: Moblin' },
  tektite: { arch: 'hop', ci: 8, hp: 2, spd: 0, r: 2.0, at: 2, cost: 2, homage: 'Zelda: Tektite' },
  gibdo: { arch: 'chase', ci: 1, hp: 8, spd: 3, r: 2.6, at: 4, cost: 3, homage: 'Zelda: Gibdo (mummy tank)' },
  rope: { arch: 'dive', ci: 7, hp: 2, spd: 7, r: 2.0, at: 3, cost: 2, homage: 'Zelda: Rope (snake)' },
  leever: { arch: 'burrow', ci: 5, hp: 3, spd: 6, r: 2.2, at: 4, cost: 3, homage: 'Zelda: Leever' },
  darknut: { arch: 'chase', ci: 6, hp: 4, spd: 5, r: 2.4, at: 5, cost: 3, homage: 'Zelda: Darknut (shielded)', shield: true },
  peahat: { arch: 'peahat', ci: 4, hp: 3, spd: 5, r: 2.2, at: 5, cost: 3, homage: 'Zelda: Peahat (spins invuln)' },
};
const ENEMY_KEYS = Object.keys(ENEMIES);
// small primes drive the slinky's turn rhythm (operator's "random prime generator" spin)
const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37];

function spawnOne(type, rng, place, room) {
  const d = ENEMIES[type];
  const pos = place();
  const base = { type, arch: d.arch, x: pos.x, y: pos.y, vx: 0, vy: 0, telegraph: 0.7 + rng() * 0.4, flash: 0, kx: 0, ky: 0, state: 'seek', st: 0, ci: d.ci, r: d.r, spd: d.spd * (1 + PARAMS.enemy.speedScale * G.depth) };
  base.hp = d.invuln ? d.hp : d.hp + Math.floor(G.depth / 3);
  base.hp0 = base.hp;
  if (d.bubble) base.bubble = true;
  if (d.invuln) base.invuln = true;
  if (d.shield) base.shield = true; // Darknut blocks frontal hits (via ironBlocked)
  if (type === 'slinky') { base.seg = []; base.primeI = (rng() * PRIMES.length) | 0; base.turnT = 0; base.ang = rng() * Math.PI * 2; for (let s = 0; s < (d.segments); s++) base.seg.push({ x: pos.x, y: pos.y }); }
  if (d.arch === 'shoot' || d.arch === 'lob' || d.arch === 'march') base.cd = 1 + rng();
  if (room.mut === 'SWARM') base.hp = Math.max(1, Math.ceil(base.hp / 2));
  G.enemies.push(base);
}

function spawnEnemies(room, rng, fromDir) {
  let nDucks = 1 + Math.min(G.depth, 4) + (curse('pluma') ? FX.CURSE_PLUMA : 0);
  let nBats = G.depth >= 2 ? 1 + ((rng() * Math.min(G.depth, 3)) | 0) : 0;
  let nTurrets = G.depth >= 3 ? 1 + (G.depth >= 5 ? 1 : 0) : 0;
  if (room.mut === 'SWARM') { nDucks *= 2; nBats *= 2; } // half HP applied below
  // density cap: a tiny crypt/grotto can't fairly hold a full swarm (~1 enemy / 260 cells)
  const freeCells = (X1 - X0) * (Y1 - Y0);
  const cap = Math.max(3, Math.floor(freeCells / PARAMS.spawn.densityDiv));
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
    if (type === 'duck') Object.assign(base, { hp: 3 + Math.floor(G.depth / PARAMS.enemy.hpDivDuck), r: 3.2, spd: 5.5 + 0.5 * G.depth, ci: 2 });
    if (type === 'bat') Object.assign(base, { hp: 1 + Math.floor(G.depth / 4), r: 1.8, spd: 9 + 0.4 * G.depth, ci: 8, ph: rng() * 6 });
    if (type === 'turret') Object.assign(base, { hp: 4 + Math.floor(G.depth / 3), r: 2.6, spd: 0, ci: 4, cd: 1 + rng(), aimT: 0 });
    if (room.mut === 'SWARM') base.hp = Math.max(1, Math.ceil(base.hp / 2));
    base.hp0 = base.hp;
    G.enemies.push(base);
  };
  for (let i = 0; i < nDucks; i++) mk('duck');
  for (let i = 0; i < nBats; i++) mk('bat');
  for (let i = 0; i < nTurrets; i++) mk('turret');

  // DANGER budget: from depth 2 on, spend a growing budget on the arcade roster, picking
  // only enemies unlocked by depth. Deeper = more/faster/nastier. Capped by room size.
  if (G.depth >= 2) {
    let budget = PARAMS.spawn.dangerBase + G.depth * PARAMS.spawn.dangerSlope;
    const pool = ENEMY_KEYS.filter(k => ENEMIES[k].at <= G.depth);
    let guard = 0;
    while (budget > 0 && pool.length && G.enemies.length < cap + 4 && guard++ < 40) {
      const k = pool[(rng() * pool.length) | 0];
      const c = ENEMIES[k].cost;
      if (c > budget + 1) { budget -= 1; continue; }
      spawnOne(k, rng, place, room);
      budget -= c;
    }
  }
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

// ---------- FIREWORKS: 30 named choreographies, hooked to game events ----------
// emit(cfg): n particles; ang0/spread shape the fan; g=gravity, tr=trail, sec=secondary
// burst name spawned when a particle dies (crossette). Motion picks brightness downstream.
function emit(x, y, ci, cfg) {
  const n = cfg.n || 14;
  for (let i = 0; i < n; i++) {
    const a = (cfg.ang0 || 0) + (cfg.ring ? i / n * Math.PI * 2 : (Math.random() - 0.5) * (cfg.spread || Math.PI * 2));
    const v = (cfg.spd || 18) * (cfg.even ? 1 : 0.4 + Math.random() * 0.8);
    G.parts.push({
      x, y, vx: Math.cos(a) * v * (cfg.sx || 1), vy: Math.sin(a) * v * (cfg.sy || 0.8) - (cfg.up || 0),
      ci: Array.isArray(ci) ? ci[i % ci.length] : ci, life: (cfg.life || 0.8) * (0.7 + Math.random() * 0.6), t: 0,
      g: cfg.g || 0, tr: cfg.tr || 0, sec: cfg.sec || null, wob: cfg.wob || 0, ph: Math.random() * 6,
    });
  }
}
const FIREWORKS = {
  ring: (x, y, c) => emit(x, y, c, { ring: true, even: true, n: 18, spd: 20 }),
  ring2: (x, y, c) => { emit(x, y, c, { ring: true, even: true, n: 16, spd: 22 }); emit(x, y, 0, { ring: true, even: true, n: 12, spd: 12 }); },
  willow: (x, y, c) => emit(x, y, c, { ring: true, n: 20, spd: 14, g: 22, tr: 1, life: 1.6 }),
  chrys: (x, y, c) => emit(x, y, c, { ring: true, even: true, n: 26, spd: 24, tr: 1, life: 1.1 }),
  peony: (x, y, c) => emit(x, y, [c, 0], { ring: true, n: 22, spd: 18, life: 1.2 }),
  crossette: (x, y, c) => emit(x, y, c, { ring: true, even: true, n: 6, spd: 16, life: 0.5, sec: 'ringlet' }),
  ringlet: (x, y, c) => emit(x, y, c, { ring: true, even: true, n: 6, spd: 10, life: 0.4 }),
  palm: (x, y, c) => emit(x, y, c, { spread: 1.2, ang0: -Math.PI / 2, n: 9, spd: 26, g: 26, tr: 1, life: 1.4 }),
  fountain: (x, y, c) => emit(x, y, c, { spread: 0.7, ang0: -Math.PI / 2, n: 24, spd: 22, g: 34, life: 1.3 }),
  fan: (x, y, c) => emit(x, y, c, { spread: 1.6, ang0: -Math.PI / 2, n: 12, spd: 24, tr: 1 }),
  spiral: (x, y, c) => { for (let i = 0; i < 20; i++) { const a = i * 0.55; G.parts.push({ x, y, vx: Math.cos(a) * (6 + i), vy: Math.sin(a) * (5 + i) * 0.8, ci: c, life: 0.9, t: 0, tr: 1 }); } },
  helix: (x, y, c) => { for (let i = 0; i < 24; i++) { const s = i % 2 ? 1 : -1; G.parts.push({ x, y, vx: (i / 3) * s, vy: -14, ci: i % 2 ? c : 6, life: 1.1, t: 0, g: 10, wob: 8, ph: i }); } },
  halo: (x, y, c) => emit(x, y - 4, c, { ring: true, even: true, n: 20, spd: 6, life: 1.4 }),
  implode: (x, y, c) => { for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2; G.parts.push({ x: x + Math.cos(a) * 14, y: y + Math.sin(a) * 10, vx: -Math.cos(a) * 20, vy: -Math.sin(a) * 16, ci: c, life: 0.6, t: 0 }); } },
  nova: (x, y, c) => { emit(x, y, [c, 0, 5], { ring: true, even: true, n: 30, spd: 30, tr: 1, life: 1.4 }); emit(x, y, 0, { ring: true, n: 14, spd: 8, life: 0.8 }); A.startGlitch(0.8, 0.3, 'pop'); },
  glyphs: (x, y, c) => { for (let i = 0; i < 8; i++) G.parts.push({ x, y, vx: (Math.random() - 0.5) * 24, vy: -10 - Math.random() * 12, ci: c, life: 1.2, t: 0, g: 20, glyph: '@#%&*+='[i % 7] }); },
  pinwheel: (x, y, c) => { for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; G.parts.push({ x, y, vx: Math.cos(a) * 16, vy: Math.sin(a) * 13, ci: i % 4 ? c : 5, life: 1, t: 0, wob: 14, ph: a }); } },
  waterfall: (x, y, c) => { for (let i = 0; i < 20; i++) G.parts.push({ x: x - 10 + i, y, vx: 0, vy: 4, ci: c, life: 1.6, t: 0, g: 18, tr: 1 }); },
  strobe: (x, y, c) => emit(x, y, [c, 0, c, 0], { ring: true, n: 16, spd: 3, life: 1.2 }),
  meteor: (x, y, c) => emit(x, y, c, { spread: 0.5, ang0: Math.PI * 0.75, n: 6, spd: 34, tr: 1, life: 0.9 }),
  geyser: (x, y, c) => emit(x, y, c, { spread: 0.3, ang0: -Math.PI / 2, n: 16, spd: 34, g: 40, life: 1.4, tr: 1 }),
  cascade: (x, y, c) => emit(x, y, c, { ring: true, n: 14, spd: 12, g: 30, sec: 'ringlet', life: 0.7 }),
  ribbon: (x, y, c) => { for (let i = 0; i < 18; i++) G.parts.push({ x, y, vx: 14 * Math.cos(i * 0.35), vy: -6, ci: c, life: 1.2, t: 0, wob: 10, ph: i * 0.5, tr: 1 }); },
  crackle: (x, y, c) => emit(x, y, [0, c], { ring: true, n: 26, spd: 26, life: 0.3, sec: 'ringlet' }),
  heartfw: (x, y, c) => { for (let i = 0; i < 20; i++) { const t = i / 20 * Math.PI * 2; G.parts.push({ x, y, vx: 16 * Math.pow(Math.sin(t), 3), vy: -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t)) * 0.9, ci: 7, life: 1.1, t: 0 }); } },
  diamond: (x, y, c) => { for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; const r = 1 / (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a))); G.parts.push({ x, y, vx: Math.cos(a) * 22 * r, vy: Math.sin(a) * 18 * r, ci: c, life: 0.9, t: 0 }); } },
  squarefw: (x, y, c) => { for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2; const r = 1 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))); G.parts.push({ x, y, vx: Math.cos(a) * 20 * r, vy: Math.sin(a) * 16 * r, ci: c, life: 0.9, t: 0 }); } },
  orbitfw: (x, y, c) => { for (let i = 0; i < 12; i++) G.parts.push({ x: x + Math.cos(i) * 6, y: y + Math.sin(i) * 4, vx: -Math.sin(i) * 14, vy: Math.cos(i) * 11, ci: c, life: 1.2, t: 0, wob: 6, ph: i }); },
  zigzag: (x, y, c) => { for (let i = 0; i < 12; i++) G.parts.push({ x, y, vx: (i % 2 ? 18 : -18), vy: -16 + i * 2.4, ci: c, life: 0.9, t: 0, wob: 20, ph: i }); },
  rain: (x, y, c) => { for (let i = 0; i < 24; i++) G.parts.push({ x: x - 16 + Math.random() * 32, y: y - 12, vx: 0, vy: 10 + Math.random() * 10, ci: c, life: 1.2, t: 0, tr: 1 }); },
  comet: (x, y, c) => emit(x, y, c, { spread: 0.2, ang0: -Math.PI / 4, n: 3, spd: 40, tr: 1, life: 1.2, sec: 'peony' }),
  bloomfw: (x, y, c) => { emit(x, y, 4, { ring: true, even: true, n: 10, spd: 8, life: 0.8 }); emit(x, y, 8, { ring: true, even: true, n: 8, spd: 14, life: 1 }); },
};
function fw(name, x, y, ci) { const f = FIREWORKS[name]; if (f) f(x, y, ci === undefined ? 5 : ci); }
// kill fireworks: each enemy CLASS gets its own send-off
function killFw(e) {
  const cls = e.type === 'duck' ? 'peony' : e.type === 'bat' ? 'zigzag' : e.type === 'turret' ? 'crossette'
    : ['octorok', 'moblin', 'tektite', 'gibdo', 'rope', 'leever', 'darknut', 'peahat'].includes(e.type) ? 'willow'
      : e.type === 'slinky' ? 'helix' : 'ring';
  fw(cls, e.x, e.y, e.ci);
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
    dashCd: PARAMS.combat.dashCd * (curse('umbra') ? FX.CURSE_UMBRA : 1),
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
    slashCore(w.reach, w.dmg, 0.35, 'rapier');
    G.wfx = { kind, a: baseA, t: 0.10, reach: w.reach };
    SFX.slash();
  } else if (kind === 'whip') {
    const jitter = (Math.random() - 0.5) * 0.98; // ±28° wild aim
    const a = baseA + jitter;
    let hit = false;
    for (const e of G.enemies) {
      if (e.telegraph > 0) continue;
      // reach + dead-zone + line-of-sight from the tested combat module; then the crack angle
      if (!Combat.weaponHits('whip', p.x, p.y, e.x, e.y, p.dir.x, p.dir.y, w.reach, isSolidCell)) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
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
      if (!Combat.weaponHits('flail', p.x, p.y, e.x, e.y, p.dir.x, p.dir.y, w.reach, isSolidCell)) continue;
      const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
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

// solid-cell test as a plain predicate for combat.js
const isSolidCell = (x, y) => solidAt(x, y);

// shared arc hit used by base slash + rapier (LOS-gated via combat.js)
function slashCore(reach, dmg, dot0, kind) {
  const p = G.player;
  let hitAny = false;
  for (const e of G.enemies) {
    if (e.telegraph > 0) continue;
    const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy);
    // reach + front cone + line-of-sight, all from the pure combat module
    if (!Combat.weaponHits(kind || 'sword', p.x, p.y, e.x, e.y, p.dir.x, p.dir.y, reach, isSolidCell)) continue;
    if (ironBlocked(e, p.x, p.y)) { clink(e); hitAny = true; continue; }
    e.hp -= dmg; e.flash = 0.15; hitAny = true;
    if (e.state === 'windup') { G.floorStats.interrupts++; e.state = 'recover'; e.st = 0.5; msg('INTERRUPTED', 3, 0.7); fw('fan', e.x, e.y, 3); }
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
    if (!Combat.weaponHits('hammer', p.x, p.y, e.x, e.y, p.dir.x, p.dir.y, reach, isSolidCell)) continue; // reach+front+LOS
    e.hp -= dmg; e.flash = 0.2; e.state = 'recover'; e.st = 0.4; // stun
    e.kx = dx / d * 70; e.ky = dy / d * 70;
    burst(e.x, e.y, e.ci, 14, 24, 0.5); hit = true;
    if (e.hp <= 0) killEnemy(e, 'melee');
  }
  G.wfx = { kind: 'hammer', a: Math.atan2(p.dir.y, p.dir.x), t: 0.25, reach };
  G.smashFx = { x: p.x + p.dir.x * reach * 0.6, y: p.y + p.dir.y * reach * 0.6, r: reach, t: 0.25 };
  G.shake = Math.max(G.shake, 3 + charge * 3); G.hitstop = Math.max(G.hitstop, 0.08);
  A.startGlitch(0.5 + charge * 0.4, 0.25, 'pop');
  tone(90, 40, 0.35, 'sawtooth', 0.16); if (charge >= 0.99) fw('geyser', p.x + p.dir.x * 6, p.y, 7); tone(160, 30, 0.3, 'square', 0.1, 0.02);
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
  if (G.run.score > G.best) { G.best = G.run.score; localStorage.setItem(LS_BEST, G.best); fw('chrys', 80, 30, 5); }
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
  G.whisperNew = fresh.length > 0; if (fresh.length) fw('halo', 80, 60, 8);
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
    else if (roll < (0.22 + PARAMS.pacing.grassHeartChance) && !G.floorStats.grassHeart) { G.floorStats.grassHeart = true; G.pickups.push({ x: tf.x, y: tf.y, kind: 'heart', ph: 0 }); }
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
    // base sword: reach + front cone + line-of-sight, all from the tested combat module
    if (!Combat.weaponHits('sword', p.x, p.y, e.x, e.y, p.dir.x, p.dir.y, reach, isSolidCell)) continue;
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
  // SPLITTER halves into two smaller ones (Asteroids) until too small
  if (e.type === 'splitter' && (e.gen || 0) < 2) {
    e.dead = true; G.run.kills++; G.floorStats.kills++;
    for (let s = 0; s < 2; s++) {
      G.enemies.push({ type: 'splitter', arch: 'split', x: e.x, y: e.y, vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 10, telegraph: 0.2, flash: 0, kx: 0, ky: 0, state: 'seek', st: 0, ci: e.ci, r: e.r * 0.7, spd: e.spd * 1.3, hp: 1, hp0: 1, gen: (e.gen || 0) + 1 });
    }
    burst(e.x, e.y, e.ci, 12, 18, 0.4); SFX.kill();
    return;
  }
  e.dead = true;
  G.run.kills++; G.floorStats.kills++;
  if (how === 'ranged') G.floorStats.rangedKills++;
  // dissolve down the density ramp instead of popping
  const spr = SPR[e.type] ? SPR[e.type][0] : null;
  if (spr) G.parts.push({ dissolve: spr, x: e.x - spr[0].length / 2, y: e.y - spr.length / 2, ci: e.ci, flip: e.vx > 0.5, t: 0, life: 0.55 });
  burst(e.x, e.y, e.ci, 16, 22, 0.7);
  burst(e.x, e.y, 0, 6, 14, 0.5);
  killFw(e); // per-class firework send-off (5 classes)
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
  fw('ring2', G.player.x, G.player.y, 3); // room-clear ring
  // the spore-bow grows back a seed each cleared room, so it stays a weapon not a consumable
  const p = G.player;
  if (heldKind() === 'sporebow') p.held.ammo = Math.min(8, (p.held.ammo || 0) + 1);
  A.startGlitch(0.6, 0.25, 'pop');
  const delay = curse('velox') ? FX.CURSE_VELOX : 0;
  G.doorOpenAt = G.t + delay;
  if (delay > 0) msg('VELOX BARS THE DOORS', 3, delay);
  // drops (AURUM watches)
  const mult = curse('aurum') ? FX.CURSE_AURUM : (boon('aurum') ? FX.BOON_AURUM : 1);
  if (G.rng() < PARAMS.pacing.dropChance * mult) {
    spawnPickup(80 + (G.rng() * 20 - 10), 47 + (G.rng() * 10 - 5), ['heart', 'heart', 'sword', 'boots'][(G.rng() * 4) | 0]);
  }
}

// ---------- THE BOSSES: three original nightmares, every 3rd floor ----------
// Ritual: key -> chest -> POTION -> trance -> the fight. Phase logic lives in boss.js
// (pure, certified); each form = unique sprite + 2 of the boss's 3 attacks + orb weakpoints.
const BOSSES = [
  {
    id: 'leviathan', name: 'THE FEATHER-LEVIATHAN', tagline: 'a serpent that remembers the sky', ci: 3,
    mechanic: 'env', // arena flips each form; orbs only vulnerable in the calm between shifts
    forms: [{ orbs: 3, atk: ['storm', 'sweep'] }, { orbs: 4, atk: ['sweep', 'dive'] }, { orbs: 5, atk: ['storm', 'dive'] }],
    sprites: [
      ['   ~~~###~~~   ', ' ~##########~ ', '~#o###########~', ' ~###~~~~####~ ', '   ~~~    ~~~  '],
      ['    ~###~   ', '  ~#####~  ', ' ~#o####~ ', '~########~', ' ~######~ ', '  ~~##~~  ', '   ~##~   '],
      // F3 rewrite (pixel review): a plumed serpent shedding feathers, keeps head+eye (was noise)
      ['~#o####~  ', ' ~#####~  ', ' ~####~ ~ ', '~####~  ~ ', ' ~##~ ~ ~ '],
    ],
  },
  {
    id: 'inquisitor', name: 'THE CLOCKWORK INQUISITOR', tagline: 'it winds. it judges. it strikes.', ci: 5,
    mechanic: 'mirror', // a delayed clone of your inputs carries the orb; hit it when you desync
    forms: [{ orbs: 3, atk: ['spiral', 'pendulum'] }, { orbs: 4, atk: ['pendulum', 'cogs'] }, { orbs: 5, atk: ['spiral', 'cogs'] }],
    sprites: [
      ['  #######  ', ' ##(o)(o)## ', '###########', ' ##|||||## ', '  #######  '],
      [' ##  ###  ## ', '##(o)===(o)##', ' ####|#|#### ', '  ##/   \\##  '],
      // F3 rewrite (pixel review): widen so the two eyes stay legible when crushed
      ['#   ###   #', ' # (o)|(o) # ', '  ##|||##  ', ' #  |||  # ', '#   ###   #'],
    ],
  },
  {
    id: 'king', name: 'THE DROWNED KING', tagline: 'he never stopped being royalty. only breathing.', ci: 6,
    mechanic: 'fast', // relentless enrage rush; punish-window only after you dodge a flurry
    forms: [{ orbs: 3, atk: ['tide', 'grasp'] }, { orbs: 4, atk: ['grasp', 'whirl'] }, { orbs: 5, atk: ['tide', 'whirl'] }],
    sprites: [
      ['  |||||  ', ' ####### ', '#o#####o#', '#########', ' ##   ## '],
      // F2 rewrite (pixel review): visibly SINKING — crown tilts, eye row drops, tide climbs
      [' \\||||/  ', '  ~###~  ', ' #o###o# ', '~#######~', '~~## #~~~'],
      ['~~~|||||~~~', '~#########~', '~#o~###~o#~', '~~#######~~', ' ~~~~#~~~~ '],
    ],
  },
  {
    id: 'abbot', name: 'THE BROOD-ABBOT', tagline: 'the cowl is full of children', ci: 2,
    mechanic: 'summoner', // orbs invuln while any add lives; adds optional (greed line)
    forms: [{ orbs: 3, atk: ['grasp'] }, { orbs: 4, atk: ['grasp', 'sweep'] }, { orbs: 5, atk: ['sweep'] }],
    sprites: [ // peaked hood + bottom-heavy brood + bare `o o` eyes (separates from Inquisitor)
      ['   /\\    ', ' ~/###\\~ ', ' #( o o )#', ' ##ooo## ', '#ooooooo#', ' \\ooooo/ '],
      ['   /\\    ', ' \\###/   ', '#( o o )#', '#ooooooo#', '(oo#ooo#oo)', ' \\ooooo/ '],
      ['  ~###~  ', ' #( x )# ', '  #ooo#  ', ' #ooooo# ', '  ~###~  '],
    ],
  },
  {
    id: 'prism', name: 'THE REFRACTOR', tagline: 'the arena is a lens - bend the light back into it', ci: 4,
    mechanic: 'refractor', // fires beams; only a beam you dash-redirect into its orbs counts
    forms: [{ orbs: 3, atk: ['sweep'] }, { orbs: 4, atk: ['spiral'] }, { orbs: 5, atk: ['spiral', 'sweep'] }],
    sprites: [ // crystalline, mass-preserving (pixel review) so it never deflates to zigzag mush
      ['   /\\   ', '  /##\\  ', ' /#oo#\\ ', ' \\#oo#/ ', '  \\##/  ', '   \\/   '],
      ['  /\\  /\\  ', ' /#\\ /#\\ ', '/o#\\/o#\\', '\\#o/\\#o/', ' \\/  \\/ '],
      [' /\\ /\\ /\\ ', '/#\\/o\\/#\\', '\\o/\\#/\\o/', ' \\/ \\/ \\/ '],
    ],
  },
  {
    id: 'maw', name: 'THE COLLAPSED MAW', tagline: 'a mouth that fell into itself', ci: 7,
    mechanic: 'gravity', // constant pull toward it; orbs on the far arc; pull inverts, telegraphed
    forms: [{ orbs: 3, atk: ['whirl'] }, { orbs: 4, atk: ['whirl', 'tide'] }, { orbs: 5, atk: ['tide'] }],
    sprites: [
      [' (((@))) ', '((#####))', '(#(ooo)#)', '((#####))', ' (((@))) '],
      ['\\((@))/', '(#ooo#)', '((@#@))', '(#ooo#)', '/((@))\\'],
      // F3 rewrite (pixel review): DENSER on implosion (@ mass, inward arms) — was an airy sparkle
      ['  |||  ', '\\(@@@)/', '-@ooo@-', '/(@@@)\\', '  |||  '],
    ],
  },
  {
    id: 'duo', name: 'THE GEMINI WARDENS', tagline: 'two that count; kill the tally, not the tallier', ci: 3,
    mechanic: 'duo', // two bodies, each its own orb set; a form breaks only when BOTH stagger
    forms: [{ orbs: 2, atk: ['sweep'] }, { orbs: 3, atk: ['spiral'] }, { orbs: 3, atk: ['sweep', 'spiral'] }],
    twinSprites: [ // left = angular warden, right = round warden (track which is which)
      ['  /\\  ', ' /o8\\ ', ' \\#8/ ', '  \\/  '],
      [' ,--. ', '( o8 )', '( #8 )', ' `--\' '],
    ],
    sprites: [ // fallback single sprite (renderer prefers twinSprites for the duo)
      [' /\\  ,--. ', '/o8\\( o8 )', '\\#8/( #8 )', ' \\/  `--\' '],
      [' /\\  ,--. ', '/o8\\( o8 )', '\\#8/( #8 )', ' \\/  `--\' '],
      [' /\\  ,--. ', '/o8\\( o8 )', '\\#8/( #8 )', ' \\/  `--\' '],
    ],
  },
];

function bossForDepth() { return BOSSES[(G.rng() * BOSSES.length) | 0]; } // v10: random boss every floor (all 7)
function bossRoomKey() { for (const [k, r] of G.rooms) if (r.type === 'stairs') return k; return '0,0'; }

// THE POOL BREAK: the current frame's lit cells become billiard balls — scattered,
// ricocheting, colliding — then the table clears and the boss is waiting. ~5 seconds.
function startPoolBreak() {
  G.tranceBoss = bossForDepth();
  const img = A.sctx.getImageData(0, 0, COLS, ROWS).data;
  const balls = [];
  for (let y = 0; y < ROWS && balls.length < 240; y += 2) {
    for (let x = 0; x < COLS && balls.length < 240; x += 2) {
      const i = (y * COLS + x) * 4;
      const l = (img[i] * 54 + img[i + 1] * 183 + img[i + 2] * 19) >> 8;
      if (l > 45) balls.push({ x, y, vx: 0, vy: 0, ci: [0, 1, 2, 3, 4, 5, 6, 7, 8][(x + y) % 9] });
    }
  }
  // the cue ball: everything near the chest gets blasted outward (the break)
  for (const b of balls) {
    const dx = b.x - G.player.x, dy = b.y - G.player.y, d = Math.hypot(dx, dy) || 1;
    const pow = 55 / (1 + d * 0.06);
    b.vx = dx / d * pow + (Math.random() - 0.5) * 8;
    b.vy = dy / d * pow * 0.8 + (Math.random() - 0.5) * 6;
  }
  G.poolBalls = balls; G.poolT = 0;
  G.state = 'pool';
  A.startGlitch(1, 0.5, 'shear');
  tone(1200, 100, 0.5, 'square', 0.14); tone(300, 60, 0.8, 'sawtooth', 0.1, 0.1);
}

function drawPool(dt) {
  G.poolT += dt;
  const T = G.poolT, balls = G.poolBalls;
  // phase 1 (0-3.5s): scatter + ricochet + ball-ball shoves; phase 2 (3.5-5s): converge
  for (const b of balls) {
    if (T < 3.5) {
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.vx *= 0.995; b.vy *= 0.995;
      if (b.x < 1 || b.x > COLS - 2) { b.vx *= -0.92; b.x = Math.max(1, Math.min(COLS - 2, b.x)); }
      if (b.y < 1 || b.y > ROWS - 2) { b.vy *= -0.92; b.y = Math.max(1, Math.min(ROWS - 2, b.y)); }
    } else {
      const k = (T - 3.5) / 1.5;
      b.x += ((80 + Math.cos(b.ci) * 20) - b.x) * k * dt * 6;
      b.y += ((42 + Math.sin(b.ci) * 12) - b.y) * k * dt * 6;
    }
    const spd = Math.hypot(b.vx, b.vy);
    px(b.x, b.y, b.ci, 0.4 + Math.min(0.6, spd / 40)); // speed burns brighter
    if (spd > 20) px(b.x - b.vx * 0.02, b.y - b.vy * 0.02, b.ci, 0.25);
  }
  // pairwise elastic shoves (coarse: every 4th pair per frame)
  if (T < 3.5) {
    const off = (G.t * 60 | 0) % 4;
    for (let i = off; i < balls.length; i += 4) for (let j = i + 1; j < Math.min(balls.length, i + 8); j++) {
      const a = balls[i], c = balls[j];
      const dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy);
      if (d > 0 && d < 2) { const push = (2 - d) / d; a.vx -= dx * push * 4; a.vy -= dy * push * 4; c.vx += dx * push * 4; c.vy += dy * push * 4; if (Math.abs(a.vx) + Math.abs(c.vx) > 30 && Math.random() < 0.05) tone(700 + Math.random() * 400, 500, 0.03, 'square', 0.03); }
    }
  }
  if (G.poolT > 2 && ((G.t * 2) | 0) % 2 === 0) A.textC(70, G.tranceBoss.name, G.tranceBoss.ci, Math.min(1, (T - 2)));
  if (T > 5) enterBossArena();
}

function enterBossArena() {
  const stairsRoom = G.rooms.get(bossRoomKey());
  stairsRoom.mut = null; stairsRoom.spawned = true; stairsRoom.cleared = false;
  G.state = 'play';
  enterRoom(stairsRoom, null);
  G.enemies = []; // the arena belongs to the boss
  startBossFight();
}

function startBossFight() {
  const def = G.tranceBoss || bossForDepth();
  G.boss = {
    def, st: Boss.newBossState(def, G.depth),
    x: (X0 + X1) / 2, y: Y0 + (Y1 - Y0) * 0.3, vx: 0, vy: 0,
    atkT: 2, atkI: 0, staggerT: 0, t: 0, hitFlash: 0,
  };
  if (def.mechanic === 'duo') { // two bodies, each its own orb set (split-attention fight)
    G.boss.twins = [
      { st: Boss.newBossState(def, G.depth), x: X0 + (X1 - X0) * 0.32, y: Y0 + (Y1 - Y0) * 0.3, atkT: 1.5, atkI: 0, staggerT: 0, hitFlash: 0, side: 0 },
      { st: Boss.newBossState(def, G.depth), x: X0 + (X1 - X0) * 0.68, y: Y0 + (Y1 - Y0) * 0.3, atkT: 2.3, atkI: 0, staggerT: 0, hitFlash: 0, side: 1 },
    ];
  }
  G.locked = true;
  if (G.cur.mut !== 'WOODS') for (const [bx, by] of G.bars) G.solid[by * COLS + bx] = 1;
  msg(def.name, def.ci, 3);
  msg('destroy the orbs. all of them. three times.', 1, 3);
  A.startGlitch(1, 0.4, 'chroma');
  SFX.judge();
}

function updateBoss(dt) {
  const b = G.boss, p = G.player, def = b.def;
  if (def.mechanic === 'duo') return updateDuo(b, dt);
  b.t += dt; b.hitFlash = Math.max(0, b.hitFlash - dt);
  if (b.st.staggered) { // form break window
    b.staggerT -= dt;
    if (b.staggerT <= 0) {
      b.st = Boss.endStagger(b.st, def);
      if (b.st.defeated) { bossDefeated(); return; }
      msg('IT CHANGES', def.ci, 2); A.startGlitch(1, 0.4, 'pop'); SFX.die();
      b.atkT = 2;
    }
    return;
  }
  // drift toward mid-arena height, sway
  b.vx = Math.sin(b.t * 0.7) * 6; b.vy = Math.cos(b.t * 0.5) * 3;
  b.x += b.vx * dt; b.y += b.vy * dt;
  b.x = Math.max(X0 + 12, Math.min(X1 - 12, b.x)); b.y = Math.max(Y0 + 8, Math.min(Y1 - 20, b.y));
  // per-mechanic side-effects: env arena calm/active, mirror echo+clone, summoned adds,
  // gravity pull on the player, refractor beams. This is WHERE the bosses stop being reskins.
  bossMechTick(b, dt);
  // attacks: alternate the form's two attacks, telegraphed. FAST/enrage tightens only the GAP
  // between attacks each form — never the windup (Boss.telegraph floors it at 250ms in bossAttack).
  b.atkT -= dt;
  if (b.atkT <= 0) {
    const atks = def.forms[b.st.form].atk;
    bossAttack(atks[b.atkI % atks.length], b);
    b.atkI++;
    const enrage = def.mechanic === 'fast' ? (1 - 0.22 * b.st.form) : 1;
    b.atkT = Math.max(0.7, (2.6 - G.depth * 0.08) * enrage);
  }
  // orb hit-testing: slash arc, player bullets, stars, booms, redirected beams. The mechanic
  // GATE (bossOrbOpen) decides whether a landed hit counts — that gate is the real difference.
  const orbs = Boss.orbPositions(b.st.orbs, b.x, b.y, b.t);
  b.orbsOpen = bossOrbOpen(b, 'slash'); // cached for the renderer (open=blue vs caged=grey)
  for (const o of orbs) {
    let hitKind = null;
    if (p.atkT > 0 && Combat.weaponHits(heldKind() && ITEMS[heldKind()].weapon ? heldKind() : 'sword', p.x, p.y, o.x, o.y, p.dir.x, p.dir.y, heldKind() === 'rapier' ? 5 : SLASH_REACH, isSolidCell)) hitKind = 'slash';
    for (const pb of G.pbolts) if (Math.hypot(pb.x - o.x, pb.y - o.y) < 2.2) { hitKind = hitKind || 'bolt'; pb.dead = true; }
    for (const s2 of G.stars) if (Math.hypot(s2.x - o.x, s2.y - o.y) < 2.2) hitKind = hitKind || 'star';
    for (const bm of G.booms) if (!bm.enemyBomb && Math.hypot(bm.x - o.x, bm.y - o.y) < 2.5) hitKind = hitKind || 'boom';
    for (const be of (b.beams || [])) if (be.reflected && Math.hypot(be.x - o.x, be.y - o.y) < 2.6) { hitKind = 'beam'; be.spent = true; }
    if (hitKind && bossOrbOpen(b, hitKind)) {
      b.st = Boss.hitOrb(b.st, def);
      b.hitFlash = 0.15;
      p.atkT = 0; // one swing breaks one orb — no multi-orb chains from a single slash
      burst(o.x, o.y, 6, 16, 20, 0.5);
      tone(900, 200, 0.12, 'square', 0.1); fw('ringlet', o.x, o.y, 6);
      G.shake = Math.max(G.shake, 2);
      if (b.st.staggered) {
        b.staggerT = 1.2;
        msg('THE FORM BREAKS', 5, 1.5); fw('implode', b.x, b.y, def.ci);
        A.startGlitch(1, 0.5, 'shear');
        burst(b.x, b.y, def.ci, 40, 30, 1);
        G.shake = 6; G.hitstop = 0.12;
      }
      break; // one orb per frame
    }
  }
  // contact with the boss body hurts
  if (Math.hypot(p.x - b.x, p.y - b.y) < 8 && p.invulnT <= 0 && p.dashT <= 0) hurtPlayer(b);
}

function bossAttack(kind, b) {
  const p = G.player;
  const dx = p.x - b.x, dy = p.y - b.y, d = Math.hypot(dx, dy) || 1;
  // windup floored at 250ms (Boss.telegraph); FAST/enrage may nudge it, never below the floor
  b.telegraphA = { kind, t: Boss.telegraph(0.45, b.st.form, b.def.mechanic === 'fast') };
  setTimeout(() => { }, 0); // (attacks fire below after the telegraph via aimed spawns)
  if (kind === 'storm' || kind === 'spiral') {
    const n = kind === 'spiral' ? 10 : 8;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + (kind === 'spiral' ? b.t : 0);
      G.bolts.push({ x: b.x, y: b.y, vx: Math.cos(a) * 13, vy: Math.sin(a) * 13, life: 4 });
    }
  } else if (kind === 'sweep' || kind === 'pendulum') {
    for (let i = 0; i < 6; i++) {
      const a = Math.atan2(dy, dx) + (i - 2.5) * 0.22;
      G.bolts.push({ x: b.x, y: b.y, vx: Math.cos(a) * 16, vy: Math.sin(a) * 16, life: 4 });
    }
  } else if (kind === 'dive' || kind === 'grasp') {
    b.vx = dx / d * 30; b.vy = dy / d * 30; // a short charge at you (body contact is the threat)
  } else if (kind === 'cogs') {
    const rng2 = mulberry32((G.t * 1000) | 0);
    spawnOne('splitter', rng2, () => ({ x: b.x + 8, y: b.y }), G.cur);
    G.enemies.forEach(e => { if (e.telegraph > 0.5) e.telegraph = 0.5; });
  } else if (kind === 'tide' || kind === 'whirl') {
    for (let i = 0; i < 9; i++) G.bolts.push({ x: X0 + 4 + i * ((X1 - X0 - 8) / 8), y: Y1 - 2, vx: 0, vy: -11, life: 5 });
  }
  tone(140, 60, 0.3, 'sawtooth', 0.1);
}

// ---- per-boss mechanic RUNTIME (boss.js owns the pure gates; this is the wiring) ----
function bossAddsAlive() { return G.enemies ? G.enemies.filter(e => !e.dead).length : 0; }

// a reachable, non-solid arena cell for a summoned add (anti-softlock: never spawn in a wall)
function reachableSpawn(b) {
  for (let i = 0; i < 24; i++) {
    const x = X0 + 4 + Math.random() * (X1 - X0 - 8), y = Y0 + 6 + Math.random() * (Y1 - Y0 - 12);
    if (!solidAt(x, y)) return { x, y };
  }
  return { x: (X0 + X1) / 2, y: (Y0 + Y1) / 2 };
}

// THE GATE: is this boss's orb breakable by this hit source right now? The one real difference.
function bossOrbOpen(b, hitKind) {
  const m = b.def.mechanic;
  if (m === 'refractor') return hitKind === 'beam';   // only a redirected beam breaks it
  if (hitKind === 'beam') return false;               // beams count only for the refractor
  if (m === 'env') return Boss.envVulnerable(b.t, b.st.form);
  if (m === 'mirror') return b.desynced === true;
  if (m === 'summoner') return Boss.addsGate(bossAddsAlive());
  return true; // fast / gravity / duo: challenge is speed/space, orbs always breakable
}

// per-frame mechanic side-effects — WHERE the bosses stop being reskins
function bossMechTick(b, dt) {
  const def = b.def, p = G.player, m = def.mechanic;
  const spd = 14 * (p.spdMult || 1);
  if (m === 'env') { // arena flips each form; a light force during the ACTIVE window, calm = strike
    const ph = Boss.envPhase(b.t, b.st.form); b.calm = ph.calm;
    if (!ph.calm && p.dashT <= 0) {
      if (b.st.form === 0) p.x += Math.sin(b.t * 0.9) * 8 * dt;   // wind push
      else if (b.st.form === 1) p.y += 6 * dt;                    // heavy gravity
      // form 2 = pitch dark (draw side); the orb self-illuminates so it's never hidden
    }
    return;
  }
  if (m === 'mirror') { // echo your input; a delayed clone replays it; desync exposes the orb
    const iv = { vx: (keys['arrowright'] || keys['d'] ? 1 : 0) - (keys['arrowleft'] || keys['a'] ? 1 : 0),
                 vy: (keys['arrowdown'] || keys['s'] ? 1 : 0) - (keys['arrowup'] || keys['w'] ? 1 : 0), t: b.t };
    b.echo = b.echo || []; b.echo.push(iv); if (b.echo.length > 300) b.echo.shift();
    const delay = Boss.mirrorDelay(b.st.form);
    const past = b.echo.find(e => e.t >= b.t - delay) || b.echo[0];
    b.echoVec = past; b.cloneX = (X0 + X1) - b.x; b.cloneY = b.y;
    b.desynced = Boss.mirrorDesynced(iv.vx, iv.vy, past.vx, past.vy);
    return;
  }
  if (m === 'summoner') { // spawn up to 3 REACHABLE adds when low + off cooldown
    b.sinceSummon = (b.sinceSummon || 99) + dt; b.summonCd = (b.summonCd || 0) - dt;
    if (b.summonCd <= 0 && Boss.canSummon(bossAddsAlive(), b.sinceSummon, 3)) {
      const rng2 = mulberry32((b.t * 997) | 0);
      const k = ['grunt', 'hopper', 'diver'][(b.t * 3 | 0) % 3];
      spawnOne(k, rng2, () => reachableSpawn(b), G.cur);
      b.sinceSummon = 0; b.summonCd = 2.0;
    }
    return;
  }
  if (m === 'refractor') { // fire beams on cadence; a dash near one reflects it back into the orbs
    b.beams = (b.beams || []).filter(be => !be.spent && be.life > 0);
    b.beamCd = (b.beamCd || 0) - dt;
    if (b.beamCd <= 0) {
      const dx = p.x - b.x, dy = p.y - b.y, d = Math.hypot(dx, dy) || 1;
      b.beams.push({ x: b.x, y: b.y, vx: dx / d * 20, vy: dy / d * 20, life: 3, reflected: false });
      b.beamCd = Boss.beamCadence(b.st.form);
    }
    for (const be of b.beams) {
      be.x += be.vx * dt; be.y += be.vy * dt; be.life -= dt;
      if (!be.reflected && p.dashT > 0 && Math.hypot(be.x - p.x, be.y - p.y) < 4.5) {
        const dx = b.x - be.x, dy = b.y - be.y, d = Math.hypot(dx, dy) || 1; // send it home
        be.vx = dx / d * 26; be.vy = dy / d * 26; be.reflected = true; be.life = 3; SFX.dash();
      }
      if (!be.reflected && p.invulnT <= 0 && p.dashT <= 0 && Math.hypot(be.x - p.x, be.y - p.y) < 2.5) { hurtPlayer(b); be.spent = true; }
    }
    return;
  }
  if (m === 'gravity') { // constant pull (<=50% move speed); dash overpowers it (escape valve)
    const pv = Boss.pullVector(p.x, p.y, b.x, b.y, spd, b.st.form, b.t);
    if (p.dashT <= 0) { p.x += pv.vx * dt; p.y += pv.vy * dt; }
    b.inverting = Boss.pullInverting(b.t);
    return;
  }
}

// per-mechanic overlays: the clone, the beams, the calm border, the inversion warning, add-arrows
function bossMechDraw(b) {
  const def = b.def, p = G.player, m = def.mechanic, spr = def.sprites[b.st.form];
  if (m === 'env') {
    if (b.calm) { for (let x = X0; x <= X1; x += 2) { px(x, Y0, 3, 0.6); px(x, Y1, 3, 0.6); } A.text(b.x - 5, b.y - spr.length / 2 - 3, 'STRIKE NOW', 3, 0.75); }
    else if (b.st.form === 2) for (let i = 0; i < 220; i++) px(X0 + Math.random() * (X1 - X0), Y0 + Math.random() * (Y1 - Y0), 1, 0.07); // dark veil (orb still glows)
    return;
  }
  if (m === 'mirror') { // the delayed clone carries the live orb; bright + labelled when desynced
    blit(spr, b.cloneX - spr[0].length / 2, b.cloneY - spr.length / 2, def.ci, b.desynced ? 1.3 : 0.5, true);
    if (b.desynced) A.text(b.cloneX - 3, b.cloneY - spr.length / 2 - 2, 'DESYNC', 3, 0.9);
    return;
  }
  if (m === 'refractor') { for (const be of (b.beams || [])) { const c = be.reflected ? 3 : 4; px(be.x, be.y, c, 1); px(be.x - be.vx * 0.03, be.y - be.vy * 0.03, c, 0.5); } return; }
  if (m === 'gravity' && b.inverting) { for (let a = 0; a < 14; a++) { const an = a / 14 * Math.PI * 2; px(b.x + Math.cos(an) * 18, b.y + Math.sin(an) * 12, 5, 0.5 + 0.5 * Math.sin(G.t * 20)); } return; }
  if (m === 'summoner') { for (const e of (G.enemies || [])) { if (e.dead) continue; if (e.x < X0 || e.x > X1 || e.y < Y0 || e.y > Y1) A.text(Math.max(X0 + 1, Math.min(X1 - 1, e.x)), Math.max(Y0 + 1, Math.min(Y1 - 1, e.y)), '!', 5, 0.9); } return; }
}

// THE GEMINI WARDENS: two bodies, each its own orb set. A form advances only when BOTH are
// staggered together; a lone stagger REVIVES if the partner doesn't join in time (split-attention).
function updateDuo(b, dt) {
  const p = G.player, def = b.def; b.t += dt;
  const orbBonus = st => Math.max(0, Math.floor((st.depth - 3) / 3));
  let allDefeated = true;
  for (let ti = 0; ti < b.twins.length; ti++) {
    const tw = b.twins[ti], partner = b.twins[1 - ti];
    tw.hitFlash = Math.max(0, tw.hitFlash - dt);
    if (tw.st.defeated) continue;
    allDefeated = false;
    if (tw.st.staggered) {
      tw.staggerT -= dt;
      if (Boss.duoBothStaggered(tw.st, partner.st)) { // both down together -> advance both forms
        tw.st = Boss.endStagger(tw.st, def); partner.st = Boss.endStagger(partner.st, def);
        tw.staggerT = 0; partner.staggerT = 0;
        if (!tw.st.defeated) { msg('BOTH FALL - IT CHANGES', def.ci, 1.6); A.startGlitch(1, 0.4, 'pop'); SFX.die(); }
      } else if (tw.staggerT <= 0) {           // partner never joined -> the standing one revives it
        tw.st = { ...tw.st, staggered: false, orbs: def.forms[tw.st.form].orbs + orbBonus(tw.st) };
        msg('THE OTHER REVIVES IT', 5, 1.2);
      }
      continue;
    }
    tw.x += Math.sin(b.t * 0.8 + ti * 3) * 6 * dt; tw.y += Math.cos(b.t * 0.6 + ti) * 3 * dt;
    tw.x = Math.max(X0 + 10, Math.min(X1 - 10, tw.x)); tw.y = Math.max(Y0 + 8, Math.min(Y1 - 20, tw.y));
    tw.atkT -= dt;
    if (tw.atkT <= 0) { const atks = def.forms[tw.st.form].atk; bossAttack(atks[tw.atkI % atks.length], { x: tw.x, y: tw.y, t: b.t, st: tw.st, def }); tw.atkI++; tw.atkT = 1.6 + ti * 0.5; }
    const orbs = Boss.orbPositions(tw.st.orbs, tw.x, tw.y, b.t);
    for (const o of orbs) {
      let hk = null;
      if (p.atkT > 0 && Combat.weaponHits(heldKind() && ITEMS[heldKind()].weapon ? heldKind() : 'sword', p.x, p.y, o.x, o.y, p.dir.x, p.dir.y, heldKind() === 'rapier' ? 5 : SLASH_REACH, isSolidCell)) hk = 'slash';
      for (const pb of G.pbolts) if (Math.hypot(pb.x - o.x, pb.y - o.y) < 2.2) { hk = 'bolt'; pb.dead = true; }
      for (const s2 of G.stars) if (Math.hypot(s2.x - o.x, s2.y - o.y) < 2.2) hk = 'star';
      if (hk) {
        tw.st = Boss.hitOrb(tw.st, def); tw.hitFlash = 0.15; p.atkT = 0;
        burst(o.x, o.y, 6, 16, 20, 0.5); tone(900, 200, 0.12, 'square', 0.1); fw('ringlet', o.x, o.y, 6); G.shake = Math.max(G.shake, 2);
        if (tw.st.staggered) { tw.staggerT = 1.6; msg('ONE STAGGERS - BREAK THE OTHER', 5, 1.4); G.shake = 5; fw('implode', tw.x, tw.y, def.ci); }
        break;
      }
    }
    if (Math.hypot(p.x - tw.x, p.y - tw.y) < 7 && p.invulnT <= 0 && p.dashT <= 0) hurtPlayer(tw);
  }
  if (allDefeated) { b.x = (X0 + X1) / 2; b.y = (Y0 + Y1) / 2; bossDefeated(); }
}

function drawDuo(b) {
  const def = b.def;
  for (let ti = 0; ti < b.twins.length; ti++) {
    const tw = b.twins[ti]; if (tw.st.defeated) continue;
    const spr = (def.twinSprites && def.twinSprites[ti]) || def.sprites[0];
    const ci = ti === 0 ? 3 : 5; // left angular=sky, right round=vermillion (track which is which)
    const bright = tw.st.staggered ? 0.4 + 0.6 * Math.abs(Math.sin(G.t * 20)) : (tw.hitFlash > 0 ? 1.5 : 0.95);
    blit(spr, tw.x - spr[0].length / 2, tw.y - spr.length / 2, ci, bright, ti === 1);
    const orbs = Boss.orbPositions(tw.st.orbs, tw.x, tw.y, b.t);
    for (const o of orbs) { const sz = 0.8 + (o.depth + 1) * 0.5; rect(o.x - sz, o.y - sz * 0.7, sz * 2, sz * 1.4, 6, 0.6 + (o.depth + 1) * 0.2); px(o.x, o.y - sz * 0.7, 0, 0.7 + 0.3 * Math.sin(G.t * 8)); }
    if (tw.st.staggered) A.text(tw.x - 4, tw.y - spr.length / 2 - 2, 'STAGGERED', 5, 0.9);
  }
  // form pips (shared): both twins advance together
  for (let f = 0; f < def.forms.length; f++) A.text((X0 + X1) / 2 - 3 + f * 3, Y0 + 2, f < b.twins[0].st.form ? 'x' : f === b.twins[0].st.form ? 'O' : 'o', f === b.twins[0].st.form ? 5 : 1, 0.9);
}

function bossDefeated() {
  const def = G.boss.def;
  burst(G.boss.x, G.boss.y, def.ci, 80, 35, 1.5);
  G.shake = 8; G.hitstop = 0.2;
  A.startGlitch(1, 0.6, 'chroma');
  G.run.bonus = (G.run.bonus || 0) + 500;
  // the boss drops the floor's jackpot (moved from the chest, which now only summons)
  const jack = ['heart', Math.random() < 0.5 ? 'sword' : 'boots', 'heart'];
  jack.forEach((k, i) => G.pickups.push({ x: 74 + i * 6, y: 52, kind: k, ph: 0 }));
  G.ledger['felled_' + def.id] = 1;
  G.ledger.bossesFelled = (G.ledger.bossesFelled || 0) + 1;
  saveLedger();
  msg(def.name + ' FALLS. +500', 5, 3); fw('nova', 80, 40, def.ci);
  G.boss = null;
  G.cur.cleared = true; G.cur.bossDone = true;
  roomCleared();
  SFX.stairs();
}

// archetype AI for the arcade roster. Sets e.vx/e.vy (shared movement integrates it) and
// fires projectiles. Every lethal move is telegraphed (windup/aim) to keep F2/F13 honest.
function arcadeAI(e, dt, dx, dy, d, p) {
  e.st -= dt;
  const toward = () => { e.vx = dx / d * e.spd; e.vy = dy / d * e.spd; };
  switch (e.arch) {
    case 'chase': toward(); break;
    case 'ghost': // scatter <-> chase toggle (Pac)
      e.ghT = (e.ghT || 0) - dt;
      if (e.ghT <= 0) { e.scatter = !e.scatter; e.ghT = e.scatter ? 2.2 : 4; }
      if (e.scatter) { e.vx = -dx / d * e.spd * 0.7; e.vy = -dy / d * e.spd * 0.7; } else toward();
      break;
    case 'hop': // discrete leaps toward you (Q*bert)
      if (e.state !== 'air' && e.st <= 0) { e.state = 'air'; e.st = 0.3; e.hx = dx / d; e.hy = dy / d; }
      if (e.state === 'air') { e.vx = e.hx * 22; e.vy = e.hy * 22; if (e.st <= 0) { e.state = 'seek'; e.st = 0.5 + Math.random() * 0.4; e.vx = e.vy = 0; } }
      else { e.vx = e.vy = 0; }
      break;
    case 'strafe': // fast horizontal passes (Defender)
      if (!e.sdir) e.sdir = dx > 0 ? 1 : -1;
      e.vx = e.sdir * e.spd; e.vy = dy / d * e.spd * 0.25;
      if (e.x < X0 + 3 || e.x > X1 - 3) e.sdir *= -1;
      break;
    case 'joust': // collide-higher-wins (Joust): dips and rises
      e.vx = dx / d * e.spd; e.vy = dy / d * e.spd + Math.sin(G.t * 4 + e.x) * 4;
      break;
    case 'split': toward(); break; // splits on death (handled in killEnemy)
    case 'dive': // Galaga swoop: hover, telegraph, dive
      if (e.state === 'seek') { e.vx = Math.sin(G.t * 2 + e.x) * e.spd * 0.4; e.vy = -0.5; if (d < 22 && e.st <= 0) { e.state = 'windup'; e.st = 0.35; } }
      else if (e.state === 'windup') { e.vx = e.vy = 0; if (e.st <= 0) { e.state = 'lunge'; e.st = 0.4; e.lx = dx / d; e.ly = dy / d; } }
      else if (e.state === 'lunge') { e.vx = e.lx * e.spd * 2.2; e.vy = e.ly * e.spd * 2.2; if (e.st <= 0) { e.state = 'seek'; e.st = 0.6; } }
      break;
    case 'march': // steps in formation + drops bombs (Space Invaders)
      e.vx = Math.sin(G.t * 1.5) * e.spd; e.vy = e.spd * 0.15;
      arcadeShoot(e, dt, dx, dy, d, 0.02, false);
      break;
    case 'spin': // spirals inward (Tempest)
      { const a = Math.atan2(dy, dx) + 1.2; e.vx = Math.cos(a) * e.spd + dx / d * e.spd * 0.4; e.vy = Math.sin(a) * e.spd + dy / d * e.spd * 0.4; }
      break;
    case 'lob': // arcs bombs onto the arena (Missile Command)
      e.vx = dx / d * e.spd; e.vy = dy / d * e.spd;
      arcadeShoot(e, dt, dx, dy, d, 0, true);
      break;
    case 'wall': // lays a light-trail wall behind it (Tron)
      toward();
      e.wallT = (e.wallT || 0) - dt;
      if (e.wallT <= 0) { e.wallT = 0.25; G.patches.push({ x: e.x, y: e.y, r: 1.6, t: 3, wall: true }); }
      break;
    case 'shoot': arcadeShoot(e, dt, dx, dy, d, 0, false); { const off = d - 20; e.vx = dx / d * e.spd * Math.sign(off); e.vy = dy / d * e.spd * Math.sign(off); } break;
    case 'bounce': // invulnerable herder (Berzerk Otto) — must stay outrunnable (can't be killed)
      if (!e.bvx) { e.bvx = (Math.random() < 0.5 ? 1 : -1) * e.spd; e.bvy = (Math.random() < 0.5 ? 1 : -1) * e.spd; }
      e.vx = e.bvx + dx / d; e.vy = e.bvy + dy / d; // gentle homing nudge only
      if (e.x < X0 + 3 || e.x > X1 - 3) e.bvx *= -1;
      if (e.y < Y0 + 3 || e.y > Y1 - 3) e.bvy *= -1;
      break;
    case 'burn': // stationary flash-telegraph danger zone (Dragon's Lair)
      e.vx = e.vy = 0;
      if (e.state === 'seek' && d < 18 && e.st <= 0) { e.state = 'windup'; e.st = 0.5; }
      else if (e.state === 'windup' && e.st <= 0) { e.state = 'burn'; e.st = 0.4; }
      else if (e.state === 'burn') { if (d < 10 && !p.dashT) hurtPlayer(e); if (e.st <= 0) { e.state = 'seek'; e.st = 1.2; } }
      break;
    case 'burrow': // Leever: hides underground, surfaces near you (telegraphed heave)
      if (e.state === 'seek') { // burrowed: track under the sand, no damage
        e.vx = dx / d * e.spd * 0.7; e.vy = dy / d * e.spd * 0.7; e.buried = true;
        if (d < 16 && e.st <= 0) { e.state = 'windup'; e.st = 0.4; e.vx = e.vy = 0; }
      } else if (e.state === 'windup') { e.buried = true; e.vx = e.vy = 0; if (e.st <= 0) { e.state = 'up'; e.st = 2.5; e.buried = false; } }
      else { e.buried = false; e.vx = dx / d * e.spd; e.vy = dy / d * e.spd; if (e.st <= 0) { e.state = 'seek'; e.st = 0.5; } }
      break;
    case 'peahat': // spins (invulnerable) while moving, LANDS periodically (vulnerable, telegraphed)
      if (e.state !== 'landed') { e.spinInvuln = true; e.vx = Math.cos(G.t * 3 + e.x) * e.spd; e.vy = Math.sin(G.t * 2.4 + e.y) * e.spd; if (e.st <= 0) { e.state = 'landing'; e.st = 0.4; } }
      if (e.state === 'landing') { e.vx *= 0.5; e.vy *= 0.5; if (e.st <= 0) { e.state = 'landed'; e.st = 1.4; e.spinInvuln = false; } }
      else if (e.state === 'landed') { e.vx = e.vy = 0; if (e.st <= 0) { e.state = 'seek'; e.st = 2 + Math.random() * 2; } }
      break;
    case 'slink': slinkAI(e, dt, dx, dy, d); break;
    default: toward();
  }
}

// a stationary/slow shooter fires a telegraphed bolt; `lob` bolts arc and burst on landing
function arcadeShoot(e, dt, dx, dy, d, biasVy, lob) {
  e.cd -= dt;
  e.aimT = e.cd <= TURRET_AIM ? Math.max(0, e.cd) : 0; // real-time telegraph
  if (e.cd <= 0) {
    e.cd = Math.max(1, 2.2 - 0.1 * G.depth);
    if (lob) G.booms.push({ spore: false, lobEnemy: true, x: e.x, y: e.y, vx: dx / d * 10, vy: dy / d * 10 - 6, t: 0, back: false, hitCd: {}, dmg: 1, enemyBomb: true });
    else G.bolts.push({ x: e.x, y: e.y, vx: dx / d * 15, vy: dy / d * 15 + biasVy });
    e.flash = 0.1; tone(500, 300, 0.06, 'square', 0.05);
  }
}

// the prime slinky: a string of segments; it advances, and its SPIN/turn cadence is driven
// by consecutive prime numbers (operator's "random prime generator"). Coils and whips.
function slinkAI(e, dt, dx, dy, d) {
  e.turnT -= dt;
  if (e.turnT <= 0) {
    // next prime sets both the turn magnitude and the time until the next turn
    e.primeI = (e.primeI + 1) % PRIMES.length;
    const pr = PRIMES[e.primeI];
    e.ang += (pr % 4 === 3 ? 1 : -1) * (pr / 10); // prime-driven spin
    e.turnT = 0.15 + (pr % 5) * 0.08;
  }
  // drift toward the player but mostly follow the coil heading
  const head = Math.atan2(dy, dx);
  e.ang += angDiff(head, e.ang) * dt * 0.6;
  e.vx = Math.cos(e.ang) * e.spd; e.vy = Math.sin(e.ang) * e.spd;
  // the tail follows the head, slinky-style
  if (e.seg) {
    e.seg.unshift({ x: e.x, y: e.y });
    e.seg.pop();
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
    if (p.dashT <= 0 && p.dashHadDanger) { G.floorStats.dashThroughs++; msg('SLIPPED', 8, 0.6); fw('ribbon', p.x, p.y, 8); }
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

  // JELLY FORM: rolling physics; weapons disabled; X = bounce-slam
  if (p.jellyCd > 0) p.jellyCd -= dt;
  if (p.jellyT > 0) {
    p.jellyT -= dt;
    if (p.jellyT <= 0) { fw('ringlet', p.x, p.y, 8); msg('...solid again', 1, 1); }
    // momentum rolling: input accelerates, walls bounce (physics as art)
    const iv2 = inputVec();
    p.jvx = (p.jvx || 0) + iv2.x * 60 * dt; p.jvy = (p.jvy || 0) + iv2.y * 50 * dt;
    const jmax = playerStats().spd * 1.3;
    const jm = Math.hypot(p.jvx, p.jvy); if (jm > jmax) { p.jvx *= jmax / jm; p.jvy *= jmax / jm; }
    const pjx = p.x, pjy = p.y;
    tryMove(p, p.x + p.jvx * dt, p.y + p.jvy * dt, 1.3);
    if (p.x === pjx && Math.abs(p.jvx) > 3) { p.jvx *= -0.8; tone(300, 200, 0.05, 'sine', 0.05); }
    if (p.y === pjy && Math.abs(p.jvy) > 3) { p.jvy *= -0.8; tone(300, 200, 0.05, 'sine', 0.05); }
    p.kx = 0; p.ky = 0; // knockback-immune: jelly absorbs
    if ((keys['x'] || keys[' ']) && p.atkCd <= 0) { // BOUNCE-SLAM
      p.atkCd = 0.5; p.slamT = 0.25;
      for (const e of G.enemies) {
        if (e.telegraph > 0) continue;
        const dxs = e.x - p.x, dys = e.y - p.y, ds = Math.hypot(dxs, dys) || 1;
        if (ds < 9 && !losBlocked(p.x, p.y, e.x, e.y)) {
          e.hp -= 2; e.flash = 0.15; e.kx = dxs / ds * 60; e.ky = dys / ds * 60;
          if (e.hp <= 0) killEnemy(e, 'melee');
        }
      }
      fw('ring', p.x, p.y, 8); G.shake = Math.max(G.shake, 3); G.hitstop = 0.06;
      tone(150, 60, 0.2, 'sine', 0.14);
    }
    p.invulnT = Math.max(p.invulnT, 0); p.atkT = 0; // no sword arc while jelly
    // skip normal movement/attack for this frame's remainder markers
  }
  const heldK = heldKind();
  const wpn = ITEMS[heldK] && ITEMS[heldK].weapon;
  // X/SPACE is the ATTACK button. A held weapon OWNS it (its own hit + animation);
  // bare-handed (or holding a non-weapon) you get the base sword. No free sword underneath.
  const atkPressed = (keys['x'] || keys[' ']) && !(p.jellyT > 0);
  if (wpn) { if (heldK !== 'hammer' && heldK !== 'whip') { if (atkPressed) weaponAttack(heldK); } }
  else if (atkPressed) slash();

  // HAMMER: hold X to charge, release to smash (its "attack" is the charge)
  if (heldK === 'hammer') {
    if (atkPressed) { p.chargeT = Math.min(1.2, p.chargeT + dt); p.charging = true; }
    else if (p.charging) { if (p.atkCd <= 0) hammerSmash(Math.min(1, p.chargeT / 1.2)); p.charging = false; p.chargeT = 0; }
    if (p.charging) { vx *= 0.6; vy *= 0.6; if (Math.random() < p.chargeT * 0.3) G.shake = Math.max(G.shake, p.chargeT * 1.5); }
  } else { p.charging = false; p.chargeT = 0; }
  // WHIP: a verlet chain (Castlevania III grammar). Idle it DANGLES; hold X and it
  // whirls overhead building wind; release and it CRACKS across the screen — the TIP's
  // velocity is the weapon (slow chain near your hands can't hurt: the dead zone, physical).
  if (heldK === 'whip') {
    if ((keys['x'] || keys[' ']) || p.whipCrackT > 0) { vx *= 0.55; vy *= 0.55; } // the brandish costs your legs (SME: commitment)
    if (!p.whipChain) { p.whipChain = []; for (let i = 0; i < 14; i++) p.whipChain.push({ x: p.x - i, y: p.y, px: p.x - i, py: p.y, pin: i === 0 }); }
    const wch = p.whipChain;
    wch[0].x = p.x; wch[0].y = p.y; wch[0].px = p.x; wch[0].py = p.y;
    if (atkPressed && !(p.whipCrackT > 0)) { // WIND: whirl overhead, building power
      p.whipWind = Math.min(1, (p.whipWind || 0) + dt * 1.3);
      const wa = G.t * (9 + p.whipWind * 12);
      const tip = wch[wch.length - 1];
      tip.px = tip.x; tip.py = tip.y;
      tip.x += (p.x + Math.cos(wa) * (7 + p.whipWind * 9) - tip.x) * dt * 14;
      tip.y += (p.y + Math.sin(wa) * (5 + p.whipWind * 6) - tip.y) * dt * 14;
      stepChain(wch, dt, 0, 6);
      if (Math.random() < p.whipWind * 0.25) px(p.x + (Math.random() - 0.5) * 16, p.y + (Math.random() - 0.5) * 10, 2, 0.4);
      G.shake = Math.max(G.shake, p.whipWind * 0.6);
    } else if ((p.whipWind || 0) > 0.12) { // RELEASE: the crack
      const pow = 40 + p.whipWind * 70;
      wch.forEach((pt2, i) => { if (pt2.pin) return; const k = i / wch.length; pt2.px = pt2.x - p.dir.x * pow * k / 60; pt2.py = pt2.y - p.dir.y * pow * k * 0.8 / 60; });
      p.whipCrackT = 0.4; p.whipWindAt = p.whipWind; p.whipWind = 0;
      tone(1700, 180, 0.12, 'sawtooth', 0.13); G.shake = Math.max(G.shake, 2.5);
    } else if (!(p.whipCrackT > 0)) { stepChain(wch, dt, 0, 26); } // idle: gravity dangle (jelly)
    if (p.whipCrackT > 0) { // the crack unrolls: tip is a flying hurt-point
      p.whipCrackT -= dt;
      stepChain(wch, dt, p.dir.x * 55, p.dir.y * 42 + 6);
      const tip = wch[wch.length - 1];
      const tipSpd = Math.hypot(tip.x - tip.px, tip.y - tip.py) * 60;
      for (const e of G.enemies) {
        if (e.telegraph > 0) continue;
        if (tipSpd > 14 && Math.hypot(e.x - tip.x, e.y - tip.y) < e.r + 2.2 && !losBlocked(p.x, p.y, tip.x, tip.y)) {
          const dmg2 = WEAPON_STATS.whip.dmg + (p.whipWindAt >= 0.99 ? 1 : 0);
          e.hp -= dmg2; e.flash = 0.15; e.kx = (e.x - p.x) * 3; e.ky = (e.y - p.y) * 3;
          fw('crackle', tip.x, tip.y, 2);
          G.hitstop = 0.06; G.shake = Math.max(G.shake, 3);
          tone(2400, 250, 0.07, 'square', 0.12); // the crack CONNECTS (SME: payoff)
          if (e.hp <= 0) killEnemy(e, 'melee');
          p.whipCrackT = Math.min(p.whipCrackT, 0.08);
        }
      }
      if (p.whipCrackT <= 0 && tipSpd > 25) tone(2200, 400, 0.05, 'square', 0.06); // the snap
    }
  } else p.whipChain = null;
  // FLAIL: a head orbits you, sweeping enemies IN FRONT (you must face the threat)
  if (heldK === 'flail') {
    p.orbitA += dt * 6.5;
    const fx = p.x + Math.cos(p.orbitA) * 7, fy = p.y + Math.sin(p.orbitA) * 5;
    p.flailPos = { x: fx, y: fy };
    const fw = WEAPON_STATS.flail;
    for (const e of G.enemies) {
      if (e.telegraph > 0) continue;
      e.flailCd = Math.max(0, (e.flailCd || 0) - dt);
      // front-arc + line-of-sight from the tested combat module (same predicate as the
      // flourish), THEN the orbiting-head proximity that makes the flail positional
      if (e.flailCd <= 0 && Combat.weaponHits('flail', p.x, p.y, e.x, e.y, p.dir.x, p.dir.y, fw.reach, isSolidCell)
        && Math.hypot(e.x - fx, e.y - fy) < e.r + 1.5) {
        const dx = e.x - p.x, dy = e.y - p.y;
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
    if (b.enemyBomb) { // Missile-Command arc from a lobber: gravity, bursts on land/contact
      b.vy += 22 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.t += dt;
      if (Math.hypot(b.x - p.x, b.y - p.y) < 2.4 && p.invulnT <= 0 && p.dashT <= 0) { hurtPlayer(b); b.dead = true; }
      if (b.t > 0.3 && (solidAt(b.x, b.y) || b.t > 3)) { b.dead = true; burst(b.x, b.y, 7, 12, 16, 0.4); if (Math.hypot(b.x - p.x, b.y - p.y) < 5 && p.invulnT <= 0 && p.dashT <= 0) hurtPlayer(b); }
      continue;
    }
    if (b.spore) {
      b.z += b.vz * dt; b.vz -= 26 * dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.z <= 0 || solidAt(b.x, b.y)) { b.dead = true; G.patches.push({ x: b.x, y: b.y, r: 6, t: 2 }); fw('bloomfw', b.x, b.y, 4); tone(200, 120, 0.15, 'sawtooth', 0.06); burst(b.x, b.y, 4, 16, 12, 0.5); }
      continue;
    }
    b.t += dt;
    if (!b.back && b.t > 0.4) { b.back = true; }
    if (b.back) { const dx = p.x - b.x, dy = p.y - b.y, d = Math.hypot(dx, dy) || 1; b.vx += dx / d * 120 * dt; b.vy += dy / d * 120 * dt; if (d < 3) { b.dead = true; p.thrown = false; fw('orbitfw', p.x, p.y, 5); } }
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
  // patches: spore vines damage enemies; Tron walls damage the PLAYER (a hazard you laid into)
  for (const pc of G.patches) {
    pc.t -= dt;
    if (pc.wall) {
      if (Math.hypot(p.x - pc.x, p.y - pc.y) < pc.r + 1 && p.invulnT <= 0 && p.dashT <= 0) hurtPlayer(pc);
    } else {
      for (const e of G.enemies) {
        if (e.telegraph > 0) continue;
        if (Math.hypot(e.x - pc.x, e.y - pc.y) < pc.r) { e.hp -= 3 * dt; if (e.hp <= 0) killEnemy(e, 'ranged'); }
      }
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
    // arcade-roster archetypes (set velocity / fire, then fall through to shared movement)
    if (e.arch && ENEMIES[e.type]) {
      arcadeAI(e, dt, dx, dy, d, p);
      // single-point invulnerability: Otto (always), Peahat (spinning), Leever (buried).
      // Freeze hp at the value it held when invulnerability began — chip damage from a prior
      // vulnerable window persists, but nothing lands while invulnerable.
      const invNow = e.invuln || e.spinInvuln || e.buried;
      if (invNow) { if (!e.wasInv) e.invHp = e.hp; e.hp = e.invHp; e.wasInv = true; } else e.wasInv = false;
    }
    else if (e.type === 'duck') {
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
    if (!e.buried && contactHit(e, p.x, p.y)) hurtPlayer(e); // a buried Leever can't touch you
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
      msg('THE BAT TOOK YOUR ' + ITEMS[b.carrying.kind].label + '!', 7, 2.2); fw('zigzag', b.x, b.y, 7);
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
          burst(p.x, p.y, 3, 8, 8, 0.4); msg('+1 HP', 3, 0.8); tone(700, 900, 0.1, 'triangle', 0.05); fw('halo', p.x, p.y, 3);
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
        msg('"THANK YOU." (-' + gd.price + ')  AURUM APPROVES', 5, 2); fw('glyphs', gd.x, gd.y, 5);
        SFX.pickup();
      } else if (!G.cur.alarmed) {
        G.cur.alarmed = true;
        msg('THE OLD DUCK SCREAMS: THIEF', 7, 2.2); fw('crackle', p.x, p.y, 7);
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
      msg('A HEART ASSEMBLES. +1 MAX HP', 7, 2.6); fw('heartfw', p.x, p.y - 4, 7);
      SFX.stairs();
    } else {
      msg('HEART PIECE (' + (G.run.pieces % 4) + '/4)', 7, 1.6); fw('strobe', p.x, p.y, 7);
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
        if (!G.cur.bossDone && !G.rooms.get(bossRoomKey()).bossDone) { // v10: EVERY floor's chest is the invitation
          // BOSS FLOOR: the chest IS the invitation — the world breaks like a rack of pool balls
          startPoolBreak();
        } else {
          const jack = ['heart', Math.random() < 0.5 ? 'sword' : 'boots', 'heart'];
          jack.forEach((k, i) => G.pickups.push({ x: ch.x - 4 + i * 4, y: ch.y + 4, kind: k, ph: 0 }));
          msg('THE CHEST OPENS. AURUM HOWLS WITH JOY. +100', 5, 2.6); fw('fountain', ch.x, ch.y, 5);
        }
        burst(ch.x, ch.y, 5, 40, 26, 0.9);
        A.startGlitch(0.8, 0.35, 'pop');
        G.shake = 3;
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
      else if (pk.kind === 'potion') {
        // the trance takes you; the boss is on the other side
        G.state = 'trance'; G.tranceT = 0;
        G.tranceBoss = bossForDepth();
        A.startGlitch(1, 0.6, 'chroma');
        tone(80, 400, 2.0, 'sawtooth', 0.08); tone(120, 500, 2.0, 'sine', 0.06, 0.1);
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

  // the boss owns its arena
  if (G.boss) updateBoss(dt);
  // stairs (on boss floors, only after the boss falls)
  if (G.cur.type === 'stairs' && G.cur.cleared && G.cur.bossDone) { // stairs only after the boss falls
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
  tone(120, 700, 1.0, 'sawtooth', 0.06); fw('meteor', 80, 20, 3);
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

// ---------- v8: PHYSICS-ART KIT (verlet + water) — ascii meets art; motion burns brighter ----------
function verletKit() {
  return {
    feathers: [], petals: [], debris: [], souls: [],
    water: null, cloth: [],
  };
}
// feathers/petals: flutter-fall with drag + lift oscillation
function stepFlutter(list, dt, wind, floorY, pile) {
  for (const f of list) {
    f.ph += dt * (2 + f.sz);
    f.vy = Math.min(f.vy + 9 * dt, 6 + f.sz * 3);          // gravity vs drag terminal
    f.x += (Math.sin(f.ph) * (4 + f.sz * 2) + wind) * dt;   // flutter lift
    f.y += f.vy * dt * (0.6 + 0.4 * Math.abs(Math.cos(f.ph)));
    if (f.y >= (pile ? floorY - (pile[f.x | 0] || 0) : floorY)) {
      if (pile) { pile[f.x | 0] = Math.min(14, (pile[f.x | 0] || 0) + 0.25); }
      f.y = -2 - Math.random() * 10; f.x = Math.random() * COLS; f.vy = 0;
    }
  }
}
// 1-D spring-mesh water (the ukiyo-e wave is a real simulation)
function newWater(n) { return { h: new Float32Array(n).fill(0), v: new Float32Array(n).fill(0), n }; }
function stepWater(w, dt) {
  const { h, v, n } = w;
  for (let i = 0; i < n; i++) {
    const l = h[i > 0 ? i - 1 : i], r = h[i < n - 1 ? i + 1 : i];
    v[i] += ((l + r) / 2 - h[i]) * 18 * dt - v[i] * 0.6 * dt;
  }
  for (let i = 0; i < n; i++) h[i] += v[i] * dt * 8;
}
function splash(w, at, power) { const i = Math.max(1, Math.min(w.n - 2, at | 0)); w.v[i] += power; }
// verlet chain (souls in MORS's line; swinging vines)
function stepChain(pts, dt, gx, gy) {
  for (const p2 of pts) {
    if (p2.pin) continue;
    const nx = p2.x + (p2.x - p2.px) * 0.96 + gx * dt * dt, ny = p2.y + (p2.y - p2.py) * 0.96 + gy * dt * dt;
    p2.px = p2.x; p2.py = p2.y; p2.x = nx; p2.y = ny;
  }
  for (let pass = 0; pass < 2; pass++) for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, diff = (d - 2.2) / d / 2;
    if (!a.pin) { a.x += dx * diff; a.y += dy * diff; }
    if (!b.pin) { b.x -= dx * diff; b.y -= dy * diff; }
  }
}

// ---------- v8: THE CUTSCENES — gods in conversation, Japanese cinema grammar ----------
// Beat kinds: {bg}, {actor,side}, {exit}, {say,text}, {fx,[text]}. Any key advances a 'say';
// fx/entrances auto-advance. All 12 available from the start.
const CAST = {
  velox: { name: 'VELOX', ci: 3 }, pluma: { name: 'PLUMA', ci: 2 }, umbra: { name: 'UMBRA', ci: 8 },
  aurum: { name: 'AURUM', ci: 5 }, mors: { name: 'MORS', ci: 1 },
  sixth: { name: 'THE SIXTH', ci: 7, glitchy: true }, soul: { name: 'A SOUL', ci: 6 },
  square: { name: 'THE SQUARE', ci: 0 }, door: { name: 'THE DOOR', ci: 1 },
};
// extra portraits for the non-god cast
PORTRAIT.sixth = ['  #####  ', ' ####### ', '## ## ##', ' ####### ', '  #####  ', '   ###   ', '  #   #  '];
PORTRAIT.soul = ['  ___  ', ' / o \\ ', '<  __/ ', ' \\___\\ ', '  ~ ~  '];
PORTRAIT.square = ['       ', ' ##### ', ' ##### ', ' ##### ', '       '];
PORTRAIT.door = [' _____ ', '|     |', '|     |', '|    o|', '|     |', '|_____|'];

const CUTSCENES = [
  {
    title: 'THE FIRST GROWTH', beats: [
      { bg: 'vine' }, { actor: 'velox', side: 'L' }, { actor: 'mors', side: 'R' },
      { say: 'velox', text: "It's slow." },
      { say: 'mors', text: "Everything is, at first. Then it's mine." },
      { fx: 'ma' },
      { say: 'velox', text: 'I could make it grow faster.' },
      { say: 'mors', text: 'You could make it arrive faster. Not the same thing.' },
      { fx: 'petals' },
      { say: 'velox', text: '...it bloomed. Did you see that? It BLOOMED.' },
    ]
  },
  {
    title: 'THE DROWNING', beats: [
      { bg: 'feathers' }, { fx: 'quake' }, { actor: 'pluma', side: 'L' }, { actor: 'aurum', side: 'R' },
      { say: 'pluma', text: 'The kingdom is drowning in my children\'s down.' },
      { say: 'aurum', text: 'Yes. Tragic. What would you say a feather GOES for, retail?' },
      { say: 'pluma', text: 'People are DROWNING, Aurum.' },
      { say: 'aurum', text: 'In inventory. I weep. I also count.' },
      { fx: 'slashcut' },
      { say: 'pluma', text: 'When this is over, there will be five of us. Fewer, if you keep talking.' },
    ]
  },
  {
    title: 'THE FIVE REMAIN', beats: [
      { bg: 'banners' }, { fx: 'stamp', text: 'COUNCIL' },
      { actor: 'mors', side: 'R' }, { actor: 'velox', side: 'L' },
      { say: 'mors', text: 'The kingdom is gone. We cannot rule feathers.' },
      { say: 'velox', text: 'Then we grade what walks through them. Fast, ideally.' },
      { say: 'pluma', text: 'My children will test them.' },
      { say: 'umbra', text: 'I will watch. From here. Do not come closer.' },
      { say: 'aurum', text: 'And I will handle the... incentives.' },
      { fx: 'quake' },
      { say: 'mors', text: 'Then it is agreed. We judge. Forever. All in favor say nothing.' },
      { fx: 'ma' },
    ]
  },
  {
    title: 'THE SQUARE DESCENDS', beats: [
      { bg: 'tunnel' }, { actor: 'umbra', side: 'L' }, { actor: 'mors', side: 'R' },
      { say: 'umbra', text: 'Something is falling. It has corners.' },
      { say: 'mors', text: 'Everyone does, eventually.' },
      { actor: 'square', side: 'C' }, { fx: 'speedlines' },
      { say: 'umbra', text: 'It is not screaming. Why is it not screaming?' },
      { say: 'mors', text: 'It will learn. They always learn.' },
      { say: 'square', text: '...' },
      { say: 'mors', text: 'See? A natural.' },
    ]
  },
  {
    title: 'DUCK INTO DRAGON', beats: [
      { bg: 'plasma' }, { actor: 'pluma', side: 'L' }, { fx: 'petals' },
      { say: 'pluma', text: 'Children. You were ducks. The kingdom laughed.' },
      { fx: 'quake' }, { fx: 'stamp', text: 'MOLT' },
      { say: 'pluma', text: 'Grow teeth. Keep the waddle. Let them wonder.' },
      { actor: 'velox', side: 'R' },
      { say: 'velox', text: 'They still quack, Pluma.' },
      { say: 'pluma', text: 'Yes. Now it is a WAR quack.' },
    ]
  },
  {
    title: "VELOX'S DOOR", beats: [
      { bg: 'void' }, { actor: 'velox', side: 'L' }, { actor: 'door', side: 'R' },
      { say: 'velox', text: 'I ran the whole way. I was first. Open.' },
      { fx: 'ma' },
      { say: 'velox', text: 'I said OPEN. I have somewhere to be. Everywhere, actually.' },
      { fx: 'ma' },
      { say: 'velox', text: '...please.' },
      { actor: 'mors', side: 'C' },
      { say: 'mors', text: 'Velox. You can stop knocking now.' },
      { say: 'velox', text: 'I know. I know that. One more, though.' },
    ]
  },
  {
    title: "PLUMA'S BROOD", beats: [
      { bg: 'plasma' }, { actor: 'pluma', side: 'L' }, { actor: 'velox', side: 'R' },
      { say: 'pluma', text: 'Eight eggs. Eight perfect futures.' },
      { say: 'velox', text: 'They are taking forever to hatch.' },
      { say: 'pluma', text: 'They are taking EXACTLY as long as they need.' },
      { fx: 'quake' }, { fx: 'petals' },
      { say: 'velox', text: '...that one bit me.' },
      { say: 'pluma', text: 'She is my favorite now.' },
    ]
  },
  {
    title: 'UMBRA UNTOUCHED', beats: [
      { bg: 'void' }, { actor: 'umbra', side: 'L' }, { fx: 'petals' },
      { say: 'umbra', text: 'Nothing has ever touched me. Not rain. Not light. Not luck.' },
      { actor: 'aurum', side: 'R' },
      { say: 'aurum', text: 'Have you considered gloves? I sell gloves. Barely used.' },
      { say: 'umbra', text: 'Used by WHOM?' },
      { say: 'aurum', text: 'That information costs extra.' },
      { fx: 'slashcut' },
      { say: 'umbra', text: 'Get. Out. Of. My. Radius.' },
    ]
  },
  {
    title: "AURUM'S SALE", beats: [
      { bg: 'void' }, { fx: 'stamp', text: 'SOLD' }, { actor: 'aurum', side: 'L' }, { actor: 'sixth', side: 'R' },
      { say: 'aurum', text: 'Nothing personal. The margin on gods is extraordinary.' },
      { say: 'sixth', text: 'WHERE WILL I GO' },
      { say: 'aurum', text: 'Somewhere deep. Every 3rd floor, I believe. Great foot traffic.' },
      { say: 'sixth', text: 'THEY WILL FIND ME. YOU KNOW THEY WILL FIND ME.' },
      { fx: 'quake' },
      { say: 'aurum', text: 'That is between you and the customers. Pleasure doing business.' },
      { fx: 'ma' },
    ]
  },
  {
    title: 'MORS WAITS', beats: [
      { bg: 'line' }, { actor: 'mors', side: 'R' }, { actor: 'soul', side: 'L' },
      { say: 'soul', text: 'Excuse me. How long is the wait? I was mid-quack.' },
      { say: 'mors', text: 'The line moves. That is all anyone is owed.' },
      { say: 'soul', text: 'The duck in front of me has been here nine hundred years.' },
      { say: 'mors', text: 'He keeps letting people go ahead. I admire it. I do not recommend it.' },
      { fx: 'ma' },
      { say: 'soul', text: '...can I go ahead of him?' },
      { say: 'mors', text: 'I like you.' },
    ]
  },
  {
    title: 'THE CHALICE', beats: [
      { bg: 'wave' }, { actor: 'velox', side: 'L' }, { actor: 'mors', side: 'R' },
      { say: 'velox', text: 'Everyone thinks I drank it. Because I am fast. FAST IS NOT THIRSTY.' },
      { say: 'mors', text: 'Velox.' },
      { say: 'velox', text: 'Ten thousand years of "ask Velox why he runs." I run because I am EXCELLENT.' },
      { say: 'mors', text: 'Velox. I drank it.' },
      { fx: 'slashcut' }, { fx: 'ma' },
      { say: 'velox', text: '...you WHAT.' },
      { say: 'mors', text: 'I was told it was full of endings. I collect those. It was grape juice.' },
    ]
  },
  {
    title: 'THE RETURN', beats: [
      { bg: 'tunnel' }, { actor: 'mors', side: 'R' }, { actor: 'square', side: 'L' },
      { say: 'mors', text: 'Back again.' },
      { say: 'square', text: '...' },
      { say: 'mors', text: 'Floor three this time. The Leviathan sends its regards. And its feathers.' },
      { say: 'square', text: '...' },
      { actor: 'velox', side: 'C' },
      { say: 'velox', text: 'It keeps coming back. Why does it keep coming back?' },
      { say: 'mors', text: "That's the best thing about it." },
      { fx: 'petals' }, { fx: 'stamp', text: 'AGAIN' },
    ]
  },
];

function playCine(i, ret) {
  G.cineI = i; G.cineT = 0; G.cineRet = ret || 'gallery';
  G.state = 'cinema';
  G.cineBeat = -1; G.beatT = 0;
  G.stage = { bg: 'void', actors: [], phys: verletKit(), pile: {}, saySpeaker: null, sayText: '', sayT: 0, fxUntil: 0, fxKind: null, shear: 0 };
  G.cineSeen = G.cineSeen || loadCine(); G.cineSeen.add(i); saveCine();
  advanceBeat();
}

function beatAuto(b) { // non-say beats auto-advance after their duration
  if (!b) return 0;
  if (b.say) return 0;
  if (b.fx === 'ma') return 0.9;
  if (b.fx === 'slashcut') return 0.8;
  if (b.fx === 'stamp') return 1.0;
  if (b.fx === 'quake') return 0.45;
  if (b.fx === 'speedlines' || b.fx === 'petals') return 0.3;
  if (b.actor || b.exit) return 0.45;
  return 0.15; // bg
}

function advanceBeat() {
  const sc = CUTSCENES[G.cineI];
  G.cineBeat++;
  G.beatT = 0;
  const b = sc.beats[G.cineBeat];
  if (!b) return; // scene over; any key exits
  const st = G.stage;
  if (b.bg) {
    st.bg = b.bg;
    if (b.bg === 'feathers') { st.phys.feathers = []; for (let i = 0; i < 130; i++) st.phys.feathers.push({ x: Math.random() * COLS, y: Math.random() * ROWS, vy: Math.random() * 3, ph: Math.random() * 6, sz: Math.random() }); st.pile = {}; }
    if (b.bg === 'wave') { st.phys.water = newWater(COLS); for (let i = 0; i < 4; i++) splash(st.phys.water, 20 + i * 35, 14); }
    if (b.bg === 'line') { st.phys.souls = []; for (let i = 0; i < 16; i++) st.phys.souls.push({ x: 10 + i * 8, y: 62, px: 10 + i * 8, py: 62, pin: i === 0 }); }
    if (b.bg === 'banners') { st.phys.cloth = []; for (let bn = 0; bn < 5; bn++) { const c = []; for (let r = 0; r < 7; r++) c.push({ x: 24 + bn * 26, y: 8 + r * 2.2, px: 24 + bn * 26, py: 8 + r * 2.2, pin: r === 0 }); st.phys.cloth.push({ pts: c, ci: [3, 2, 8, 5, 1][bn] }); } }
  }
  if (b.actor) { st.actors = st.actors.filter(a => a.id !== b.actor); st.actors.push({ id: b.actor, side: b.side || 'L', t: 0 }); if (st.actors.length > 3) st.actors.shift(); }
  if (b.exit) st.actors = st.actors.filter(a => a.id !== b.exit);
  if (b.say) { st.saySpeaker = b.say; st.sayText = b.text; st.sayT = 0; }
  if (b.fx) {
    st.fxKind = b.fx; st.fxUntil = G.t + beatAuto(b);
    if (b.fx === 'quake') { G.shake = 5; A.startGlitch(0.7, 0.3, 'pop'); for (const w of (st.phys.water ? [st.phys.water] : [])) splash(w, Math.random() * COLS, 25); tone(70, 40, 0.4, 'sawtooth', 0.14); }
    if (b.fx === 'slashcut') { A.startGlitch(1, 0.5, 'shear'); tone(1800, 200, 0.3, 'sawtooth', 0.1); G.shake = 4; }
    if (b.fx === 'stamp') { st.stampText = b.text || CUTSCENES[G.cineI].title.split(' ')[0]; G.shake = 4; A.startGlitch(0.6, 0.25, 'chroma'); tone(120, 60, 0.4, 'square', 0.14); }
    if (b.fx === 'petals') st.petalsOn = !st.petalsOn ? true : true;
    if (b.fx === 'petals' && !st.phys.petals.length) for (let i = 0; i < 50; i++) st.phys.petals.push({ x: Math.random() * COLS, y: Math.random() * ROWS, vy: Math.random(), ph: Math.random() * 6, sz: Math.random() * 0.5 });
  }
}

// big dramatic portrait: 11x7 art rendered as 2x scene pixels through the filter
function drawBigPortrait(id, cx, cy, ci, al, t) {
  const port = PORTRAIT[id];
  if (!port) return;
  const breathe = Math.sin(G.t * 1.6 + cx) * 0.6;
  const gl = CAST[id] && CAST[id].glitchy;
  port.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      if (ch === ' ') continue;
      const b = ch === 'o' ? 1 : ch === '#' ? 0.85 : 0.6;
      const jx = gl ? (Math.random() - 0.5) * 1.2 : 0;
      rect(cx + (c - row.length / 2) * 2 + jx, cy + (r - port.length / 2) * 2 + breathe, 2, 2, ch === 'o' ? 0 : ci, b * al);
    }
  });
}

function drawCinema(dt) {
  // self-heal: if we somehow entered 'cinema' without playCine() initializing the stage,
  // initialize it now instead of crashing every frame (the fresh-machine black-screen guard).
  if (!G.stage) { playCine(G.cineI || 0, G.cineRet || 'gallery'); return; }
  const sc = CUTSCENES[G.cineI];
  const st = G.stage;
  G.cineT += dt; G.beatT += dt;
  const b = sc.beats[G.cineBeat];
  // auto-advance non-dialogue beats
  // AUTO-ADVANCE so every scene plays hands-free as a 15-30s cinematic (a keypress still
  // fast-forwards via onKey). Non-say beats hold for their fx duration; say beats hold until
  // the line finishes typing PLUS a reading dwell scaled to its length.
  if (b) {
    if (!b.say) { if (G.beatT > beatAuto(b)) advanceBeat(); }
    else {
      const cps = (CAST[b.say] && CAST[b.say].glitchy) ? 18 : 34; // chars/sec typewriter rate
      const typeT = b.text.length / cps;
      const dwell = 1.1 + b.text.length * 0.038;                  // time to READ after it lands
      if (G.beatT > typeT + dwell) advanceBeat();
    }
  }

  // ---- background layers ----
  if (st.bg === 'vine') cineVineDraw(G.cineT, false);
  else if (st.bg === 'plasma') plasma(G.t * 0.06, 0.1, [6, 8, 2, 1]);
  else if (st.bg === 'tunnel') { for (let i = 0; i < 90; i++) { const a = i * 0.7, d = ((i * 5 + G.cineT * 30) % 95); px(80 + Math.cos(a) * d, 42 + Math.sin(a) * d * 0.55, [3, 6, 8][i % 3], Math.min(0.8, d / 35)); } }
  else if (st.bg === 'feathers') {
    stepFlutter(st.phys.feathers, dt, Math.sin(G.t * 0.4) * 3, 86, st.pile);
    for (const f of st.phys.feathers) { const v = Math.abs(f.vy) / 6; px(f.x, f.y, 0, 0.25 + v * 0.5); px(f.x + Math.sin(f.ph), f.y, 0, 0.15 + v * 0.3); }
    for (let x = 0; x < COLS; x++) if (st.pile[x]) rect(x, 86 - st.pile[x], 1, st.pile[x], 0, 0.3); // the drift piles up
  }
  else if (st.bg === 'wave') {
    stepWater(st.phys.water, dt);
    if (Math.random() < 0.03) splash(st.phys.water, Math.random() * COLS, 10);
    const base = 62;
    for (let x = 0; x < COLS; x++) {
      const h = st.phys.water.h[x];
      const top = base - 8 - h;
      for (let y = top; y < ROWS - 2; y += 1.5) px(x, y, 6, 0.2 + Math.max(0, (h + 8) / 30));
      const spd = Math.abs(st.phys.water.v[x]);
      if (spd > 3) px(x, top - 1, 0, Math.min(1, spd / 10)); // foam burns brighter with velocity
    }
  }
  else if (st.bg === 'line') {
    // the queue of the dead: a verlet chain shuffling forward
    const souls = st.phys.souls;
    souls[0].x = 12 + Math.sin(G.t * 0.5) * 2;
    stepChain(souls, dt, 0, 2);
    souls.forEach((s2, i) => { px(s2.x, s2.y, 6, 0.5 - i * 0.02); px(s2.x, s2.y - 1, 6, 0.35 - i * 0.02); if (i % 3 === 0) px(s2.x + 1, s2.y, 6, 0.2); });
  }
  else if (st.bg === 'banners') {
    plasma(G.t * 0.04, 0.05, [1]);
    for (const cl of st.phys.cloth) {
      stepChain(cl.pts, dt, Math.sin(G.t * 0.8 + cl.pts[0].x) * 6, 4);
      cl.pts.forEach((p2, i) => { rect(p2.x - 1.5, p2.y, 3, 1.6, cl.ci, 0.5 - i * 0.03); });
    }
  }

  // ---- persistent petal layer (sakura / feather-down) ----
  if (st.petalsOn) {
    stepFlutter(st.phys.petals, dt, Math.sin(G.t * 0.3) * 5, ROWS - 2, null);
    for (const f of st.phys.petals) px(f.x, f.y, 8, 0.3 + Math.abs(f.vy) * 0.06);
  }

  // ---- actors ----
  for (const a of st.actors) {
    a.t += dt;
    const slide = Math.min(1, a.t * 3);
    const tx = a.side === 'L' ? 30 : a.side === 'R' ? COLS - 30 : 80;
    const fromX = a.side === 'L' ? -20 : a.side === 'R' ? COLS + 20 : 80;
    const x = fromX + (tx - fromX) * (1 - Math.pow(1 - slide, 3)); // ease-out entrance
    drawBigPortrait(a.id, x, 34, CAST[a.id].ci, Math.min(1, a.t * 2.5), a.t);
    // speaking actor glows
    if (st.saySpeaker === a.id && b && b.say) px(x, 20, 5, 0.6 + 0.4 * Math.sin(G.t * 6));
  }

  // ---- fx layers ----
  if (st.fxKind === 'speedlines' && G.t < st.fxUntil + 0.4) {
    for (let i = 0; i < 24; i++) { const y = (i * 37) % ROWS; const len = 20 + (i * 13) % 30; const x0 = ((G.t * 300 + i * 53) % (COLS + len)) - len; for (let k = 0; k < len; k += 2) px(x0 + k, y, 0, 0.2 + k / len * 0.4); }
  }
  if (st.fxKind === 'slashcut' && G.t < st.fxUntil) {
    const k = 1 - (st.fxUntil - G.t) / 0.8;
    for (let i = 0; i < COLS * k; i++) px(i, ROWS - (i / COLS) * ROWS, 0, 1); // the diagonal
  }
  if (st.fxKind === 'stamp' && G.t < st.fxUntil + 0.6 && st.stampText) {
    // kabuki name-card: vertical letters slam in on the right
    const letters = st.stampText.split('');
    letters.forEach((ch, i) => {
      bigText(COLS - 12, 10 + i * 13, ch, 2, 7, Math.min(1, (G.t - (st.fxUntil - 1.0)) * 4 - i * 0.15));
    });
    rect(COLS - 19, 6, 14, letters.length * 13 + 4, 7, 0.08);
  }

  // ---- dialogue box (JRPG grammar) ----
  if (b && b.say) {
    st.sayT += dt;
    const who = CAST[b.say];
    // box: dark panel with a bordered frame
    S.globalAlpha = 0.82; S.fillStyle = '#000'; S.fillRect(14, 72, COLS - 28, 15);
    for (let x = 14; x < COLS - 14; x++) { px(x, 72, who.ci, 0.5); px(x, 86, who.ci, 0.5); }
    for (let y = 72; y <= 86; y++) { px(14, y, who.ci, 0.5); px(COLS - 15, y, who.ci, 0.5); }
    A.text(18, 74, '[ ' + who.name + ' ]', who.ci, 1);
    // typewriter body, wrapped at 118 chars over 2 lines
    const full = b.text;
    const n = Math.min(full.length, Math.floor(st.sayT * (CAST[b.say].glitchy ? 18 : 34)));
    const shown = full.slice(0, n);
    const l1 = shown.slice(0, 118), l2 = shown.slice(118);
    A.text(20, 78, CAST[b.say].glitchy && Math.random() < 0.2 ? l1.split('').map(c => Math.random() < 0.1 ? '#' : c).join('') : l1, 0, 0.95);
    if (l2) A.text(20, 80, l2, 0, 0.95);
    if (n >= full.length && ((G.t * 2) | 0) % 2 === 0) A.text(COLS - 20, 84, 'v', 5, 1); // advance cursor
  }

  A.textC(2, sc.title, 0, 0.7);
  // beat-progress pips (filled up to the current beat) so the cinematic shows its own length
  let dots = ''; for (let i = 0; i < sc.beats.length; i++) dots += i <= G.cineBeat ? '#' : '.';
  A.textC(4, dots, 5, 0.5);
  if (!b) { if (((G.t * 1.5) | 0) % 2 === 0) A.textC(86, '- press to return -', 5); }
  else A.textC(88, 'SPACE skip forward   ESC skip scene', 1, 0.3);
}

function drawGallery(dt) {
  plasma(G.t * 0.05, 0.08, [6, 8, 1]);
  G.cineSeen = G.cineSeen || loadCine();
  A.textC(6, 'THE CUTSCENE LIBRARY', 0);
  A.textC(8, 'arrows move  ENTER plays  ESC back  (number keys jump)', 1, 0.7);
  const gi = G.galI || 0;
  CUTSCENES.forEach((c, i) => {
    const col = i % 2, row = (i / 2) | 0;
    const x = 20 + col * 62, y = 14 + row * 5;
    const seen = G.cineSeen.has(i);
    const on = i === gi;
    const label = (on ? '> ' : '  ') + (i + 1).toString().padStart(2, ' ') + '. ' + c.title + (seen ? '  *' : '') + (on ? ' <' : '');
    A.text(x, y, label, on ? 5 : (i % 5) + 2, on ? 1 : (seen ? 1 : 0.75));
  });
  A.textC(80, '* witnessed — the first plays automatically when a new soul begins', 4, 0.5);
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

// the BESTIARY: coin-op attract-mode "MEET YOUR ENEMIES" roll
function drawBestiary(dt) {
  G.bestT = (G.bestT || 0) + dt;
  plasma(G.t * 0.05, 0.07, [7, 2, 1]);
  A.textC(4, 'M E E T   Y O U R   E N E M I E S', 5);
  const roster = [
    ['duck', 'DUCK-DRAGON', 'the brood'], ['bat', 'BAT', 'erratic'], ['turret', 'TURRET-SNAKE', 'it aims'],
    ...Object.entries(ENEMIES).map(([k, d]) => [k, k.toUpperCase(), d.homage]),
  ];
  const scroll = G.bestT * 6;
  roster.forEach((row, i) => {
    const y = 12 + i * 8 - (scroll % (roster.length * 8));
    const yy = ((y - 12) % (roster.length * 8) + roster.length * 8) % (roster.length * 8) + 12;
    if (yy > ROWS - 8) return;
    const [key, name, homage] = row;
    const frames = SPR[key];
    if (frames && key !== 'slinky') {
      const spr = Array.isArray(frames[0]) ? frames[((G.t * 4) | 0) % frames.length] : frames;
      blit(spr, 34 - spr[0].length / 2, yy, (ENEMIES[key] || { ci: 2 }).ci, 0.9, false);
    } else if (key === 'slinky') {
      for (let s = 0; s < 6; s++) px(30 + s * 1.5 + Math.sin(G.t * 3 + s) * 1.5, yy + 2, 5, 1 - s * 0.12);
    }
    A.text(46, yy + 1, name, (ENEMIES[key] || { ci: 2 }).ci, 1);
    A.text(46, yy + 3, homage, 1, 0.55);
  });
  // the three bosses, silhouetted until felled
  A.text(96, 12, 'THE NIGHTMARES (every 3rd floor)', 8, 0.8);
  BOSSES.forEach((bd, i) => {
    const met = G.ledger['felled_' + bd.id];
    const y = 16 + i * 16;
    if (met) { blit(bd.sprites[0], 100, y, bd.ci, 0.9, false); A.text(100, y + 7, bd.name, bd.ci, 1); }
    else {
      for (let j = 0; j < 24; j++) px(100 + (j * 7) % 14, y + (j * 3) % 5, 1, Math.random() * 0.4);
      A.text(100, y + 7, '? ? ?  (unfelled)', 1, 0.5);
    }
  });
  if (((G.t * 1.5) | 0) % 2 === 0) A.textC(87, '- any key: back -', 5);
}

// ---------- key routing ----------
function onKey(k) {
  if (k === 'm') { muted = !muted; return; }
  // gameplay-only keys must not leak into menus (C used to shadow the title's Credits shortcut
  // and fire useItem() on every screen). Gate C/use-item to the play state.
  if (k === 'c' && G.state === 'play') {
    const now2 = performance.now();
    if (G.lastC && now2 - G.lastC < 280) { G.lastC = 0; tryJelly(); return; }
    G.lastC = now2;
    useItem(); return;
  }
  const mod = ['shift', 'meta', 'control', 'alt'].includes(k);
  if (G.state === 'cinema') {
    if (mod) return;
    const sc = CUTSCENES[G.cineI], b = sc.beats[G.cineBeat];
    const leave = () => {
      if (G.cineRet === 'intro-chain') { G.state = 'intro'; G.introT = 0; }
      else { G.state = G.cineRet || 'gallery'; if (G.state === 'gallery') G.galT = 0; }
    };
    if (k === 'escape') { leave(); return; }
    if (!b) { if (G.beatT > 0.2) leave(); return; } // scene over
    if (b.say) {
      const need = b.text.length / (CAST[b.say].glitchy ? 18 : 34);
      if (G.stage.sayT < need) G.stage.sayT = need + 1; // first press: finish the line
      else advanceBeat();                              // second: next beat
    }
    // fx/ma beats ignore input (the dramatic pause holds)
    return;
  }
  if (G.state === 'gallery') {
    const N = CUTSCENES.length; G.galI = G.galI || 0;
    // number hotkeys still jump straight to a scene (guarded to the real count)
    if (k >= '1' && k <= '9') { if (+k - 1 < N) playCine(+k - 1, 'gallery'); return; }
    if (k === '0') { if (9 < N) playCine(9, 'gallery'); return; }
    if (k === '-') { if (10 < N) playCine(10, 'gallery'); return; }
    if (k === '=') { if (11 < N) playCine(11, 'gallery'); return; }
    // arrow cursor over the 2-column grid: L/R = ±1, U/D = ±2 (down a row)
    if (k === 'arrowleft' || k === 'a') { G.galI = (G.galI + N - 1) % N; return; }
    if (k === 'arrowright' || k === 'd') { G.galI = (G.galI + 1) % N; return; }
    if (k === 'arrowup' || k === 'w') { G.galI = (G.galI + N - 2) % N; return; }
    if (k === 'arrowdown' || k === 's') { G.galI = (G.galI + 2) % N; return; }
    if (k === 'enter' || k === ' ' || k === 'x') { playCine(G.galI, 'gallery'); return; }
    if (k === 'escape') { G.state = 'title'; G.titleT = 0; return; } // ESC backs out — arrows no longer exit
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
    const MENU = ['start', 'library', 'bestiary', 'credits', 'rules', 'memories'];
    if (k === 'arrowdown' || k === 's') { G.menuI = ((G.menuI || 0) + 1) % MENU.length; return; }
    if (k === 'arrowup' || k === 'w') { G.menuI = ((G.menuI || 0) + MENU.length - 1) % MENU.length; return; }
    if (k === 'arrowleft' || k === 'arrowright') return; // vertical menu — sideways is a no-op, never a launch
    // shortcuts still work
    if (k === 'l') { G.state = 'lore'; G.loreT = 0; return; }
    if (k === 'h') { G.state = 'howto'; G.howT = 0; GROW_NODES.forEach(n => n.bloomed = false); return; }
    if (k === 'v') { G.state = 'gallery'; G.galT = 0; return; }
    if (k === 'c') { G.state = 'credits'; G.credT = 0; return; }
    if (k === 'enter' || k === ' ' || k === 'x') {
      const sel = MENU[G.menuI || 0];
      if (sel === 'start') newRun();
      else if (sel === 'library') { G.state = 'gallery'; G.galT = 0; }
      else if (sel === 'bestiary') { G.state = 'bestiary'; G.bestT = 0; }
      else if (sel === 'credits') { G.state = 'credits'; G.credT = 0; }
      else if (sel === 'rules') { G.state = 'howto'; G.howT = 0; GROW_NODES.forEach(n => n.bloomed = false); }
      else if (sel === 'memories') { G.state = 'lore'; G.loreT = 0; }
      return;
    }
    // NO catch-all launch: an unmapped key on the title must do nothing (arrows/stray letters
    // used to fall through here and immediately start a run). Only ENTER/SPACE/X on DESCEND starts.
    return;
  }
  if (G.state === 'credits') { if (!mod && G.credT > 0.4) { G.state = 'title'; G.titleT = 0; } return; }
  if (G.state === 'trance') { if (!mod && G.tranceT > 1) enterBossArena(); return; }
  if (G.state === 'bestiary') { if (k === 'escape' || k === 'enter' || k === ' ' || k === 'x') { G.state = 'title'; G.titleT = 0; } return; }
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
    if (e.state === 'burn') bright = 1.4 + Math.sin(G.t * 40) * 0.4; // Dragon's Lair flash
    if (e.flash > 0) bright = 1.6;
    if (e.invuln) bright *= 0.6 + 0.4 * Math.sin(G.t * 8); // Otto shimmers (can't be killed)
    // a buried Leever is just a moving mound; it heaves up (telegraph) before surfacing
    if (e.buried) {
      const heaving = e.state === 'windup';
      for (let i = 0; i < (heaving ? 8 : 4); i++) px(e.x + Math.random() * 5 - 2.5, e.y + Math.random() * 3 - 1.5, e.ci, (heaving ? 0.6 : 0.25) * bright);
      continue;
    }
    // a spinning Peahat is invulnerable — draw it whirling and bright; landed it dims + settles
    if (e.type === 'peahat' && e.spinInvuln) {
      for (let i = 0; i < 6; i++) { const a = G.t * 12 + i * 1.05; px(e.x + Math.cos(a) * 2.5, e.y + Math.sin(a) * 2, e.ci, 0.9); }
      px(e.x, e.y, 0, 1); continue;
    }
    // the prime slinky draws as a chain of segments, not a single sprite
    if (e.type === 'slinky' && e.seg) {
      e.seg.forEach((s, i) => { const t = i / e.seg.length; px(s.x, s.y, e.ci, (1 - t * 0.6) * bright); if (i % 2) px(s.x + 1, s.y, e.ci, (1 - t) * bright * 0.6); });
      px(e.x, e.y, 0, bright); // the head
      continue;
    }
    const frames = SPR[e.type] || SPR.grunt;
    const spr = frames[((G.t * 6) | 0) % frames.length];
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
  // THE BOSS: form sprite, floating blue orb weakpoints, stagger flash, attack telegraph
  if (G.boss && G.boss.def.mechanic === 'duo') { drawDuo(G.boss); }
  else if (G.boss) {
    const b = G.boss, def = b.def;
    const spr = def.sprites[b.st.form];
    const stag = b.st.staggered;
    const bBright = stag ? 0.4 + 0.6 * Math.abs(Math.sin(G.t * 20)) : (b.hitFlash > 0 ? 1.5 : 0.95);
    blit(spr, b.x - spr[0].length / 2, b.y - spr.length / 2, def.ci, bBright, false);
    if (b.telegraphA && b.telegraphA.t > 0) { b.telegraphA.t -= 1 / 60; rect(b.x - 2, b.y - 2, 4, 4, 5, 0.5 + 0.5 * Math.sin(G.t * 30)); }
    // orb weakpoints ride the fake-3D ring grammar. OPEN = blue + pulsing (a hit counts),
    // CAGED = grey + dim (the mechanic gate is shut). The player must always SEE which.
    const orbs = Boss.orbPositions(b.st.orbs, b.x, b.y, b.t);
    const open = b.orbsOpen !== false;
    for (const o of orbs) {
      const sz = 0.8 + (o.depth + 1) * 0.5;
      rect(o.x - sz, o.y - sz * 0.7, sz * 2, sz * 1.4, open ? 6 : 7, open ? 0.6 + (o.depth + 1) * 0.2 : 0.3);
      px(o.x, o.y - sz * 0.7, open ? 0 : 1, open ? 0.8 : 0.35);
      if (open) px(o.x, o.y - sz * 0.7, 0, 0.4 + 0.4 * Math.sin(G.t * 8)); // live pulse
    }
    bossMechDraw(b);
    // form pips
    for (let f = 0; f < def.forms.length; f++) A.text(b.x - 3 + f * 3, b.y - spr.length / 2 - 3, f < b.st.form ? 'x' : f === b.st.form ? 'O' : 'o', f === b.st.form ? 5 : 1, 0.9);
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
  // patches: spore brambles (green) and Tron light-walls (blue, solid-looking)
  for (const pc of G.patches) {
    if (pc.wall) { rect(pc.x - pc.r, pc.y - 1, pc.r * 2, 2, 6, Math.min(1, pc.t) * 0.7); px(pc.x, pc.y, 0, 0.5); continue; }
    const a = Math.min(1, pc.t) * Math.min(1, (2 - pc.t) * 2);
    for (let i = 0; i < 22; i++) {
      const ang = i / 22 * Math.PI * 2 + G.t * 0.8, rr = pc.r * (0.4 + 0.5 * ((i * 7) % 10) / 10);
      px(pc.x + Math.cos(ang) * rr, pc.y + Math.sin(ang) * rr * 0.7, 4, 0.5 * a * (0.5 + 0.5 * Math.sin(G.t * 4 + i)));
    }
  }
  // the whip chain, always visible while held: dangling, whirling, or cracking
  if (p.whipChain) {
    p.whipChain.forEach((pt2, i) => {
      const spd2 = Math.hypot(pt2.x - pt2.px, pt2.y - pt2.py) * 60;
      const bri = 0.35 + Math.min(0.65, spd2 / 45) + (i === p.whipChain.length - 1 ? 0.2 : 0);
      px(pt2.x, pt2.y, i === p.whipChain.length - 1 ? 0 : 2, bri);
      if (i > 0) { const pa = p.whipChain[i - 1]; px((pa.x + pt2.x) / 2, (pa.y + pt2.y) / 2, 2, bri * 0.7); } // link bridges (SME: legibility at speed)
      if (spd2 > 30) px(pt2.x - (pt2.x - pt2.px), pt2.y - (pt2.y - pt2.py), 2, bri * 0.4);
    });
    if (p.whipWind > 0.99) px(p.x, p.y - 5, 5, 0.7 + 0.3 * Math.sin(G.t * 20)); // full wind spark
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
    if (p.jellyT > 0) { // the jelly bean: wobbling, rolling, luminous
      const roll = G.t * 8;
      const sq = 1 + Math.sin(G.t * 10) * 0.25; // squash and stretch
      for (let a = 0; a < Math.PI * 2; a += 0.5) {
        px(p.x + Math.cos(a + roll) * 2.2 * sq, p.y + Math.sin(a + roll) * 1.6 / sq, 8, 0.9);
      }
      rect(p.x - 1, p.y - 1, 2.5, 2, 8, 1); px(p.x, p.y - 1, 0, 0.8);
      if (p.slamT > 0) { p.slamT -= 1 / 60; for (let a = 0; a < Math.PI * 2; a += 0.3) px(p.x + Math.cos(a) * (9 * (1 - p.slamT * 4)), p.y + Math.sin(a) * (7 * (1 - p.slamT * 4)), 8, p.slamT * 3); }
      A.text(p.x - 2, p.y - 5, (p.jellyT).toFixed(0) + 's', 8, 0.6);
    } else {
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
    } // end non-jelly player draw
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
    if (pt.g) pt.vy += pt.g / 60;                       // gravity (willow droop, fountains)
    if (pt.wob) pt.vx += Math.sin(pt.ph += 0.25) * pt.wob / 60; // wobble (helix, ribbon)
    pt.x += pt.vx / 60; pt.y += pt.vy / 60;
    pt.vx *= 0.965; pt.vy *= 0.965;
    const al = 1 - pt.t / pt.life;
    const spd2 = Math.hypot(pt.vx, pt.vy);
    if (pt.glyph) A.text(pt.x, pt.y, pt.glyph, pt.ci, al);
    else px(pt.x, pt.y, pt.ci, al * (0.5 + Math.min(0.5, spd2 / 30))); // speed burns brighter
    if (pt.tr) px(pt.x - pt.vx * 0.03, pt.y - pt.vy * 0.03, pt.ci, al * 0.35);
    if (pt.t + 1 / 60 >= pt.life && pt.sec) fw(pt.sec, pt.x, pt.y, pt.ci); // crossette split
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
  ['bestiary', 'BESTIARY - MEET YOUR ENEMIES'], ['credits', 'CREDITS'], ['rules', 'HOW A PLANT HEARS THE RULES'], ['memories', 'MEMORIES (' + nLore + '/' + P.LORE.length + ')']];
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
    const dtxt = (c.delta >= 0 ? '+' : '') + c.delta + ' FAVOR'; if (c.letter === 'S') fw('peony', x0 + pw / 2, py + 14, 5);
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
  else if (G.state === 'bestiary') drawBestiary(dt);
  else if (G.state === 'intro') drawIntro(dt);
  else if (G.state === 'howto') drawHowto(dt);
  else if (G.state === 'lore') drawLore(dt);
  else if (G.state === 'title') drawTitle();
  else if (G.state === 'judgment') drawJudgment(dt);
  else if (G.state === 'dead') { drawDead(dt); drawHud(); }
  else if (G.state === 'pool') { drawPool(dt); }
  else if (G.state === 'trance') {
    // the potion: wavy parallax psychedelia; the boss name resolves out of static
    G.tranceT += dt;
    const T = G.tranceT;
    for (let layer = 0; layer < 3; layer++) { // parallax glyph drift
      const spd = 8 + layer * 14, al = 0.15 + layer * 0.12;
      for (let i = 0; i < 40; i++) {
        const gx2 = ((i * 47 + T * spd) % COLS + COLS) % COLS;
        const gy2 = (i * 23 + layer * 31) % ROWS;
        const wob = Math.sin(gy2 * 0.2 + T * (2 + layer)) * (3 + layer * 2); // the wave
        px(gx2 + wob, gy2, [8, 6, 2, 4, 3][(i + layer) % 5], al * (0.6 + 0.4 * Math.sin(T * 3 + i)));
      }
    }
    // sine-warped rings breathing out from center
    for (let r2 = 4; r2 < 60; r2 += 6) {
      const rr = r2 + Math.sin(T * 2 + r2 * 0.3) * 3;
      for (let a = 0; a < Math.PI * 2; a += 0.15) {
        px(80 + Math.cos(a) * rr + Math.sin(T + a * 3) * 2, 45 + Math.sin(a) * rr * 0.6, [8, 2, 5][((r2 / 6) | 0) % 3], 0.12 + 0.1 * Math.sin(T * 4 + r2));
      }
    }
    if (Math.random() < 0.1) A.startGlitch(0.4 + Math.random() * 0.5, 0.15);
    if (T > 1.2) { // the name resolves out of static
      const nm = G.tranceBoss.name;
      if (Math.random() < 0.8) A.textC(42, nm, G.tranceBoss.ci, Math.min(1, (T - 1.2)));
      A.textC(46, G.tranceBoss.tagline, 1, Math.min(0.8, (T - 1.6) * 0.8));
    }
    if (T > 1 && ((G.t * 1.5) | 0) % 2 === 0) A.textC(80, 'any key: face it', 5, 0.6);
    if (T > 4.5) enterBossArena();
  }
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
// boot: a brand-new soul opens on the vine cutscene, then the story crawl. playCine
// initializes G.stage — without it drawCinema throws every frame (fresh-machine black screen).
if (!localStorage.getItem(LS_SEEN)) playCine(0, 'intro-chain');
requestAnimationFrame(frame);
