// music.js — scene BGM manager (UMD, zero-dep). Lazy <audio>, crossfades on scene change,
// honors the game's mute ('M'), and DEGRADES SILENTLY if a track file is missing — so the game
// runs identically with or without the generated audio. Tracks live in audio/<track>.mp3.
//
// One wiring point: game.js's frame loop calls Music.sync(G.state, bossId, dt). The state->track
// map lives here (trackFor). Autoplay is gated by browsers until a user gesture; play() rejections
// are swallowed and retried each frame, so music starts on the first keypress.
(function (root) {
  const BASE = 'audio/', VOL = 0.45, FADE = 1.2; // FADE = seconds for a full crossfade
  const cache = {};
  let curTrack = null, muted = false;

  function el(track) {
    if (cache[track]) return cache[track];
    let a;
    try { a = new Audio(BASE + track + '.mp3'); }
    catch (e) { a = { __missing: true, volume: 0, paused: true, play() {}, pause() {} }; }
    if (a.addEventListener) {
      a.loop = true; a.volume = 0; a.preload = 'none';
      a.addEventListener('error', () => { a.__missing = true; });
    }
    cache[track] = a; return a;
  }
  function tryPlay(a) { if (a.__missing || !a.play) return; try { const p = a.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }

  function trackFor(state, bossId) {
    if (state === 'play' && bossId) return 'boss_' + bossId;   // 7 boss themes
    switch (state) {
      case 'play': case 'descend': return 'explore';
      case 'judgment': return 'judgment';
      case 'pool': case 'trance': return 'trance';
      case 'dead': return 'dead';
      case 'cinema': case 'intro': case 'gallery': case 'bestiary': case 'credits': return 'cutscene';
      case 'title': case 'howto': case 'lore': default: return 'title';
    }
  }

  const Music = {
    trackFor,
    setMuted(m) { muted = !!m; if (muted) for (const k in cache) if (cache[k].pause) cache[k].pause(); },
    set(track) { if (track !== curTrack) curTrack = track; if (curTrack && !muted) tryPlay(el(curTrack)); },
    tick(dt) {
      dt = Math.min(0.05, dt || 0.016);
      for (const k in cache) {
        const a = cache[k]; if (a.__missing) continue;
        const tgt = (k === curTrack && !muted) ? VOL : 0;
        const step = dt / FADE * VOL;
        if (a.volume < tgt) a.volume = Math.min(tgt, a.volume + step);
        else if (a.volume > tgt) { a.volume = Math.max(tgt, a.volume - step); if (a.volume <= 0.001 && k !== curTrack) a.pause(); }
        if (k === curTrack && !muted && a.paused && a.volume < VOL) tryPlay(a); // retry post-gesture
      }
    },
    sync(state, bossId, dt) { this.set(trackFor(state, bossId)); this.tick(dt); },
  };
  root.Music = Music;
})(typeof window !== 'undefined' ? window : globalThis);
