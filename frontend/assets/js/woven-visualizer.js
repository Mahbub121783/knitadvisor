'use strict';

/**
 * KnitAdvisor — Woven Fabric Visualizer
 *
 * The knit side (fabric-visualizer.js + knit3d/) has had a realistic 2D
 * canvas render and a true 3-D WebGL view for a while; the 24 Gokarneshan
 * woven qualities only ever got the technical loom-plan diagrams
 * (pattern-renderer.js's buildLoomPlanSVG / buildClothPreviewSVG) — real and
 * useful, but never "what does this actually look like". This fills that gap
 * with the same two views, built on the SAME real data the loom plans
 * already use: structure.grid (the design), construction.ends_per_inch /
 * picks_per_inch (the real sett), warp_resultant_ne / weft_resultant_ne (real
 * yarn diameter via the canonical Ashenhurst constant), and weight.*_crimp_pct.
 *
 * Unlike knit — several different topologies (rib/interlock/warp-knit/mesh) —
 * every weave family (plain, any twill, satin, warp rib, honeycomb) is the
 * SAME orthogonal two-yarn interlacement, parameterised entirely by the
 * design grid. So there is one 3-D topology (woven3d/weave-mesh.js), not a
 * construction-specific branch per family.
 *
 * No shade/colour input exists for woven yet (index.html's woven panel asks
 * only for construction) — this renders natural/undyed yarn rather than
 * inventing a dye colour, with one named exception: denim's own printed
 * characteristics say its colour is specifically an indigo warp over an
 * undyed weft, so that is the book's own description being rendered, not a
 * guess.
 *
 * Self-contained Canvas 2D + WebGL. No external CSS dependency — this runs
 * on index.html and patterns.html, which don't load result.html's viz styles.
 *
 * Usage:
 *   const wv = new WovenVisualizer(patternData, container);
 *   await wv.init();
 */
class WovenVisualizer {
  constructor(data, container) {
    this.data = data || {};
    this.container = container;
    this.activeTab = 'realistic';
    this.canvases = {};
    this._fabric3d = null;
    this._destroyed = false;
  }

  async init() {
    if (!this.container) return;
    const s = this.data.structure || {};
    // No grid, nothing to draw — the loom-plan section above this already
    // states plainly why (a figure the book prints rather than a rule that
    // generates it). Leaving this panel empty is honest; drawing a plausible
    // weave that isn't the real one would not be.
    if (!s.available || !Array.isArray(s.grid) || !s.grid.length) {
      this.container.innerHTML = '';
      return;
    }
    this._buildDOM();
    this._renderActiveTab();
  }

  destroy() {
    this._destroyed = true;
    if (this._fabric3d) { try { this._fabric3d.dispose(); } catch (_) {} this._fabric3d = null; }
  }

