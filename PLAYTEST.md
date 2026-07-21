# DUCK SOULS — industry playtest panel, 2026-07-20

Three synthetic industry playtesters (Plan agents) studied the live build + code + an
instrumented bot session. Their verbatim findings below; each was required to attach a
measurable pass criterion (feeds FUN.md / fun_test.js — the /tdd-fun harness).

## Seat 1 — Roguelite systems designer (Hades/StS school)

1. **[H] Contact damage ignores the telegraph — deaths feel unearned.** Ducks kill at
   r+1.4 (4.6 cells) in EVERY AI state, so the windup→lunge machine isn't what kills you.
   Fix: full-radius contact only during `lunge`; other states shrink to ~r*0.55.
   Criterion: ≥70% of duck damage events occur during lunge.
2. **[H] Cold open — first 20s can be combat-free.** Start + treasure + TOLL rooms are all
   peaceful; treasure often adjacent to start. Fix: treasure room BFS dist ≥ 2 from start;
   guarantee a hot fight room adjacent. Criterion: hot room adjacent to start on 100% of
   seeds; first combat < 8s on 90%.
3. **[M] Minimap has no geometry — that's why players ping-pong.** `[#][$][=]` is a list in
   insertion order, zero adjacency. Fix: spatial mini-grid from r.gx/gy with `[?]` for
   unentered neighbors. Criterion: cleared-room re-entries ≤ 1.4× BFS-shortest path.
4. **[M] Door transitions are sticky.** Thresholds ~2.5 cells force pushing into the gap.
   Fix: thresholds to 3.5, entry spawn ±5. Criterion: holding toward an open door
   transitions ≤ 250ms from overlap, zero double-transitions.
5. **[M] TOLL fires on proximity, not intent.** Walking near a good auto-buys it; broke →
   instant THIEF combat. Fix: buy = stand on it + press C; THIEF only on broke C-press.
   Criterion: zero purchases/alarms in a pass-by playback without C.
6. **[L] Judgment board can't be mashed.** Cards land through 0.88s, SPACE gated at 0.8s.
   Fix: first SPACE snaps cards landed, second descends. Criterion: mash reaches descend
   ≤ 0.6s in ≤ 2 presses.

## Seat 2 — Game-feel / readability specialist (Vlambeer school)

1. **[H] Duck windup telegraph is half-invisible — a clamp bug.** `1.0+sin*0.3` clamps at
   alpha 1 → renders as a faint dim, not a flash. Fix: `0.55+0.45*sin(t*24)` full-depth
   pulse + a white chevron showing the ACTUAL lunge reach (auto-honest under HASTE).
2. **[H] Turrets have zero pre-fire telegraph.** Flash is set the same frame bolts spawn.
   Fix: 0.3s real-time aim phase (pulse + 4-cell aim tick) — never scaled by room speed.
3. **[M] Phantom contact hits above/below ducks.** Circular 4.6 hitbox vs an 8x6 sprite =
   1.6 cells of invisible vertical hitbox. Fix: elliptical check matching the sprite.
4. **[M] Punishment out-freezes reward.** Hurt hitstop 0.09 > kill hitstop 0.05+0. Fix:
   kill hitstop ≥ 0.11 + slash forward nudge.
5. **[M] 1-HP state is hue-only at 10px.** Fix: pulse the HP block at ~1.6Hz at hp ≤ 1;
   drop BEST from HUD row 0.
6. **[M] Cold load ~20s from URL to gameplay.** Intro stagger 2.4s/line + mandatory plant
   howto. Fix: stagger 1.4s, skip hint visible at 0.4s/alpha 0.7. Criterion: fresh
   localStorage + a keypress every 0.7s reaches play by t ≤ 3.5s.

## Seat 3 — Balance / exploit hunter (speedrunner brain)

(Also verified: the claimed 0.08s post-dash i-frame grace does not exist in code —
i-frames are only dashT > 0.)

1. **[H] Cross-run favor farming = permanent god-mode.** Floor-1 suicide laps (~60s each)
   push UMBRA/AURUM/VELOX to S grades; 2-3 laps → boons locked on forever (favor persists,
   only MORS objects). Fix: decay favor 30% toward 50 at run start + gate boons on
   reaching depth ≥ 3 that run. Invariant: 5 scripted suicide laps → no god's boon active.
