# DUCK SOULS — FUN.md

Falsifiable fun-hypotheses. Written BEFORE tuning (`/tdd-fun` protocol): a fun claim
without a red→green transcript is a vibe, not a result. Thresholds committed at RED and
NOT edited afterward. Method: `node fun_test.js` (structural + simulated) — every
assertion reads real constants/functions from `game.js` / `pantheon.js`, never hand-typed
numbers.

Panel that produced these: `PLAYTEST.md` (3 industry seats, 2026-07-20).

| id | claim | metric | threshold |
|----|-------|--------|-----------|
| F1 | Deaths are earned: the lunge kills you, not a shoulder-brush | share of duck contact-damage frames that are lunge-state, simulated | ≥ 0.70 |
| F2 | Every lethal threat is signalled | duck windup pulse amplitude; turret aim phase exists in real time | amp ≥ 0.4, never clamps; TURRET_AIM ≥ 0.3s, speed-invariant |
| F3 | Hitboxes match sprites | contact test at (0,±4.4) from a duck | no hit; (±4.0,0) hits |
| F4 | Reward out-juices punishment | kill hitstop vs hurt hitstop | kill ≥ 0.10 and > hurt-only value |
| F5 | The game starts fast | fresh-localStorage keypress every 0.7s → state 'play' | ≤ 3.5s |
| F6 | Combat starts fast | a hot (uncleared fight) room adjacent to start, 200 seeds | 100% of floors |
| F7 | One-more-run gravity | death → playable again after R | ≤ 200ms |
| F8 | No permanent god-mode from suicide laps | boons active after 5 floor-1 suicide laps | 0 gods |
| F9 | Depth still bites | ceil(duckHP(d) / expected max player dmg) at d ≥ 4 | ≥ 2 hits |
| F10 | Walls are walls | slash damage to an enemy behind a solid cell | 0 |
| F11 | Kiting is not strictly dominant | slash reach vs contact radius margin at depth 1 | ≤ 3.0 cells |
| F12 | Grades can't be farmed | judge(interrupts:100) vs judge(interrupts:5); aurum(tuftsCut:98) | equal; < 0.72 |

## Honest limits

This measures the load-bearing preconditions of delight — pace, fairness, readability,
stakes, non-degeneracy — not delight itself. A real human contradicting a green metric
wins; the hypothesis was wrong, and FUN.md gets fixed, not the human.

## Red → green ledger

| id | RED (2026-07-20) | GREEN | verdict |
|----|------------------|-------|---------|
| (filled by the cycle below) |
