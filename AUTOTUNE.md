# AUTOTUNE — the continuous fun-optimization engine

A self-driving loop that tunes DUCK SOULS toward a fun-proxy using **autoresearch × /tdd-fun**,
with the fairness/honesty hypotheses as HARD CONSTRAINTS so autonomy can't cheat. Built on the
certified test suite; runnable unattended by Fable/Claude via the `/autotune` skill.

## The loops of loops

```
L3  continuous operation        /autotune skill → epoch → commit+deploy iff improved → reschedule
 └ L2  one tuning epoch          hill-climb the knobs for a budget; accept the honesty-gated best
    └ L1  one candidate eval     a PARAMS config → K bot sessions (fresh seeds) → funProxy + FUN.md gate
       └ L0  one bot session     bot.js @ ?bot=1 → metrics (survival, telegraph%, cadence, decisions, variety)
```

- **L0/L1/L2** = `autotune.mjs` (standalone Node + puppeteer; a cron can run it with zero model
  tokens). **L3** = the `/autotune` skill (Fable/Claude driver: ships results, runs the feature
  loop, reschedules).

## The objective — funProxy (a proxy, NOT delight)

A flow-channel score: reward each FUN.md hypothesis that holds, reward reward-cadence /
decision-density / variety in-band, and **penalize distance from a target difficulty band**
(both too-easy and too-hard hurt). Target is `PARAMS.autotune.target`
(default: competent bot reaches floor 3–5, ≥3 novel events/min, ≥70% telegraphed damage).

**The honesty gate is lexicographic.** A candidate is accepted ONLY if funProxy improves past
the noise margin AND `fun_test` stays all-green AND the gain survives a fresh holdout sample.
Fairness hypotheses (telegraph honesty, no-op guards, DPS band, outrunnable enemies) are
constraints, not terms — you cannot trade them for a proxy point, because `fun_test` reads the
*effective tuned params* and goes red.

## The tunable surface (`params.js`)

12 knobs, defaults = shipped v1.0 (extraction is a strict no-op). The tuner may move:
`room.insetScale` (room SIZE), `room.mutRoll`, `spawn.dangerBase/Slope`, `spawn.densityDiv`,
`enemy.speedScale`, `combat.slashReach`, `pacing.dropChance`. Injected live via
`?params=<base64>` / `localStorage.ducksouls_params`; accepted values are baked into
`params.js` DEFAULTS (git-revertable).

## Running it

- **One epoch, standalone:** `node autotune.mjs --budget 8 --sessions 6` (exit 0 = improved &
  params.js patched; 42 = no change). `--dry` measures without writing.
- **Continuous (driver):** `/autotune` — runs an epoch, ships under the contract, reschedules
  itself (`ScheduleWakeup` 30 min). Or `/loop 30m /autotune`, or a daily `/schedule` cloud routine.
- **Revert a bad accept:** `git reset --hard <the autotune-* tag before it>`.

## The compounding layer

Every ~4th epoch the driver runs the FEATURE loop: mine the ledger + bot transcripts → propose
ONE new hypothesis/feature the metrics suggest is missing → `/tdd-fun` certify → `/autoresearch-grade`
deposit. This is what makes the engine get *smarter* (new features/room shapes), not just settle
into a local optimum.

## Honest limits (recorded, not hidden)

- The scripted bot is a weak player (grid-BFS nav, dies shallow, undercounts variety), so
  funProxy is a biased/noisy estimator on few sessions. Early accepts are reviewable
  suggestions; the prerequisite for trustworthy unattended auto-deploy is a stronger bot
  and/or higher `--sessions`. Until then, review AUTOTUNE_LEDGER.md.
- A real human playtest outranks any green (the H-findings law). Human vetoes become new hard
  constraints in FUN.md.
- funProxy measures the load-bearing preconditions of fun (pace, fairness, cadence, stakes),
  never delight itself.
