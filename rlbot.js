// rlbot.js — a LEARNED adversary for DUCK SOULS (Phase B of RL_FUN.md).
// Cross-Entropy Method (a simple, gradient-free Evolution Strategy) over a tiny MLP policy,
// trained on the headless.js sim core. Zero deps, no autodiff. The point is NOT "RL discovers
// fun" — it's an ADVERSARY: train an agent to WIN, then read off (a) the survival/combat ceiling
// and (b) any DEGENERATE dominant strategy. Both feed harsher REDs into /tdd-fun than the
// scripted bot can. Reward = game score + a survival bonus (see fitness()).
//
//   node rlbot.js train [gens] [pop]   → trains, saves rlbot_policy.json, prints report+audit
//   node rlbot.js eval                 → loads the policy, runs the exploit audit
//   node rlbot.js baselines            → random vs greedy-heuristic vs trained, same env
'use strict';
const fs = require('fs'), path = require('path');
const { Env, ACTIONS } = require('./headless.js');

const OBS = 30, HID = 16, ACT = ACTIONS.length; // 8
const NP = HID * OBS + HID + ACT * HID + ACT;    // param count = 632

// deterministic gaussian (Box-Muller) off a seeded uniform so training reproduces
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(rng) { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// unpack a flat θ into the MLP and run a forward pass → action index (argmax)
function _forward(theta, obs) {
  let o = 0; const h = new Float64Array(HID);
  // W1: HID x OBS
  for (let i = 0; i < HID; i++) { let s = 0; for (let j = 0; j < OBS; j++) s += theta[o++] * (obs[j] || 0); h[i] = s; }
  for (let i = 0; i < HID; i++) h[i] = Math.tanh(h[i] + theta[o++]); // b1
  // W2: ACT x HID
  const out = new Float64Array(ACT);
  for (let a = 0; a < ACT; a++) { let s = 0; for (let i = 0; i < HID; i++) s += theta[o++] * h[i]; out[a] = s; }
  for (let a = 0; a < ACT; a++) out[a] += theta[o++]; // b2
  let best = 0; for (let a = 1; a < ACT; a++) if (out[a] > out[best]) best = a;
  return best;
}

// one episode; returns {score, steps, kills, floors, actions[]}
function rollout(env, policy, seed, maxSteps = 600) {
  env.reset(seed);
  let obs = env.observe(), steps = 0; const acts = new Array(ACT).fill(0);
  for (let i = 0; i < maxSteps; i++) {
    const a = policy(obs); acts[a]++;
    const r = env.step(a); obs = r.obs; steps++;
    if (r.done) break;
  }
  const G = env.sb.G;
  return { score: env.score(), steps, kills: (G.run && G.run.kills) || 0, floors: (G.run && G.run.floors) || 0, acts };
}

// fitness = mean over K seeded episodes of (score + survival bonus). Rewards killing + not dying.
function fitness(env, theta, seeds) {
  const policy = obs => _forward(theta, obs);
  let f = 0; for (const s of seeds) { const r = rollout(env, policy, s); f += r.score + 0.03 * r.steps; }
  return f / seeds.length;
}

function train(gens = 25, pop = 32) {
  const env = new Env(); const rng = mulberry32(12345);
  const K = 4, ELITE = Math.max(4, pop >> 2);
  let mean = new Float64Array(NP); for (let i = 0; i < NP; i++) mean[i] = gauss(rng) * 0.3;
  let sigma = 0.5, best = { f: -1e9, theta: null };
  console.log(`ES/CEM: ${NP} params · pop ${pop} · elite ${ELITE} · ${K} eps/cand · ${gens} gens`);
  for (let g = 0; g < gens; g++) {
    const seeds = Array.from({ length: K }, () => 1 + ((rng() * 1e6) | 0)); // fresh seeds each gen (anti-overfit)
    const cands = [];
    for (let n = 0; n < pop; n++) {
      const th = new Float64Array(NP); for (let i = 0; i < NP; i++) th[i] = mean[i] + sigma * gauss(rng);
      cands.push({ theta: th, f: fitness(env, th, seeds) });
    }
    cands.sort((a, b) => b.f - a.f);
    if (cands[0].f > best.f) best = { f: cands[0].f, theta: Float64Array.from(cands[0].theta) };
    const elite = cands.slice(0, ELITE);
    const nm = new Float64Array(NP);
    for (const e of elite) for (let i = 0; i < NP; i++) nm[i] += e.theta[i] / ELITE;
    // sigma = elite std (CEM), floored so it keeps exploring
    let vs = 0; for (const e of elite) for (let i = 0; i < NP; i++) { const d = e.theta[i] - nm[i]; vs += d * d; }
    sigma = Math.max(0.05, Math.sqrt(vs / (ELITE * NP)));
    mean = nm;
    console.log(`  gen ${String(g + 1).padStart(2)}: bestFit ${cands[0].f.toFixed(1)}  meanElite ${(elite.reduce((s, e) => s + e.f, 0) / ELITE).toFixed(1)}  sigma ${sigma.toFixed(3)}`);
  }
  fs.writeFileSync(path.join(__dirname, 'rlbot_policy.json'), JSON.stringify({ NP, HID, OBS, ACT, theta: Array.from(best.theta), f: best.f, gens, pop }));
  console.log(`\nsaved rlbot_policy.json (bestFit ${best.f.toFixed(1)})`);
  audit(env, best.theta);
}

// EXPLOIT AUDIT: run the elite policy, report the ceiling + whether the strategy is degenerate.
function audit(env, theta) {
  const policy = obs => _forward(theta, obs);
  const acts = new Array(ACT).fill(0); let sc = 0, st = 0, kills = 0, maxFloor = 0, deaths = 0;
  const N = 20;
  for (let i = 0; i < N; i++) { const r = rollout(env, policy, 5000 + i * 7, 1200); for (let a = 0; a < ACT; a++) acts[a] += r.acts[a]; sc += r.score; st += r.steps; kills += r.kills; maxFloor = Math.max(maxFloor, r.floors); if (env.sb.G.state === 'dead') deaths++; }
  const total = acts.reduce((a, b) => a + b, 0) || 1;
  const dist = acts.map((c, a) => [ACTIONS[a], c / total]).sort((x, y) => y[1] - x[1]);
  const top = dist[0];
  console.log(`\n=== EXPLOIT AUDIT (${N} eps, elite policy) ===`);
  console.log(`ceiling: avgScore ${(sc / N).toFixed(0)}  avgSurvival ${(st / N).toFixed(0)} steps  avgKills ${(kills / N).toFixed(1)}  maxFloor ${maxFloor}  deaths ${deaths}/${N}`);
  console.log('action mix: ' + dist.map(([a, p]) => `${a} ${(p * 100).toFixed(0)}%`).join('  '));
  const degenerate = top[1] > 0.75;
  console.log(degenerate
    ? `⚠ DEGENERATE: '${top[0]}' is ${(top[1] * 100).toFixed(0)}% of actions — a dominant single-action strategy. FUN RED: no-dominant-strategy fails.`
    : `no single-action dominance (top '${top[0]}' ${(top[1] * 100).toFixed(0)}%). The adversary uses a mixed strategy.`);
  return { avgScore: sc / N, avgSurvival: st / N, avgKills: kills / N, maxFloor, deaths, dist, degenerate };
}

function baselines() {
  const env = new Env();
  const seeds = Array.from({ length: 12 }, (_, i) => 100 + i * 11);
  const random = () => (Math.random() * ACT) | 0;
  const greedy = obs => { const ex = obs[7], ey = obs[8], ed = obs[9]; if (ed < 0.12) return ACTIONS.indexOf('attack'); return Math.abs(ex) > Math.abs(ey) ? (ex > 0 ? 2 : 1) : (ey > 0 ? 4 : 3); };
  const run = (pol) => { let sc = 0, st = 0; for (const s of seeds) { const r = rollout(env, pol, s, 1000); sc += r.score; st += r.steps; } return { score: (sc / seeds.length).toFixed(0), steps: (st / seeds.length).toFixed(0) }; };
  const rnd = run(random), grd = run(greedy);
  console.log('baselines (avg over 12 seeds):');
  console.log('  random  :', JSON.stringify(rnd));
  console.log('  greedy  :', JSON.stringify(grd));
  if (fs.existsSync(path.join(__dirname, 'rlbot_policy.json'))) {
    const P = JSON.parse(fs.readFileSync(path.join(__dirname, 'rlbot_policy.json'), 'utf8'));
    const th = Float64Array.from(P.theta);
    console.log('  rlbot   :', JSON.stringify(run(obs => _forward(th, obs))));
  } else console.log('  rlbot   : (train first)');
}

if (require.main === module) {
  const mode = process.argv[2] || 'train';
  if (mode === 'train') train(+process.argv[3] || 25, +process.argv[4] || 32);
  else if (mode === 'eval') { const P = JSON.parse(fs.readFileSync(path.join(__dirname, 'rlbot_policy.json'), 'utf8')); audit(new Env(), Float64Array.from(P.theta)); }
  else if (mode === 'baselines') baselines();
}
module.exports = { _forward, rollout, audit, NP, OBS, ACT, HID };
