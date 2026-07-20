# RL_FUN — reinforcement learning & local models for the fun-loop

**Status:** DESIGN / about-to-build. Nothing in this doc has changed the game yet. The known-good
game (7 distinct bosses + 10 KIE tracks + nav + 15–30s cutscenes) is tagged
`savepoint/pre-rl-2026-07-20` and pushed. **Revert anytime:** `git reset --hard savepoint/pre-rl-2026-07-20`.

This document is the heavy write-up the operator asked for *before* the build begins, so the plan
is on the record and reversible.

---

## 0. One box

> We already run the *shape* of "RL for fun" — a headless bot plays thousands of runs and an
> optimizer tunes the game toward a fun-proxy under honesty gates. It is **not** gradient RL, and
> that is mostly correct: **fun is not a scalar reward.** The one high-value place real RL belongs
> is **replacing the scripted bot with a learned adversary** that finds the skill ceiling and the
> degenerate strategies — which sharpens the RED tests and gives an honest difficulty signal.
> Local models: a **small net is the player**; **ollama (gemma2:9b) is the judge/miner**, a role
> the fleet already seats. Humans + the refutation seat stay on top.

---

## 1. What already exists (recall before adding anything)

The repo ships a continuous fun-optimization engine. It is the RL skeleton in disguise:

```
L3  continuous op        /autotune → epoch → commit/deploy iff improved → reschedule
 └ L2  one tuning epoch   hill-climb the 12 params.js knobs for a budget; accept honesty-gated best
    └ L1  one candidate    a PARAMS config → K bot sessions on FRESH seeds → funProxy + FUN.md gate
       └ L0  one session    bot.js @ ?bot=1 → metrics (survival, telegraph%, cadence, decisions, variety)
```

| Piece | File | Role in RL terms |
|---|---|---|
| **Environment** | `game.js` (+ `boss.js`, `combat.js`) | the MDP; deterministic per seed |
| **Policy (player)** | `bot.js` | a **scripted BFS heuristic** — the weak link |
| **Reward (proxy)** | `funProxy` in `autotune.mjs` | flow-channel score: in-band difficulty + cadence/decision/variety |
| **Reward (spec + guard)** | `FUN.md` + `fun_test.js` + `/tdd-fun` | falsifiable metrics + the refutation seat that stops Goodhart |
| **Optimizer** | `autotune.mjs` (hill-climb + holdout) | black-box search over designer knobs |
| **Knobs** | `params.js` (12 knobs) | the action space of the OPTIMIZER (not the player) |
| **Compounding** | `/autotune` feature loop + `/autoresearch-grade` | mines transcripts → proposes new hypotheses/features |

**The honesty gate is lexicographic:** a candidate is accepted only if `funProxy` beats the noise
margin **AND** `fun_test` stays green **AND** the gain survives a fresh **holdout** seed set. Fairness
hypotheses (telegraph honesty, no-op guards, DPS band, outrunnable enemies) are **constraints, not
terms** — you cannot trade them for a proxy point.

So the division of labor is already clean:
- **/tdd-fun DEFINES + GUARDS the reward.** (objective spec + anti-Goodhart)
- **AUTOTUNE OPTIMIZES** designer knobs against it. (search)
- **bot.js GENERATES** the feedback. (policy rollouts)

That is ~80% of "RL for fun" **without any RL**.

---

## 2. Why not just RL the fun directly?

**Fun is not a scalar reward.** If you point gradient RL at "maximize score / depth", you get a
*tryhard that discovers cheese*, not a fun game — the classic Goodhart. AUTOTUNE.md and /tdd-fun
already encode the fix: the optimizer moves **designer knobs** (difficulty, spawn density, room
size) against a **multi-metric flow-channel proxy** under **hard fairness constraints**, and a
**refutation seat** (the Bored Player) breaks any green that measured code-shape instead of
behavior. The human outranks every green.

RL does not replace that stack. It plugs into exactly one slot inside it.

---

## 3. The one slot real RL belongs in: a learned ADVERSARY

`bot.js` is scripted (grid-BFS nav, dies shallow, undercounts variety). AUTOTUNE.md openly names
this as the biased/noisy estimator and the blocker to trustworthy unattended auto-deploy.

Replace it with a **learned agent trained to WIN** (maximize depth+score). Its value is not that it
plays "for fun" — it's that a winner:
1. **Finds the degenerate dominant strategy and the true skill ceiling automatically** → feeds
   *harsher, realistic REDs* into /tdd-fun ("no dominant strategy", "death fairness") than any
   scripted bot or human tester can.
2. **Turns the difficulty band honest** → `funProxy`'s target ("a competent player reaches floor
   3–5") becomes "a *competent learned agent* reaches floor 3–5", which is what the band always
   proxied. The difficulty signal stops being scripted-bot noise → the stated prerequisite for
   trustworthy unattended auto-deploy is met.

This is automated-playtesting RL (à la Unity ML-Agents), a **bot upgrade in the existing L0 slot** —
not a paradigm change.

---

## 4. Architecture to build (A → B → C, zero-dep)

