/**
 * KnitAdvisor — Pattern Renderer
 * Renders K/T/M grid from API data into visual HTML
 */

// ============================================================
// MAIN RENDER FUNCTION
// Called with pattern data from GET /api/pattern/:slug
// ============================================================
function renderPatternGrid(container, patternData, yarnInfo) {
  if (!container) return;

  // Warp knit — intercept and use specialized renderer
  if (patternData?.fabric_type === 'warp_knit') {
    container.innerHTML = renderWarpKnitPattern(patternData);
    return;
  }

  // Woven — the same discriminator mechanism. A woven cloth has no courses or
  // wales to draw, so it gets the four loom plans instead of a K/T/M grid.
  if (patternData?.fabric_type === 'woven') {
    container.innerHTML = renderWovenPattern(patternData);
    // Realistic 2D + 3D preview — woven-visualizer.js, loaded independently
    // (both index.html's live calculator and patterns.html's library include
    // it). Guarded so a page that hasn't loaded it still gets the loom plans
    // above with no error, just without this section.
    const mount = container.querySelector('#woven-viz-mount');
    if (mount && typeof window !== 'undefined' && window.WovenVisualizer) {
      new window.WovenVisualizer(patternData, mount).init().catch(() => {});
    }
    return;
  }

  if (!patternData || (!patternData.pattern_cylinder && !patternData.pattern_dial)) {
    let fallbackHtml = `<div class="text-dim text-sm">Pattern data not available for this fabric.</div>`;
    if (patternData?.structure_note) {
      fallbackHtml += `<div class="info-box mt-12"><strong>Structure:</strong> ${patternData.structure_note}</div>`;
    }
    if (patternData?.technical_notes) {
      fallbackHtml += `<div class="info-box mt-12"><strong>Note:</strong> ${patternData.technical_notes}</div>`;
    }
    container.innerHTML = fallbackHtml;
    return;
  }

  const { pattern_cylinder, pattern_dial, cam_arrangement, needle_arrangement, technical_notes, courses_per_repeat, wales_per_repeat, structure_note } = patternData;
  const cam = cam_arrangement;
  const needle_butt_pattern = needle_arrangement ? needle_arrangement.butt_pattern : null;
  const needle_description = needle_arrangement ? needle_arrangement.description : null;
  const note = technical_notes;

  let html = '';

  // — Pattern beds —
  const hasDouble = !!pattern_dial;

  html += `<div class="pattern-beds-wrap">`;

  // Cylinder
  if (pattern_cylinder) {
    html += `<div>`;
    html += `<div class="pattern-bed-label">Cylinder${hasDouble ? ' (Bottom Bed)' : ''}</div>`;
    html += buildGrid(pattern_cylinder, courses_per_repeat, wales_per_repeat);
    html += `</div>`;
  }

  // Dial (double-bed fabrics)
  if (pattern_dial) {
    html += `<div>`;
    html += `<div class="pattern-bed-label">Dial (Top Bed)</div>`;
    html += buildGrid(pattern_dial, courses_per_repeat, wales_per_repeat);
    html += `</div>`;
  }

  html += `</div>`;

  // — Repeat info —
  const courseLabel = typeof courses_per_repeat === 'number' ? `${courses_per_repeat}C` : 'Variable C';
  const waleLabel = typeof wales_per_repeat === 'number' ? `${wales_per_repeat}W` : 'Variable W';
  html += `<div class="mt-8 text-xs text-dim">${courseLabel} × ${waleLabel} repeat</div>`;

  // — Legend —
  html += `
    <div class="pattern-legend mt-8">
      <div class="legend-item">
        <div class="legend-dot" style="background:var(--bg4)"></div>
        <span>K — Knit</span>
      </div>
      <div class="legend-item">
        <div class="legend-dot" style="background:var(--bg3);border:1px solid var(--line3)"></div>
        <span>T — Tuck</span>
      </div>
      <div class="legend-item">
        <div class="legend-dot" style="background:var(--bg2)"></div>
        <span>M — Miss / Float</span>
      </div>
    </div>
  `;

  // — SVG Visualization (Schematic) —
  html += `<div class="result-section-label mt-12 mb-4" style="font-size:12px; border-bottom:1px solid var(--line2); padding-bottom:8px;">Schematic Diagrams</div>`;
  html += renderSvgSchematic(patternData, yarnInfo);

  // — Cam arrangement —
  if (cam && cam.length > 0) {
    html += `<div class="result-section-label mt-12">Cam Arrangement</div>`;
    html += `<div style="display:flex;flex-direction:column;gap:4px;">`;
    cam.forEach((c, i) => {
      const feedLabel = `Feed ${i + 1}`;
      const cyl = c.cylinder ? `<span style="color:var(--a1);font-weight:600">Cyl: ${c.cylinder}</span>` : '';
      const dial = c.dial ? `<span style="color:var(--a2);font-weight:600">Dial: ${c.dial}</span>` : '';
      const note_c = c.note ? `<span class="text-dim">— ${c.note}</span>` : '';
      html += `<div class="text-sm" style="display:flex;gap:12px;padding:4px 0;">
        <span style="color:var(--t3);min-width:48px;">${feedLabel}</span>
        ${cyl} ${dial} ${note_c}
      </div>`;
    });
    html += `</div>`;
  }

  // — Needle arrangement —
  if (needle_butt_pattern || needle_description) {
    html += `<div class="result-section-label mt-12">Needle Arrangement</div>`;
    if (needle_butt_pattern) {
      html += `<div class="text-sm" style="margin-bottom:4px;"><span class="text-dim">Butt pattern: </span><span class="text-green font-bold">${needle_butt_pattern}</span></div>`;
    }
    if (needle_description) {
      html += `<div class="text-sm text-muted">${needle_description}</div>`;
    }
  }

  // — Notes —
  if (structure_note) {
    html += `<div class="info-box mt-12"><strong>Structure:</strong> ${structure_note}</div>`;
  }
  if (note) {
    html += `<div class="info-box mt-12"><strong>Note:</strong> ${note}</div>`;
  }

  container.innerHTML = html;
}

// ============================================================
// SVG RENDERER: TEXTBOOK STYLE
// ============================================================

// ============================================================
// MULTI-YARN NOTATION WEIGHT — thick/thin lines by yarn diameter
// ============================================================
// Multi-thread structures (3-thread fleece, french terry…) interleave
// courses fed by physically DIFFERENT yarns — a fine tie/binder, a medium
// face/ground, a coarse loop/pile — yet the notation grid used to stroke
// every row identically. Real technical-notation practice varies line
// weight by yarn thickness, so we do the same here, computed from the exact
// canonical diameter formula used across the app (d(mm) = 0.907/√Ne — see
// knit3d/fabric-mesh.js `yarnDiameterMm` and advanced_fleece_fabrication_
// visualization.md §1.1) whenever real counts are available, falling back
// to representative ratios derived from that same formula otherwise.
function yarnDiameterMm(ne) { return 0.907 / Math.sqrt(ne || 30); }

function roleFamily(role) {
  const r = (role || '').toLowerCase();
  if (/tie|binder/.test(r)) return 'tie';
  if (/fleece|loop|pile/.test(r)) return 'loop';
  return 'face'; // ground, plated, face, or unlabeled
}

/**
 * @param {string} role     cam-arrangement yarn label for this row (may be undefined)
 * @param {object} [yarnInfo] { count_ne, yarn2_ne, binder_denier } — real counts when known
 * @returns {number} stroke-weight scale relative to the face/ground yarn (1.0)
 */
