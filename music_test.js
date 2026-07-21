// music_test.js — the scene->track map, tested pure (RED first per /tdd).
//
// Why this file exists (2026-07-21): the operator cut prism's theme ("yuk"). music.js
// already degrades SILENTLY when an mp3 is missing, so deleting the file alone would
// have left the prism fight in dead air — a silent regression no test could have caught,
// because trackFor() had no test at all. A boss without its own theme must BORROW one.
require('./music.js');
const M = globalThis.Music;

let pass = 0, fail = 0;
function t(name, cond) { if (cond) pass++; else { fail++; console.error('FAIL: ' + name); } }

// ── bosses that still own a theme keep it
for (const id of ['leviathan', 'inquisitor', 'king', 'abbot', 'maw', 'duo']) {
  t(`${id} keeps its own theme`, M.trackFor('play', id) === 'boss_' + id);
}

// ── prism has no theme any more: it must fall back to a REAL track, never dead air
t('prism does not request its deleted theme', M.trackFor('play', 'prism') !== 'boss_prism');
t('prism borrows the judgment theme', M.trackFor('play', 'prism') === 'judgment');

// ── the general rule, so the next cut theme is covered without editing this file
t('an unknown boss borrows rather than going silent',
  M.trackFor('play', 'some_future_boss') === 'judgment');
t('the fallback is a track that exists on disk',
  ['judgment', 'explore', 'title'].includes(M.trackFor('play', 'prism')));

// ── non-boss states are untouched by the fallback
t('exploring is unchanged', M.trackFor('play', null) === 'explore');
t('descend is unchanged', M.trackFor('descend', null) === 'explore');
t('judgment state is unchanged', M.trackFor('judgment', null) === 'judgment');
t('cinema uses the cutscene track', M.trackFor('cinema', null) === 'cutscene');
t('title is the default', M.trackFor('title', null) === 'title');
t('dead is unchanged', M.trackFor('dead', null) === 'dead');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