No npm ML libraries. Everything runs local/headless. Build order de-risks: A is the foundation.

### A — `headless.js` : canvas-free sim core (foundation)
Do **not** rewrite the 4000-line `game.js`. Promote `boss_smoke.js`'s vm shim (already loads the
game with no-op canvas/Audio/Image and stepped 160k frames) into a reusable harness:
- `reset(seed)` — new run on a fixed RNG.
- `step(action, dt)` — set the `keys{}` object the game reads, call `updatePlay(dt)` **directly and
  skip all draw** (no 160×90 render loops → fast).
- `observe()` — compact numeric vector: player x/y/hp/dash, nearest-K enemies (rel-pos), boss
  form/orbs/`orbsOpen`, room exits, danger, score.
- `done()` / `score()`.
- **Action space:** 8 discrete inputs (move×4, dash, attack, use, wait) → `keys{}`.
- **Gate:** an eps/sec benchmark (must be ≫ puppeteer's ~real-time) + a determinism check (same
  seed+actions → identical trajectory). `node test.js` / `boss_test.js` stay green (A only ADDS a
  harness).

### B — `rlbot.js` : learned adversary (Evolution Strategies, pure JS)
PPO needs autodiff (heavy in zero-dep JS). Use **Evolution Strategies / cross-entropy over a tiny
MLP policy** — no gradients, embarrassingly parallel over headless episodes, ~150 lines:
- Policy: `observe()` → 1-hidden-layer MLP → action logits.
- Reward: floor depth + score (train it to WIN so it surfaces the ceiling + cheese).
- Trainer: sample N perturbed policies → each plays K seeded episodes on `headless.js` → keep the
  elite → iterate a budget → save `rlbot_policy.json`.
- Wire as an alternate player (`?bot=rl` + a node path) so **AUTOTUNE's L0 can use the learned bot**.
- **Report:** max-floor vs scripted bot + an **exploit audit** (is the elite strategy degenerate?).
  That audit IS the measurement for the "no dominant strategy" FUN hypothesis — now with a real adversary.

