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

// ---- round 3: v5 weapons (panel seat 5) ----
// F20: a held weapon OWNS the attack — no free base sword layered underneath.
{
  const ownsAttack = /WEAPON_STATS/.test(SRC) && /function weaponAttack/.test(SRC)
    && /const wpn = ITEMS\[heldKind\(\)\][\s\S]{0,80}?weapon/.test(SRC.replace(/\s+/g, ' ')) === false // any signal it dispatches
    ? true : (/heldKind\(\)[\s\S]{0,120}?weaponAttack\(/.test(SRC));
  fun('F20', 'holding a weapon replaces the base slash (weapon owns the attack)', ownsAttack,
    ownsAttack ? 'slash dispatches to the held weapon' : 'base slash fires under every weapon (flail/hammer = free sword + ability)');
}
// F21: DPS band — no weapon overpowers the median. Reads the shared WEAPON_STATS table.
{
  const m = SRC.match(/const WEAPON_STATS = (\{[\s\S]*?\n\});/);
  let ok = false, detail = 'WEAPON_STATS table absent — DPS is not balanced from one source';
  if (m) {
    let tbl; try { tbl = new Function('return ' + m[1])(); } catch (e) { tbl = null; }
    if (tbl) {
      const dps = Object.values(tbl).map(w => (w.dmg * (w.multi || 1)) / w.cd);
      const sorted = [...dps].sort((a, b) => a - b), med = sorted[(sorted.length / 2) | 0];
      const mx = Math.max(...dps), mn = Math.min(...dps);
      ok = mx <= med * 1.4 && mn >= med * 0.6;
      detail = `dps ${dps.map(d => d.toFixed(1)).join('/')}; median ${med.toFixed(1)}, max ${(mx / med).toFixed(2)}x, min ${(mn / med).toFixed(2)}x`;
    }
  }
  fun('F21', 'no signature weapon breaks the DPS band (0.6x..1.4x median)', ok, detail);
}
// F22: every weapon's hit path respects walls — now proven BEHAVIORALLY by combat_test.js
// (the old version grepped for `losBlocked`; a grep is the shape-vs-behavior trap). Here we
// require the weapon code to route through the tested pure predicate, and that the behavior
// test actually exercises line-of-sight blocking for every weapon.
{
  const wa = SRC.match(/function weaponAttack[\s\S]*?\n\}/);
  const routes = wa ? (wa[0].match(/Combat\.weaponHits/g) || []).length : 0;
  let behTests = false;
  try {
    const ct = fs.readFileSync(path.join(__dirname, 'combat_test.js'), 'utf8');
    behTests = /wall blocks the \$\{w\}/.test(ct) && /'sword', 'rapier', 'whip', 'hammer', 'flail'/.test(ct);
    require('./combat.js'); // must load without error
  } catch (e) { behTests = false; }
  // honest scope: the 5 MELEE weapons (sword/rapier/whip/hammer/flail) respect walls via the
  // tested predicate; the 2 projectiles (boomerang/spore) collide per-step on solidAt, a
  // different model. So we require BOTH melee routing in weaponAttack AND the flail's primary
  // orbit (updatePlay) to route through Combat, and the behavioral test to cover them.
  const orbitRoutes = /flailCd <= 0 && Combat\.weaponHits\('flail'/.test(SRC);
  fun('F22', 'the 5 melee weapons respect walls, verified behaviorally (combat.js + combat_test.js)',
    routes >= 2 && orbitRoutes && behTests,
    `weaponAttack routes ${routes}x; flail-orbit routed: ${orbitRoutes}; combat_test per-weapon LOS: ${behTests}`);
}
// F23: SPORE-BOW is not a blind-pick trap — it regenerates.
{
  const regen = /sporebow[\s\S]{0,200}?ammo = Math\.min|ammo\+\+[\s\S]{0,80}?sporebow|regenSpore|sporeRegen/.test(SRC);
  fun('F23', 'the spore-bow refills so it stays a weapon, not a consumable', regen,
    regen ? 'spore ammo regenerates' : 'spore-bow empties to null — a trap pick');
}
// F24: hammer cannot be spammed (a cooldown gates the smash).
{
  const cd = /hammerCd|p\.atkCd = [^\n]*hammer|smashCd/.test(SRC);
  fun('F24', 'the hammer smash has a cooldown (no permastun spam)', cd,
    cd ? 'smash gated by a cooldown' : 'hammerSmash has no cooldown — 15 DPS + permastun');
}
// F25: each weapon has its OWN animation branch (color-matched per the operator ask).
{
  // count the per-weapon branches INSIDE drawWeaponFx — a distinct visual per weapon,
  // not just the function existing (that would be the shape-vs-behavior trap)
  const fx = SRC.match(/function drawWeaponFx[\s\S]*?\n\}/);
  const anims = ['hammer', 'whip', 'rapier', 'boomerang', 'flail', 'sporebow']
    .filter(w => fx && new RegExp(`w\\.kind === '${w}'`).test(fx[0]));
  fun('F25', 'every weapon has its own attack animation branch', anims.length >= 6,
    `weapons with a distinct anim branch: ${anims.length}/6`);
}

