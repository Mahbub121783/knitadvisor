'use strict';

/**
 * KnitAdvisor — Fabric Visualizer
 *
 * Self-contained Canvas 2D + SVG rendering class.
 * No external libraries. Pure vanilla JS.
 * Reads the full API result object already in memory on result.html —
 * no extra network call for simple weft knit patterns.
 *
 * Usage (from result.html):
 *   const fv = new FabricVisualizer(result, container);
 *   await fv.init();
 */

class FabricVisualizer {

  constructor(result, container) {
    this.result    = result;
    this.container = container;
    this.activeTab = 'realistic';
    this.animFrame = null;
    this.animProgress = 0;
    this.vizData   = null;
    this.canvases  = {};
    this.svgWrap   = null;
    this._userColor = null;                    // user-picked dye color (hex) or null
    this._dyedColor = { r: 96, g: 100, b: 112 }; // computed in _computeDyedColor()
    this._destroyed = false;
    // 3D view interaction state
    this._three = { rotX: -14, rotY: 0, zoom: 1, brush: false, dragging: false, lastX: 0, lastY: 0, painted: false };
    this._faceCache = { front: null, back: null, brushBack: null };
  }

  // ─────────────────────────────────────────────────────────
  // PUBLIC
  // ─────────────────────────────────────────────────────────

  async init() {
    if (!this.container) return;
    this._buildSectionDOM();

    // The Realistic view renders straight from the result object and never
    // depends on the path engine — so a data-gen failure must NOT block it.
    // (Stitch/Cross/Props tabs guard against null vizData individually.)
    try {
      this.vizData = await this._generateVizData();
    } catch (err) {
      this.vizData = null;
    }

    this._computeDyedColor();
    this._syncColorInput();
    this._renderActiveTab();
  }

  switchTab(tabName) {
    if (this.animFrame) { cancelAnimationFrame(this.animFrame); this.animFrame = null; }
    this.activeTab = tabName;

    this.container.querySelectorAll('.viz-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    this.container.querySelectorAll('.viz-panel').forEach(panel => {
      panel.classList.toggle('active', panel.dataset.panel === tabName);
    });