2. **[H] Flat enemy HP → depth-4+ one-shot collapse.** Duck 3 / bat 1 / turret 4 HP at
   every depth; player dmg 1+swords(unbounded)+PLUMA. Fix: duck hp 3+floor(depth/2),
   turret 4+floor(depth/3), cap swords at 3. Invariant: ducks take ≥ 2 hits at depth ≥ 4
   under expected damage.
3. **[H] Slash has no line-of-sight — kill through walls.** Distance+arc only; enemy bolts
   respect walls, your sword doesn't. Fix: 3-point ray sample player→enemy blocks on
   solid. Invariant: enemy behind a solid midpoint takes 0 slash damage.
4. **[M] Backpedal kiting strictly dominant.** Reach 8.5 vs contact 4.6 + 1.5-3× speed
   edge = free hits forever outside lunges. Fix: reach → 6.0 + 0.2s of 50% move-slow
   after each slash. Invariant: kite-bot takes ≥ 1 hit per 3 rooms.
5. **[M] FOUNTAIN = HP battery + pantheon stat farm.** Heals to full every revisit; parked
   enemies heal too → infinite interrupt/dashThrough farming; idleT only counts zero-input
   (wall-wiggle beats VELOX). Fix: fountain caps 2 HP/room-visit; clamp graded interrupts
   ≤ 5, dashThroughs ≤ 6/floor; idleT from displacement not input. Invariant:
   judge(interrupts:100) === judge(interrupts:5).
6. **[L] Grass + TOLL-alarm score printers.** ~108 free score/floor from grass; deliberate
   THIEF trip = free kill wave. Fix: mote +5 → +2, AURUM tuft weight 0.03 → 0.01 (cap
   0.2), alarm kills score 0 and levy −50. Invariant: aurum(tuftsCut:98) < A-grade;
   alarm-trip net score ≤ 0.

## Seat 4 — The Bored Player (adversarial refutation, post-fix)

Ran against the 15/15 green build and broke five of it:

1. **[H] F11's metric graded a path that no longer executes.** It measured the circular
   `e.r+1.4` (non-ducks only); real duck threat is lunge travel + the lunge ellipse =
   10.25 cells vs the new 6.0 reach. "Kiting dominant" became "melee is a coin-flip you
   lose" and the metric printed +1.4 either way. → reach 7.0, lunge 3.6×0.28 → 3.0×0.22.
2. **[H] F8 passed on a grep, and the gate leaked a heart.** `newRun()` called
   `boon('umbra')` before reassigning `G.run`, so a new run inherited the old run's depth
   and started at 4 HP, silently losing it on descent. → reorder + execute the real gate
   in the test.
3. **[H] F12a/b were vacuous** — both sample points clamped at 1.00, so the caps sat above
   saturation and farming still bought a full F→S swing. → weights cut (0.12→0.04,
   0.08→0.03) so the cap binds; test now measures swing from a bare floor.
4. **[M] F12c inverted the honesty law** — the card displayed the *capped* stat, lying
   about the run to match the grade. → show both: "99 cut (5 counted)".
5. **[M] Enemy fountain regen uncapped** while the player's capped at 2/room. → both capped.
6. **[M] F5 swapped a behavioral threshold for a constant grep.** → static half kept as a
   proxy, labelled; behavioral 2.8s/3-presses measured in-browser and recorded in FUN.md.

## Seat 5 — v5 weapons/orbs/architecture balance (round 3)

1. **[H] Base slash never leaves your hand — armory is a bonus-picker, DPS band broken.**
   `slash()` (X) is always live at reach 7 regardless of held weapon; only RAPIER rewrites
   it. Every other weapon is a C-ability on a free sword. DPS: base 4.5, whip ~6.5, boom
   ~8.5, rapier 10, flail 12.5, HAMMER ~15 (no cooldown) + permastun. Fix: holding a
   weapon REPLACES the slash (each weapon owns X + its own animation). Criterion: no
   weapon's bot single-target DPS > median×1.4; clear-time variance < 1.5×.
2. **[H] FLAIL dominant AND boring** — zero-input r7 orbit, 8 DPS passive, stacks with
   sword. Fix: replaces slash, 2/0.4s (5 DPS), front-180° only. Criterion: flail's input
   rate not lowest while clear-time fastest (effort must correlate with reward).
3. **[H/M] Base HP 3→4 shipped with no behavioral re-test** — F11 threat was tuned at HP 3.
   [Operator design: 4 orbs is intentional; keep maxhp 4 but re-verify F11 still contested.]
4. **[M/H] SPORE-BOW is a consumable disguised as a signature weapon** — 8 ammo then null,
   blind-pick trap. Fix: regen 1 ammo/room cleared. Criterion: every armory weapon's
   post-100-kill DPS ≥ median×0.6.
