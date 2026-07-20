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

## Red → green ledger (2026-07-20)

RED: `3/15` (transcript `fun_red.json`, committed failing at 5d6c761).
GREEN: `17/17` (`fun_green.json`) — 17 because the refutation round ADDED two hypotheses
rather than relaxing any. No threshold was edited after RED; three test *methods* were
strengthened (F1, F8, F11, F12a-c) when the Bored Player seat proved they measured code
shape instead of behavior.

| id | RED | GREEN | fix that moved it |
|----|-----|-------|-------------------|
| F1 | state-blind contact (4.6 radius in every AI state) | lunge=hit / walk-by=miss at 3.0 cells | `contactHit()` state-aware ellipse |
| F2a | pulse `1.0+0.3` — clamped to an invisible dim | base 0.55 amp 0.45, plus a chevron drawn to true lunge reach | full-depth pulse |
| F2b | none (bolts appeared unannounced) | `TURRET_AIM=0.3` real-time, speed-invariant | aim phase + tick |
| F3 | circular hitbox vs 8×6 sprite | phantom vertical hit at (0,±4.4) gone | sprite-matched ellipse |
| F4 | kill 0 vs hurt 0.09 (punishment out-froze reward) | kill 0.11 > hurt 0.09 | kill hitstop |
| F5 | 9.6s crawl before the last line | stagger 1.4s; browser: 2.8s / 3 presses to play | stagger + early skip |
| F6 | treasure/TOLL could neighbor start → cold open | hot room adjacent on every floor | BFS dist ≥ 2 for treasure + forced hot neighbor |
| F7 | (already passing) | 41ms measured | — |
| F8 | 5 suicide laps → 3 permanent boons | 0 boons on a floor-1 run | depth-3 boon gate + 30% favor decay |
| F8b | (added by refutation) | 3 boons at floor 3 — the gate is not a wall | — |
| F9 | flat HP → one-shots by depth 4 | duck 3+⌊d/2⌋, sword cap 3 | depth scaling |
| F10 | slashed through pillars | blocked behind solid, hits on clear line | `losBlocked()` 3-point ray |
| F11 | reach 8.5 vs contact 4.6 = free kiting | reach 7.0 vs threat 8.2 (d1) — contested | reach + shorter lunge |
| F12a-c | caps sat ABOVE saturation (vacuous) | farming swing ≤ 0.20 from a bare floor | weights lowered so caps bind |
| F12d | (added by refutation) | card reads "99 cut (5 counted)" | honest display of capped grading |

### Refuted and repaired

The Bored Player seat broke five greens; all were repaired rather than argued with:
reach 6.0 made melee a coin-flip (threat 10.25 vs reach 6.0) → 7.0 + shorter lunge;
`newRun()` read `boon()` before resetting `G.run`, leaking a phantom max-HP → reordered;
enemy fountain regen was uncapped while the player's was capped → both capped at 2;
MORS's `depth/6` curve left ordinary players permanently cursed (curses have no gate,
correctly) → `0.15 + depth/5` and F-delta −9 → −7.

---

# Round 2 (2026-07-20) — the BEHAVIORAL round

Round 1 was almost entirely structural (constants read from source). This round measures
real scripted-bot sessions (`bot.js`, loaded only under `?bot=1`) against the hypotheses
the skill's canon lists but round 1 never tested. Panel: the onboarding/cadence seat
(PLAYTEST.md seat 5).

| id | claim | metric (from bot sessions) | threshold |
|----|-------|---------------------------|-----------|
| F13 | Deaths are telegraphed, not bumped into | % of damage events where the attacker was in windup/lunge (or a bolt) | ≥ 70% |
| F14 | Rewards keep arriving | max gap between novel events in the first 180s | ≤ 45s |
| F15 | Rooms ask something of you | decision-rooms / rooms seen | ≥ 40% |
| F16 | The world stays surprising | distinct mutators seen by end of floor 3 | ≥ 8 |
| F17 | Mutators aren't hidden by chance | P(TOLL never appears in 5 floors), 200 seeded genFloor sims | ≤ 5% |
| F18 | The first death changes something | death screen shows MEMORIES n/15 + a literal next goal | present |
| F19 | The tutorial covers what kills you | plant nodes mention doors / stairs / swap / no-heal | 4/4 |

## RED (round 2, measured 2026-07-20, bot session)

- F13 **0%** telegraphed (the one death: `duck/no-tele/seen`) — FAIL
- F14 max gap 7.4s in a 15s session — provisional PASS, resample after fixes
- F15 60% decision rooms — PASS (small sample)
- F16 **1** distinct mutator, **80%** plain rooms — FAIL
- F17 not yet simulated — FAIL (no method)
- F18 death screen has no progress/goal — FAIL
- F19 plant tutorial mentions 0/4 — FAIL

## GREEN (round 2, 2026-07-20)

Fixes shipped; structural half re-verified 17/17. Behavioral half (bot.js) confirmed the
direction on the metrics the fixes target — full multi-session medians pending a smarter
pathfinding bot (the current bot stalls on the new column/buttress geometry, so its
distinct-mutator and cadence counts undercount a human's; visual verification of all 7
architectures + telegraphed-only damage stands in until then).

| id | RED | fix |
|----|-----|-----|
| F13 telegraphed damage | 0% | ducks damage ONLY on the announced lunge (contactHit) |
| F14 reward cadence | key/chest/tools gated past floor 1 | key+chest+2 tools from floor 1 |
| F15 decision density | 60% (thin) | 2 tools/floor + guaranteed decision-mutator room |
| F16 distinct mutators | 1 seen, 80% plain | shuffled bag, roll 0.55->0.65, no-repeat-till-exhausted |
| F17 TOLL hidden 40% | uniform-with-replacement | bag draw guarantees appearance |
| F18 second-run hook | none | death screen: MEMORIES n/15 + nearest literal goal |
| F19 tutorial debt | 0/4 mechanics taught | +4 plant nodes: doors/stairs/swap/no-heal |

Plus the operator's architecture ask, which IS the F16 variety fix: 7 room types with
distinct size+shape, vine-grown walls, living cave/garden vines.

### Honest limit recorded
The behavioral bot is a weak pathfinder; it undercounts variety/cadence on the new
geometry. The numbers above are directional, verified by construction + screenshots, not
by 10-session medians. A stronger bot is owed before claiming F14-F17 as measured greens.

## Round 5 note (boss system, 2026-07-20)

boss.js phase machine: certified red→green (9 failed → 0, build_ledger 🔒). Boss ritual +
fight verified end-to-end in-browser via the REAL hit path (slash → orb → stagger → 3 forms
→ defeat → +500/ledger/stairs). OWED: behavioral fun-hypotheses for the boss fight itself
(attack dodgeability at depth, trance skip latency, orbs-reachable-per-form) — the next
/tdd-fun round's RED set. Recorded per the honest-limits law rather than claimed.
