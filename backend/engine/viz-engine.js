'use strict';

/**
 * KnitAdvisor — Fabric Visualization Engine
 *
 * Generates structured path data (VizPathData) for Canvas 2D + SVG rendering.
 * Pure data output — no DOM, no canvas, no HTTP. All rendering happens in
 * frontend/js/fabric-visualizer.js.
 *
 * Sources:
 *   Spencer, D.J. (2001). Knitting Technology. Woodhead. — loop geometry Fig 7.1
 *   Peirce, F.T. (1947). J. Text. Inst. 38, T45 — yarn diameter formula
 *   Gajjar, B.H. (2017). Warp Knitting. — guide bar lapping geometry
 */

// ─────────────────────────────────────────────────────────────
// DEFAULT LOOP GEOMETRY (fallback when viz_configs row absent)
// ─────────────────────────────────────────────────────────────
const DEFAULT_LOOP_GEOM = {
  loop_head_ratio:   0.300,
  loop_height_ratio: 0.950,
  foot_splay_ratio:  0.200,
  layer_count:       1,
  sheen_model:       'matte',
  bar_colors:        ['#2563EB', '#DC2626', '#16A34A', '#D97706'],
  animate_default:   false,
};

// ─────────────────────────────────────────────────────────────
// YARN DIAMETER — Peirce (1947)
// ─────────────────────────────────────────────────────────────

/**
 * Returns yarn diameter in mm.
 * k constants: cotton/modal=0.9, polyester/nylon=1.0, wool=1.12
 */
function calcYarnDiameter(count_ne, fiberType) {
  const kMap = { cotton: 0.9, modal: 0.9, viscose: 0.95, polyester: 1.0, nylon: 1.0, acrylic: 1.0, wool: 1.12 };
  const k = kMap[fiberType] || 0.9;
  const ne = Math.max(count_ne || 30, 1);
  return { diameter_mm: k / Math.sqrt(ne), k, fiberType };
}

/**
 * Parses a composition string like "60% Cotton 40% Polyester"
 * and returns the dominant fiber type key.
 */
function classifyFiber(composition) {
  if (!composition) return 'cotton';
  const lower = composition.toLowerCase();
  const order = ['wool', 'modal', 'viscose', 'polyester', 'nylon', 'acrylic', 'cotton'];
  for (const f of order) {
    const m = lower.match(new RegExp(`(\\d+)%?\\s*${f}`));
    if (m && parseInt(m[1]) >= 50) return f;
  }
  for (const f of order) {
    if (lower.includes(f)) return f;
  }
  return 'cotton';
}

// ─────────────────────────────────────────────────────────────
// WEFT KNIT LOOP SEGMENT BUILDERS
// ─────────────────────────────────────────────────────────────

/**
 * Returns BezierSegment[] for a K (knit) loop.
 * cx, cy = centre of cell (feet baseline is cy, head apex at cy - H).
 * cellSize = px per grid cell.
 */
function buildKLoopSegments(cx, cy, cellSize, geom) {
  const W  = cellSize * geom.loop_head_ratio;
  const H  = cellSize * geom.loop_height_ratio;
  const FS = cellSize * geom.foot_splay_ratio;

  return [
    // Left leg + right leg as one continuous path (role tag for frontend)
    {
      role: 'loop_legs',
      type: 'bezier_pair',
      // Left leg
      x0: cx - FS, y0: cy,
      cp1x: cx - W * 1.6, cp1y: cy - H * 0.25,
      cp2x: cx - W,       cp2y: cy - H + W * 0.3,
      mx: cx, my: cy - H, // mid point (head apex)
      // Right leg
      cp3x: cx + W,       cp3y: cy - H + W * 0.3,
      cp4x: cx + W * 1.6, cp4y: cy - H * 0.25,
      x1: cx + FS, y1: cy,
      dashed: false,
    },
    // Left foot hook
    {
      role: 'foot_hook_left',
      type: 'quadratic',
      x0: cx - FS,          y0: cy,
      cpx: cx - FS * 2.4,   cpy: cy + FS * 1.2,
      x1: cx - FS * 3,      y1: cy + FS * 0.5,
      dashed: false,
      thinFactor: 0.75,
    },
    // Right foot hook
    {
      role: 'foot_hook_right',
      type: 'quadratic',
      x0: cx + FS,          y0: cy,
      cpx: cx + FS * 2.4,   cpy: cy + FS * 1.2,
      x1: cx + FS * 3,      y1: cy + FS * 0.5,
      dashed: false,
      thinFactor: 0.75,
    },
  ];
}

