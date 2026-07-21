// bot.js — the instrumented playtester. A competent scripted player that actually
// navigates, fights, and buys, while logging every event needed by the /tdd-fun
// behavioral hypotheses (death fairness, reward cadence, decision density, variety).
// Loaded only when ?bot=1 — never part of a human session.
(function () {
  if (!/[?&]bot=1/.test(location.search)) return;

  const L = window.__botLog = {
    sessions: 0, deaths: [], novel: [], rooms: [], choices: 0, roomsSeen: 0,
    mutsSeen: {}, itemsHeld: {}, damage: [], t0: null, events: [],
    boss: [],   // one row per boss ENCOUNTER (BF6): {id, tForm2, formsCleared, staggers, dur}
    maxDepth: 1, // deepest floor REACHED (competence gate; death-floors undercount a bot that lives)
  };
  let bossEnc = null;   // the encounter in progress
  const flushBoss = () => {
    if (!bossEnc) return;
    L.boss.push({ id: bossEnc.id, tForm2: bossEnc.tForm2, formsCleared: bossEnc.form, staggers: bossEnc.staggers, dur: +(now() - bossEnc.t0).toFixed(2), open: true });
    bossEnc = null;
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
  const clearHold = () => ['x', 'c', 'shift', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].forEach(k => hold(k, false));

  let lastRoom = null, lastHp = null, lastDepth = 0, lastLore = 0;

  function step() {
    const G = window.G;
    if (!G) return;
    if (L.t0 === null) L.t0 = now();

    // menus: get into play (skip cutscenes/gallery/intro/howto/lore)
    if (G.state === 'pool' || G.state === 'trance' || G.state === 'cinema' || G.state === 'gallery' || G.state === 'intro' || G.state === 'howto' || G.state === 'lore') { press('q'); return; }
    // TITLE is a MENU now (start/library/bestiary/credits/rules/memories) — it advances on
    // enter/space/x, NOT on 'q'. The old 'q' press was a silent no-op: the bot sat on the menu
    // forever (diagnosed 2026-07-21 at sessions=148, roomsSeen=0). menuI defaults to 0 = 'start'.
    if (G.state === 'title') { L.sessions++; press('Enter'); return; }
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
    if (G.depth > L.maxDepth) L.maxDepth = G.depth;

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

    // BOSS ENCOUNTER instrumentation (BF6). "Reaches form 2" = st.form advances 0 -> 1.
    // Timed from the first frame the boss is alive, closed when it dies or the run ends.
    if (G.boss && G.boss.st && !G.boss.st.defeated) {
      if (!bossEnc) {
        bossEnc = { id: G.boss.def.id, t0: now(), form: G.boss.st.form, tForm2: null, staggers: 0, wasStag: false };
        note('boss', G.boss.def.id);
      }
      if (G.boss.st.form > bossEnc.form) {
        bossEnc.form = G.boss.st.form;
        if (bossEnc.form >= 1 && bossEnc.tForm2 === null) bossEnc.tForm2 = +(now() - bossEnc.t0).toFixed(2);
      }
      if (G.boss.st.staggered && !bossEnc.wasStag) bossEnc.staggers++;
      bossEnc.wasStag = !!G.boss.st.staggered;
    } else if (bossEnc) { flushBoss(); }

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
      // BOSS BODIES (BF7 fix, 2026-07-21). The boss lives on G.boss, NOT in G.enemies, so a
      // body-charge hit (dive/grasp) fell through to 'offscreen/unknown, telegraphed:false' and
      // BF7 would have read a FALSE red caused by the instrument, not the game. Telegraphed is
      // read from the SAME marker the renderer draws (b.telegraphA.t > 0) — the windup the
      // player can actually see — never from boss internals the player can't.
      if (G.boss && G.boss.def) {
        const bodies = G.boss.twins ? G.boss.twins.map(t => ({ x: t.x, y: t.y })) : [{ x: G.boss.x, y: G.boss.y }];
        for (const bb of bodies) {
          const d = Math.hypot(bb.x - p.x, bb.y - p.y);
          if (d < best) {
            best = d; cause = 'boss:' + G.boss.def.id; vis = true;
            tele = !!(G.boss.telegraphA && G.boss.telegraphA.t > 0);
          }
        }
      }
      if (best > 12) { cause = 'offscreen/unknown'; vis = false; }
      // was this damage taken DURING a boss fight? (BF7 denominator)
      const inBoss = !!(G.boss && G.boss.st && !G.boss.st.defeated);
      // in PITCH DARK, was the attacker actually lit?
      if (G.cur.mut === 'DARK' && G.lightAt) vis = vis && G.lightAt(p.x, p.y) > 0.15;
      L.damage.push({ t: +(now() - L.t0).toFixed(2), cause, telegraphed: tele, onScreen: vis, mut: G.cur.mut || null, boss: inBoss });
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

    // In the armory, walk to THIS session's chosen weapon and equip it.
    // GUARD IS p.weapon, NOT p.held (2026-07-21). The game has TWO holders (game.js:1110 —
    // "one weapon slot, one artifact slot"): armory weapons land in p.weapon, artifacts in
    // p.held. Guarding on !p.held meant the condition stayed TRUE after equipping, so the bot
    // steered at the pedestal every frame FOREVER — diagnosed as 35s parked in an armory,
    // roomsSeen=1, 0 deaths, never descending. This is what actually sank the competence floor.
    if (G.cur.type === 'armory' && !p.weapon) {
      L.weapon = L.weapon || ['hammer', 'whip', 'rapier', 'boomerang', 'flail', 'sporebow'][(Math.random() * 6) | 0];
      const ped = (G.cur.items || []).find(i => i.kind === L.weapon && !i.dead);
      if (ped) { steer(p, ped); return; }
    }
    // grab loose items / piece
    const want = (G.cur.items || []).find(i => i.slot && !i.dead && !i.pedestal) || G.cur.piece;
    if (want && !G.enemies.length) { steer(p, want); return; }
    // fire the held weapon when it wants to be fired (ranged/charge weapons)
    if (p.held && G.enemies.length) {
      const wk = p.held.kind;
      if (wk === 'hammer') { if (p.chargeT > 0.9) hold('c', false); else hold('c', true); } // charge then release
      else if ((wk === 'whip' || wk === 'boomerang' || wk === 'sporebow') && Math.random() < 0.15) press('c');
    }

    // BOSS FIGHT (BF6). Non-oracle by construction: the bot reads only what the screen shows —
    // orb positions (drawn) and the telegraph marker (drawn) — never orb timers or the next
    // attack index. It dodges a visible windup, otherwise closes on the nearest orb and swings.
    if (G.boss && G.boss.st && !G.boss.st.defeated && window.Boss) {
      const B = G.boss;
      const telegraphing = !!(B.telegraphA && B.telegraphA.t > 0);
      const bodies = B.twins ? B.twins.map(t => ({ x: t.x, y: t.y, st: t.st })) : [{ x: B.x, y: B.y, st: B.st }];
      // nearest body, then its nearest orb
      let tgt = null, td = 1e9;
      for (const bb of bodies) {
        const orbs = Boss.orbPositions(bb.st.orbs, bb.x, bb.y, B.t);
        for (const o of orbs) {
          const d = Math.hypot(o.x - p.x, o.y - p.y);
          if (d < td) { td = d; tgt = o; }
        }
        const d = Math.hypot(bb.x - p.x, bb.y - p.y);
        if (!tgt && d < td) { td = d; tgt = bb; }
      }
      if (telegraphing && td < 16) {                      // visible windup + we're in range -> get out
        if (p.dashCd <= 0) hold('shift', true);
        steer(p, { x: p.x * 2 - B.x, y: p.y * 2 - B.y });
      } else if (tgt) steer(p, tgt);
      return;
    }

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

  // steer toward a target, but PATHFIND around walls (coarse 4-dir BFS on the solid grid)
  // so the bot doesn't stall on columns/buttresses — the round-2 honest-limit fix.
  let stuckAt = null, stuckT = 0, jukeUntil = 0, jukeDir = null;
  function steer(p, t) {
    const G = window.G;
    // stuck detection: if we've barely moved for ~0.6s, juke perpendicular for a bit
    if (stuckAt && Math.hypot(p.x - stuckAt.x, p.y - stuckAt.y) < 1.2) stuckT += 60; else { stuckT = 0; stuckAt = { x: p.x, y: p.y }; }
    if (stuckT > 550 && now() * 1000 > jukeUntil) { jukeUntil = now() * 1000 + 350; jukeDir = Math.random() < 0.5 ? 'x' : 'y'; stuckT = 0; }
    let tx = t.x, ty = t.y;
    if (now() * 1000 < jukeUntil) { // wiggle out of a wall pocket
      if (jukeDir === 'x') { tx = p.x + (t.x > p.x ? -12 : 12); ty = t.y; } else { ty = p.y + (t.y > p.y ? -12 : 12); tx = t.x; }
    } else {
      const nxt = bfsStep(G, p.x, p.y, t.x, t.y);
      if (nxt) { tx = nxt.x; ty = nxt.y; }
    }
    hold('arrowright', tx > p.x + 0.6); hold('arrowleft', tx < p.x - 0.6);
    hold('arrowdown', ty > p.y + 0.6); hold('arrowup', ty < p.y - 0.6);
  }

  // BFS on a coarse (2-cell) grid of the current room's solids; returns next waypoint.
  function bfsStep(G, sx, sy, gx, gy) { // two-pass: wide clearance first, then strict
    return bfsPass(G, sx, sy, gx, gy, true) || bfsPass(G, sx, sy, gx, gy, false);
  }
  // A DOOR is a 1-2 cell gap in a wall, so the 3x3-clearance test marks every cell near it as
  // blocked and the path can never go THROUGH a doorway — the bot walked to the door and stalled
  // (diagnosed 2026-07-21: moving but roomsSeen=1 over 90s, maxDepth 1). Pass 1 keeps the old
  // wall-hugging avoidance; pass 2 retries with an EXACT cell test so gaps are traversable.
  function bfsPass(G, sx, sy, gx, gy, clearance) {
    if (!G.solid) return null;
    const COLS = 160, ROWS = 90, step = 2;
    const solidAround = (x, y) => {
      if (!clearance) { const cx = x | 0, cy = y | 0; return !!(cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS && G.solid[cy * COLS + cx]); }
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const cx = (x + dx) | 0, cy = (y + dy) | 0;
        if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS) continue;
        if (G.solid[cy * COLS + cx]) return true;
      }
      return false;
    };
    const key = (x, y) => x + ',' + y;
    const start = { x: Math.round(sx / step) * step, y: Math.round(sy / step) * step };
    const goal = { x: Math.round(gx / step) * step, y: Math.round(gy / step) * step };
    const q = [start], seen = new Set([key(start.x, start.y)]), from = new Map();
    let found = null, iter = 0;
    while (q.length && iter++ < 1200) {
      const c = q.shift();
      if (Math.abs(c.x - goal.x) <= step && Math.abs(c.y - goal.y) <= step) { found = c; break; }
      for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
        const nx = c.x + dx, ny = c.y + dy, k = key(nx, ny);
        if (seen.has(k)) continue;
        if (nx < 2 || nx > 158 || ny < 6 || ny > 88) continue;
        if (solidAround(nx, ny)) continue;
        seen.add(k); from.set(k, c); q.push({ x: nx, y: ny });
      }
    }
    if (!found) return null;
    // walk back to the first step off start
    let cur = found, prev = cur;
    while (from.has(key(cur.x, cur.y))) { prev = cur; cur = from.get(key(cur.x, cur.y)); if (cur.x === start.x && cur.y === start.y) break; }
    return prev;
  }

  // prefer doors leading to rooms we haven't entered; else rotate. Door gaps sit at THIS
  // room's own edges (rooms vary in size now), so read the live bounds.
  const doorMemo = { room: null, i: 0, since: 0 };
  function doorTarget(G) {
    const dirs = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
    const x0 = G.X0 || 1, x1 = G.X1 || 158, y0 = G.Y0 || 5, y1 = G.Y1 || 88;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const pos = { n: { x: mx, y: y0 + 2 }, s: { x: mx, y: y1 - 2 }, w: { x: x0 + 2, y: my }, e: { x: x1 - 2, y: my } };
    const open = Object.keys(G.cur.doors);
    const fresh = open.filter(d => {
      const r = G.rooms.get((G.cur.gx + dirs[d][0]) + ',' + (G.cur.gy + dirs[d][1]));
      return r && !r.entered;
    });
    // COMMIT to one door (2026-07-21). This used to be `((G.t/4)|0) % n`, which re-picked the
    // target every 4s: with two open doors the bot steered west, then south, then west, hovering
    // at the centroid and never reaching either. Diagnosed as 35s parked in an armory at (70,52)
    // with doors w+s open, room cleared, 0 enemies — it survived forever and never descended,
    // which is exactly what sank the competence floor. Now: pick a door, STICK to it, and only
    // rotate if this room hasn't changed in ~6s (so a blocked door can't deadlock the run).
    const cands = fresh.length ? fresh : open;
    if (!cands.length) return { x: 80, y: 47 };
    const rk = G.cur.gx + ',' + G.cur.gy;
    if (doorMemo.room !== rk) { doorMemo.room = rk; doorMemo.i = 0; doorMemo.since = now(); }
    else if (now() - doorMemo.since > 6) { doorMemo.i = (doorMemo.i + 1) % cands.length; doorMemo.since = now(); }
    return pos[cands[doorMemo.i % cands.length]] || { x: 80, y: 47 };
  }

  window.__botStart = () => { L.t0 = now(); window.__botIv = setInterval(step, 60); };
  window.__botStop = () => { clearInterval(window.__botIv); clearHold(); flushBoss(); return L; };
})();
