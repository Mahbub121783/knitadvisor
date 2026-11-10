// KnitAdvisor · Fabric Studio — the drawn needle programme as the knit3d
// engine's input (the real view). Plain script: the page and the node tests
// both use it, so what is tested is what is drawn.
//
// The notation is the source of truth. Each cell reaches the 3D unchanged:
//   K knit · T tuck · M miss on either bed, feed by feed (one course per feed)
//   E transfer and - (needle out) open a hole: pointelle eyelet / ladder
// The construction picks the engine's builder that can draw that notation:
//   single bed, no holes          jersey, or piqué when it tucks
//   single bed with E or -        mesh (eyelets where the cell is E or -)
//   a loop-yarn feeder            fleece (face / binder / loop by feeder role),
//                                 or plush when the engine solved a pile
//   rib gating, all K             rib, with its own set-out (a × b)
//   rib gating with T or M        two-bed programme (cardigan, milano, double piqué):
//                                 each bed's own K/T/M, the dial half a needle over
//   interlock gating              two-bed programme, interlock
(function (root) {
  'use strict';

  var mod = function (n, m) { return ((n % m) + m) % m; };
  var has = function (g, set) { return !!g && g.some(function (r) { return r.some(function (x) { return set.indexOf(x) > -1; }); }); };
  var TOK = { K: 'knit', T: 'tuck', M: 'miss' };

  /**
   * @param d {bed:'single'|'rib'|'interlock', C, D, feeds:[{role}], plush?:{cut, arrangement}}
   * @returns {{construction, pattern, sample(w,c), sampleBack(w,c), photo, notes:string[]}}
   */
  function clothSpec(d) {
    var C = d.C, D = d.D || null, notes = [];
    var roles = (d.feeds || []).map(function (f) { return (f && f.role) || 'ground'; });
    // the engine's reading of the roles (fabric-studio.js resolveRoles): a loop
    // yarn that knits is a pile only when a pile is chosen; otherwise it knits
    // in like any yarn. On a double bed it always knits in.
    var pileOn = d.pile == null ? true : d.pile === 'sinker';
    var brush = d.brush || 'none', brushed = brush !== 'none';
    roles = roles.map(function (r, i) { return r === 'loop' && C[i] && C[i].indexOf('K') > -1 && (D || !pileOn) ? 'ground' : r; });
    var at = function (g, w, c) { return g[mod(c, g.length)][mod(w, g[0].length)]; };
    var pattern = { grid: C, rows: C.length, cols: C[0].length, hasTM: has(C, ['T', 'M']), hasM: has(C, ['M']) };
    if (D) { pattern.dial = D; pattern.dialRows = D.length; pattern.dialCols = D[0].length; }
    var con, sample, sampleBack, photo = true;
    var cell = function (g) { return function (w, c) { return TOK[at(g, w, c)] || 'miss'; }; };

    if (!D) {
      var holes = has(C, ['E', '-']);
      var loopFeed = roles.indexOf('loop') > -1;
      var pileFeed = roles.some(function (r, i) { return r === 'loop' && C[i].indexOf('K') > -1; });
      if (holes) {
        con = { type: 'mesh', base: 'single', holeSource: 'pattern', label: 'single jersey with eyelets', mesh: true, brush: false };
        // the eyelet builder reads every 'miss' as a hole, so here only E and - may be one
        sample = function (w, c) { var x = at(C, w, c); return x === 'E' || x === '-' ? 'miss' : x === 'T' ? 'tuck' : 'knit'; };
        if (has(C, ['M'])) notes.push('With eyelets on the needle bed, the floats (M) are drawn as plain knit loops in the real view; the loop diagram shows them.');
        photo = false;                                   // eyelets have no fixed tile: the turnable 3D, not the macro photo
      } else if (pileFeed && d.plush) {
        con = { type: 'plush', base: 'single', cut: !!d.plush.cut, arrangement: d.plush.arrangement || 'full', label: d.plush.cut ? 'velour' : 'terry', mesh: false, brush: false };
        sample = cell(C);
      } else if (loopFeed) {
        // raised: the fleece nap; not raised: the loop yarn's floats stay as a loopback (French terry) back
        con = brushed && brush !== 'face'
          ? { type: 'fleece', base: 'single', label: 'fleece (raised back)', mesh: false, brush: true, pile: 'brush' }
          : { type: 'terry', base: 'single', label: 'loopback (not raised)', mesh: false, brush: brushed, pile: 'loop' };
        // which feeder carries which yarn: the face, a binder plated behind it, the loop yarn
        pattern.feedYarns = roles.map(function (r) { return r === 'binder' ? 'binder' : r === 'loop' ? 'fleecy' : 'face'; });
        if (pileFeed) notes.push('A knitting loop-yarn feeder without a pile is drawn as a face course.');
        sample = cell(C);
      } else {
        con = has(C, ['T'])
          ? { type: 'pique', base: 'single', label: 'single-bed tuck structure', mesh: false, brush: false }
          : { type: 'jersey', base: 'single', label: has(C, ['M']) ? 'single jersey with floats' : 'single jersey', mesh: false, brush: false };
        if (brushed) { con.brush = true; con.label += ' — brushed'; }
        sample = cell(C);
      }
      sampleBack = sample;
    } else if (d.bed !== 'interlock' && !has(C, ['T', 'M', 'E', 'R']) && !has(D, ['T', 'M', 'E', 'R'])) {
      // plain rib: its own needle set-out, cylinder needles then dial needles
      var a = C[0].filter(function (x) { return x !== '-'; }).length || 1, b = D[0].filter(function (x) { return x !== '-'; }).length || 1;
      con = { type: 'rib', base: 'double', label: a + '×' + b + ' rib' + (brushed ? ' — brushed' : ''), mesh: false, brush: brushed, ribRepeat: { a: a, b: b } };
      sample = function (w) { return mod(w, a + b) < a ? 'knit' : 'purl'; };
      sampleBack = sample;
    } else {
      // two beds, each with its own programme: cardigan, milano, double piqué, interlock
      con = { type: 'interlock', base: 'double', label: (d.bed === 'interlock' ? (has(C, ['T', 'M']) || has(D, ['T', 'M']) ? 'patterned interlock' : 'interlock') : 'double jersey (rib gating)') + (brushed ? ' — brushed' : ''), mesh: false, brush: brushed };
      sample = cell(C); sampleBack = cell(D);
      pattern.hasTM = has(C, ['T', 'M']) || d.bed !== 'interlock';
      if (has(C, ['E', '-', 'R']) || has(D, ['E', '-', 'R'])) notes.push('Empty needles and transfers on a double bed are drawn as misses in the real view; the loop structure view draws the transfer.');
    }
    if (brush === 'back' || brush === 'both') notes.push('Brushed on the back: press "Show back" to see the nap.');
    // stripes: each course in its own yarn colour, as a tint on the base colour
    var courseTint = null, base = null;
    if (d.stripe && d.stripe.seq && d.stripe.seq.length) {
      var seq = d.stripe.seq, cols = d.stripe.colours || {};
      var rgb = function (hx) { var n = parseInt(String(hx || '#888888').slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
      // a neutral grey base (a white base would take a white finish's optical
      // brightener), each course scaled to its own yarn's colour in linear light
      base = '#b4b4b4';
      var lin = function (v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      var g0 = lin(0xb4);
      courseTint = function (c) { var k = rgb(cols[seq[mod(c, seq.length)]]); return [lin(k[0]), lin(k[1]), lin(k[2])].map(function (x) { return Math.max(0.004, x) / g0; }); };
      // the baked swatch repeats over the structure: a longer stripe cannot be baked, the turnable 3D shows it
      var L = (function (a, b) { var g = function (x, y) { return y ? g(y, x % y) : x; }; return a / g(a, b) * b; })(pattern.rows, seq.length);
      if (L <= 32) pattern.rows = L; else { photo = false; notes.push('The stripe repeat is ' + seq.length + ' courses: shown on the turnable 3D (the swatch photo repeats over 32 courses at most).'); }
    }
    return { construction: con, pattern: pattern, sample: sample, sampleBack: sampleBack, photo: photo, notes: notes, courseTint: courseTint, baseColour: base };
  }

  var api = { clothSpec: clothSpec };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KAStudioCloth = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
