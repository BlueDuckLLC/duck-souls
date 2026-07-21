# DUCK SOULS

A fast-paced ASCII roguelite judged by a pantheon. The ducks are dragons. The dragons are ducks.

**Play:** move with arrows/WASD, slash with X or SPACE, dash (i-frames) with Z or SHIFT, M mutes.
Clear the room, the doors open. Find the stairs. Descend. Die. The gods remember you.

## Every frame is ASCII

The game never draws characters directly. It draws a normal 2D scene — sprites, particles,
torchlight, screenshake, plasma — onto a tiny offscreen canvas at **1 pixel = 1 character
cell** (160x90). Each frame, every pixel becomes a glyph: **luminance picks the character**
from a density ramp (` .-':;=+*#%@`), **hue picks the color** via a 32k-entry nearest-color
LUT over an Okabe-Ito palette (colorblind-safe; color never encodes meaning without a shape
channel). Glyph density is normalized per palette color so a full-brightness vermillion pixel
is as dense as a white one. It's a live video->ASCII filter with a game running through it.

## The Pantheon

After every floor, five gods grade your run, XCOM-council style. Inherited law from the
lotka-volterra council: **every grade is a pure function over the floor's stat log** — if a
god is angry you must be able to point at the number, which is printed under the grade.

| God | Wants | Boon (favor >= 70) | Curse (favor <= 25) |
|---|---|---|---|
| VELOX, God of Haste | speed, no idling | +14% move speed | doors stay barred 2s after clear |
| PLUMA, Duck-Mother | face her children head-on | +1 slash damage | +1 duck-dragon per room |
| UMBRA, Keeper of the Untouched | take no hits, dash through danger | +1 max HP | dash cooldown +40% |
| AURUM, the Hoarder | take everything | better drops | no drops |
| MORS, the Patient | depth | refuses your first death | hearts heal nothing |

Favor persists across runs in localStorage. An advertised effect is a real effect:
`node test.js` (137 assertions) imports the real `pantheon.js` and verifies grades are
finite, monotonic, and that every boon/curse key is consumed by `game.js` — no no-op
upgrades, ever again.

## The rooms are wrong (15 ways)

