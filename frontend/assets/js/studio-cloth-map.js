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
    var at = function (g, w, c) { return g[mod(c, g.length)][mod(w, g[0].length)]; };
    var pattern = { grid: C, rows: C.length, cols: C[0].length, hasTM: has(C, ['T', 'M']), hasM: has(C, ['M']) };
    if (D) { pattern.dial = D; pattern.dialRows = D.length; pattern.dialCols = D[0].length; }
    var con, sample, sampleBack, photo = true;
    var cell = function (g) { return function (w, c) { return TOK[at(g, w, c)] || 'miss'; }; };

    if (!D) {
      var holes = has(C, ['E', '-']);
      var loopFeed = roles.indexOf('loop') > -1;
      if (holes) {
        con = { type: 'mesh', base: 'single', holeSource: 'pattern', label: 'single jersey with eyelets', mesh: true, brush: false };
        // the eyelet builder reads every 'miss' as a hole, so here only E and - may be one
        sample = function (w, c) { var x = at(C, w, c); return x === 'E' || x === '-' ? 'miss' : x === 'T' ? 'tuck' : 'knit'; };
        if (has(C, ['M'])) notes.push('With eyelets on the needle bed, the floats (M) are drawn as plain knit loops in the real view; the loop diagram shows them.');
        photo = false;                                   // eyelets have no fixed tile: the turnable 3D, not the macro photo
      } else if (loopFeed && d.plush) {
        con = { type: 'plush', base: 'single', cut: !!d.plush.cut, arrangement: d.plush.arrangement || 'full', label: d.plush.cut ? 'velour' : 'terry', mesh: false, brush: false };
        sample = cell(C);
      } else if (loopFeed) {
        con = { type: 'fleece', base: 'single', label: 'fleece', mesh: false, brush: true, pile: 'brush' };
        // which feeder carries which yarn: the face, a binder plated behind it, the loop yarn
        pattern.feedYarns = roles.map(function (r) { return r === 'binder' ? 'binder' : r === 'loop' ? 'fleecy' : 'face'; });
        sample = cell(C);
      } else {
        con = has(C, ['T'])
          ? { type: 'pique', base: 'single', label: 'single-bed tuck structure', mesh: false, brush: false }
          : { type: 'jersey', base: 'single', label: has(C, ['M']) ? 'single jersey with floats' : 'single jersey', mesh: false, brush: false };
        sample = cell(C);
      }
      sampleBack = sample;
    } else if (d.bed !== 'interlock' && !has(C, ['T', 'M', 'E']) && !has(D, ['T', 'M', 'E'])) {
      // plain rib: its own needle set-out, cylinder needles then dial needles
      var a = C[0].filter(function (x) { return x !== '-'; }).length || 1, b = D[0].filter(function (x) { return x !== '-'; }).length || 1;
      con = { type: 'rib', base: 'double', label: a + '×' + b + ' rib', mesh: false, brush: false, ribRepeat: { a: a, b: b } };
      sample = function (w) { return mod(w, a + b) < a ? 'knit' : 'purl'; };
      sampleBack = sample;
    } else {
      // two beds, each with its own programme: cardigan, milano, double piqué, interlock
      con = { type: 'interlock', base: 'double', label: d.bed === 'interlock' ? (has(C, ['T', 'M']) || has(D, ['T', 'M']) ? 'patterned interlock' : 'interlock') : 'double jersey (rib gating)', mesh: false, brush: false };
      sample = cell(C); sampleBack = cell(D);
      pattern.hasTM = has(C, ['T', 'M']) || d.bed !== 'interlock';
      if (has(C, ['E', '-']) || has(D, ['E', '-'])) notes.push('Empty needles and transfers on a double bed are drawn as misses in the real view.');
    }
    return { construction: con, pattern: pattern, sample: sample, sampleBack: sampleBack, photo: photo, notes: notes };
  }

  var api = { clothSpec: clothSpec };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KAStudioCloth = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