### C — `fun_miner.mjs` : local-model judge / miner loop
Reuse the fleet's **seated** judge — **gemma2:9b via ollama** (`JUDGE_PROVIDER=ollama`); zero API,
runs local:
- Feed run transcripts (the /tdd-fun event logs bot.js/rlbot already emit) to gemma2:9b as
  (a) a **preference/fairness judge** ("which run was more fair/readable/fun — cite an on-screen
  cause") and (b) a **hypothesis miner** ("what fun-precondition is this run's pattern missing?").
- Deposit mined conjectures through **`/autoresearch-grade`** → `hypotheses.db` (moot + adversary
  grade; only survivors surface as candidate FUN.md hypotheses).
- **Gate:** ≥1 graded, non-refuted hypothesis from REAL transcripts (never hand-typed).

This is the exact "compounding layer" AUTOTUNE.md + /tdd-fun's next-evolution note already specify.

---

## 5. How the pieces compose

```
headless.js (A)  ──►  rlbot.js (B, ES adversary)  ──►  AUTOTUNE L0  (sharper reds, honest difficulty)
      │                        │
      │                        └─►  run transcripts
      ▼                                     │
  fast episodes                             ▼
  (tests + bot + RL)              fun_miner.mjs (C, gemma2:9b)  ──►  /autoresearch-grade  ──►  new FUN.md hypotheses
```

- **A** makes B and C fast/possible.
- **B** feeds AUTOTUNE a real adversary (better reds + real difficulty band).
- **C** feeds AUTOTUNE's feature loop new, graded hypotheses.
- Everything remains gated by `fun_test` and the human refutation seat.

---

## 6. Honesty constraints (non-negotiable, inherited from /tdd-fun + lotka-volterra)

1. **A fun claim is a measured claim.** Metric + threshold + method BEFORE tuning. No metric → not claimed.
2. **Never weaken a threshold to pass.** FUN.md is committed at RED; changing it after RED is the crime.
3. **Instrument, don't introspect.** Metrics come from real transcripts, never hand-typed.
4. **Fairness is a constraint, not a term.** You cannot trade a fairness red for a proxy point.
5. **The human outranks every green.** A real playtest that contradicts a green means the hypothesis
   was wrong — fix FUN.md, not the human.
6. **RL finds exploits; it does not define fun.** Record that as a named FUN.md limit.

---

## 7. What is NOT changing

- The **game itself** — `game.js`, the 7 bosses, the music, nav, cutscenes — is untouched by A/B/C.
  This is additive infra (a faster harness, a smarter bot, a local judge).
- **main** and the bosses/music PR branch (`feat/distinct-bosses-and-scene-music`) are not touched;
  this work lives on `feat/rl-fun-autotune`.
- The **deferred nightmare cutscene** (per-boss "you are dreaming…" framing + a Pixar-frame drawn
  *through* the ASCII filter) is stashed (`git stash list`) for after a KIE credit top-up, along
  with the 3 credit-blocked boss music tracks (`audio/TASKS.json`).

---

## 8. Restore / revert

- **Restore point:** `savepoint/pre-rl-2026-07-20` (pushed). `git reset --hard savepoint/pre-rl-2026-07-20`.
- **Per-accept revert** (if AUTOTUNE bakes a bad param): `git reset --hard <the autotune-* tag before it>`.
- The deferred nightmare edit is in `git stash` (message: "WIP: nightmare cutscene (D, deferred)").

---

## 9. Verification (end state)

- **A:** determinism check passes; eps/sec ≫ puppeteer; `node test.js`/`boss_test.js` green.
- **B:** `rlbot` max-floor > scripted bot; the exploit audit prints (degenerate or not).
- **C:** ≥1 graded, non-refuted hypothesis mined from real transcripts.
- **Throughout:** `fun_test` / `test` / `boss_test` stay green; every claim carries a red→green transcript.

---

## 10. RESULTS — built + measured this session (honest)

All three phases are built, committed, and run **entirely locally** (ollama gemma2:9b, no API).

**A — `headless.js` ✅ strong.** Loads the real game under a no-op render shim; **~158,000
sim-frames/s (≈2,600× real-time)**, deterministic (same seed → identical trajectory), 30→34-dim
observation, 8 discrete actions. Directed play produces real damage/deaths/kills. `test.js` +
`boss_test.js` stay green. This is the load-bearing win — a fast, reusable environment.

**B — `rlbot.js` ⚠️ works, with an honest limit.** The ES/CEM trainer runs and the **exploit
audit is a genuinely useful tool** — it caught, in order:
1. *Survival reward → passive-flee degenerate* (94% one action, camps a corner ~1000 steps, 0
   kills). A real "no-dominant-strategy" red a scripted bot can't produce.
2. *Naive shaping → reward-hacking* (attacks *near* enemies for the dense bonus without
   committing to kills; fitness rose to 237 while real kills/floor did **not**). A textbook
   Goodhart on my own shaping — exactly what the /tdd-fun refutation seat warns about.
3. Hack-resistant reward (this session's last run) → see the final audit in git.

**The limit, stated plainly:** ES + hand-shaping produces a *passive / reward-gaming* adversary,
not a deep-descender. Descent is gated behind clearing a room (killing every enemy), and killing
is a **sparse, high-risk reward** that gradient-free ES struggles to discover. A proper **PPO with
temporal credit assignment** (or a curriculum that starts the agent adjacent to one weak enemy)
is the real fix and the recommended next step. The adversary is a working *tool* whose findings
are honest but currently more about RL-artifact than proven game defect — which is why:

**C — `fun_miner.mjs` ✅ the loop closes.** gemma2:9b reads the adversary's behavior and (a)
**judges** it ("a FUN problem… an exploit… likely level geometry or predictable enemies") and (b)
**mines** a falsifiable hypothesis (`fun_mined.json`, e.g. `F-leftward-bias` with metric +
threshold + method). Crucially the model **only proposes** — it never edits `FUN.md`.
`/autoresearch-grade` + the human gate decide. So a weak-bot artifact (the "left bias" is partly
ES convergence) would be **refuted at the grader**, which is the correct behavior, not a bug.

**What was deliberately NOT done (honesty law):** no game change was made from a weak-bot finding.
Per /tdd-fun, a bot's finding is a *candidate signal*, not ground truth; the human outranks it.
The pipeline's job is to *surface graded candidates*, and it does.

**B2 — `rlbot_pg.js` (REINFORCE, true policy gradient) — the credit-assignment test.** Built the
recommended fix: a softmax-MLP policy, analytic backprop, reward-to-go + normalized-advantage
baseline, dense attack-proximity shaping. **Result: it converges to the SAME passive local optimum**
(spams 'use' 75%, 0 kills, floor 1) as gradient-free ES. So the barrier is **not** the optimizer —
**two different RL paradigms fail identically.** The wall is *exploration under sparse reward*: to
get any positive combat signal an agent must sample a full kill→clear→descend sequence, and until
then, *not engaging* (which safely survives ~800–1200 steps) strictly dominates. A naive learner
correctly finds that safe local optimum — a clean empirical restatement of "fun is not a scalar
reward."

**Therefore the real next step is a CURRICULUM, not a fancier optimizer:** start the agent adjacent
to a single weak enemy (or reward first-blood heavily and decay it) so it *discovers* that
attacking→killing→clearing pays, then anneal toward full runs. That — plus optionally a learned
critic (A2C/PPO) once the reward is non-sparse — is what yields a *competent descender* whose
max-floor is a trustworthy difficulty signal for AUTOTUNE. Until then the adversary is a reliable
**exploit-detector** (it robustly finds passivity/positional degeneracies) but not a skill-ceiling probe.

**Bottom line delivered:** a fast local RL environment (A, 158k fps), an ES adversary + a REINFORCE
agent + an exploit-audit tool with a precisely-characterized ceiling (B/B2), and a closed
gemma2:9b judge/miner loop (C) — all local, all committed, game untouched. The honest scientific
finding — *two RL paradigms both converge to passive non-engagement because the reward is sparse* —
is itself the most useful output, and it names the exact fix (curriculum bootstrap).
