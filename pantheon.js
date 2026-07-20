// pantheon.js — the judgment board's brain. Modelled on lotka-volterra's council
// (XCOM-style): every grade is a pure function over the run's stat log — if a god is
// angry you must be able to point at the number. No vibes, no no-ops: every boon/curse
// key here must be consumed by game.js (test.js enforces it).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Pantheon = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const clamp01 = v => clamp(v, 0, 1);

  // score 0..1 -> letter
  const BANDS = [[0.9, 'S'], [0.72, 'A'], [0.52, 'B'], [0.32, 'C'], [-1, 'F']];
  const DELTA = { S: 10, A: 7, B: 3, C: -4, F: -9 };
  const BOON_AT = 70, CURSE_AT = 25, START_FAVOR = 50;

  function letter(score) { for (const [t, L] of BANDS) if (score >= t) return L; return 'F'; }

  // floorStats contract (all counters, reset each floor):
  // { time, roomCount, kills, interrupts, dmgTaken, dashThroughs, pickups,
  //   treasureFound, idleT, depth }
  const GODS = [
    {
      id: 'velox', name: 'VELOX', title: 'God of Haste', ci: 3, glyph: '>',
      lore: 'A courier god who starved waiting at a door that never opened. Despises hesitation.',
      boon: { key: 'BOON_VELOX', desc: '+14% move speed' },
      curse: { key: 'CURSE_VELOX', desc: 'doors stay barred 2s after clear' },
      score(f) {
        const par = 18 + f.roomCount * 9; // seconds considered brisk for the floor
        return clamp01(1.15 - (f.time / par) * 0.7 - f.idleT / 12);
      },
      stat(f) { return `${f.time.toFixed(1)}s floor / ${f.idleT.toFixed(1)}s idle`; },
      lines: {
        S: 'You move like a delivery owed.', A: 'Brisk. The door stays open for you.',
        B: 'You walk. I remember walking.', C: 'You lingered. Doors close on lingerers.',
        F: 'I starved faster than you fight.',
      },
    },
    {
      id: 'pluma', name: 'PLUMA', title: 'Duck-Mother', ci: 2, glyph: '<',
      lore: 'Mother of every duck-dragon. Respects only those who face her children head-on.',
      boon: { key: 'BOON_PLUMA', desc: '+1 slash damage' },
      curse: { key: 'CURSE_PLUMA', desc: '+1 duck-dragon in every room' },
      score(f) {
        // the gun is not the beak: ranged kills count at one-third honor
        const ranged = f.rangedKills || 0;
        const melee = Math.max(0, f.kills - ranged);
        return clamp01((melee + ranged / 3) / (4 + f.roomCount * 1.5) + f.interrupts * 0.12);
      },
      stat(f) { return `${f.kills} slain (${f.rangedKills || 0} ranged) / ${f.interrupts} cut`; },
      lines: {
        S: 'My children speak your name with fear. Good.', A: 'You met the beak. I honor that.',
        B: 'Adequate slaughter.', C: 'You avoid my children. They notice.',
        F: 'Coward. I will send more of them.',
      },
    },
    {
      id: 'umbra', name: 'UMBRA', title: 'Keeper of the Untouched', ci: 8, glyph: 'o',
      lore: 'A shut-in god who has never been touched by anything. Obsessed with your skin.',
      boon: { key: 'BOON_UMBRA', desc: '+1 max HP' },
      curse: { key: 'CURSE_UMBRA', desc: 'dash cooldown +40%' },
      score(f) {
        return clamp01(1 - f.dmgTaken * 0.45 + f.dashThroughs * 0.08);
      },
      stat(f) { return `${f.dmgTaken} hits taken / ${f.dashThroughs} ghosted`; },
      lines: {
        S: 'Untouched. You understand me.', A: 'Almost pristine. Almost.',
        B: 'You were touched. I felt it from here.', C: 'You let them TOUCH you.',
        F: 'Bruised meat. Look away from me.',
      },
    },
    {
      id: 'aurum', name: 'AURUM', title: 'the Hoarder', ci: 5, glyph: '$',
      lore: 'Sold their own temple, then the congregation. Loves you only when you take.',
      boon: { key: 'BOON_AURUM', desc: 'better drops on room clear' },
      curse: { key: 'CURSE_AURUM', desc: 'no drops for you' },
      score(f) {
        return clamp01(f.pickups * 0.3 + f.treasureFound * 0.4 + (f.chestsOpened || 0) * 0.4 + (f.chaliceDelivered || 0) * 0.5);
      },
      stat(f) { return `${f.pickups} taken / ${f.chestsOpened || 0} chest / ${f.treasureFound} vault`; },
      lines: {
        S: 'Yes. Take EVERYTHING.', A: 'A healthy appetite.',
        B: 'You left things on the floor. On the FLOOR.', C: 'Poverty is a choice you keep making.',
        F: 'You took nothing. You ARE nothing.',
      },
    },
    {
      id: 'mors', name: 'MORS', title: 'the Patient', ci: 1, glyph: '+',
      lore: 'Death itself. Grades everyone eventually. Secretly wants you to come back.',
      boon: { key: 'BOON_MORS', desc: 'refuse your first death each run' },
      curse: { key: 'CURSE_MORS', desc: 'hearts heal nothing' },
      score(f) { return clamp01(f.depth / 6); },
      stat(f) { return `depth ${f.depth}`; },
      lines: {
        S: 'Deep. I will wait a little longer.', A: 'You descend well.',
        B: 'We will meet soon enough.', C: 'Shallow graves are still graves.',
        F: 'Back so soon?',
      },
    },
  ];

  function defaultFavor() {
    const f = {}; for (const g of GODS) f[g.id] = START_FAVOR; return f;
  }

  // pure: floorStats -> cards (one per god)
  function judge(f, favor) {
    return GODS.map(g => {
      const score = g.score(f);
      const L = letter(score);
      const delta = DELTA[L];
      return {
        id: g.id, name: g.name, title: g.title, ci: g.ci,
        letter: L, score, delta,
        stat: g.stat(f), line: g.lines[L],
        favorBefore: favor[g.id],
        favorAfter: clamp(favor[g.id] + delta, 0, 100),
      };
    });
  }

  function applyFavor(favor, cards) {
    const out = { ...favor };
    for (const c of cards) out[c.id] = c.favorAfter;
    return out;
  }

  const boonActive = (favor, id) => favor[id] >= BOON_AT;
  const curseActive = (favor, id) => favor[id] <= CURSE_AT;

  // run verdict title from best/worst dimensions
  const ADJ = {
    velox: ['SWIFT', 'SLOW'], pluma: ['BLOODY', 'MEEK'], umbra: ['UNTOUCHED', 'BATTERED'],
    aurum: ['GREEDY', 'EMPTY-HANDED'], mors: ['DEEP', 'SHALLOW'],
  };
  function verdict(cards, f) {
    const sorted = [...cards].sort((a, b) => b.score - a.score);
    const best = sorted[0], worst = sorted[sorted.length - 1];
    if (f && f.chaliceDelivered) return 'CHALICE BEARER';
    if (f && (f.hotdogsEaten || 0) >= 2) return 'HOTDOG PILGRIM';
    if (best.id === 'umbra' && best.letter === 'S') return 'UNTOUCHED';
    if (worst.score >= 0.72) return 'THE PANTHEON IS PLEASED';
    if (best.score < 0.32) return 'THE PANTHEON LOOKS AWAY';
    return `${ADJ[worst.id][1]} BUT ${ADJ[best.id][0]}`;
  }

  function epitaph(run, best) {
    if (run.score > best && best > 0) return `A new best. MORS files you under "promising".`;
    if (run.floors <= 1) return `MORS: "The first floor. I barely stood up."`;
    if (run.dmgTaken === 0) return `MORS: "Untouched until the end. UMBRA wept."`;
    return `MORS: "Floor ${run.floors}. ${run.kills} souls ahead of you in line."`;
  }

  // ---------- the story, told the Souls way: in fragments you earn ----------
  // Every fragment unlocks via a pure function over the lifetime ledger.
  const LORE = [
    { id: 'feathers', when: l => l.deaths >= 1, text: 'First the ducks. Then the dragons. Then no one could tell the difference.' },
    { id: 'square', when: l => l.runs >= 2, text: 'You are a square because the first shape is easiest to judge.' },
    { id: 'line', when: l => l.deaths >= 3, text: 'The line moves. MORS keeps it. You have always been in it.' },
    { id: 'twice', when: l => l.totalKills >= 25, text: 'PLUMA counts her children twice: once when they hatch, once when you come.' },
    { id: 'drowned', when: l => l.deepest >= 3, text: 'Below the third floor: the kingdom that drowned in feathers.' },
    { id: 'sixth', when: l => l.deepest >= 5, text: 'There were six gods. AURUM sold the sixth. That is why there are five.' },
    { id: 'door', when: l => (l.floor1Deaths || 0) >= 3, text: 'VELOX starved at a door. You keep dying at one. He notices the resemblance.' },
    { id: 'envy', when: l => l.bestScore >= 600, text: 'UMBRA envies you. To be touched at all -- even by teeth.' },
    { id: 'hotdog', when: l => (l.totalHotdogs || 0) >= 1, text: 'The hotdog is older than the gods. Do not ask what is inside it.' },
    { id: 'chest', when: l => (l.totalChests || 0) >= 1, text: 'The chest never wanted the key. It wanted company.' },
    { id: 'chalice', when: l => (l.totalChalices || 0) >= 1, text: 'The chalice was full once. Ask VELOX why he runs. Ask MORS who drank.' },
    { id: 'bat', when: l => (l.totalStolen || 0) >= 1, text: 'The bat serves no god. That is why it is free, and why it is hungry.' },
  ];
  function unlockedLore(l) {
    return LORE.filter(f => { try { return !!f.when(l); } catch (e) { return false; } });
  }

  return {
    GODS, judge, applyFavor, boonActive, curseActive, verdict, epitaph,
    defaultFavor, letter, DELTA, BOON_AT, CURSE_AT, START_FAVOR,
    LORE, unlockedLore,
  };
});
