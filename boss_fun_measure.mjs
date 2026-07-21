#!/usr/bin/env node
// boss_fun_measure.mjs — BF6/BF7 behavioral measurement (TES-7194).
// Thresholds were PINNED in BOSS_FUN.md BEFORE this file measured anything (commit 1bc46cc).
// This harness may NOT change them. Validity gates are enforced FIRST: a verdict that fails a
// gate is UNMEASURED, never PASS — a zero-sample green is the "caps above saturation" bug.
//
//   node boss_fun_measure.mjs [--sessions 6] [--secs 40] [--port 8181]
import puppeteer from 'puppeteer';

const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? +args[i + 1] : d; };
const SESSIONS = opt('--sessions', 6), SECS = opt('--secs', 40), PORT = opt('--port', 8181);

// --- PINNED (do not edit here; mirror of BOSS_FUN.md) ---
const BF6_LO = 6.0, BF6_HI = 35.0;      // median time-to-form-2, seconds
const BF7_MIN = 0.70;                    // share of boss damage telegraphed
const MIN_ENCOUNTERS = 5, MIN_BOSS_DMG = 10;   // validity gate 2
const COMPETENCE_LO = 3, COMPETENCE_HI = 5;    // validity gate 1 (autotune's standing target)

const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const enc = [], bossDmg = [], floors = [];
for (let i = 0; i < SESSIONS; i++) {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('  [page error]', String(e).slice(0, 120)));
  await page.goto(`http://localhost:${PORT}/?bot=1`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.setItem('ducksouls_seen', '1'); localStorage.setItem('ducksouls_grown', '1'); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { if (window.__botStart) __botStart(); });
  await new Promise(r => setTimeout(r, SECS * 1000));
  const L = await page.evaluate(() => (window.__botStop ? __botStop() : window.__botLog));
  await page.close();
  if (!L) continue;
  enc.push(...(L.boss || []));
  bossDmg.push(...(L.damage || []).filter(d => d.boss));
  // competence = deepest floor REACHED (death-floors undercount a bot that survives)
  const reachedDepth = Math.max(L.maxDepth || 1, ...(L.deaths || []).map(d => d.floor).concat([1]));
  floors.push(reachedDepth);
  console.log(`  session ${i + 1}/${SESSIONS}: ${(L.boss || []).length} boss enc · ${(L.damage || []).filter(d => d.boss).length} boss-dmg · maxDepth ${reachedDepth} · deaths ${(L.deaths || []).length}`);
}
await browser.close();

// ---- validity gates FIRST ----
const avgFloor = floors.reduce((a, b) => a + b, 0) / Math.max(1, floors.length);
const competent = avgFloor >= COMPETENCE_LO && avgFloor <= COMPETENCE_HI;
const reached = enc.filter(e => e.tForm2 !== null).map(e => e.tForm2);
const enoughEnc = enc.length >= MIN_ENCOUNTERS, enoughDmg = bossDmg.length >= MIN_BOSS_DMG;

let pass = 0, fail = 0; const rows = [];
const put = (v, id, claim, detail) => { rows.push([v, id, claim, detail]); v === 'PASS' ? pass++ : fail++; };

console.log(`\nBOSS_FUN BEHAVIORAL — ${SESSIONS} sessions x ${SECS}s\n`);
console.log(`  GATE competence : avgFloor ${avgFloor.toFixed(2)} (target ${COMPETENCE_LO}-${COMPETENCE_HI}) -> ${competent ? 'OK' : 'INSTRUMENT REGRESSED'}`);
console.log(`  GATE sample     : ${enc.length} encounters (need ${MIN_ENCOUNTERS}) · ${bossDmg.length} boss-dmg events (need ${MIN_BOSS_DMG})`);
console.log(`  form-2 reached  : ${reached.length}/${enc.length} encounters\n`);

if (!competent) {
  put('RED/VOID', 'BF6', 'time-to-form-2 in [6.0s,35.0s]', `VOID: instrument failed the competence floor (avgFloor ${avgFloor.toFixed(2)}) — verdicts are noise, not a game problem`);
  put('RED/VOID', 'BF7', 'boss damage telegraphed >= 70%', `VOID: same competence-floor failure`);
} else {
  // BF6
  if (!enoughEnc || reached.length < 3) {
    put('RED/UNMEASURED', 'BF6', 'time-to-form-2 in [6.0s,35.0s]',
      `UNMEASURED: ${enc.length} encounters / ${reached.length} reached form 2 (need >=${MIN_ENCOUNTERS} enc & >=3 reaching form 2)`);
  } else {
    const m = median(reached);
    put(m >= BF6_LO && m <= BF6_HI ? 'PASS' : 'RED', 'BF6', 'time-to-form-2 in [6.0s,35.0s]',
      `median ${m.toFixed(2)}s over ${reached.length} form-2 clears (band ${BF6_LO}-${BF6_HI}s); all=${reached.map(x => x.toFixed(1)).join(',')}`);
  }
  // BF7
  if (!enoughDmg) {
    put('RED/UNMEASURED', 'BF7', 'boss damage telegraphed >= 70%',
      `UNMEASURED: only ${bossDmg.length} boss-damage events (need >=${MIN_BOSS_DMG})`);
  } else {
    const tele = bossDmg.filter(d => d.telegraphed).length, share = tele / bossDmg.length;
    const unknown = bossDmg.filter(d => d.cause === 'offscreen/unknown').length;
    put(share >= BF7_MIN ? 'PASS' : 'RED', 'BF7', 'boss damage telegraphed >= 70%',
      `${tele}/${bossDmg.length} = ${(share * 100).toFixed(1)}% telegraphed (min ${BF7_MIN * 100}%); unattributed=${unknown}`);
  }
}
put('RED/UNMEASURED', 'BF8', 'no degenerate boss cheese (<=15% better)', 'UNMEASURED: exploit seat not built — NOT claimed either way');

for (const [v, id, claim, detail] of rows) console.log(`  ${v.padEnd(15)} ${id}  ${claim}\n${' '.repeat(20)}${detail}`);
console.log(`\n=== ${fail} failed, ${pass} passed ===`);
