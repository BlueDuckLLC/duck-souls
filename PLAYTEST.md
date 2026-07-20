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
