// rlbot_a2c.js — Advantage Actor-Critic for DUCK SOULS. The "get to green" push: REINFORCE
// converged to passive play because its baseline was crude; A2C adds a VALUE CRITIC (advantage =
// return - V, low variance) + an ENTROPY bonus (holds exploration so the policy can't collapse to
// one action) + the decaying damage curriculum (bootstraps combat). Shared-trunk MLP, two heads
// (policy + value), analytic backprop, zero deps.
// GREEN = the greedy audit is non-degenerate (top action <75%), avgKills >= 1.0, deaths <= 12/20.
//   node rlbot_a2c.js train [iters] [batch]
//   node rlbot_a2c.js eval
'use strict';
const fs = require('fs'), path = require('path');
const { Env, ACTIONS } = require('./headless.js');

const OBS = new Env().obsSize, HID = 24, ACT = ACTIONS.length, ATK = ACTIONS.indexOf('attack');
const GAMMA = 0.99, LR = 0.015, CV = 0.5;

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(rng) { let u = 0, v = 0; while (!u) u = rng(); while (!v) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

function initNet(rng) {
  return {
    W1: Array.from({ length: HID }, () => Float64Array.from({ length: OBS }, () => gauss(rng) * Math.sqrt(1 / OBS))), b1: new Float64Array(HID),
    Wp: Array.from({ length: ACT }, () => Float64Array.from({ length: HID }, () => gauss(rng) * Math.sqrt(1 / HID))), bp: new Float64Array(ACT),
    Wv: Float64Array.from({ length: HID }, () => gauss(rng) * Math.sqrt(1 / HID)), bv: 0,
  };
}
function forward(net, x) {
  const h = new Float64Array(HID);
  for (let i = 0; i < HID; i++) { let s = net.b1[i]; const w = net.W1[i]; for (let j = 0; j < OBS; j++) s += w[j] * (x[j] || 0); h[i] = Math.tanh(s); }
  const z = new Float64Array(ACT);
  for (let a = 0; a < ACT; a++) { let s = net.bp[a]; const w = net.Wp[a]; for (let i = 0; i < HID; i++) s += w[i] * h[i]; z[a] = s; }
  let mx = -1e9; for (let a = 0; a < ACT; a++) if (z[a] > mx) mx = z[a];
  const p = new Float64Array(ACT); let sm = 0; for (let a = 0; a < ACT; a++) { p[a] = Math.exp(z[a] - mx); sm += p[a]; } for (let a = 0; a < ACT; a++) p[a] /= sm;
  let v = net.bv; for (let i = 0; i < HID; i++) v += net.Wv[i] * h[i];
  return { h, p, v };
}
function sample(p, rng) { let r = rng(), c = 0; for (let a = 0; a < ACT; a++) { c += p[a]; if (r <= c) return a; } return ACT - 1; }
function zeroGrads() { return { W1: Array.from({ length: HID }, () => new Float64Array(OBS)), b1: new Float64Array(HID), Wp: Array.from({ length: ACT }, () => new Float64Array(HID)), bp: new Float64Array(ACT), Wv: new Float64Array(HID), bv: 0 }; }

// accumulate ASCENT gradient of J = policyObj + beta*entropy - CV*valueLoss for one transition
function accum(net, g, x, h, p, v, a, adv, ret, beta) {
  // entropy H and dH/dz_j = -p_j (log p_j + H)
  let H = 0; for (let k = 0; k < ACT; k++) H -= p[k] * Math.log(p[k] + 1e-9);
  const dz = new Float64Array(ACT);
  for (let k = 0; k < ACT; k++) {
    const pg = ((k === a ? 1 : 0) - p[k]) * adv;                 // policy gradient (advantage)
    const eg = beta * (-p[k] * (Math.log(p[k] + 1e-9) + H));     // entropy bonus
    dz[k] = pg + eg;
  }
  for (let k = 0; k < ACT; k++) { g.bp[k] += dz[k]; const gw = g.Wp[k]; for (let i = 0; i < HID; i++) gw[i] += dz[k] * h[i]; }
  // value head: ascent of -CV*0.5*(v-ret)^2 → dJ/dv = -CV*(v-ret)
  const dv = -CV * (v - ret);
  g.bv += dv; for (let i = 0; i < HID; i++) g.Wv[i] += dv * h[i];
  // trunk
  const dh = new Float64Array(HID);
  for (let i = 0; i < HID; i++) { let s = net.Wv[i] * dv; for (let k = 0; k < ACT; k++) s += net.Wp[k][i] * dz[k]; dh[i] = s * (1 - h[i] * h[i]); }
  for (let i = 0; i < HID; i++) { g.b1[i] += dh[i]; const gw = g.W1[i]; for (let j = 0; j < OBS; j++) gw[j] += dh[i] * (x[j] || 0); }
}
function apply(net, g, lr, n) {
  for (let i = 0; i < HID; i++) { net.b1[i] += lr * g.b1[i] / n; for (let j = 0; j < OBS; j++) net.W1[i][j] += lr * g.W1[i][j] / n; }
  for (let a = 0; a < ACT; a++) { net.bp[a] += lr * g.bp[a] / n; for (let i = 0; i < HID; i++) net.Wp[a][i] += lr * g.Wp[a][i] / n; }
  net.bv += lr * g.bv / n; for (let i = 0; i < HID; i++) net.Wv[i] += lr * g.Wv[i] / n;
}

const sumHp = env => (env.sb.G.enemies || []).reduce((s, e) => s + Math.max(0, e.hp || 0), 0);
function episode(env, net, seed, rng, hitW, maxSteps = 500) {
  env.reset(seed); let obs = env.observe(); const T = [];
  for (let t = 0; t < maxSteps; t++) {
    const { h, p, v } = forward(net, obs); const a = sample(p, rng);
    const hp0 = sumHp(env); const d0 = obs[9] == null ? 1 : obs[9]; const r = env.step(a);
    const dmg = Math.max(0, hp0 - sumHp(env));
    const approach = Math.max(0, d0 - (r.obs[9] == null ? 1 : r.obs[9])) * 0.6 * hitW; // reward closing on enemies
    const shaped = r.reward + (a === ATK ? Math.min(dmg, 4) * hitW : 0) + approach + (a === ATK && (obs[9] || 1) < 0.16 ? 0.02 : 0);
    T.push({ x: obs, h, p, v, a, r: shaped });
    obs = r.obs; if (r.done) break;
  }
  const G = env.sb.G;
  return { T, kills: (G.run && G.run.kills) || 0, floors: (G.run && G.run.floors) || 0, steps: T.length, score: env.score() };
}

function train(iters = 400, batch = 24) {
  const env = new Env(), rng = mulberry32(20260720);
  let net = initNet(rng), best = { key: -1e9, net: null };
  console.log(`A2C: obs ${OBS} hid ${HID} act ${ACT} · lr ${LR} γ ${GAMMA} cv ${CV} · ${iters}×${batch}`);
  for (let it = 0; it < iters; it++) {
    const hitW = Math.max(0, 0.4 * (1 - it / (iters * 0.55)));  // curriculum decay
    const beta = Math.max(0.004, 0.03 * (1 - it / iters));       // entropy decay
    const g = zeroGrads(); const eps = []; const advs = [];
    for (let b = 0; b < batch; b++) {
      const ep = episode(env, net, 1 + ((rng() * 1e6) | 0), rng, hitW); eps.push(ep);
      let R = 0; ep.ret = new Array(ep.T.length);
      for (let t = ep.T.length - 1; t >= 0; t--) { R = ep.T[t].r + GAMMA * R; ep.ret[t] = R; advs.push(R - ep.T[t].v); }
    }
    const mean = advs.reduce((a, b) => a + b, 0) / (advs.length || 1);
    const std = Math.sqrt(advs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (advs.length || 1)) + 1e-6;
    let n = 0;
    for (const ep of eps) for (let t = 0; t < ep.T.length; t++) { const s = ep.T[t]; accum(net, g, s.x, s.h, s.p, s.v, s.a, ((ep.ret[t] - s.v) - mean) / std, ep.ret[t], beta); n++; }
    apply(net, g, LR, n || 1);
    const aK = eps.reduce((a, e) => a + e.kills, 0) / batch, aS = eps.reduce((a, e) => a + e.score, 0) / batch, mF = Math.max(...eps.map(e => e.floors));
    const key = aK + mF; if (key > best.key) best = { key, net: clone(net) };
    if (it % 20 === 0 || it === iters - 1) console.log(`  it ${String(it).padStart(3)}: avgScore ${aS.toFixed(0)}  avgKills ${aK.toFixed(2)}  maxFloor ${mF}  hitW ${hitW.toFixed(2)} β ${beta.toFixed(3)}`);
  }
  fs.writeFileSync(path.join(__dirname, 'rlbot_a2c_policy.json'), JSON.stringify(serial(best.net)));
  console.log(`\nsaved rlbot_a2c_policy.json`);
  audit(env, best.net);
}
function clone(net) { return { W1: net.W1.map(r => Float64Array.from(r)), b1: Float64Array.from(net.b1), Wp: net.Wp.map(r => Float64Array.from(r)), bp: Float64Array.from(net.bp), Wv: Float64Array.from(net.Wv), bv: net.bv }; }
function serial(net) { return { HID, OBS, ACT, W1: net.W1.map(r => [...r]), b1: [...net.b1], Wp: net.Wp.map(r => [...r]), bp: [...net.bp], Wv: [...net.Wv], bv: net.bv }; }
function deserial(o) { return { W1: o.W1.map(r => Float64Array.from(r)), b1: Float64Array.from(o.b1), Wp: o.Wp.map(r => Float64Array.from(r)), bp: Float64Array.from(o.bp), Wv: Float64Array.from(o.Wv), bv: o.bv }; }

function audit(env, net) {
  const acts = new Array(ACT).fill(0); let sc = 0, st = 0, kills = 0, maxFloor = 0, deaths = 0; const N = 20;
  for (let i = 0; i < N; i++) {
    env.reset(7000 + i * 9); let obs = env.observe();
    for (let t = 0; t < 1000; t++) { const { p } = forward(net, obs); let a = 0; for (let k = 1; k < ACT; k++) if (p[k] > p[a]) a = k; acts[a]++; const r = env.step(a); obs = r.obs; st++; if (r.done) break; }
    const G = env.sb.G; sc += env.score(); kills += (G.run && G.run.kills) || 0; maxFloor = Math.max(maxFloor, (G.run && G.run.floors) || 0); if (G.state === 'dead') deaths++;
  }
  const tot = acts.reduce((a, b) => a + b, 0) || 1;
  const dist = acts.map((c, a) => [ACTIONS[a], c / tot]).sort((x, y) => y[1] - x[1]);
  const avgK = kills / N, top = dist[0][1];
  console.log(`\n=== A2C AUDIT (${N} eps, greedy) ===`);
  console.log(`avgScore ${(sc / N).toFixed(0)}  avgSurvival ${(st / N).toFixed(0)}  avgKills ${avgK.toFixed(2)}  maxFloor ${maxFloor}  deaths ${deaths}/${N}`);
  console.log('action mix: ' + dist.map(([a, p]) => `${a} ${(p * 100).toFixed(0)}%`).join('  '));
  const green = top < 0.75 && avgK >= 1.0 && deaths <= 12;
  console.log(green ? `🟢 GREEN: non-degenerate (top ${(top * 100).toFixed(0)}%), avgKills ${avgK.toFixed(2)} >= 1.0, deaths ${deaths}/20 <= 12 — a COMPETENT engaging adversary.`
    : `🔴 not green yet: top ${(top * 100).toFixed(0)}% (<75? ${top < 0.75}), avgKills ${avgK.toFixed(2)} (>=1? ${avgK >= 1}), deaths ${deaths}/20 (<=12? ${deaths <= 12}).`);
  return { green, avgK, top, deaths, maxFloor };
}

if (require.main === module) {
  const mode = process.argv[2] || 'train';
  if (mode === 'train') train(+process.argv[3] || 400, +process.argv[4] || 24);
  else if (mode === 'eval') audit(new Env(), deserial(JSON.parse(fs.readFileSync(path.join(__dirname, 'rlbot_a2c_policy.json'), 'utf8'))));
}
module.exports = { forward, audit, deserial };
