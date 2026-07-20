// params.js — the tunable surface. ONE source of the knobs the AUTOTUNE engine sweeps.
// Defaults reproduce the shipped v1.0 constants EXACTLY (extraction is a no-op; behavior
// only changes when the tuner moves a value). The game reads PARAMS.*; the tuner injects a
// candidate via ?params=<base64-json> or localStorage 'ducksouls_params' (deep-merged).
(function (root) {
  const DEFAULTS = {
    room: {
      insetScale: 1.0,      // multiplies every architecture's inset (>1 = smaller rooms)
      countFloor1_3: 3,     // rooms on floors 1-3 (start -> minions -> boss)
      countFloor4up: 4,     // rooms from depth 4
      mutRoll: 0.65,        // chance a fight/stairs room rolls a mutator
    },
    spawn: {
      dangerBase: 2,        // DANGER budget base
      dangerSlope: 1.4,     // + per depth
      densityDiv: 260,      // free-cells per enemy cap (higher = fewer)
      duckBase: 1,          // base duck count coefficient
    },
    enemy: {
      speedScale: 0.05,     // enemy speed growth per depth
      hpDivDuck: 2,         // duck hp = 3 + floor(depth/hpDivDuck)
    },
    combat: {
      slashReach: 7.0,
      lungeMult: 3.0,
      lungeTime: 0.22,
      dashCd: 0.45,
      dashTime: 0.13,       // i-frame window
    },
    pacing: {
      grassHeartChance: 0.08,  // roll < this (after 0.22 grass tuft) drops a heart cap 1/floor
      dropChance: 0.22,        // room-clear drop chance
    },
    // the tuner's own config (objective + autonomy)
    autotune: {
      autoDeploy: true,        // false => propose-only (commit to branch, no prod deploy)
      target: { floorLo: 3, floorHi: 5, novelPerMin: 3, telegraphPct: 0.7 },
      weights: { hyp: 1.0, cadence: 1.0, decision: 1.0, variety: 0.5, difficulty: 1.5 },
      sessions: 6, epochBudget: 8, noiseMargin: 0.05,
    },
  };

  function deepMerge(a, b) {
    const o = Array.isArray(a) ? a.slice() : { ...a };
    for (const k in b) o[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) ? deepMerge(a[k] || {}, b[k]) : b[k];
    return o;
  }
  // override precedence: ?params=<base64> then localStorage
  let override = null;
  try {
    if (typeof location !== 'undefined') {
      const m = /[?&]params=([^&]+)/.exec(location.search);
      if (m) override = JSON.parse(atob(decodeURIComponent(m[1])));
    }
    if (!override && typeof localStorage !== 'undefined') {
      const ls = localStorage.getItem('ducksouls_params');
      if (ls) override = JSON.parse(ls);
    }
  } catch (e) { override = null; }

  const PARAMS = override ? deepMerge(DEFAULTS, override) : DEFAULTS;
  PARAMS.DEFAULTS = DEFAULTS;
  if (typeof module !== 'undefined' && module.exports) module.exports = PARAMS;
  else root.PARAMS = PARAMS;
})(typeof window !== 'undefined' ? window : globalThis);