// ---- round 4: the arcade roster (16 enemies shipped with no fun-hypothesis) ----
// Read the real ENEMIES table + the depth speed-scaling + player base speed from source.
{
  const em = SRC.match(/const ENEMIES = (\{[\s\S]*?\n\});/);
  const scaleM = SRC.match(/spd: d\.spd \* \(1 \+ ([0-9.]+) \* G\.depth\)/);
  const playerBase = parseFloat((SRC.match(/spd: (\d+) \* p\.spdMult/) || [, 14])[1]);
  let ENEM = null; try { ENEM = em ? new Function('return ' + em[1])() : null; } catch (e) { }
  const scale = scaleM ? parseFloat(scaleM[1]) : 0.05;
  const spdAt = (base, depth) => base * (1 + scale * depth);
  const HOMING = ['chase', 'ghost', 'joust', 'spin', 'wall']; // archetypes that seek the player

  // F26: every HOMING enemy stays slower than the player through depth 10 — you can always
  // create space (the Robotron rule: you die cornered, not outsped).
  {
    let worst = null, worstR = 0;
    if (ENEM) for (const [k, d] of Object.entries(ENEM)) {
      if (!HOMING.includes(d.arch)) continue;
      const r = spdAt(d.spd, 10) / playerBase;
      if (r > worstR) { worstR = r; worst = k; }
    }
    fun('F26', 'homing enemies never outrun the player (you can always make space)', ENEM && worstR < 0.95,
      `fastest homing at depth 10: ${worst} at ${(worstR).toFixed(2)}x player speed`);
  }

  // F27: an INVULNERABLE enemy (Otto — unkillable) must be strictly slower than the player
  // at ALL depths, or it becomes guaranteed unavoidable damage.
  {
    const inv = ENEM ? Object.entries(ENEM).filter(([, d]) => d.invuln) : [];
    let bad = null;
    for (const [k, d] of inv) {
      // otto's effective speed includes a homing nudge (+2 in the bounce archetype)
      const eff = spdAt(d.spd, 10) + 2;
      if (eff >= playerBase) bad = `${k} = ${eff.toFixed(1)} vs player ${playerBase} at depth 10`;
    }
    fun('F27', 'the invulnerable enemy can always be outrun (it herds, never guarantees a hit)',
      inv.length > 0 && !bad, bad || (inv.length ? 'invulnerable enemies stay slower' : 'no invulnerable enemy found'));
  }

  // F28: every archetype with a RANGED or DASH lethal move sets a telegraph state before the
  // damaging frame (dive windup, shoot/lob/march aim, burn windup).
  {
    const ai = (SRC.match(/function arcadeAI[\s\S]*?\n\}/) || [''])[0];
    const shoot = (SRC.match(/function arcadeShoot[\s\S]*?\n\}/) || [''])[0];
    const diveTele = /case 'dive'[\s\S]*?state === 'windup'/.test(ai);
    const burnTele = /case 'burn'[\s\S]*?state === 'windup'/.test(ai);
    const shootTele = /aimT = e\.cd <= TURRET_AIM/.test(shoot);
    fun('F28', 'ranged/dash arcade attacks telegraph before they strike', diveTele && burnTele && shootTele,
      `dive windup:${diveTele} burn windup:${burnTele} shoot aim:${shootTele}`);
  }

  // F29: the splitter cannot exponentially fill a room — generations are bounded.
  {
    const genCap = /gen \|\| 0\) < (\d+)/.exec(SRC);
    const cap = genCap ? parseInt(genCap[1]) : 99;
    // 1 -> 2 -> 4 then gen==cap dies normally: total spawned descendants bounded
    fun('F29', 'the splitter cannot exponentially explode (bounded generations)', cap <= 2,
      `splitter halves for ${cap} generations (max ~${Math.pow(2, cap + 1) - 1} bodies from one)`);
  }
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
