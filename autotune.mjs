#!/usr/bin/env node
// autotune.mjs — the AUTOTUNE engine (L1/L2). Hill-climbs the params.js surface toward the
// funProxy (a flow-channel proxy, NOT delight), with every FUN.md hypothesis as a HARD
// CONSTRAINT: a candidate that breaks fairness is rejected even if the proxy improves.
//
//   node autotune.mjs --budget 8 --sessions 4 [--dry] [--port 8642]
//
// Loops: L0 one bot session (puppeteer) → L1 K sessions per candidate on FRESH seeds →
// L2 propose→measure→gate→accept. Writes params.json + appends AUTOTUNE_LEDGER.md.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import puppeteer from 'puppeteer';

const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const BUDGET = +opt('--budget', 8), SESSIONS = +opt('--sessions', 4);
const PORT = +opt('--port', 8642), DRY = args.includes('--dry');
const HERE = new URL('.', import.meta.url).pathname;

// --- the tunable subset the tuner is allowed to move (name -> [path, lo, hi, step]) ---
const KNOBS = {
  insetScale: ['room.insetScale', 0.7, 1.6, 0.12],
  mutRoll: ['room.mutRoll', 0.4, 0.85, 0.08],
  dangerBase: ['spawn.dangerBase', 1, 5, 0.5],
  dangerSlope: ['spawn.dangerSlope', 0.8, 2.2, 0.2],
  densityDiv: ['spawn.densityDiv', 180, 360, 24],
  speedScale: ['enemy.speedScale', 0.02, 0.09, 0.01],
  slashReach: ['combat.slashReach', 6, 8, 0.3],
  dropChance: ['pacing.dropChance', 0.12, 0.4, 0.04],
};
const getP = (o, path) => path.split('.').reduce((a, k) => a[k], o);
const setP = (o, path, v) => { const ks = path.split('.'); const last = ks.pop(); const t = ks.reduce((a, k) => (a[k] = a[k] || {}, a[k]), o); t[last] = v; };

// funProxy from aggregated bot metrics: a flow channel (both too-easy and too-hard hurt).
function funProxy(m, W, T) {
  const inBand = (v, lo, hi) => v >= lo && v <= hi ? 1 : Math.max(0, 1 - Math.min(Math.abs(v - lo), Math.abs(v - hi)) / Math.max(1, hi));
  const difficulty = m.avgFloor; // deeper = easier for a competent bot; want it in [floorLo, floorHi]
  const diffPenalty = difficulty < T.floorLo ? (T.floorLo - difficulty) : difficulty > T.floorHi ? (difficulty - T.floorHi) : 0;
  return W.hyp * (m.funGreen ? 1 : 0)
    + W.cadence * (m.novelPerMin >= T.novelPerMin ? 1 : m.novelPerMin / T.novelPerMin)
    + W.decision * Math.min(1, m.decisionPct / 0.4)
    + W.variety * Math.min(1, m.variety / 10)
    - W.difficulty * diffPenalty
    + 0.3 * (m.telegraphPct >= T.telegraphPct ? 1 : 0);
}