/**
 * Returns BezierSegment[] for a T (tuck) loop.
 * Single dashed bezier arc (held, no head formed).
 */
function buildTLoopSegments(cx, cy, cellSize, geom) {
  const H  = cellSize * geom.loop_height_ratio * 0.55;
  const FS = cellSize * geom.foot_splay_ratio;
  return [
    {
      role: 'tuck_arc',
      type: 'bezier',
      x0: cx - FS, y0: cy,
      cp1x: cx - FS, cp1y: cy - H,
      cp2x: cx + FS, cp2y: cy - H,
      x1: cx + FS,   y1: cy,
      dashed: true,
    },
  ];
}

/**
 * Returns BezierSegment[] for an M (miss/float) loop.
 * Simple horizontal line across full cell width.
 */
function buildMLoopSegments(cx, cy, cellSize) {
  const hw = cellSize * 0.5;
  return [
    {
      role: 'float_bar',
      type: 'line',
      x0: cx - hw, y0: cy,
      x1: cx + hw, y1: cy,
      dashed: false,
    },
  ];
}

// ─────────────────────────────────────────────────────────────
// WEFT KNIT — MAIN GENERATOR
// ─────────────────────────────────────────────────────────────

/**
 * generateWeftKnitPaths(result, config)
 *
 * result — full API result object from /api/calculate
 * config — row from viz_configs table (or {} for defaults)
 *
 * Returns WeftKnitVizData
 */
function generateWeftKnitPaths(result, config = {}) {
  const geom = {
    loop_head_ratio:   config.loop_head_ratio   || DEFAULT_LOOP_GEOM.loop_head_ratio,
    loop_height_ratio: config.loop_height_ratio || DEFAULT_LOOP_GEOM.loop_height_ratio,
    foot_splay_ratio:  config.foot_splay_ratio  || DEFAULT_LOOP_GEOM.foot_splay_ratio,
    sheen_model:       config.sheen_model        || DEFAULT_LOOP_GEOM.sheen_model,
    layer_count:       config.layer_count        || DEFAULT_LOOP_GEOM.layer_count,
  };

  const pattern = result.pattern || {};
  const cylinderGrid = pattern.pattern_cylinder || [['K']];
  const dialGrid     = pattern.pattern_dial     || null;
  const coursesPerRepeat = pattern.courses_per_repeat || cylinderGrid.length;
  const walesPerRepeat   = pattern.wales_per_repeat   || (cylinderGrid[0] || ['K']).length;

  // Tile the repeat 3× wide, 4× tall for visual continuity
  const tileW = 3;
  const tileH = 4;
  const totalCols = walesPerRepeat * tileW;
  const totalRows = coursesPerRepeat * tileH;

  const cellSize = 44; // px per cell (logical, before HiDPI scaling)
  const canvasWidth  = totalCols * cellSize;
  const canvasHeight = totalRows * cellSize;

  const yarn = result.yarn || {};
  const countNe = yarn.count_ne || 30;
  const composition = typeof result.input === 'object'
    ? (result.input.composition || result.composition?.raw || '')
    : '';
  const fiberType = classifyFiber(composition);
  const yarnDia = calcYarnDiameter(countNe, fiberType);
  const hasSheen = (geom.sheen_model === 'high_sheen') ||
                   (geom.sheen_model === 'gradient' && fiberType === 'polyester');

  const paths = [];

  for (let tRow = 0; tRow < tileH; tRow++) {
    for (let tCol = 0; tCol < tileW; tCol++) {
      for (let r = 0; r < coursesPerRepeat; r++) {
        for (let c = 0; c < walesPerRepeat; c++) {
          const globalRow = tRow * coursesPerRepeat + r;
          const globalCol = tCol * walesPerRepeat + c;

          // Canvas Y: row 0 = bottom, flip so course 1 is at bottom
          const cx = globalCol * cellSize + cellSize / 2;
          const cy = canvasHeight - (globalRow * cellSize + cellSize / 2);

          const cellType = (cylinderGrid[r] && cylinderGrid[r][c]) || 'K';

          let segments;
          if (cellType === 'K')      segments = buildKLoopSegments(cx, cy, cellSize, geom);
          else if (cellType === 'T') segments = buildTLoopSegments(cx, cy, cellSize, geom);
          else                       segments = buildMLoopSegments(cx, cy, cellSize);

          paths.push({
            row: globalRow,
            col: globalCol,
            type: cellType,
            cx, cy,
            loopH: cellSize * geom.loop_height_ratio,
            hasSheen,
            fiberType,
            segments,
          });

          // Dial loops (double-bed)
          if (dialGrid && dialGrid[r] && dialGrid[r][c] !== undefined) {
            const dialType = dialGrid[r][c];
            const dialCy   = cy - cellSize * 0.15; // slight offset above cylinder
            let dialSegs;
            if (dialType === 'K')      dialSegs = buildKLoopSegments(cx, dialCy, cellSize * 0.9, geom);
            else if (dialType === 'T') dialSegs = buildTLoopSegments(cx, dialCy, cellSize * 0.9, geom);
            else                       dialSegs = buildMLoopSegments(cx, dialCy, cellSize * 0.9);

            paths.push({
              row: globalRow,
              col: globalCol,
              type: dialType,
              cx, cy: dialCy,
              loopH: cellSize * 0.9 * geom.loop_height_ratio,
              hasSheen,
              fiberType,
              isDial: true,
              segments: dialSegs,
            });
          }
        }
      }
    }
  }

  // Sort: bottom rows first (painter's algorithm — later courses draw on top)
  paths.sort((a, b) => a.row - b.row || (a.isDial ? -1 : 1));

  const propertiesMap = generatePropertiesMap(result);
  const crossSection  = generateCrossSection(result, geom);

  return {
    kind: 'weft_knit',
    canvasWidth,
    canvasHeight,
    cellSize,
    totalRows,
    totalCols,
    coursesPerRepeat,
    walesPerRepeat,
    tileFactor: tileW,
    tileH,
    paths,
    yarnDia,
    hasSheen,
    fiberType,
    hasDialLayer: !!dialGrid,
    propertiesMap,
    crossSection,
  };
}

