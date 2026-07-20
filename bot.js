// bot.js — the instrumented playtester. A competent scripted player that actually
// navigates, fights, and buys, while logging every event needed by the /tdd-fun
// behavioral hypotheses (death fairness, reward cadence, decision density, variety).
// Loaded only when ?bot=1 — never part of a human session.
(function () {
  if (!/[?&]bot=1/.test(location.search)) return;

  const L = window.__botLog = {
    sessions: 0, deaths: [], novel: [], rooms: [], choices: 0, roomsSeen: 0,
    mutsSeen: {}, itemsHeld: {}, damage: [], t0: null, events: [],
  };
  const seen = { muts: new Set(), items: new Set(), lore: 0, events: new Set() };
  const now = () => performance.now() / 1000;

  function note(kind, detail) {
    const t = now() - L.t0;
    L.events.push({ t: +t.toFixed(2), kind, detail });
    if (!seen.events.has(kind + ':' + detail)) {
      seen.events.add(kind + ':' + detail);
      L.novel.push({ t: +t.toFixed(2), kind, detail });
    }
  }

  const press = k => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: k }));
  };
  const hold = (k, v) => { window.keys[k] = v; };
  const clearHold = () => ['x', 'shift', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].forEach(k => hold(k, false));

  let lastRoom = null, lastHp = null, lastDepth = 0, lastLore = 0;

  function step() {
    const G = window.G;
    if (!G) return;
    if (L.t0 === null) L.t0 = now();

    // menus: get into play
    if (G.state === 'intro' || G.state === 'howto' || G.state === 'lore') { press('q'); return; }
    if (G.state === 'title') { L.sessions++; press('q'); return; }
    if (G.state === 'judgment') { press(' '); return; }
    if (G.state === 'descend') return;
    if (G.state === 'dead') {
      // WHY did we die? the last damage source, and whether it was on screen
      const last = L.damage[L.damage.length - 1];
      L.deaths.push({
        t: +(now() - L.t0).toFixed(2), floor: G.run.floors, kills: G.run.kills,
        cause: last ? last.cause : 'unknown',
        telegraphed: last ? last.telegraphed : false,
        onScreen: last ? last.onScreen : false,
      });
      note('death', 'floor' + G.run.floors);
      press('r'); return;
    }
    if (G.state !== 'play') return;

    const p = G.player;

    // ---- instrumentation ----
    if (G.cur !== lastRoom) {
      lastRoom = G.cur; L.roomsSeen++;
      const m = G.cur.mut;
      if (m) { L.mutsSeen[m] = (L.mutsSeen[m] || 0) + 1; if (!seen.muts.has(m)) { seen.muts.add(m); note('mutator', m); } }
      // a room offers a CHOICE if it has something to decide about, not just enemies
      const hasItem = (G.cur.items || []).some(i => i.slot);
      const choice = !!(G.cur.goods || G.cur.chest || G.cur.piece || hasItem || G.bat || G.hungry || G.pool ||
        (m && ['TOLL', 'FOUNTAIN', 'HUNGRY', 'ORDER', 'IRONFRONT', 'DARK'].includes(m)));
      if (choice) L.choices++;
      L.rooms.push({ t: +(now() - L.t0).toFixed(2), mut: m || null, type: G.cur.type, choice });
      if (G.cur.type === 'treasure' || G.cur.chest) note('room', G.cur.type + (G.cur.chest ? '+chest' : ''));
    }
    if (G.depth !== lastDepth) { lastDepth = G.depth; note('floor', 'depth' + G.depth); }
    const loreN = window.Pantheon.unlockedLore(G.ledger).length;
    if (loreN !== lastLore) { lastLore = loreN; if (loreN) note('lore', 'unlock' + loreN); }
    const held = p.held ? p.held.kind : null;
    if (held && !seen.items.has(held)) { seen.items.add(held); note('item', held); L.itemsHeld[held] = 1; }

    // damage forensics: what hit us, was it telegraphed, was it visible
    if (lastHp !== null && p.hp < lastHp) {
      let cause = 'unknown', tele = false, vis = false;
      let best = 1e9;
      for (const e of G.enemies) {
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < best) { best = d; cause = e.type; tele = e.state === 'lunge' || e.state === 'windup'; vis = true; }
      }
      for (const b of G.bolts) {
        const d = Math.hypot(b.x - p.x, b.y - p.y);
        if (d < best) { best = d; cause = 'bolt'; tele = true; vis = true; }
      }
      if (best > 12) { cause = 'offscreen/unknown'; vis = false; }
      // in PITCH DARK, was the attacker actually lit?
      if (G.cur.mut === 'DARK' && G.lightAt) vis = vis && G.lightAt(p.x, p.y) > 0.15;
      L.damage.push({ t: +(now() - L.t0).toFixed(2), cause, telegraphed: tele, onScreen: vis, mut: G.cur.mut || null });
    }
    lastHp = p.hp;

    // ---- the actual player ----
    clearHold();
    hold('x', true); // always swinging: grass + enemies

    // buy anything affordable (a real decision the metric counts)
    if (G.cur.goods && G.cur.goods.length) {
      const gd = G.cur.goods[0];
      const d = Math.hypot(gd.x - p.x, gd.y - p.y);
      if (d < 2.5) { press('c'); note('shop', 'buy-attempt'); }
      else { steer(p, gd); return; }
    }
    // use the held item sometimes (bombs/gun/star see real play)
    if (p.held && G.enemies.length && Math.random() < 0.03) press('c');

    // grab loose items / piece
    const want = (G.cur.items || []).find(i => i.slot && !i.dead) || G.cur.piece;
    if (want && !G.enemies.length) { steer(p, want); return; }

    // fight: dodge the lunge, close otherwise
    let e = null, bd = 1e9;
    for (const en of G.enemies) {
      if (en.telegraph > 0) continue;
      const d = Math.hypot(en.x - p.x, en.y - p.y);
      if (d < bd) { bd = d; e = en; }
    }
    if (e) {
      const dodging = e.state === 'lunge' || (e.state === 'windup' && bd < 9);
      if (dodging) {
        if (p.dashCd <= 0) hold('shift', true);
        steer(p, { x: p.x * 2 - e.x, y: p.y * 2 - e.y });
      } else steer(p, e);
      return;
    }
    // room clear: head for stairs or an unexplored door
    if (G.cur.type === 'stairs' && G.cur.cleared) { steer(p, { x: 80, y: 47 }); return; }
    steer(p, doorTarget(G));
  }

  function steer(p, t) {
    hold('arrowright', t.x > p.x + 0.6); hold('arrowleft', t.x < p.x - 0.6);
    hold('arrowdown', t.y > p.y + 0.6); hold('arrowup', t.y < p.y - 0.6);
  }

  // prefer doors leading to rooms we haven't entered; else rotate
  function doorTarget(G) {
    const dirs = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
    const pos = { n: { x: 79.5, y: 6 }, s: { x: 79.5, y: 87 }, w: { x: 2, y: 46.5 }, e: { x: 157, y: 46.5 } };
    const open = Object.keys(G.cur.doors);
    const fresh = open.filter(d => {
      const r = G.rooms.get((G.cur.gx + dirs[d][0]) + ',' + (G.cur.gy + dirs[d][1]));
      return r && !r.entered;
    });
    const pick = (fresh.length ? fresh : open)[((G.t / 4) | 0) % (fresh.length || open.length || 1)];
    return pos[pick] || { x: 80, y: 47 };
  }

  window.__botStart = () => { L.t0 = now(); window.__botIv = setInterval(step, 60); };
  window.__botStop = () => { clearInterval(window.__botIv); clearHold(); return L; };
})();
