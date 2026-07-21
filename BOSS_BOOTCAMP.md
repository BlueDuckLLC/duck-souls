# BOSS BOOTCAMP — train the bosses in a virtual bootcamp, bake the winner into the game

**Ask (operator, 2026-07-20):** "for each sprite run into our RL algos in virtual bootcamps
like bleeding-edge robotics AI … train bosses in there, share output and save into game, I
can see the impact." Two tiers: (1) a **local self-play bootcamp** that runs tonight on this
M1 with zero GPU and bakes a better boss into the deployed game, and (2) an **Environments-Hub
publish** so *others* can train agents against our boss.

The insight that makes this cheap: **we already own the bootcamp.** `bot.js` is a headless
scripted player that logs every fairness/flow metric; `autotune.mjs` hill-climbs `params.js`
knobs toward `funProxy` (a flow-channel objective) with every FUN.md hypothesis as a HARD
lexicographic constraint (a candidate is rejected unless `fun_test.js` stays green on the
*effective tuned params*). That is an RL loop by another name — self-play rollouts → scalar
reward → accept-if-improved-and-honest. The bosses simply aren't on the knob surface yet.

---

## TIER 1 — Boss Bootcamp v0 (LOCAL · tonight · zero GPU · green-gated)

**The gap:** `boss.js` difficulty lives in hard-coded per-form arrays, NOT in `params.js`, so
the tuner can't reach it:
- `CALM_LEN = [1.5, 1.0, 0.8]` (leviathan vulnerability window, fairness floor 0.8s)
- `MIRROR_DELAY = [0.75, 0.5, 0.35]` (inquisitor echo delay)
- `BEAM_CADENCE = [2.5, 2.0, 1.5]` (prism beam period)
- `PULL_FRAC = [0.35, 0.45, 0.5]` (maw gravity, capped ≤50% move speed)
- `TELEGRAPH_FLOOR = 0.25` (universal fairness floor — a CONSTRAINT, never a knob)

### Steps (TDD-first — the game is live-deployed; do not free-hand it)
1. **Extract** the boss arrays into `params.js` under `boss.{env,mirror,refractor,maw}` with
   DEFAULTS === today's constants (a strict no-op; `boss_test.js` must stay green byte-for-byte).
2. **Instrument** `bot.js` to fight the boss and log boss metrics: forms cleared, time-per-form,
   orbs-broken-per-window, hits taken during telegraphed vs untelegraphed windups, stagger uses.
3. **Objective** — extend `funProxy` with a boss term: reward the fight landing in a target
   band (competent bot clears form 1–2, dies-or-wins in a fair window; ≥70% of boss damage
   telegraphed) and PENALIZE both trivial (cleared untouched) and unfair (sub-floor telegraph,
   softlock). Difficulty weight already exists (`weights.difficulty = 1.5`).
4. **Constraints stay lexicographic** — `boss.js`'s own gates are the guardrails the tuner
   cannot trade away: `telegraph()` floors windups at 250ms; `canSummon`/`addsGate` prevent
   softlock; `CALM_LEN` floor 0.8s. `boss_test.js` reads the *effective tuned params* → red
   if a knob would make the boss unfair. Autonomy literally cannot cheat the fight.
5. **Run** one overnight epoch via the existing `autotune.mjs` / `com.bdl.ducksouls-autotune.plist`
   path (puppeteer, zero model tokens), commit+deploy iff improved AND green.

### Tonight's falsifier (can-fail, dated)
By **2026-07-21 AM**: the overnight epoch runs and EITHER accepts ≥1 boss-knob change that
raises the boss difficulty-band fit with `boss_test.js` + `fun_test.js` all-green, OR reports
"0 accepted — boss already in-band" with the metric printed. A green that prints no boss metric
= FAIL (the term wasn't wired). Ledger row in `AUTOTUNE_LEDGER.md`.

---

## TIER 2 — publish the fight to the Environments Hub (SHARE · follow-on · not tonight)

Wrap the DUCK SOULS boss fight as a **verifiers**-spec RL environment (Prime Intellect,
open source): observation = fight state, action = player inputs, reward = funProxy/fairness
core. Publish to the **Environments Hub** (2,500+ open envs; publishing is open/free) so other
people's agents can train against our boss — that is the "I can see the impact for others"
piece. Needs GPU/hosted training (verl/prime-rl), so it is a bounty/hosted follow-on, NOT the
local tonight loop. Env-writing API + publish flow: `verifiers` repo `AGENTS.md` + PI docs.

---

## Honest posture note (dissent on the record)
This is greenfield-ish work during the INFRA-FOCUS posture (2026-06-17→12-31) with WIP AT CAP
(6/5). Operator explicitly reframed it as the **game / professional-dev lane** ("helpful for
professional dev in existing lane") — RL-in-sim fluency is a real senior-AI-role credential,
so it also feeds the APPLY-ACT runway track, not just play. It does NOT outrank the buyer
SELL-ACT or a buyer-needed fix. **Un-override / drop the lane if** by 2026-08-01 Tier-1 has not
produced a single green boss-tune epoch (i.e., it became doc-work, not a shipped tune).