// ─────────────────────────────────────────────────────────────
// WARP KNIT LAPPING PARSER
// ─────────────────────────────────────────────────────────────

/**
 * Parses a lapping notation string like "1-0/1-2" or "2-3/1-0/2-3/1-0".
 * Returns array of {from, to, type} objects where type = 'overlap'|'underlap'.
 * Overlap and underlap alternate starting with overlap.
 */
function parseLappingNotation(notation) {
  if (!notation || typeof notation !== 'string') return [];
  const pairs = notation.trim().split('/');
  const moves = [];
  pairs.forEach((pair, i) => {
    const m = pair.match(/^(\d+)-(\d+)$/);
    if (!m) return;
    moves.push({
      from: parseInt(m[1]),
      to:   parseInt(m[2]),
      type: i % 2 === 0 ? 'overlap' : 'underlap',
    });
  });
  return moves;
}

/**
 * Builds bezier segment array for one warp bar across multiple courses.
 * Returns WarpBarPath.
 */
function buildWarpBarSegments(moves, barIdx, needleSpacingPx, courseHeightPx, courses, palette) {
  const color = (palette && palette[barIdx % palette.length]) || DEFAULT_LOOP_GEOM.bar_colors[barIdx % 4];
  const segments = [];

  if (!moves || moves.length === 0) return { barIdx, color, moves: [], segments };

  // Repeat the lapping cycle over 'courses' courses
  const cycleLen = moves.length;
  let needlePos  = moves[0].from; // track current needle position

  for (let course = 0; course < courses; course++) {
    const move = moves[course % cycleLen];
    const fromNeedle = needlePos;
    const toNeedle   = move.to;

    const x0 = fromNeedle * needleSpacingPx;
    const y0 = course * courseHeightPx;
    const x1 = toNeedle  * needleSpacingPx;
    const y1 = (course + 1) * courseHeightPx;

    const isOverlap = move.type === 'overlap';

    // Overlap: curves outward (cloth face), Underlap: curves inward (cloth back)
    const curveFactor = isOverlap ? 0.4 : -0.3;
    const dx = x1 - x0;
    const midY = (y0 + y1) / 2;

    segments.push({
      role: isOverlap ? 'overlap' : 'underlap',
      type: 'bezier',
      x0, y0,
      cp1x: x0 + dx * 0.25,             cp1y: y0 + courseHeightPx * 0.1,
      cp2x: x1 - dx * curveFactor,      cp2y: midY,
      x1, y1,
      dashed: !isOverlap,
      color,
      fromNeedle,
      toNeedle,
      courseIdx: course,
    });

    needlePos = toNeedle;
  }

  return { barIdx, color, moves, segments };
}

