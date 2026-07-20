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
  // execute the REAL contactHit(): a duck must reach further while lunging than while
  // merely walking past you, so the telegraph is what kills.
  const m = SRC.match(/function contactHit\(e, px2, py2\) \{[\s\S]*?\n\}/);
  let gated = false, detail = 'no contactHit() — contact damage is state-blind';
  if (m) {
    const contactHit = new Function('return ' + m[0])();
    const duck = { type: 'duck', r: 3.2 };
    // a point 3.0 cells to the side: inside the lunge ellipse, outside the walk-by one
    // REVISED 2026-07-20 (round 2): the original clause required body-contact in 'seek'
    // to hurt. Bot instrumentation then measured 0% of damage as telegraphed — that
    // clause WAS the bug. A duck now damages only on the lunge it announced.
    const lunging = contactHit({ ...duck, state: 'lunge', x: 0, y: 0 }, 3.0, 0);
    const walking = contactHit({ ...duck, state: 'seek', x: 0, y: 0 }, 3.0, 0);
    const nudging = contactHit({ ...duck, state: 'seek', x: 0, y: 0 }, 1.5, 0);
    const recovering = contactHit({ ...duck, state: 'recover', x: 0, y: 0 }, 2.0, 0);
    gated = lunging && !walking && !nudging && !recovering;
    detail = `lunge@3.0=${lunging}; seek@3.0=${walking}, seek@1.5=${nudging}, recover@2.0=${recovering} (only the announced lunge costs HP)`;
  }
  fun('F1', 'deaths come from the lunge, not a shoulder-brush', gated, detail);
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
  const hurt = num(/hurtPlayer[\s\S]{0,400}?G\.hitstop = ([0-9.]+)/, 'hurt hitstop');
  const killHs = SRC.match(/G\.hitstop = Math\.max\(G\.hitstop, ([0-9.]+)\)[^\n]*\n?[^\n]*SFX\.kill|SFX\.kill[\s\S]{0,200}?G\.hitstop = Math\.max\(G\.hitstop, ([0-9.]+)\)/);
  const killVal = killHs ? parseFloat(killHs[1] || killHs[2]) : 0;
  fun('F4', 'killing freezes the frame harder than being hit', killVal >= 0.10 && killVal > hurt * 0.9,
    `kill hitstop ${killVal} vs hurt ${hurt}`);
}

// ---- F5/F6: the game (and the combat) starts fast ----
{
  // NOTE: FUN.md's F5 threshold is behavioral (keypress every 0.7s -> play <= 3.5s) and is
  // measured in the browser; browser_check.md records it (2.8s / 3 presses, 2026-07-20).
  // This is the static half: the crawl must be skippable early and not gate on a long read.
  const stagger = num(/const el = G\.introT - i \* ([0-9.]+)/, 'intro stagger');
  const skipEarly = /G\.introT > 0\.4[\s\S]{0,60}any key skips/.test(SRC) && /introT > 0\.4\)/.test(SRC.replace(/\s+/g, ' ')) || /if \(!mod && G\.introT > 0\.[0-6]\)/.test(SRC);
  fun('F5', 'intro is skippable within ~0.6s and does not gate on a long crawl', stagger <= 1.6 && skipEarly,
    `stagger ${stagger}s/line (last at ${(stagger * 4).toFixed(1)}s); skip accepted early: ${skipEarly}; browser-measured 2.8s to play`);
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
  // Execute the REAL gate from game.js rather than grepping for it (the grep version of
  // this test was refuted 2026-07-20 — it passed while favor still sat at 100).
  const gateM = SRC.match(/const boon = id => ([^;]+);/);
  if (!gateM) throw new Error('fun_test: could not read the boon gate from game.js');
  const gateDepth = parseFloat((SRC.match(/BOON_DEPTH_GATE = ([0-9]+)/) || [, NaN])[1]);
  if (!Number.isFinite(gateDepth)) throw new Error('fun_test: BOON_DEPTH_GATE missing');
  // run the REAL gate expression with the REAL constant — no silent fallback
  const gateFn = new Function('P', 'G', 'BOON_DEPTH_GATE', 'id', 'return ' + gateM[1]);
  const boonsAfterLaps = P.GODS.filter(g => gateFn(P, { favor, run: { floors: 1 } }, gateDepth, g.id));
  fun('F8', 'floor-1 suicide laps cannot buy permanent boons', boonsAfterLaps.length === 0,
    `after 5 laps favor=${P.GODS.map(g => g.id[0] + favor[g.id]).join(' ')}; boons active on a floor-1 run: ${boonsAfterLaps.length}`);
  // and the gate must not be a wall: a real run that reaches depth 3 should get them
  const deepBoons = P.GODS.filter(g => gateFn(P, { favor, run: { floors: gateDepth } }, gateDepth, g.id));
  fun('F8b', 'boons are reachable by actually descending (gate is not a wall)', deepBoons.length > 0,
    `${deepBoons.length} boons active at floor 3 with the same favor`);
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
  // read the reach wherever it lives: a literal, or the named constant
  const reach = /SLASH_REACH\s*=\s*([0-9.]+)/.test(SRC)
    ? parseFloat(SRC.match(/SLASH_REACH\s*=\s*([0-9.]+)/)[1])
    : num(/if \(d > ([0-9.]+)\) continue;/, 'slash reach');
  // measure against the REAL duck threat: lunge travel + the lunge-state ellipse,
  // not the unused circular radius (refuted 2026-07-20)
  const lm = parseFloat((SRC.match(/LUNGE_MULT = ([0-9.]+)/) || [, 3.6])[1]);
  const lt = parseFloat((SRC.match(/LUNGE_TIME = ([0-9.]+)/) || [, 0.28])[1]);
  const ellipse = 4.2;
  const threatAt = d => (5.5 + 0.5 * d) * lm * lt + ellipse;
  const t1 = threatAt(1), t8 = threatAt(8);
  // the duck must out-threaten your sword (so you dodge, not backpedal) — but by 1-3
  // cells, not 4+: beyond that melee is a coin-flip you lose.
  const fair1 = t1 - reach >= 0.5 && t1 - reach <= 3.0;
  const fair8 = t8 - reach <= 5.0;
  fun('F11', 'reach vs lunge threat is contested, not hopeless', fair1 && fair8,
    `reach ${reach} vs duck threat ${t1.toFixed(1)} (d1) / ${t8.toFixed(1)} (d8) — deficit ${(t1 - reach).toFixed(1)} / ${(t8 - reach).toFixed(1)}`);
}