5. **[M] AQUEDUCT/LABYRINTH geometry outruns enemy AI** — channel gaps too narrow, ducks
   soft-lock. Fix: widen gaps to 14, cap solid runs at 6. Criterion: enemy reaches player
   ≤4s, 0 permanently-unreachable rooms over 200 sims/arch.
6. **[M] Weapons disagree with walls** — hammer/whip/flail/boomerang skip `losBlocked` the
   sword respects, so they hit through maze walls. Fix: gate all weapon hits through LOS.
   Criterion: enemy behind a solid midpoint takes 0 damage from ALL six weapons (extend F10).

---

# PANEL — 2026-07-21 · two critical LENSES (operator-requested)

⚠ **These are design LENSES simulating a known critical stance. They are NOT quotations of, or
statements by, Jonathan Blow or Yoko Ono.** Persona-playtest per `/tdd-fun` step 1; every finding
carries a measurable pass criterion, as that step requires.

## LENS A — the Blow stance (mechanics must mean something; no cargo-cult; a green must be able to go red)

1. **AUTOTUNE's difficulty term is inverted.** `autotune.mjs:62` — `agg.floors += max(...deaths.map(floor), 1)` is the floor the bot **died on**, not reached; a deathless session contributes 1 and eats the maximum too-hard penalty (`floorLo:3`, `W.difficulty:1.5`). The proxy rewards *a corpse getting deep*. Also: `W.hyp` is constant across every acceptable candidate (dead weight, it's also the hard gate); `W.variety` **pays cash for mutator count** — and the only ACCEPT in ledger history is `mutRoll 0.65→0.73`, i.e. the machine bought more content because that's what it was paid for. **CRITERION:** `{deaths:[],maxDepth:4}` must score **strictly higher** than `{deaths:[{floor:4}],maxDepth:4}`; deleting `W.hyp` must leave candidate ordering identical; add a liveness deadman (exit non-zero, write no ledger, if baseline `roomsSeen==0`). **CUT** `W.variety` + `mutRoll` from KNOBS.
2. **F42 already answered the core question and was not acted on.** Four independent reward-maximizers converged to **0.0 kills** (camping). Shipped since: nameplate, orb cap, thresholds, bot repairs — nothing changing engage risk/reward. The learner code + reward fn are **not in this repo**, so the headline fun-finding is irreproducible. **CRITERION:** reward fn + learner in-repo reproducing `avgKills ≈ 0.0 ± 0.2` on the unmodified game; then after a *design* change, `avgKills ≥ 1.0` over 20 greedy episodes and camping share < 0.75. **KEEP, and freeze new nouns until the verb pays.**
3. **BF1 was a tautology.** `Math.max(0.25,x) >= 0.25` — true for every input. ✅ **VERIFIED AND FIXED** this session (see below).
4. **The "gravity vocabulary" has no gradient.** `fieldVector` renormalizes to a constant magnitude, so the field is identical at every distance — a wind, not a well; "well2"/"rotate" sum then renormalize, so the player receives one arrow and can never isolate a rule. `boss_test.js` certifies rules are "REAL" via a `toFixed(4)` string difference (any perturbation passes). **BF3 was aimed at `pullVector`, which game.js calls 0 times.** ✅ **VERIFIED AND FIXED** this session. **CRITERION (now BF14):** |field| at 2× distance ≤ 0.6× at 1×. Measured **1.000 → RED**. **CUT** `well2`/`rotate` unless they pass legibility (testers identify active rules ≥60% vs 33% chance).
5. **Boons are 9/10 scalars.** Five gods, persistent favor, a judgment cutscene — mechanical payload is eight numbers and a mulligan. The honesty law checks a key is *referenced*, not that it changes a decision. MORS doesn't grade a choice at all (`score = 0.15 + depth/5`). **CRITERION:** matched seeded sessions with/without each effect must diverge by KL ≥ 0.05 or shift a named decision rate ≥20%; target ≥7/10. Current coverage **0/10**.
6. **5 of 15 mutators are decoration.** HASTE scales both sides uniformly (fast-forward; MOLASSES earns its place *because* dash is exempt); FLICKER is render-only; LOWGRAV/RUBBER are the same knockback scalar twice; PHASE deletes the value of positioning. **CRITERION:** delete all five → F15 decision-room rate must not drop and distinct-decisions/floor stays within noise. If cutting a third costs nothing measurable, it was padding.
7. **The orb cap kept half the HP bloat.** Diagnosis was "orb count isn't difficulty"; remedy doubled it and stopped. All 7 bosses share one damage verb, so depth only changes how many times you perform an already-understood gate. **CRITERION:** `DEPTH_BONUS_CAP = 0`; median time-to-kill at depth 12 within ±25% of depth 3 while death rate at 12 is ≥1.5× that at 3. Difficulty via speed/danger/tighter windows.
8. **F13–F19 are marked GREEN on screenshots.** FUN.md's own prose says "not measured… a stronger bot is owed," four lines under a table headed GREEN — and the instrument was dead the whole period. **CRITERION:** every GREEN row carries a number + the transcript file that produced it; current GREEN-without-number **7**, target **0**.

