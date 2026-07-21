// sandtype_gif.js — render TYPOGRAPHY DYNAMICS to frame data for a looping GIF.
// Node owns the simulation (the certified module); python owns the encoder. Frames are emitted
// as raw species ids so the palette lives in one place downstream.
const S = require('./sandtype.js'), fs = require('fs');
const W = 132, H = 44;

const SCENES = {
  // the word is DEPOSITED, then it slumps into a dune — type as sediment
  collapse: { text: 'DANK SOULS', species: S.SAND, ticks: 150, seed: 11, seed_extra: null },
  // stone letters, moss let in at one corner — the word greens over from that corner outward
  overgrow: { text: 'THE MAW', species: S.STONE, ticks: 200, seed: 23, mossP: 0.55,
              seed_extra: g => { S.set(g, 2, g.h - 2, S.MOSS); for (let x = 0; x < g.w; x++) S.set(g, x, g.h - 1, S.STONE); } },
  // worms let into the counters — the letterform is eaten from the inside
  // NB: letters must be SAND here, not STONE. Worms cannot chew STONE (by design — stone is the
  // world's skeleton), so the first cut of this scene had worms tunnelling through the empty air
  // AROUND the words: void 0->1003 while stone stayed at 912. The GIF looked busy and ate nothing.
  eaten:    { text: 'YOU DIED', species: S.SAND, ticks: 120, seed: 37,
              seed_extra: g => { for (let i = 0; i < 7; i++) S.set(g, 14 + i * 15, (g.h >> 1), S.WORM); } },
  // crabs walking a settled dune, endlessly redistributing — the loop that never quite repeats
  tide:     { text: 'DUCK', species: S.SAND, ticks: 180, seed: 53,
              seed_extra: g => { for (let x = 0; x < g.w; x++) S.set(g, x, g.h - 1, S.STONE);
                                 for (let i = 0; i < 5; i++) S.set(g, 12 + i * 26, g.h - 2, S.CRAB); } },
};

const out = {};
for (const [name, cfg] of Object.entries(SCENES)) {
  const g = S.typeset(W, H, cfg.text, { species: cfg.species, scale: 3, y: 6 });
  if (cfg.seed_extra) cfg.seed_extra(g);
  const frames = [];
  const state = { headings: new Map() };
  // A loop point needs QUIET consecutive ticks, not one. These species are stochastic: moss grows
  // on a probability, so a single no-change tick is normal mid-growth and reported settled@2 on a
  // run that was still visibly spreading at frame 190. settled() is right; using it once was wrong.
  const QUIET = 8;
  let cur = g, quiet = 0, settledAt = null;
  for (let i = 0; i < cfg.ticks; i++) {
    frames.push(Array.from(cur.cells));
    const nx = S.step(cur, cfg.seed + i, { state, mossP: cfg.mossP });
    quiet = S.settled(cur, nx) ? quiet + 1 : 0;
    if (settledAt === null && quiet >= QUIET) settledAt = i - QUIET + 1;
    cur = nx;
  }
  out[name] = { w: W, h: H, frames, settledAt, text: cfg.text };
  console.log(`${name.padEnd(9)} ${frames.length} frames · settled@${settledAt === null ? 'never' : settledAt}`);
}
fs.writeFileSync('art/typo/frames.json', JSON.stringify(out));
console.log('-> art/typo/frames.json');