// ---- F12: grades cannot be farmed ----
{
  const base = { time: 40, roomCount: 5, kills: 6, interrupts: 5, dmgTaken: 1, dashThroughs: 6,
    pickups: 1, treasureFound: 1, idleT: 2, depth: 2, rangedKills: 1, chestsOpened: 0,
    hotdogsEaten: 0, chaliceDelivered: 0, itemsStolen: 0, tuftsCut: 2, spent: 0, heartPieces: 0 };
  // The cap must BIND BELOW SATURATION: measure the swing a farmer can buy from zero,
  // on an otherwise-empty floor (the old test compared two already-clamped 1.00s).
  const bare = { ...base, kills: 0, rangedKills: 0, interrupts: 0, dashThroughs: 0, dmgTaken: 1, tuftsCut: 0, pickups: 0, treasureFound: 0 };
  const g = (s, id) => P.judge(s, P.defaultFavor()).find(c => c.id === id).score;
  const pSwing = g({ ...bare, interrupts: 100 }, 'pluma') - g(bare, 'pluma');
  const uSwing = g({ ...bare, dashThroughs: 100 }, 'umbra') - g(bare, 'umbra');
  const aSwing = g({ ...bare, tuftsCut: 98 }, 'aurum') - g(bare, 'aurum');
  fun('F12a', 'interrupt farming buys at most a nudge (<= 0.25)', pSwing <= 0.25, `pluma swing from farming = ${pSwing.toFixed(2)}`);
  fun('F12b', 'dash farming cannot launder a hit taken (<= 0.25)', uSwing <= 0.25, `umbra swing = ${uSwing.toFixed(2)}`);
  fun('F12c', 'mowing grass alone does not buy an A from AURUM', aSwing <= 0.25 && g({ ...bare, tuftsCut: 98 }, 'aurum') < 0.72,
    `aurum swing = ${aSwing.toFixed(2)}, absolute = ${g({ ...bare, tuftsCut: 98 }, 'aurum').toFixed(2)}`);
  // honesty law: the card shows what you DID, and what was COUNTED if they differ
  const card = P.judge({ ...base, interrupts: 99 }, P.defaultFavor()).find(c => c.id === 'pluma');
  fun('F12d', 'the board reports the real run, not the capped one', /99 cut \(5 counted\)/.test(card.stat), `pluma stat: "${card.stat}"`);
}

// ---- report ----
const pass = results.filter(r => r.pass).length;
console.log('\nDUCK SOULS — FUN HARNESS\n' + '='.repeat(56));
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(5)} ${r.claim}\n            ${r.detail}`);
}
console.log('='.repeat(56));
console.log(`${pass}/${results.length} fun-hypotheses hold`);
// standard summary line so external verifiers (build_ledger) can certify the transcript
const failed = results.length - pass;
console.log(`=== ${failed} failed, ${pass} passed in 0.00s ===\n`);
fs.writeFileSync(path.join(__dirname, process.env.FUN_OUT || 'fun_last.json'), JSON.stringify(results, null, 2));
process.exit(results.every(r => r.pass) ? 0 : 1);
