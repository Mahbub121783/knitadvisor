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
    // free the WebGL context when leaving the 3D tab (browsers cap live contexts)
    if (this.activeTab === 'threed' && tabName !== 'threed' && this._fabric3d) {
      try { this._fabric3d.dispose(); } catch (_) {}
      this._fabric3d = null;
    }
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
    if (this._fabric3d) { try { this._fabric3d.dispose(); } catch (_) {} this._fabric3d = null; }
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
    const opts = this._faceOpts();
    this._loupe = this._loupe || { zoom: 1, fu: 0.5, fv: 0.5 };
    const MIN = 1, MAX = 9;

    const holder = document.createElement('div');
    holder.className = 'ka-loupe';
    holder.innerHTML = `
      <div class="ka-loupe-bar">
        <button class="ka-loupe-btn" data-act="out">–</button>
        <span class="ka-loupe-zoom" id="ka-loupe-zoom">1.0×</span>
        <button class="ka-loupe-btn" data-act="in">+</button>
        <button class="ka-loupe-btn" data-act="reset" title="Fit">Fit</button>
        <span class="ka-loupe-tip">Click to zoom into a point · scroll to magnify · drag to pan</span>
      </div>
      <div class="ka-loupe-stage"></div>`;
    wrap.appendChild(holder);
    this._injectLoupeCss();

    const stageEl = holder.querySelector('.ka-loupe-stage');
    const canvas = document.createElement('canvas');
    canvas.className = 'viz-canvas';
    canvas.width = W * SS; canvas.height = H * SS;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    canvas.style.borderRadius = '10px'; canvas.style.cursor = 'zoom-in';
    stageEl.appendChild(canvas);
    this.canvases.realistic = canvas;
    const ctx = canvas.getContext('2d');

    const zoomEl = holder.querySelector('#ka-loupe-zoom');
    const paint = () => {
      const l = this._loupe;
      l.fu = Math.max(0.04, Math.min(0.96, l.fu));
      l.fv = Math.max(0.04, Math.min(0.96, l.fv));
      ctx.setTransform(SS, 0, 0, SS, 0, 0);
      this._paintFabricFace(ctx, W, H, 'front', opts, l);
      zoomEl.textContent = l.zoom.toFixed(1) + '×';
      canvas.style.cursor = l.zoom >= MAX ? 'zoom-out' : 'zoom-in';
    };

    // map a screen point on the canvas → fabric focal [0,1]
    const ptToFocal = (sx, sy) => {
      const g = this._gridGeom(W, H, opts, this._loupe);
      const waleF = g.leftWaleF + sx / g.cellW;
      const courseF = g.botCourseF + (H - sy) / g.cellH;
      return { fu: waleF / this._TOTAL_W, fv: courseF / this._TOTAL_C };
    };
    const zoomAt = (sx, sy, factor) => {
      const before = ptToFocal(sx, sy);
      const l = this._loupe;
      l.zoom = Math.max(MIN, Math.min(MAX, l.zoom * factor));
      // keep the point under the cursor fixed
      const g = this._gridGeom(W, H, opts, l);
      const waleF = before.fu * this._TOTAL_W, courseF = before.fv * this._TOTAL_C;
      l.fu = (waleF - sx / g.cellW + g.visW / 2) / this._TOTAL_W;
      l.fv = (courseF - (H - sy) / g.cellH + g.visC / 2) / this._TOTAL_C;
      paint();
    };

    const rel = (e) => {
      const r = canvas.getBoundingClientRect();
      const p = e.touches ? e.touches[0] : e;
      return { x: (p.clientX - r.left), y: (p.clientY - r.top) };
    };

    let dragging = false, moved = false, lx = 0, ly = 0;
    canvas.addEventListener('mousedown', (e) => { dragging = true; moved = false; const p = rel(e); lx = p.x; ly = p.y; });
    canvas.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const p = rel(e), g = this._gridGeom(W, H, opts, this._loupe);
      if (Math.abs(p.x - lx) + Math.abs(p.y - ly) > 2) moved = true;
      this._loupe.fu -= (p.x - lx) / g.cellW / this._TOTAL_W;
      this._loupe.fv += (p.y - ly) / g.cellH / this._TOTAL_C;
      lx = p.x; ly = p.y; paint();
    });
    window.addEventListener('mouseup', () => { dragging = false; });
    canvas.addEventListener('click', (e) => {
      if (moved) return;                       // was a drag, not a click
      const p = rel(e);
      if (this._loupe.zoom >= MAX) { this._loupe = { zoom: 1, fu: 0.5, fv: 0.5 }; paint(); return; }
      const f = ptToFocal(p.x, p.y);
      this._loupe.fu = f.fu; this._loupe.fv = f.fv;
      zoomAt(W / 2, H / 2, 2.2);               // focal already centered → just magnify
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = rel(e);
      zoomAt(p.x, p.y, e.deltaY < 0 ? 1.18 : 0.85);
    }, { passive: false });

    holder.querySelector('.ka-loupe-bar').addEventListener('click', (e) => {
      const act = e.target.getAttribute('data-act'); if (!act) return;
      if (act === 'in') zoomAt(W / 2, H / 2, 1.4);
      else if (act === 'out') zoomAt(W / 2, H / 2, 0.7);
      else { this._loupe = { zoom: 1, fu: 0.5, fv: 0.5 }; paint(); }
    });

    paint();
    this._updateInfoLine(opts);
  }

  _injectLoupeCss() {
    if (document.getElementById('ka-loupe-style')) return;
    const css = `
    .ka-loupe{display:flex;flex-direction:column;gap:8px;width:100%;}
    .ka-loupe-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
    .ka-loupe-btn{font:600 12px/1 var(--mono,monospace);min-width:30px;padding:6px 10px;border-radius:7px;cursor:pointer;
      border:1px solid rgba(0,0,0,.14);background:#fff;color:#333;transition:all .15s;}
    .ka-loupe-btn:hover{border-color:#5b8def;color:#2563eb;}
    .ka-loupe-zoom{font:600 12px var(--mono,monospace);color:#2563eb;min-width:38px;text-align:center;}
    .ka-loupe-tip{font:10px var(--mono,monospace);color:#9aa;margin-left:6px;}
    .ka-loupe-stage{display:flex;justify-content:center;overflow:hidden;border-radius:10px;}`;
    const s = document.createElement('style');
    s.id = 'ka-loupe-style'; s.textContent = css;
    document.head.appendChild(s);
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
      pattern:   this._patternMatrix(),
    };
  }

  // The real K/T/M needle action matrix (pattern_cylinder) drives tuck/miss
  // placement so the rendered structure matches the actual stitch programme.
  _patternMatrix() {
    const p = this.result.pattern || {};
    const grid = p.pattern_cylinder;
    if (Array.isArray(grid) && grid.length && Array.isArray(grid[0]) && grid[0].length) {
      // only meaningful if it actually contains tuck/miss (else it's plain knit)
      const hasTM = grid.some(row => row.some(c => c === 'T' || c === 'M'));
      if (hasTM) return { grid, rows: grid.length, cols: grid[0].length };
    }
    return null;
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
    if (has('pique', 'piqué', 'lacoste')) {
      let plabel = 'piqué';
      if (has('honeycomb')) plabel = 'honeycomb piqué';
      else if (has('double') && has('pique', 'piqué')) plabel = 'double piqué';
      else if (has('lacoste')) plabel = has('double') ? 'double lacoste' : 'single lacoste';
      return { type: 'pique', base: 'single', label: plabel, mesh: false, brush: false };
    }
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
  // view = { zoom, fu, fv } — fu/fv are focal point in fabric space [0,1].
  // The painter is a MACRO LENS: higher zoom = bigger loops = more anatomy
  // revealed (LOD), not a stretched bitmap. Front & back differ per knit.
  _paintFabricFace(ctx, W, H, side, opts, view) {
    view = view || { zoom: 1, fu: 0.5, fv: 0.5 };
    const { dyed, construction: con } = opts;
    const brushed = side === 'back' && (this._three.brush || con.brush);

    // ground (deep valley colour between yarns)
    ctx.fillStyle = this._shadeColorCss(dyed, -0.44);
    ctx.fillRect(0, 0, W, H);

    if (brushed) { this._paintBrushedPile(ctx, W, H, dyed, opts, view); this._overlaySoftLight(ctx, W, H); return; }
    if (con.type === 'terry' && side === 'back') { this._paintLoopPile(ctx, W, H, dyed, opts, view); return; }
    if (con.type === 'mesh' || con.type === 'spacer') { this._paintMeshField(ctx, W, H, side, opts, view); this._overlaySoftLight(ctx, W, H); return; }
    if (con.type === 'tricot') { this._paintTricotField(ctx, W, H, side, opts, view); this._overlaySoftLight(ctx, W, H); return; }

    this._paintKnitField(ctx, W, H, side, opts, view);
    this._overlayGrain(ctx, W, H);
    this._overlaySoftLight(ctx, W, H);
  }

  // Virtual swatch dimensions (for seamless panning at any focal point)
  get _TOTAL_W() { return 160; }
  get _TOTAL_C() { return 200; }

  /** Cell geometry + visible stitch window for a given zoom/focal. */
  _gridGeom(W, H, opts, view) {
    const con = opts.construction, countNe = opts.countNe;
    // wales visible at zoom 1 — denser (finer yarn → more wales) so the
    // zoomed-out view reads like real cloth; zooming in enlarges each loop.
    let walesZ1 = Math.min(Math.max(20 + countNe * 0.85, 30), 58);
    if (con.type === 'interlock') walesZ1 *= 1.25;
    else if (con.type === 'rib')  walesZ1 *= 0.8;
    else if (con.type === 'pique') walesZ1 *= 0.85;
    const cellW = (W / walesZ1) * view.zoom;
    // loop elongation from tightness — a slacker fabric (low TF / long stitch
    // length) has taller, more open loops; a tight fabric has short dense loops.
    const tf = typeof opts.tf === 'number' ? opts.tf : 14;
    const elong = Math.max(0.72, Math.min(1.0 + (14 - tf) * 0.028, 1.18));
    const aspect = (con.type === 'rib' ? 0.98 : con.type === 'pique' ? 1.0 : 0.82) * elong;
    const cellH = cellW * aspect;
    const visW = W / cellW, visC = H / cellH;
    const leftWaleF = view.fu * this._TOTAL_W - visW / 2;
    const botCourseF = view.fv * this._TOTAL_C - visC / 2;
    return { cellW, cellH, leftWaleF, botCourseF, visW, visC, lod: cellW };
  }

  /** Stitch token at a wale/course for a face. Front & back are intentionally
   *  different (knit V ↔ purl bump), giving real two-sided fabric.
   *  Tuck/miss come from the real K/T/M needle matrix when available. */
  _tokenAt(w, c, side, opts) {
    const con = opts.construction;
    const mod = (n, m) => ((n % m) + m) % m;
    // 1) structural knit/purl from the construction (rib columns, interlock…)
    let front;
    switch (con.type) {
      case 'rib': {
        const rep = con.ribRepeat || 1;
        front = mod(w, rep * 2) < rep ? 'knit' : 'purl';
        break;
      }
      case 'interlock': front = 'knit'; break;          // interlock: knit both faces
      default: front = 'knit';
    }
    // 2) overlay the real K/T/M programme (tuck/miss) onto knit cells
    if (front === 'knit') {
      const pat = opts.pattern;
      if (pat && pat.grid) {
        const cell = pat.grid[mod(c, pat.rows)][mod(w, pat.cols)] || 'K';
        if (cell === 'T') front = 'tuck';
        else if (cell === 'M') front = 'miss';
      } else if (con.type === 'pique') {
        // synthetic honeycomb tuck lattice when no matrix is supplied
        front = (mod(w, 2) === mod(c, 2)) ? 'tuck' : 'knit';
      }
    }
    // 3) interlock keeps knit on the back too; others flip knit↔purl
    if (side === 'back' && con.type !== 'interlock') {
      if (front === 'knit') return 'purl';
      if (front === 'purl') return 'knit';
    }
    return front;
  }

  // ── UNIVERSAL KNIT FIELD (jersey / rib / interlock / piqué) ──
  _paintKnitField(ctx, W, H, side, opts, view) {
    const dyed = opts.dyed, con = opts.construction;
    const g = this._gridGeom(W, H, opts, view);
    const xOf = (w) => (w - g.leftWaleF) * g.cellW + g.cellW / 2;
    const yOf = (c) => H - ((c - g.botCourseF) * g.cellH + g.cellH / 2);
    const w0 = Math.floor(g.leftWaleF) - 1, w1 = Math.ceil(g.leftWaleF + g.visW) + 1;
    const c0 = Math.floor(g.botCourseF) - 1, c1 = Math.ceil(g.botCourseF + g.visC) + 1;
    const cw = g.cellW, ch = g.cellH;
    const yw = this._yarnWidth(cw, opts);

    // rib: shade the sunken purl wales for depth
    if (con.type === 'rib') {
      for (let w = w0; w <= w1; w++) {
        if (this._tokenAt(w, 0, side, opts) === 'purl') {
          ctx.fillStyle = this._shadeColorCss(dyed, -0.34);
          ctx.fillRect(xOf(w) - cw / 2, 0, cw, H);
        }
      }
    }

    // collect knit cells; purl/tuck/miss are self-contained and drawn first
    const knit = [], miss = [];
    for (let c = c0; c <= c1; c++) {
      for (let w = w0; w <= w1; w++) {
        const tok = this._tokenAt(w, c, side, opts);
        const x = xOf(w), y = yOf(c);
        if (tok === 'purl')      this._drawPurlLOD(ctx, x, y, cw, ch, dyed, opts);
        else if (tok === 'tuck') this._drawTuckLOD(ctx, x, y, cw, ch, dyed, opts);
        else if (tok === 'miss') { this._drawHeldLoop(ctx, x, y, cw, ch, dyed, opts); miss.push([x, y, c]); }
        else                     knit.push([x, y]);
      }
    }

    // The visible stockinette face = columns of interlocking "V" loops.
    //   • Always draw the loop LEGS (the V columns) — this is what reads as knit.
    //   • Only at high zoom add the HEAD arch + SINKER connectors so the full
    //     needle-loop anatomy is revealed (macro lens), WITHOUT turning the
    //     normal view into a field of scales.
    const anatomy = cw >= 46;
    if (anatomy) {
      // MACRO: one continuous needle loop per stitch (foot→leg→head→leg→foot).
      // Draw top-of-screen first so each lower loop's head is painted ON TOP of
      // the upper loop's feet — the real over/under intermesh, cleanly.
      const ordered = knit.slice().sort((a, b) => a[1] - b[1]);
      for (const [x, y] of ordered)
        this._strokeYarn(ctx, (dx, dy) => this._knitLoopFullPath(ctx, x, y, cw, ch, dx, dy), yw, dyed, opts);
    } else {
      // NORMAL: the stockinette "V" columns — what reads as knit cloth.
      for (const [x, y] of knit) this._strokeYarn(ctx, (dx, dy) => this._knitLegsPath(ctx, x, y, cw, ch, dx, dy, false), yw, dyed, opts);
    }

    // miss/float yarn lies straight ON TOP, across the held loops
    for (const [x, y] of miss) this._strokeYarn(ctx, (dx, dy) => {
      ctx.moveTo(x - cw * 0.56 + dx, y - ch * 0.04 + dy);
      ctx.quadraticCurveTo(x + dx, y - ch * 0.10 + dy, x + cw * 0.56 + dx, y - ch * 0.04 + dy);
    }, yw * 0.96, dyed, opts);

    // fine fibre/ply detail only when zoomed enough to see it
    if (cw > 44 && (opts.fiberType === 'cotton' || opts.fiberType === 'modal' || opts.fiberType === 'viscose'))
      for (const [x, y] of knit) this._plyTwist(ctx, x, y, cw, ch, yw, dyed);

    // piqué honeycomb pillow relief on the technical face
    if (con.type === 'pique' && side === 'front') this._overlayWaffle(ctx, W, H, g, dyed);
  }

  // a held (elongated) loop — the loop a missed needle keeps for extra courses
  _drawHeldLoop(ctx, cx, cy, cw, ch, dyed, opts) {
    const yw = this._yarnWidth(cw, opts);
    this._strokeYarn(ctx, (dx, dy) => this._knitSinkerPath(ctx, cx, cy, cw, ch, dx, dy), yw * 0.82, dyed, opts);
    this._strokeYarn(ctx, (dx, dy) => this._knitLegsPath(ctx, cx, cy + ch * 0.04, cw * 0.86, ch * 1.12, dx, dy), yw, dyed, opts);
    this._strokeYarn(ctx, (dx, dy) => this._knitHeadPath(ctx, cx, cy + ch * 0.04, cw * 0.86, ch * 1.12, dx, dy), yw * 0.96, dyed, opts);
  }

  // yarn line width from tightness factor (tighter cloth → fuller coverage)
  _yarnWidth(cw, opts) {
    const tf = typeof opts.tf === 'number' ? opts.tf : 14;
    const cover = Math.max(0.32, Math.min(0.40 + (tf - 14) * 0.012, 0.50));
    return Math.max(1.2, cw * cover);
  }

  // ── Stockinette "V" loop legs ──
  // Two arms span the cell from the top shoulders to a bottom point, forming
  // the classic knit V. The bottom point nestles between the arms of the loop
  // below (continuous wale columns). `wide` opens the shoulders toward the
  // neighbouring wales at high zoom so the loop heads can clasp them.
  _knitLegsPath(ctx, cx, cy, cw, ch, dx, dy, wide) {
    dx = dx || 0; dy = dy || 0;
    const shX = cw * (wide ? 0.50 : 0.48);
    const topY = cy - ch * 0.52 + dy, botY = cy + ch * 0.54 + dy;
    const lx = cx - shX + dx, rx = cx + shX + dx, mid = cx + dx;
    // arms curve in to a soft bottom point (not a sharp spike → less dark gap)
    ctx.moveTo(lx, topY);
    ctx.bezierCurveTo(cx - cw * 0.34 + dx, cy - ch * 0.06 + dy, mid - cw * 0.05 + dx, cy + ch * 0.26 + dy, mid, botY);
    ctx.moveTo(rx, topY);
    ctx.bezierCurveTo(cx + cw * 0.34 + dx, cy - ch * 0.06 + dy, mid + cw * 0.05 + dx, cy + ch * 0.26 + dy, mid, botY);
  }

  // head: the loop top that arches over the shoulders (revealed at high zoom).
  _knitHeadPath(ctx, cx, cy, cw, ch, dx, dy) {
    dx = dx || 0; dy = dy || 0;
    const shX = cw * 0.46, topY = cy - ch * 0.48 + dy, crown = cy - ch * 0.74 + dy;
    ctx.moveTo(cx - shX + dx, topY);
    ctx.bezierCurveTo(cx - shX * 0.7 + dx, crown, cx + shX * 0.7 + dx, crown, cx + shX + dx, topY);
  }

  // ── ONE continuous needle loop (macro view) ── foot → left leg → head arch
  // → right leg → foot. Legs splay to two separate feet; the loop below's head
  // rises between them. Drawn as a single yarn path so it reads as a real loop.
  _knitLoopFullPath(ctx, cx, cy, cw, ch, dx, dy) {
    dx = dx || 0; dy = dy || 0;
    const footX = cw * 0.24, footY = cy + ch * 0.56 + dy;
    const shX = cw * 0.40, shY = cy - ch * 0.28 + dy;
    const crown = cy - ch * 0.60 + dy;
    ctx.moveTo(cx - footX + dx, footY);
    // left leg up to shoulder
    ctx.bezierCurveTo(cx - cw * 0.40 + dx, cy + ch * 0.06 + dy, cx - shX - cw * 0.02 + dx, cy - ch * 0.08 + dy, cx - shX + dx, shY);
    // head arch over the top
    ctx.bezierCurveTo(cx - shX * 0.86 + dx, crown, cx + shX * 0.86 + dx, crown, cx + shX + dx, shY);
    // right leg down to foot
    ctx.bezierCurveTo(cx + shX + cw * 0.02 + dx, cy - ch * 0.08 + dy, cx + cw * 0.40 + dx, cy + ch * 0.06 + dy, cx + footX + dx, footY);
  }

  // sinker loop: short connector between this loop's foot and the next wale's,
  // sitting just behind the needle loops (revealed at high zoom).
  _knitSinkerPath(ctx, cx, cy, cw, ch, dx, dy) {
    dx = dx || 0; dy = dy || 0;
    const botY = cy + ch * 0.50 + dy;
    ctx.moveTo(cx + dx, botY);
    ctx.quadraticCurveTo(cx + cw * 0.5 + dx, botY + ch * 0.16, cx + cw + dx, botY);
  }

  // round-yarn stroke: cast shadow + body + core shade + top-left specular,
  // so the yarn reads as a lit cylinder rather than a flat line.
  _strokeYarn(ctx, build, yw, dyed, opts) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // soft contact shadow (down-right) — depth without harsh banding
    ctx.strokeStyle = this._shadeColorCss(dyed, -0.26); ctx.lineWidth = yw * 1.22;
    ctx.beginPath(); build(yw * 0.08, yw * 0.14); ctx.stroke();
    // yarn body
    ctx.strokeStyle = `rgb(${dyed.r},${dyed.g},${dyed.b})`; ctx.lineWidth = yw;
    ctx.beginPath(); build(0, 0); ctx.stroke();
    if (yw < 1.8) return;                 // tiny loops (zoomed out): keep it cheap & crisp
    // lower-right core shade for tube roundness (dye sits deeper here)
    ctx.strokeStyle = this._shadeColorCss(dyed, -0.13); ctx.lineWidth = yw * 0.5;
    ctx.beginPath(); build(yw * 0.12, yw * 0.12); ctx.stroke();
    // upper-left specular highlight (rounded lit yarn)
    ctx.strokeStyle = this._shadeColorCss(dyed, 0.32); ctx.lineWidth = yw * 0.30;
    ctx.beginPath(); build(-yw * 0.18, -yw * 0.16); ctx.stroke();
    if (opts.sheen === 'high_sheen') {
      ctx.strokeStyle = 'rgba(255,255,255,0.34)'; ctx.lineWidth = yw * 0.12;
      ctx.beginPath(); build(-yw * 0.2, -yw * 0.17); ctx.stroke();
    }
  }

  // short diagonal fibre striations along the legs (combed-cotton ply twist)
  _plyTwist(ctx, cx, cy, cw, ch, yw, dyed) {
    ctx.save();
    ctx.strokeStyle = this._shadeColorCss(dyed, 0.12);
    ctx.lineWidth = Math.max(0.5, yw * 0.09);
    ctx.globalAlpha = 0.45;
    const sx = cw * 0.46, shY = cy - ch * 0.34, botY = cy + ch * 0.58;
    for (let t = 0.18; t < 0.92; t += 0.14) {
      const lxp = (cx - sx) + (cx - (cx - sx)) * t, ly = shY + (botY - shY) * t;
      ctx.beginPath();
      ctx.moveTo(lxp - yw * 0.4, ly + yw * 0.3); ctx.lineTo(lxp + yw * 0.4, ly - yw * 0.3);
      const rxp = (cx + sx) + (cx - (cx + sx)) * t;
      ctx.moveTo(rxp - yw * 0.4, ly - yw * 0.3); ctx.lineTo(rxp + yw * 0.4, ly + yw * 0.3);
      ctx.stroke();
    }
    ctx.restore();
  }

  // solo knit loop (sinker + legs + head) for mesh ground / tuck interiors
  _drawKnitLoopSolo(ctx, cx, cy, cw, ch, dyed, opts) {
    const yw = this._yarnWidth(cw, opts);
    this._strokeYarn(ctx, (dx, dy) => this._knitSinkerPath(ctx, cx, cy, cw, ch, dx, dy), yw * 0.82, dyed, opts);
    this._strokeYarn(ctx, (dx, dy) => this._knitLegsPath(ctx, cx, cy, cw, ch, dx, dy), yw, dyed, opts);
    this._strokeYarn(ctx, (dx, dy) => this._knitHeadPath(ctx, cx, cy, cw, ch, dx, dy), yw * 0.96, dyed, opts);
  }

  // ── purl loop (technical back) — the SINKER half-moons + loop heads that
  //    show on the reverse. Rows of nested half-moons (∩) — the opposite face
  //    of the knit "V" columns. LOD adds the depth between bumps.
  _drawPurlLOD(ctx, cx, cy, cw, ch, dyed, opts) {
    const yw = Math.max(1.1, cw * 0.32);
    // recess shadow under the half-moon
    this._strokeYarn(ctx, (dx, dy) => {
      ctx.moveTo(cx - cw * 0.5 + dx, cy + ch * 0.22 + dy);
      ctx.quadraticCurveTo(cx + dx, cy + ch * 0.50 + dy, cx + cw * 0.5 + dx, cy + ch * 0.22 + dy);
    }, yw * 0.9, dyed, opts);
    // the prominent half-moon bump lying across the wale
    this._strokeYarn(ctx, (dx, dy) => {
      ctx.moveTo(cx - cw * 0.5 + dx, cy + ch * 0.10 + dy);
      ctx.quadraticCurveTo(cx + dx, cy - ch * 0.40 + dy, cx + cw * 0.5 + dx, cy + ch * 0.10 + dy);
    }, yw * 1.04, dyed, opts);
  }

  // ── tuck stitch — the needle held its old loop AND took a new yarn, so the
  //    loop is elongated and a tuck yarn is caught beneath as a ∪. (ref. fig 6.6)
  _drawTuckLOD(ctx, cx, cy, cw, ch, dyed, opts) {
    const yw = this._yarnWidth(cw, opts);
    // the caught tuck yarn ( ∪ ) sitting under the held loop, drawn first/behind
    this._strokeYarn(ctx, (dx, dy) => {
      ctx.moveTo(cx - cw * 0.46 + dx, cy + ch * 0.06 + dy);
      ctx.quadraticCurveTo(cx + dx, cy + ch * 0.46 + dy, cx + cw * 0.46 + dx, cy + ch * 0.06 + dy);
    }, yw * 0.92, dyed, opts);
    // the elongated held needle loop (taller than a normal loop)
    this._strokeYarn(ctx, (dx, dy) => this._knitLegsPath(ctx, cx, cy - ch * 0.10, cw * 0.92, ch * 1.18, dx, dy), yw, dyed, opts);
    this._strokeYarn(ctx, (dx, dy) => this._knitHeadPath(ctx, cx, cy - ch * 0.10, cw * 0.92, ch * 1.18, dx, dy), yw * 0.96, dyed, opts);
  }

  // ── honeycomb / waffle relief for piqué technical face ──
  _overlayWaffle(ctx, W, H, g, dyed) {
    const pw = g.cellW * 2, ph = g.cellH * 2;
    if (pw < 8) return;
    const xStart = -((g.leftWaleF % 2) * g.cellW) - pw;
    const yStart = (H + ((g.botCourseF % 2) * g.cellH)) % ph - ph;
    ctx.save();
    for (let py = yStart; py < H + ph; py += ph) {
      for (let px = xStart; px < W + pw; px += pw) {
        const cx = px + pw / 2, cy = py + ph / 2;
        // raised pillow highlight
        const grd = ctx.createRadialGradient(cx - pw * 0.12, cy - ph * 0.12, pw * 0.05, cx, cy, pw * 0.6);
        grd.addColorStop(0, 'rgba(255,255,255,0.13)');
        grd.addColorStop(0.6, 'rgba(255,255,255,0.02)');
        grd.addColorStop(1, 'rgba(0,0,0,0.16)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.ellipse(cx, cy, pw * 0.46, ph * 0.46, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // dark grooves between pillows
    ctx.strokeStyle = this._shadeColorCss(dyed, -0.40);
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = Math.max(1, g.cellW * 0.18);
    for (let px = xStart; px < W + pw; px += pw) {
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
    }
    for (let py = yStart; py < H + ph; py += ph) {
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke();
    }
    ctx.restore();
  }

  // ── MESH / AIRTEX / POINTELLE — knit ground perforated with regular holes,
  //    zoom-aware so the eyelets magnify with the loops. ──
  _paintMeshField(ctx, W, H, side, opts, view) {
    const dyed = opts.dyed;
    const g = this._gridGeom(W, H, opts, view);
    const xOf = (w) => (w - g.leftWaleF) * g.cellW + g.cellW / 2;
    const yOf = (c) => H - ((c - g.botCourseF) * g.cellH + g.cellH / 2);
    const w0 = Math.floor(g.leftWaleF) - 1, w1 = Math.ceil(g.leftWaleF + g.visW) + 1;
    const c0 = Math.floor(g.botCourseF) - 1, c1 = Math.ceil(g.botCourseF + g.visC) + 1;

    // plain knit ground (front V / back purl)
    for (let c = c0; c <= c1; c++)
      for (let w = w0; w <= w1; w++) {
        if (side === 'back') this._drawPurlLOD(ctx, xOf(w), yOf(c), g.cellW, g.cellH, dyed, opts);
        else                 this._drawKnitLoopSolo(ctx, xOf(w), yOf(c), g.cellW, g.cellH, dyed, opts);
      }

    // hole lattice locked to the fabric grid (stable while panning/zooming)
    const stepW = 2.4, stepC = 2.6;
    const holeShape = opts.construction.holeShape || 'round';
    const rOut = Math.min(g.cellW * stepW, g.cellH * stepC) * 0.42;
    const yw = Math.max(1.1, g.cellW * 0.30);
    const i0 = Math.floor(g.leftWaleF / stepW) - 1, i1 = Math.ceil((g.leftWaleF + g.visW) / stepW) + 1;
    const j0 = Math.floor(g.botCourseF / stepC) - 1, j1 = Math.ceil((g.botCourseF + g.visC) / stepC) + 1;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const waleF = i * stepW + (((j % 2) + 2) % 2) * stepW / 2;
        const courseF = j * stepC;
        this._punchHole(ctx, xOf(waleF) - g.cellW / 2, yOf(courseF) + g.cellH / 2, rOut, holeShape, dyed, yw);
      }
    }
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

  // ── TRICOT (warp knit) — vertical wales of fine zig-zag loops (zoom-aware) ──
  _paintTricotField(ctx, W, H, side, opts, view) {
    const dyed = opts.dyed;
    const g = this._gridGeom(W, H, opts, view);
    const sw = g.cellW, sh = g.cellH;
    const yarnW = Math.max(1.1, sw * 0.30);
    const base = `rgb(${dyed.r},${dyed.g},${dyed.b})`;
    const hi = this._shadeColorCss(dyed, 0.20), dk = this._shadeColorCss(dyed, -0.26);
    const xOf = (w) => (w - g.leftWaleF) * sw + sw / 2;
    const yOff = ((g.botCourseF % 1) + 1) % 1 * sh;
    const w0 = Math.floor(g.leftWaleF) - 1, w1 = Math.ceil(g.leftWaleF + g.visW) + 1;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let w = w0; w <= w1; w++) {
      const cx = xOf(w);
      ctx.strokeStyle = side === 'back' ? dk : base;
      ctx.lineWidth = yarnW;
      ctx.beginPath();
      for (let y = -sh - yOff; y < H + sh; y += sh) {
        const wob = side === 'back' ? sw * 0.42 : sw * 0.22;
        ctx.moveTo(cx - wob, y);
        ctx.quadraticCurveTo(cx, y + sh * 0.5, cx + wob, y + sh);
      }
      ctx.stroke();
      ctx.strokeStyle = hi; ctx.lineWidth = yarnW * 0.32;
      ctx.beginPath();
      for (let y = -sh - yOff; y < H + sh; y += sh) {
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
  // True 3D (WebGL) fabric view for core weft knits; falls back to the CSS
  // cube for other constructions or if WebGL / the module fails to load.
  _render3DView() {
    const wrap = this.container.querySelector('.viz-canvas-wrap[data-wrap="threed"]');
    if (!wrap) return;
    wrap.innerHTML = '';

    const opts = this._faceOpts();
    const con = opts.construction;
    const WEBGL_TYPES = ['jersey', 'rib', 'interlock', 'pique', 'terry', 'fleece'];
    const webglOk = (() => {
      try { return !!window.WebGLRenderingContext && !!document.createElement('canvas').getContext('webgl'); }
      catch (_) { return false; }
    })();

    if (!webglOk || !WEBGL_TYPES.includes(con.type)) {
      this._renderCubeFallback();
      return;
    }

    // build stage: controls bar + mount point
    const stage = document.createElement('div');
    stage.className = 'ka3dgl-stage';
    stage.innerHTML = `
      <div class="ka3d-controls">
        <button class="ka3d-btn" data-act="front">Front</button>
        <button class="ka3d-btn" data-act="back">Back</button>
        <button class="ka3d-btn" data-act="reset" title="Reset view">⟳</button>
        <button class="ka3d-btn" data-act="wire" title="Show loop paths">Loops</button>
        <span class="ka3d-hint" style="margin-left:6px">Drag to orbit · scroll to zoom · real 3-D yarn loops</span>
      </div>
      <div class="ka3dgl-mount"></div>
      <div class="ka3dgl-loading" style="font:11px var(--mono,monospace);color:var(--t3,#778);padding:6px 2px;">Loading 3-D engine…</div>`;
    wrap.appendChild(stage);
    this._injectThreeCss();

    const mount = stage.querySelector('.ka3dgl-mount');
    const loading = stage.querySelector('.ka3dgl-loading');

    // tokens for the patch come from the same K/T/M logic as the 2D view
    const sample = (w, c) => this._tokenAt(w, c, 'front', opts);
    const glOpts = {
      dyed: this._dyedColor, construction: con, countNe: opts.countNe,
      tf: opts.tf, fiberType: opts.fiberType, sheen: opts.sheen, sample,
    };

    import('/js/fabric-3d.js?v=20260607e').then(({ Fabric3D }) => {
      if (this._destroyed || this.activeTab !== 'threed') return;
      if (this._fabric3d) { try { this._fabric3d.dispose(); } catch (_) {} }
      this._fabric3d = new Fabric3D();
      this._fabric3d.mount(mount, glOpts);
      loading.remove();
      stage.querySelector('.ka3d-controls').addEventListener('click', (e) => {
        const act = e.target.getAttribute('data-act'); if (!act) return;
        if (act === 'front') this._fabric3d.setView('front');
        else if (act === 'back') this._fabric3d.setView('back');
        else if (act === 'reset') this._fabric3d.resetView();
        else if (act === 'wire') e.target.classList.toggle('active', this._fabric3d.toggleWire());
      });
      this._updateInfoLine(opts);
    }).catch((err) => {
      // engine unavailable → graceful fallback
      this._renderCubeFallback();
    });
  }

  _renderCubeFallback() {
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
        <span class="ka3d-zoom">1.7×</span>
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
      <div class="ka3d-hint">Drag to rotate &amp; flip · scroll / click a point to zoom into the structure</div>
    `;
    wrap.appendChild(stage);
    this._injectThreeCss();

    const frontC = stage.querySelector('.ka3d-front');
    const backC  = stage.querySelector('.ka3d-back');
    [frontC, backC].forEach(c => {
      c.width = W * SS; c.height = H * SS;
      c.style.width = W + 'px'; c.style.height = H + 'px';
    });

    const fctx = frontC.getContext('2d');
    const bctx = backC.getContext('2d');
    this.canvases.threed = frontC;

    const cube = stage.querySelector('.ka3d-cube');
    const viewport = stage.querySelector('.ka3d-viewport');
    cube.style.setProperty('--thick', THICK + 'px');

    // init macro state (zoom here drives LOD re-render, NOT a css stretch)
    const t = this._three;
    if (t.fu == null) t.fu = 0.5;
    if (t.fv == null) t.fv = 0.5;
    if (!t.zoom || t.zoom < 1) t.zoom = 1.7;
    const MIN = 1, MAX = 9;

    const view = () => ({ zoom: t.zoom, fu: t.fu, fv: t.fv });
    const repaint = () => {
      fctx.setTransform(SS, 0, 0, SS, 0, 0);
      bctx.setTransform(SS, 0, 0, SS, 0, 0);
      this._paintFabricFace(fctx, W, H, 'front', opts, view());
      this._paintFabricFace(bctx, W, H, 'back', opts, view());
      const zEl = stage.querySelector('.ka3d-zoom'); if (zEl) zEl.textContent = t.zoom.toFixed(1) + '×';
    };
    const apply = () => {
      // rotation only — zoom is baked into the re-rendered faces (true macro lens)
      cube.style.transform =
        `translateZ(-${THICK / 2}px) rotateX(${t.rotX}deg) rotateY(${t.rotY}deg)`;
      const back = ((t.rotY % 360) + 360) % 360;
      const showingBack = back > 90 && back < 270;
      stage.querySelector('[data-act="front"]').classList.toggle('active', !showingBack);
      stage.querySelector('[data-act="back"]').classList.toggle('active', showingBack);
    };
    t.painted = true;
    repaint();
    apply();

    // drag — rotate when near the edges intent? Use SHIFT/secondary? Simplest:
    // left-drag rotates; this matches the "turn the swatch over" mental model.
    const down = (e) => { t.dragging = true; const p = e.touches ? e.touches[0] : e; t.lastX = p.clientX; t.lastY = p.clientY; viewport.classList.add('grabbing'); };
    const move = (e) => {
      if (!t.dragging) return;
      const p = e.touches ? e.touches[0] : e;
      t.rotY += (p.clientX - t.lastX) * 0.6;
      t.rotX = Math.max(-62, Math.min(62, t.rotX - (p.clientY - t.lastY) * 0.4));
      t.lastX = p.clientX; t.lastY = p.clientY; apply();
      if (e.cancelable) e.preventDefault();
    };
    const up = () => { t.dragging = false; viewport.classList.remove('grabbing'); };
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

    // wheel zooms the macro lens (re-renders detail) toward the cursor's face point
    const faceRel = (e, faceEl) => {
      const r = faceEl.getBoundingClientRect();
      return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
    };
    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const showingBack = (() => { const b = ((t.rotY % 360) + 360) % 360; return b > 90 && b < 270; })();
      const faceEl = showingBack ? backC : frontC;
      const p = faceRel(e, faceEl);
      const g0 = this._gridGeom(W, H, opts, view());
      const waleF = g0.leftWaleF + p.x / g0.cellW, courseF = g0.botCourseF + (H - p.y) / g0.cellH;
      t.zoom = Math.max(MIN, Math.min(MAX, t.zoom * (e.deltaY < 0 ? 1.16 : 0.86)));
      const g1 = this._gridGeom(W, H, opts, view());
      t.fu = Math.max(0.04, Math.min(0.96, (waleF - p.x / g1.cellW + g1.visW / 2) / this._TOTAL_W));
      t.fv = Math.max(0.04, Math.min(0.96, (courseF - (H - p.y) / g1.cellH + g1.visC / 2) / this._TOTAL_C));
      repaint();
    }, { passive: false });

    // click a face → focus that point and magnify (macro)
    const faceClick = (e, faceEl) => {
      if (t.dragging) return;
      const p = faceRel(e, faceEl);
      const g0 = this._gridGeom(W, H, opts, view());
      const waleF = g0.leftWaleF + p.x / g0.cellW, courseF = g0.botCourseF + (H - p.y) / g0.cellH;
      t.fu = Math.max(0.04, Math.min(0.96, waleF / this._TOTAL_W));
      t.fv = Math.max(0.04, Math.min(0.96, courseF / this._TOTAL_C));
      t.zoom = t.zoom >= MAX ? 1.7 : Math.min(MAX, t.zoom * 1.9);
      repaint();
    };
    let downXY = null;
    frontC.addEventListener('mousedown', (e) => { downXY = [e.clientX, e.clientY]; });
    backC.addEventListener('mousedown', (e) => { downXY = [e.clientX, e.clientY]; });
    frontC.addEventListener('click', (e) => { if (downXY && Math.abs(e.clientX - downXY[0]) + Math.abs(e.clientY - downXY[1]) < 4) faceClick(e, frontC); });
    backC.addEventListener('click', (e) => { if (downXY && Math.abs(e.clientX - downXY[0]) + Math.abs(e.clientY - downXY[1]) < 4) faceClick(e, backC); });

    // buttons
    stage.querySelector('.ka3d-controls').addEventListener('click', (e) => {
      const act = e.target.getAttribute('data-act'); if (!act) return;
      if (act === 'front') { t.rotY = 0; t.rotX = -14; }
      else if (act === 'back') { t.rotY = 180; t.rotX = -14; }
      else if (act === 'zoomin') { t.zoom = Math.min(MAX, t.zoom * 1.3); repaint(); }
      else if (act === 'zoomout') { t.zoom = Math.max(MIN, t.zoom * 0.77); repaint(); }
      else if (act === 'reset') { t.rotY = 0; t.rotX = -14; t.zoom = 1.7; t.fu = 0.5; t.fv = 0.5; repaint(); }
      else if (act === 'brush') {
        t.brush = !t.brush;
        e.target.classList.toggle('active', t.brush);
        if ((((t.rotY % 360) + 360) % 360) <= 90) t.rotY = 180;  // flip to show back
        repaint();
      }
      apply();
    });

    this._updateInfoLine(opts);
  }

  _injectThreeCss() {
    if (document.getElementById('ka3d-style')) return;
    const css = `
    .ka3d-stage,.ka3dgl-stage{display:flex;flex-direction:column;align-items:center;gap:10px;width:100%;padding:6px 0;}
    .ka3dgl-mount{width:100%;max-width:560px;height:380px;border-radius:12px;overflow:hidden;
      background:radial-gradient(ellipse at 50% 35%,rgba(255,255,255,.06),rgba(0,0,0,.30));}
    .ka3d-controls{display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:center;}
    .ka3d-btn{font:600 11px/1 var(--mono,monospace);padding:6px 11px;border-radius:7px;cursor:pointer;
      border:1px solid rgba(0,0,0,.14);background:#fff;color:#333;transition:all .15s;}
    .ka3d-btn:hover{border-color:#5b8def;color:#2563eb;}
    .ka3d-btn.active{background:#eaf1ff;border-color:#5b8def;color:#2563eb;}
    .ka3d-sep{width:1px;height:18px;background:rgba(0,0,0,.12);margin:0 3px;}
    .ka3d-zoom{font:600 11px var(--mono,monospace);color:#2563eb;min-width:36px;text-align:center;}
    .ka3d-face{cursor:zoom-in;}
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
    // 2b) Fallback: a raw hex passed as color_input but not resolved server-side.
    const rawCI = (this.result.input || {}).color_input || '';
    const hexCI = String(rawCI).trim().match(/^#?([0-9a-fA-F]{6})$/);
    if (hexCI) {
      this._dyedColor = this._hexToRgb('#' + hexCI[1]);
      this._faceCache = { front: null, back: null, brushBack: null };
      return;
    }

    // 3) Fall back to shade-mode synthesis — representative dyed colours that
    //    MATCH the shade swatches shown in the input form (so a shade selection
    //    looks like a real dyed cloth, not a grey blob).
    const shadeRaw = ((this.result.input || {}).color_shade
      || (this.result.input || {}).effective_shade
      || (this.result.color || {}).shade || 'light_medium').toString().toLowerCase();

    const SHADE_HEX = {
      black: '#1a1a1a',
      dark_navy: '#1f2d5c', dark: '#1f2d5c', navy: '#1f2d5c',
      light_medium: '#3f7fc4', medium: '#3f7fc4', light: '#9cc2e6',
      fluorescent: '#b6ff1a', fluoro: '#b6ff1a', neon: '#b6ff1a',
      white_melange: '#eceae4', white: '#eceae4',
      melange: '#8c8c8c', heather: '#8c8c8c', grey: '#8c8c8c', gray: '#8c8c8c',
    };
    let hex = SHADE_HEX[shadeRaw];
    if (!hex) {
      // keyword scan for free-text shades
      if (/black|jet|ebony/.test(shadeRaw)) hex = SHADE_HEX.black;
      else if (/navy|dark|deep|charcoal|maroon/.test(shadeRaw)) hex = SHADE_HEX.dark_navy;
      else if (/fluor|neon|bright|electric/.test(shadeRaw)) hex = SHADE_HEX.fluorescent;
      else if (/white|ecru|ivory|cream|snow|optic/.test(shadeRaw)) hex = SHADE_HEX.white_melange;
      else if (/melange|heather|marl|grey|gray/.test(shadeRaw)) hex = SHADE_HEX.melange;
      else hex = SHADE_HEX.light_medium;
    }
    const rgb = this._hexToRgb(hex);

    const fiber = this._classifyFiber();
    if (fiber === 'cotton') { rgb.r += 4; rgb.b -= 3; }
    if (fiber === 'polyester' || fiber === 'nylon') { rgb.b += 5; }

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
        // update the live view in place (3D updates the yarn material instantly)
        if (this.activeTab === 'threed' && this._fabric3d) this._fabric3d.setColor(colorInput.value);
        else if (this.activeTab === 'realistic') this._renderRealisticView();
        else this._renderActiveTab();
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
