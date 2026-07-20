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

## The rooms are wrong

Each floor, ~half the rooms roll a heuristic, announced on entry and worn in the HUD:
LOW GRAVITY (inertial drift, floating knockback), SIDEWAYS GRAVITY (the room pulls — watch
the motes), PITCH DARK (tiny torch + a flashlight cone; the unseen render as faint static,
but telegraphs stay honest), BAD WIRING (the lights brown out), HASTE (everything 1.4x),
MOLASSES (everything 0.7x except dash — dash is king), THE SWARM (2x enemies, half HP),
RUBBER (knockback tripled, walls bounce). All mechanical, all covered by the no-op guard.

## The objects want things from you

One hands slot (Atari Adventure law). C uses what you hold: GUN (6 shots — PLUMA counts
ranged kills at one-third honor), NINJA STAR (pierces, bounces twice, lies where it falls),
HOTDOG (full heal, 4s digesting slow — VELOX bills it as idle; MORS's curse makes it taste
of nothing), LANTERN (double torch), KEY -> CHEST (cross-room delivery, AURUM's jackpot),
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
