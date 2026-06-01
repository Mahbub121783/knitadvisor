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
    html += `<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <thead>
        <tr style="border-bottom:1px solid var(--line2);">
          <th style="text-align:left;padding:8px;font-weight:600;font-size:12px;">Bar</th>
          <th style="text-align:left;padding:8px;font-weight:600;font-size:12px;">Notation</th>
          <th style="text-align:left;padding:8px;font-weight:600;font-size:12px;">Description</th>
        </tr>
      </thead>
      <tbody>`;

    const bars = patternData.lapping_pattern;
    const barKeys = Object.keys(bars).sort();
    barKeys.forEach((key, idx) => {
      const notation = bars[key];
      const desc = typeof notation === 'string' ? notation : (notation.notation || '—');
      const displayDesc = typeof notation === 'object' && notation.description ? notation.description : desc;
      html += `<tr style="border-bottom:1px solid var(--line3);">
        <td style="padding:8px;font-size:12px;">GB${idx + 1}</td>
        <td style="padding:8px;font-size:12px;"><code style="background:var(--bg3);padding:2px 6px;border-radius:2px;font-family:'JetBrains Mono';">${desc}</code></td>
        <td style="padding:8px;font-size:12px;color:var(--t2);">${displayDesc}</td>
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
      const notation = bars[key];
      const notationStr = typeof notation === 'object' && notation.notation ? notation.notation : notation;
      html += `<div style="margin-bottom:16px;padding:12px;background:var(--bg2);border-radius:var(--radius);">
        <div style="font-size:11px;font-weight:600;margin-bottom:6px;color:var(--t3);">Bar ${idx + 1}: ${notationStr}</div>
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
    html += `<div class="text-xs text-dim" style="margin-top:12px;padding:8px;background:var(--bg2);border-radius:var(--radius);">
      <strong>Machine Speed:</strong> ${ms.min}–${ms.max} stitch/min (typical: ${ms.typical})
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
 * Build SVG lapping motion diagram.
 *
 * Standard warp knit point notation: "A-B/C-D"
 *   A-B = overlap (yarn path ABOVE needle bed, front swing)
 *   C-D = underlap (yarn path BELOW needle bed, back swing)
 *   Values are ABSOLUTE needle point positions (0-indexed wale numbers).
 *   Movement direction: A→B and C→D.
 *
 * This renders two course rows: overlap on row 1 (y=25), underlap on row 2 (y=50).
 * Arrows show direction of yarn guide bar movement.
 */
function buildWarpLappingSVG(notation, barIdx) {
  // Handle non-standard notations
  if (!notation || notation === 'Independent' || notation === 'Multi-wale inlay' ||
      notation.startsWith('Face') || notation.startsWith('Back') || notation.startsWith('Mirror')) {
    return `<div style="font-size:11px;color:var(--t3);padding:4px 0;font-style:italic;">${notation} — variable pattern</div>`;
  }

  const colors = ['var(--a1)', 'var(--a2)', 'var(--a4)', 'var(--a5)'];
  const color = colors[barIdx % colors.length];

  // Parse "A-B/C-D" → [{from:A, to:B}, {from:C, to:D}]
  const halves = notation.split('/');
  const moves  = halves.map(h => {
    const parts = h.split('-').map(Number);
    return { from: parts[0], to: parts[1] };
  }).filter(m => !isNaN(m.from) && !isNaN(m.to));

  if (moves.length === 0) {
    return `<div class="text-xs text-dim">Cannot parse notation: ${notation}</div>`;
  }

  // Determine needle range needed (add margin)
  const allPos = moves.flatMap(m => [m.from, m.to]);
  const maxPos  = Math.max(...allPos) + 2;
  const waleCount = Math.max(maxPos + 1, 6);

  const waleWidth = 24;
  const waleStart = 16;
  const svgWidth  = waleStart + waleCount * waleWidth + 16;
  const svgHeight = 80;
  const overlapY  = 28;   // y for overlap (above-bed swing)
  const underlapY = 55;   // y for underlap (below-bed swing)

  const uid = `lp-${barIdx}-${Math.random().toString(36).slice(2,6)}`;

  let svg = `<svg width="${svgWidth}" height="${svgHeight}" style="border:1px solid var(--line2);border-radius:2px;background:var(--bg3);overflow:visible;">
    <defs>
      <marker id="arrowO-${uid}" markerWidth="8" markerHeight="8" refX="7" refY="2.5" orient="auto">
        <path d="M0,0 L0,5 L7,2.5 z" fill="${color}"/>
      </marker>
      <marker id="arrowU-${uid}" markerWidth="8" markerHeight="8" refX="7" refY="2.5" orient="auto">
        <path d="M0,0 L0,5 L7,2.5 z" fill="var(--t3)"/>
      </marker>
    </defs>`;

  // Needle point vertical lines + labels
  for (let i = 0; i < waleCount; i++) {
    const x = waleStart + i * waleWidth;
    svg += `<line x1="${x}" y1="14" x2="${x}" y2="${svgHeight - 12}" stroke="var(--line3)" stroke-width="1"/>`;
    svg += `<circle cx="${x}" cy="14" r="3" fill="var(--bg4)" stroke="var(--line3)" stroke-width="1"/>`;
    svg += `<text x="${x}" y="${svgHeight - 2}" text-anchor="middle" font-size="8" fill="var(--t3)">${i}</text>`;
  }

  // Row labels
  svg += `<text x="2" y="${overlapY + 4}" font-size="8" fill="${color}" font-weight="600">OL</text>`;
  svg += `<text x="2" y="${underlapY + 4}" font-size="8" fill="var(--t3)">UL</text>`;

  // Draw each movement
  moves.forEach((m, idx) => {
    const isOverlap = idx % 2 === 0;
    const y = isOverlap ? overlapY : underlapY;
    const strokeColor = isOverlap ? color : 'var(--t3)';
    const markerId = isOverlap ? `arrowO-${uid}` : `arrowU-${uid}`;
    const dash = isOverlap ? '' : 'stroke-dasharray="4,3"';

    const fromX = waleStart + m.from * waleWidth;
    const toX   = waleStart + m.to   * waleWidth;

    if (fromX === toX) {
      // No movement (e.g. closed lap 0-0)
      svg += `<circle cx="${fromX}" cy="${y}" r="4" fill="none" stroke="${strokeColor}" stroke-width="1.5"/>`;
    } else {
      // Arrow showing direction
      const dx    = toX - fromX;
      const endX  = dx > 0 ? toX - 3 : toX + 3;
      svg += `<path d="M${fromX},${y} L${endX},${y}" stroke="${strokeColor}" stroke-width="2" fill="none" marker-end="url(#${markerId})" ${dash}/>`;
    }

    // Dot at start position
    svg += `<circle cx="${fromX}" cy="${y}" r="3" fill="${isOverlap ? color : 'var(--t3)'}"/>`;
  });

  svg += `</svg>`;

  // Legend
  svg += `<div style="font-size:9px;color:var(--t3);margin-top:3px;">
    <span style="color:${color};font-weight:600;">OL</span> = overlap &nbsp;
    <span style="font-weight:500;">UL</span> = underlap &nbsp;·&nbsp; numbers = needle point positions
  </div>`;

  return svg;
}