    this._renderActiveTab();
  }

  exportPng() {
    const canvas = this.canvases[this.activeTab] || this.canvases.realistic || this.canvases.stitch;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `knitadvisor-${(this.result.fabric || {}).id || 'fabric'}-${this.activeTab}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  exportSvg() {
    if (!this.svgWrap) return;
    const svgEl = this.svgWrap.querySelector('svg');
    if (!svgEl) return;
    const blob = new Blob([svgEl.outerHTML], { type: 'image/svg+xml' });
    const link = document.createElement('a');
    link.download = `knitadvisor-${(this.result.fabric || {}).id || 'fabric'}-cross-section.svg`;
    link.href = URL.createObjectURL(blob);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  }

  destroy() {
    this._destroyed = true;
    if (this.animFrame) { cancelAnimationFrame(this.animFrame); this.animFrame = null; }
    if (this._threeHandlers) {
      window.removeEventListener('mousemove', this._threeHandlers.move);
      window.removeEventListener('mouseup', this._threeHandlers.up);
      this._threeHandlers = null;
    }
  }

  // ─────────────────────────────────────────────────────────
  // DATA GENERATION
  // ─────────────────────────────────────────────────────────

  async _generateVizData() {
    const fabric  = this.result.fabric || {};
    const pattern = this.result.pattern || {};
    const isWarpKnit = fabric.category === 'warp_knit'
      || (fabric.machine_type || '').includes('warp_knit');

    const patCols = ((pattern.pattern_cylinder || [])[0] || []).length || 1;
    const patRows = (pattern.pattern_cylinder || []).length || 1;
    const THRESHOLD = 8;

    if (isWarpKnit || patCols > THRESHOLD || patRows > THRESHOLD) {
      // Server-side generation (warp knit intersections, large repeats)
      const resp = await apiVisualize(fabric.id || 'unknown', this.result);
      return resp;
    }

    // Client-side inline generation for simple weft knit
    return this._generateWeftDataInline();
  }

  _generateWeftDataInline() {
    const result  = this.result;
    const fabric  = result.fabric || {};
    const pattern = result.pattern || {};
    const yarn    = result.yarn    || {};

    const cylinderGrid = pattern.pattern_cylinder || [['K']];
    const dialGrid     = pattern.pattern_dial     || null;
    const coursesPerRepeat = pattern.courses_per_repeat || cylinderGrid.length;
    const walesPerRepeat   = pattern.wales_per_repeat   || (cylinderGrid[0] || ['K']).length;

    const tileW = 3, tileH = 4;
    const totalCols = walesPerRepeat * tileW;
    const totalRows = coursesPerRepeat * tileH;
    const cellSize  = 44;

    const countNe    = yarn.count_ne || 30;
    const fiberType  = this._classifyFiber();
    const sheenModel = this._getSheenModel(fiberType);
    const hasSheen   = sheenModel === 'high_sheen';

    // Loop geometry constants
    const geom = {
      loop_head_ratio:   0.300,
      loop_height_ratio: 0.950,
      foot_splay_ratio:  0.200,
    };
    const W  = cellSize * geom.loop_head_ratio;
    const H  = cellSize * geom.loop_height_ratio;
    const FS = cellSize * geom.foot_splay_ratio;

    const canvasWidth  = totalCols * cellSize;
    const canvasHeight = totalRows * cellSize;
    const paths = [];

    for (let tRow = 0; tRow < tileH; tRow++) {
      for (let tCol = 0; tCol < tileW; tCol++) {
        for (let r = 0; r < coursesPerRepeat; r++) {
          for (let c = 0; c < walesPerRepeat; c++) {
            const globalRow = tRow * coursesPerRepeat + r;
            const globalCol = tCol * walesPerRepeat  + c;
            const cx = globalCol * cellSize + cellSize / 2;
            const cy = canvasHeight - (globalRow * cellSize + cellSize / 2);
            const cellType = (cylinderGrid[r] && cylinderGrid[r][c]) || 'K';

            paths.push({
              row: globalRow, col: globalCol,
              type: cellType, cx, cy,
              loopH: H, hasSheen, fiberType,
              geom: { W, H, FS },
            });

            if (dialGrid && dialGrid[r] && dialGrid[r][c] !== undefined) {
              const dialCy = cy - cellSize * 0.15;
              paths.push({
                row: globalRow, col: globalCol,
                type: dialGrid[r][c], cx, cy: dialCy,
                loopH: H * 0.9, hasSheen, fiberType,
                isDial: true,
                geom: { W: W * 0.9, H: H * 0.9, FS: FS * 0.9 },
              });
            }
          }
        }
      }
    }

    paths.sort((a, b) => a.row - b.row || (a.isDial ? -1 : 1));

    // Properties map
    const tf = ((result.physical_constraints || {}).tightness_factor || 14);
    const spirality = ((result.quality_prediction || {}).spirality || {});
    const shrinkage = ((result.quality_prediction || {}).shrinkage  || {});
    let tfZone = tf < 12 ? 'slack' : tf > 16 ? 'tight' : 'balanced';
    const tfColors = { slack: '#F59E0B', balanced: '#10B981', tight: '#EF4444' };

    // Cross-section data
    const layerCount = dialGrid ? 2 : 1;
    const cs = this._buildCrossData(cylinderGrid, dialGrid, layerCount);

    return {
      kind: 'weft_knit',
      canvasWidth, canvasHeight, cellSize,
      totalRows, totalCols, coursesPerRepeat, walesPerRepeat,
      tileFactor: tileW, tileH,
      paths, countNe, fiberType, hasSheen,
      hasDialLayer: !!dialGrid,
      propertiesMap: {
        tightness: { value: Math.round(tf * 100) / 100, zone: tfZone, color: tfColors[tfZone] },
        spirality: {
          angle_deg: spirality.skewness_angle || 0,
          risk: spirality.risk_level || 'low',
          arrowAngle_rad: ((spirality.skewness_angle || 0) * Math.PI) / 180,
        },
        shrinkage: {
          lengthwise: { pct: shrinkage.lengthwise_pct || 0, arrowLength_normalized: Math.min((shrinkage.lengthwise_pct || 0) / 15, 1) },
          widthwise:  { pct: shrinkage.widthwise_pct  || 0, arrowLength_normalized: Math.min((shrinkage.widthwise_pct  || 0) / 15, 1) },
        },
      },
      crossSection: cs,
    };
  }

  _buildCrossData(cylinderGrid, dialGrid, layerCount) {
    const wales   = Math.min((cylinderGrid[0] || ['K']).length * 3, 8);
    const courses = Math.min(cylinderGrid.length * 2, 4);
    const ns = 40, lh = 28;
    const svgW = wales * ns + 40;
    const svgH = courses * layerCount * lh + 40;
    const layers = [];
    for (let l = 0; l < layerCount; l++) {
      const grid    = l === 0 ? cylinderGrid : (dialGrid || cylinderGrid);
      const layerY  = svgH - 20 - l * courses * lh;
      const stitches = [];
      for (let ci = 0; ci < courses; ci++) {
        for (let wi = 0; wi < wales; wi++) {
          const ri = ci % grid.length;
          const gc = wi % (grid[ri] || ['K']).length;
          stitches.push({ x: 20 + wi * ns, y: layerY - ci * lh, type: (grid[ri] && grid[ri][gc]) || 'K', course: ci, wale: wi });
        }
      }
      layers.push({ layerIdx: l, label: l === 0 ? 'Cylinder' : 'Dial', stitches });
    }
    return { svgWidth: svgW, svgHeight: svgH, layerCount, layers, wales, courses, needleSpacing: ns, layerHeight: lh };
  }

  // ─────────────────────────────────────────────────────────
  // VIEW 1: CANVAS 2D — STITCH STRUCTURE
  // ─────────────────────────────────────────────────────────

  _renderStitchView() {
    const wrap = this.container.querySelector('.viz-canvas-wrap[data-wrap="stitch"]');
    if (!wrap) return;
    wrap.innerHTML = '';

    // Warp knit keeps its animated guide-bar lapping diagram
    const fabric = this.result.fabric || {};
    const isWarp = fabric.category === 'warp_knit' || (fabric.machine_type || '').includes('warp_knit');
    if (isWarp && this.vizData && this.vizData.warp) { this._renderWarpCanvas(); return; }

    // ── build the K/T/M grid (tiled) directly from the calc result ──
    const pattern = this.result.pattern || {};
    const grid = pattern.pattern_cylinder || [['K']];
    const cpr  = pattern.courses_per_repeat || grid.length;
    const wpr  = pattern.wales_per_repeat   || (grid[0] || ['K']).length;
    const type = (c, w) => {
      const row = grid[c % cpr] || ['K'];
      return row[w % wpr] || 'K';
    };

    const tileC   = Math.max(2, Math.ceil(7 / cpr));
    const tileW   = Math.max(2, Math.ceil(7 / wpr));
    const courses = cpr * tileC;
    const wales   = wpr * tileW;

    const cell = 48;
    const padX = 26, padY = 20, legendH = 30;
    const W = wales * cell + padX * 2;
    const H = courses * cell + padY * 2 + legendH;

    const canvas = document.createElement('canvas');
    canvas.className = 'viz-canvas';
    wrap.appendChild(canvas);
    this.canvases.stitch = canvas;

    const dpr = window.devicePixelRatio || 1;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // colours by stitch type (technical notation — line art)
    const COL = { K: '#1A1A1A', T: '#2563EB', M: '#D92B2B' };
    const lw  = Math.max(2.2, cell * 0.085);

    // geometry helper — centre of cell (course 0 at bottom)
    const cellX = (w) => padX + w * cell + cell / 2;
    const cellY = (c) => H - legendH - padY - (c * cell + cell / 2);

    // counts consecutive T/M directly above a cell → how far a held loop elongates
    const heldAbove = (c, w) => {
      let n = 0;
      for (let cc = c + 1; cc < courses; cc++) {
        const t = type(cc, w);
        if (t === 'T' || t === 'M') n++; else break;
      }
      return n;
    };

    // background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // PASS A — sinker connectors (course yarn between adjacent wales)
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = lw * 0.9;
    for (let c = 0; c < courses; c++) {
      const sinkerY = cellY(c) + cell * 0.42;
      const legX = cell * 0.30;
      for (let w = 1; w < wales; w++) {
        const xPrev = cellX(w - 1) + legX;
        const xCurr = cellX(w) - legX;
        ctx.beginPath();
        ctx.moveTo(xPrev, sinkerY);
        ctx.quadraticCurveTo((xPrev + xCurr) / 2, sinkerY + cell * 0.14, xCurr, sinkerY);
        ctx.stroke();
      }
    }

    // PASS B — loops, bottom course first (upper courses interlock on top)
    for (let c = 0; c < courses; c++) {
      for (let w = 0; w < wales; w++) {
        const t  = type(c, w);
        const cx = cellX(w), cy = cellY(c);
        if (t === 'K')      this._drawKnitLoop(ctx, cx, cy, cell, lw, COL.K, heldAbove(c, w));
        else if (t === 'T') this._drawTuckLoop(ctx, cx, cy, cell, lw, COL.T);
        else                this._drawMissFloat(ctx, cx, cy, cell, lw, COL.M);
      }
    }

    // PASS C — repeat boundary box (one repeat unit, bottom-left)
    ctx.save();
    ctx.strokeStyle = 'rgba(37,99,235,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(padX + 0.5, H - legendH - padY - cpr * cell + 0.5, wpr * cell, cpr * cell);
    ctx.restore();

    // PASS D — legend
    this._drawKtmLegend(ctx, COL, W, H, legendH);

    // info line
    const info = this.container.querySelector('#viz-info-text');
    if (info) {
      const ne = (this.result.yarn || {}).count_ne || '—';
      info.textContent = `Loop notation · ${cpr}C × ${wpr}W repeat · ${ne} Ne · knit interlock + tuck + float`;
    }
  }

  /** Knit needle loop — head up, two legs down interlocking with the loop below.
   *  heldExtra elongates the loop upward when tuck/miss cells sit above it. */
  _drawKnitLoop(ctx, cx, cy, cell, lw, color, heldExtra) {
    const ch      = cell * (1 + (heldExtra || 0));
    const headW   = cell * 0.30;
    const legX    = cell * 0.30;
    const sinkerY = cy + cell * 0.42;          // leg base (interlocks below)
    const headY   = cy + cell * 0.42 - ch * 0.9; // rounded head near top (elongated up)

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    // left leg: from base up to head
    ctx.moveTo(cx - legX, sinkerY);
    ctx.bezierCurveTo(cx - legX * 1.35, sinkerY - ch * 0.30,
                      cx - headW,       headY + ch * 0.22,
                      cx - headW,       headY);
    // head arc (rounded top)
    ctx.bezierCurveTo(cx - headW, headY - cell * 0.34,
                      cx + headW, headY - cell * 0.34,
                      cx + headW, headY);
    // right leg: from head down to base
    ctx.bezierCurveTo(cx + headW,       headY + ch * 0.22,
                      cx + legX * 1.35, sinkerY - ch * 0.30,
                      cx + legX,        sinkerY);
    ctx.stroke();

    // leg feet curl outward (the interlock hooks under the head of the loop below)
    ctx.lineWidth = lw * 0.85;
    ctx.beginPath();
    ctx.moveTo(cx - legX, sinkerY);
    ctx.quadraticCurveTo(cx - legX * 1.7, sinkerY + cell * 0.12, cx - legX * 1.9, sinkerY + cell * 0.02);
    ctx.moveTo(cx + legX, sinkerY);
    ctx.quadraticCurveTo(cx + legX * 1.7, sinkerY + cell * 0.12, cx + legX * 1.9, sinkerY + cell * 0.02);
    ctx.stroke();
    ctx.restore();
  }

  /** Tuck — new yarn is caught but NOT cleared: a held cup (∪) with no pull-through.
   *  The elongated knit loop from below passes up through it. */
  _drawTuckLoop(ctx, cx, cy, cell, lw, color) {
    const legX    = cell * 0.30;
    const sinkerY = cy + cell * 0.42;
    const cupY    = cy + cell * 0.10;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    // shallow cup held at the needle (tuck yarn)
    ctx.beginPath();
    ctx.moveTo(cx - legX, sinkerY);
    ctx.bezierCurveTo(cx - legX * 0.9, cupY, cx + legX * 0.9, cupY, cx + legX, sinkerY);
    ctx.stroke();

    // small held-loop bump rising through the cup (shows it is tucked, not knitted)
    ctx.lineWidth = lw * 0.8;
    ctx.beginPath();
    ctx.moveTo(cx - cell * 0.14, cupY + cell * 0.04);
    ctx.bezierCurveTo(cx - cell * 0.14, cupY - cell * 0.30,
                      cx + cell * 0.14, cupY - cell * 0.30,
                      cx + cell * 0.14, cupY + cell * 0.04);
    ctx.stroke();
    ctx.restore();
  }

  /** Miss / float — yarn passes straight across the wale; the loop below is held
   *  and elongated up through this course. */
  _drawMissFloat(ctx, cx, cy, cell, lw, color) {
    const sinkerY = cy + cell * 0.42;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    // straight float (slightly bowed) across the full wale
    ctx.beginPath();
    ctx.moveTo(cx - cell * 0.5, sinkerY);
    ctx.quadraticCurveTo(cx, sinkerY - cell * 0.06, cx + cell * 0.5, sinkerY);
    ctx.stroke();
    ctx.restore();
  }

  /** K / T / M legend bar drawn along the bottom of the canvas. */
  _drawKtmLegend(ctx, COL, W, H, legendH) {
    const y = H - legendH / 2;
    ctx.save();
    ctx.font = `11px 'JetBrains Mono', monospace`;
    ctx.textBaseline = 'middle';
    const items = [
      { c: COL.K, t: 'K — Knit (interlocked loop)' },
      { c: COL.T, t: 'T — Tuck (held cup)' },
      { c: COL.M, t: 'M — Miss (float)' },
    ];
    let x = 14;
    for (const it of items) {
      ctx.strokeStyle = it.c;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 16, y);
      ctx.stroke();
      ctx.fillStyle = '#555555';
      ctx.fillText(it.t, x + 22, y);
      x += ctx.measureText(it.t).width + 46;
    }
    ctx.restore();
  }

  // ─────────────────────────────────────────────────────────
  // WARP KNIT CANVAS ANIMATION
  // ─────────────────────────────────────────────────────────

  _renderWarpCanvas() {
    const warpData = this.vizData.warp;
    if (!warpData) return;

    const wrap = this.container.querySelector('.viz-canvas-wrap[data-wrap="stitch"]');
    if (!wrap) return;
    wrap.innerHTML = '';

    const canvas = document.createElement('canvas');
    canvas.className = 'viz-canvas';
    wrap.appendChild(canvas);
    this.canvases.stitch = canvas;

    const dpr = window.devicePixelRatio || 1;
    canvas.width  = warpData.svgWidth  * dpr;
    canvas.height = warpData.svgHeight * dpr;
    canvas.style.width  = warpData.svgWidth  + 'px';
    canvas.style.height = warpData.svgHeight + 'px';

    this.animProgress = 0;
    this._animateWarpFrame(canvas, warpData, dpr);
  }

  _animateWarpFrame(canvas, warpData, dpr) {
    if (this._destroyed) return;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, warpData.svgWidth, warpData.svgHeight);

    // Background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, warpData.svgWidth, warpData.svgHeight);

    // Needle column guides
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([2, 4]);
    for (let n = 0; n <= warpData.maxNeedle; n++) {
      const x = 20 + n * warpData.needleSpacingPx;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, warpData.svgHeight); ctx.stroke();
    }
    ctx.restore();

    const progress = Math.min(this.animProgress, 1);

    // Draw bars back-to-front (last bar index = back)
    for (let bi = warpData.bars.length - 1; bi >= 0; bi--) {
      const bar = warpData.bars[bi];
      const segCount = Math.floor(bar.segments.length * progress);
      for (let si = 0; si < segCount; si++) {
        const seg = bar.segments[si];
        ctx.save();
        ctx.strokeStyle = seg.color || bar.color;
        ctx.lineWidth = seg.role === 'underlap' ? 1.5 : 2.5;
        ctx.setLineDash(seg.dashed ? [4, 3] : []);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(seg.x0 + 20, seg.y0 + 20);
        if (seg.type === 'bezier') {
          ctx.bezierCurveTo(seg.cp1x + 20, seg.cp1y + 20, seg.cp2x + 20, seg.cp2y + 20, seg.x1 + 20, seg.y1 + 20);
        } else {
          ctx.lineTo(seg.x1 + 20, seg.y1 + 20);
        }
        ctx.stroke();
        ctx.restore();
      }
    }

    // Intersection dots
    for (const pt of warpData.intersections) {
      ctx.save();
      ctx.fillStyle = 'rgba(239,68,68,0.8)';
      ctx.beginPath();
      ctx.arc(pt.x + 20, pt.y + 20, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Needle position dots
    for (let n = 0; n <= warpData.maxNeedle; n++) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.arc(20 + n * warpData.needleSpacingPx, 20, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Bar legend
    ctx.save();
    ctx.font = `10px 'JetBrains Mono', monospace`;
    warpData.bars.forEach((bar, i) => {
      const label = (warpData.barLabels && warpData.barLabels[i]) ? warpData.barLabels[i].label : `Bar ${i + 1}`;
      ctx.fillStyle = bar.color;
      ctx.fillRect(8, warpData.svgHeight - 16 - i * 16, 14, 3);
      ctx.fillStyle = '#555555';
      ctx.fillText(label, 26, warpData.svgHeight - 13 - i * 16);
    });
    ctx.restore();

    if (progress < 1) {
      this.animProgress += 0.012;
      this.animFrame = requestAnimationFrame(() => this._animateWarpFrame(canvas, warpData, dpr));
    }
  }

  // ─────────────────────────────────────────────────────────
  // VIEW 2: SVG CROSS-SECTION
  // ─────────────────────────────────────────────────────────

  _renderCrossSection() {
    const wrap = this.svgWrap;
    if (!wrap) return;
    wrap.innerHTML = '';

    if (!this.vizData) { this._panelMsg(wrap, 'Cross-section data unavailable for this fabric.'); return; }
    const cs = (this.vizData.weft || this.vizData).crossSection || (this.vizData.crossSection);
    if (!cs) { this._panelMsg(wrap, 'Cross-section data unavailable.'); return; }

    wrap.innerHTML = this._buildCrossSectionSvg(cs);
  }

  _buildCrossSectionSvg(cs) {
    const W  = cs.svgWidth;
    const H  = cs.svgHeight;
    const ns = cs.needleSpacing;
    const lh = cs.layerHeight;
    const typeColors = { K: '#1A1A1A', T: '#888888', M: '#CCCCCC' };

    let paths = '';
    const layerLineY = [];

    for (const layer of cs.layers) {
      const layerTopY = Math.min(...layer.stitches.map(s => s.y));
      layerLineY.push(layerTopY - 6);

      // Connecting float lines between adjacent wales
      for (let ci = 0; ci < cs.courses; ci++) {
        const rowStitches = layer.stitches.filter(s => s.course === ci);
        for (let wi = 0; wi < rowStitches.length - 1; wi++) {
          const s1 = rowStitches[wi], s2 = rowStitches[wi + 1];
          paths += `<path d="M${s1.x},${s1.y} Q${(s1.x + s2.x) / 2},${s1.y - lh * 0.4} ${s2.x},${s2.y}"
            stroke="#DDDDDD" stroke-width="1" fill="none" stroke-dasharray="3,2"/>`;
        }
      }

      // Stitch ellipses
      for (const s of layer.stitches) {
        const col   = typeColors[s.type] || '#1A1A1A';
        const rx    = ns * 0.28, ry = lh * 0.22;
        const label = s.type;
        paths += `<ellipse cx="${s.x}" cy="${s.y}" rx="${rx}" ry="${ry}"
          fill="${col}" fill-opacity="0.15" stroke="${col}" stroke-width="1.5"/>`;
        paths += `<text x="${s.x}" y="${s.y + 3}" text-anchor="middle"
          font-family="'JetBrains Mono',monospace" font-size="8" fill="${col}" font-weight="600">${label}</text>`;
      }

      // Interlock vertical lines (K cells only, double-bed)
      if (cs.layerCount > 1 && layer.layerIdx === 0) {
        for (const s of layer.stitches) {
          if (s.type !== 'K') continue;
          const dialS = cs.layers[1] && cs.layers[1].stitches.find(
            ds => ds.wale === s.wale && ds.course === s.course
          );
          if (dialS) {
            paths += `<line x1="${s.x}" y1="${s.y}" x2="${dialS.x}" y2="${dialS.y}"
              stroke="#AAAAAA" stroke-width="0.75" stroke-dasharray="2,2"/>`;
          }
        }
      }
    }

    // Layer separator line
    if (cs.layerCount > 1 && layerLineY.length > 1) {
      const sepY = (layerLineY[0] + layerLineY[1]) / 2 + lh;
      paths += `<line x1="10" y1="${sepY}" x2="${W - 10}" y2="${sepY}"
        stroke="#2563EB" stroke-width="0.75" stroke-dasharray="4,3" opacity="0.5"/>`;
      paths += `<text x="12" y="${sepY - 3}"
        font-family="'JetBrains Mono',monospace" font-size="8" fill="#2563EB">Dial</text>`;
      paths += `<text x="12" y="${sepY + 10}"
        font-family="'JetBrains Mono',monospace" font-size="8" fill="#2563EB">Cylinder</text>`;
    }

    // Legend
    const legendY = H - 4;
    const legend = [
      { type: 'K', color: '#1A1A1A', label: 'Knit' },
      { type: 'T', color: '#888888', label: 'Tuck' },
      { type: 'M', color: '#CCCCCC', label: 'Miss' },
    ];
    let legendSvg = '';
    legend.forEach((l, i) => {
      const lx = 8 + i * 70;
      legendSvg += `<rect x="${lx}" y="${legendY - 5}" width="14" height="5" fill="${l.color}" fill-opacity="0.5" rx="1"/>`;
      legendSvg += `<text x="${lx + 17}" y="${legendY}"
        font-family="'JetBrains Mono',monospace" font-size="9" fill="#555">${l.label}</text>`;
    });

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <rect width="${W}" height="${H}" fill="#FFFFFF"/>
      ${paths}
      ${legendSvg}
    </svg>`;
  }

  // ─────────────────────────────────────────────────────────
  // VIEW 3: CANVAS 2D — PROPERTIES MAP
  // ─────────────────────────────────────────────────────────

  _renderPropertiesMap() {
    const wrap = this.container.querySelector('.viz-canvas-wrap[data-wrap="props"]');
    if (!wrap) return;
    wrap.innerHTML = '';

    const canvas = document.createElement('canvas');
    canvas.className = 'viz-canvas';
    wrap.appendChild(canvas);
    this.canvases.props = canvas;

    const W = 380, H = 280;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const pm = (this.vizData && ((this.vizData.weft || this.vizData).propertiesMap || this.vizData.propertiesMap))
      || this._buildPropertiesMapFromResult();
    if (!pm) return;

    // Background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);

    // Fabric rectangle
    const rx = 40, ry = 30, rw = 200, rh = 180;

    // LAYER 1 — TF heatmap tint
    const tfAlpha = 0.12;
    ctx.fillStyle = pm.tightness.color.replace(')', `, ${tfAlpha})`).replace('rgb(', 'rgba(').replace('#', '');
    // Use hex properly
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = pm.tightness.color;
    ctx.fillRect(rx, ry, rw, rh);
    ctx.globalAlpha = 1;
    ctx.restore();

    // Fabric rect border
    ctx.strokeStyle = '#E0E0DC';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.strokeRect(rx, ry, rw, rh);

    // Fabric texture dots (subtle grid)
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.04)';
    const dotSpacing = 10;
    for (let dx = rx + dotSpacing; dx < rx + rw; dx += dotSpacing) {
      for (let dy = ry + dotSpacing; dy < ry + rh; dy += dotSpacing) {
        ctx.beginPath(); ctx.arc(dx, dy, 1, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();

    // TF label in center
    ctx.save();
    ctx.font = `bold 16px 'JetBrains Mono', monospace`;
    ctx.fillStyle = pm.tightness.color;
    ctx.textAlign = 'center';
    ctx.fillText(`TF ${pm.tightness.value}`, rx + rw / 2, ry + rh / 2 - 6);
    ctx.font = `10px 'JetBrains Mono', monospace`;
    ctx.fillStyle = '#888888';
    ctx.fillText(pm.tightness.zone.toUpperCase(), rx + rw / 2, ry + rh / 2 + 10);
    ctx.restore();

    // LAYER 2 — Spirality arrow
    if (pm.spirality.angle_deg !== 0) {
      const arrowX = rx + rw / 2, arrowY = ry + rh / 2;
      const arrowLen = 50;
      const riskColors = { low: '#10B981', medium: '#F59E0B', high: '#EF4444' };
      const arrowColor = riskColors[pm.spirality.risk] || '#F59E0B';
      const angle = pm.spirality.arrowAngle_rad;

      ctx.save();
      ctx.strokeStyle = arrowColor;
      ctx.lineWidth = 2;
      ctx.translate(arrowX, arrowY);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0, arrowLen / 2);
      ctx.lineTo(0, -arrowLen / 2);
      ctx.stroke();
      // Arrowhead
      ctx.beginPath();
      ctx.moveTo(0, -arrowLen / 2);
      ctx.lineTo(-5, -arrowLen / 2 + 8);
      ctx.moveTo(0, -arrowLen / 2);
      ctx.lineTo(5, -arrowLen / 2 + 8);
      ctx.stroke();
      ctx.restore();

      ctx.font = `9px 'JetBrains Mono', monospace`;
      ctx.fillStyle = arrowColor;
      ctx.textAlign = 'center';
      ctx.fillText(`${pm.spirality.angle_deg}° spirality`, rx + rw / 2, ry + rh - 10);
    }

    // LAYER 3 — Shrinkage arrows
    const shrinkColor = 'rgba(239,68,68,0.75)';
    ctx.strokeStyle = shrinkColor;
    ctx.lineWidth   = 1.5;

    // Lengthwise (vertical arrows on sides of rect)
    const lwPct    = pm.shrinkage.lengthwise.pct;
    const lwArrLen = pm.shrinkage.lengthwise.arrowLength_normalized * (rh / 2.5);
    if (lwPct > 0) {
      this._drawDoubleArrow(ctx, rx - 12, ry + rh / 2, 'vertical', lwArrLen, shrinkColor);
      ctx.save();
      ctx.font = `9px 'JetBrains Mono', monospace`;
      ctx.fillStyle = shrinkColor;
      ctx.textAlign = 'center';
      ctx.save();
      ctx.translate(rx - 22, ry + rh / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(`↕ ${lwPct}%`, 0, 0);
      ctx.restore();
      ctx.restore();
    }

    // Widthwise (horizontal arrows)
    const wwPct    = pm.shrinkage.widthwise.pct;
    const wwArrLen = pm.shrinkage.widthwise.arrowLength_normalized * (rw / 2.5);
    if (wwPct > 0) {
      this._drawDoubleArrow(ctx, rx + rw / 2, ry - 12, 'horizontal', wwArrLen, shrinkColor);
      ctx.save();
      ctx.font = `9px 'JetBrains Mono', monospace`;
      ctx.fillStyle = shrinkColor;
      ctx.textAlign = 'center';
      ctx.fillText(`↔ ${wwPct}%`, rx + rw / 2, ry - 18);
      ctx.restore();
    }

    // LAYER 4 — Legend box (right side)
    this._drawPropsLegend(ctx, pm, rw + rx + 14, ry);
  }

  _drawDoubleArrow(ctx, cx, cy, dir, halfLen, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    if (dir === 'vertical') {
      ctx.beginPath(); ctx.moveTo(cx, cy - halfLen); ctx.lineTo(cx, cy + halfLen); ctx.stroke();
      this._arrowHead(ctx, cx, cy - halfLen, 0, -1, color);
      this._arrowHead(ctx, cx, cy + halfLen, 0,  1, color);
    } else {
      ctx.beginPath(); ctx.moveTo(cx - halfLen, cy); ctx.lineTo(cx + halfLen, cy); ctx.stroke();
      this._arrowHead(ctx, cx - halfLen, cy, -1, 0, color);
      this._arrowHead(ctx, cx + halfLen, cy,  1, 0, color);
    }
    ctx.restore();
  }

  _arrowHead(ctx, x, y, dx, dy, color) {
    const len = 6, ang = 0.5;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - len * (dx * Math.cos(ang) - dy * Math.sin(ang)),
               y - len * (dy * Math.cos(ang) + dx * Math.sin(ang)));
    ctx.moveTo(x, y);
    ctx.lineTo(x - len * (dx * Math.cos(ang) + dy * Math.sin(ang)),
               y - len * (dy * Math.cos(ang) - dx * Math.sin(ang)));
    ctx.stroke();
    ctx.restore();
  }

  _drawPropsLegend(ctx, pm, x, y) {
    ctx.save();
    ctx.font = `9px 'JetBrains Mono', monospace`;
    const lines = [
      `TF ${pm.tightness.value} — ${pm.tightness.zone}`,
      `Spirality: ${pm.spirality.angle_deg}° (${pm.spirality.risk})`,
      `Shrink L: ${pm.shrinkage.lengthwise.pct}%`,
      `Shrink W: ${pm.shrinkage.widthwise.pct}%`,
    ];
    ctx.fillStyle = '#CCCCCC';
    ctx.fillRect(x, y, 120, lines.length * 16 + 10);
    ctx.strokeStyle = '#E0E0DC';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, 120, lines.length * 16 + 10);
    ctx.fillStyle = '#555555';
    lines.forEach((line, i) => ctx.fillText(line, x + 6, y + 13 + i * 16));
    ctx.restore();
  }

  // ─────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────

  _drawLegend(ctx, yarnColor, cW, cH) {
    ctx.save();
    ctx.font = `9px 'JetBrains Mono', monospace`;
    const items = [
      { color: yarnColor, dash: false, label: 'K — Knit' },
      { color: this._lightenColor(yarnColor, 0.35), dash: true, label: 'T — Tuck' },
      { color: '#CCCCCC', dash: false, label: 'M — Miss' },
    ];
    items.forEach((item, i) => {
      const lx = 8, ly = cH - 10 - i * 14;
      ctx.strokeStyle = item.color;
      ctx.lineWidth   = 1.5;
      ctx.setLineDash(item.dash ? [3, 2] : []);
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 14, ly); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#555555';
      ctx.fillText(item.label, lx + 18, ly + 3);
    });
    ctx.restore();
  }

  _getYarnColor() {
    const shade = (this.result.input || {}).color_shade || '';
    const map = { dark: '#1A1A1A', medium: '#555555', light: '#888888',
                  dark_navy: '#1A1A1A', light_medium: '#666666',
                  white_melange: '#999999', melange: '#777777', fluorescent: '#2A4A2A' };
    const fiberType = this._classifyFiber();
    const base = map[shade] || '#2A2A2A';
    // Cooler tint for polyester
    if (fiberType === 'polyester' || fiberType === 'nylon') return base;
    return base;
  }

  _getYarnLineWidth(countNe, cellSize) {
    const gauge   = ((this.result.machine || {}).gauge_optimal || 24);
    const pitchMm = 25.4 / gauge;
    const dMm     = 0.9 / Math.sqrt(Math.max(countNe, 1));
    const lw      = (dMm / pitchMm) * cellSize;
    return Math.max(1.5, Math.min(lw, cellSize * 0.35));
  }

  _classifyFiber() {
    const comp = (this.result.input || {}).composition
      || (this.result.composition || {}).raw || '';
    if (!comp) return 'cotton';
    const lower = comp.toLowerCase();
    const order = ['wool', 'modal', 'viscose', 'polyester', 'nylon', 'acrylic', 'cotton'];
    for (const f of order) {
      const m = lower.match(new RegExp(`(\\d+)%?\\s*${f}`));
      if (m && parseInt(m[1]) >= 50) return f;
    }
    for (const f of order) { if (lower.includes(f)) return f; }
    return 'cotton';
  }

  _getSheenModel(fiberType) {
    if (fiberType === 'polyester' || fiberType === 'nylon') return 'high_sheen';
    if (fiberType === 'modal' || fiberType === 'viscose') return 'gradient';
    return 'matte';
  }

  _defaultGeomFromCell(cellSize) {
    return {
      W:  cellSize * 0.300,
      H:  cellSize * 0.950,
      FS: cellSize * 0.200,
    };
  }

  _lightenColor(hex, amount) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, ((num >> 16) & 0xFF) + Math.round(255 * amount));
    const g = Math.min(255, ((num >>  8) & 0xFF) + Math.round(255 * amount));
    const b = Math.min(255, ( num        & 0xFF)  + Math.round(255 * amount));
    return `rgb(${r},${g},${b})`;
  }

  _renderActiveTab() {
    if (this.animFrame) { cancelAnimationFrame(this.animFrame); this.animFrame = null; }
    if (this.activeTab === 'realistic') this._renderRealisticView();
    else if (this.activeTab === 'threed') this._render3DView();
    else if (this.activeTab === 'stitch') this._renderStitchView();
    else if (this.activeTab === 'cross') this._renderCrossSection();
    else if (this.activeTab === 'props') this._renderPropertiesMap();
  }

  // ─────────────────────────────────────────────────────────
  // VIEW 0: REALISTIC DYED FABRIC SWATCH
  // Synthesises the finished, dyed cloth appearance by combining every
  // engine parameter: composition + shade → colour & sheen,
  // K/T/M structure → surface texture, GSM + count → yarn thickness,
  // gauge/stitch-density → loop size, TF → tightness (ground show-through).
  // ─────────────────────────────────────────────────────────

  // ── Flat realistic face (front), high-detail, construction-aware ──
  _renderRealisticView() {
    const wrap = this.container.querySelector('.viz-canvas-wrap[data-wrap="realistic"]');
    if (!wrap) return;
    wrap.innerHTML = '';

    const W = 560, H = 380, SS = 2;       // SS = supersample for crispness
    const canvas = document.createElement('canvas');
    canvas.className = 'viz-canvas';
    canvas.width  = W * SS;
    canvas.height = H * SS;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    canvas.style.borderRadius = '10px';
    wrap.appendChild(canvas);
    this.canvases.realistic = canvas;

    const ctx = canvas.getContext('2d');
    ctx.scale(SS, SS);

    const opts = this._faceOpts();
    this._paintFabricFace(ctx, W, H, 'front', opts);

    this._updateInfoLine(opts);
  }

  /** Collects every parameter the painter needs, ONCE. */
  _faceOpts() {
    const result = this.result;
    const yarn   = result.yarn || {};
    const fiberType = this._classifyFiber();
    return {
      dyed:      this._dyedColor,
      fiberType,
      sheen:     this._getSheenModel(fiberType),
      countNe:   yarn.count_ne || 30,
      gsm:       (result.input || {}).gsm || (result.grammage || {}).gsm || 180,
      tf:        (result.physical_constraints || {}).tightness_factor || 14,
      construction: this._detectConstruction(),
    };
  }

  _updateInfoLine(opts) {
    const info = this.container.querySelector('#viz-info-text');
    if (!info) return;
    const result = this.result;
    const resolved = result.color_resolved || null;
    const colorName = resolved
      ? `${resolved.name}${resolved.tcx_code ? ' (' + resolved.tcx_code + ')' : ''}`
      : ((result.input || {}).color_shade || (result.color || {}).shade || 'medium shade');
    const tf = opts.tf;
    info.textContent =
      `Finished ${opts.construction.label} · ${opts.gsm} GSM · ${opts.countNe} Ne ${opts.fiberType} · TF ${typeof tf === 'number' ? tf.toFixed(1) : tf} · ${colorName}`;
  }

  // ─────────────────────────────────────────────────────────
  // CONSTRUCTION DETECTION — maps fabric id/category/name to a
  // render recipe (face & back differ; brush/mesh/pile flags).
  // ─────────────────────────────────────────────────────────
  _detectConstruction() {
    const fabric = this.result.fabric || {};
    const id   = (fabric.id || '').toLowerCase();
    const cat  = (fabric.category || '').toLowerCase();
    const name = (fabric.name || '').toLowerCase();
    const s = `${id} ${cat} ${name}`;
    const has = (...k) => k.some(x => s.includes(x));

    // Warp knit family → tricot/raschel zig-zag wales
    if (cat.includes('warp') || has('tricot', 'raschel', 'warp_knit')) {
      if (has('mesh', 'net', 'powernet', 'marqui', 'hexagon', 'sandfly'))
        return { type: 'mesh', base: 'warp', label: 'warp-knit mesh', mesh: true, holeShape: 'hex', brush: false };
      if (has('spacer', 'sandwich', '3d'))
        return { type: 'spacer', base: 'warp', label: '3D spacer mesh', mesh: true, holeShape: 'round', brush: false };
      return { type: 'tricot', base: 'warp', label: 'warp-knit tricot', mesh: false, brush: false };
    }

    // Mesh / airtex / mock-mesh (weft) — the holey "breathable" fabrics
    if (has('mesh', 'airtex', 'air-tex', 'eyelet', 'net', 'aertex'))
      return { type: 'mesh', base: 'single', label: 'mesh / airtex', mesh: true, holeShape: 'round', brush: false };
    if (has('pointelle', 'pointel'))
      return { type: 'mesh', base: 'single', label: 'pointelle', mesh: true, holeShape: 'diamond', brush: false };

    // Pile / brushed family
    if (has('fleece', 'polar'))
      return { type: 'fleece', base: 'double', label: 'fleece', mesh: false, brush: true, pile: 'brush' };
    if (has('terry', 'french terry', 'loop knit', 'loopback'))
      return { type: 'terry', base: 'double', label: 'french terry', mesh: false, brush: false, pile: 'loop' };
    if (has('velour', 'velvet'))
      return { type: 'fleece', base: 'double', label: 'velour', mesh: false, brush: true, pile: 'velour' };

    // Double-knit / interlock family
    if (has('interlock'))
      return { type: 'interlock', base: 'double', label: 'interlock', mesh: false, brush: false };
    if (has('pique', 'piqué', 'lacoste'))
      return { type: 'pique', base: 'single', label: has('lacoste', 'double') ? 'double lacoste' : 'piqué', mesh: false, brush: false };
    if (has('rib'))
      return { type: 'rib', base: 'double', label: this._ribLabel(id, name), mesh: false, brush: false, ribRepeat: this._ribRepeat(id) };
    if (has('interlock', 'double jersey', 'double knit', 'ponte'))
      return { type: 'interlock', base: 'double', label: 'double knit', mesh: false, brush: false };

    // Default: single jersey (stockinette)
    return { type: 'jersey', base: 'single', label: 'single jersey', mesh: false, brush: false };
  }

  _ribLabel(id, name) {
    const m = (id + ' ' + name).match(/(\d+)\s*[x×]\s*(\d+)/);
    return m ? `${m[1]}×${m[2]} rib` : 'rib';
  }

  // ─────────────────────────────────────────────────────────
  // UNIVERSAL FABRIC FACE PAINTER
  // side: 'front' | 'back'.  Front & back differ per construction.
  // ─────────────────────────────────────────────────────────
  _paintFabricFace(ctx, W, H, side, opts) {
    const { dyed, construction: con, countNe } = opts;
    const brushed = side === 'back' && (this._three.brush || con.brush);

    // stitch sizing — finer yarn (higher Ne) → smaller, denser stitches
    const dense = con.type === 'interlock' ? 1.25 : con.type === 'rib' ? 1.0 : 1.0;
    const targetWales = Math.round(Math.min(Math.max((13 + countNe * 0.52) * dense, 16), 38));
    const sw = W / targetWales;
    const sh = sw * (con.type === 'rib' ? 0.92 : 0.84);
    const yarnW = sw * Math.min(Math.max(0.40 + (30 - countNe) * 0.004, 0.34), 0.50);

    // ground (the deep valley colour seen between yarns)
    ctx.fillStyle = this._shadeColorCss(dyed, -0.42);
    ctx.fillRect(0, 0, W, H);

    // brushed back short-circuits structure with a dense pile
    if (brushed) { this._paintBrushedPile(ctx, W, H, dyed, opts); this._overlaySoftLight(ctx, W, H); return; }

    switch (con.type) {
      case 'rib':       this._paintRib(ctx, W, H, sw, sh, yarnW, opts, side); break;
      case 'interlock': this._paintInterlock(ctx, W, H, sw, sh, yarnW, opts, side); break;
      case 'pique':     this._paintPique(ctx, W, H, sw, sh, yarnW, opts, side); break;
      case 'mesh':      this._paintMesh(ctx, W, H, sw, sh, yarnW, opts, side); break;
      case 'spacer':    this._paintMesh(ctx, W, H, sw, sh, yarnW, opts, side); break;
      case 'tricot':    this._paintTricot(ctx, W, H, sw, sh, yarnW, opts, side); break;
      case 'terry':     side === 'back' ? this._paintLoopPile(ctx, W, H, dyed, opts)
                                        : this._paintStockinette(ctx, W, H, sw, sh, yarnW, opts, 'front'); break;
      case 'fleece':    this._paintStockinette(ctx, W, H, sw, sh, yarnW, opts, side); break;
      default:          this._paintStockinette(ctx, W, H, sw, sh, yarnW, opts, side);
    }

    // shared finishing — fine textile grain, soft studio light
    this._overlayGrain(ctx, W, H);
    this._overlaySoftLight(ctx, W, H);
  }

  // ── STOCKINETTE (single jersey) ──
  // front: columns of interlocking "V" knit loops.
  // back : rows of purl bumps (the technical back).
  _paintStockinette(ctx, W, H, sw, sh, yarnW, opts, side) {
    const dyed = opts.dyed;
    const cols = Math.ceil(W / sw) + 1;
    const rows = Math.ceil(H / sh) + 2;
    if (side === 'back') {
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          this._loopPurlBump(ctx, c * sw + sw / 2, H - (r * sh + sh / 2), sw, sh, yarnW, dyed, (r + c) % 2);
    } else {
      // sinker loops first (the connecting yarn dipping between wales), then the V loops
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          this._loopKnitV(ctx, c * sw + sw / 2, H - (r * sh + sh / 2), sw, sh, yarnW, dyed, opts.sheen);
    }
  }

  // ── RIB (alternating knit & purl wales; both faces look similar) ──
  _paintRib(ctx, W, H, sw, sh, yarnW, opts, side) {
    const dyed = opts.dyed;
    const rep = (opts.construction.ribRepeat || 1);
    const cols = Math.ceil(W / sw) + 1;
    const rows = Math.ceil(H / sh) + 2;
    const phase = side === 'back' ? rep : 0;   // back swaps knit/purl columns
    // shade the sunken purl columns darker for depth
    for (let c = 0; c < cols; c++) {
      const knitCol = ((c + phase) % (rep * 2)) < rep;
      if (!knitCol) {
        ctx.fillStyle = this._shadeColorCss(dyed, -0.30);
        ctx.fillRect(c * sw, 0, sw, H);
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx = c * sw + sw / 2, cy = H - (r * sh + sh / 2);
        const knitCol = ((c + phase) % (rep * 2)) < rep;
        if (knitCol) this._loopKnitV(ctx, cx, cy, sw, sh, yarnW, dyed, opts.sheen);
        else         this._loopPurlBump(ctx, cx, cy, sw * 0.92, sh, yarnW, dyed, r % 2, -0.18);
      }
    }
  }

  // ── INTERLOCK (smooth knit on BOTH faces, finer & denser) ──
  _paintInterlock(ctx, W, H, sw, sh, yarnW, opts, side) {
    const dyed = opts.dyed;
    const cols = Math.ceil(W / sw) + 1;
    const rows = Math.ceil(H / sh) + 2;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        this._loopKnitV(ctx, c * sw + sw / 2, H - (r * sh + sh / 2), sw, sh, yarnW * 0.92, dyed, opts.sheen);
  }

  // ── PIQUÉ / LACOSTE (jersey ground + regular tuck dimples → textured grid) ──
  _paintPique(ctx, W, H, sw, sh, yarnW, opts, side) {
    const dyed = opts.dyed;
    const cols = Math.ceil(W / sw) + 1;
    const rows = Math.ceil(H / sh) + 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx = c * sw + sw / 2, cy = H - (r * sh + sh / 2);
        // tuck dimple on a staggered 2×2 lattice
        const dimple = ((r % 2) === 0 && (c % 2) === 0) || ((r % 2) === 1 && (c % 2) === 1);
        if (side === 'front' && dimple) {
          // recessed cell
          ctx.save();
          ctx.fillStyle = this._shadeColorCss(dyed, -0.22);
          ctx.beginPath();
          ctx.ellipse(cx, cy, sw * 0.42, sh * 0.42, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          this._loopKnitV(ctx, cx, cy, sw * 0.86, sh * 0.8, yarnW * 0.9, dyed, opts.sheen);
        } else {
          this._loopKnitV(ctx, cx, cy, sw, sh, yarnW, dyed, opts.sheen);
        }
      }
    }
  }

  // ── MESH / AIRTEX / POINTELLE — knit ground perforated with regular holes ──
  _paintMesh(ctx, W, H, sw, sh, yarnW, opts, side) {
    const dyed = opts.dyed;
    // knit ground first
    const cols = Math.ceil(W / sw) + 1;
    const rows = Math.ceil(H / sh) + 2;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        this._loopKnitV(ctx, c * sw + sw / 2, H - (r * sh + sh / 2), sw, sh, yarnW, dyed, opts.sheen);

    // hole lattice — staggered rows, transfer-stitch eyelets
    const hsX = sw * 2.4, hsY = sh * 2.6;
    const holeShape = opts.construction.holeShape || 'round';
    const rOut = Math.min(hsX, hsY) * 0.42;
    for (let gy = 0, row = 0; gy < H + hsY; gy += hsY, row++) {
      const offX = (row % 2) * hsX / 2;
      for (let gx = 0; gx < W + hsX; gx += hsX) {
        this._punchHole(ctx, gx + offX, gy, rOut, holeShape, dyed, yarnW);
      }
    }
    this._overlayGrain(ctx, W, H);
  }

  _punchHole(ctx, cx, cy, r, shape, dyed, yarnW) {
    ctx.save();
    // dark void (light passes through → near-black behind the cloth)
    ctx.beginPath();
    if (shape === 'hex')      this._polyPath(ctx, cx, cy, r, 6, Math.PI / 6);
    else if (shape === 'diamond') this._polyPath(ctx, cx, cy, r, 4, 0);
    else                      ctx.ellipse(cx, cy, r, r * 1.06, 0, 0, Math.PI * 2);
    ctx.fillStyle = this._shadeColorCss(dyed, -0.78);
    ctx.fill();
    // rolled rim of yarn around the eyelet (slightly raised, catches light)
    ctx.lineWidth = yarnW * 1.05;
    ctx.strokeStyle = this._shadeColorCss(dyed, 0.10);
    ctx.stroke();
    ctx.lineWidth = yarnW * 0.4;
    ctx.strokeStyle = this._shadeColorCss(dyed, 0.30);
    ctx.beginPath();
    if (shape === 'round') ctx.ellipse(cx, cy - r * 0.1, r * 0.86, r * 0.9, 0, Math.PI * 1.05, Math.PI * 1.95);
    else { this._polyPath(ctx, cx, cy, r * 0.9, shape === 'hex' ? 6 : 4, shape === 'hex' ? Math.PI / 6 : 0); }
    ctx.stroke();
    ctx.restore();
  }

  _polyPath(ctx, cx, cy, r, sides, rot) {
    for (let i = 0; i <= sides; i++) {
      const a = rot + i * (Math.PI * 2 / sides);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
  }

  // ── TRICOT (warp knit) — vertical wales of fine zig-zag loops ──
  _paintTricot(ctx, W, H, sw, sh, yarnW, opts, side) {
    const dyed = opts.dyed;
    const cols = Math.ceil(W / sw) + 1;
    const base = `rgb(${dyed.r},${dyed.g},${dyed.b})`;
    const hi = this._shadeColorCss(dyed, 0.20), dk = this._shadeColorCss(dyed, -0.24);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let c = 0; c < cols; c++) {
      const cx = c * sw + sw / 2;
      // technical face: gentle vertical wale ribs; back: diagonal underlap shadows
      ctx.strokeStyle = side === 'back' ? dk : base;
      ctx.lineWidth = yarnW;
      ctx.beginPath();
      for (let y = -sh; y < H + sh; y += sh) {
        const wob = (side === 'back' ? sw * 0.42 : sw * 0.2);
        ctx.moveTo(cx - wob, y);
        ctx.quadraticCurveTo(cx, y + sh * 0.5, cx + wob, y + sh);
      }
      ctx.stroke();
      // highlight rib
      ctx.strokeStyle = hi; ctx.lineWidth = yarnW * 0.32;
      ctx.beginPath();
      for (let y = -sh; y < H + sh; y += sh) {
        ctx.moveTo(cx - sw * 0.06, y);
        ctx.quadraticCurveTo(cx + sw * 0.04, y + sh * 0.5, cx - sw * 0.06, y + sh);
      }
      ctx.stroke();
    }
  }

  // ── BRUSHED PILE (fleece back, velour) — soft raised noodly fibre ──
  _paintBrushedPile(ctx, W, H, dyed, opts) {
    // base wash slightly lighter & desaturated (raised fibre scatters light)
    ctx.fillStyle = this._shadeColorCss(dyed, 0.06);
    ctx.fillRect(0, 0, W, H);
    const dense = opts.construction.pile === 'velour' ? 9 : 6;
    const n = Math.floor(W * H / dense);
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const x = Math.random() * W, y = Math.random() * H;
      const a = Math.PI * 0.5 + (Math.random() - 0.5) * 1.2;   // mostly downward sweep
      const len = 3 + Math.random() * 7;
      const shade = (Math.random() - 0.45) * 0.5;
      ctx.strokeStyle = this._shadeColorCss(dyed, shade);
      ctx.globalAlpha = 0.5 + Math.random() * 0.4;
      ctx.lineWidth = 0.7 + Math.random() * 0.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len * 0.5,
                           x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ── LOOP PILE (french terry back) — rows of uncut loops ──
  _paintLoopPile(ctx, W, H, dyed, opts) {
    ctx.fillStyle = this._shadeColorCss(dyed, -0.30);
    ctx.fillRect(0, 0, W, H);
    const sw = 16, sh = 16;
    ctx.lineCap = 'round';
    for (let r = 0; r * sh < H + sh; r++) {
      const oy = r * sh + sh * 0.6;
      const off = (r % 2) * sw / 2;
      for (let c = 0; c * sw < W + sw; c++) {
        const cx = c * sw + off + sw / 2;
        ctx.strokeStyle = this._shadeColorCss(dyed, -0.05);
        ctx.lineWidth = 3.0;
        ctx.beginPath();
        ctx.arc(cx, oy, sw * 0.34, Math.PI * 0.05, Math.PI * 0.95, false);
        ctx.stroke();
        ctx.strokeStyle = this._shadeColorCss(dyed, 0.22);
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.arc(cx, oy - 0.6, sw * 0.30, Math.PI * 0.15, Math.PI * 0.7, false);
        ctx.stroke();
      }
    }
    this._overlaySoftLight(ctx, W, H);
  }

  // ── single knit "V" loop (stockinette face) — realistic rounded yarn ──
  _loopKnitV(ctx, cx, cy, sw, sh, yarnW, dyed, sheen) {
    const topY = cy - sh * 0.52;
    const botY = cy + sh * 0.56;
    const lxT = cx - sw * 0.46, rxT = cx + sw * 0.46;
    const base = `rgb(${dyed.r},${dyed.g},${dyed.b})`;
    const hi = this._shadeColorCss(dyed, 0.24);
    const dk = this._shadeColorCss(dyed, -0.30);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // shadow under the head (the loop above draws through here)
    ctx.strokeStyle = dk; ctx.lineWidth = yarnW * 1.05;
    ctx.beginPath();
    ctx.moveTo(lxT, topY + sh * 0.14);
    ctx.quadraticCurveTo(cx, topY - sh * 0.05, rxT, topY + sh * 0.14);
    ctx.stroke();

    // two visible legs (the V)
    ctx.strokeStyle = base; ctx.lineWidth = yarnW;
    ctx.beginPath();
    ctx.moveTo(lxT, topY + sh * 0.14);
    ctx.quadraticCurveTo(cx - sw * 0.27, cy, cx, botY);
    ctx.moveTo(rxT, topY + sh * 0.14);
    ctx.quadraticCurveTo(cx + sw * 0.27, cy, cx, botY);
    ctx.stroke();

    // tube highlight (rounded yarn, light from upper-left)
    ctx.strokeStyle = hi; ctx.lineWidth = yarnW * 0.34;
    ctx.beginPath();
    ctx.moveTo(lxT, topY + sh * 0.16);
    ctx.quadraticCurveTo(cx - sw * 0.27, cy, cx - sw * 0.02, botY);
    ctx.moveTo(rxT, topY + sh * 0.16);
    ctx.quadraticCurveTo(cx + sw * 0.27, cy, cx + sw * 0.02, botY);
    ctx.stroke();

    // crook shadow where it draws through the loop below
    ctx.strokeStyle = dk; ctx.lineWidth = yarnW * 0.5;
    ctx.beginPath();
    ctx.moveTo(cx - sw * 0.12, botY - sh * 0.06);
    ctx.quadraticCurveTo(cx, botY + sh * 0.02, cx + sw * 0.12, botY - sh * 0.06);
    ctx.stroke();

    if (sheen === 'high_sheen') {
      ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = yarnW * 0.12;
      ctx.beginPath();
      ctx.moveTo(lxT + yarnW * 0.1, topY + sh * 0.18);
      ctx.quadraticCurveTo(cx - sw * 0.25, cy, cx, botY - yarnW * 0.1);
      ctx.stroke();
    }
  }

  // ── purl bump (technical back of jersey / purl wale of rib) ──
  _loopPurlBump(ctx, cx, cy, sw, sh, yarnW, dyed, alt, extraDark) {
    const base = this._shadeColorCss(dyed, -0.10 + (extraDark || 0));
    const hi   = this._shadeColorCss(dyed, 0.16);
    const dk   = this._shadeColorCss(dyed, -0.34 + (extraDark || 0));
    ctx.lineCap = 'round';
    // recess shadow
    ctx.strokeStyle = dk; ctx.lineWidth = yarnW * 1.25;
    ctx.beginPath();
    ctx.moveTo(cx - sw * 0.48, cy + sh * 0.16);
    ctx.quadraticCurveTo(cx, cy + sh * 0.40, cx + sw * 0.48, cy + sh * 0.16);
    ctx.stroke();
    // the bump arc (semicircle of yarn lying across the wale)
    ctx.strokeStyle = base; ctx.lineWidth = yarnW * 1.12;
    ctx.beginPath();
    ctx.moveTo(cx - sw * 0.46, cy + sh * 0.06);
    ctx.quadraticCurveTo(cx, cy - sh * 0.30, cx + sw * 0.46, cy + sh * 0.06);
    ctx.stroke();
    // top highlight on the bump
    ctx.strokeStyle = hi; ctx.lineWidth = yarnW * 0.40;
    ctx.beginPath();
    ctx.moveTo(cx - sw * 0.34, cy - sh * 0.02);
    ctx.quadraticCurveTo(cx, cy - sh * 0.26, cx + sw * 0.34, cy - sh * 0.02);
    ctx.stroke();
  }

  // ─────────────────────────────────────────────────────────
  // 3D INTERACTIVE VIEW — CSS-3D cube w/ front & back canvas faces.
  // Drag to rotate (flips to back), wheel/buttons to zoom, brush toggle.
  // ─────────────────────────────────────────────────────────
  _render3DView() {
    const wrap = this.container.querySelector('.viz-canvas-wrap[data-wrap="threed"]');
    if (!wrap) return;
    wrap.innerHTML = '';

    const opts = this._faceOpts();
    const con = opts.construction;
    const W = 460, H = 320, SS = 2, THICK = 26;

    const stage = document.createElement('div');
    stage.className = 'ka3d-stage';
    stage.innerHTML = `
      <div class="ka3d-controls">
        <button class="ka3d-btn" data-act="front" title="Front side">Front</button>
        <button class="ka3d-btn" data-act="back" title="Back side">Back</button>
        ${con.brush || con.pile ? '<button class="ka3d-btn" data-act="brush" title="Brushed back">Brush</button>' : ''}
        <span class="ka3d-sep"></span>
        <button class="ka3d-btn" data-act="zoomout">–</button>
        <button class="ka3d-btn" data-act="zoomin">+</button>
        <button class="ka3d-btn" data-act="reset" title="Reset view">⟳</button>
      </div>
      <div class="ka3d-viewport">
        <div class="ka3d-cube">
          <canvas class="ka3d-face ka3d-front"></canvas>
          <canvas class="ka3d-face ka3d-back"></canvas>
          <div class="ka3d-edge ka3d-edge-r"></div>
          <div class="ka3d-edge ka3d-edge-b"></div>
        </div>
      </div>
      <div class="ka3d-hint">Drag to rotate · scroll to zoom · flip to inspect the back</div>
    `;
    wrap.appendChild(stage);
    this._injectThreeCss();

    const frontC = stage.querySelector('.ka3d-front');
    const backC  = stage.querySelector('.ka3d-back');
    [frontC, backC].forEach(c => {
      c.width = W * SS; c.height = H * SS;
      c.style.width = W + 'px'; c.style.height = H + 'px';
    });

    const fctx = frontC.getContext('2d'); fctx.scale(SS, SS);
    const bctx = backC.getContext('2d');  bctx.scale(SS, SS);
    this._paintFabricFace(fctx, W, H, 'front', opts);
    this._paintFabricFace(bctx, W, H, 'back',  opts);
    this.canvases.threed = frontC;

    const cube = stage.querySelector('.ka3d-cube');
    const viewport = stage.querySelector('.ka3d-viewport');
    cube.style.setProperty('--thick', THICK + 'px');

    const apply = () => {
      const t = this._three;
      cube.style.transform =
        `translateZ(-${THICK / 2}px) rotateX(${t.rotX}deg) rotateY(${t.rotY}deg) scale(${t.zoom})`;
      const back = ((t.rotY % 360) + 360) % 360;
      const showingBack = back > 90 && back < 270;
      stage.querySelector('[data-act="front"]').classList.toggle('active', !showingBack);
      stage.querySelector('[data-act="back"]').classList.toggle('active', showingBack);
    };
    this._three.painted = true;
    apply();

    // drag-rotate
    const down = (e) => { const t = this._three; t.dragging = true; const p = e.touches ? e.touches[0] : e; t.lastX = p.clientX; t.lastY = p.clientY; viewport.classList.add('grabbing'); };
    const move = (e) => {
      const t = this._three; if (!t.dragging) return;
      const p = e.touches ? e.touches[0] : e;
      t.rotY += (p.clientX - t.lastX) * 0.6;
      t.rotX = Math.max(-60, Math.min(60, t.rotX - (p.clientY - t.lastY) * 0.4));
      t.lastX = p.clientX; t.lastY = p.clientY; apply();
      if (e.cancelable) e.preventDefault();
    };
    const up = () => { this._three.dragging = false; viewport.classList.remove('grabbing'); };
    // remove any window listeners from a previous 3D render (avoid leaks/double-rotate)
    if (this._threeHandlers) {
      window.removeEventListener('mousemove', this._threeHandlers.move);
      window.removeEventListener('mouseup', this._threeHandlers.up);
    }
    this._threeHandlers = { move, up };
    viewport.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    viewport.addEventListener('touchstart', down, { passive: true });
    viewport.addEventListener('touchmove', move, { passive: false });
    viewport.addEventListener('touchend', up);
    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const t = this._three;
      t.zoom = Math.max(0.6, Math.min(3, t.zoom * (e.deltaY < 0 ? 1.12 : 0.89)));
      apply();
    }, { passive: false });

    // buttons
    stage.querySelector('.ka3d-controls').addEventListener('click', (e) => {
      const act = e.target.getAttribute('data-act'); if (!act) return;
      const t = this._three;
      if (act === 'front') { t.rotY = 0; t.rotX = -14; }
      else if (act === 'back') { t.rotY = 180; t.rotX = -14; }
      else if (act === 'zoomin') t.zoom = Math.min(3, t.zoom * 1.18);
      else if (act === 'zoomout') t.zoom = Math.max(0.6, t.zoom * 0.85);
      else if (act === 'reset') { t.rotY = 0; t.rotX = -14; t.zoom = 1; }
      else if (act === 'brush') {
        t.brush = !t.brush;
        e.target.classList.toggle('active', t.brush);
        this._paintFabricFace(bctx, W, H, 'back', opts);   // repaint brushed back
        if ((((t.rotY % 360) + 360) % 360) <= 90) { t.rotY = 180; } // flip to show it
      }
      apply();
    });

    this._updateInfoLine(opts);
  }

  _injectThreeCss() {
    if (document.getElementById('ka3d-style')) return;
    const css = `
    .ka3d-stage{display:flex;flex-direction:column;align-items:center;gap:10px;width:100%;padding:6px 0;}
    .ka3d-controls{display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:center;}
    .ka3d-btn{font:600 11px/1 var(--mono,monospace);padding:6px 11px;border-radius:7px;cursor:pointer;
      border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.04);color:var(--t2,#aab);transition:all .15s;}
    .ka3d-btn:hover{border-color:rgba(0,255,178,.4);color:var(--a1,#0fb);}
    .ka3d-btn.active{background:rgba(0,255,178,.12);border-color:rgba(0,255,178,.5);color:var(--a1,#0fb);}
    .ka3d-sep{width:1px;height:18px;background:rgba(255,255,255,.12);margin:0 3px;}
    .ka3d-viewport{width:100%;max-width:520px;height:380px;display:flex;align-items:center;justify-content:center;
      perspective:1100px;cursor:grab;overflow:hidden;
      background:radial-gradient(ellipse at 50% 38%,rgba(255,255,255,.05),rgba(0,0,0,.28));border-radius:12px;}
    .ka3d-viewport.grabbing{cursor:grabbing;}
    .ka3d-cube{position:relative;width:460px;height:320px;transform-style:preserve-3d;transition:transform .08s linear;}
    .ka3d-face{position:absolute;inset:0;backface-visibility:hidden;border-radius:10px;
      box-shadow:0 18px 40px rgba(0,0,0,.5);}
    .ka3d-front{transform:translateZ(calc(var(--thick)/2));}
    .ka3d-back{transform:rotateY(180deg) translateZ(calc(var(--thick)/2));}
    .ka3d-edge{position:absolute;background:rgba(0,0,0,.55);}
    .ka3d-edge-r{top:0;right:0;width:var(--thick);height:320px;
      transform:rotateY(90deg) translateZ(calc(230px - var(--thick)/2));transform-origin:right;
      background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(0,0,0,.5));}
    .ka3d-edge-b{bottom:0;left:0;width:460px;height:var(--thick);
      transform:rotateX(90deg) translateZ(calc(-160px + var(--thick)/2));transform-origin:bottom;
      background:linear-gradient(90deg,rgba(255,255,255,.05),rgba(0,0,0,.5));}
    .ka3d-hint{font:10px var(--mono,monospace);color:var(--t3,#778);}`;
    const style = document.createElement('style');
    style.id = 'ka3d-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /** One stockinette knit "V" stitch — two rounded yarn legs forming the wale,
   *  a receding head arc, tube highlight, and a depth shadow where it draws through. */
  _drawKnitVStitch(ctx, cx, cy, sw, sh, yarnW, dyed, sheen) {
    const topY = cy - sh * 0.50;
    const botY = cy + sh * 0.54;            // slight overlap into the course below
    const lxT  = cx - sw * 0.47;
    const rxT  = cx + sw * 0.47;
    const base = `rgb(${dyed.r},${dyed.g},${dyed.b})`;
    const hi   = this._shadeColorCss(dyed,  0.22);
    const dk   = this._shadeColorCss(dyed, -0.26);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // head arc (recedes behind the loop above)
    ctx.strokeStyle = dk;
    ctx.lineWidth = yarnW * 0.95;
    ctx.beginPath();
    ctx.moveTo(lxT, topY + sh * 0.12);
    ctx.quadraticCurveTo(cx, topY - sh * 0.04, rxT, topY + sh * 0.12);
    ctx.stroke();

    // two legs (the visible V) — base yarn
    ctx.strokeStyle = base;
    ctx.lineWidth = yarnW;
    ctx.beginPath();
    ctx.moveTo(lxT, topY + sh * 0.12);
    ctx.quadraticCurveTo(cx - sw * 0.26, cy, cx, botY);
    ctx.moveTo(rxT, topY + sh * 0.12);
    ctx.quadraticCurveTo(cx + sw * 0.26, cy, cx, botY);
    ctx.stroke();

    // tube highlight down each leg (rounded-yarn sheen, light from above)
    ctx.strokeStyle = hi;
    ctx.lineWidth = yarnW * 0.34;
    ctx.beginPath();
    ctx.moveTo(lxT, topY + sh * 0.12);
    ctx.quadraticCurveTo(cx - sw * 0.26, cy, cx, botY);
    ctx.moveTo(rxT, topY + sh * 0.12);
    ctx.quadraticCurveTo(cx + sw * 0.26, cy, cx, botY);
    ctx.stroke();

    // depth shadow at the bottom crook where the loop draws through the one below
    ctx.strokeStyle = dk;
    ctx.lineWidth = yarnW * 0.55;
    ctx.beginPath();
    ctx.moveTo(cx - sw * 0.11, botY - sh * 0.05);
    ctx.quadraticCurveTo(cx, botY + sh * 0.02, cx + sw * 0.11, botY - sh * 0.05);
    ctx.stroke();

    // synthetic specular sheen
    if (sheen === 'high_sheen') {
      ctx.strokeStyle = 'rgba(255,255,255,0.30)';
      ctx.lineWidth = yarnW * 0.12;
      ctx.beginPath();
      ctx.moveTo(lxT + yarnW * 0.12, topY + sh * 0.14);
      ctx.quadraticCurveTo(cx - sw * 0.24, cy, cx, botY - yarnW * 0.1);
      ctx.stroke();
    }
  }

  /** Purl bump (rib back / recessed column) — horizontal arc, sits lower & darker. */
  _drawPurlStitch(ctx, cx, cy, sw, sh, yarnW, dyed) {
    const base = this._shadeColorCss(dyed, -0.16);
    const hi   = this._shadeColorCss(dyed,  0.08);
    ctx.lineCap = 'round';
    ctx.strokeStyle = base;
    ctx.lineWidth = yarnW * 1.05;
    ctx.beginPath();
    ctx.moveTo(cx - sw * 0.44, cy + sh * 0.06);
    ctx.quadraticCurveTo(cx, cy - sh * 0.24, cx + sw * 0.44, cy + sh * 0.06);
    ctx.stroke();
    ctx.strokeStyle = hi;
    ctx.lineWidth = yarnW * 0.38;
    ctx.beginPath();
    ctx.moveTo(cx - sw * 0.36, cy);
    ctx.quadraticCurveTo(cx, cy - sh * 0.22, cx + sw * 0.36, cy);
    ctx.stroke();
  }

  /** Miss/float — a horizontal strand lying across the face. */
  _drawFloatStitch(ctx, cx, cy, sw, sh, yarnW, dyed) {
    const base = `rgb(${dyed.r},${dyed.g},${dyed.b})`;
    const hi   = this._shadeColorCss(dyed, 0.16);
    ctx.lineCap = 'round';
    ctx.strokeStyle = base;
    ctx.lineWidth = yarnW * 0.92;
    ctx.beginPath();
    ctx.moveTo(cx - sw * 0.52, cy);
    ctx.lineTo(cx + sw * 0.52, cy);
    ctx.stroke();
    ctx.strokeStyle = hi;
    ctx.lineWidth = yarnW * 0.3;
    ctx.beginPath();
    ctx.moveTo(cx - sw * 0.5, cy - yarnW * 0.13);
    ctx.lineTo(cx + sw * 0.5, cy - yarnW * 0.13);
    ctx.stroke();
  }

  /** Fine fabric grain — very subtle salt-and-pepper for a textile (not plastic) surface. */
  _overlayGrain(ctx, W, H) {
    ctx.save();
    ctx.globalAlpha = 0.035;
    const n = Math.floor(W * H / 24);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = Math.random() < 0.5 ? '#FFFFFF' : '#000000';
      ctx.fillRect(Math.random() * W, Math.random() * H, 1, 1);
    }
    ctx.restore();
  }

  /** Gentle global light — soft top-left key, subtle falloff. Keeps colour uniform. */
  _overlaySoftLight(ctx, W, H) {
    const g = ctx.createRadialGradient(W * 0.42, H * 0.32, H * 0.1, W * 0.5, H * 0.5, H * 0.95);
    g.addColorStop(0, 'rgba(255,255,255,0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  _overlayFuzz(ctx, W, H, dyed) {
    ctx.save();
    ctx.globalAlpha = 0.22;
    const n = Math.floor(W * H / 55);
    for (let i = 0; i < n; i++) {
      const x = Math.random() * W, y = Math.random() * H;
      const a = Math.random() * Math.PI * 2, len = 2 + Math.random() * 4;
      ctx.strokeStyle = Math.random() < 0.5 ? this._shadeColorCss(dyed, 0.28) : this._shadeColorCss(dyed, -0.26);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }
    ctx.restore();
  }

  _overlayLoops(ctx, W, H, dyed, sw, sh) {
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = this._shadeColorCss(dyed, 0.18);
    ctx.lineWidth = Math.max(1, sw * 0.18);
    for (let y = sh; y < H; y += sh * 1.5) {
      for (let x = sw; x < W; x += sw * 1.5) {
        ctx.beginPath();
        ctx.arc(x, y, sw * 0.28, Math.PI, 0);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  _overlayLighting(ctx, W, H) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0,   'rgba(255,255,255,0.10)');
    g.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.addColorStop(1,   'rgba(0,0,0,0.14)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // ── dyed colour synthesis ──

  _computeDyedColor() {
    // 1) Manual dye-picker override always wins.
    if (this._userColor) { this._dyedColor = this._hexToRgb(this._userColor); this._faceCache = { front: null, back: null, brushBack: null }; return; }

    // 2) Precise color from the Color Engine (result.color_resolved.hex) — true-to-life dye.
    const resolved = this.result.color_resolved || null;
    if (resolved && resolved.hex) {
      this._dyedColor = this._hexToRgb(resolved.hex);
      this._faceCache = { front: null, back: null, brushBack: null };
      return;
    }

    // 3) Fall back to shade-mode synthesis.
    const shadeRaw = ((this.result.input || {}).color_shade
      || (this.result.input || {}).effective_shade
      || (this.result.color || {}).shade || 'medium').toString().toLowerCase();

    let L;
    if (/black|dark|navy|deep|charcoal/.test(shadeRaw))            L = 0.16;
    else if (/light|white|pastel|pale|sky|cream/.test(shadeRaw))  L = 0.80;
    else if (/fluor|neon|bright/.test(shadeRaw))                  L = 0.62;
    else                                                          L = 0.44;

    let baseHue = /fluor|neon/.test(shadeRaw)
      ? { r: 180, g: 230, b: 40 }
      : { r: 120, g: 124, b: 134 };

    const rgb = this._applyLightness(baseHue, L);

    const fiber = this._classifyFiber();
    if (fiber === 'cotton') { rgb.r += 6; rgb.b -= 4; }
    if (fiber === 'polyester' || fiber === 'nylon') { rgb.b += 6; }

    this._dyedColor = {
      r: Math.max(0, Math.min(255, Math.round(rgb.r))),
      g: Math.max(0, Math.min(255, Math.round(rgb.g))),
      b: Math.max(0, Math.min(255, Math.round(rgb.b))),
    };
  }

  _applyLightness(base, L) {
    if (L <= 0.5) {
      const t = L / 0.5;
      return { r: base.r * t, g: base.g * t, b: base.b * t };
    }
    const t = (L - 0.5) / 0.5;
    return {
      r: base.r + (255 - base.r) * t,
      g: base.g + (255 - base.g) * t,
      b: base.b + (255 - base.b) * t,
    };
  }

  _shadeColorRgb(rgb, amt) {
    // amt -1..1 ; negative => toward black, positive => toward white
    const target = amt < 0 ? 0 : 255;
    const t = Math.abs(amt);
    return {
      r: Math.round((target - rgb.r) * t + rgb.r),
      g: Math.round((target - rgb.g) * t + rgb.g),
      b: Math.round((target - rgb.b) * t + rgb.b),
    };
  }

  _shadeColorCss(rgb, amt) {
    const c = this._shadeColorRgb(rgb, amt);
    return `rgb(${c.r},${c.g},${c.b})`;
  }

  _hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  _rgbToHex(c) {
    const h = v => ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2);
    return '#' + h(c.r) + h(c.g) + h(c.b);
  }

  _syncColorInput() {
    const inp = this.container.querySelector('#viz-color-input');
    if (inp) inp.value = this._rgbToHex(this._dyedColor);
  }

  _ribRepeat(id) {
    const m = id.match(/(\d+)\s*x\s*\d+/);
    if (m) return Math.max(1, parseInt(m[1]));
    return 1;
  }

  _panelMsg(wrap, msg) {
    wrap.innerHTML = `<p style="font-family:var(--mono);font-size:11px;color:var(--t3);padding:12px 4px;">${msg}</p>`;
  }

  _buildPropertiesMapFromResult() {
    const tf = (this.result.physical_constraints || {}).tightness_factor || 14;
    const spirality = (this.result.quality_prediction || {}).spirality || {};
    const shrinkage = (this.result.quality_prediction || {}).shrinkage || {};
    const zone = tf < 12 ? 'slack' : tf > 16 ? 'tight' : 'balanced';
    const colors = { slack: '#F59E0B', balanced: '#10B981', tight: '#EF4444' };
    return {
      tightness: { value: Math.round(tf * 100) / 100, zone, color: colors[zone] },
      spirality: {
        angle_deg: spirality.skewness_angle || 0,
        risk: spirality.risk_level || 'low',
        arrowAngle_rad: ((spirality.skewness_angle || 0) * Math.PI) / 180,
      },
      shrinkage: {
        lengthwise: { pct: shrinkage.lengthwise_pct || 0, arrowLength_normalized: Math.min((shrinkage.lengthwise_pct || 0) / 15, 1) },
        widthwise:  { pct: shrinkage.widthwise_pct  || 0, arrowLength_normalized: Math.min((shrinkage.widthwise_pct  || 0) / 15, 1) },
      },
    };
  }

  // ─────────────────────────────────────────────────────────
  // DOM BUILDER
  // ─────────────────────────────────────────────────────────

  _buildSectionDOM() {
    this.container.innerHTML = `
      <div class="viz-tab-bar">
        <button class="viz-tab active" data-tab="realistic">Realistic Fabric</button>
        <button class="viz-tab" data-tab="threed">3D View</button>
        <button class="viz-tab" data-tab="stitch">Stitch Structure</button>
        <button class="viz-tab" data-tab="cross">Cross-Section</button>
        <button class="viz-tab" data-tab="props">Properties Map</button>
      </div>
      <div class="viz-panel active" data-panel="realistic">
        <div class="viz-canvas-wrap" data-wrap="realistic"></div>
      </div>
      <div class="viz-panel" data-panel="threed">
        <div class="viz-canvas-wrap" data-wrap="threed"></div>
      </div>
      <div class="viz-panel" data-panel="stitch">
        <div class="viz-canvas-wrap" data-wrap="stitch"></div>
      </div>
      <div class="viz-panel" data-panel="cross">
        <div class="viz-cross-wrap" id="viz-svg-cross"></div>
      </div>
      <div class="viz-panel" data-panel="props">
        <div class="viz-canvas-wrap" data-wrap="props"></div>
      </div>
      <div class="viz-toolbar">
        <label class="viz-color" title="Dyed colour — change to preview any shade">
          <span>Dye</span>
          <input type="color" id="viz-color-input" value="#606470">
        </label>
        <span class="viz-info" id="viz-info-text">Rendering…</span>
        <button class="viz-btn" id="viz-export-png">Export PNG</button>
        <button class="viz-btn" id="viz-export-svg">Export SVG</button>
      </div>
    `;

    this.svgWrap = this.container.querySelector('#viz-svg-cross');

    // Tab switching
    this.container.querySelectorAll('.viz-tab').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    // Dye colour picker — recompute and re-render the realistic swatch
    const colorInput = this.container.querySelector('#viz-color-input');
    if (colorInput) {
      colorInput.addEventListener('input', () => {
        this._userColor = colorInput.value;
        this._computeDyedColor();
        if (this.activeTab !== 'realistic') this.switchTab('realistic');
        else this._renderRealisticView();
      });
    }

    // Export buttons
    this.container.querySelector('#viz-export-png').addEventListener('click', () => this.exportPng());
    this.container.querySelector('#viz-export-svg').addEventListener('click', () => this.exportSvg());
  }

  _showLoading(on) {
    const panels = this.container.querySelectorAll('.viz-panel');
    if (on) {
      panels.forEach(p => {
        p.innerHTML = '<div class="skeleton skel-line w90" style="margin:8px 0"></div><div class="skeleton skel-line w70"></div>';
      });
    }
  }

  _showError(msg) {
    this.container.innerHTML = `<p style="color:var(--a3);font-family:var(--mono);font-size:12px;padding:8px 0;">${msg}</p>`;
  }
}

// Expose globally — a top-level `class` declaration does NOT attach to
// window automatically (unlike `function`), so result.html's
// `window.FabricVisualizer` check would otherwise fail.
if (typeof window !== 'undefined') {
  window.FabricVisualizer = FabricVisualizer;
}
