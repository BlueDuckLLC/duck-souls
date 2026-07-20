// ascii.js — the video->ASCII filter. The game draws a normal 2D scene onto a tiny
// offscreen canvas (1 pixel = 1 character cell); every frame each pixel becomes a glyph:
// luminance picks the character from RAMP, hue picks the color from PAL (Okabe-Ito,
// colorblind-safe). Glyphs blit from per-color pre-rendered atlases.

const RAMP = " .-':;=+*#%@";
// Okabe-Ito palette. Color never encodes meaning alone (size/shape is the second channel).
const PAL = [
  '#EAEAEA', // 0 white
  '#8C8C8C', // 1 gray
  '#E69F00', // 2 orange
  '#56B4E9', // 3 sky blue
  '#009E73', // 4 green
  '#F0E442', // 5 yellow
  '#0072B2', // 6 blue
  '#D55E00', // 7 vermillion
  '#CC79A7', // 8 purple
];

function hexRgb(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

class Asciifier {
  constructor(displayCanvas, cols, rows, cell) {
    this.cols = cols; this.rows = rows; this.cell = cell;
    this.canvas = displayCanvas;
    this.canvas.width = cols * cell;
    this.canvas.height = rows * cell;
    this.dctx = this.canvas.getContext('2d');

    this.scene = document.createElement('canvas');
    this.scene.width = cols; this.scene.height = rows;
    this.sctx = this.scene.getContext('2d', { willReadFrequently: true });

    this.texts = [];
    this.font = `bold ${cell + 2}px Menlo, Consolas, "Courier New", monospace`;
    this.frame = 0;
    // glitch post-FX state (chroma-split / row shear / depth pop / ramp scramble)
    this.glitch = { mode: null, t: 0, dur: 0, strength: 0, rowOff: null };
    this.tmp = document.createElement('canvas');
    this.tmp.width = this.canvas.width; this.tmp.height = this.canvas.height;
    this.tctx = this.tmp.getContext('2d');
    this._buildLuts();
    this._buildAtlas();
  }

  // The world is briefly wrong. Reads as broken stereoscopic 3D / VHS damage.
  startGlitch(strength = 0.5, dur = 0.28, mode = null) {
    const modes = ['chroma', 'shear', 'pop', 'scramble', 'chroma'];
    const g = this.glitch;
    g.mode = mode || modes[(Math.random() * modes.length) | 0];
    g.t = 0; g.dur = dur; g.strength = strength;
    if (g.mode === 'shear') {
      g.rowOff = new Int8Array(this.rows);
      const bands = 2 + ((Math.random() * 4) | 0);
      for (let b = 0; b < bands; b++) {
        const y0 = (Math.random() * this.rows) | 0;
        const h = 2 + ((Math.random() * 5) | 0);
        const dx = (Math.random() < 0.5 ? -1 : 1) * (1 + ((Math.random() * 3 * strength) | 0));
        for (let y = y0; y < Math.min(this.rows, y0 + h); y++) g.rowOff[y] = dx;
      }
    }
  }

  _buildLuts() {
    // luminance -> glyph index
    this.glut = new Uint8Array(256);
    for (let l = 0; l < 256; l++) {
      this.glut[l] = Math.min(RAMP.length - 1, Math.floor(Math.pow(l / 255, 0.8) * RAMP.length));
    }
    // glyph density is relative to each palette color's own peak luminance, so a
    // full-brightness vermillion pixel is as dense ('@') as a white one
    this.pinv = PAL.map(h => {
      const [r, g, b] = hexRgb(h);
      return 255 / Math.max(1, (r * 54 + g * 183 + b * 19) >> 8);
    });
    // 32^3 rgb -> palette index. Low-saturation goes to gray/white by luminance,
    // otherwise nearest hue among the colored entries.
    this.clut = new Uint8Array(32768);
    const cols = PAL.map(hexRgb);
    for (let r = 0; r < 32; r++) for (let g = 0; g < 32; g++) for (let b = 0; b < 32; b++) {
      const R = r << 3, G = g << 3, B = b << 3;
      const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      let best;
      if (sat < 0.18) {
        best = mx > 190 ? 0 : 1;
      } else {
        let bd = 1e9; best = 2;
        for (let i = 2; i < cols.length; i++) {
          const [pr, pg, pb] = cols[i];
          // compare direction, not magnitude: scale palette color to pixel brightness
          const pm = Math.max(pr, pg, pb) || 1;
          const s = mx / pm;
          const d = (R - pr * s) ** 2 + (G - pg * s) ** 2 + (B - pb * s) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
      }
      this.clut[(r << 10) | (g << 5) | b] = best;
    }
  }

  _buildAtlas() {
    const c = this.cell;
    this.atlas = document.createElement('canvas');
    this.atlas.width = RAMP.length * c;
    this.atlas.height = PAL.length * c;
    const a = this.atlas.getContext('2d');
    a.font = this.font;
    a.textAlign = 'center'; a.textBaseline = 'middle';
    for (let ci = 0; ci < PAL.length; ci++) {
      a.fillStyle = PAL[ci];
      for (let gi = 0; gi < RAMP.length; gi++) {
        a.fillText(RAMP[gi], gi * c + c / 2, ci * c + c / 2 + 1);
      }
    }
  }

  beginFrame() {
    this.sctx.globalAlpha = 1;
    this.sctx.fillStyle = '#000';
    this.sctx.fillRect(0, 0, this.cols, this.rows);
    this.texts.length = 0;
  }

  // Direct character overlay (HUD, menus, portraits) — real chars, same palette.
  text(x, y, str, ci = 0, alpha = 1) {
    this.texts.push({ x: Math.round(x), y: Math.round(y), str, ci, alpha });
  }
  textC(y, str, ci = 0, alpha = 1) {
    this.text((this.cols - str.length) / 2, y, str, ci, alpha);
  }

  render() {
    const { cols, rows, cell, dctx, atlas, glut, clut } = this;
    this.frame++;
    const gl = this.glitch;
    gl.t += 1 / 60;
    const ga = gl.mode && gl.t < gl.dur;
    const shear = ga && gl.mode === 'shear' ? gl.rowOff : null;
    const scramble = ga && gl.mode === 'scramble';
    const d = this.sctx.getImageData(0, 0, cols, rows).data;
    dctx.fillStyle = '#000';
    dctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    let i = 0;
    for (let y = 0; y < rows; y++) {
      const dy = y * cell;
      const rx = shear ? shear[y] * cell : 0;
      for (let x = 0; x < cols; x++) {
        const r = d[i], g = d[i + 1], b = d[i + 2]; i += 4;
        const l = (r * 54 + g * 183 + b * 19) >> 8;
        if (l < 10) continue;
        const ci = clut[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)];
        let gi = glut[Math.min(255, (l * this.pinv[ci]) | 0)];
        if (scramble && ((x * 31 + y * 17 + this.frame * 7) % 5) === 0) {
          gi = Math.max(1, Math.min(RAMP.length - 1, gi + (((x + y + this.frame) & 1) ? 2 : -2)));
        }
        dctx.drawImage(atlas, gi * cell, ci * cell, cell, cell, x * cell + rx, dy, cell, cell);
      }
    }
    // post passes: broken-3D ghosts (whole-canvas GPU composites, cheap)
    if (ga && gl.mode === 'chroma') {
      const off = Math.round(1 + gl.strength * 2) * cell;
      const fade = 1 - gl.t / gl.dur;
      for (const [color, sign] of [['#E69F00', 1], ['#0072B2', -1]]) {
        this.tctx.globalCompositeOperation = 'source-over';
        this.tctx.clearRect(0, 0, this.tmp.width, this.tmp.height);
        this.tctx.drawImage(this.canvas, 0, 0);
        this.tctx.globalCompositeOperation = 'source-atop';
        this.tctx.fillStyle = color; this.tctx.globalAlpha = 0.9;
        this.tctx.fillRect(0, 0, this.tmp.width, this.tmp.height);
        this.tctx.globalAlpha = 1;
        dctx.globalCompositeOperation = 'lighter';
        dctx.globalAlpha = 0.3 * fade;
        dctx.drawImage(this.tmp, sign * off, (this.frame & 2) ? sign * cell : 0);
      }
      dctx.globalCompositeOperation = 'source-over'; dctx.globalAlpha = 1;
    } else if (ga && gl.mode === 'pop') {
      const W = this.canvas.width, H = this.canvas.height;
      const s = 1 + 0.07 * gl.strength * Math.sin((gl.t / gl.dur) * Math.PI);
      this.tctx.globalCompositeOperation = 'source-over';
      this.tctx.clearRect(0, 0, W, H);
      this.tctx.drawImage(this.canvas, 0, 0);
      dctx.globalAlpha = 0.55;
      dctx.drawImage(this.tmp, W / 2 - W * s / 2, H / 2 - H * s / 2, W * s, H * s);
      dctx.globalAlpha = 1;
    }
    // overlay text
    dctx.font = this.font;
    dctx.textAlign = 'center'; dctx.textBaseline = 'middle';
    for (const t of this.texts) {
      dctx.fillStyle = PAL[t.ci];
      dctx.globalAlpha = t.alpha;
      for (let k = 0; k < t.str.length; k++) {
        const ch = t.str[k];
        if (ch !== ' ') dctx.fillText(ch, (t.x + k) * cell + cell / 2, t.y * cell + cell / 2 + 1);
      }
    }
    dctx.globalAlpha = 1;
  }
}
