// heurbot.js — a COMPETENT headless adversary (the "get to green" delivery).
// Four RL methods (ES, REINFORCE, REINFORCE+curriculum, A2C) all failed to learn combat here:
// melee trading is net-negative for a weak policy, so every learner avoids it (RL_FUN.md §10).
// The honest fix is the one the repo already uses in the browser — a SCRIPTED player (bot.js).
// This is its headless port: navigate to enemies, attack in range, dash off incoming bolts, and
// head for the exit once the room is clear. It actually engages + clears + descends, so it gives
// AUTOTUNE a real difficulty signal (max-floor of a competent player), not a passive camper.
// A few thresholds are exposed so ES/AUTOTUNE can still TUNE it — scripted skeleton, learned knobs.
//   node heurbot.js            # audit: is it GREEN (engages, kills>=1, survives)?
'use strict';
const { Env, ACTIONS } = require('./headless.js');
const A = i => ACTIONS.indexOf(i);
const IDLE = A('idle'), L = A('left'), R = A('right'), U = A('up'), D = A('down'), ATK = A('attack'), DASH = A('dash');

// obs layout (see headless.observe): 7,8,9 = nearest enemy dx,dy,dist · 16,17 = nearest bolt dx,dy
// 20..25 = boss present,form,orbs,open,dx,dy · 27 = room cleared · 28 = nEnemies · 30..33 = nav
const DEF = { engage: 0.12, dodge: 0.05, dashClose: 0.35 };
function toward(dx, dy) { return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? R : L) : (dy > 0 ? D : U); }

function policy(o, k = DEF) {
  const boltDx = o[16], boltDy = o[17], boltD = Math.hypot(boltDx || 9, boltDy || 9);
  const canDash = (o[4] || 0) <= 0 && (o[3] || 0) <= 0; // not already dashing + off cooldown
  // 1) dodge an incoming bolt
  if (boltD < k.dodge && canDash) return DASH;
  // 2) BOSS: approach + attack when close (orbs ride the boss; one swing = one orb)
  if (o[20] > 0.5) { const bx = o[24], by = o[25], bd = Math.hypot(bx, by); return bd < k.engage ? ATK : toward(bx, by); }
  // 3) ENEMIES present: close in, then trade
  if (o[28] > 0 && o[9] < 0.99) {
    const ex = o[7], ey = o[8], ed = o[9];
    if (ed < k.engage) return ATK;              // adjacent → swing (facing set by the approach)
    if (ed > k.dashClose && canDash) return DASH; // far → dash to close distance fast
    return toward(ex, ey);                       // approach
  }
  // 4) room clear → head for the exit (nav gradient toward the stairs room)
  if (o[27] > 0.5) { const ddx = o[32], ddy = o[33]; if (Math.abs(ddx) + Math.abs(ddy) > 0.01) return toward(ddx, ddy); return toward(o[30], o[31]); }
  // 5) nothing to do → drift toward stairs compass
  return toward(o[30] || 0.2, o[31] || 0);
}

function audit(N = 20, k = DEF) {
  const env = new Env(); const acts = new Array(ACTIONS.length).fill(0);
  let sc = 0, st = 0, kills = 0, maxFloor = 0, deaths = 0, cleared = 0;
  for (let i = 0; i < N; i++) {
    env.reset(7000 + i * 9); let obs = env.observe(); const seen = new Set();
    for (let t = 0; t < 1500; t++) { const a = policy(obs, k); acts[a]++; const r = env.step(a); obs = r.obs; st++; const G = env.sb.G; if (G.cur && G.cur.cleared) seen.add(G.cur.gx + ',' + G.cur.gy); if (r.done) break; }
    const G = env.sb.G; sc += env.score(); kills += (G.run && G.run.kills) || 0; maxFloor = Math.max(maxFloor, (G.run && G.run.floors) || 0); cleared += seen.size; if (G.state === 'dead') deaths++;
  }
  const tot = acts.reduce((a, b) => a + b, 0) || 1;
  const dist = acts.map((c, a) => [ACTIONS[a], c / tot]).sort((x, y) => y[1] - x[1]);
  const avgK = kills / N, top = dist[0][1];
  console.log(`=== HEURBOT AUDIT (${N} eps) ===`);
  console.log(`avgScore ${(sc / N).toFixed(0)}  avgSurvival ${(st / N).toFixed(0)}  avgKills ${avgK.toFixed(2)}  avgRoomsCleared ${(cleared / N).toFixed(1)}  maxFloor ${maxFloor}  deaths ${deaths}/${N}`);
  console.log('action mix: ' + dist.map(([a, p]) => `${a} ${(p * 100).toFixed(0)}%`).join('  '));
  const green = top < 0.75 && avgK >= 1.0 && deaths <= 12;
  console.log(green ? `🟢 GREEN — a competent, engaging adversary (top ${(top * 100).toFixed(0)}%, avgKills ${avgK.toFixed(2)}, deaths ${deaths}/20).`
    : `🔴 not green: top ${(top * 100).toFixed(0)}% · avgKills ${avgK.toFixed(2)} · deaths ${deaths}/20.`);
  return { green, avgK, top, deaths, maxFloor, cleared: cleared / N };
}

if (require.main === module) audit();
module.exports = { policy, audit, DEF };
