/**
 * KnitAdvisor — Pattern Renderer
 * Renders K/T/M grid from API data into visual HTML
 */

// ============================================================
// MAIN RENDER FUNCTION
// Called with pattern data from GET /api/pattern/:slug
// ============================================================
function renderPatternGrid(container, patternData) {
  if (!container) return;

  // Warp knit — intercept and use specialized renderer
  if (patternData?.fabric_type === 'warp_knit') {
    container.innerHTML = renderWarpKnitPattern(patternData);
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
  html += renderSvgSchematic(patternData);

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
function renderSvgSchematic(patternData) {
  const { pattern_cylinder, cam_arrangement, needle_arrangement, courses_per_repeat, wales_per_repeat } = patternData;
  if (!pattern_cylinder) return '';

  const needle_butt_pattern = needle_arrangement ? needle_arrangement.butt_pattern : null;

  const baseRows = pattern_cylinder.length;
  const baseCols = Array.isArray(pattern_cylinder[0]) ? pattern_cylinder[0].length : 1;
  
  // Multi-Repeat Tiling for better visualization
  const repeatX = 3;
  const repeatY = 2;
  const cols = baseCols * repeatX;
  const rows = baseRows * repeatY;
  
  const cellSize = 40;
  const width = cols * cellSize;
  const height = rows * cellSize;
  
  let html = `<div style="display:flex; flex-wrap:wrap; gap:32px; margin-top:16px;">`;

  // ----------------------------------------------------
  // 1. Fabric Notation (Yarn Path)
  // ----------------------------------------------------
  const fnHeight = height + 20; // Add padding to height for loops
  html += `
    <div style="display:flex; flex-direction:column; align-items:center; gap:8px;">
      <svg width="${width}" height="${fnHeight}" viewBox="0 -20 ${width} ${fnHeight}" style="background:#FFFFFF; border:1px solid #CCCCCC; border-radius:4px;">
  `;
  
  for (let r = 0; r < rows; r++) {
    const y = height - (r * cellSize) - (cellSize / 2); // Center of the row
    const baseR = r % baseRows;
    const rowData = Array.isArray(pattern_cylinder[baseR]) ? pattern_cylinder[baseR] : [pattern_cylinder[baseR]];
    
    // Draw needle points for this course
    for(let c = 0; c < cols; c++) {
      html += `<circle cx="${(c * cellSize) + (cellSize / 2)}" cy="${y}" r="2" fill="#000000" />`;
    }
    
    // Draw yarn path
    let path = `M 0 ${y}`;
    for (let c = 0; c < cols; c++) {
      const cx = (c * cellSize) + (cellSize / 2);
      const baseC = c % baseCols;
      const cell = (rowData[baseC] || '').toString().toUpperCase();
      
      if (cell === 'K') {
        // True overlapping loop (Cursive 'e')
        // Starts at cx-20. Curves up-right to top cx, then loops back left and down to cx+20.
        path += ` C ${cx} ${y}, ${cx + 20} ${y - 25}, ${cx} ${y - 25} C ${cx - 20} ${y - 25}, ${cx} ${y}, ${cx + 20} ${y}`;
      } else if (cell === 'T') {
        // Inverted V tuck over the needle (narrow tent)
        path += ` L ${cx - 8} ${y} L ${cx} ${y - 18} L ${cx + 8} ${y} L ${cx + 20} ${y}`;
      } else if (cell === 'M' || cell === '·') {
        // Straight float
        path += ` L ${cx + 20} ${y}`;
      } else {
        path += ` L ${cx + 20} ${y}`;
      }
    }
    html += `<path d="${path}" fill="none" stroke="#000000" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />`;
  }
  
  html += `
      </svg>
      <div style="font-size:11px; color:var(--t2); font-weight:500;">Fabric notation</div>
    </div>
  `;

  // ----------------------------------------------------
  // 2. Cam Arrangement
  // ----------------------------------------------------
  html += `
    <div style="display:flex; flex-direction:column; align-items:center; gap:8px;">
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="background:#FFFFFF; border:1px solid #CCCCCC; border-radius:4px;">
  `;
  for (let r = 0; r < rows; r++) {
    const y = height - (r * cellSize) - cellSize;
    const baseR = r % baseRows;
    const rowData = Array.isArray(pattern_cylinder[baseR]) ? pattern_cylinder[baseR] : [pattern_cylinder[baseR]];
    
    for (let c = 0; c < cols; c++) {
      const x = c * cellSize;
      const baseC = c % baseCols;
      const cell = (rowData[baseC] || '').toString().toUpperCase();
      
      // Cam block base
      html += `<rect x="${x+1}" y="${y+1}" width="${cellSize-2}" height="${cellSize-2}" fill="#F5F5F5" stroke="#CCCCCC" />`;
      
      // Needle butt dot path indicator
      html += `<circle cx="${x + (cellSize/2)}" cy="${y + (cellSize/2) + 6}" r="3" fill="#000000" />`;
      
      if (cell === 'K') {
        // Sharp Triangle
        html += `<path d="M ${x+8} ${y+32} L ${x+20} ${y+8} L ${x+32} ${y+32}" fill="none" stroke="#000000" stroke-width="3" stroke-linejoin="miter" />`;
      } else if (cell === 'T') {
        // Flat top trapezoid
        html += `<path d="M ${x+8} ${y+32} L ${x+14} ${y+20} L ${x+26} ${y+20} L ${x+32} ${y+32}" fill="none" stroke="#000000" stroke-width="3" stroke-linejoin="miter" />`;
      } else if (cell === 'M' || cell === '·') {
        // Flat straight block
        html += `<path d="M ${x+8} ${y+32} L ${x+32} ${y+32}" fill="none" stroke="#000000" stroke-width="3" stroke-linejoin="miter" />`;
      }
    }
  }
  html += `
      </svg>
      <div style="font-size:11px; color:var(--t2); font-weight:500;">Cam arrangement</div>
    </div>
  `;

  // ----------------------------------------------------
  // 3. Needle Arrangement (Grid)
  // ----------------------------------------------------
  // Determine physical needle tracks
  const patternStr = needle_butt_pattern || 'A'.repeat(baseCols);
  const distinctButts = Array.from(new Set(patternStr.split(''))); // e.g. ['A', 'B'] -> 2 tracks
  const numTracks = Math.max(distinctButts.length, 1);
  
  // Height is based on tracks, width is based on tiled columns
  const nGridHeight = numTracks * cellSize;
  
  html += `
    <div style="display:flex; flex-direction:column; align-items:center; gap:8px;">
      <svg width="${width}" height="${nGridHeight}" viewBox="0 0 ${width} ${nGridHeight}" style="background:#FFFFFF; border:1px solid #CCCCCC; border-radius:4px;">
  `;
  
  // Draw grid lines
  for(let c=0; c<=cols; c++) {
    html += `<line x1="${c*cellSize}" y1="0" x2="${c*cellSize}" y2="${nGridHeight}" stroke="#CCCCCC" stroke-width="1" />`;
  }
  for(let r=0; r<=numTracks; r++) {
    html += `<line x1="0" y1="${r*cellSize}" x2="${width}" y2="${r*cellSize}" stroke="#CCCCCC" stroke-width="1" />`;
  }
  
  // Draw butts
  for(let c=0; c<cols; c++) {
    const baseC = c % baseCols;
    const butt = patternStr[baseC % patternStr.length] || 'A';
    
    // Track index determines the row. Track 0 is bottom row.
    const trackIdx = distinctButts.indexOf(butt); 
    const safeTrackIdx = trackIdx !== -1 ? trackIdx : 0;
    
    const cx = (c * cellSize) + (cellSize / 2);
    const cy = nGridHeight - (safeTrackIdx * cellSize) - (cellSize / 2);
    
    html += `<circle cx="${cx}" cy="${cy}" r="7" fill="#000000" />`;
  }
  
  html += `
      </svg>
      <div style="font-size:11px; color:var(--t2); font-weight:500;">Needle arrangement</div>
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