function resolveRowDiameterScale(role, yarnInfo) {
  const fam = roleFamily(role);
  if (fam === 'face') return 1.0;

  const faceNe = (yarnInfo && yarnInfo.count_ne) || 30;
  const dFace = yarnDiameterMm(faceNe);

  if (fam === 'loop') {
    // real loop-yarn count when known; otherwise the doc's representative
    // "loop runs coarser than face" ratio (~1.35-1.4x diameter)
    const loopNe = (yarnInfo && yarnInfo.yarn2_ne) || faceNe * 0.55;
    const scale = yarnDiameterMm(loopNe) / dFace;
    return Math.max(0.8, Math.min(scale, 2.0));
  }
  // fam === 'tie'
  const tieNe = (yarnInfo && yarnInfo.binder_denier) ? (5315 / yarnInfo.binder_denier) : faceNe * 1.9;
  const scale = yarnDiameterMm(tieNe) / dFace;
  return Math.max(0.4, Math.min(scale, 1.0));
}

/** Compact "line weight = yarn diameter" legend for multi-yarn notations. */
function buildYarnWeightLegend(roles, scales) {
  const seen = new Map();
  roles.forEach((role, i) => {
    const fam = roleFamily(role);
    if (!seen.has(fam)) seen.set(fam, { role: role || fam, scale: scales[i] });
  });
  const order = ['face', 'tie', 'loop'];
  const label = { face: 'Face/Ground', tie: 'Tie/Binder', loop: 'Loop/Pile' };
  const items = order.filter(f => seen.has(f)).map(f => {
    const { scale } = seen.get(f);
    const w = Math.max(1, 2.4 * scale).toFixed(1);
    return `<span style="display:inline-flex;align-items:center;gap:4px;">
      <span style="display:inline-block;width:18px;height:${w}px;background:#1A1A1A;border-radius:${w}px;"></span>
      <span>${label[f]} ${scale.toFixed(2)}×</span>
    </span>`;
  });
  return `<div style="display:flex;gap:12px;font-size:10px;color:var(--t3);margin-top:2px;flex-wrap:wrap;justify-content:center;">${items.join('')}</div>`;
}

/**
 * Fabric-notation (loop diagram) SVG for ONE bed's K/T/M grid.
 *   K = teardrop loop: ROUND bulb raised up with its dot CENTRED inside;
 *       at the bottom the two strands CROSS (interloop = overlap/underlap);
 *       loops joined by one continuous scalloped running yarn.
 *   T = tuck: a hump covering only the UPPER part of the dot (dot on base).
 *   M = miss/float: flat running yarn; bare dot on the baseline.
 * `dir` flips the whole loop vertically (+1 = loops point up, used for the
 * cylinder/face bed; -1 = loops point down, used for the dial/back bed —
 * physically the two beds' loops DO point opposite ways in a real rib).
 */
function buildFabricNotationSVG(grid, opts) {
  opts = opts || {};
  const dir = opts.dir === -1 ? -1 : 1;
  const stroke = opts.stroke || '#1A1A1A';
  // per-row (per-feed) stroke-weight scale — see resolveRowDiameterScale().
  // Multi-yarn structures pass one entry per base row; single-yarn fabrics
  // simply omit it and every row draws at scale 1.
  const rowScale = Array.isArray(opts.rowScale) ? opts.rowScale : null;

  const baseRows = grid.length;
  const baseCols = Array.isArray(grid[0]) ? grid[0].length : 1;

  const cs = 50;                                   // needle pitch / course spacing
  const fnRepeatX = Math.max(3, Math.ceil(6 / baseCols));
  const fnRepeatY = Math.max(3, Math.ceil(4 / baseRows));
  const fnCols = baseCols * fnRepeatX;
  const fnRows = baseRows * fnRepeatY;

  const p       = cs;          // needle pitch
  const R       = cs * 0.22;   // bulb radius (round head)
  const baseOff = cs * 0.06;   // half-gap of the crossover at the loop bottom
  const scallop = cs * 0.10;   // sinker dip between loops
  const dDot    = cs * 0.40;   // dot height above baseline (centre of the bulb)
  const dTop    = cs * 0.58;   // bulb top height above baseline
  const humpH   = cs * 0.42;   // tuck hump height

  const fnPadX = 8, fnPadTop = cs * 0.74, fnPadBot = cs * 0.28;
  const fnW = fnCols * cs + fnPadX * 2;
  const fnH = fnPadTop + (fnRows - 1) * cs + fnPadBot;

  const cellAt = (r, c) => {
    const rowData = Array.isArray(grid[r % baseRows])
      ? grid[r % baseRows] : [grid[r % baseRows]];
    return (rowData[c % baseCols] || '').toString().toUpperCase();
  };
  const fnX  = (c) => fnPadX + c * cs + cs / 2;          // wale centre (dot x)
  const fnBy = (r) => fnPadTop + (fnRows - 1 - r) * cs;  // course r baseline (0 = bottom)

  let fn = `<svg width="${fnW}" height="${fnH}" viewBox="0 0 ${fnW} ${fnH}" style="background:#FFFFFF; border:1px solid #CCCCCC; border-radius:4px;">`;

  for (let r = 0; r < fnRows; r++) {
    const by   = fnBy(r);
    const topY = by - dir * dTop;

    // ── one continuous running yarn for the whole course ──
    let d = `M ${fnX(0) - p * 0.5} ${by}`;
    for (let c = 0; c < fnCols; c++) {
      const x = fnX(c);
      const xR = x + p * 0.5;
      const cell = cellAt(r, c);

      if (cell === 'K') {
        // dip + rise crossing to the RIGHT base → up right side, round the top,
        // down left side to the LEFT base → cross back out (interlooping crossover)
        d += ` Q ${x - p * 0.12} ${by + dir * scallop} ${x + baseOff} ${by}`;
        d += ` C ${x + R * 1.7} ${by - dir * cs * 0.18} ${x + R * 0.9} ${topY} ${x + R * 0.30} ${topY - dir * R * 0.15}`;
        d += ` C ${x + R * 0.10} ${topY - dir * R * 0.40} ${x - R * 0.10} ${topY - dir * R * 0.40} ${x - R * 0.30} ${topY - dir * R * 0.15}`;
        d += ` C ${x - R * 0.9} ${topY} ${x - R * 1.7} ${by - dir * cs * 0.18} ${x - baseOff} ${by}`;
        d += ` Q ${x + p * 0.12} ${by + dir * scallop} ${xR} ${by}`;
      } else if (cell === 'T') {
        // tuck hump — covers just the upper part of the dot
        d += ` L ${x - p * 0.30} ${by}`;
        d += ` Q ${x} ${by - dir * humpH} ${x + p * 0.30} ${by}`;
        d += ` L ${xR} ${by}`;
      } else {
        // miss / float — flat run
        d += ` L ${xR} ${by}`;
      }
    }
    const scale = rowScale ? (rowScale[r % baseRows] || 1) : 1;
    fn += `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${(2.4 * scale).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`;

    // dots: centred inside the bulb for K, on the baseline for T/M
    for (let c = 0; c < fnCols; c++) {
      const cell = cellAt(r, c);
      const dy = cell === 'K' ? by - dir * dDot : by;
      fn += `<circle cx="${fnX(c)}" cy="${dy}" r="${(2.3 * scale).toFixed(2)}" fill="${stroke}"/>`;
    }
  }

  fn += `</svg>`;
  return fn;
}

