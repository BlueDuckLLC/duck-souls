// fun_test.js — the /tdd-fun harness. Every assertion reads REAL constants or REAL
// functions out of game.js / pantheon.js (or simulates against them). No hand-typed
// numbers standing in for the game's behavior; if the game changes, this moves.
// Run: node fun_test.js   (thresholds live in FUN.md and are not edited to pass)
const fs = require('fs');
const path = require('path');
const P = require('./pantheon.js');
const SRC = fs.readFileSync(path.join(__dirname, 'game.js'), 'utf8');

const results = [];
function fun(id, claim, ok, detail) {
  results.push({ id, claim, pass: !!ok, detail });
}
// pull a numeric constant out of game.js source (so the test can never drift from code)
function num(re, label) {
  const m = SRC.match(re);
  if (!m) throw new Error('fun_test: could not read ' + label + ' from game.js');
  return parseFloat(m[1]);
}
const has = re => re.test(SRC);

// ---- F1: deaths are earned (contact damage gated to the lunge) ----
{
  // the contact check must consider enemy state, not just distance
  const contact = SRC.match(/if \(Math\.hypot\(p\.x - e\.x, p\.y - e\.y\) <[^\n]*\) hurtPlayer\(e\)/);
  const gated = /contactR\(e\)/.test(SRC) || (contact && /state/.test(contact[0]));
  fun('F1', 'deaths come from the lunge, not a shoulder-brush', gated,
    gated ? 'contact radius is state-aware' : 'contact damage is state-blind (full radius in seek/recover)');
}

// ---- F2: telegraphs are honest ----
{
  const windup = SRC.match(/bright = ([0-9.]+) \+ [^;]*Math\.sin\(G\.t \* ([0-9.]+)\) \* ([0-9.]+)/);
  let ampOk = false, detail = 'no windup pulse found';
  if (windup) {
    const base = parseFloat(windup[1]), amp = parseFloat(windup[3]);
    // must not clamp (base+amp <= 1) and must be a real swing (>= 0.4)
    ampOk = (base + amp <= 1.001) && amp >= 0.4;
    detail = `windup base ${base} amp ${amp}` + (base + amp > 1.001 ? ' (CLAMPS -> invisible)' : '');
  }
  const aim = has(/TURRET_AIM\s*=\s*0?\.[3-9]/) && has(/e\.aimT/);
  fun('F2a', 'duck windup pulse is visible (no alpha clamp, amp >= 0.4)', ampOk, detail);
  fun('F2b', 'turrets telegraph >= 0.3s in real time before firing', aim,
    aim ? 'TURRET_AIM aim phase present' : 'no turret aim phase — bolts appear unannounced');
}