async function evalCandidate(browser, params, seeds) {
  const b64 = Buffer.from(JSON.stringify(params)).toString('base64');
  const agg = { deaths: 0, floors: 0, novel: 0, dur: 0, choices: 0, rooms: 0, muts: new Set(), tele: 0, dmg: 0, runs: 0 };
  for (const seed of seeds) {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}/?bot=1&params=${encodeURIComponent(b64)}`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((pp) => { localStorage.setItem('ducksouls_seen', '1'); localStorage.setItem('ducksouls_grown', '1'); localStorage.setItem('ducksouls_params', JSON.stringify(pp)); }, params);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.evaluate(() => { if (window.__botStart) __botStart(); });
    await new Promise(r => setTimeout(r, 22000)); // ~22s session
    const L = await page.evaluate(() => (window.__botStop ? __botStop() : window.__botLog));
    await page.close();
    if (!L) continue;
    agg.runs++; agg.deaths += L.deaths.length;
    agg.floors += Math.max(...(L.deaths.map(d => d.floor).concat([1])));
    agg.novel += L.novel.length; agg.dur += (L.events.length ? L.events[L.events.length - 1].t : 22);
    agg.choices += L.choices; agg.rooms += L.roomsSeen;
    Object.keys(L.mutsSeen).forEach(k => agg.muts.add(k));
    agg.dmg += L.damage.length; agg.tele += L.damage.filter(d => d.telegraphed).length;
  }
  const r = Math.max(1, agg.runs);
  return {
    funGreen: funTestGreen(params),
    avgFloor: agg.floors / r,
    novelPerMin: agg.novel / (agg.dur / 60 || 1),
    decisionPct: agg.rooms ? agg.choices / agg.rooms : 0,
    variety: agg.muts.size,
    telegraphPct: agg.dmg ? agg.tele / agg.dmg : 1,
    deathsPerRun: agg.deaths / r,
  };
}

// HARD CONSTRAINT: run fun_test against the candidate params (writes a temp params.json the
// suite reads). Returns true only if all fairness/honesty hypotheses hold.
function funTestGreen(params) {
  const bak = fs.existsSync(HERE + 'params.json') ? fs.readFileSync(HERE + 'params.json') : null;
  try {
    fs.writeFileSync(HERE + 'params_candidate.json', JSON.stringify(params));
    const out = execSync(`AUTOTUNE_PARAMS=params_candidate.json node fun_test.js`, { cwd: HERE, stdio: 'pipe' }).toString();
    return /=== 0 failed/.test(out);
  } catch (e) { return false; } finally { if (bak) fs.writeFileSync(HERE + 'params.json', bak); }
}

function seedSet(n, base) { return Array.from({ length: n }, (_, i) => base * 7919 + i * 104729); }

function loadDefaults() {
  return eval('(' + fs.readFileSync(HERE + 'params.js', 'utf8').match(/const DEFAULTS = (\{[\s\S]*?\n  \});/)[1] + ')');
}
async function main() {
  const P = loadDefaults();
  const T = P.autotune.target, W = P.autotune.weights;
  const proposeSeeds = seedSet(SESSIONS, 1), holdoutSeeds = seedSet(SESSIONS, 2);

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  console.log(`AUTOTUNE — budget ${BUDGET}, ${SESSIONS} sessions/candidate${DRY ? ' (dry)' : ''}`);

  let best = JSON.parse(JSON.stringify(P));
  let baseM = await evalCandidate(browser, best, proposeSeeds);
  let baseScore = funProxy(baseM, W, T);
  console.log(`baseline funProxy=${baseScore.toFixed(3)}  floor=${baseM.avgFloor.toFixed(1)} novel/min=${baseM.novelPerMin.toFixed(1)} decision=${(baseM.decisionPct * 100 | 0)}% variety=${baseM.variety} tele=${(baseM.telegraphPct * 100 | 0)}% green=${baseM.funGreen}`);

  const knobNames = Object.keys(KNOBS);
  const log = [`\n## Epoch ${new Date().toISOString().slice(0, 10)} — baseline ${baseScore.toFixed(3)}`];
  let accepted = 0;

  for (let i = 0; i < BUDGET; i++) {
    const cand = JSON.parse(JSON.stringify(best));
    const kn = knobNames[i % knobNames.length];
    const [path, lo, hi, step] = KNOBS[kn];
    const dir = (i % (knobNames.length * 2)) < knobNames.length ? 1 : -1;
    const nv = Math.max(lo, Math.min(hi, +(getP(cand, path) + dir * step).toFixed(3)));
    if (nv === getP(cand, path)) continue;
    setP(cand, path, nv);
    const m = await evalCandidate(browser, cand, proposeSeeds);
    const score = funProxy(m, W, T);
    const passGate = m.funGreen && score > baseScore + P.autotune.noiseMargin;
    let confirmed = false;
    if (passGate) { // holdout confirmation (anti-overfit)
      const mh = await evalCandidate(browser, cand, holdoutSeeds);
      confirmed = mh.funGreen && funProxy(mh, W, T) > baseScore;
    }
    const verdict = confirmed ? 'ACCEPT' : (passGate ? 'reject(holdout)' : (!m.funGreen ? 'reject(FUN.md RED)' : 'reject(no gain)'));
    console.log(`  ${kn} ${getP(best, path)}→${nv}  funProxy=${score.toFixed(3)}  ${verdict}`);
    log.push(`- ${kn} ${getP(best, path)}→${nv}: proxy ${baseScore.toFixed(3)}→${score.toFixed(3)} [${verdict}]`);
    if (confirmed && !DRY) { best = cand; baseScore = score; accepted++; }
  }
  await browser.close();

  log.push(`epoch: ${accepted} accepted, final funProxy ${baseScore.toFixed(3)}`);
  fs.appendFileSync(HERE + 'AUTOTUNE_LEDGER.md', log.join('\n') + '\n');
  if (accepted && !DRY) patchParamsJs(best); // bake accepted values into params.js DEFAULTS
  try { fs.unlinkSync(HERE + 'params_candidate.json'); } catch (e) { }
  console.log(`\n${accepted} accepted · funProxy ${baseScore.toFixed(3)} · ledger appended${accepted ? ' · params.js patched' : ''}`);
  process.exit(accepted ? 0 : 42); // 0 = improved (driver commits+deploys), 42 = no change
}

// bake accepted knob values directly into params.js DEFAULTS (each knob key is unique in the
// DEFAULTS block, so a targeted line-replace is safe; browser reads params.js, git reverts).
function patchParamsJs(p) {
  let s = fs.readFileSync(HERE + 'params.js', 'utf8');
  for (const kn of Object.keys(KNOBS)) {
    const [path] = KNOBS[kn]; const key = path.split('.').pop(); const v = getP(p, path);
    s = s.replace(new RegExp(`(${key}:\\s*)[0-9.]+`), `$1${v}`);
  }
  fs.writeFileSync(HERE + 'params.js', s);
}

main().catch(e => { console.error(e); process.exit(1); });