  switchTab(name) {
    if (this.activeTab === 'threed' && name !== 'threed' && this._fabric3d) {
      try { this._fabric3d.dispose(); } catch (_) {}
      this._fabric3d = null;
    }
    this.activeTab = name;
    this.container.querySelectorAll('.wvz-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    this.container.querySelectorAll('.wvz-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === name));
    this._renderActiveTab();
  }

  exportPng() {
    if (this.activeTab === 'threed' && this._fabric3d && this._fabric3d.renderer) {
      this._download(this._fabric3d.renderer.domElement.toDataURL('image/png'), 'threed');
      return;
    }
    const canvas = this.canvases[this.activeTab] || this.canvases.realistic;
    if (!canvas) return;
    this._download(canvas.toDataURL('image/png'), this.activeTab);
  }

  exportPngHD() {
    const SCALE = 3;
    if (this.activeTab === 'threed' && this._fabric3d && typeof this._fabric3d.captureHiRes === 'function') {
      const url = this._fabric3d.captureHiRes(SCALE);
      if (url) { this._download(url, 'threed-hd'); return; }
    }
    if (this.activeTab === 'realistic') {
      const W = 560, H = 380;
      const off = document.createElement('canvas');
      off.width = W * SCALE; off.height = H * SCALE;
      const octx = off.getContext('2d');
      octx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      this._paintWeave(octx, W, H, this._opts());
      this._download(off.toDataURL('image/png'), 'realistic-hd');
      return;
    }
    this.exportPng();
  }

  _download(dataUrl, label) {
    const link = document.createElement('a');
    link.download = `knitadvisor-${this.data.fabric_id || 'woven'}-${label}.png`;
    link.href = dataUrl;
    link.click();
  }

  // ─────────────────────────────────────────────────────────
  // DATA MAPPING
  // ─────────────────────────────────────────────────────────

  _opts() {
    const d = this.data;
    const s = d.structure || {};
    const c = d.construction || {};
    const w = d.weight || {};
    const colors = this._colors();
    const fiberType = this._fiber();
    return {
      grid: s.grid, repeatEnds: s.repeat_ends || 1, repeatPicks: s.repeat_picks || 1,
      endsPerInch: c.ends_per_inch || 60, picksPerInch: c.picks_per_inch || 50,
      warpNe: c.warp_resultant_ne || 20, weftNe: c.weft_resultant_ne || 20,
      warpCrimpPct: w.warp_crimp_pct, weftCrimpPct: w.weft_crimp_pct, gsm: w.gsm,
      warpColor: colors.warp, weftColor: colors.weft, natural: colors.natural,
      warpFiberType: fiberType, weftFiberType: fiberType, fiberType,
    };
  }

  _fiber() {
    const mat = ((this.data.construction || {}).material || '').toLowerCase();
    if (/polyester/.test(mat)) return 'polyester';
    if (/nylon/.test(mat)) return 'nylon';
    if (/viscose|rayon|modal/.test(mat)) return 'viscose';
    if (/linen/.test(mat)) return 'linen';
    if (/wool/.test(mat)) return 'wool';
    return 'cotton';
  }

  _colors() {
    const text = `${this.data.fabric_name || ''} ${(this.data.characteristics || []).join(' ')}`.toLowerCase();
    if (/indigo|denim/.test(text)) {
      return { warp: { r: 42, g: 58, b: 94 }, weft: { r: 226, g: 216, b: 194 }, natural: false };
    }
    return { warp: { r: 214, g: 201, b: 174 }, weft: { r: 199, g: 187, b: 160 }, natural: true };
  }

  _shade(c, amt) {
    const f = v => Math.max(0, Math.min(255, Math.round(v + (amt > 0 ? (255 - v) * amt : v * amt))));
    return `rgb(${f(c.r)},${f(c.g)},${f(c.b)})`;
  }

  _updateInfo(opts) {
    const info = this.container.querySelector('#wvz-info-text');
    if (!info) return;
    const naturalNote = opts.natural ? ' · natural (undyed) — no shade input exists for woven yet' : '';
    info.textContent = `${this.data.fabric_name || 'Woven fabric'} · ${opts.endsPerInch}×${opts.picksPerInch} sett `
      + `(ends × picks/inch) · warp ${opts.warpNe} Ne / weft ${opts.weftNe} Ne${naturalNote}`;
  }

  // ─────────────────────────────────────────────────────────
  // DOM
  // ─────────────────────────────────────────────────────────

  _buildDOM() {
    this._injectCss();
    this.container.innerHTML = `
      <div class="wvz-tab-bar">
        <button class="wvz-tab active" data-tab="realistic">Realistic Fabric</button>
        <button class="wvz-tab" data-tab="threed">3D View</button>
      </div>
      <div class="wvz-panel active" data-panel="realistic"><div class="wvz-canvas-wrap" data-wrap="realistic"></div></div>
      <div class="wvz-panel" data-panel="threed"><div class="wvz-canvas-wrap" data-wrap="threed"></div></div>
      <div class="wvz-toolbar">
        <span class="wvz-info" id="wvz-info-text">Rendering…</span>
        <button class="wvz-btn" id="wvz-export-png">Export PNG</button>
        <button class="wvz-btn" id="wvz-export-hd" title="3x resolution">Export HD</button>
      </div>
    `;
    this.container.querySelectorAll('.wvz-tab').forEach(b => b.addEventListener('click', () => this.switchTab(b.dataset.tab)));
    this.container.querySelector('#wvz-export-png').addEventListener('click', () => this.exportPng());
    this.container.querySelector('#wvz-export-hd').addEventListener('click', () => this.exportPngHD());
  }

  _renderActiveTab() {
    if (this.activeTab === 'threed') this._render3D();
    else this._renderRealistic();
  }

  // ─────────────────────────────────────────────────────────
  // REALISTIC 2D
  // ─────────────────────────────────────────────────────────

  _renderRealistic() {
    const wrap = this.container.querySelector('.wvz-canvas-wrap[data-wrap="realistic"]');
    if (!wrap) return;
    wrap.innerHTML = '';
    const opts = this._opts();
    const W = 560, H = 380, SS = 2;
    const canvas = document.createElement('canvas');
    canvas.width = W * SS; canvas.height = H * SS;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    canvas.style.borderRadius = '10px'; canvas.style.display = 'block';
    wrap.appendChild(canvas);
    this.canvases.realistic = canvas;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(SS, 0, 0, SS, 0, 0);
    this._paintWeave(ctx, W, H, opts);
    this._updateInfo(opts);
  }

  /** What the cloth looks like: the design repeat tiled, each crossing drawn
   *  as the thread actually on top (pattern-renderer.js's own convention —
   *  grid[pick][end] true = warp lifted), consecutive "up" cells in a column
   *  merged into one continuous float so a twill's diagonal or a satin's
   *  scattered floats read as real threads, not a checkerboard of squares. */
  _paintWeave(ctx, W, H, opts) {
    const { grid, repeatEnds, repeatPicks, warpColor, weftColor } = opts;
    const mod = (n, m) => ((n % m) + m) % m;
    const warpUp = (pick, end) => !!(grid[mod(pick, repeatPicks)] || [])[mod(end, repeatEnds)];

    const targetCols = 26, targetRows = 20;
    const cols = Math.max(repeatEnds, Math.round(targetCols / repeatEnds) * repeatEnds);
    const rows = Math.max(repeatPicks, Math.round(targetRows / repeatPicks) * repeatPicks);
    const cw = W / cols, ch = H / rows;

    // ground = weft, horizontal bands with a soft roundness gradient
    for (let r = 0; r < rows; r++) {
      const y = r * ch;
      const grad = ctx.createLinearGradient(0, y, 0, y + ch);
      grad.addColorStop(0, this._shade(weftColor, -0.20));
      grad.addColorStop(0.5, this._shade(weftColor, 0.12));
      grad.addColorStop(1, this._shade(weftColor, -0.24));
      ctx.fillStyle = grad;
      ctx.fillRect(0, y, W, ch);
    }

    // warp — one continuous float per run of consecutive "up" cells
    for (let col = 0; col < cols; col++) {
      const x = col * cw;
      let r = 0;
      while (r < rows) {
        const pick = mod(rows - 1 - r, repeatPicks);   // bottom-up, matching the loom-plan convention
        if (!warpUp(pick, col)) { r++; continue; }
        let r2 = r;
        while (r2 + 1 < rows && warpUp(mod(rows - 1 - (r2 + 1), repeatPicks), col)) r2++;
        const yTop = H - (r2 + 1) * ch;
        const h = (r2 - r + 1) * ch;
        const grad = ctx.createLinearGradient(x, 0, x + cw, 0);
        grad.addColorStop(0, this._shade(warpColor, -0.24));
        grad.addColorStop(0.5, this._shade(warpColor, 0.15));
        grad.addColorStop(1, this._shade(warpColor, -0.28));
        ctx.fillStyle = grad;
        ctx.fillRect(x, yTop, cw, h);
        const ao = Math.min(1.5, h * 0.15);
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.fillRect(x, yTop, cw, ao);
        ctx.fillRect(x, yTop + h - ao, cw, ao);
        r = r2 + 1;
      }
    }

    this._drawScaleBar(ctx, W, H, opts, cw, ch);
  }

  /** Real-world scale bar (mm) from the actual sett (ends/picks per inch) —
   *  same "scale bar on a micrograph" logic as the knit view's ruler, just
   *  computed directly since this view has no zoom/pan state (yet). */
  _drawScaleBar(ctx, W, H, opts, cw, ch) {
    const pxPerMmX = cw * (opts.endsPerInch / 25.4);
    const pxPerMmY = ch * (opts.picksPerInch / 25.4);
    const pxPerMm = (pxPerMmX + pxPerMmY) / 2;
    if (!isFinite(pxPerMm) || pxPerMm <= 0) return;
    const NICE = [0.5, 1, 2, 5, 10, 20, 50, 100];
    let mm = NICE[0];
    for (const n of NICE) { if (n * pxPerMm <= 140) mm = n; else break; }
    const barW = mm * pxPerMm;
    if (barW < 14) return;

    const x0 = 14, y0 = H - 15;
    ctx.save();
    ctx.lineCap = 'round';
    for (const [stroke, lw] of [['rgba(255,255,255,0.9)', 3.6], ['rgba(20,20,24,0.88)', 1.6]]) {
      ctx.strokeStyle = stroke; ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(x0, y0); ctx.lineTo(x0 + barW, y0);
      ctx.moveTo(x0, y0 - 4); ctx.lineTo(x0, y0 + 4);
      ctx.moveTo(x0 + barW, y0 - 4); ctx.lineTo(x0 + barW, y0 + 4);
      ctx.stroke();
    }
    const label = `${mm} mm`;
    ctx.font = "600 10px 'JetBrains Mono', monospace";
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.strokeText(label, x0, y0 - 7);
    ctx.fillStyle = 'rgba(20,20,24,0.9)';
    ctx.fillText(label, x0, y0 - 7);
    ctx.restore();
  }

  // ─────────────────────────────────────────────────────────
  // 3D
  // ─────────────────────────────────────────────────────────

  _render3D() {
    const wrap = this.container.querySelector('.wvz-canvas-wrap[data-wrap="threed"]');
    if (!wrap) return;
    wrap.innerHTML = '';
    const opts = this._opts();

    const webglOk = (() => {
      try { return !!window.WebGLRenderingContext && !!document.createElement('canvas').getContext('webgl'); }
      catch (_) { return false; }
    })();
    if (!webglOk) {
      wrap.innerHTML = '<p style="font:12px monospace;color:#778;padding:8px 2px;">3-D preview needs WebGL, which this browser does not have.</p>';
      return;
    }

    const stage = document.createElement('div');
    stage.className = 'ka3dgl-stage';
    stage.innerHTML = `
      <div class="ka3d-controls">
        <button class="ka3d-btn" data-act="front">Front</button>
        <button class="ka3d-btn" data-act="back">Back</button>
        <button class="ka3d-btn" data-act="reset" title="Reset view">⟳</button>
        <button class="ka3d-btn" data-act="wire" title="Show thread paths">Threads</button>
        <button class="ka3d-btn" data-act="light" title="Preview under a different lightbox illuminant">Light: D65</button>
        <span class="ka3d-hint" style="margin-left:6px">Drag to orbit · scroll to zoom · real 3-D warp/weft</span>
      </div>
      <div class="ka3dgl-mount"></div>
      <div class="ka3dgl-loading" style="font:11px monospace;color:#778;padding:6px 2px;">Loading 3-D engine…</div>`;
    wrap.appendChild(stage);

    const mount = stage.querySelector('.ka3dgl-mount');
    const loading = stage.querySelector('.ka3dgl-loading');

    import('/assets/js/woven3d/index.js?v=20260903b').then(({ Woven3D, LIGHT_PRESETS, LIGHT_PRESET_ORDER }) => {
      if (this._destroyed || this.activeTab !== 'threed') return;
      if (this._fabric3d) { try { this._fabric3d.dispose(); } catch (_) {} }
      this._fabric3d = new Woven3D();
      this._fabric3d.mount(mount, opts);
      loading.remove();
      const lightBtn = stage.querySelector('[data-act="light"]');
      let lightIdx = 0;
      stage.querySelector('.ka3d-controls').addEventListener('click', (e) => {
        const act = e.target.getAttribute('data-act'); if (!act) return;
        if (act === 'front') this._fabric3d.setView('front');
        else if (act === 'back') this._fabric3d.setView('back');
        else if (act === 'reset') this._fabric3d.resetView();
        else if (act === 'wire') e.target.classList.toggle('active', this._fabric3d.toggleWire());
        else if (act === 'light') {
          lightIdx = (lightIdx + 1) % LIGHT_PRESET_ORDER.length;
          const key = LIGHT_PRESET_ORDER[lightIdx];
          this._fabric3d.setLightPreset(key);
          if (lightBtn) lightBtn.textContent = `Light: ${LIGHT_PRESETS[key].label.split(' ')[0]}`;
        }
      });
      this._updateInfo(opts);
    }).catch(() => {
      wrap.innerHTML = '<p style="font:12px monospace;color:#778;padding:8px 2px;">3-D preview unavailable.</p>';
    });
  }

  _injectCss() {
    if (document.getElementById('wvz-style')) return;
    const css = `
    .wvz-tab-bar{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;}
    .wvz-tab{font:600 11px/1 var(--mono,monospace);padding:7px 13px;border-radius:7px;cursor:pointer;
      border:1px solid var(--line,rgba(0,0,0,.14));background:var(--bg2,#fff);color:var(--t2,#555);}
    .wvz-tab.active{background:#eaf1ff;border-color:#5b8def;color:#2563eb;}
    .wvz-panel{display:none;}
    .wvz-panel.active{display:block;}
    .wvz-canvas-wrap{width:100%;max-width:560px;}
    .wvz-canvas-wrap canvas{max-width:100%;}
    .wvz-toolbar{display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap;}
    .wvz-info{font:11px var(--mono,monospace);color:var(--t3,#778);flex:1;min-width:180px;}
    .wvz-btn{font:600 11px var(--mono,monospace);padding:6px 12px;border-radius:7px;cursor:pointer;
      border:1px solid var(--line,rgba(0,0,0,.14));background:var(--bg2,#fff);color:var(--t2,#555);}
    .wvz-btn:hover{border-color:#5b8def;color:#2563eb;}
    .ka3dgl-stage{display:flex;flex-direction:column;align-items:center;gap:10px;width:100%;padding:6px 0;}
    .ka3dgl-mount{width:100%;max-width:560px;height:380px;border-radius:12px;overflow:hidden;
      background:radial-gradient(ellipse at 50% 35%,rgba(255,255,255,.06),rgba(0,0,0,.30));}
    .ka3d-controls{display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:center;}
    .ka3d-btn{font:600 11px/1 var(--mono,monospace);padding:6px 11px;border-radius:7px;cursor:pointer;
      border:1px solid rgba(0,0,0,.14);background:#fff;color:#333;transition:all .15s;}
    .ka3d-btn:hover{border-color:#5b8def;color:#2563eb;}
    .ka3d-btn.active{background:#eaf1ff;border-color:#5b8def;color:#2563eb;}
    .ka3d-hint{font:10px var(--mono,monospace);color:var(--t3,#778);}`;
    const style = document.createElement('style');
    style.id = 'wvz-style';
    style.textContent = css;
    document.head.appendChild(style);
  }
}

if (typeof window !== 'undefined') {
  window.WovenVisualizer = WovenVisualizer;
}