Each floor, ~half the rooms roll a heuristic, announced on entry and worn in the HUD.
The original eight: LOW GRAVITY, SIDEWAYS GRAVITY, PITCH DARK (flashlight cone), BAD
WIRING, HASTE, MOLASSES (slow except dash), THE SWARM, RUBBER (walls bounce). The Zelda
seven, mined by a two-seat design team from LoZ/LttP/OoT dungeons: **IRONFRONT** (Darknut —
iron faces block frontal hits, flank with the dash), **THE WOODS** (Lost Woods — no edges,
the screen wraps toroidally), **THE ORDER** (numbered deaths; kill out of turn and the
death is refused: "no."), **PHASE** (Wizzrobe — enemies blink elsewhere behind a shimmer
telegraph), **THE HUNGRY ONE** (Like Like — it swallows your held item; cut it open within
6s), **THE FOUNTAIN** (fairy water heals whoever stands in it, ducks included), **THE
TOLL** ("it's a secret to everybody" — an old duck sells goods priced in YOUR SCORE;
touch what you can't afford and he screams THIEF). All mechanical, all no-op-guarded.

## Zelda in the bones

Cuttable **grass** in every room (slash a tuft: score motes, rarely a heart — max one
heart per floor, grass never regrows). A **heart piece** hides on every floor — four
quarters assemble into +1 max HP, twice per run at most. The **lantern dowses**: it
flickers and ticks when a secret is in the room. Score is live on the HUD because at the
TOLL it is also your wallet — AURUM grades circulation, not thrift.

## The objects want things from you

One hands slot (Atari Adventure law). C uses what you hold: GUN (6 shots — PLUMA counts
ranged kills at one-third honor), NINJA STAR (pierces, bounces twice, lies where it falls),
HOTDOG (full heal, 4s digesting slow — VELOX bills it as idle; MORS's curse makes it taste
of nothing), LANTERN (double torch + secret dowsing), BOMB (x3 — slides, sputters, levels
enemies AND pillar walls, which stay leveled; ignores IRONFRONT's iron faces; stand back
or eat 1 damage), KEY -> CHEST (cross-room delivery, AURUM's jackpot),
CHALICE (deliver it to the stairs untouched: +300 and the whole pantheon warms). And THE
BAT — Adventure's own — swoops in, steals what you hold, and flies it to another room.
Cut it down or chase it.

## The world glitches

Every frame can fail like bad tape: chroma-split broken-3D ghosts (orange/blue, never
red/green), VHS row shear, depth-pop zoom lunges, ramp scramble. Ambient on a timer,
harder when you're hit, when rooms clear, and when each god lands on the judgment board.
Floors connect through a falling character tunnel.

## You keep returning to the beginning

Death sends you back to the shrine. The beginning keeps a ledger: runs, deaths, deepest
floor, best score, your last runs — and MEMORIES ([L]): twelve cryptic fragments of the
story, each earned by a pure function over your lifetime ledger (die once, open a chest,
deliver the chalice, get robbed by the bat...). A new memory surfaces on the death screen,
typed out like a bad signal. The story is told the Souls way: sideways, in fragments,
never all at once. First visit opens with a five-line crawl. The gods remember you between
runs; so does the ledger.

## Lineage

- **Atari Adventure (1979)** — flip-screen rooms, a literal square for a hero, and dragons
  that famously look like ducks. Studied for how to be fun in the first ten seconds.
- **Souls/roguelite** — dash i-frames, telegraphed lunges, permadeath, YOU DIED.
- **lotka-volterra** — the council/pantheon model, the vital-stats-under-every-choice rule,
  and the honesty laws.

## Run

Static files, zero dependencies. `python3 -m http.server` and open `/`. Tests: `node test.js`.

## Weapons, architecture, orbs, cutscenes (v5)

**The armory.** Every run opens in a start-room ARMORY: six signature weapons on
pedestals, pick ONE (the one-hands-slot Adventure law holds). HAMMER (hold C to charge, a
growing head + rising shake, release for a stunning smash), WHIP (reach 13, wild ±28° aim,
dead zone up close), RAPIER (fast/precise/short — no cooldown gap), BOOMERANG (arcs out and
returns, hits both ways, catch to re-throw), FLAIL (a head orbits you, sweeping anything it
passes), SPORE-BOW (lobs a seed that bursts into a damaging vine patch). All findable again
on floors.

**13 room architectures**, each a distinct size and shape, drawn through the ASCII filter
and grown in from center on entry: cave, temple (Greek colonnade), crypt, cathedral, long
hall, garden, rotunda, grotto, labyrinth, aqueduct, boneyard, observatory, thornwood.
Floors are procedural — mutators and architecture drawn from shuffled bags, extra loop
edges so the same rooms recombine differently every run.

**Health is four blue orbs** orbiting you in fake-3D (they scale and brighten as they swing
to the front). Lose one → screenshake scaling with how low you are + a blue shatter. At the
last orb the screen frays with red static and the HUD orb pulses. All four gone: YOU DIED.

**The cutscene library.** A brand-new soul opens on the vine cinematic ("THE FIRST
GROWTH"). Twelve ASCII cutscenes tell the pantheon's story; watch them all from the title
via [V] — unwatched ones stay hidden as "???" until witnessed.

## The arcade (v7 stage 2) — 16 new enemies, an 80s/90s coin-op homage

Beyond the duck-dragon/bat/turret trio, a **DANGER budget** (scaling with depth) spends on a
roster of arcade-homage enemies, each a real archetype: GRUNT (Robotron horde), GHOST
(Pac scatter↔chase), HOPPER (Q*bert leaps), STRAFER (Defender passes), RIDER (Joust),
SPLITTER (Asteroids — halves on death), INFLATER (Dig Dug), DIVER (Galaga swoop), MARCHER
(Space Invaders + bombs), SPINNER (Tempest spiral), LOBBER (Missile Command arcs), WALLER
(Tron light-trail you can't touch), BUBBLER (Bubble Bobble), OTTO (Berzerk — invulnerable
herder, only avoidable), BURNER (Dragon's Lair flash-zone), and **the PRIME SLINKY** — a
segmented string-snake whose spin cadence is driven by consecutive prime numbers. Deeper
floors unlock more, faster, nastier. Every lethal move is telegraphed (F2/F13 honesty holds).

## The Legend of Zelda (1986, top-down) roster + DANK SOULS

Eight more enemies homage the first top-down Zelda: OCTOROK (wanders, spits rocks), MOBLIN
(spear chaser), TEKTITE (erratic hopping spider), GIBDO (slow mummy tank, 8 HP), ROPE
(aligned-lunge snake), LEEVER (burrows underground, heaves up near you — telegraphed),
DARKNUT (armored — frontal hits bounce off its shield, flank it with the dash), and PEAHAT
(a spinning flower, invulnerable while whirling, vulnerable only when it lands). 24 new
enemies total. The game is now branded **DANK SOULS** (the repo/URL stay duck-souls).

## The Nightmares — SEVEN bosses, each a different *verb*

The key→chest ritual yields a **POTION**; touch it and a psychedelic trance takes you — wavy
parallax glyph-drift, breathing sine-rings, the boss's name resolving out of static — then you
wake in the arena. All seven float **blue orb weakpoints** and share ONE damage verb (one swing
= one orb → the form staggers → next form; shatter all three forms to win, +500). What makes them
**different fights is not the projectiles — it's HOW you earn the hit**, and each gate is a real,
node-tested rule (no no-op mechanics). The orb renders **OPEN (blue, pulsing)** vs **CAGED (grey)**
so the gate is never invisible, and every lethal windup is floored at 250ms (`Boss.telegraph`):

- **THE FEATHER-LEVIATHAN** — *environment-changer.* The arena flips each form (wind → gravity →
  pitch-dark); orbs are vulnerable ONLY in the telegraphed **calm** between shifts. In the dark, the
  orb self-illuminates so the objective is never hidden.
- **THE CLOCKWORK INQUISITOR** — *twin / mirror AI.* A delayed clone replays your own inputs and
  carries the live orb; it's exposed only when you **desync** (move against your echo). The clone
  glows + reads DESYNC so the opening is legible.
- **THE DROWNED KING** — *fast / enrage rush.* Relentless; enrage tightens the **gap** between
  attacks, never the windup. Dodge the flurry, then punish.
- **THE BROOD-ABBOT** — *summoner.* Orbs are caged while adds live; clear them to expose the orbs
  (or greed the orbs and eat the risk). Adds spawn **reachable**, capped at 3, cooldowned, with a
  failsafe — no soft-locks. Off-screen adds get edge-arrows.
- **THE REFRACTOR** — *light lens.* It fires beams; **dash-redirect a beam into its own orbs** —
  a slash won't break them. Beams are guaranteed on a cadence so melee stays viable.
- **THE COLLAPSED MAW** — *gravity well.* A constant pull (≤50% of your move speed) drags you off
  the far-arc orbs; **dash overpowers it**, and the periodic pull-inversion is telegraphed.
- **THE GEMINI WARDENS** — *duo.* Two bodies, each its own orb set; a form advances only when
  **both** are staggered together — a lone stagger revives. Split your attention.

The phase machine + every per-mechanic gate are pure and certified (`boss.js` / `boss_test.js`),
with a headless runtime smoke (`boss_smoke.js`) driving thousands of live boss frames. The
BESTIARY (title menu) is a coin-op attract-mode roll of all enemies + the seven nightmares,
silhouetted until felled.
