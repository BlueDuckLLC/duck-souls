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
