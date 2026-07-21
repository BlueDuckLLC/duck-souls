# METRICS.md — the articulated KPI surface of DUCK SOULS

Every number this project optimizes, grades, or reports — with its **definition, source, range,
target, weight, known defect, and fix**. Written 2026-07-21 because an automated tuner has been
hill-climbing several of these and at least four were broken.

**The law this file exists to enforce:** *a metric you cannot state precisely is a metric you
cannot trust, and a metric nothing can falsify is not a metric.* Every row below must answer
"what value would prove this wrong?"

---

## 0. The three planes (don't mix them)

| plane | question | artifacts | may it move the tuner? |
|---|---|---|---|
| **FAIRNESS constraints** | is the game honest? | `fun_test.js` (27), `boss_test.js` (50), `boss_fun_red.js` (10) | ❌ never — lexicographic gates the tuner cannot trade away |
| **FUN proxy** | is it in a flow channel? | `funProxy()` in `autotune.mjs` | ✅ this is the objective |
| **VALIDITY / liveness** | is the instrument alive? | bot log fields, competence floor | ❌ gates whether a verdict may be *published at all* |

A number from a lower plane may never be traded for one from a higher plane. Autotune's design
gets this right in principle (constraints are lexicographic, not terms) and wrong in practice
(§2.1, §2.5).

---

## 1. INSTRUMENT metrics — emitted by `bot.js` (`window.__botLog`)

These are raw; everything downstream is a function of them. Session = one headless puppeteer run.

| field | definition | type | defect |
|---|---|---|---|
| `sessions` | count of title-screen starts | int | — |
| `deaths[]` | `{t, floor, kills, cause, telegraphed, onScreen}` per death | rows | `floor` = `G.run.floors` at death |
| `maxDepth` | **deepest floor REACHED** (added 2026-07-21) | int ≥1 | the correct competence signal; was absent |
| `roomsSeen` | distinct room entries | int | **liveness canary** — `0` means the bot never played |
| `choices` | rooms offering a real decision | int | numerator of `decisionPct` |
| `novel[]` | first-time events (item/mutator/lore/room) | rows | numerator of `novelPerMin` |
| `mutsSeen{}` | distinct mutators encountered | map | numerator of `variety` |
| `damage[]` | `{t, cause, telegraphed, onScreen, mut, boss}` | rows | `boss` flag added 2026-07-21 (BF7 denominator) |
| `boss[]` | per encounter `{id, tForm2, formsCleared, staggers, dur}` | rows | added 2026-07-21 |
| `events[]` | full ordered log | rows | duration proxy = last event `t` |

---

## 2. OBJECTIVE metrics — the `funProxy` terms (`autotune.mjs`)

```
funProxy = W.hyp      × (funGreen ? 1 : 0)                       // 1.0
         + W.cadence  × min(1, novelPerMin / T.novelPerMin)       // 1.0
         + W.decision × min(1, decisionPct / 0.4)                 // 1.0
         + W.variety  × min(1, variety / 10)                      // 0.5
         − W.difficulty × diffPenalty(avgFloor, 3, 5)             // 1.5
         + 0.3        × (telegraphPct ≥ 0.7 ? 1 : 0)
```

### 2.1 `avgFloor` — 🔴 **INVERTED (the headline defect)**
- **Was:** `Σ max(...deaths.map(d ⇒ d.floor), 1) / runs` — the floor the bot **died on**.
- **Consequence:** a *deathless* session contributes **1**, and with `floorLo=3, W.difficulty=1.5`
  that earns the **maximum too-hard penalty (−3.0)**. The objective is maximized by the bot
  **dying on floors 3–5**. It rewards a corpse getting deep, not a player getting deep.
- **Fix:** use `maxDepth` (floor reached). **Falsifier:** `{deaths:[], maxDepth:4}` must score
  **strictly higher** than `{deaths:[{floor:4}], maxDepth:4}`. Before the fix it scored lower.

### 2.2 `funGreen` — 🔴 **dead weight (constant across the ranked set)**
- Boolean: `fun_test.js` all-green on the candidate params.
- It is **also the hard accept gate** (`passGate = m.funGreen && …`). Every candidate that can
  possibly be accepted has `funGreen = 1`, so `W.hyp × 1` adds the same 1.0 to every survivor.
- **Fix:** remove from the objective; keep as the gate. **Falsifier:** deleting the term must
  leave candidate *ordering* identical. If ordering changes, gate and term disagree — a worse bug.

