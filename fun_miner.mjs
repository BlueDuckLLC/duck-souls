// fun_miner.mjs — the local-model judge/miner (Phase C of RL_FUN.md).
// Reads the LEARNED adversary's behavior (from rlbot's exploit audit) and asks a LOCAL model
// (gemma2:9b via ollama, zero API) two things:
//   (1) JUDGE: is what the agent found a fairness/fun problem, and what on-screen cause?
//   (2) MINE: propose ONE new falsifiable FUN.md hypothesis {id, claim, metric, threshold, method}.
// Output → fun_mined.json, ready to deposit via /autoresearch-grade (moot+adversary grade before
// it can ever become a real FUN hypothesis). The model NEVER edits FUN.md directly — it proposes;
// the grader + the human gate. This is the exact compounding loop AUTOTUNE.md + /tdd-fun specify.
//
//   node fun_miner.mjs            # audit current rlbot policy → judge + mine → fun_mined.json
//   node fun_miner.mjs "<summary>"# mine from a hand-supplied behavior summary
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const OLLAMA = process.env.OLLAMA_HOST || 'http://localhost:11434';
const MODEL = process.env.FUN_MINER_MODEL || 'gemma2:9b'; // seated judge; <=9b (14b wedges 16GB box)

async function ask(prompt, { system = '', json = false } = {}) {
  const body = { model: MODEL, prompt, system, stream: false, options: { temperature: 0.4 } };
  if (json) body.format = 'json';
  const res = await fetch(`${OLLAMA}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`ollama ${res.status}`);
  const d = await res.json();
  return d.response || '';
}

// Build a behavior summary by auditing the current adversary (or fall back to a random policy).
function behaviorSummary() {
  const { Env } = require('./headless.js');
  const rl = require('./rlbot.js');
  const env = new Env();
  let theta = null;
  try { const P = JSON.parse(fs.readFileSync('./rlbot_policy.json', 'utf8')); if (P.theta && P.theta.length === rl.NP) theta = Float64Array.from(P.theta); } catch (e) {}
  const policy = theta ? (obs => rl._forward(theta, obs)) : (() => (Math.random() * rl.ACT) | 0);
  const acts = new Array(rl.ACT).fill(0); let sc = 0, st = 0, kills = 0, floors = 0, deaths = 0; const N = 16;
  const A = require('./headless.js').ACTIONS;
  for (let i = 0; i < N; i++) { const r = rl.rollout(env, policy, 6000 + i * 13, 1000); for (let a = 0; a < rl.ACT; a++) acts[a] += r.acts[a]; sc += r.score; st += r.steps; kills += r.kills; floors = Math.max(floors, r.floors); if (env.sb.G.state === 'dead') deaths++; }
  const tot = acts.reduce((a, b) => a + b, 0) || 1;
  const mix = acts.map((c, a) => `${A[a]} ${(100 * c / tot).toFixed(0)}%`).join(', ');
  const top = acts.map((c, a) => [A[a], c / tot]).sort((x, y) => y[1] - x[1])[0];
  return {
    trained: !!theta,
    text: `A reward-maximizing agent (trained by evolution strategies to descend + kill + survive) was run for ${N} episodes on DUCK SOULS, a fast ASCII roguelite. Observed behavior: avg score ${(sc / N).toFixed(0)}, avg survival ${(st / N).toFixed(0)} steps, avg kills ${(kills / N).toFixed(1)}, deepest floor ${floors}, died in ${deaths}/${N} runs. Action mix: ${mix}. The single most-used action is '${top[0]}' at ${(100 * top[1]).toFixed(0)}%.`,
    degenerate: top[1] > 0.6, top: top[0], topPct: +(top[1] * 100).toFixed(0), avgKills: +(kills / N).toFixed(1), maxFloor: floors,
  };
}

const HYP_SCHEMA = `A FUN hypothesis is JSON: {"id":"F-kebab-case","claim":"one sentence a designer can agree/disagree with","metric":"what to measure","threshold":"a number + comparator, e.g. '>=30%' or '<400ms'","method":"how to measure it headlessly (bot/rlbot trace, code constant, etc.)"}. It must be FALSIFIABLE (a bot run could make it fail) and about a load-bearing precondition of fun (pace, fairness, readability, cadence, stakes, meaningful choice, no dominant strategy).`;

async function main() {
  const supplied = process.argv[2];
  const bs = supplied ? { text: supplied, degenerate: false } : behaviorSummary();
  console.log('— behavior —\n' + bs.text + '\n');

  const judge = await ask(
    `${bs.text}\n\nAs a game-design fairness judge: is this behavior a FUN or FAIRNESS problem for a roguelite (where the player must fight to progress)? Answer in 2-3 sentences and name the likely on-screen CAUSE.`,
    { system: 'You are a terse, senior roguelite designer. No preamble.' });
  console.log('— gemma2:9b JUDGE —\n' + judge.trim() + '\n');

  let mined = null;
  for (let attempt = 0; attempt < 2 && !mined; attempt++) {
    const raw = await ask(
      `${bs.text}\n\n${HYP_SCHEMA}\n\nPropose exactly ONE new FUN hypothesis (as strict JSON, no markdown) that this agent's behavior suggests the game is MISSING. Prefer the 'no dominant strategy' or 'engaging beats fleeing' family if the agent is one-action dominant.`,
      { system: 'You output only strict JSON. No prose, no code fences.', json: true });
    try { const o = JSON.parse(raw); if (o && o.claim && o.metric) mined = o; } catch (e) { if (attempt === 1) console.error('parse failed:', raw.slice(0, 200)); }
  }
  console.log('— gemma2:9b MINED HYPOTHESIS —\n' + JSON.stringify(mined, null, 2) + '\n');

  const out = { generatedBy: MODEL, ts_note: 'stamp when depositing', behavior: bs.text, degenerate: !!bs.degenerate, judge: judge.trim(), hypothesis: mined, next: 'deposit via /autoresearch-grade (moot+adversary grade) before it can enter FUN.md' };
  fs.writeFileSync('./fun_mined.json', JSON.stringify(out, null, 2));
  console.log('saved fun_mined.json → deposit via /autoresearch-grade; grader + human gate before FUN.md.');
}
main().catch(e => { console.error('fun_miner failed:', e.message); process.exit(1); });
