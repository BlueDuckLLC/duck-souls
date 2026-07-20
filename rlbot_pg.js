// rlbot_pg.js — TRUE policy-gradient RL for DUCK SOULS (REINFORCE), the credit-assignment
// upgrade RL_FUN.md §10 named as the fix for the ES adversary's passivity. Softmax MLP policy,
// analytic backprop (zero deps), reward-to-go + normalized advantage baseline, plus a DENSE
// attack-proximity shaping so the sparse kill->clear->descend chain has a gradient to climb.
// The question this answers: does temporal credit assignment learn to ENGAGE where gradient-free
// ES only learned to camp? Honest report either way.
//
//   node rlbot_pg.js train [iters] [batch]   → trains, saves rlbot_pg_policy.json, prints audit
//   node rlbot_pg.js eval
'use strict';
const fs = require('fs'), path = require('path');
const { Env, ACTIONS } = require('./headless.js');

const OBS = new Env().obsSize, HID = 20, ACT = ACTIONS.length;
const ATK = ACTIONS.indexOf('attack');
const GAMMA = 0.99, LR = 0.02, ENTROPY = 0.01;

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(rng) { let u = 0, v = 0; while (!u) u = rng(); while (!v) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// params as separate matrices for clean backprop
function initNet(rng) {
  const W1 = Array.from({ length: HID }, () => Float64Array.from({ length: OBS }, () => gauss(rng) * Math.sqrt(1 / OBS)));
  const b1 = new Float64Array(HID);
  const W2 = Array.from({ length: ACT }, () => Float64Array.from({ length: HID }, () => gauss(rng) * Math.sqrt(1 / HID)));
  const b2 = new Float64Array(ACT);
  return { W1, b1, W2, b2 };
}
function forward(net, x) {
  const h = new Float64Array(HID), z1 = new Float64Array(HID);
  for (let i = 0; i < HID; i++) { let s = net.b1[i]; const w = net.W1[i]; for (let j = 0; j < OBS; j++) s += w[j] * (x[j] || 0); z1[i] = s; h[i] = Math.tanh(s); }
  const z2 = new Float64Array(ACT);
  for (let a = 0; a < ACT; a++) { let s = net.b2[a]; const w = net.W2[a]; for (let i = 0; i < HID; i++) s += w[i] * h[i]; z2[a] = s; }
  let mx = -1e9; for (let a = 0; a < ACT; a++) if (z2[a] > mx) mx = z2[a];
  const p = new Float64Array(ACT); let sum = 0; for (let a = 0; a < ACT; a++) { p[a] = Math.exp(z2[a] - mx); sum += p[a]; }
  for (let a = 0; a < ACT; a++) p[a] /= sum;
  return { h, p };
}
function sample(p, rng) { let r = rng(), c = 0; for (let a = 0; a < ACT; a++) { c += p[a]; if (r <= c) return a; } return ACT - 1; }

// accumulate REINFORCE gradient for one (x, action, advantage) into grads (ASCENT direction)
function accumGrad(net, grads, x, h, p, a, adv) {
  const dz2 = new Float64Array(ACT);
  for (let k = 0; k < ACT; k++) dz2[k] = ((k === a ? 1 : 0) - p[k]) * adv; // REINFORCE: ∂logπ(a)/∂z2 · advantage
  for (let k = 0; k < ACT; k++) { grads.b2[k] += dz2[k]; const gw = grads.W2[k]; for (let i = 0; i < HID; i++) gw[i] += dz2[k] * h[i]; }
  const dh = new Float64Array(HID);
  for (let i = 0; i < HID; i++) { let s = 0; for (let k = 0; k < ACT; k++) s += net.W2[k][i] * dz2[k]; dh[i] = s * (1 - h[i] * h[i]); }
  for (let i = 0; i < HID; i++) { grads.b1[i] += dh[i]; const gw = grads.W1[i]; for (let j = 0; j < OBS; j++) gw[j] += dh[i] * (x[j] || 0); }
}
function zeroGrads() { return { W1: Array.from({ length: HID }, () => new Float64Array(OBS)), b1: new Float64Array(HID), W2: Array.from({ length: ACT }, () => new Float64Array(HID)), b2: new Float64Array(ACT) }; }
function applyGrads(net, grads, lr, n) {
  for (let i = 0; i < HID; i++) { net.b1[i] += lr * grads.b1[i] / n; for (let j = 0; j < OBS; j++) net.W1[i][j] += lr * grads.W1[i][j] / n; }
  for (let a = 0; a < ACT; a++) { net.b2[a] += lr * grads.b2[a] / n; for (let i = 0; i < HID; i++) net.W2[a][i] += lr * grads.W2[a][i] / n; }
}

// one episode: collect (x,h,p,a,r) with a DENSE shaped reward; return trajectory + stats
function episode(env, net, seed, rng, maxSteps = 500) {
  env.reset(seed); let obs = env.observe(); const traj = []; let kills0 = 0;
  for (let t = 0; t < maxSteps; t++) {
    const { h, p } = forward(net, obs); const a = sample(p, rng);
    const near = (a === ATK && (obs[9] || 1) < 0.16) ? 0.06 : 0;   // dense attack-proximity shaping
    const r = env.step(a);
    traj.push({ x: obs, h, p, a, r: r.reward + near });
    obs = r.obs;
    if (r.done) break;
  }
  const G = env.sb.G;
  return { traj, kills: (G.run && G.run.kills) || 0, floors: (G.run && G.run.floors) || 0, steps: traj.length, score: env.score() };
}

function train(iters = 120, batch = 16) {
  const env = new Env(), rng = mulberry32(999);
  let net = initNet(rng), best = { avg: -1e9, net: null };
  console.log(`REINFORCE: obs ${OBS} hid ${HID} act ${ACT} · lr ${LR} γ ${GAMMA} · ${iters} iters × ${batch} eps`);
  for (let it = 0; it < iters; it++) {
    const grads = zeroGrads(); const eps = []; let allAdv = [];
    for (let b = 0; b < batch; b++) {
      const ep = episode(env, net, 1 + ((rng() * 1e6) | 0), rng); eps.push(ep);
      // reward-to-go
      let G = 0; const rtg = new Array(ep.traj.length);
      for (let t = ep.traj.length - 1; t >= 0; t--) { G = ep.traj[t].r + GAMMA * G; rtg[t] = G; }
      ep.rtg = rtg; allAdv = allAdv.concat(rtg);
    }
    // normalize advantages across the batch (variance reduction / baseline)
    const mean = allAdv.reduce((a, b) => a + b, 0) / (allAdv.length || 1);
    const std = Math.sqrt(allAdv.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (allAdv.length || 1)) + 1e-6;
    let steps = 0;
    for (const ep of eps) for (let t = 0; t < ep.traj.length; t++) { const s = ep.traj[t]; accumGrad(net, grads, s.x, s.h, s.p, s.a, (ep.rtg[t] - mean) / std); steps++; }
    applyGrads(net, grads, LR, steps || 1);
    const avgScore = eps.reduce((a, e) => a + e.score, 0) / batch, avgKills = eps.reduce((a, e) => a + e.kills, 0) / batch, maxFloor = Math.max(...eps.map(e => e.floors));
    if (avgScore > best.avg) best = { avg: avgScore, net: JSON.parse(JSON.stringify({ W1: net.W1.map(r => [...r]), b1: [...net.b1], W2: net.W2.map(r => [...r]), b2: [...net.b2] })) };
    if (it % 10 === 0 || it === iters - 1) console.log(`  it ${String(it).padStart(3)}: avgScore ${avgScore.toFixed(0)}  avgKills ${avgKills.toFixed(2)}  maxFloor ${maxFloor}`);
  }
  fs.writeFileSync(path.join(__dirname, 'rlbot_pg_policy.json'), JSON.stringify({ HID, OBS, ACT, net: best.net, avg: best.avg }));
  console.log(`\nsaved rlbot_pg_policy.json (best avgScore ${best.avg.toFixed(0)})`);
  audit(env, best.net);
}

function audit(env, netObj) {
  const net = { W1: netObj.W1.map(r => Float64Array.from(r)), b1: Float64Array.from(netObj.b1), W2: netObj.W2.map(r => Float64Array.from(r)), b2: Float64Array.from(netObj.b2) };
  const rng = mulberry32(4242); const acts = new Array(ACT).fill(0); let sc = 0, st = 0, kills = 0, maxFloor = 0, deaths = 0; const N = 20;
  for (let i = 0; i < N; i++) {
    env.reset(7000 + i * 9); let obs = env.observe();
    for (let t = 0; t < 1000; t++) { const { p } = forward(net, obs); let a = 0; for (let k = 1; k < ACT; k++) if (p[k] > p[a]) a = k; acts[a]++; const r = env.step(a); obs = r.obs; st++; if (r.done) break; }
    const G = env.sb.G; sc += env.score(); kills += (G.run && G.run.kills) || 0; maxFloor = Math.max(maxFloor, (G.run && G.run.floors) || 0); if (G.state === 'dead') deaths++;
  }
  const tot = acts.reduce((a, b) => a + b, 0) || 1;
  const dist = acts.map((c, a) => [ACTIONS[a], c / tot]).sort((x, y) => y[1] - x[1]);
  console.log(`\n=== POLICY-GRADIENT AUDIT (${N} eps, greedy) ===`);
  console.log(`ceiling: avgScore ${(sc / N).toFixed(0)}  avgSurvival ${(st / N).toFixed(0)}  avgKills ${(kills / N).toFixed(1)}  maxFloor ${maxFloor}  deaths ${deaths}/${N}`);
  console.log('action mix: ' + dist.map(([a, p]) => `${a} ${(p * 100).toFixed(0)}%`).join('  '));
  const degen = dist[0][1] > 0.75;
  console.log(degen ? `⚠ still degenerate ('${dist[0][0]}' ${(dist[0][1] * 100).toFixed(0)}%)` : `mixed strategy (top '${dist[0][0]}' ${(dist[0][1] * 100).toFixed(0)}%); avgKills ${(kills / N).toFixed(1)} vs ES ~0.2`);
}

if (require.main === module) {
  const mode = process.argv[2] || 'train';
  if (mode === 'train') train(+process.argv[3] || 120, +process.argv[4] || 16);
  else if (mode === 'eval') { const P = JSON.parse(fs.readFileSync(path.join(__dirname, 'rlbot_pg_policy.json'), 'utf8')); audit(new Env(), P.net); }
}