### 2.3 `variety` — 🔴 **pays cash for content**
- Distinct mutators seen, `min(1, variety/10) × 0.5`.
- A fun objective that can **buy points by adding content** will turn the game into a pile. The
  single `ACCEPT` in the entire ledger is `mutRoll 0.65→0.73` — the machine bought more content
  because that is precisely what it was paid to do.
- **Fix:** remove the term **and** remove `mutRoll` from `KNOBS`. Variety stays a *reported*
  diagnostic, never a purchasable one.

### 2.4 `novelPerMin` — 🟡 keep, watch the denominator
- `novel.length / (duration_min)`, duration = last event `t`. Target ≥ 3/min.
- Risk: duration comes from the last logged event, so a bot that stops logging shortens the
  denominator and *inflates* the rate. **Falsifier:** rate must not rise when a session stalls.

### 2.5 `decisionPct` — 🟡 keep, but the 0.4 is unexplained
- `choices / roomsSeen`, normalized `min(1, x/0.4)` — saturates at 40%. The 0.4 has no recorded
  derivation. **Fix:** pin the constant to `FUN.md` F15 (≥40%) so one number governs both.

### 2.6 `telegraphPct` — 🟢 sound, under-weighted
- `telegraphed_damage / all_damage`, flat +0.3 if ≥ 0.7. This is the fairness signal players
  feel most, at 1/5 the weight of the difficulty term. Left as-is pending BF7 becoming measurable.

### 2.7 `deathsPerRun` — ⚪ **computed and never used**
- Verified: appears exactly once (its own definition). Dead metric.
- **Fix:** either use it or delete it. Kept as a *reported* diagnostic; not in the objective.

### 2.8 `inBand()` — ⚪ dead helper, defined and never called. Delete.

---

## 3. GATE metrics (binary, may not be traded)

| gate | rule | source |
|---|---|---|
| FUN.md hypotheses | `fun_test.js` → `=== 0 failed` on **effective tuned params** | 27 hypotheses |
| Boss fairness | `boss_test.js` 50 + `boss_fun_red.js` structural | BF1–BF5, BF9, BF14 |
| Holdout confirm | accepted candidate must also beat baseline on a **disjoint seed set** | anti-overfit |
| Noise margin | `score > baseline + 0.05` before holdout is even attempted | anti-noise |

---

## 4. VALIDITY / LIVENESS gates — 🔴 **the layer that did not exist**

Autotune published epochs while the bot sat on the title menu. Nothing checked that the
instrument was alive. These gates are preconditions on *publishing an opinion at all*:

| gate | rule | rationale |
|---|---|---|
| **liveness** | baseline `roomsSeen == 0` ⇒ **exit non-zero, write NO ledger** | an epoch that cannot see the game must not have an opinion about it |
| **competence** | baseline `maxDepth < floorLo` ⇒ refuse | a bot that can't reach the target band cannot judge the band |
| **min sample** | BF6/BF7/BF8 need ≥5 boss encounters, ≥10 boss-damage events | a zero-sample green is vacuous |
| **session budget** | ≥ 1.5× measured median time-to-floor-3 | 22s cannot contain "reach floor 3–5" if the median exceeds ~15s |

---

## 5. BEHAVIORAL hypotheses (pre-registered thresholds — see FUN.md / BOSS_FUN.md)

| id | metric | threshold | state |
|---|---|---|---|
| BF6 | median time-to-form-2 | ∈ [6.0s, 35.0s] | ⚫ VOID (instrument) |
| BF7 | telegraphed share of boss damage | ≥ 0.70 | ⚫ VOID (instrument) |
| BF8 | exploit-seat advantage | ≤ 15% | ⚪ UNMEASURED |
| BF9 | orb growth vs depth-3 | ≤ 2.0× | 🟢 2.00× |
| BF14 | \|field\| at 2× distance | ≤ 0.6× | 🔴 1.000× |
| F42 | strongest maximizer avgKills | ≥ 1.0 | 🔴 0.0 (all camped) |

---

## 6. The standing order

1. **No metric enters the objective without a falsifier written here first.**
2. **No term may pay for content count** (§2.3 is the cautionary tale).
3. **Gates are lexicographic** — never summed into the objective.
4. **Liveness before opinion** — §4 runs before any epoch publishes.
5. **A green that cannot go red is deleted, not celebrated** (BF1 was `Math.max(0.25,x) ≥ 0.25`).