## LENS B — the Ono / Fluxus stance (the instruction is the work; subtraction reveals it; absence is content)

1. **The tutorial is already the artwork, filed under a menu item.** `GROW_NODES` is nine instruction pieces ("be seed. be elsewhere."), each with its keybinding printed directly beneath — the poem given, then taken back by its own footnote. **INSTRUCTION:** *Write the rules as a plant would hear them. / Show only the plant's version. / Let them find out what the keys do by pressing them. / Do not translate.* **CRITERION:** keypresses to reach that screen from boot = **5**, pass **0** (it is the opening screen); `nd.key` strings rendered there = **9**, pass **0**.
2. **The piece venerates patience and mechanically forbids stillness.** Rooms open only at `enemies.length === 0`, so a pacifist descent is **impossible** — while F42 says the only strategy the machine found on its own was stillness. **INSTRUCTION:** *Make a door that opens for stillness. / Stand where everything wants to touch you. / Do not raise your hand. / Count to sixty. / The door opens. The gods grade you anyway.* **CRITERION:** pacifist floor 1→2 with zero damage dealt: currently **impossible**; pass = possible on ≥1 of 200 seeds with all five grades still issued.
3. **One silence, 0.9s long, against a glitch every 8–20s forever.** **CRITERION:** longest continuous screen with no input accepted, no instruction drawn, nothing moving = **0.0s**; pass **≥8s once per run**. **SUBTRACT** the ambient glitch timer.
4. **The absences are drawn, then captioned.** MEMORIES renders all 15 fragments, unearned ones as dots — real co-authorship — then prints `(not yet earned)` in every hole. **CRITERION:** occurrences of that string = **15**, pass **0**; remove the `N OF 15` counter so the total is unknowable until complete.
5. **Judgment with no forgiveness.** The only mercy (MORS refusing a death) is gated at favor ≥70 — available only to players who don't need it. **CRITERION:** ≥1 effect that activates at favor ≤25 and deactivates above it; currently **0**.
6. **The thesis is a becoming the player never witnesses.** "Every frame is becoming text" — yet **0 frames** show the pre-dissolve raster; the title screen *describes* the transformation instead. **INSTRUCTION:** *Show the picture. / Let one character appear. / Then another. / Do not show the picture again.* **CRITERION:** seconds/run where the raster is visible = **0.0**, pass **≥2s**.
7. **Two names, one defended.** README says the game is branded DANK SOULS; `grep` = 2 hits in README, **0 in the build**. **CRITERION:** distinct proper names across shipped text = **2**, pass **1**.

---

## ✅ Panel findings VERIFIED against code, and FIXED, same session

| claim | verification | action |
|---|---|---|
| BF1 is a tautology | `telegraph()` returns exactly 0.25 for base 0, −99, 1e9 and form 50 — **cannot fail** | **REWRITTEN** to test the floor CONSTANT + the wiring (`telegraphA = {… Boss.telegraph(`). **Mutation-proven:** floor→0.1 flips RED, restore→PASS |
| BF3 measures dead code | `grep -c` game.js: `pullVector` **0**, `fieldVector` **2** | **REPOINTED** at the live `fieldVector`; still PASS at the 50% cap |
| field has no gradient | |field| ratio at 2× distance = **1.000** at every form | **BF14 added** (threshold 0.6 pinned before measuring) → **RED**, honestly |
| autotune difficulty inverted | `agg.floors += max(...deaths.map(floor),1)` confirmed at `autotune.mjs:62` | logged; **not yet fixed** — autotune repair is its own task |

Board after the panel: `boss_fun_red.js` → **4 failed, 6 passed** (was 3f/6p with two fake greens).
Two of my own "PASS" rows were worthless. The panel was worth more than the greens it deleted.
