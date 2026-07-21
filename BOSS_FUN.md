# BOSS_FUN.md — /tdd-fun for the DUCK SOULS boss fight (TES-7194)

Born 2026-07-20 composing `/tdd-fun` + `/night-shift` onto the boss RL bootcamp. The FUN unit
under test is the **boss fight**, not the room combat (that's FUN.md, F1–F19). Committed at RED.

**Law (inherited):** a fun claim must be a MEASURED claim. Structural hypotheses read live
constants by EXECUTING `boss.js` (`boss_fun_red.js`, not grep). Behavioral hypotheses need the
bot to actually FIGHT the boss — which `bot.js` cannot do yet — so they are UNMEASURED = RED,
never a silent pass. **Do not weaken a threshold to pass it later** (same crime as editing a
failing test).

## Hypotheses

| id | claim | metric | threshold | method |
|---|---|---|---|---|
| BF1 | Every boss windup is telegraphed | min `telegraph(base,form,enrage)` over forms×enrage | ≥ 0.25s | execute boss.js |
| BF2 | Vulnerability window never closes below a fair floor | min `envPhase().calmLen` over forms | ≥ 0.80s | execute boss.js |
| BF3 | Gravity is always out-walkable | max `\|pullVector\|` / moveSpeed | ≤ 50% | execute boss.js |
| BF4 | Summoner cannot softlock | `canSummon` at cap / early + `addsGate` when clear | no-spam & orbs-open | execute boss.js |
| BF5 | Each form earns the hit a DISTINCT way | 6 per-mechanic gates present & non-identical verdicts | present & vary | execute boss.js |
| BF6 | A competent player reaches form 2 in a FAIR window | median time-to-form-2 over boss encounters | **∈ [6.0s, 35.0s]** | **bot fights boss** |
| BF7 | ≥70% of boss damage is telegraphed IN THE FIGHT | boss-damage events w/ telegraphed flag | ≥ 0.70 | **bot fights boss** |
| BF8 | No degenerate boss cheese | exploit-seat best strategy vs intended | ≤ 15% better | **exploit seat vs boss** |
| BF9 | Depth scaling is BOUNDED (orbs can't grow forever) | `orbs(depth)` vs `orbs(depth 3)`, all depth ≤ 30 + telegraph floor holds | **≤ 2.0×** and floor ≥ 0.25s | structural (bot-independent) |

## ⚖️ Thresholds PINNED BEFORE MEASUREMENT (2026-07-21) — pre-registration

Committed *before* any bot run, so the test cannot be fitted to the result.

- **BF6 band [6.0s, 35.0s] is derived from the mechanic, not from data.** Leviathan form 1 = 3 orbs,
  and orbs are vulnerable ONLY during `calm` — `ACTIVE_LEN 2.2s + calm 1.5s = 3.7s` period with a
  1.5s vulnerable window. Breaking 3 orbs needs ≥2 calm windows ⇒ a **theoretical floor of ~7s**;
  6.0s is set just under it so a sub-mechanical clear (a cheese) trips the LOW side. Upper bound
  35s ≈ 3× the floor + slack: past that the first form is grind, not fight.
- **BF9 replaces the phrase "winnable & fair" with a number.** `depthBonus = ⌊(depth−3)/3⌋` is
  currently **UNCAPPED** — depth 12 ⇒ 2× base orbs, depth 30 ⇒ 4×, forever. The claim under test is
  that orb growth is bounded at ≤2.0×. This may legitimately go RED and stay red until the GAME
  changes (a cap), never the threshold.

## 🚧 Instrument-validity gates (a verdict is void unless these hold)

The boss-fighting bot **is the instrument**; its skill silently sets BF6/BF8. Guards:
1. **Competence floor.** If the boss-instrumented bot no longer reaches floor 3–5 on the BASE game
   (autotune's standing competence target), the *instrument* regressed — its boss verdicts are noise
   and must be reported as void, not as a game problem.
2. **Minimum sample.** A BF6/BF7/BF8 verdict requires **≥5 boss encounters** and **≥10 boss-damage
   events**. Below that ⇒ **UNMEASURED**, never PASS. (A zero-sample green is the "caps sat above
   saturation" bug: vacuously true, worthless.)
3. **No oracle bot.** The bot may not read boss internals a player can't see (exact orb timers,
   next-attack index). It reacts to the same telegraphs a human gets, or BF6 understates difficulty.

## RED transcript — 2026-07-20 (`boss_fun_red.js` → `=== 4 failed, 5 passed ===`)

| verdict | id | measured |
|---|---|---|
| 🟢 PASS | BF1 | min telegraph = **0.250s** (== floor) |
| 🟢 PASS | BF2 | min calm = **0.80s** (== floor) |
| 🟢 PASS | BF3 | max pull = **50.0%** of move speed (== cap) |
| 🟢 PASS | BF4 | spam@cap=false, earlyResummon=false, orbs-open-when-clear=true |
| 🟢 PASS | BF5 | 6 mechanic gates present, verdicts vary |
| 🔴 RED/UNMEASURED | BF6 | bot.js does not enter/fight the boss room — no time-to-form-2 metric |
| 🔴 RED/UNMEASURED | BF7 | no boss-damage event log; BF1 proves the FLOOR, not fight-time behavior |
| 🔴 RED/UNMEASURED | BF8 | no boss exploit run; dash-spam / corner-camp untested |
| 🔴 RED/UNMEASURED | BF9 | depthBonus() adds orbs (structural), but no bot run proves the deeper fight fair |

## What the RED says (the load-bearing finding)
The boss's **fairness** is provable and holds — but every floor sits **exactly at its minimum**
(0.250s / 0.80s / 50%). There is zero fairness margin: any RL/autotune knob that touches these
would breach immediately, which is correct (they must stay CONSTRAINTS, not knobs). The boss's
**fun** — is the fight in a fair difficulty band? is it telegraphed in practice? is there cheese?
— is **completely unmeasured**, because the bot never reaches the boss. You cannot certify a boss
fight is fun when nothing measures it.

## GREEN plan (the implement step = TES-7194 Tier-1, gated by these hypotheses)
1. Instrument `bot.js` to enter + fight the boss room; log forms cleared, time/form, boss-damage
   events (telegraphed flag), staggers, orbs/window.  → turns BF6/BF7 from UNMEASURED to a NUMBER.
2. Add a Bored-Player / exploit seat vs the boss (dash-spam, corner-camp, beam-only). → BF8.
3. Only THEN wire boss knobs into `params.js` and let autotune/RL tune toward the BF6 difficulty
   band — with BF1–BF5 as the lexicographic fairness constraints the tuner cannot trade away
   (`boss_fun_red.js` + `boss_test.js` re-run on the effective tuned params → red if breached).
4. Re-measure → `boss_fun_green.json`; a fresh Bored-Player refutes each green before it's claimed.

**Honest limit:** BF1–BF5 are GREEN-by-construction (they read the shipped constants) — they are
the FAIRNESS floor, not evidence the fight is FUN. Only BF6–BF9 measure fun, and they are all RED.

---

# ROUND 2 — BOSS IDENTITY & VARIETY (2026-07-21, `boss_fun_red2.js`)

**Trigger:** operator played and reported *"music? cutscenes before each boss? seems there's only
one boss?"* Two of the three premises were factually wrong — and checking them found a real bug.

| id | claim | metric | threshold | RED → GREEN |
|---|---|---|---|---|
| BF10 | Boss roster is actually varied | distinct bosses over 50 runs × 8 floors | ≥ 6 | **7/7 — was already GREEN** |
| BF11 | Which boss you fight is legible DURING the fight | boss name + FORM bar drawn by `drawHud()` (executed, stubbed) | drawn & red-capable | **RED → GREEN** |
| BF12 | Every boss is sonically distinct | `audio/boss_<id>.mp3` present per boss | 7/7 | **7/7 — already GREEN** |
| BF13 | Each boss gets a pre-fight cutscene beat | pool break + name + tagline | present | **already GREEN** |

## What was actually wrong
Not the content — the **legibility**. Seven bosses (leviathan / inquisitor / king / abbot / prism /
maw / duo), each with a distinct hit-earning mechanic and **its own music theme**, drawn randomly
every floor, each with a ~5s pool-break cutscene. But the boss's NAME appeared only as a **3-second
toast** (`msg(def.name, def.ci, 3)`) and in the cutscene. During the fight itself the HUD showed only
the player's LIFE. Seven distinct bosses, no persistent identity channel → they read as "the boss."

**Fix (`game.js` `drawHud`):** a persistent nameplate — `NAME  FORM [#>-]  ORB ***` — drawn every
frame the boss lives. Shape-first (form bar + asterisks carry the meaning), color is decoration
(daltonized law). Duo boss shows both twins (`L*** R**`); stagger shows `STAGGERED`.

## Method note — the harness fooled itself once (tdd-fun learning #2 in the wild)
BF11's first probe was a **grep** for `b.def.name`; the implementation used `bd.name`, so the test
stayed RED after a correct fix. Rather than weaken it, the probe was rewritten to **execute the real
`drawHud()`** with stubbed `A`/`G`/`P` and capture what is actually drawn, plus a control run with
`G.boss = null` proving it can go silent. **Mutation-tested:** deleting the nameplate from `game.js`
flips BF11 RED (`1 failed, 3 passed`); restoring flips it GREEN (`0 failed, 4 passed`). A green that
cannot fail was never claimed.

**Regression at GREEN:** boss_test 50/50 · test.js 254/254 · fun_test 27/27 · combat 23/23 ·
inventory 18/18 · `boss_fun_red.js` unchanged at 4 UNMEASURED (BF6–BF9 still require the bot to
fight the boss — NOT claimed as fixed).

---

# ROUND 3 — behavioral attempt (2026-07-21): instrument repaired, verdicts HONESTLY VOID

`node boss_fun_measure.mjs --sessions 6 --secs 75` → **`3 failed, 0 passed`**. BF6/BF7 are **VOID**,
not RED-the-game: the validity gates fired and refused to let a broken instrument indict the boss.

## Fixed (real instrument bugs, all bot-side)
1. **BF7 boss-blind attribution.** The boss lives on `G.boss`, NOT in `G.enemies`, so every boss
   body-charge hit logged as `offscreen/unknown, telegraphed:false`. BF7 would have read a **false
   RED caused by the instrument**. Now attributed as `boss:<id>` with `telegraphed` read from the
   same marker the renderer draws (`telegraphA.t > 0`) — never from internals a player can't see.
2. **The bot could not start the game.** Title became a MENU (`start/library/…`, advances on
   enter/space/x) in `f9e7378`; the bot still pressed `q`, a silent no-op. Diagnosed live at
   `sessions=148, roomsSeen=0, state=title`. Fixed to press Enter (menuI defaults to `start`).
3. **Encounter never flushed.** A fight still in progress at session end was dropped (one run
   logged 3 boss-damage events and 0 encounters). Now flushed on `__botStop`.
4. **Competence measured off death-floors**, which undercounts a bot that survives. Now `maxDepth`.

## ⚠ Finding that outranks the boss work: AUTOTUNE'S INSTRUMENT WAS DEAD
The title menu landed **2026-07-20** (`f9e7378`); the bot's `q` has been a no-op ever since, so a
bot session after that commit **never entered play**. The only `AUTOTUNE_LEDGER.md` epoch is dated
the same day with baseline `funProxy 0.300` and `0 accepted`. Any autotune run after that commit was
hill-climbing on sessions where the bot sat on the menu — a generator tuning against a dead grader.
*(Same-day ordering not proven from the ledger alone — verify before acting on the tune history.)*
This is the fleet's own recurring class: a meter that cannot go red / a canary fooled by
non-execution. **The fix above repairs autotune too, which is worth more than the BF6 verdict.**

## Honest state — NOT green, and not faked
| id | verdict | why |
|---|---|---|
| BF6 | **VOID** | bot reaches only floor 1 (0 deaths, maxDepth 1, 0 encounters) — fails the competence floor (3–5). Its boss verdicts are noise. |
| BF7 | **VOID** | same gate. Attribution is now *correct*, but there is no sample to judge. |
| BF8 | **UNMEASURED** | exploit seat not built. Claimed neither way. |

**Next (do NOT skip to tuning):** make the bot competent again — it survives but never descends, so
it is failing room-clear/stairs navigation, not the boss. Re-run the base-game competence check
(floor 3–5) BEFORE any boss verdict is believed. A green obtained from an incompetent bot would be
worth less than this VOID.

## ROUND 3b — bot repair continued (2026-07-21): 3 more rot layers, competence STILL not restored

The bot had **four** independent rot layers, each a silent no-op rather than an error. Each was the
game growing a feature the instrument never learned:

| # | rot | symptom | fix |
|---|---|---|---|
| 1 | title became a MENU (`f9e7378`) | `sessions=148, roomsSeen=0`, parked at title | press Enter, not `q` |
| 2 | game grew TWO holders (`p.weapon` + `p.held`, game.js:1110) | armory branch guarded `!p.held`, stayed true after equipping ⇒ steered at the pedestal **every frame forever**; 35s parked, 0 deaths | guard on `!p.weapon` |
| 3 | `doorTarget` re-picked every 4s (`((G.t/4)|0)%n`) | with 2 open doors it oscillated around the centroid, never committing | commit to a door, rotate only after ~6s of no room change |
| 4 | BFS required a clear 3×3 | a door is a 1–2 cell gap, so no path could go THROUGH a doorway | two-pass: clearance pass, then strict-cell pass |

**Result:** bot went from *cannot start the game* → starts, equips a weapon, clears rooms, fights,
and **reached a boss** (1 encounter, 12 boss-damage events captured — the BF7 attribution works).

**But competence is NOT restored:** 4 of 5 sessions still end `maxDepth 1, 0 deaths` — the bot
survives but fails to descend. `avgFloor 1.00` vs the 3–5 target ⇒ **BF6/BF7 stay VOID**. A verdict
from this instrument would be noise. Not green, and deliberately not claimed as green.

**Handoff — the remaining symptom is specific:** sessions split bimodally (either it plays properly
and dies 4×, or it never leaves floor 1 with zero deaths). That signature says a *state-specific
stall*, not slow navigation — most likely another branch that `return`s every frame on a condition
the bot can never satisfy (the same shape as rot #2). Find it by logging which branch executes on a
stalled session, exactly as rot #2 was found. Do NOT tune the boss until `avgFloor` sits in 3–5.