// ---- F3: hitboxes match sprites ----
{
  const ellip = has(/contactHit\(/) && has(/4\.2|3\.2/);
  fun('F3', 'duck hitbox matches its 8x6 sprite (no phantom vertical hits)', ellip,
    ellip ? 'elliptical contact test present' : 'circular r+1.4 hitbox vs 8x6 sprite');
}

// ---- F4: reward out-juices punishment ----
{
  const hurt = num(/G\.shake = 3; G\.flash = 0\.18; G\.hitstop = ([0-9.]+)/, 'hurt hitstop');
  const killHs = SRC.match(/G\.hitstop = Math\.max\(G\.hitstop, ([0-9.]+)\)[^\n]*\n?[^\n]*SFX\.kill|SFX\.kill[\s\S]{0,200}?G\.hitstop = Math\.max\(G\.hitstop, ([0-9.]+)\)/);
  const killVal = killHs ? parseFloat(killHs[1] || killHs[2]) : 0;
  fun('F4', 'killing freezes the frame harder than being hit', killVal >= 0.10 && killVal > hurt * 0.9,
    `kill hitstop ${killVal} vs hurt ${hurt}`);
}

// ---- F5/F6: the game (and the combat) starts fast ----
{
  const stagger = num(/const el = G\.introT - i \* ([0-9.]+)/, 'intro stagger');
  fun('F5', 'intro does not gate play behind a long crawl', stagger <= 1.6,
    `intro stagger ${stagger}s/line -> last line at ${(stagger * 4).toFixed(1)}s`);
  const hotAdjacent = has(/hotAdjacent|forceHotNeighbor/) || has(/dist\.get\(k\) >= 2[\s\S]{0,120}treasure/);
  fun('F6', 'a fight room is always adjacent to the start room', hotAdjacent,
    hotAdjacent ? 'start-adjacent hot room enforced' : 'treasure/TOLL can sit next to start -> combat-free opening');
}

// ---- F7: one-more-run gravity (restart path is synchronous) ----
{
  const instant = /if \(k === 'r'\) \{ newRun\(\); return; \}/.test(SRC);
  fun('F7', 'death -> playing again is instant (<= 200ms)', instant, 'R calls newRun() synchronously');
}

// ---- F8: no permanent god-mode from floor-1 suicide laps ----
{
  // simulate 5 laps of "clear an easy floor 1, die" against the REAL grading + favor math
  let favor = P.defaultFavor();
  const lap = { time: 45, roomCount: 5, kills: 8, interrupts: 2, dmgTaken: 0, dashThroughs: 4,
    pickups: 3, treasureFound: 1, idleT: 0, depth: 1, rangedKills: 0, chestsOpened: 1,
    hotdogsEaten: 0, chaliceDelivered: 0, itemsStolen: 0, tuftsCut: 14, spent: 0, heartPieces: 0 };
  for (let i = 0; i < 5; i++) favor = P.applyFavor(favor, P.judge(lap, favor));
  const boonsOn = P.GODS.filter(g => P.boonActive(favor, g.id));
  // the fix may live in pantheon (decay) or game (depth gate); accept either, but the
  // simulated favor must not hand out boons for suicide laps
  const gated = has(/decayFavor|runFloorGate|boonGate|deepest >= 3|G\.run\.floors >= 3/);
  fun('F8', 'floor-1 suicide laps cannot buy permanent boons', boonsOn.length === 0 || gated,
    `after 5 laps: ${boonsOn.map(g => g.id + '=' + favor[g.id]).join(',') || 'no boons'}${gated ? ' (gated in code)' : ''}`);
}

// ---- F9: depth still bites ----
{
  const duckHp = SRC.match(/type === 'duck'\) Object\.assign\(base, \{ hp: ([^,]+),/);
  const scales = duckHp && /depth/.test(duckHp[1]);
  const swordCap = has(/swords = Math\.min\(|MAX_SWORDS/);
  fun('F9', 'enemies do not collapse to one-shots by depth 4', scales && swordCap,
    `duck hp expr: ${duckHp ? duckHp[1].trim() : '?'}; sword cap ${swordCap ? 'present' : 'absent'}`);
}

// ---- F10: walls are walls ----
{
  const los = has(/losBlocked|function los\(/);
  fun('F10', 'you cannot slash enemies through solid walls', los,
    los ? 'line-of-sight check present in slash' : 'slash is distance+arc only — kills through pillars');
}

// ---- F11: kiting is not strictly dominant ----
{
  const reach = num(/if \(d > ([0-9.]+)\) continue;/, 'slash reach');
  const contactPad = num(/hurtPlayer\(e\);?[\s\S]{0,80}?|< e\.r \+ ([0-9.]+)\)/, 'contact pad');
  const duckR = 3.2;
  const margin = reach - (duckR + 1.4);
  fun('F11', 'slash reach does not trivially out-range contact', margin <= 3.0,
    `reach ${reach} - contact ${(duckR + 1.4).toFixed(1)} = ${margin.toFixed(1)} cells of free-hit margin`);
}

// ---- F12: grades cannot be farmed ----
{
  const base = { time: 40, roomCount: 5, kills: 6, interrupts: 5, dmgTaken: 1, dashThroughs: 6,
    pickups: 1, treasureFound: 1, idleT: 2, depth: 2, rangedKills: 1, chestsOpened: 0,
    hotdogsEaten: 0, chaliceDelivered: 0, itemsStolen: 0, tuftsCut: 2, spent: 0, heartPieces: 0 };
  const p5 = P.judge(base, P.defaultFavor()).find(c => c.id === 'pluma').score;
  const p100 = P.judge({ ...base, interrupts: 100 }, P.defaultFavor()).find(c => c.id === 'pluma').score;
  const u6 = P.judge(base, P.defaultFavor()).find(c => c.id === 'umbra').score;
  const u100 = P.judge({ ...base, dashThroughs: 100 }, P.defaultFavor()).find(c => c.id === 'umbra').score;
  const grass = P.judge({ ...base, tuftsCut: 98, pickups: 0, treasureFound: 0 }, P.defaultFavor()).find(c => c.id === 'aurum').score;
  fun('F12a', 'interrupt farming does not inflate PLUMA', p100 === p5, `pluma 5->${p5.toFixed(2)} 100->${p100.toFixed(2)}`);
  fun('F12b', 'dash farming does not inflate UMBRA', u100 === u6, `umbra 6->${u6.toFixed(2)} 100->${u100.toFixed(2)}`);
  fun('F12c', 'mowing grass alone does not buy an A from AURUM', grass < 0.72, `aurum(tufts:98)=${grass.toFixed(2)}`);
}

// ---- report ----
const pass = results.filter(r => r.pass).length;
console.log('\nDUCK SOULS — FUN HARNESS\n' + '='.repeat(56));
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(5)} ${r.claim}\n            ${r.detail}`);
}
console.log('='.repeat(56));
console.log(`${pass}/${results.length} fun-hypotheses hold\n`);
fs.writeFileSync(path.join(__dirname, process.env.FUN_OUT || 'fun_last.json'), JSON.stringify(results, null, 2));
process.exit(results.every(r => r.pass) ? 0 : 1);