/**
 * Simple bounding-box intersection check between two line segments.
 * Returns {x, y} midpoint if they overlap, null otherwise.
 */
function segmentsBBoxOverlap(s1, s2) {
  const minX1 = Math.min(s1.x0, s1.x1), maxX1 = Math.max(s1.x0, s1.x1);
  const minY1 = Math.min(s1.y0, s1.y1), maxY1 = Math.max(s1.y0, s1.y1);
  const minX2 = Math.min(s2.x0, s2.x1), maxX2 = Math.max(s2.x0, s2.x1);
  const minY2 = Math.min(s2.y0, s2.y1), maxY2 = Math.max(s2.y0, s2.y1);
  if (maxX1 < minX2 || maxX2 < minX1 || maxY1 < minY2 || maxY2 < minY1) return null;
  return {
    x: (Math.max(minX1, minX2) + Math.min(maxX1, maxX2)) / 2,
    y: (Math.max(minY1, minY2) + Math.min(maxY1, maxY2)) / 2,
  };
}

/**
 * Detects approximate intersection points between bar paths.
 * Uses bounding-box pre-filter. Returns [{x, y, bar1Idx, bar2Idx}].
 */
function detectIntersections(bars) {
  const hits = [];
  for (let i = 0; i < bars.length - 1; i++) {
    for (let j = i + 1; j < bars.length; j++) {
      for (const s1 of bars[i].segments) {
        for (const s2 of bars[j].segments) {
          if (s1.courseIdx !== s2.courseIdx) continue;
          const pt = segmentsBBoxOverlap(s1, s2);
          if (pt) hits.push({ ...pt, bar1Idx: i, bar2Idx: j });
        }
      }
    }
  }
  return hits;
}

// ─────────────────────────────────────────────────────────────
// WARP KNIT — MAIN GENERATOR
// ─────────────────────────────────────────────────────────────

/**
 * generateWarpKnitPaths(result, config)
 *
 * Returns WarpKnitVizData
 */
function generateWarpKnitPaths(result, config = {}) {
  const warpKnit = result.warp_knit || {};
  const palette  = (config.bar_colors && Array.isArray(config.bar_colors))
    ? config.bar_colors
    : DEFAULT_LOOP_GEOM.bar_colors;
  const animated = (config.animate_default !== undefined) ? !!config.animate_default : true;

  // Guide bars and their lapping patterns
  const guideBarsData = warpKnit.guide_bars || {};
  const barNotations  = [];

  if (typeof guideBarsData === 'object' && !Array.isArray(guideBarsData)) {
    const lapping = warpKnit.lapping_pattern || {};
    for (const key of Object.keys(lapping)) {
      const entry = lapping[key];
      if (entry && entry.notation) {
        barNotations.push({ label: key, notation: entry.notation, desc: entry.description || '' });
      }
    }
  }
  if (barNotations.length === 0) {
    barNotations.push({ label: 'bar_1', notation: '1-0/1-2', desc: 'Default tricot' });
    barNotations.push({ label: 'bar_2', notation: '2-3/2-1', desc: 'Counter bar' });
  }

  // Determine needle count from stitch density
  const stDensity    = warpKnit.stitch_density || {};
  const walesPerCm   = stDensity.wales_per_cm  || 12;
  const coursesPerCm = stDensity.courses_per_cm || 8;
  const maxNeedle    = Math.max(
    ...barNotations.flatMap(b => parseLappingNotation(b.notation).flatMap(m => [m.from, m.to])),
    5
  ) + 2;
  const courses = Math.min(coursesPerCm * 3, 24); // show ~3cm height

  const needleSpacingPx = 36;
  const courseHeightPx  = 32;
  const svgWidth        = maxNeedle * needleSpacingPx + 40;
  const svgHeight       = courses * courseHeightPx + 40;

  const bars = barNotations.map((b, idx) => {
    const moves = parseLappingNotation(b.notation);
    return buildWarpBarSegments(moves, idx, needleSpacingPx, courseHeightPx, courses, palette);
  });

  const intersections = detectIntersections(bars);

  return {
    kind: 'warp_knit',
    svgWidth,
    svgHeight,
    needleSpacingPx,
    courseHeightPx,
    maxNeedle,
    courses,
    bars,
    barLabels: barNotations.map(b => ({ label: b.label, desc: b.desc })),
    palette,
    intersections,
    animated,
    animFrameCount: bars.reduce((s, b) => s + b.segments.length, 0),
    stitch_density: stDensity,
    wales_per_cm: walesPerCm,
    courses_per_cm: coursesPerCm,
  };
}

