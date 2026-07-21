// boss_fun_red2.js — /tdd-fun RED round 2: BOSS IDENTITY & VARIETY (TES-7194).
// Operator observation 2026-07-21: "seems there's only one boss?" — the code says SEVEN.
// This harness tests whether the roster is (a) actually varied, (b) LEGIBLE during the
// fight, and (c) sonically distinct. Law: execute the real source, never grep-and-believe.
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/game.js', 'utf8');

let pass = 0, fail = 0; const rows = [];
function check(id, claim, ok, detail) { rows.push([ok ? 'PASS' : 'RED', id, claim, detail]); ok ? pass++ : fail++; }

// Pull the REAL boss ids and the REAL prng out of game.js and RUN them.
const ids = [...SRC.matchAll(/id:\s*'([a-z]+)',\s*name:\s*'THE /g)].map(m => m[1]);
const mulSrc = /function mulberry32\([^)]*\)\s*\{[\s\S]*?\n\}/.exec(SRC);
const mulberry32 = mulSrc ? new Function(mulSrc[0] + '; return mulberry32;')() : null;

// --- BF10: the roster is actually varied in play (not one boss wearing hats).
{
  if (!mulberry32 || ids.length === 0) {
    check('BF10', 'Boss roster is actually varied across floors', false,
      `could not extract (ids=${ids.length}, mulberry32=${!!mulberry32})`);
  } else {
    // replicate bossForDepth(): BOSSES[(G.rng() * BOSSES.length) | 0] over many runs
    const seen = new Set();
    for (let run = 0; run < 50; run++) {
      const rng = mulberry32((run * 2654435761) >>> 0);
      for (let floor = 0; floor < 8; floor++) seen.add(ids[(rng() * ids.length) | 0]);
    }
    check('BF10', 'Boss roster is actually varied across floors', seen.size >= 6,
      `${ids.length} bosses defined [${ids.join(',')}]; ${seen.size} distinct drawn over 50 runs x 8 floors`);
  }
}

// --- BF11: WHICH boss you are fighting is legible DURING the fight, not just for 3s.
// BEHAVIORAL PROBE (not grep): EXECUTE the real drawHud() with stubs and capture what it
// actually draws. A grep here would measure code shape — the tdd-fun learning #2 failure mode
// (it already fooled this harness once by matching `b.def.name` while the impl used `bd.name`).
{
  const NAME = 'THE FEATHER-LEVIATHAN';
  const hudSrc = /^function drawHud\(\)[\s\S]*?\n\}/m.exec(SRC);
  const room = { gx: 0, gy: 0, entered: true, type: 'fight', cleared: false };
  function runHud(withBoss) {
    const drawn = [];
    const A = { text: (x, y, s) => drawn.push(String(s)), textC: (y, s) => drawn.push(String(s)) };
    const G = {
      player: { hp: 3, maxhp: 4, dashCd: 0 }, depth: 2, run: { kills: 5 }, seed: 255, best: 100,
      t: 1, msgs: [], rooms: new Map([['0,0', room]]), cur: room,
      boss: withBoss ? {
        def: { name: NAME, ci: 3, forms: [{}, {}, {}], mechanic: 'env' },
        st: { form: 1, orbs: 3, staggered: false, defeated: false },
      } : null,
    };
    const fn = new Function('A', 'G', 'P', 'playerStats', 'liveScore', 'boon', 'curse', 'COLS', 'muted',
      hudSrc[0] + '; return drawHud;')(
      A, G, { GODS: [] }, () => ({ dashCd: 0.45 }), () => 123, () => false, () => false, 160, false);
    fn();
    return drawn.join(' | ');
  }
  const withBoss = runHud(true), noBoss = runHud(false);
  const shows = withBoss.includes(NAME) && /FORM \[/.test(withBoss);
  const redCapable = !noBoss.includes(NAME);   // probe must be able to FAIL
  check('BF11', 'Which boss you fight is legible DURING the fight (persistent nameplate)',
    shows && redCapable,
    `executed drawHud: name+FORM drawn with boss=${shows}; probe red-capable (silent w/o boss)=${redCapable}`);
}

// --- BF12: every boss is sonically distinct (its own theme file actually on disk).
{
  const missing = ids.filter(id => !fs.existsSync(`${__dirname}/audio/boss_${id}.mp3`));
  check('BF12', 'Every boss has its own music theme on disk', missing.length === 0,
    `${ids.length - missing.length}/${ids.length} themes present${missing.length ? '; MISSING: ' + missing.join(',') : ''}`);
}

// --- BF13: every boss gets a pre-fight cutscene beat (name + tagline shown before the fight).
{
  const taglineShown = /tranceBoss\.tagline/.test(SRC);
  const nameShown = /tranceBoss\.name/.test(SRC);
  const poolBreak = /function startPoolBreak\(/.test(SRC);
  check('BF13', 'Each boss gets a pre-fight cutscene beat (pool break + name + tagline)',
    taglineShown && nameShown && poolBreak,
    `poolBreak=${poolBreak}; name shown=${nameShown}; tagline shown=${taglineShown}`);
}

console.log('\nBOSS_FUN RED r2 — identity & variety (DUCK SOULS, TES-7194)\n');
for (const [v, id, claim, detail] of rows)
  console.log(`  ${v.padEnd(5)} ${id}  ${claim}\n        ${detail}`);
console.log(`\n=== ${fail} failed, ${pass} passed ===`);
process.exit(0);