/** Cam-block diagram SVG for ONE bed's K/T/M grid (3×2 tiled repeat). */
function buildCamGridSVG(grid) {
  const baseRows = grid.length;
  const baseCols = Array.isArray(grid[0]) ? grid[0].length : 1;
  const repeatX = 3, repeatY = 2;
  const cols = baseCols * repeatX;
  const rows = baseRows * repeatY;
  const cellSize = 40;
  const width = cols * cellSize;
  const height = rows * cellSize;

  let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="background:#FFFFFF; border:1px solid #CCCCCC; border-radius:4px;">`;
  for (let r = 0; r < rows; r++) {
    const y = height - (r * cellSize) - cellSize;
    const baseR = r % baseRows;
    const rowData = Array.isArray(grid[baseR]) ? grid[baseR] : [grid[baseR]];

    for (let c = 0; c < cols; c++) {
      const x = c * cellSize;
      const baseC = c % baseCols;
      const cell = (rowData[baseC] || '').toString().toUpperCase();

      svg += `<rect x="${x+1}" y="${y+1}" width="${cellSize-2}" height="${cellSize-2}" fill="#F5F5F5" stroke="#CCCCCC" />`;
      svg += `<circle cx="${x + (cellSize/2)}" cy="${y + (cellSize/2) + 6}" r="3" fill="#000000" />`;

      if (cell === 'K') {
        svg += `<path d="M ${x+8} ${y+32} L ${x+20} ${y+8} L ${x+32} ${y+32}" fill="none" stroke="#000000" stroke-width="3" stroke-linejoin="miter" />`;
      } else if (cell === 'T') {
        svg += `<path d="M ${x+8} ${y+32} L ${x+14} ${y+20} L ${x+26} ${y+20} L ${x+32} ${y+32}" fill="none" stroke="#000000" stroke-width="3" stroke-linejoin="miter" />`;
      } else if (cell === 'M' || cell === '·') {
        svg += `<path d="M ${x+8} ${y+32} L ${x+32} ${y+32}" fill="none" stroke="#000000" stroke-width="3" stroke-linejoin="miter" />`;
      }
    }
  }
  svg += `</svg>`;
  return { svg, cellSize };
}

function renderSvgSchematic(patternData, yarnInfo) {
  const { pattern_cylinder, pattern_dial, needle_arrangement, cam_arrangement } = patternData;
  if (!pattern_cylinder) return '';

  const needle_butt_pattern = needle_arrangement ? needle_arrangement.butt_pattern : null;
  // Double-bed structures (rib/interlock/half-cardigan/milano…) carry a real
  // pattern_dial grid — DIAL bed. Previously every panel below only ever read
  // pattern_cylinder, so a rib's diagram rendered identically to a single-bed
  // fabric's: the defining second bed was silently dropped from all 3 SVGs.
  const hasDial = Array.isArray(pattern_dial) && pattern_dial.length > 0;
  const dialColor = '#8A3FFC';

  const baseCols = Array.isArray(pattern_cylinder[0]) ? pattern_cylinder[0].length : 1;

  // Multi-yarn structures (3-thread fleece, french terry…): each pattern_cylinder
  // ROW is fed by a specific yarn (cam_arrangement[row].yarn — face/ground/tie/
  // loop). Turn that into a per-row line-weight scale so the notation actually
  // shows a fine tie yarn thinner and a coarse loop yarn thicker, instead of
  // every row drawing identically regardless of which yarn forms it.
  let rowScale = null, yarnRoles = null;
  if (Array.isArray(cam_arrangement) && cam_arrangement.length === pattern_cylinder.length) {
    const roles = cam_arrangement.map(c => c && c.yarn);
    const families = new Set(roles.map(roleFamily));
    if (families.size > 1) {
      rowScale = roles.map(role => resolveRowDiameterScale(role, yarnInfo));
      yarnRoles = roles;
    }
  }

  let html = `<div style="display:flex; flex-wrap:wrap; gap:32px; margin-top:16px;">`;

  // ----------------------------------------------------
  // 1. Fabric Notation — cylinder, plus dial for double-bed structures
  // ----------------------------------------------------
  html += `
    <div style="display:flex; flex-direction:column; align-items:center; gap:8px;">
      ${buildFabricNotationSVG(pattern_cylinder, { dir: 1, stroke: '#1A1A1A', rowScale })}
      <div style="font-size:11px; color:var(--t2); font-weight:500;">Fabric notation${hasDial ? ' — Cylinder (face)' : ''}</div>
      ${yarnRoles ? buildYarnWeightLegend(yarnRoles, rowScale) : ''}
    </div>
  `;
  if (hasDial) {
    html += `
      <div style="display:flex; flex-direction:column; align-items:center; gap:8px;">
        ${buildFabricNotationSVG(pattern_dial, { dir: -1, stroke: dialColor })}
        <div style="font-size:11px; color:${dialColor}; font-weight:500;">Fabric notation — Dial (back)</div>
      </div>
    `;
  }

  // ----------------------------------------------------
  // 2. Cam Arrangement — cylinder, plus dial for double-bed structures
  // ----------------------------------------------------
  const cylCam = buildCamGridSVG(pattern_cylinder);
  html += `
    <div style="display:flex; flex-direction:column; align-items:center; gap:8px;">
      ${cylCam.svg}
      <div style="font-size:11px; color:var(--t2); font-weight:500;">Cam arrangement${hasDial ? ' — Cylinder' : ''}</div>
    </div>
  `;
  if (hasDial) {
    const dialCam = buildCamGridSVG(pattern_dial);
    html += `
      <div style="display:flex; flex-direction:column; align-items:center; gap:8px;">
        ${dialCam.svg}
        <div style="font-size:11px; color:${dialColor}; font-weight:500;">Cam arrangement — Dial</div>
      </div>
    `;
  }

  // ----------------------------------------------------
  // 3. Needle Arrangement
  //    Double-bed: the physically meaningful "tracks" ARE the two beds —
  //    derive directly from which wales are engaged (K/T) on each grid,
  //    rather than parsing the free-text butt_pattern string.
  //    Single-bed multi-track (e.g. 4-track twill/crepe): parse butt_pattern,
  //    but strip separator characters first. Patterns like 'C_D_C_D' or
  //    'AAB_AAB' use '_' purely for human readability; indexing into the raw
  //    string previously treated '_' as a literal 3rd needle track, which
  //    corrupted this diagram for every rib fabric (ALL of them use
  //    underscore-delimited butt patterns).
  // ----------------------------------------------------
  const cellSize = 40;
  let needleSvg, needleCaption;

  if (hasDial) {
    const dialCols = Array.isArray(pattern_dial[0]) ? pattern_dial[0].length : baseCols;
    const gridCols = Math.max(baseCols, dialCols) * 3;
    const width = gridCols * cellSize;
    const nGridHeight = 2 * cellSize;

    let s = `<svg width="${width}" height="${nGridHeight}" viewBox="0 0 ${width} ${nGridHeight}" style="background:#FFFFFF; border:1px solid #CCCCCC; border-radius:4px;">`;
    for (let c = 0; c <= gridCols; c++) s += `<line x1="${c*cellSize}" y1="0" x2="${c*cellSize}" y2="${nGridHeight}" stroke="#CCCCCC" stroke-width="1" />`;
    for (let r = 0; r <= 2; r++) s += `<line x1="0" y1="${r*cellSize}" x2="${width}" y2="${r*cellSize}" stroke="#CCCCCC" stroke-width="1" />`;

    const cylRow = Array.isArray(pattern_cylinder[0]) ? pattern_cylinder[0] : [pattern_cylinder[0]];
    const dialRow = Array.isArray(pattern_dial[0]) ? pattern_dial[0] : [pattern_dial[0]];
    for (let c = 0; c < gridCols; c++) {
      const cylActive = /[KT]/.test((cylRow[c % baseCols] || '').toString().toUpperCase());
      const dialActive = /[KT]/.test((dialRow[c % dialCols] || '').toString().toUpperCase());
      const cx = c * cellSize + cellSize / 2;
      if (cylActive) s += `<circle cx="${cx}" cy="${nGridHeight - cellSize/2}" r="7" fill="#1A1A1A" />`;
      if (dialActive) s += `<circle cx="${cx}" cy="${cellSize/2}" r="7" fill="${dialColor}" />`;
    }
    s += `</svg>`;
    needleSvg = s;
    needleCaption = 'Needle arrangement — Cylinder (bottom) / Dial (top)';
  } else {
    const cols = baseCols * 3;
    const width = cols * cellSize;
    const stripped = (needle_butt_pattern || '').replace(/[^A-Za-z0-9]/g, '');
    const patternStr = stripped.length ? stripped : 'A'.repeat(baseCols);
    const distinctButts = Array.from(new Set(patternStr.split(''))); // e.g. ['A', 'B'] -> 2 tracks
    const numTracks = Math.max(distinctButts.length, 1);
    const nGridHeight = numTracks * cellSize;

    let s = `<svg width="${width}" height="${nGridHeight}" viewBox="0 0 ${width} ${nGridHeight}" style="background:#FFFFFF; border:1px solid #CCCCCC; border-radius:4px;">`;
    for (let c = 0; c <= cols; c++) s += `<line x1="${c*cellSize}" y1="0" x2="${c*cellSize}" y2="${nGridHeight}" stroke="#CCCCCC" stroke-width="1" />`;
    for (let r = 0; r <= numTracks; r++) s += `<line x1="0" y1="${r*cellSize}" x2="${width}" y2="${r*cellSize}" stroke="#CCCCCC" stroke-width="1" />`;

    for (let c = 0; c < cols; c++) {
      const baseC = c % baseCols;
      const butt = patternStr[baseC % patternStr.length] || 'A';
      const trackIdx = distinctButts.indexOf(butt);
      const safeTrackIdx = trackIdx !== -1 ? trackIdx : 0;
      const cx = c * cellSize + cellSize / 2;
      const cy = nGridHeight - (safeTrackIdx * cellSize) - cellSize / 2;
      s += `<circle cx="${cx}" cy="${cy}" r="7" fill="#000000" />`;
    }
    s += `</svg>`;
    needleSvg = s;
    needleCaption = 'Needle arrangement';
  }

  html += `
    <div style="display:flex; flex-direction:column; align-items:center; gap:8px;">
      ${needleSvg}
      <div style="font-size:11px; color:var(--t2); font-weight:500;">${needleCaption}</div>
    </div>
  `;

  html += `</div>`;
  return html;
}

// ============================================================
// BUILD ONE GRID (2D array → HTML table)
// ============================================================
function buildGrid(pattern2D, coursesPerRepeat, walesPerRepeat) {
  if (!Array.isArray(pattern2D) || pattern2D.length === 0) return '';

  const rows = pattern2D.length;
  const cols = Array.isArray(pattern2D[0]) ? pattern2D[0].length : 1;

  // Build grid CSS
  const colTemplate = `repeat(${cols + 1}, auto)`; // +1 for row label
  let html = `<div class="pattern-wrap">`;
  html += `<div class="pattern-grid" style="grid-template-columns:${colTemplate};">`;

  // Column headers (wales: W1, W2, ...)
  html += `<div class="pattern-axis-label"></div>`; // empty corner
  for (let c = 0; c < cols; c++) {
    html += `<div class="pattern-axis-label">W${c + 1}</div>`;
  }

  // Rows (courses)
  for (let r = rows - 1; r >= 0; r--) { // reverse: C1 at bottom
    const row = Array.isArray(pattern2D[r]) ? pattern2D[r] : [pattern2D[r]];
    // Row label
    html += `<div class="pattern-axis-label">C${r + 1}</div>`;
    // Cells
    for (let c = 0; c < cols; c++) {
      const cell = row[c] || '';
      const normalized = cell.toString().toUpperCase();
      const cellClass = ['K', 'T', 'M'].includes(normalized) ? normalized : 'empty';
      const display = normalized || '·';
      html += `<div class="pattern-cell ${cellClass}" title="${cellLabel(normalized)}">${display}</div>`;
    }
  }

  html += `</div></div>`;
  return html;
}

function cellLabel(code) {
  const map = { K: 'Knit', T: 'Tuck', M: 'Miss/Float', '·': 'Empty' };
  return map[code] || code;
}

// ============================================================
// INLINE MINI PATTERN (for result summary)
// ============================================================
function renderMiniPattern(containerEl, cylinder, dial) {
  if (!cylinder) { containerEl.innerHTML = ''; return; }
  // Limit to first 2 rows × 4 cols for mini display
  const rows = cylinder.slice(0, 2);
  const cols = Array.isArray(rows[0]) ? Math.min(rows[0].length, 4) : 1;

  let html = `<div class="pattern-grid" style="grid-template-columns:repeat(${cols},auto);gap:2px;">`;
  rows.forEach(row => {
    const cells = Array.isArray(row) ? row.slice(0, cols) : [row];
    cells.forEach(c => {
      const norm = String(c).toUpperCase();
      const cls = ['K','T','M'].includes(norm) ? norm : 'empty';
      html += `<div class="pattern-cell ${cls}" style="width:22px;height:22px;font-size:9px;">${norm}</div>`;
    });
  });
  html += `</div>`;
  containerEl.innerHTML = html;
}

// ============================================================
// WARP KNIT PATTERN RENDERER
// ============================================================
function renderWarpKnitPattern(patternData) {
  let html = '';

  // Guide bar lapping table
  if (patternData.guide_bars && patternData.lapping_pattern) {
    html += `<div class="result-section-label">Guide Bar Lapping</div>`;
    html += `<table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px;">
      <thead>
        <tr style="border-bottom:2px solid var(--line2);background:var(--bg2);">
          <th style="text-align:left;padding:8px 8px;font-weight:600;color:var(--t2);">Bar</th>
          <th style="text-align:left;padding:8px;font-weight:600;color:var(--t2);">Point Notation</th>
          <th style="text-align:left;padding:8px;font-weight:600;color:var(--t2);">Description</th>
          <th style="text-align:left;padding:8px;font-weight:600;color:var(--t2);">Type</th>
        </tr>
      </thead>
      <tbody>`;

    const bars = patternData.lapping_pattern;
    const barKeys = Object.keys(bars).sort();
    barKeys.forEach((key, idx) => {
      const barObj = bars[key];
      const notationStr = (typeof barObj === 'object' && barObj !== null)
        ? (barObj.notation || '—')
        : (typeof barObj === 'string' ? barObj : '—');
      const descStr = (typeof barObj === 'object' && barObj !== null && barObj.description) ? barObj.description : notationStr;
      const typeStr = (typeof barObj === 'object' && barObj !== null && barObj.type) ? barObj.type : '';
      html += `<tr style="border-bottom:1px solid var(--line3);">
        <td style="padding:8px;font-size:12px;font-weight:600;color:var(--a1);">GB${idx + 1}</td>
        <td style="padding:8px;font-size:12px;"><code style="background:var(--bg3);padding:2px 8px;border-radius:3px;font-family:'JetBrains Mono',monospace;font-size:13px;letter-spacing:0.5px;">${notationStr}</code></td>
        <td style="padding:8px;font-size:11px;color:var(--t2);">${descStr}</td>
        ${typeStr ? `<td style="padding:8px;font-size:10px;color:var(--t3);font-style:italic;">${typeStr}</td>` : '<td></td>'}
      </tr>`;
    });

    html += `</tbody></table>`;
  }

  // SVG lapping diagrams
  if (patternData.guide_bars) {
    html += `<div class="result-section-label" style="margin-top:12px;">Lapping Motion</div>`;
    const bars = patternData.lapping_pattern || {};
    const barKeys = Object.keys(bars).sort();

    barKeys.forEach((key, idx) => {
      const barObj = bars[key];
      const notationStr = (typeof barObj === 'object' && barObj !== null)
        ? (barObj.notation || barObj.description || '—')
        : (typeof barObj === 'string' ? barObj : '—');
      const descStr = (typeof barObj === 'object' && barObj !== null && barObj.description) ? barObj.description : '';
      html += `<div style="margin-bottom:16px;padding:12px;background:var(--bg2);border-radius:var(--radius);">
        <div style="font-size:11px;font-weight:600;margin-bottom:2px;color:var(--t3);">Bar ${idx + 1} — <code style="background:var(--bg3);padding:1px 6px;border-radius:2px;">${notationStr}</code></div>
        ${descStr ? `<div style="font-size:10px;color:var(--t3);margin-bottom:6px;">${descStr}</div>` : ''}
        ${buildWarpLappingSVG(notationStr, idx)}
      </div>`;
    });
  }

  // Stitch density
  if (patternData.stitch_density) {
    const d = patternData.stitch_density;
    html += `<div class="result-section-label" style="margin-top:12px;">Stitch Density</div>`;
    html += `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;">
      <div class="card-sm">
        <div class="label">Courses/cm</div>
        <div class="value-sm mt-4" style="color:var(--a1);">${d.courses_per_cm || '?'}</div>
      </div>
      <div class="card-sm">
        <div class="label">Wales/cm</div>
        <div class="value-sm mt-4" style="color:var(--a2);">${d.wales_per_cm || '?'}</div>
      </div>
      <div class="card-sm">
        <div class="label">Stitches/cm²</div>
        <div class="value-sm mt-4" style="color:var(--a4);">${d.stitches_per_cm2 || '?'}</div>
      </div>
    </div>`;
  }

  // Machine speed
  if (patternData.machine_speed) {
    const ms = patternData.machine_speed;
    const unit = ms.unit || 'courses/min';
    html += `<div class="text-xs text-dim" style="margin-top:12px;padding:8px;background:var(--bg2);border-radius:var(--radius);">
      <strong>Machine Speed:</strong> ${ms.min.toLocaleString()}–${ms.max.toLocaleString()} ${unit}
      <span style="color:var(--t3);"> (typical: ${ms.typical.toLocaleString()} ${unit})</span>
    </div>`;
  }

  // Notes
  if (patternData.structure_note) {
    html += `<div class="info-box mt-12"><strong>Structure:</strong> ${patternData.structure_note}</div>`;
  }
  if (patternData.appearance) {
    html += `<div class="info-box mt-8"><strong>Appearance:</strong> ${patternData.appearance}</div>`;
  }

  return html;
}

/**
 * Build SVG warp knit point-paper lapping diagram.
 *
 * Industry-standard "point paper" representation (Spencer 2001, Fig 14.2):
 *   - Horizontal axis: needle positions (wales), spaced equally
 *   - Vertical axis: courses (knitting rows), each row = one lapping cycle
 *   - Dots at needle positions; filled = needle engaged (overlap/underlap)
 *   - Solid line connecting dots = overlap (front swing, above needle bed)
 *   - Dashed line = underlap (back swing, below needle bed)
 *   - 2 courses shown = 1 complete lapping repeat (OL + UL per cycle)
 *
 * Notation "A-B/C-D":
 *   A-B = overlap movement (absolute needle positions)
 *   C-D = underlap movement
 *   Next repeat continues from D back to A (the chain)
 */
function buildWarpLappingSVG(notation, barIdx) {
  const colors = ['var(--a1)', 'var(--a2)', 'var(--a4)', 'var(--a5)'];
  const color = colors[barIdx % colors.length];

  // Gracefully handle non-parseable notations
  if (!notation || typeof notation !== 'string') {
    return `<div style="font-size:11px;color:var(--t3);padding:4px 0;font-style:italic;">Variable / independent lapping pattern</div>`;
  }
  const notLower = notation.toLowerCase();
  if (notLower === 'independent' || notLower === 'multi-wale inlay' ||
      notLower.startsWith('face') || notLower.startsWith('back') || notLower.startsWith('mirror')) {
    return `<div style="font-size:11px;color:var(--t3);padding:4px 0;font-style:italic;">${notation} — variable lapping (machine-specific)</div>`;
  }

  // Parse "A-B/C-D" → [{from:A, to:B, type:'overlap'}, {from:C, to:D, type:'underlap'}]
  const halves = notation.split('/');
  const moves = halves.map((h, i) => {
    const parts = h.trim().split('-').map(Number);
    return { from: parts[0], to: parts[1], type: i % 2 === 0 ? 'overlap' : 'underlap' };
  }).filter(m => !isNaN(m.from) && !isNaN(m.to));

  if (moves.length === 0) {
    return `<div style="font-size:10px;color:var(--t3);font-style:italic;">Cannot parse: ${notation}</div>`;
  }

  // Build a 2-repeat chain to show continuous motion
  // [OL1, UL1, OL2, UL2] — shows how pattern repeats
  const chain = [...moves, ...moves.map(m => ({ ...m }))];

  const allPos = chain.flatMap(m => [m.from, m.to]);
  const minPos = Math.min(...allPos);
  const maxPos = Math.max(...allPos);
  const waleSpan = maxPos - minPos;
  const waleCount = Math.max(waleSpan + 3, 6);
  const waleOffset = Math.max(minPos - 1, 0);

  const waleW   = 28;     // pixel spacing between wales
  const padL    = 28;     // left padding (for row labels)
  const padR    = 12;
  const courseH = 32;     // pixel height per course row
  const numCourses = chain.length + 1;  // +1 for final position row
  const svgW    = padL + waleCount * waleW + padR;
  const svgH    = 24 + numCourses * courseH + 16;

  const uid = `lp${barIdx}${Math.random().toString(36).slice(2,5)}`;

  // X coordinate for needle position i
  const nx = (pos) => padL + (pos - waleOffset) * waleW;
  // Y coordinate for course c (0 = top = course 1)
  const cy = (c) => 24 + c * courseH;

  let svg = `<svg width="${svgW}" height="${svgH}" style="border:1px solid var(--line2);border-radius:4px;background:var(--bg3);">
  <defs>
    <marker id="ao${uid}" markerWidth="7" markerHeight="7" refX="6" refY="2.5" orient="auto">
      <path d="M0,0 L0,5 L6,2.5 z" fill="${color}"/>
    </marker>
    <marker id="au${uid}" markerWidth="7" markerHeight="7" refX="6" refY="2.5" orient="auto">
      <path d="M0,0 L0,5 L6,2.5 z" fill="var(--t3)"/>
    </marker>
  </defs>`;

  // ── Wale (needle column) lines ──
  for (let i = 0; i < waleCount; i++) {
    const x = padL + i * waleW;
    const pos = i + waleOffset;
    svg += `<line x1="${x}" y1="18" x2="${x}" y2="${svgH - 10}" stroke="var(--line3)" stroke-width="1" stroke-dasharray="2,3"/>`;
    svg += `<text x="${x}" y="12" text-anchor="middle" font-size="9" fill="var(--t3)" font-family="monospace">${pos}</text>`;
  }

  // ── Column header label ──
  svg += `<text x="${padL - 2}" y="12" text-anchor="end" font-size="8" fill="var(--t3)">needle→</text>`;

  // ── Draw needle points at all course rows ──
  for (let c = 0; c <= chain.length; c++) {
    const y = cy(c);
    for (let i = 0; i < waleCount; i++) {
      const x = padL + i * waleW;
      svg += `<circle cx="${x}" cy="${y}" r="3.5" fill="var(--bg4)" stroke="var(--line3)" stroke-width="1"/>`;
    }
  }

  // ── Row labels (C1, C2, ...) ──
  for (let c = 0; c < chain.length; c++) {
    const y = cy(c);
    const lbl = chain[c].type === 'overlap' ? 'OL' : 'UL';
    const lcol = chain[c].type === 'overlap' ? color : 'var(--t3)';
    svg += `<text x="4" y="${y + 4}" font-size="8" fill="${lcol}" font-weight="${chain[c].type === 'overlap' ? '700' : '400'}">${lbl}</text>`;
  }

  // ── Draw movements as arrows ──
  chain.forEach((m, c) => {
    const y0 = cy(c);
    const y1 = cy(c + 1);  // movement lands at next course row
    const x0 = nx(m.from);
    const x1 = nx(m.to);
    const isOL = m.type === 'overlap';
    const strokeCol = isOL ? color : 'var(--t3)';
    const markerId  = isOL ? `ao${uid}` : `au${uid}`;
    const dash      = isOL ? '' : 'stroke-dasharray="5,3"';
    const sw        = isOL ? '2' : '1.5';

    if (x0 === x1) {
      // Closed lap (0-0 type) — small vertical tick
      svg += `<line x1="${x0}" y1="${y0 + 4}" x2="${x0}" y2="${y1 - 4}" stroke="${strokeCol}" stroke-width="${sw}" ${dash}/>`;
    } else {
      // Diagonal arrow from (x0,y0) to (x1,y1)
      const dx = x1 - x0;
      const endX = dx > 0 ? x1 - 4 : x1 + 4;
      const endY = y1 - 4;
      svg += `<path d="M${x0},${y0 + 4} L${endX},${endY}" stroke="${strokeCol}" stroke-width="${sw}" fill="none" marker-end="url(#${markerId})" ${dash}/>`;
    }

    // Highlight engaged needle positions
    svg += `<circle cx="${x0}" cy="${y0}" r="3.5" fill="${strokeCol}" stroke="none"/>`;
    svg += `<circle cx="${x1}" cy="${y1}" r="3.5" fill="${strokeCol}" stroke="none"/>`;
  });

  svg += `</svg>`;

  // Compact legend
  svg += `<div style="font-size:9px;color:var(--t3);margin-top:3px;display:flex;gap:12px;align-items:center;">
    <span><span style="display:inline-block;width:16px;height:2px;background:${color};vertical-align:middle;margin-right:3px;"></span><span style="color:${color};font-weight:600;">OL</span> overlap (solid)</span>
    <span><span style="display:inline-block;width:16px;height:2px;background:var(--t3);vertical-align:middle;margin-right:3px;border-top:2px dashed var(--t3);"></span><span>UL</span> underlap (dashed)</span>
    <span style="color:var(--t3);">× numbers = needle point positions</span>
  </div>`;

  return svg;
}

/* ============================================================
   WOVEN STRUCTURE DESIGN
   ============================================================
   A woven cloth is not described by a K/T/M grid, so it gets its own
   drawing: the four plans a weaver actually sets a loom from, laid out
   the way every weaving text prints them —

        DRAFTING PLAN   which shaft each warp end is threaded on
        DESIGN          which ends lift on each pick      PEG PLAN
        DENTING         which ends share a reed dent      (per shaft)

   Pick 1 sits at the BOTTOM of the design and shaft 1 at the bottom of
   the draft, because that is the direction cloth grows on a loom. The
   plans are derived, never transcribed, and the backend refuses to send
   them unless re-expanding the draft and peg plan reproduces the design
   exactly — so what is drawn here is always a set-up that weaves the
   cloth beside it.
   ============================================================ */

function wovEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const WOVEN_INK = {
  warpUp: '#1A1A1A',    // an end lifted over the pick
  weftUp: '#F2F2EF',    // the pick showing instead
  heald:  '#444444',
  dent:   '#C87800',
  grid:   '#D4D4CF',
  label:  '#999999',
};

/** One filled/empty square grid, shared by the design, draft and peg plans. */
function wovGrid(rows, cols, isSet, opts) {
  const o = Object.assign({ cell: 15, x: 0, y: 0, on: WOVEN_INK.warpUp, off: WOVEN_INK.weftUp }, opts || {});
  let s = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Row 0 is drawn at the BOTTOM so the plan reads the way a loom builds.
      const y = o.y + (rows - 1 - r) * o.cell;
      const x = o.x + c * o.cell;
      s += '<rect x="' + x + '" y="' + y + '" width="' + o.cell + '" height="' + o.cell + '" fill="'
        + (isSet(r, c) ? o.on : o.off) + '" stroke="' + WOVEN_INK.grid + '" stroke-width="0.75"/>';
    }
  }
  return s;
}

function wovLabel(x, y, text, anchor) {
  return '<text x="' + x + '" y="' + y + '" font-size="8.5" fill="' + WOVEN_INK.label
    + '" font-family="var(--mono, monospace)" text-anchor="' + (anchor || 'start')
    + '" letter-spacing="0.6">' + wovEsc(text) + '</text>';
}

/**
 * The four plans in one figure. Everything is positioned off the design block,
 * so the three satellites stay aligned to it whatever the repeat.
 */
function buildLoomPlanSVG(structure) {
  const cell = 15;
  const ends = structure.repeat_ends;
  const picks = structure.repeat_picks;
  const healds = structure.draft.healds;
  const grid = structure.grid;
  const peg = structure.peg_plan.peg;
  const assign = structure.draft.assignment;

  const gap = 24, padL = 60, padT = 18;
  const draftH = healds * cell;
  const designW = ends * cell;
  const designH = picks * cell;
  const pegW = healds * cell;

  const designY = padT + draftH + gap;
  const dentY = designY + designH + gap;
  const w = padL + designW + gap + pegW + 150;
  const h = dentY + cell + 26;

  let svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" style="max-width:'
    + Math.max(w, 300) + 'px;display:block" role="img" '
    + 'aria-label="Loom plans: drafting plan, design, peg plan and denting order">';

  // DRAFTING PLAN — one mark per end, on the shaft it is threaded through.
  svg += wovLabel(padL - 7, padT - 5, 'DRAFTING PLAN', 'end');
  svg += '<g class="woven-draft" role="group" aria-label="Drafting plan: the shaft each warp end is threaded on">'
    + wovGrid(healds, ends, (hh, e) => assign[e] === hh, { cell, x: padL, y: padT, on: WOVEN_INK.heald })
    + '</g>';
  for (let hh = 0; hh < healds; hh++) {
    svg += wovLabel(padL - 6, padT + (healds - 1 - hh) * cell + cell * 0.72, 'S' + (hh + 1), 'end');
  }

  // DESIGN — the weave repeat itself.
  svg += wovLabel(padL - 7, designY - 5, 'DESIGN', 'end');
  svg += '<g class="woven-design" role="group" aria-label="Design: the weave repeat, filled where the warp lifts">'
    + wovGrid(picks, ends, (p, e) => !!grid[p][e], { cell, x: padL, y: designY })
    + '</g>';
  for (let p = 0; p < picks; p++) {
    svg += wovLabel(padL - 6, designY + (picks - 1 - p) * cell + cell * 0.72, String(p + 1), 'end');
  }
  for (let e = 0; e < ends; e++) {
    svg += wovLabel(padL + e * cell + cell / 2, designY + designH + 11, String(e + 1), 'middle');
  }

  // PEG PLAN — the same lifts, expressed per shaft instead of per end.
  const pegX = padL + designW + gap;
  svg += wovLabel(pegX, designY - 5, 'PEG PLAN', 'start');
  svg += '<g class="woven-peg" role="group" aria-label="Peg plan: the shafts raised on each pick">'
    + wovGrid(picks, healds, (p, hh) => !!peg[p][hh], { cell, x: pegX, y: designY, on: WOVEN_INK.heald })
    + '</g>';
  for (let hh = 0; hh < healds; hh++) {
    svg += wovLabel(pegX + hh * cell + cell / 2, designY + designH + 11, String(hh + 1), 'middle');
  }

  // DENTING — alternate shading per dent, so a repeat that straddles one shows.
  if (structure.denting) {
    const per = structure.denting.ends_per_dent;
    svg += wovLabel(padL - 7, dentY + cell * 0.72, 'DENTING', 'end');
    svg += '<g class="woven-denting" role="group" aria-label="Denting: which ends share a reed dent">';
    for (let e = 0; e < ends; e++) {
      const dent = Math.floor(e / per);
      svg += '<rect x="' + (padL + e * cell) + '" y="' + dentY + '" width="' + cell + '" height="' + cell
        + '" fill="' + (dent % 2 ? 'rgba(200,120,0,0.18)' : 'rgba(200,120,0,0.06)')
        + '" stroke="' + WOVEN_INK.dent + '" stroke-width="0.75"/>';
    }
    svg += '</g>';
    svg += wovLabel(padL + designW + 8, dentY + cell * 0.72,
      per + ' ends/dent, ' + structure.denting.reed_count_stockport + ' dents per inch', 'start');
  }

  return svg + '</svg>';
}

/**
 * What the cloth looks like. The repeat is tiled, then each crossing is drawn
 * as the thread actually on top — a vertical warp band where the end lifts, the
 * horizontal weft band underneath where it does not. That is why a twill shows
 * its diagonal here and a satin does not: the picture is the interlacement
 * itself rather than an illustration of it.
 */
function buildClothPreviewSVG(structure, opts) {
  const o = Object.assign({ warp: '#2E4A7D', weft: '#E8E4DA', target: 40, cell: 11 }, opts || {});
  const ends = structure.repeat_ends;
  const picks = structure.repeat_picks;
  // Whole repeats only, but aim for a similar physical size whatever the repeat.
  const cols = ends * Math.max(2, Math.round(o.target / ends));
  const rows = picks * Math.max(2, Math.round(o.target / picks));
  const c = o.cell;
  const w = cols * c, h = rows * c;

  let svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" style="max-width:' + w
    + 'px;display:block;border-radius:3px" role="img" aria-label="Cloth appearance, the weave repeat tiled">';

  // Weft first — it is the ground the warp lifts over.
  for (let r = 0; r < rows; r++) {
    svg += '<rect x="0" y="' + (r * c) + '" width="' + w + '" height="' + c + '" fill="' + o.weft + '"/>';
    svg += '<rect x="0" y="' + (r * c) + '" width="' + w + '" height="' + (c * 0.16) + '" fill="rgba(0,0,0,0.07)"/>';
  }
  // Then every lifted warp, drawn over it.
  for (let r = 0; r < rows; r++) {
    const p = (rows - 1 - r) % picks;   // bottom-up, matching the design plan
    for (let col = 0; col < cols; col++) {
      if (!structure.grid[p][col % ends]) continue;
      svg += '<rect x="' + (col * c) + '" y="' + (r * c) + '" width="' + c + '" height="' + c + '" fill="' + o.warp + '"/>';
      svg += '<rect x="' + (col * c) + '" y="' + (r * c) + '" width="' + (c * 0.16) + '" height="' + c + '" fill="rgba(255,255,255,0.11)"/>';
    }
  }
  return svg + '</svg>';
}

function wovStat(label, value, sub) {
  return '<div class="card-sm"><div class="label">' + wovEsc(label) + '</div>'
    + '<div class="value-sm mt-4">' + wovEsc(value) + '</div>'
    + (sub ? '<div class="text-xs text-dim mt-4">' + wovEsc(sub) + '</div>' : '')
    + '</div>';
}

function wovStatGrid(cards) {
  return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:8px;margin-bottom:14px;">'
    + cards.filter(Boolean).join('') + '</div>';
}

function renderWovenPattern(data) {
  const s = data.structure || {};
  const c = data.construction || {};
  let html = '';

  html += '<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:12px;">'
    + '<span class="badge badge-gray">WOVEN</span>'
    + '<span class="text-sm" style="color:var(--t2)">' + wovEsc((data.family || '').replace(/_/g, ' ')) + '</span>'
    + (data.book_page ? '<span class="text-xs text-dim">Gokarneshan (2005) p.' + data.book_page + '</span>' : '')
    + '</div>';

  if (!s.available) {
    // The honest gap. Everything the book gives is still shown; the one thing
    // it cannot give without the figure is the grid, and that is said plainly
    // rather than filled in with something plausible.
    html += '<div class="warning-box" style="margin-bottom:14px;">'
      + '<strong>No weave grid is stored for this structure.</strong>'
      + '<div class="text-sm mt-8">' + wovEsc(s.note || 'The book draws this weave as a figure rather than stating a rule that generates it.') + '</div>'
      + '</div>';
    if (s.draft_hint) {
      html += '<div class="info-box mb-12"><strong>What the book does say about the set-up</strong>'
        + '<div class="text-sm mt-4">' + wovEsc(s.draft_hint.slug) + ' draft'
        + (s.draft_hint.healds ? ', about ' + s.draft_hint.healds + ' shafts' : '')
        + ' — ' + wovEsc(s.draft_hint.note || '') + '</div></div>';
    }
  } else {
    html += '<div class="mb-16">'
      + '<div class="label mb-8">Loom Plans <span class="text-dim" style="font-weight:400">— '
      + wovEsc(s.notation || '') + ', repeat ' + s.repeat_ends + ' × ' + s.repeat_picks + '</span></div>'
      + '<div style="overflow-x:auto;padding:12px 6px;background:var(--bg2);border:1px solid var(--line);border-radius:4px;">'
      + buildLoomPlanSVG(s) + '</div>'
      + '<div class="text-xs text-dim mt-4">Filled square = warp lifted. Pick 1 and shaft 1 sit at the bottom, '
      + 'the direction the cloth grows. The draft and peg plan are derived from the design and checked against it: '
      + wovEsc(s.verified || '') + '.</div></div>';

    html += '<div class="mb-16">'
      + '<div class="label mb-8">Cloth Appearance <span class="text-dim" style="font-weight:400">— the repeat tiled</span></div>'
      + '<div style="overflow-x:auto;">' + buildClothPreviewSVG(s) + '</div>'
      + '<div class="text-xs text-dim mt-4">Each crossing shows the thread actually on top, so what you see is the '
      + 'interlacement rather than a drawing of it.</div></div>';

    // Realistic 2D + 3D preview, built from this SAME grid, sett and yarn
    // count — see woven-visualizer.js. Left empty by that script if the page
    // hasn't loaded it, so nothing breaks on a page that doesn't include it.
    html += '<div class="mb-16">'
      + '<div class="label mb-8">Realistic Preview <span class="text-dim" style="font-weight:400">'
      + '— what the cloth actually looks like, from this same weave</span></div>'
      + '<div id="woven-viz-mount"></div></div>';

    const f = s.floats || {};
    html += '<div class="label mb-8">Structure Geometry</div>' + wovStatGrid([
      wovStat('Repeat', s.repeat_ends + ' × ' + s.repeat_picks, 'ends × picks'),
      wovStat('Shafts', String(s.draft.healds), s.draft.type.name),
      wovStat('Longest float', f.warp_float_max + ' / ' + f.weft_float_max, 'warp / weft, in threads'),
      wovStat('Average float', String(f.average_float), 'threads per intersection'),
      wovStat('Firmness', String(f.firmness_vs_plain), 'against plain = 1.00'),
      wovStat('Warp on face', Math.round((f.warp_up_fraction || 0) * 100) + '%', 'of the repeat area'),
    ]);
  }

  if (c.ends_per_inch) {
    html += '<div class="label mb-8">Construction <span class="text-dim" style="font-weight:400">— '
      + (c.sett_source === 'BOOK_VERIFIED'
          ? wovEsc('the book’s own quality, p.' + c.sett_page)
          : 'a working default, not one of the book’s constructions')
      + '</span></div>' + wovStatGrid([
        wovStat('Sett', c.ends_per_inch + ' × ' + c.picks_per_inch, 'ends × picks per inch'),
        wovStat('Warp yarn', String(c.warp_count), c.warp_resultant_ne + ' Ne resultant'),
        wovStat('Weft yarn', String(c.weft_count), c.weft_resultant_ne + ' Ne resultant'),
        c.material ? wovStat('Material', c.material) : null,
      ]);
  }

  const w = data.weight;
  if (w) {
    const assumedCrimp = w.warp_crimp_source === 'ASSUMED' || w.weft_crimp_source === 'ASSUMED';
    html += '<div class="label mb-8">Cloth Weight</div>' + wovStatGrid([
      wovStat('Weight', w.gsm + ' g/m²', w.oz_per_sq_yd + ' oz/yd²'),
      wovStat('Warp share', w.warp_share_pct + '%', w.warp_gsm + ' of ' + w.gsm + ' g'),
      wovStat('Warp crimp', w.warp_crimp_pct + '%', w.warp_crimp_source === 'ASSUMED' ? 'assumed' : 'from the book'),
      wovStat('Weft crimp', w.weft_crimp_pct + '%', w.weft_crimp_source === 'ASSUMED' ? 'assumed' : 'from the book'),
    ]) + '<div class="text-xs text-dim mb-16">' + wovEsc(w.basis)
      + (assumedCrimp ? ' The weight is therefore no firmer than the crimp assumed behind it.' : '')
      + '</div>';
  }

  const cv = data.cover;
  if (cv) {
    html += '<div class="label mb-8">Cover Factor</div>' + wovStatGrid([
      wovStat('Warp cover', String(cv.warp_cover)),
      wovStat('Weft cover', String(cv.weft_cover)),
      wovStat('Cloth cover', String(cv.cloth_cover),
        cv.jammed ? 'at or past the jamming point' : cv.saturation_pct + '% of this weave’s ceiling'),
    ]) + '<div class="text-xs text-dim mb-16">Peirce’s cover factor. The 28 inside it is an empirical '
      + 'plain-weave maximum and does not come from Gokarneshan (2005).</div>';
  } else if (data.fabric_type === 'woven' && data.weight) {
    html += '<div class="info-box mb-16 text-sm">Cover factor is not reported for this cloth: its picks per inch '
      + 'include pile picks, which do not lie in the single plane the formula describes.</div>';
  }

  // Yarn requirement, when a width and a length were given. The form offers
  // this explicitly, so leaving it unrendered would be a promise the page breaks.
  const use = data.consumption;
  if (use) {
    html += '<div class="label mb-8">Yarn Requirement <span class="text-dim" style="font-weight:400">— '
      + use.area_m2 + ' m² of cloth</span></div>' + wovStatGrid([
        wovStat('Warp', use.warp_kg + ' kg', use.total_ends + ' ends on the beam'),
        wovStat('Weft', use.weft_kg + ' kg'),
        wovStat('Net', use.net_kg + ' kg', 'before wastage'),
        wovStat('Gross', use.gross_kg + ' kg', use.wastage_pct + '% wastage added'),
      ]) + '<div class="text-xs text-dim mb-16">Each warp end runs '
      + use.warp_length_m + ' m for this piece — longer than the cloth, because crimp is the '
      + 'extra length a thread takes bending round the picks. The gross figure is the net plus '
      + 'wastage, not a second estimate.</div>';
  }

  const ta = data.twill_angle;
  if (ta) {
    html += '<div class="info-box mb-16"><strong>Twill angle — ' + wovEsc(ta.band.label) + '</strong>'
      + '<div class="text-sm mt-4">The book (p.' + ta.band.page + ') names the band from the sett alone. '
      + 'The ' + ta.angle_deg + '° figure beside it is derived, not quoted.</div></div>';
  }

  if (Array.isArray(data.characteristics) && data.characteristics.length) {
    html += '<div class="label mb-8">Characteristics</div><ul class="text-sm" style="margin:0 0 16px 18px;color:var(--t2)">'
      + data.characteristics.map(x => '<li>' + wovEsc(x) + '</li>').join('') + '</ul>';
  }
  if (Array.isArray(data.end_uses) && data.end_uses.length) {
    html += '<div class="label mb-8">Typical End Uses</div><div class="mb-16" style="display:flex;flex-wrap:wrap;gap:6px;">'
      + data.end_uses.map(x => '<span class="badge badge-gray">' + wovEsc(x) + '</span>').join('') + '</div>';
  }
  if (Array.isArray(data.notes) && data.notes.length) {
    html += '<div class="label mb-8">Notes</div>'
      + data.notes.map(n => '<div class="text-xs text-dim mb-4">• ' + wovEsc(n) + '</div>').join('');
  }

  return html;
}