// ─────────────────────────────────────────────────────────────
// PROPERTIES MAP
// ─────────────────────────────────────────────────────────────

function generatePropertiesMap(result) {
  const tf = (result.physical_constraints || {}).tightness_factor || 14;
  const spirality = ((result.quality_prediction || {}).spirality || {});
  const shrinkage = ((result.quality_prediction || {}).shrinkage || {});

  let tfZone;
  if (tf < 12)      tfZone = 'slack';
  else if (tf > 16) tfZone = 'tight';
  else              tfZone = 'balanced';

  const tfColors = { slack: '#F59E0B', balanced: '#10B981', tight: '#EF4444' };

  return {
    tightness: {
      value: Math.round(tf * 100) / 100,
      zone: tfZone,
      color: tfColors[tfZone],
    },
    spirality: {
      angle_deg: spirality.skewness_angle || 0,
      risk: spirality.risk_level || 'low',
      arrowAngle_rad: ((spirality.skewness_angle || 0) * Math.PI) / 180,
    },
    shrinkage: {
      lengthwise: {
        pct: shrinkage.lengthwise_pct || 0,
        arrowLength_normalized: Math.min((shrinkage.lengthwise_pct || 0) / 15, 1),
      },
      widthwise: {
        pct: shrinkage.widthwise_pct || 0,
        arrowLength_normalized: Math.min((shrinkage.widthwise_pct || 0) / 15, 1),
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────
// CROSS-SECTION DATA (SVG side-on view)
// ─────────────────────────────────────────────────────────────

/**
 * Generates cross-section SVG layout data.
 * Shows 4 courses × 2 layers (cylinder + dial for double-bed).
 * Returns CrossSectionData: { svgWidth, svgHeight, layers }
 */
function generateCrossSection(result, geom) {
  const isDoubleBed  = (result.fabric && result.fabric.machine_type &&
    (result.fabric.machine_type.includes('double') || result.fabric.machine_type.includes('rib') ||
     result.fabric.machine_type.includes('interlock')));
  const layerCount   = geom.layer_count || (isDoubleBed ? 2 : 1);
  const pattern      = result.pattern || {};
  const cylinderGrid = pattern.pattern_cylinder || [['K']];
  const wales        = Math.min((cylinderGrid[0] || ['K']).length * 3, 8);
  const courses      = Math.min(cylinderGrid.length * 2, 4);

  const needleSpacing = 40;
  const layerHeight   = 28;
  const svgWidth      = wales * needleSpacing + 40;
  const svgHeight     = courses * layerCount * layerHeight + 40;

  const layers = [];
  for (let l = 0; l < layerCount; l++) {
    const layerY = svgHeight - 20 - l * courses * layerHeight;
    const grid   = l === 0 ? cylinderGrid : (pattern.pattern_dial || cylinderGrid);
    const stitches = [];
    for (let c = 0; c < courses; c++) {
      for (let w = 0; w < wales; w++) {
        const ri = c % grid.length;
        const ci = w % (grid[ri] || ['K']).length;
        stitches.push({
          x: 20 + w * needleSpacing,
          y: layerY - c * layerHeight,
          type: (grid[ri] && grid[ri][ci]) || 'K',
          course: c,
          wale: w,
        });
      }
    }
    layers.push({ layerIdx: l, label: l === 0 ? 'Cylinder' : 'Dial', stitches });
  }

  return { svgWidth, svgHeight, layerCount, layers, wales, courses, needleSpacing, layerHeight };
}

// ─────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────

module.exports = {
  generateWeftKnitPaths,
  generateWarpKnitPaths,
  generatePropertiesMap,
  generateCrossSection,
  // Exposed for unit testing / reuse
  parseLappingNotation,
  calcYarnDiameter,
  classifyFiber,
  buildKLoopSegments,
  buildTLoopSegments,
  buildMLoopSegments,
};
