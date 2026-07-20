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

## Lineage

- **Atari Adventure (1979)** — flip-screen rooms, a literal square for a hero, and dragons
  that famously look like ducks. Studied for how to be fun in the first ten seconds.
- **Souls/roguelite** — dash i-frames, telegraphed lunges, permadeath, YOU DIED.
- **lotka-volterra** — the council/pantheon model, the vital-stats-under-every-choice rule,
  and the honesty laws.

## Run

Static files, zero dependencies. `python3 -m http.server` and open `/`. Tests: `node test.js`.
