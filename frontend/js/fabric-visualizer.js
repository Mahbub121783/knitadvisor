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
    this.activeTab = 'stitch';
    this.animFrame = null;
    this.animProgress = 0;
    this.vizData   = null;
    this.canvases  = {};
    this.svgWrap   = null;
    this._destroyed = false;
  }

  // ─────────────────────────────────────────────────────────
  // PUBLIC
  // ─────────────────────────────────────────────────────────

  async init() {
    if (!this.container) return;
    this._buildSectionDOM();
    this._showLoading(true);

    try {
      this.vizData = await this._generateVizData();
    } catch (err) {
      this._showError('Could not generate visualization: ' + err.message);
      return;
    }

    this._showLoading(false);
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
    const canvas = this.canvases[this.activeTab === 'props' ? 'props' : 'stitch'];
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
    const wrap   = this.container.querySelector('.viz-canvas-wrap[data-wrap="stitch"]');
    if (!wrap) return;
    wrap.innerHTML = '';

    const vizData = this.vizData.weft || this.vizData;
    if (!vizData || vizData.kind !== 'weft_knit') {
      // Warp knit → canvas animation
      if (this.vizData.warp) this._renderWarpCanvas();
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.className = 'viz-canvas';
    wrap.appendChild(canvas);
    this.canvases.stitch = canvas;

    const dpr = window.devicePixelRatio || 1;
    canvas.width  = vizData.canvasWidth  * dpr;
    canvas.height = vizData.canvasHeight * dpr;
    canvas.style.width  = vizData.canvasWidth  + 'px';
    canvas.style.height = vizData.canvasHeight + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const yarnColor = this._getYarnColor();
    const yarnLW    = this._getYarnLineWidth(vizData.countNe || 30, vizData.cellSize);

    // PASS 1 — Background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, vizData.canvasWidth, vizData.canvasHeight);

    // PASS 2 — Needle guides (vertical)
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.05)';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([2, 4]);
    for (let c = 0; c <= vizData.totalCols; c++) {
      const x = c * vizData.cellSize;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, vizData.canvasHeight); ctx.stroke();
    }
    ctx.restore();

    // PASS 3 — Course guides (horizontal)
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.05)';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([2, 4]);
    for (let r = 0; r <= vizData.totalRows; r++) {
      const y = r * vizData.cellSize;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(vizData.canvasWidth, y); ctx.stroke();
    }
    ctx.restore();

    // PASS 4 — Miss/Float bars
    ctx.save();
    ctx.strokeStyle = '#CCCCCC';
    ctx.lineWidth = yarnLW * 0.8;
    ctx.setLineDash([]);
    ctx.lineCap = 'round';
    for (const p of vizData.paths) {
      if (p.type !== 'M') continue;
      const hw = vizData.cellSize * 0.5;
      ctx.beginPath(); ctx.moveTo(p.cx - hw, p.cy); ctx.lineTo(p.cx + hw, p.cy); ctx.stroke();
    }
    ctx.restore();

    // PASS 5 — Tuck arcs
    ctx.save();
    ctx.strokeStyle = this._lightenColor(yarnColor, 0.35);
    ctx.lineWidth = yarnLW;
    ctx.setLineDash([4, 2]);
    ctx.lineCap = 'round';
    for (const p of vizData.paths) {
      if (p.type !== 'T') continue;
      const { W, H, FS } = p.geom || this._defaultGeomFromCell(vizData.cellSize);
      const hT = H * 0.55;
      ctx.beginPath();
      ctx.moveTo(p.cx - FS, p.cy);
      ctx.bezierCurveTo(p.cx - FS, p.cy - hT, p.cx + FS, p.cy - hT, p.cx + FS, p.cy);
      ctx.stroke();
    }
    ctx.restore();

    // PASS 6 — Knit loops (bottom course first = painter's algorithm)
    const kPaths = vizData.paths.filter(p => p.type === 'K');
    for (const p of kPaths) {
      const { W, H, FS } = p.geom || this._defaultGeomFromCell(vizData.cellSize);
      const baseColor = p.isDial ? this._lightenColor(yarnColor, 0.25) : yarnColor;

      // Leg pair
      ctx.save();
      ctx.strokeStyle = baseColor;
      ctx.lineWidth = yarnLW;
      ctx.setLineDash([]);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(p.cx - FS, p.cy);
      ctx.bezierCurveTo(p.cx - W * 1.6, p.cy - H * 0.25,  p.cx - W, p.cy - H + W * 0.3,  p.cx, p.cy - H);
      ctx.bezierCurveTo(p.cx + W,       p.cy - H + W * 0.3, p.cx + W * 1.6, p.cy - H * 0.25, p.cx + FS, p.cy);
      ctx.stroke();

      // Foot hooks
      ctx.lineWidth = yarnLW * 0.75;
      // Left
      ctx.beginPath();
      ctx.moveTo(p.cx - FS, p.cy);
      ctx.quadraticCurveTo(p.cx - FS * 2.4, p.cy + FS * 1.2, p.cx - FS * 3, p.cy + FS * 0.5);
      ctx.stroke();
      // Right
      ctx.beginPath();
      ctx.moveTo(p.cx + FS, p.cy);
      ctx.quadraticCurveTo(p.cx + FS * 2.4, p.cy + FS * 1.2, p.cx + FS * 3, p.cy + FS * 0.5);
      ctx.stroke();

      // Polyester sheen highlight
      if (p.hasSheen) {
        const grad = ctx.createLinearGradient(p.cx - FS, p.cy, p.cx + FS, p.cy);
        grad.addColorStop(0,    'rgba(255,255,255,0)');
        grad.addColorStop(0.4,  'rgba(255,255,255,0.55)');
        grad.addColorStop(1,    'rgba(255,255,255,0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = yarnLW * 0.4;
        ctx.beginPath();
        ctx.moveTo(p.cx - FS, p.cy);
        ctx.bezierCurveTo(p.cx - W * 1.6, p.cy - H * 0.25, p.cx - W, p.cy - H + W * 0.3, p.cx, p.cy - H);
        ctx.bezierCurveTo(p.cx + W, p.cy - H + W * 0.3, p.cx + W * 1.6, p.cy - H * 0.25, p.cx + FS, p.cy);
        ctx.stroke();
      }

      // Needle dot
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      ctx.arc(p.cx, p.cy, 1.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    // PASS 8 — Repeat boundary box
    ctx.save();
    ctx.strokeStyle = 'rgba(37,99,235,0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    const boxW = vizData.walesPerRepeat   * vizData.cellSize;
    const boxH = vizData.coursesPerRepeat * vizData.cellSize;
    ctx.strokeRect(0.5, vizData.canvasHeight - boxH - 0.5, boxW, boxH);
    ctx.restore();

    // PASS 9 — Legend
    this._drawLegend(ctx, yarnColor, vizData.canvasWidth, vizData.canvasHeight);

    // Update info text
    const info = this.container.querySelector('#viz-info-text');
    if (info) {
      const ne = vizData.countNe || (this.result.yarn || {}).count_ne || '—';
      const tf = ((this.result.physical_constraints || {}).tightness_factor || '—');
      info.textContent = `Count: ${ne} Ne  |  TF: ${typeof tf === 'number' ? tf.toFixed(2) : tf}  |  ${vizData.coursesPerRepeat}C × ${vizData.walesPerRepeat}W repeat`;
    }
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

    const cs = (this.vizData.weft || this.vizData).crossSection || (this.vizData.crossSection);
    if (!cs) { wrap.innerHTML = '<p class="text-dim text-sm">Cross-section data unavailable.</p>'; return; }

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

    const pm = (this.vizData.weft || this.vizData).propertiesMap || (this.vizData.propertiesMap);
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
    if (this.activeTab === 'stitch') this._renderStitchView();
    else if (this.activeTab === 'cross') this._renderCrossSection();
    else if (this.activeTab === 'props') this._renderPropertiesMap();
  }

  // ─────────────────────────────────────────────────────────
  // DOM BUILDER
  // ─────────────────────────────────────────────────────────

  _buildSectionDOM() {
    this.container.innerHTML = `
      <div class="viz-tab-bar">
        <button class="viz-tab active" data-tab="stitch">Stitch Structure</button>
        <button class="viz-tab" data-tab="cross">Cross-Section</button>
        <button class="viz-tab" data-tab="props">Properties Map</button>
      </div>
      <div class="viz-panel active" data-panel="stitch">
        <div class="viz-canvas-wrap" data-wrap="stitch"></div>
      </div>
      <div class="viz-panel" data-panel="cross">
        <div class="viz-cross-wrap" id="viz-svg-cross"></div>
      </div>
      <div class="viz-panel" data-panel="props">
        <div class="viz-canvas-wrap" data-wrap="props"></div>
      </div>
      <div class="viz-toolbar">
        <span class="viz-info" id="viz-info-text">Loading…</span>
        <button class="viz-btn" id="viz-export-png">Export PNG</button>
        <button class="viz-btn" id="viz-export-svg">Export SVG</button>
      </div>
    `;

    this.svgWrap = this.container.querySelector('#viz-svg-cross');

    // Tab switching
    this.container.querySelectorAll('.viz-tab').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

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
