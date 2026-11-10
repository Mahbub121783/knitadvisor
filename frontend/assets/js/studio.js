/**
 * KnitAdvisor — Fabric Studio (studio.html)
 *
 * The page draws; the engine decides. Every edit posts the whole design to
 * /api/studio/analyse (fabric-studio.js), which checks it and answers with
 * the set-out, the yarn per feeder, the fabric and the machine — the page
 * only renders that answer, so the numbers here and on the floor cannot drift
 * apart. Two 3D views: the loop diagram (studio-loops.js — every yarn as a
 * coloured tube, to read each knit, tuck and miss) and the real fabric, which
 * is the knit3d engine the result page uses (real yarn, light and cloth
 * surface), fed the drawn programme and the engine's density directly.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var r1 = function (v) { return Math.round(v * 10) / 10; };
  var SRC = { m: 'measured', c: 'calculated', e: 'estimated' };
  var src = function (k) { return '<span class="src ' + k + '">' + SRC[k] + '</span>'; };
  var ROLE_LABEL = { ground: 'ground', face: 'face', binder: 'binder', loop: 'loop' };
  var ROLE_COL = { ground: '#1857C4', face: '#1857C4', binder: '#7a4fc2', loop: '#c2410c' };

  // ── state ────────────────────────────────────────────────────────────────
  var S = {
    bed: 'single',           // single | rib | interlock
    C: [['K']], D: null,
    feeds: [{ role: 'ground', ne: '', sl_ratio: '' }],
    brush: 'K',
    templateId: 'single_jersey',
  };
  var undo = [];
  var rolls = [];            // trial rolls for the drawn design
  var templates = [];
  var last = null;            // last engine answer
  var reqSeq = 0;

  function snapshot() {
    undo.push(JSON.stringify({ bed: S.bed, C: S.C, D: S.D, feeds: S.feeds }));
    if (undo.length > 60) undo.shift();
  }
  function restore(json) {
    var o = JSON.parse(json);
    S.bed = o.bed; S.C = o.C; S.D = o.D; S.feeds = o.feeds;
  }
  var nFeeds = function () { return S.C.length; };
  var nNeedles = function () { return S.C[0].length; };
  var beds = function () { return S.D ? [['C', S.C], ['D', S.D]] : [['C', S.C]]; };

  // ── templates ────────────────────────────────────────────────────────────
  var CAT_LABEL = { single_jersey: 'Single jersey family', rib: 'Rib family (double bed)', interlock: 'Interlock family (double bed)' };

  var machines = [], warpData = null;
  // the technology comes first: weft (circular) or warp (tricot / raschel)
  function setTech(t) {
    Array.prototype.forEach.call($('st-tech').children, function (b) { b.classList.toggle('on', b.getAttribute('data-tech') === t); });
    $('st-weft').hidden = t !== 'weft'; $('st-warp').hidden = t !== 'warp';
    try { localStorage.setItem('ka-studio-tech', t); } catch (_) {}
    if (t === 'warp' && warpData && window.KAStudioWarp) window.KAStudioWarp.start(warpData);
  }
  // ── yarns: one row per role the design uses ────────────────────────────
  var YROWS = [
    { key: 'ground', c: 'st-ne', u: 'st-unit', f: 'st-fibre', t: 'st-ytype', p: 'st-ply', fil: 'st-fil' },
    { key: 'binder', c: 'yb-count', u: 'yb-unit', f: 'yb-fibre', t: 'yb-type', p: 'yb-ply', fil: 'yb-fil' },
    { key: 'loop', c: 'yl-count', u: 'yl-unit', f: 'yl-fibre', t: 'yl-type', p: 'yl-ply', fil: 'yl-fil' },
    { key: 'plate', c: 'yp-count', u: 'yp-unit', f: 'yp-fibre', t: 'yp-type', p: 'yp-ply', fil: 'yp-fil' },
  ];
  var SPUN = [['combed', 'Combed ring'], ['carded', 'Carded ring'], ['compact', 'Compact'], ['siro', 'Siro'], ['siro_compact', 'Siro-compact'], ['open_end', 'Open-end (rotor)'], ['vortex', 'Vortex (air-jet)']];
  var FILA = [['dty', 'Textured (DTY)'], ['fdy', 'Flat (FDY)']];
  var isFil = function (f) { return /filament/.test(f || ''); };
  function yarnTypes(R) {
    var fib = $(R.f).value, sel = $(R.t), keep = sel.value, list = isFil(fib) ? FILA : SPUN;
    sel.innerHTML = list.map(function (x) { return '<option value="' + x[0] + '">' + x[1] + '</option>'; }).join('');
    if (list.some(function (x) { return x[0] === keep; })) sel.value = keep;
    var fil = $(R.fil).closest('.st-yfil'); if (fil) fil.hidden = !isFil(fib);
    if (isFil(fib) && $(R.u).value === 'ne' && !$(R.c).value) $(R.u).value = 'denier';
  }
  function yarnOf(R) {
    var y = { fibre: $(R.f).value, type: $(R.t).value, ply: +$(R.p).value || 1 };
    if (+$(R.c).value > 0) { y.count = +$(R.c).value; y.unit = $(R.u).value; }
    if (isFil(y.fibre) && +$(R.fil).value > 0) y.filaments = +$(R.fil).value;
    return y;
  }
  var TEX = { ne: function (v) { return 590.5 / v; }, nm: function (v) { return 1000 / v; }, nw: function (v) { return 885.8 / v; }, tex: function (v) { return v; }, dtex: function (v) { return v / 10; }, denier: function (v) { return v / 9; } };
  // the ground yarn as Ne (for the views), whatever system it was given in
  function groundNeOf() { var R = YROWS[0], v = +$(R.c).value; if (!(v > 0)) return 0; return 590.5 / (TEX[$(R.u).value](v) * (+$(R.p).value || 1)); }
  function showYarnRows() {
    var roles = S.feeds.map(function (f) { return (f && f.role) || 'ground'; });
    document.querySelector('[data-yrole="binder"]').hidden = roles.indexOf('binder') < 0;
    document.querySelector('[data-yrole="loop"]').hidden = roles.indexOf('loop') < 0;
    document.querySelector('[data-yrole="plate"]').hidden = !S.feeds.some(function (f) { return f && f.plate; });
    document.querySelector('[data-yrole="ground"] .st-yhead b').textContent = roles.indexOf('face') > -1 ? 'Face yarn' : 'Ground yarn';
  }
  function showYarnEq() {
    if (!last || !last.yarn) return;
    var eq = function (e) { return e ? '= ' + e.tex + ' tex · ' + e.ne + 's Ne · ' + e.nm + ' Nm · ' + e.dtex + ' dtex · ' + e.denier + ' D' : ''; };
    var g = last.yarn.ground;
    $('st-yeq-ground').textContent = eq(g.equivalents) + (g.d_mm ? ' · Ø ' + g.d_mm + ' mm' : '') + (g.source === 'solved' ? ' (solved: ' + g.count + ')' : '');
    ['binder', 'loop', 'plate'].forEach(function (k) { if (k === 'plate') { var pf = (last.yarn.feeds || []).filter(function (x) { return x.plated; })[0]; $('st-yeq-plate').textContent = pf ? 'back yarn ' + pf.plated.back + ' — ' + pf.plated.back_pct + '% of the plated feed' : ''; return; } var y = (last.yarn.roles || {})[k]; $('st-yeq-' + k).textContent = y ? eq(y.equivalents) + ' · Ø ' + y.d_mm + ' mm' + (y.source !== 'your input' ? ' — ' + y.source : '') : ''; });
    (last.yarn.character || []).forEach(function (c) {
      var k = c.role === 'face' || c.role === 'ground' ? 'ground' : c.role === 'plated' ? 'plate' : c.role, el = $('st-yeq-' + k); if (!el) return;
      var R = c.relative || {}, sg = function (v) { return v == null ? '—' : (v > 0 ? '+' : '') + v + '%'; };
      el.textContent += ' | ' + (c.system ? c.system + ' vs combed ring' : 'vs combed ring') + ': strength ' + sg(R.strength_pct) + ', hairiness ' + sg(R.hairiness_pct) + ', torque ' + sg(R.spirality_pct) + ', pilling ' + (c.pilling_delta > 0 ? '+' : '') + c.pilling_delta + ' grade' + (c.spinnable ? '' : ' — not spinnable at this count');
    });
  }
  var MYM = 'ka-studio-mymachine';
  function myMachine() {
    var cams = function (b) { var a = ['K']; document.querySelectorAll('[data-mmc="' + b + '"]').forEach(function (x) { if (x.checked) a.push(x.value); }); return a; };
    var g = $('mm-gating').value;
    return {
      name: $('mm-name').value || 'My machine', kind: $('mm-kind').value, gatings: g === 'both' ? ['rib', 'interlock'] : [g],
      selection: $('mm-sel').value, technique: $('mm-tech').value, tracks_cyl: +$('mm-tc').value, tracks_dial: +$('mm-td').value,
      cams_cyl: cams('C'), cams_dial: cams('D'), sinker: $('mm-sinker').value, striper: +$('mm-striper').value || 0, max_width: +$('mm-wheel').value || null,
      fpi: +$('mm-fpi').value || (num('st-feeders') && num('st-dia') ? num('st-feeders') / num('st-dia') : null),
      sf: +$('mm-sf').value || (num('st-rpm') && num('st-dia') ? num('st-rpm') * num('st-dia') : null),
    };
  }
  function saveMyMachine() { try { localStorage.setItem(MYM, JSON.stringify(myMachine())); } catch (_) {} }
  function loadMyMachine() {
    var m; try { m = JSON.parse(localStorage.getItem(MYM) || 'null'); } catch (_) { m = null; }
    if (!m) return;
    var set = function (id, v) { if (v != null && $(id)) $(id).value = v; };
    set('mm-name', m.name); set('mm-kind', m.kind); set('mm-gating', m.gatings && m.gatings.length > 1 ? 'both' : (m.gatings || ['rib'])[0]);
    set('mm-sel', m.selection); set('mm-tech', m.technique); set('mm-tc', m.tracks_cyl); set('mm-td', m.tracks_dial); set('mm-sinker', m.sinker);
    set('mm-striper', m.striper); set('mm-wheel', m.max_width || ''); set('mm-fpi', +m.fpi ? m.fpi : ''); set('mm-sf', +m.sf ? m.sf : '');
    ['C', 'D'].forEach(function (b) { var a = b === 'C' ? m.cams_cyl : m.cams_dial; document.querySelectorAll('[data-mmc="' + b + '"]').forEach(function (x) { x.checked = (a || []).indexOf(x.value) > -1; }); });
  }
  // the drawing palette follows the chosen machine: a symbol it has no cam
  // (or no transfer needle) for is greyed out; Auto allows everything
  function paletteFor() {
    var m = $('st-mprof').value === 'custom' ? (function () { var mm = myMachine(); return { cams: { C: mm.cams_cyl, D: mm.kind === 'double' ? mm.cams_dial : [] }, transfer: mm.cams_cyl.indexOf('E') > -1, bed_transfer: mm.cams_cyl.indexOf('R') > -1 || mm.cams_dial.indexOf('R') > -1 }; })() : machines.filter(function (x) { return x.id === $('st-mprof').value; })[0];
    var ok = { K: true, T: true, M: true, E: true, R: true, '-': true };
    if (m) {
      var all = [].concat(m.cams.C || [], m.cams.D || []);
      ok = { K: true, M: true, '-': true, T: all.indexOf('T') > -1, E: !!m.transfer && (m.cams.C || []).indexOf('E') > -1, R: !!m.bed_transfer };
    }
    Array.prototype.forEach.call($('st-pal').children, function (b) {
      var sy = b.getAttribute('data-s');
      b.disabled = !ok[sy];
      b.title = ok[sy] ? '' : 'Your machine has no ' + (sy === 'E' || sy === 'R' ? 'transfer needles' : 'cam') + ' for this';
    });
    if (!ok[S.brush]) { S.brush = 'K'; Array.prototype.forEach.call($('st-pal').children, function (x) { x.classList.toggle('on', x.getAttribute('data-s') === 'K'); }); }
  }
  function loadTemplates() {
    return apiFetch('/api/studio/templates').then(function (d) {
      templates = d.templates || [];
      var fib = $('st-fibre');
      var fopts = Object.keys(d.fibres || {}).map(function (k) { return '<option value="' + k + '">' + esc(d.fibres[k].label) + '</option>'; }).join('');
      document.querySelectorAll('.st-yfibre').forEach(function (x) { var keep = x.value; x.innerHTML = fopts; if (keep) x.value = keep; });
      void fib; YROWS.forEach(yarnTypes);
      var sel = $('st-template');
      var groups = {};
      templates.forEach(function (t) { (groups[t.category] = groups[t.category] || []).push(t); });
      sel.innerHTML = '<option value="">Blank — draw from scratch</option>' + Object.keys(groups).map(function (g) {
        return '<optgroup label="' + esc(CAT_LABEL[g] || g) + '">' + groups[g].map(function (t) {
          return '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>';
        }).join('') + '</optgroup>';
      }).join('');
      sel.value = S.templateId;
      machines = d.machines || [];
      warpData = d.warp || null;
      var mp = $('st-mprof'), keep = mp.value;
      mp.innerHTML = '<option value="">Auto — the simplest machine that knits the design</option>' + machines.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.label) + '</option>'; }).join('') + '<option value="custom">My machine — enter its specification</option>';
      mp.value = keep;
      paletteFor();
    });
  }

  function applyTemplate(id) {
    var t = templates.filter(function (x) { return x.id === id; })[0];
    snapshot();
    S.templateId = id || '';
    S.templateNote = t && t.note ? t.note : '';
    if (!t) {
      S.bed = S.bed || 'single';
      S.C = [['K', 'K'], ['K', 'K']];
      S.D = S.bed === 'single' ? null : [['K', 'K'], ['K', 'K']];
      S.feeds = [{ role: 'ground' }, { role: 'ground' }];
    } else {
      S.bed = t.bed === 'single' ? 'single' : t.gating;
      S.C = t.grid.C.map(function (r) { return r.slice(); });
      S.D = t.grid.D ? t.grid.D.map(function (r) { return r.slice(); }) : null;
      // pad the shorter bed to one width, as the engine reads it
      var w = Math.max(S.C[0].length, S.D ? S.D[0].length : 0);
      var fit = function (g) { return g.map(function (r) { var o = []; for (var j = 0; j < w; j++) o.push(r[j % r.length]); return o; }); };
      S.C = fit(S.C); if (S.D) S.D = fit(S.D);
      S.feeds = t.roles.map(function (r) { return { role: r, plate: !!t.plated }; });
      $('st-cut').checked = id === 'velour_plush';
      $('st-brush').value = /fleece/.test(id) ? 'back' : 'none';
      $('st-brush-box').hidden = $('st-brush').value === 'none';
      $('st-pile').value = 'sinker';
      $('st-ply').value = String(t.ends || 1);
      if (t.gsm_range && t.gsm_range.min && !$('st-gsm').dataset.touched) {
        $('st-gsm').value = Math.round((t.gsm_range.min + t.gsm_range.max) / 2 / 5) * 5;
      }
      if (!$('st-name').value || $('st-name').dataset.auto) { $('st-name').value = t.name + ' (copy)'; $('st-name').dataset.auto = '1'; }
    }
    renderAll();
  }

  // ── editor ───────────────────────────────────────────────────────────────
  function cellCls(s) { return s === '-' ? 'X' : s; }

  function renderEditor() {
    var html = '';
    var bad = badCells();
    beds().forEach(function (b) {
      var key = b[0], g = b[1];
      html += '<div class="st-bed"><h4>' + (key === 'C' ? 'Cylinder' : 'Dial') + ' <span>' +
        (key === 'C' ? (S.D ? '— bottom bed, vertical needles' : '— single bed') : (S.bed === 'interlock' ? '— top bed, each needle faces the cylinder needle below it' : '— top bed, each needle sits between two cylinder needles')) +
        '</span></h4><div class="st-gridwrap"><table class="st-grid" data-bed="' + key + '"><tr><th></th>';
      for (var j = 0; j < g[0].length; j++) html += '<th>' + (j + 1) + '</th>';
      html += '<th style="text-align:left;padding-left:8px">' + (key === 'C' ? 'Yarn on this feeder' : '') + '</th></tr>';
      g.forEach(function (row, i) {
        html += '<tr><th>F' + (i + 1) + '</th>';
        row.forEach(function (s, j) {
          html += '<td class="c ' + cellCls(s) + (bad[key + i + '_' + j] ? ' bad' : '') + '" data-i="' + i + '" data-j="' + j + '">' + (s === '-' ? '' : s) + '</td>';
        });
        if (key === 'C') {
          var f = S.feeds[i] || { role: 'ground' };
          html += '<td class="feedcell"><select data-feed="' + i + '" data-k="role" aria-label="Yarn role, feeder ' + (i + 1) + '">' +
            ['ground', 'face', 'binder', 'loop'].map(function (r) { return '<option value="' + r + '"' + (f.role === r ? ' selected' : '') + '>' + ROLE_LABEL[r] + '</option>'; }).join('') +
            '</select> <input data-feed="' + i + '" data-k="count" type="number" min="1" max="2000" step="0.1" placeholder="count" value="' + esc(f.count || f.ne || '') + '" title="Count on this feeder, in the unit beside it. Empty = this role\'s yarn."> ' +
            '<select data-feed="' + i + '" data-k="unit" title="Count unit">' + [['ne', 'Ne'], ['nm', 'Nm'], ['tex', 'tex'], ['dtex', 'dtex'], ['denier', 'D']].map(function (u) { return '<option value="' + u[0] + '"' + ((f.unit || 'ne') === u[0] ? ' selected' : '') + '>' + u[1] + '</option>'; }).join('') + '</select> ' +
            '<label class="st-plate" title="Plate a second yarn behind this feeder\'s yarn (Plated yarn row under Yarn)"><input type="checkbox" data-feed="' + i + '" data-k="plate"' + (f.plate ? ' checked' : '') + '> plated</label> ' +
            '<select class="st-feedcol" data-feed="' + i + '" data-k="colour" title="Stripe yarn on this feeder (colours under Yarn)"><option value="">—</option>' + ['A', 'B', 'C', 'D', 'E', 'F'].map(function (c) { return '<option' + (f.colour === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select> ' +
            '<input data-feed="' + i + '" data-k="sl_ratio" type="number" min="0.3" max="3" step="0.01" placeholder="×SL" value="' + esc(f.sl_ratio || '') + '" title="Stitch length on this feeder as a multiple of the ground stitch length (e.g. 0.92 for a tighter tuck feeder). Empty = 1."></td>';
        } else html += '<td></td>';
        html += '</tr>';
      });
      html += '</table></div></div>';
    });
    $('st-editor').innerHTML = html;
  }

  // cells the engine flagged (interlock clashes)
  function badCells() {
    var out = {};
    if (!last || !last.checks) return out;
    last.checks.forEach(function (c) {
      var m = /^Feed (\d+), needle (\d+): on interlock/.exec(c.text);
      if (m) { out['C' + (m[1] - 1) + '_' + (m[2] - 1)] = 1; out['D' + (m[1] - 1) + '_' + (m[2] - 1)] = 1; }
    });
    return out;
  }

  var painting = false;
  function paintAt(td) {
    if (!td || !td.classList.contains('c')) return;
    var bed = td.closest('table').getAttribute('data-bed');
    var i = +td.getAttribute('data-i'), j = +td.getAttribute('data-j');
    var g = bed === 'C' ? S.C : S.D;
    if (g[i][j] === S.brush) return;
    g[i][j] = S.brush;
    td.className = 'c ' + cellCls(S.brush);
    td.textContent = S.brush === '-' ? '' : S.brush;
    schedule();
  }

  function bindEditor() {
    var ed = $('st-editor');
    ed.addEventListener('pointerdown', function (e) {
      var td = e.target.closest('td.c'); if (!td) return;
      e.preventDefault(); snapshot(); painting = true; paintAt(td);
    });
    ed.addEventListener('pointerover', function (e) { if (painting) paintAt(e.target.closest('td.c')); });
    ed.addEventListener('pointermove', function (e) {
      if (!painting || e.pointerType === 'mouse') return;
      paintAt(document.elementFromPoint(e.clientX, e.clientY) && document.elementFromPoint(e.clientX, e.clientY).closest('td.c'));
    });
    window.addEventListener('pointerup', function () { if (painting) { painting = false; renderNotation(); } });
    ed.addEventListener('change', function (e) {
      var el = e.target, i = el.getAttribute('data-feed'); if (i == null) return;
      snapshot();
      S.feeds[+i] = S.feeds[+i] || { role: 'ground' };
      S.feeds[+i][el.getAttribute('data-k')] = el.type === 'checkbox' ? el.checked : el.value;
      if (el.getAttribute('data-k') === 'plate') showYarnRows();
      schedule();
    });
    $('st-pal').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      S.brush = b.getAttribute('data-s');
      Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); });
    });
    $('st-edtools').addEventListener('click', function (e) {
      var b = e.target.closest('[data-op]'); if (!b) return;
      op(b.getAttribute('data-op'));
    });
  }

  function op(name) {
    if (name === 'undo') { if (undo.length) { restore(undo.pop()); renderAll(); } return; }
    snapshot();
    var all = beds().map(function (b) { return b[1]; });
    var F = nFeeds(), W = nNeedles();
    if (name === 'addFeed' && F < 48) {
      all.forEach(function (g) { g.push(g[F - 1].slice()); });
      S.feeds.push({ role: (S.feeds[F - 1] || {}).role || 'ground' });
    } else if (name === 'delFeed' && F > 1) {
      all.forEach(function (g) { g.pop(); }); S.feeds.pop();
    } else if (name === 'addNeedle' && W < 48) {
      all.forEach(function (g) { g.forEach(function (r) { r.push(r[W - 1]); }); });
    } else if (name === 'delNeedle' && W > 1) {
      all.forEach(function (g) { g.forEach(function (r) { r.pop(); }); });
    } else if (name === 'shiftL') {
      all.forEach(function (g) { g.forEach(function (r) { r.push(r.shift()); }); });
    } else if (name === 'shiftR') {
      all.forEach(function (g) { g.forEach(function (r) { r.unshift(r.pop()); }); });
    } else if (name === 'shiftU') {
      all.forEach(function (g) { g.push(g.shift()); }); S.feeds.push(S.feeds.shift());
    } else if (name === 'mirror') {
      all.forEach(function (g) { g.forEach(function (r) { r.reverse(); }); });
    } else { undo.pop(); return; }
    S.templateId = ''; $('st-template').value = '';
    renderAll();
  }

  function setBed(bed) {
    if (bed === S.bed) return;
    snapshot();
    var F = nFeeds(), W = nNeedles();
    if (bed === 'single') S.D = null;
    else if (!S.D) {
      S.D = [];
      for (var i = 0; i < F; i++) { var r = []; for (var j = 0; j < W; j++) r.push(bed === 'interlock' ? (S.C[i][j] === 'K' ? 'M' : 'K') : 'K'); S.D.push(r); }
    }
    S.bed = bed;
    S.templateId = ''; $('st-template').value = '';
    renderAll();
  }

  function renderBed() {
    Array.prototype.forEach.call($('st-bed').children, function (b) { b.classList.toggle('on', b.getAttribute('data-bed') === S.bed); });
    $('st-bed-hint').textContent = {
      single: 'One needle bed (cylinder): single jersey, piqué, lacoste, cross-miss, fleece and terry.',
      rib: 'Cylinder and dial, needles staggered: 1×1, 2×2 and broad ribs, cardigans, Milano.',
      interlock: 'Cylinder and dial, needles face to face on long and short tracks: interlock, Punto di Roma, double piqué.',
    }[S.bed] + (S.templateId && S.templateNote ? ' ' + S.templateNote : '');
    $('st-anibed').disabled = !S.D;
    if (!S.D) $('st-anibed').value = 'C';
  }

  // ── trial rolls ──────────────────────────────────────────────────────────
  var ROLLS = 'ka_studio_rolls';
  function signature() {
    return JSON.stringify([S.bed, S.C, S.D, S.feeds.map(function (f) { return [f.role, f.count || f.ne || '', f.unit || '', f.sl_ratio || '']; }),
      $('st-fibre').value, $('st-lycra').checked ? [$('st-lyd').value, $('st-lyevery').value] : 0]);
  }
  function readRolls() { try { return (JSON.parse(localStorage.getItem(ROLLS) || '{}')[signature()]) || []; } catch (_) { return []; } }
  function writeRolls() {
    try { var all = JSON.parse(localStorage.getItem(ROLLS) || '{}'); all[signature()] = rolls; localStorage.setItem(ROLLS, JSON.stringify(all)); } catch (_) {}
  }
  var ROLL_F = [['sl_mm', 'ℓ mm', '0.01'], ['ne', 'Ne', '1'], ['gsm', 'GSM', '1'], ['width_in', 'Width in', '0.1'], ['dia', 'Dia in', '1'], ['gauge', 'GG', '1']];
  function renderRolls() {
    $('st-rolls').innerHTML = rolls.map(function (r, i) {
      return '<div class="st-roll" data-i="' + i + '">' + ROLL_F.map(function (f) {
        return '<div><label>' + f[1] + '</label><input type="number" step="' + f[2] + '" data-k="' + f[0] + '" value="' + esc(r[f[0]] == null ? '' : r[f[0]]) + '"></div>';
      }).join('').replace(/(<div><label>GG<\/label>.*?<\/div>)$/, '$1') + '<button type="button" data-del="' + i + '" aria-label="Remove roll">remove roll</button></div>';
    }).join('') || '<p class="st-hint">No rolls yet.</p>';
  }
  function completeRolls() {
    return rolls.filter(function (r) { return r.sl_mm > 0 && r.gsm > 0 && r.width_in > 0 && r.dia > 0 && r.gauge > 0; })
      .map(function (r) { return { sl_mm: +r.sl_mm, ne: +r.ne > 0 ? +r.ne : null, gsm: +r.gsm, width_in: +r.width_in, dia: +r.dia, gauge: +r.gauge }; });
  }
  function bindRolls() {
    $('st-addroll').addEventListener('click', function () {
      var last0 = rolls[rolls.length - 1] || {};
      rolls.push({ sl_mm: '', ne: (groundNeOf() ? Math.round(groundNeOf() * 10) / 10 : '') || last0.ne || '', gsm: '', width_in: '', dia: num('st-dia') || last0.dia || '', gauge: num('st-gauge') || last0.gauge || '' });
      renderRolls(); writeRolls();
    });
    $('st-rolls').addEventListener('input', function (e) {
      var row = e.target.closest('.st-roll'); if (!row) return;
      rolls[+row.getAttribute('data-i')][e.target.getAttribute('data-k')] = e.target.value;
      writeRolls(); schedule();
    });
    $('st-rolls').addEventListener('click', function (e) {
      var d = e.target.getAttribute('data-del'); if (d == null) return;
      rolls.splice(+d, 1); renderRolls(); writeRolls(); schedule();
    });
    $('st-userolls').addEventListener('change', schedule);
  }

  // ── engine call ──────────────────────────────────────────────────────────
  var timer = null, timer3d = null;
  var lastSig = null;
  function schedule() {
    // a loop-yarn feeder that knits on a single bed is a plush pile
    $('st-plush-box').hidden = !(!S.D && S.feeds.some(function (f, i) { return f && f.role === 'loop' && S.C[i] && S.C[i].indexOf('K') > -1; }));
    var sg = signature();
    if (sg !== lastSig) { lastSig = sg; rolls = readRolls(); renderRolls(); }
    clearTimeout(timer);
    timer = setTimeout(analyse, 280);
    // the real view is a heavy rebuild: wait for a pause in the editing
    clearTimeout(timer3d); timer3d = setTimeout(render3D, mode3d === 'cloth' ? 700 : 120);
  }

  function num(id) { var v = parseFloat($(id).value); return isFinite(v) && v > 0 ? v : null; }

  function payload() {
    var vdq = [], cam = [];
    if (num('st-c1r') && num('st-c1l')) cam.push({ reading: num('st-c1r'), sl_mm: num('st-c1l') });
    if (num('st-c2r') && num('st-c2l')) cam.push({ reading: num('st-c2r'), sl_mm: num('st-c2l') });
    if (num('st-v1r') && num('st-v1l')) vdq.push({ reading: num('st-v1r'), course_length_m: num('st-v1l') });
    if (num('st-v2r') && num('st-v2l')) vdq.push({ reading: num('st-v2r'), course_length_m: num('st-v2l') });
    return {
      bed: S.D ? 'double' : 'single',
      gating: S.bed === 'interlock' ? 'interlock' : 'rib',
      grid: { C: S.C.map(function (r) { return r.join(''); }), D: S.D ? S.D.map(function (r) { return r.join(''); }) : null },
      feeds: S.feeds.map(function (f) {
        var c = +f.count > 0 ? +f.count : +f.ne > 0 ? +f.ne : 0;
        return { role: f.role || 'ground', colour: f.colour || null, plate: !!f.plate, yarn: c ? { count: c, unit: f.count ? (f.unit || 'ne') : 'ne' } : null, sl_ratio: +f.sl_ratio > 0 ? +f.sl_ratio : null };
      }),
      yarn: yarnOf(YROWS[0]),
      yarns: { binder: +$('yb-count').value > 0 ? yarnOf(YROWS[1]) : null, loop: +$('yl-count').value > 0 ? yarnOf(YROWS[2]) : null, plate: +$('yp-count').value > 0 ? yarnOf(YROWS[3]) : null },
      plush: { cut: $('st-cut').checked, sinker_mm: num('st-sinker'), arrangement: $('st-parr').value },
      pile: $('st-pile').value,
      stripes: $('st-stripe').value.trim() ? { sequence: $('st-stripe').value } : null,
      finish: { brush: $('st-brush').value, passes: num('st-passes'), sheared: $('st-shear').checked },
      elastane: $('st-lycra').checked ? { denier: +$('st-lyd').value, draft: num('st-lydraft') || 2.6, every: $('st-lyevery').value } : null,
      target: { gsm: num('st-gsm'), width_in: num('st-width'), shrinkage_pct: num('st-shr') },
      calibration: $('st-userolls').checked && completeRolls().length ? { rolls: completeRolls() } : null,
      machine: {
        gauge: num('st-gauge'), dia: num('st-dia'), feeders: num('st-feeders'), rpm: num('st-rpm'),
        sl_mm: num('st-sl'), efficiency: num('st-eff'), tracks_cyl: +$('st-tc').value || null, tracks_dial: +$('st-td').value || null, profile: $('st-mprof').value || null, transfer_dir: $('st-tdir').value, custom: $('st-mprof').value === 'custom' ? myMachine() : null,
        vdq: { points: vdq },
        cam_depth_mm: num('st-camd'), timing: $('st-timing').value || null, dial_gap_mm: num('st-dgap'), stitch_cam: { points: cam },
      },
    };
  }

  function analyse() {
    var my = ++reqSeq;
    $('st-status').innerHTML = '<span style="color:var(--t3)">Checking…</span>';
    apiFetch('/api/studio/analyse', { method: 'POST', body: payload() }).then(function (r) {
      if (my !== reqSeq) return;
      last = r;
      renderResult();
    }).catch(function (e) {
      if (my !== reqSeq) return;
      last = null;
      var msg = (e.data && e.data.error) || e.message || 'Could not analyse.';
      $('st-status').innerHTML = '<div class="st-err">' + esc(msg) + '</div>';
      $('st-checks').innerHTML = '';
    });
  }

  // ── rendering the answer ─────────────────────────────────────────────────
  function renderResult() {
    var r = last;
    var errs = r.checks.filter(function (c) { return c.level === 'error'; }).length;
    var warns = r.checks.filter(function (c) { return c.level === 'warn'; }).length;
    var conf = r.structure.confidence;
    $('st-status').innerHTML =
      '<span class="st-badge ' + (r.ok_to_knit ? 'ok' : 'bad') + '">' + (r.ok_to_knit ? 'Knittable' : errs + ' error' + (errs > 1 ? 's' : '') + ' — will not knit as drawn') + '</span>' +
      (warns ? '<span class="st-badge estimate">' + warns + ' warning' + (warns > 1 ? 's' : '') + '</span>' : '') +
      '<span class="st-badge ' + conf.level + '">' + ({ verified: 'Verified on your trial rolls', calibrated: 'Calibrated on factory records', close: 'Close to a measured family', estimate: 'New structure — estimate' })[conf.level] + '</span>' +
      '<span style="font-size:12px;color:var(--t2)">' + esc(r.structure.family_label) +
      (r.structure.match ? ' · same as <b>' + esc(r.structure.match.name) + '</b>' : '') + '</span>' +
      '<div style="flex-basis:100%;font-size:12px;color:var(--t2)">' + esc(conf.why) + '</div>' +
      (r.structure.reduced ? '<div style="flex-basis:100%;font-size:12px;color:var(--t2)">Your repeat of ' + esc(r.structure.reduced.from) + ' is the same fabric as its smallest repeat, ' + esc(r.structure.reduced.to) + ' — the set-out below uses that.</div>' : '');
    $('st-checks').innerHTML = r.checks.map(function (c) { return '<li class="' + c.level + '">' + esc(c.text) + '</li>'; }).join('');
    // repaint flagged cells without losing focus in feed inputs
    var bad = badCells();
    document.querySelectorAll('#st-editor td.c').forEach(function (td) {
      var bed = td.closest('table').getAttribute('data-bed');
      td.classList.toggle('bad', !!bad[bed + td.getAttribute('data-i') + '_' + td.getAttribute('data-j')]);
    });
    renderSetup(); renderResults(); renderMachine(); renderNotation(); showYarnEq();
    clearTimeout(timer3d); timer3d = setTimeout(render3D, 350);
    race.reset(); cycle.refresh();
  }

  function kpi(label, value, sub, k) {
    return '<div class="st-kpi"><div class="l">' + esc(label) + (k ? src(k) : '') + '</div><div class="v">' + value + '</div><div class="s">' + (sub || '') + '</div></div>';
  }

  function renderResults() {
    var r = last, f = r.fabric, y = r.yarn;
    var est = ({ calibrated: 'm', verified: 'm' })[r.structure.confidence.level] || 'e';
    var A = f.accuracy && !f.accuracy.own_rolls ? f.accuracy : null;
    var html = '<div class="st-kpis">' +
      kpi('Ground yarn', esc(y.ground.count), esc(y.ground.fibre) + ' · ' + y.ground.tex + ' tex' + (y.ground.source === 'solved' ? ' · solved' : ''), r.solver ? 'm' : null) +
      kpi('Stitch length', f.sl_mm + ' mm', esc(f.sl_source) + (f.sl_range_mm ? ' · range ' + f.sl_range_mm.join('–') : ''), est) +
      kpi('Finished GSM', f.gsm, (A ? '8 in 10 land ' + A.gsm.range.join('–') + ' · ±5%: ' + A.gsm.within_5_pct + '% of the time' : 'likely ' + f.gsm_range.join('–')) + (f.target_gsm ? ' · target ' + f.target_gsm : ''), est) +
      kpi('Open width', f.width_open_in + '"', 'tube ' + f.tube_in + '" · ' + (A && A.width ? '8 in 10 land ' + A.width.range.join('–') + '" · ±5%: ' + A.width.within_5_pct + '%' : 'likely ' + f.width_range_in.join('–') + '"'), est) +
      kpi('Tightness factor', f.tf, f.tf_window ? 'factory middle ' + f.tf_window.q1 + '–' + f.tf_window.q3 : '', 'c') +
      kpi('Wales × courses', f.wpi + ' × ' + f.cpi, 'per inch · ' + f.wpc + ' × ' + f.cpc + ' per cm', est) +
      '</div>' +
      // how right it is: measured, not claimed — the cross-validation on the factory records
      (A ? '<div class="st-acc"><b>How right is this?</b> When the Studio predicted ' + (A.level === 'estimate' ? 'structures it had no records for' : A.level === 'close' ? 'structures like this one' : 'cloths like this one') + ' without having seen them, the finished GSM was typically ' + A.gsm.typical_error_pct + '% off; ' +
        A.gsm.within_3_pct + '% landed within ±3%, ' + A.gsm.within_5_pct + '% within ±5%, ' + A.gsm.within_8_pct + '% within ±8%' + (A.width ? '. Width: typically ' + A.width.typical_error_pct + '% off, ' + A.width.within_5_pct + '% within ±5%' : '') + '. <span title="' + esc(A.method) + ' (' + esc(A.generated) + ')">' + esc(A.basis) + '.</span> Your own trial rolls narrow this (Trial rolls below).</div>' : '');
    if (f.calibration) {
      var cb = f.calibration;
      html += '<div class="st-sub">Your trial rolls ' + src('m') + '</div><p class="st-p">Ks ' + cb.ks + ' against ' + cb.model_ks + ' from the factory constants (' + (cb.ks_vs_model_pct > 0 ? '+' : '') + cb.ks_vs_model_pct + '%), Kw ' + cb.kw + ' against ' + cb.model_kw + ' (' + (cb.kw_vs_model_pct > 0 ? '+' : '') + cb.kw_vs_model_pct + '%). Scatter between rolls ' + cb.scatter_pct + '%.</p>' +
        '<div class="st-scroll"><table class="st-t"><tr><th>Roll</th><th>Measured GSM</th><th>Model GSM</th><th>Measured width</th><th>Model width</th><th>Ks vs mean</th><th>Kw vs mean</th></tr>' +
        cb.rolls.map(function (x) { return '<tr' + (x.outlier ? ' style="background:rgba(154,91,0,.1)"' : '') + '><td>' + x.roll + (x.outlier ? ' ⚠' : '') + '</td><td>' + Math.round(x.gsm) + '</td><td>' + x.model_gsm + '</td><td>' + r1(x.width_in) + '"</td><td>' + x.model_width_in + '"</td><td>' + x.ks_off_pct + '%</td><td>' + x.kw_off_pct + '%</td></tr>'; }).join('') + '</table></div>' +
        (cb.rolls.some(function (x) { return x.outlier; }) ? '<p class="st-p">A flagged roll is more than 10% from the others: re-measure it, or it may be a different yarn lot or machine setting.</p>' : '');
    }
    if (r.yarn && r.yarn.effects) {
      var YF = r.yarn.effects;
      html += '<div class="st-sub">Yarn character — what the kind of yarn does ' + src('e') + '</div><div class="st-kpis">' +
        kpi('Pilling', 'grade ' + YF.pilling_grade, 'of 5, face yarn' + (r.finish && r.finish.brushed !== 'none' ? ' + brushing' : ''), 'e') +
        kpi('Strength', YF.strength_vs_combed_pct == null ? '—' : (YF.strength_vs_combed_pct > 0 ? '+' : '') + YF.strength_vs_combed_pct + '%', 'bursting, against combed ring yarn', 'e') +
        (YF.twist_spirality_deg != null ? kpi('Twist spirality', YF.twist_spirality_deg + '°', 'wale lean from the yarn\'s torque', 'e') : '') +
        kpi('Surface', 'hairiness ' + YF.hairiness, YF.lustre + ' lustre', 'e') + '</div>' +
        (YF.handle ? '<p class="st-p">Handle: ' + esc(YF.handle) + '</p>' : '') +
        r.yarn.character.map(function (c) {
          return '<details class="st-p"><summary><b>' + esc(c.role[0].toUpperCase() + c.role.slice(1)) + ' yarn</b> — ' + esc(c.count) + ', ' + esc(c.system) + (c.mass_pct ? ' (' + c.mass_pct + '% of the fabric)' : '') + '</summary><ul class="st-checks">' +
            c.effects.map(function (e) { return '<li class="' + (e.kind === 'warn' ? 'warn' : e.kind === 'good' ? 'ok' : 'note') + '"><b>' + esc(e.area) + ':</b> ' + esc(e.text) + '</li>'; }).join('') +
            (c.process.length ? '<li class="note"><b>Processing:</b> ' + c.process.map(esc).join(' ') + '</li>' : '') + '</ul></details>';
        }).join('') + '<p class="st-p" style="font-size:12px">' + esc(YF.basis) + '.</p>';
    }
    if (f.relaxation) {
      var RX = f.relaxation, rs = RX.residual, cp = RX.compaction;
      html += '<div class="st-sub">Relaxation states and shrinkage ' + src('e') + '</div><p class="st-p">The loop length stays what the machine knitted; the shape of the loop — and with it wales, courses, weight and width — follows the state of relaxation (Munden: wales/cm = Kw ÷ ℓ, courses/cm = Kc ÷ ℓ).</p>' +
        '<div class="st-scroll"><table class="st-t"><tr><th>State</th><th>Wales × courses /cm</th><th>GSM</th><th>Open width</th><th>Length vs finished</th><th>Width vs finished</th></tr>' +
        RX.states.map(function (x) { return '<tr' + (x.state === 'finished' ? ' style="background:var(--accent-tint)"' : '') + '><td style="white-space:normal;font-family:inherit;min-width:190px">' + esc(x.label) + '</td><td>' + x.wpc + ' × ' + x.cpc + '</td><td>' + x.gsm + '</td><td>' + x.width_in + '"</td><td>' + (x.length_pct > 0 ? '+' : '') + x.length_pct + '%</td><td>' + (x.width_pct > 0 ? '+' : '') + x.width_pct + '%</td></tr>'; }).join('') + '</table></div>' +
        '<p class="st-p"><b>Residual shrinkage</b> after home laundering (finished → fully relaxed): length <b>' + rs.length_pct[1] + '%</b> (' + rs.length_pct[0] + '–' + rs.length_pct[2] + '), width <b>' + rs.width_pct[1] + '%</b> (' + rs.width_pct[0] + '–' + rs.width_pct[2] + '). Greige to finished: length ' + RX.processing.length_pct + '%, width ' + RX.processing.width_pct + '%.</p>' +
        '<p class="st-p"><b>Compaction for ' + cp.limit_pct + '%:</b> finish to at least ' + cp.min_cpc + ' courses/cm and ' + cp.min_wpc + ' wales/cm — open width ≤ ' + cp.max_width_in + '", about ' + cp.gsm_at_limit + ' GSM' + (cp.length_ok && cp.width_ok ? ' (the finished state already keeps it).' : ' — the finished state above does not keep it yet.') + '</p>' +
        '<p class="st-p" style="font-size:12px">' + esc(RX.basis) + '. Fibre factor ' + RX.fibre_factor + ' (how fully this yarn relaxes against cotton).</p>';
    }
    html += '<p class="st-p">State: ' + esc(f.state) + '. Kw ' + f.kw + ' (' + esc(f.kw_basis) + '), Ks ' + f.ks + ' (' + esc(f.ks_basis) + ').</p>';
    html += '<p class="st-p" style="font-family:var(--mono);font-size:11px">' + esc(f.formulas.gsm) + '<br>' + esc(f.formulas.width) + '</p>';
    if (r.solver) {
      var vd = r.solver.verdict || {};
      html += '<div class="st-sub">Count and gauge ' + src('m') + '</div>' +
        (vd.text ? '<ul class="st-checks"><li class="' + (vd.level === 'ok' ? 'ok' : 'warn') + '">' + esc(vd.text) + '</li></ul>' : '') +
        '<p class="st-p">' + esc(r.solver.basis) + '. ' + r.solver.feasible + ' of ' + r.solver.tried + ' count × gauge settings keep every limit.</p><div class="st-scroll"><table class="st-t"><tr><th>Count</th><th>Gauge</th><th>Stitch length</th><th>TF</th><th>GSM</th><th>Open width</th><th>Limits</th></tr>' +
        r.solver.options.map(function (o, i) {
          return '<tr' + (i === 0 ? ' style="background:var(--accent-tint)"' : '') + '><td>' + esc(o.count) + (i === 0 ? ' ✓' : '') + '</td><td>' + o.gauge + ' GG' + (o.practised ? ' ·&nbsp;factory' : '') + '</td><td>' + o.sl_mm + ' mm</td><td>' + o.tf + '</td><td>' + o.gsm + '</td><td>' + o.width_in + '"</td><td>' + (o.breaks && o.breaks.length ? '<span style="color:#9a5b00">' + esc(o.breaks.join('; ')) + '</span>' : 'all kept') + '</td></tr>';
        }).join('') + '</table></div><p class="st-p">“factory”: the gauge the factory records most often knit this count on for this family. Limits: tightness factor inside the factory\'s 5th–95th percentile, gauge fit, hook load, stitch length 1.8–7 mm.</p>';
    }
    if (r.finish && r.finish.brushed !== 'none') {
      var fz = r.finish;
      html += '<div class="st-sub">Finish: brushing ' + src('e') + '</div><p class="st-p">' + ({ back: 'Raised on the back', face: 'Brushed on the face (peach)', both: 'Brushed on both sides' })[fz.brushed] + ', ' + fz.passes + ' passes' + (fz.sheared ? ', sheared level' : '') + '. ' +
        (fz.loop_yarn_raised_pct != null ? fz.loop_yarn_raised_pct + '% of the loop yarn is raised into the nap; ' : '') + fz.fabric_loss_pct + '% of the fabric weight is torn out — ' + fz.gsm_before_brushing + ' GSM before brushing, ' + r.fabric.gsm + ' after. Nap about ' + fz.nap_mm + ' mm. ' + esc(fz.basis) + '.</p>';
    }
    if (r.plush) {
      var P = r.plush, mb = P.mass_balance;
      html += '<div class="st-sub">Plush pile ' + src('e') + '</div><p class="st-p"><b>' + esc(P.variant.name) + '</b> — ' + esc(P.declaration) + '. Sinker ' + P.pile.sinker_height_mm + ' mm (' + P.pile.sinker_for_exact_gsm_mm + ' mm hits the target exactly), ' + esc(P.pile.kind) + ' ' + P.pile.finished_pile_mm + ' mm, ' + P.pile.loops_per_cm2 + ' loops per cm². Ground loop ' + mb.ground_sl_mm + ' mm, pile ' + mb.pile_sl_mm + ' mm of yarn per needle.</p>' +
        '<p class="st-p" style="font-family:var(--mono);font-size:11px">' + esc(mb.formula) + '</p>' +
        '<div class="st-scroll"><table class="st-t"><tr><th>Sinker</th><th>Pile yarn</th><th>GSM</th>' + (P.shearing ? '<th>Lint sheared</th>' : '') + '</tr>' +
        P.pile.options.map(function (o) { return '<tr' + (o.sinker_mm === P.pile.sinker_height_mm ? ' style="background:var(--accent-tint)"' : '') + '><td>' + o.sinker_mm + ' mm</td><td>' + esc(o.pile) + '</td><td>' + o.gsm + '</td>' + (P.shearing ? '<td>' + (o.lint_pct == null ? '—' : o.lint_pct + '%') + '</td>' : '') + '</tr>'; }).join('') + '</table></div>' +
        (P.shearing ? '<p class="st-p">Shearing: knitted ' + P.shearing.knitted_loop_mm + ' mm, cut to ' + P.shearing.cut_to_mm + ' mm in ' + P.shearing.passes + ' passes — ' + P.shearing.pile_yarn_removed_pct + '% of the pile yarn (' + P.shearing.fabric_mass_removed_pct + '% of the grey cloth) leaves as lint.</p>' : '') +
        '<p class="st-p">Water the cloth takes up about ' + P.absorbency.total_g_m2 + ' g/m² (' + P.absorbency.g_per_g + ' g per g); thickness ' + P.thermal.thickness_mm + ' mm, ' + P.thermal.clo + ' clo. Route: ' + P.process_route.map(esc).join(' → ') + '.</p>';
    }
    html += '<div class="st-sub">Yarn on every feeder ' + src('c') + '</div><div class="st-scroll"><table class="st-t"><tr><th>Feed</th><th>Role</th><th>Yarn</th><th>SL mm</th><th>TF</th><th>Yarn per needle</th><th>Course length m/rev</th><th>Yarn speed m/min</th><th>Share of fabric</th><th>Input tension cN ' + src('e') + '</th></tr>' +
      y.feeds.map(function (x) {
        return '<tr><td>F' + x.feed + '</td><td style="color:' + (ROLE_COL[x.role] || '') + '">' + esc(x.role) + (x.role_drawn && x.role_drawn !== x.role ? ' <span style="color:var(--t3)" title="Drawn as ' + esc(x.role_drawn) + ', works as ' + esc(x.role) + ' — see the checks">(drawn ' + esc(x.role_drawn) + ')</span>' : '') + '</td><td>' + esc(x.yarn) + '</td><td>' + x.sl_mm + '</td><td>' + (x.tf == null ? '—' : x.tf) + '</td><td>' + x.share + '</td><td>' + x.course_length_m + '</td><td>' + x.yarn_speed_m_min + '</td><td>' + x.mass_share_pct + '%</td><td>' + x.tension_cN.join('–') + '</td></tr>';
      }).join('') + '</table></div>';
    html += '<p class="st-p">Yarn per needle: the yarn a feeder lays at one needle position as a share of a full knitted loop (knit 1, tuck about 0.7, a miss is the float; on a double bed both beds count). Input tension is a starting range at 0.12–0.16 cN per tex for knit feeders and 0.08–0.10 for loop feeders — confirm with a tension meter.</p>';
    html += '<div class="st-sub">Composition by weight ' + src('c') + '</div><div class="st-scroll"><table class="st-t"><tr><th>Part</th><th>Share</th></tr>' +
      y.composition.map(function (c) { return '<tr><td>' + esc(c.part) + '</td><td>' + c.pct + '%</td></tr>'; }).join('') + '</table></div>';
    $('pane-results').innerHTML = html;
  }

  // -- cam & needle set-out: the machine engine's plan, editable --------------
  var CAM = { K: 'Knit', T: 'Tuck', M: 'Miss', E: 'Transfer', R: 'To other bed' };
  function renderSetup() {
    var r = last, ms = r.machine_setup, P = ms.profile, B = ms.beds;
    var html = '<div class="st-mcard"><b>' + esc(P.label) + '</b>' + (P.auto ? ' <span style="color:var(--t3)">— picked for this design (choose your own under Machine type)</span>' : '') +
      '<dl><dt>Needle selection</dt><dd>' + (P.selection === 'wheel' ? 'pattern wheel / drum at each feeder (mechanical jacquard)' : P.selection === 'needle' ? 'needle by needle (electronic' + (P.transfer ? ', with loop transfer' : '') + ')' : 'cam tracks — cylinder ' + P.tracks.C + (P.tracks.D ? ', dial ' + P.tracks.D : '')) + '</dd>' +
      (P.technique ? '<dt>Selection</dt><dd>' + (P.technique === '3way' ? '3-way: each needle to knit, tuck or miss at every feeder' : '2-way: each feeder has one cam height (knit or tuck); a needle is raised to it or left down (miss)') + '</dd>' : '') +
      (P.transfer_dirs ? '<dt>Transfers</dt><dd>to the ' + P.transfer_dirs.join(' or ') + ' needle (set under Machine)</dd>' : '') +
      (P.striper ? '<dt>Stripers</dt><dd>' + P.striper + '-finger yarn changer at every feeder</dd>' : '') +
      (P.max_width ? '<dt>Pattern wheel</dt><dd>' + P.max_width + ' slots: the repeat must fit the wheel</dd>' : '') +
      (P.bed_transfer ? '<dt>Bed transfer</dt><dd>loops can be handed between the beds (R)</dd>' : '') +
      '<dt>Cams</dt><dd>' + Object.keys(P.cams).map(function (b) { return (b === 'C' ? 'cylinder: ' : 'dial: ') + P.cams[b].map(function (x) { return CAM[x].toLowerCase(); }).join(', '); }).join(' · ') + '</dd>' +
      '<dt>Needles</dt><dd>' + Object.keys(P.needle).map(function (b) { return (b === 'C' ? 'cylinder: ' : 'dial: ') + esc(P.needle[b]); }).join(' · ') + '</dd>' +
      '<dt>Sinker</dt><dd>' + esc(P.sinker.text) + '</dd>' +
      (P.timing ? '<dt>Timing</dt><dd>' + P.timing.join(' or ') + '</dd>' : '') +
      '<dt>Built</dt><dd>' + P.build.gauges[0] + '–' + P.build.gauges[1] + ' GG, ' + P.build.dia[0] + '–' + P.build.dia[1] + '", about ' + P.build.feeders_per_inch + ' feeders per inch ' + src('e') + '</dd>' +
      '<dt>Made for</dt><dd>' + esc(P.use) + '</dd></dl></div>';
    if (ms.alternatives.length > 1) html += '<p class="st-p">Other machines that knit this design: ' + ms.alternatives.filter(function (a) { return a.id !== P.id; }).map(function (a) { return '<button type="button" class="st-btn st-alt" data-prof="' + esc(a.id) + '">' + esc(a.label) + '</button>'; }).join('') + '</p>';
    else if (!ms.alternatives.length) html += '<p class="st-p" style="color:#9a5b00">No machine class in the studio knits this design as drawn — see the checks.</p>';

    var editable = false;
    ['C', 'D'].forEach(function (b) {
      var bd = B[b]; if (!bd) return;
      var name = b === 'C' ? 'Cylinder' : 'Dial';
      html += '<div class="st-sub">' + name + ' — ' + (bd.selection === 'wheel' ? 'pattern wheel selection' : bd.selection === 'needle' ? 'needle selection' : bd.tracks_used + ' of ' + bd.tracks_available + ' tracks') + '</div><p class="st-p">' + esc(bd.selection_note) + '</p>';
      if (bd.selection === 'needle' || bd.selection === 'wheel') return;
      editable = true;
      html += '<label class="st-p" style="display:block">Needle set-out, one repeat (butt track per needle, – = needle out)<br><input class="st-setin" data-setout="' + b + '" value="' + esc(bd.setout.replace(/ /g, '')) + '" spellcheck="false" autocomplete="off"></label>' +
        '<div class="st-scroll"><table class="st-t"><tr><th>Track</th><th>Sequence, feeders 1 → ' + r.structure.feeds + '</th><th>Needles per repeat</th><th>On the machine</th></tr>' +
        bd.per_track.map(function (t) { return '<tr><td>' + t.track + (t.butt ? ' <small>' + esc(t.butt) + '</small>' : '') + '</td><td style="letter-spacing:3px;font-family:var(--mono)">' + esc(t.sequence) + '</td><td>' + t.needles_per_repeat + '</td><td>' + (t.needles_on_machine == null ? '—' : t.needles_on_machine) + '</td></tr>'; }).join('') +
        (bd.empty_per_repeat ? '<tr><td>–</td><td>needles out</td><td>' + bd.empty_per_repeat + '</td><td>' + (bd.empty_on_machine == null ? '—' : bd.empty_on_machine) + '</td></tr>' : '') + '</table></div>';
      if (bd.cam_totals_machine) html += '<p class="st-p">Cams to fit round the machine: <b>' + bd.cam_totals_machine.knit + '</b> knit, <b>' + bd.cam_totals_machine.tuck + '</b> tuck, <b>' + bd.cam_totals_machine.miss + '</b> miss (' + r.machine.feeders + ' feeders × ' + bd.tracks_used + ' tracks).</p>';
    });
    if (B.facing_note) html += '<p class="st-p">' + esc(B.facing_note) + '</p>';
    var SP = ms.stripes;
    if (SP) {
      html += '<div class="st-sub">Stripes ' + src('c') + '</div><p class="st-p">' + SP.courses + '-course repeat, about ' + SP.repeat_mm + ' mm in the finished cloth: ' +
        SP.runs.map(function (x) { return '<b>' + x.colour + '</b> ' + x.courses + ' (' + x.mm + ' mm)'; }).join(' · ') + '. Yarn by colour: ' +
        Object.keys(SP.yarn_pct).map(function (k) { return k + ' ' + SP.yarn_pct[k] + '%'; }).join(', ') + '.</p>' +
        (SP.method === 'feeder stripe'
          ? '<p class="st-p"><b>Feeder stripe</b> — course c is knitted by feeder c (round the machine), so with ' + r.machine.feeders + ' feeders (a multiple of ' + SP.courses + ') every feeder keeps one yarn. Thread: ' + SP.threading.slice(0, 24).map(function (t) { return 'F' + t.feeder + ' ' + t.yarn; }).join(', ') + (SP.courses > 24 ? ' …' : '') + ', and so on round the machine.</p>'
          : '<p class="st-p"><b>Striper</b> — the repeat does not divide the ' + r.machine.feeders + ' feeders, so each feeder changes yarn from revolution to revolution: up to ' + SP.fingers_needed + ' yarns on one feeder (the machine has ' + SP.fingers_available + ' finger' + (SP.fingers_available > 1 ? 's' : '') + '); the stripe repeats every ' + SP.revolutions_per_repeat + ' revolution' + (SP.revolutions_per_repeat > 1 ? 's' : '') + '.</p>');
    }
    if (editable) {
      // cam chart: one select per feeder per track, both beds
      var cols = [];
      ['C', 'D'].forEach(function (b) { if (B[b] && B[b].selection === 'tracks') B[b].per_track.forEach(function (t) { cols.push([b, t.track]); }); });
      html += '<div class="st-sub">Cam chart — the cam in each track at each feeder (edit, then apply)</div><div class="st-scroll"><table class="st-t" id="st-camtab"><tr><th>Feeder</th><th>Yarn</th>' +
        cols.map(function (c) { return '<th>' + (c[0] === 'C' ? 'Cyl ' : 'Dial ') + c[1] + '</th>'; }).join('') + '</tr>' +
        r.machine_setup.beds.C.cams_per_feeder.map(function (_, i) {
          return '<tr><td>F' + (i + 1) + '</td><td style="color:' + (ROLE_COL[r.structure.roles[i]] || '') + '">' + esc(r.structure.roles[i] || '') + '</td>' + cols.map(function (c) {
            var v = B[c[0]].cams_per_feeder[i][c[1]];
            var opts = (P.cams[c[0]] || ['K', 'T', 'M']).filter(function (x) { return x !== 'E'; });
            if (opts.indexOf(v) < 0) opts.push(v);
            return '<td><select class="st-camsel ' + v + '" data-f="' + i + '" data-b="' + c[0] + '" data-t="' + c[1] + '">' + opts.map(function (x) { return '<option value="' + x + '"' + (x === v ? ' selected' : '') + '>' + CAM[x] + '</option>'; }).join('') + '</select></td>';
          }).join('') + '</tr>';
        }).join('') + '</table></div>' +
        '<p class="st-p"><button type="button" class="st-btn" data-camop="addFeed">+ Feeder</button> <button type="button" class="st-btn" data-camop="delFeed">− Feeder</button> <button type="button" class="st-btn" data-camop="shiftU" title="Start the repeat one feeder later">Rotate feeders</button></p>' +
        '<p class="st-p"><button type="button" class="st-btn primary" id="st-camapply">Apply cam set-up to the notation</button> <span id="st-camnote" style="font-size:12px;color:var(--t2)">Change a cam or the set-out, then apply: the notation, the checks and both 3D views follow. A track you add in the set-out (e.g. C) takes miss cams until you set them.</span></p>';
    }
    html += '<p class="st-p">Repeat the cam chart round the machine: feeder ' + (r.structure.feeds + 1) + ' takes the cams of feeder 1, and so on. Needles with the same sequence share one butt track, so the set-out is the order to load the needles into the tricks.</p>';
    if (r.setup.timing) html += '<div class="st-sub">Dial timing</div><p class="st-p">' + esc(r.setup.timing) + '</p>';
    $('pane-setup').innerHTML = html;
  }

  // the edited set-up compiled into notation by the machine engine
  function applyCams() {
    var B = last.machine_setup.beds, F = last.structure.feeds;
    var setout = {}, cams = [];
    document.querySelectorAll('#pane-setup [data-setout]').forEach(function (inp) { setout[inp.getAttribute('data-setout')] = inp.value; });
    for (var i = 0; i < F; i++) {
      var row = {};
      ['C', 'D'].forEach(function (b) {
        if (!B[b]) return;
        row[b] = {};
        B[b].per_track.forEach(function (t) { row[b][t.track] = B[b].cams_per_feeder[i][t.track]; });
      });
      cams.push(row);
    }
    document.querySelectorAll('#st-camtab select').forEach(function (sel) { cams[+sel.getAttribute('data-f')][sel.getAttribute('data-b')][sel.getAttribute('data-t')] = sel.value; });
    // a dial on needle selection keeps its drawn programme
    if (B.D && B.D.selection === 'needle') setout.D = '';
    apiFetch('/api/studio/compile', { method: 'POST', body: { profile: last.machine_setup.profile.auto ? null : last.machine_setup.profile.id, setout: setout, cams: cams } }).then(function (o) {
      snapshot();
      var g = o.grid;
      S.C = g.C.map(function (r) { return r.split(''); });
      if (g.D) S.D = g.D.map(function (r) { return r.split(''); });
      else if (S.D && B.D && B.D.selection === 'needle') { /* unchanged */ }
      if (S.D && S.D[0].length !== S.C[0].length) S.D = S.D.map(function (r) { var o2 = []; for (var j = 0; j < S.C[0].length; j++) o2.push(r[j % r.length]); return o2; });
      S.templateId = ''; $('st-template').value = '';
      renderAll();
      if (o.errors && o.errors.length) setTimeout(function () { var n = $('st-camnote'); if (n) n.textContent = o.errors.join(' '); }, 600);
    }).catch(function (e) {
      var n = $('st-camnote'); if (n) { n.style.color = '#b42318'; n.textContent = (e.data && e.data.errors ? e.data.errors.join(' ') : (e.data && e.data.error) || e.message); }
    });
  }

  function renderMachine() {
    var r = last, m = r.machine, v = r.vdq;
    var html = '<div class="st-kpis">' +
      kpi('Machine', m.dia + '" × ' + m.gauge + ' GG', esc(m.machine_label), null) +
      kpi('Gauge', m.gauge + ' GG', esc(m.gauge_source) + ' · fit ' + esc(m.gauge_fit.fit), /factory/.test(m.gauge_source) ? 'm' : 'c') +
      kpi('Diameter', m.dia + '"', esc(m.dia_source), /factory/.test(m.dia_source) ? 'm' : 'c') +
      kpi('Needles', m.needles, 'rounded to whole repeats', 'c') +
      kpi('Feeders', m.feeders, m.repeats_round + ' repeats round the machine', 'c') +
      kpi('Speed', m.rpm + ' RPM', 'efficiency ' + m.efficiency_pct + '%', 'c') +
      kpi('Production', m.kg_per_hour + ' kg/h', m.kg_per_day + ' kg/day', 'c') +
      (r.spirality ? kpi('Course slope', r.spirality.helix_deg + '°', r.spirality.courses_per_rev + ' courses per turn', 'c') : '') +
      '</div><p class="st-p" style="font-family:var(--mono);font-size:11px">' + esc(m.production_formula) + '</p>';
    if (r.spirality) html += '<p class="st-p">' + esc(r.spirality.note) + '</p>';
    html += '<div class="st-sub">Quality setting (VDQ / positive feed) ' + src('c') + '</div><p class="st-p">' + esc(v.note) + '</p>' +
      '<div class="st-scroll"><table class="st-t"><tr><th>Quality group</th><th>Feeders in the repeat</th><th>Course length m/rev</th><th>Yarn speed m/min</th><th>VDQ reading</th></tr>' +
      v.groups.map(function (g, i) {
        return '<tr><td>Belt ' + (i + 1) + '</td><td>' + g.feeds.map(function (x) { return 'F' + x; }).join(', ') + '</td><td>' + g.course_length_m + '</td><td>' + g.yarn_speed_m_min + '</td><td>' + (g.vdq_reading != null ? g.vdq_reading : '<span style="color:var(--t3)">give a reference</span>') + '</td></tr>';
      }).join('') + '</table></div>' +
      (v.method ? '<p class="st-p">VDQ reading: ' + esc(v.method) + '.</p>' : '') +
      (v.groups.length > 1 ? '<p class="st-p">The feeders take different yarn lengths, so they run on ' + v.groups.length + ' quality belts (or set each feeder\'s storage wheel accordingly). One belt for all would force one stitch length on every feeder.</p>' : '');
    var MS = r.machine_setup;
    if (MS && MS.formation) {
      var FM = MS.formation, dbl = !!r.structure.beds.D, geo = FM.geometry;
      html += '<div class="st-sub">Stitch formation — knock-over depth ' + src('e') + '</div>' +
        '<p class="st-p">The stitch cam draws each needle ' + (dbl ? 'past the verge of its trick' : 'below the sinker belly') + ' by the knock-over depth; the yarn drawn round the hook' + (dbl ? ' and to the needles of the other bed' : ' and over the sinkers') + ' is the loop. Needle pitch ' + geo.pitch_mm + ' mm, needle ≈ ' + geo.needle_mm + ' mm' + (geo.sinker_mm ? ', sinker ≈ ' + geo.sinker_mm + ' mm' : '') + ', yarn ' + geo.yarn_d_mm + ' mm' + (geo.dial_gap_mm ? ', dial gap ' + geo.dial_gap_mm + ' mm' : '') + '. ' +
        (FM.feed_system === 'positive' ? 'Positive feed: the loop is the yarn fed, so the cam is set to form a little more than that.' : 'Storage feed: the cam depth sets the loop; part of the yarn is robbed back as the old loops knock over.') +
        (FM.timing ? ' Timing: <b>' + FM.timing + '</b>' + (FM.timing === 'delayed' ? ' — the dial knocks over a few needles after the cylinder and takes part of its loop from the cylinder\'s, so the dial is set shallower.' : ' — both beds knock over together, each draws its own loop.') : '') + '</p>' +
        '<div class="st-scroll"><table class="st-t"><tr><th>Feeder</th><th>Stitch length</th><th>Formed</th><th>Cylinder depth</th>' + (dbl ? '<th>Dial depth</th>' : '<th>Needle / sinker loop</th>') + (FM.scale_method ? '<th>Cam reading</th>' : '') + '</tr>' +
        FM.feeds.map(function (f) {
          return '<tr><td>F' + f.feed + '</td><td>' + r1(f.sl_mm * 100) / 100 + ' mm</td><td>' + f.formed_mm + ' mm</td><td>' + (f.cyl_depth_mm == null ? '—' : f.cyl_depth_mm + ' mm') + '</td>' +
            (dbl ? '<td>' + (f.dial_depth_mm == null ? '—' : f.dial_depth_mm + ' mm') + '</td>' : '<td>' + (f.needle_loop_mm == null ? '—' : f.needle_loop_mm + ' / ' + f.sinker_loop_mm + ' mm') + '</td>') +
            (FM.scale_method ? '<td>' + (f.cyl_reading == null ? '—' : f.cyl_reading) + '</td>' : '') + '</tr>';
        }).join('') + '</table></div>' +
        '<p class="st-p" style="font-family:var(--mono);font-size:11px">' + esc(FM.formula) + '</p><p class="st-p">' + esc(FM.basis) + (FM.scale_method ? '. Cam readings: ' + esc(FM.scale_method) : '. Give two stitch-cam settings you run (under Machine) to read these depths on your machine\'s scale') + '.</p>';
    }
    if (MS) {
      html += '<div class="st-sub">Speed ' + src('e') + '</div><p class="st-p">' + MS.speed.rpm + ' RPM on ' + m.dia + '" = <b>' + MS.speed.surface_m_s + ' m/s</b> at the cylinder surface (π × diameter × RPM). This class of machine runs at about ' + MS.speed.speed_factor + ' RPM × inch, up to ' + MS.speed.max_m_s + ' m/s — ' + esc(MS.speed.basis) + '. Production follows the speed.</p>';
      html += '<div class="st-sub">Feed system</div><div class="st-scroll"><table class="st-t"><tr><th>Feeder</th><th>Yarn</th><th>Feed</th><th>Why</th></tr>' +
        MS.feeds.map(function (f) { return '<tr><td>F' + f.feed + '</td><td>' + esc(f.role) + '</td><td>' + esc(f.system) + (f.extra.length ? '<br><small>+ ' + f.extra.map(esc).join('<br>+ ') + '</small>' : '') + '</td><td style="font-size:12px;white-space:normal;min-width:260px;font-family:inherit">' + esc(f.why) + '</td></tr>'; }).join('') + '</table></div>';
    }
    html += '<div class="st-sub">Gauge against yarn</div><p class="st-p">Needle pitch ' + m.gauge_fit.pitch_mm + ' mm, yarn diameter ' + m.gauge_fit.yarn_d_mm + ' mm, ratio ' + m.gauge_fit.ratio + '. The factory knits this family between ' + m.gauge_fit.band.join(' and ') + ' ' + src('m') + '.</p>';
    $('pane-machine').innerHTML = html;
  }

  // ── notation (SVG) ───────────────────────────────────────────────────────
  function renderNotation() {
    var F = nFeeds(), W = nNeedles(), rep = Math.min(3, Math.max(1, Math.floor(24 / W)));
    var n = W * rep, dx = 26, rowH = S.D ? 86 : 54, left = 46;
    var w = left + n * dx + 20, h = F * rowH + 14;
    var roles = S.feeds.map(function (f) { return (f && f.role) || 'ground'; });
    var out = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" font-family="IBM Plex Mono, monospace">' +
      '<defs><marker id="st-arr" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L6 3 L0 6 z" fill="#0e7490"/></marker></defs>';
    for (var i = 0; i < F; i++) {
      var y0 = 8 + i * rowH;
      var col = ROLE_COL[roles[i]] || '#1857C4';
      out += '<text x="6" y="' + (y0 + rowH / 2 + 4) + '" font-size="11" fill="#565C64">F' + (i + 1) + '</text>';
      var yC = S.D ? y0 + rowH - 18 : y0 + rowH - 16;     // cylinder dots
      var yD = y0 + 16;                                     // dial dots
      var yb = S.D ? (yC + yD) / 2 : yC - 20;               // yarn baseline
      var d = 'M' + (left - 10) + ' ' + yb;
      for (var k = 0; k < n; k++) {
        var j = k % W, x = left + k * dx;
        var sc = S.C[i][j];
        // cylinder needle
        // knit: the yarn wraps round the needle and the legs cross (a closed
        // loop); tuck: it is laid in the hook, an open V to the needle; miss:
        // it runs straight past
        if (sc === 'K') d += ' L' + (x - 6) + ' ' + yb + ' L' + (x + 4) + ' ' + (yC - 3) + ' A5 5 0 1 1 ' + (x - 4) + ' ' + (yC - 3) + ' L' + (x + 6) + ' ' + yb;
        else if (sc === 'T') d += ' L' + (x - 6) + ' ' + yb + ' L' + x + ' ' + (yC - 4) + ' L' + (x + 6) + ' ' + yb;
        if (sc === 'R' && S.D) out += '<path d="M' + x + ' ' + (yC - 6) + ' L' + (S.bed === 'interlock' ? x : x + dx / 2) + ' ' + (yD + 8) + '" fill="none" stroke="#7a4fc2" stroke-width="1.6" marker-end="url(#st-arr)"/>';
        if (S.D && S.D[i][j] === 'R') out += '<path d="M' + (S.bed === 'interlock' ? x : x + dx / 2) + ' ' + (yD + 6) + ' L' + x + ' ' + (yC - 8) + '" fill="none" stroke="#7a4fc2" stroke-width="1.6" marker-end="url(#st-arr)"/>';
        if (sc === 'E') out += '<path d="M' + x + ' ' + (yC + 6) + ' Q' + (x + dx / 2) + ' ' + (yC + 16) + ' ' + (x + dx - 3) + ' ' + (yC + 6) + '" fill="none" stroke="#0e7490" stroke-width="1.6" marker-end="url(#st-arr)"/>';
        if (S.D) {
          var xd = S.bed === 'interlock' ? x : x + dx / 2;
          var sd = S.D[i][j];
          if (sd === 'K') d += ' L' + (xd - 6) + ' ' + yb + ' L' + (xd + 4) + ' ' + (yD + 3) + ' A5 5 0 1 0 ' + (xd - 4) + ' ' + (yD + 3) + ' L' + (xd + 6) + ' ' + yb;
          else if (sd === 'T') d += ' L' + (xd - 6) + ' ' + yb + ' L' + xd + ' ' + (yD + 4) + ' L' + (xd + 6) + ' ' + yb;
        }
      }
      d += ' L' + (left + n * dx) + ' ' + yb;
      out += '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2" stroke-linejoin="round"/>';
      for (var k2 = 0; k2 < n; k2++) {
        var j2 = k2 % W, x2 = left + k2 * dx;
        out += S.C[i][j2] === '-' ? '<text x="' + (x2 - 3) + '" y="' + (yC + 4) + '" font-size="10" fill="#BFC4CB">×</text>' : '<circle cx="' + x2 + '" cy="' + yC + '" r="3" fill="#191C1F"/>';
        if (S.D) {
          var xd2 = S.bed === 'interlock' ? x2 : x2 + dx / 2;
          out += S.D[i][j2] === '-' ? '<text x="' + (xd2 - 3) + '" y="' + (yD + 4) + '" font-size="10" fill="#BFC4CB">×</text>' : '<circle cx="' + xd2 + '" cy="' + yD + '" r="3" fill="#191C1F"/>';
        }
      }
      if (k2 && W * rep > W) for (var rr = 1; rr < rep; rr++) out += '<line x1="' + (left + rr * W * dx - dx / 2) + '" x2="' + (left + rr * W * dx - dx / 2) + '" y1="' + y0 + '" y2="' + (y0 + rowH - 4) + '" stroke="#E4E6E9" stroke-dasharray="3 3"/>';
    }
    out += '</svg>';
    $('st-notation').innerHTML = out;
  }

  // ── needle action: the cam race ──────────────────────────────────────────
  var race = (function () {
    var svgNS = 'http://www.w3.org/2000/svg';
    var ZONE = 230, GAP = 34, H = 372, BASE = 210;       // BASE: sinker (verge) line; H clears the lowest stem (BASE + 98 + DROP) and the legend
    var LIFT = { K: 110, T: 62, M: 0, E: 88, '-': 0 };    // clearing / tuck / rest / transfer
    var DROP = 22;                                        // stitch cam: below the verge to knock over
    var needles = [], svg = null, t0 = null, offset = 0, playing = true, raf = null, spawn = 0, built = false;

    function prof(sym, u) {
      // u: 0..1 position inside one feeder's cam zone
      var lift = LIFT[sym] || 0;
      if (sym === 'M' || sym === '-') return 0;
      if (u < 0.12) return 0;
      if (u < 0.38) return lift * ((u - 0.12) / 0.26);             // raising cam
      if (u < 0.5) return lift;                                    // dwell: clearing / tuck height
      if (u < 0.78) return lift - (lift + DROP) * ((u - 0.5) / 0.28); // stitch cam down
      if (u < 0.88) return -DROP;                                  // knock-over
      return -DROP + DROP * ((u - 0.88) / 0.12);                   // back to rest
    }
    function grid() { return ($('st-anibed').value === 'D' && S.D) ? S.D : S.C; }
    function build() {
      var F = nFeeds(), W = F * ZONE + 80;
      var host = $('st-race');
      host.innerHTML = '';
      svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.style.display = 'block';
      var bg = '';
      var g = grid();
      for (var i = 0; i < F; i++) {
        var x0 = 40 + i * ZONE;
        var role = (S.feeds[i] || {}).role || 'ground';
        bg += '<rect x="' + x0 + '" y="8" width="' + ZONE + '" height="' + (H - 16) + '" fill="' + (i % 2 ? '#fafbfc' : '#f4f6f9') + '"/>';
        bg += '<text x="' + (x0 + 8) + '" y="24" font-size="11" font-weight="600" fill="#565C64">Feeder ' + (i + 1) + ' · ' + role + '</text>';
        // the three cam paths, faint
        ['K', 'T'].forEach(function (s) {
          var d = '';
          for (var u = 0; u <= 1.0001; u += 0.02) d += (u ? ' L' : 'M') + (x0 + u * ZONE) + ' ' + (BASE + 47 - prof(s, u));
          bg += '<path d="' + d + '" fill="none" stroke="' + (s === 'K' ? '#1857C4' : '#E8A33A') + '" stroke-width="1" stroke-dasharray="4 3" opacity=".55"/>';
        });
        // feeder (yarn guide) at the dwell
        var xf = x0 + 0.47 * ZONE;
        bg += '<path d="M' + (xf - 9) + ' 40 L' + (xf + 9) + ' 40 L' + xf + ' 58 Z" fill="' + (ROLE_COL[role] || '#1857C4') + '"/>';
        bg += '<line x1="' + xf + '" y1="58" x2="' + (x0 + ZONE * 0.62) + '" y2="' + (BASE - 30) + '" stroke="' + (ROLE_COL[role] || '#1857C4') + '" stroke-width="1.6" opacity=".8"/>';
      }
      bg += '<line x1="0" x2="' + W + '" y1="' + BASE + '" y2="' + BASE + '" stroke="#565C64" stroke-width="1.5"/>';
      bg += '<text x="4" y="' + (BASE + 14) + '" font-size="10" fill="#565C64">sinker / verge</text>';
      bg += '<text x="4" y="' + (H - 10) + '" font-size="10" fill="#1857C4">— knit cam path</text><text x="110" y="' + (H - 10) + '" font-size="10" fill="#c27a00">— tuck cam path</text><text x="216" y="' + (H - 10) + '" font-size="10" fill="#565C64">miss: no cam, needle stays down</text>';
      svg.innerHTML = bg;
      host.appendChild(svg);
      // start with the race already full, as a running machine is
      needles = []; spawn = 0; offset = 40 + nFeeds() * ZONE + 40; built = true;
      void g;
    }
    function needleShape(sym) {
      var g = document.createElementNS(svgNS, 'g');
      // stem, hook, latch, butt; drawn with the hook tip at y=0
      g.innerHTML =
        '<rect x="-2" y="0" width="4" height="150" fill="#6b7280"/>' +
        '<path d="M2 4 Q2 -6 -4 -6 Q-9 -6 -9 1 L-9 6" fill="none" stroke="#374151" stroke-width="2.2"/>' +
        '<line class="latch" x1="0" y1="16" x2="-9" y2="5" stroke="#111827" stroke-width="1.6"/>' +
        '<rect class="butt" x="2" y="' + (110 + 0) + '" width="7" height="6" fill="#1857C4"/>' +
        '<g class="loops"></g>';
      return g;
    }
    function step(ts) {
      if (!built) build();
      if (t0 == null) t0 = ts;
      var dt = Math.min(64, ts - t0); t0 = ts;
      var speed = parseFloat($('st-speed').value) || 0.6;
      if (playing) offset += dt * 0.16 * speed;
      var F = nFeeds(), g = grid(), W = g[0].length;
      var total = 40 + F * ZONE + 40;
      // spawn needles so they stand GAP apart
      while (spawn * GAP <= offset + total) {
        var el = needleShape();
        svg.appendChild(el);
        needles.push({ el: el, idx: spawn, j: spawn % W, held: [{ c: '#868C94' }], lastZone: -1 });
        spawn++;
      }
      var phaseText = '';
      for (var n = needles.length - 1; n >= 0; n--) {
        var nd = needles[n];
        var x = offset - nd.idx * GAP;              // needle's x along the race
        if (x > total) { svg.removeChild(nd.el); needles.splice(n, 1); continue; }
        if (x < -20 || g.every(function (row) { return row[nd.j] === '-'; })) { nd.el.setAttribute('display', 'none'); continue; }
        nd.el.removeAttribute('display');
        var z = Math.floor((x - 40) / ZONE), u = ((x - 40) - z * ZONE) / ZONE;
        var sym = (z >= 0 && z < F) ? g[z][nd.j] : 'M';
        var lift = (z >= 0 && z < F) ? prof(sym, u) : 0;
        // the loops this needle holds change at knock-over
        if (z >= 0 && z < F && u >= 0.8 && nd.lastZone !== z) {
          nd.lastZone = z;
          var col = ROLE_COL[(S.feeds[z] || {}).role] || '#1857C4';
          if (sym === 'K') nd.held = [{ c: col }];
          else if (sym === 'T') nd.held = nd.held.concat([{ c: col }]);
          else if (sym === 'E') nd.held = [];
        }
        var tipY = BASE - 52 - lift;                 // hook tip above the verge at rest
        nd.el.setAttribute('transform', 'translate(' + (x + 20) + ',' + tipY + ')');
        // latch: open once the old loop has passed below it (needle lifted)
        var open = lift > 40 || (lift > 0 && u < 0.5 && lift > 28);
        var latch = nd.el.querySelector('.latch');
        latch.setAttribute('x2', open ? '7' : '-9'); latch.setAttribute('y2', open ? '28' : '5');
        var trk = (last && last.setup.tracks[$('st-anibed').value === 'D' && S.D ? 'D' : 'C']);
        var tr = trk ? trk.setout.split(' ')[nd.j] : 'A';
        var butt = nd.el.querySelector('.butt');
        var trI = Math.max(0, 'ABCDEFGH'.indexOf(tr));
        butt.setAttribute('y', 96 + trI * 12);
        butt.setAttribute('fill', ['#1857C4', '#c2410c', '#1E7A54', '#7a4fc2', '#9A5B00', '#0e7490'][trI % 6]);
        // held loops sit at the verge, drawn on the stem
        var loopsG = nd.el.querySelector('.loops');
        var lh = '';
        var vergeLocal = BASE - tipY;                // verge in needle coordinates
        var inHook = lift > 0 && lift < 70;           // tuck height: old loop stays on the latch
        nd.held.forEach(function (L, q) {
          var yy = Math.min(vergeLocal, inHook ? 14 + q * 5 : vergeLocal) - q * 5;
          lh += '<ellipse cx="0" cy="' + yy + '" rx="8" ry="3" fill="none" stroke="' + L.c + '" stroke-width="2"/>';
        });
        loopsG.innerHTML = lh;
        if (z >= 0 && z < F && Math.abs(u - 0.47) < 0.07 && !phaseText) {
          phaseText = 'Feeder ' + (z + 1) + ', needle ' + (nd.j + 1) + ' (track ' + tr + '): ' +
            ({ K: 'knit — raised to clearing height, old loop below the latch, takes the new yarn and will knock the old loop over',
               T: 'tuck — raised only to tuck height, old loop stays in the hook, takes the new yarn too (' + (nd.held.length + 1) + ' loops after this feeder)',
               M: 'miss — not raised, keeps its loop, the yarn floats past',
               E: 'transfer — raised to transfer height, its loop is handed to the next needle; the needle is left empty and starts a new loop at the next feed (the eyelet)',
               '-': 'no needle in this trick' })[sym];
        }
      }
      if (phaseText) $('st-phase').textContent = phaseText;
      raf = requestAnimationFrame(step);
    }
    return {
      start: function () { if (!raf) raf = requestAnimationFrame(step); },
      stop: function () { if (raf) cancelAnimationFrame(raf); raf = null; t0 = null; },
      reset: function () { built = false; },
      toggle: function () { playing = !playing; return playing; },
    };
  })();

  // -- needle action: one needle's knitting cycle (studio-needle.js) --------
  var cycle = (function () {
    var view = null;
    var NAME = { K: 'knit', T: 'tuck', M: 'miss', E: 'transfer', R: 'transfer to the other bed', '-': 'no needle' };
    var dial = function () { return $('st-anibed').value === 'D' && !!S.D; };
    var bedG = function () { return dial() ? S.D : S.C; };
    function fill() {
      var g = bedG(), fs = $('st-cyf'), ns = $('st-cyn');
      var fv = Math.min(+fs.value || 0, g.length - 1), nv = Math.min(+ns.value || 0, g[0].length - 1);
      fs.innerHTML = g.map(function (_, i) { return '<option value="' + i + '">F' + (i + 1) + ' · ' + esc((S.feeds[i] || {}).role || 'ground') + '</option>'; }).join('');
      ns.innerHTML = g[0].map(function (_, j) { return '<option value="' + j + '">' + (j + 1) + '</option>'; }).join('');
      fs.value = String(Math.max(0, fv)); ns.value = String(Math.max(0, nv));
    }
    function cell() {
      var g = bedG(), F = g.length, f = Math.min(+$('st-cyf').value || 0, F - 1), j = Math.min(+$('st-cyn').value || 0, g[0].length - 1);
      var sym = g[f][j];
      // loops on the needle before this feed: the old loop, plus one for every tuck since it last knitted
      var held = 1;
      for (var k = 1; k < F; k++) { var a = g[(f - k + F) % F][j]; if (a === 'K') break; if (a === 'T') held++; }
      var role = (S.feeds[f] || {}).role || 'ground';
      return { sym: sym === '-' ? 'M' : sym, held: Math.min(held, 4), double: !!S.D, feedRole: role, colour: '#1857C4',
        label: 'Feeder ' + (f + 1) + ' (' + role + '), ' + (dial() ? 'dial' : 'cylinder') + ' needle ' + (j + 1) + ': ' + NAME[sym] + (held > 1 ? ', already holding ' + held + ' loops' : '') + (function () {
          var FM = last && last.machine_setup && last.machine_setup.formation; if (!FM || sym !== 'K') return '';
          var row = FM.feeds.filter(function (x) { return x.feed === f + 1; })[0]; var dd = row && (dial() ? row.dial_depth_mm : row.cyl_depth_mm);
          return dd != null ? ' · knock-over ' + dd + ' mm below ' + (S.D ? 'the verge' : 'the sinker belly') + ' for a ' + row.sl_mm.toFixed(2) + ' mm loop' : '';
        })() };
    }
    function phases(i) {
      var d = cell(), N = window.KAStudioNeedle, T = N.TEXT[d.sym] || N.TEXT.M;
      $('st-phases').innerHTML = N.PHASES.map(function (P, n) {
        return '<li data-ph="' + n + '"' + (n === i ? ' class="on"' : '') + '><b>' + P.name + '</b></li>';
      }).join('');
      $('st-cynote').textContent = (i + 1) + '. ' + N.PHASES[i].name + ': ' + T[N.PHASES[i].k];
      $('st-cysym').textContent = { K: 'K · knit', T: 'T · tuck', M: 'M · miss', E: 'E · transfer', R: 'R · to the other bed' }[d.sym] || d.sym;
    }
    return {
      start: function () {
        if (!window.KAStudioNeedle) return;
        fill();
        if (!view) view = new window.KAStudioNeedle.Cycle($('st-cycle'), cell, phases);
        view._ph = null; view.speed = parseFloat($('st-cyspeed').value) || 0.6;
        view.start();
      },
      stop: function () { if (view) view.stop(); },
      refresh: function () { if (view) { fill(); view._ph = null; view.draw(); } },
      bind: function () {
        var restart = function () { if (view) { view._ph = null; view.seek(0); } };
        $('st-cyf').addEventListener('change', restart);
        $('st-cyn').addEventListener('change', restart);
        $('st-cyplay').addEventListener('click', function () { if (view) this.textContent = view.toggle() ? 'Pause' : 'Play'; });
        $('st-cyprev').addEventListener('click', function () { if (view) { view.stepPhase(-1); $('st-cyplay').textContent = 'Play'; } });
        $('st-cynext').addEventListener('click', function () { if (view) { view.stepPhase(1); $('st-cyplay').textContent = 'Play'; } });
        $('st-cyspeed').addEventListener('input', function () { if (view) view.speed = parseFloat(this.value) || 0.6; });
        $('st-phases').addEventListener('click', function (e) {
          var li = e.target.closest('[data-ph]'); if (!li || !view) return;
          view.playing = false; $('st-cyplay').textContent = 'Play';
          view.seek(window.KAStudioNeedle.PHASES[+li.getAttribute('data-ph')].t + 0.02);
        });
      },
    };
  })();

  function renderNeedleTypes() {
    if (window.KAStudioNeedle) { $('st-needletypes').innerHTML = window.KAStudioNeedle.renderTypes(); return; }
    var fig = function (svg, cap) { return '<figure>' + svg + '<figcaption>' + cap + '</figcaption></figure>'; };
    var lbl = function (x, y, t) { return '<text x="' + x + '" y="' + y + '" font-size="10" fill="#565C64">' + t + '</text>'; };
    var latch = '<svg viewBox="0 0 200 150" width="100%" height="150"><rect x="94" y="30" width="6" height="110" fill="#6b7280"/><path d="M100 36 Q100 14 88 14 Q76 14 76 28 L76 36" fill="none" stroke="#374151" stroke-width="3"/><line x1="97" y1="58" x2="78" y2="36" stroke="#111" stroke-width="2.4"/><circle cx="97" cy="58" r="2.5" fill="#111"/><rect x="100" y="112" width="12" height="9" fill="#1857C4"/>' +
      lbl(110, 18, 'hook') + lbl(110, 46, 'latch (spoon)') + lbl(110, 62, 'rivet') + lbl(116, 120, 'butt') + lbl(110, 90, 'stem') + '</svg>';
    var compound = '<svg viewBox="0 0 200 150" width="100%" height="150"><rect x="94" y="34" width="6" height="106" fill="#6b7280"/><path d="M100 40 Q100 18 88 18 Q76 18 76 32" fill="none" stroke="#374151" stroke-width="3"/><rect x="84" y="40" width="4" height="98" fill="#9ca3af"/><rect x="100" y="112" width="12" height="9" fill="#1857C4"/>' +
      lbl(110, 22, 'open hook') + lbl(110, 56, 'closing element (tongue)') + lbl(110, 72, 'moves on its own') + lbl(116, 120, 'butt') + '</svg>';
    var bearded = '<svg viewBox="0 0 200 150" width="100%" height="150"><rect x="94" y="30" width="6" height="110" fill="#6b7280"/><path d="M100 34 Q100 12 86 14 Q76 16 80 34 L88 76" fill="none" stroke="#374151" stroke-width="3"/><circle cx="96" cy="78" r="3" fill="none" stroke="#111"/>' +
      lbl(110, 18, 'beard (spring)') + lbl(110, 80, 'eye — the presser') + lbl(110, 94, 'closes the beard') + '</svg>';
    $('st-needletypes').innerHTML =
      fig(latch, '<b>Latch needle</b> — the circular-knitting needle and the one animated above. Self-acting: the old loop opens and closes the latch, so each needle can knit, tuck or miss by its own cam.') +
      fig(compound, '<b>Compound needle</b> — hook and closing element move separately, a shorter stroke and less yarn strain; mostly warp knitting, and some fast fine-gauge circular machines.') +
      fig(bearded, '<b>Bearded (spring) needle</b> — one piece of wire; the beard must be pressed shut by a presser, so needles cannot be selected one by one. Old full-fashioned and some loop-wheel machines.');
  }

  // ── 3D ───────────────────────────────────────────────────────────────────
  var showBack = false;
  function hexRgb(h) { var n = parseInt(h.slice(1), 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; }

  // ── 3D: the loop structure ─────────────────────────────────────────────
  var mode3d = 'loops', loopView = null, loopPromise = null, buildTimer = null;
  // Both 3D views are drawn from the programme as it stands in the editor —
  // they never wait for the engine. The engine's answer only refines the
  // loop shape (wales and courses per cm) and the yarn thickness; while it is
  // checking, or if it refuses the design, the last good shape (or a plain
  // jersey's) is used and the 3D still shows exactly what is drawn.
  function render3D() {
    if (!$('pane-3d').classList.contains('on')) return;
    if (mode3d === 'cloth') renderCloth(); else renderLoops();
  }

  // ── 3D: the real fabric — the calculator's knit3d engine ──────────────
  var cloth = null, clothSeq = 0, clothKey = '', zoom = 'loops';   // the real view opens on the loops: a drawn programme must be readable stitch by stitch
  var FIBRE_3D = { cotton: 'cotton', cvc: 'cotton', polyester_spun: 'polyester', polyester_filament: 'polyester', nylon_filament: 'nylon', viscose: 'viscose', modal: 'modal' };
  var cellOf = function (x) { return x === 'K' ? 'K' : x === 'T' ? 'T' : 'M'; };   // transfer and empty needle read as a float
  /** The drawn programme as the 3D engine's construction, pattern and needle sampler. */
  function stripeOf() {
    var seq = [], m = ($('st-stripe').value || '').toUpperCase().match(/[A-F]\s*\d+/g);
    if (m) m.forEach(function (t) { var n = Math.min(500, +t.slice(1).trim()); for (var k = 0; k < n; k++) seq.push(t[0]); });
    if (!seq.length && S.feeds.some(function (f) { return f && f.colour; })) S.C.forEach(function (_, i) { seq.push((S.feeds[i] && S.feeds[i].colour) || 'A'); });
    if (!seq.length) return null;
    var colours = {}; ['A', 'B', 'C', 'D', 'E', 'F'].forEach(function (c) { colours[c] = $('st-sc-' + c).value; });
    return { seq: seq.slice(0, 2000), colours: colours };
  }
  function clothOpts() {
    // the notation → 3D mapping lives in studio-cloth-map.js (tested in node)
    var stripe = stripeOf();
    var cs = window.KAStudioCloth.clothSpec({ bed: S.bed, C: S.C, D: S.D, feeds: S.feeds, brush: $('st-brush').value, pile: $('st-pile').value, stripe: stripe,
      plush: last && last.plush && S.feeds.some(function (fd) { return fd.role === 'loop'; }) ? { cut: $('st-cut').checked, arrangement: $('st-parr').value } : null });
    var con = cs.construction, pattern = cs.pattern;
    // density from the engine's answer for this design (wales, courses, GSM, stitch length)
    var fab = (last && last.fabric) || {};
    var wpc = fab.wpc || shape.wpc, cpc = fab.cpc || shape.cpc;
    var ne = groundNeOf() > 0 ? groundNeOf() : (last && last.yarn && last.yarn.ground && last.yarn.ground.tex ? 590.5 / last.yarn.ground.tex : 590.5 / shape.tex);
    var gsm = fab.gsm || num('st-gsm') || 180;
    var dbl = con.base === 'double';
    var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
    var scalar = clamp(Math.sqrt(clamp(cpc / (dbl ? 9.5 : 8), 0.5, 2.6)) * clamp(gsm / (dbl ? 260 : 190), 0.85, 1.18), 0.7, 1.7);
    return {
      photo: cs.photo, notes: cs.notes, start: zoom === 'loops' ? 'loops' : undefined, dyed: hexRgb(cs.baseColour || $('st-col').value), baseHex: cs.baseColour || $('st-col').value, courseTint: cs.courseTint, construction: con, countNe: ne, gsm: gsm, tf: fab.tf || 14,
      fiberType: FIBRE_3D[$('st-fibre').value] || 'cotton', pattern: pattern, sample: cs.sample, sampleBack: cs.sampleBack,
      density: { wpc: wpc, cpc: cpc, aspect: clamp(cpc / wpc, 0.9, con.type === 'pique' ? 3.2 : 1.6), scalar: scalar, llMm: fab.sl_mm || null, tex: 590.5 / ne, fibreDensityScale: 1 },
      elastanePct: $('st-lycra').checked ? 5 : 0, physics: null,
      yarnLook: (function () { var ch = last && last.yarn && last.yarn.character && last.yarn.character[0]; if (!ch || !ch.look) return undefined; var l = ch.look; return { hair: 1, hairAbs: l.hairAbs, hairLen: l.hairLen, gloss: l.gloss, bulk: l.bulk, ply: l.ply, slub: !!l.slub, filament: !!l.filament, dty: !!l.dty, lustre: l.lustre }; })(),
    };
  }
  function renderCloth() {
    var host = $('st-cloth'), o = clothOpts(), my = ++clothSeq;
    // rebuild only when the structure or its numbers changed; a colour change repaints
    var key = JSON.stringify([o.yarnLook || null, stripeOf(), o.construction, o.pattern.grid, o.pattern.dial, o.pattern.feedYarns, Math.round(o.density.wpc * 10), Math.round(o.density.cpc * 10), Math.round(o.countNe), o.gsm, o.fiberType, o.elastanePct]);
    if (cloth && key === clothKey) { cloth.setColor(o.baseHex); return; }
    clothKey = key;
    $('st-cloth-wait').hidden = false;
    import('/assets/js/knit3d/index.js?v=20261111a').then(function (mod) {
      if (my !== clothSeq || mode3d !== 'cloth') return;
      if (cloth) { try { cloth.dispose(); } catch (_) {} cloth = null; }
      Array.prototype.forEach.call(host.querySelectorAll('canvas'), function (c) { c.remove(); });
      var k = new mod.Knit3D();
      try { k.mount(host, o); } catch (e) { try { k.dispose(); } catch (_) {} throw e; }
      cloth = k;
      if (showBack) k.setView('back');
      if (zoom !== 'loops') k.frame(zoom);
      $('st-cloth-wait').hidden = true;
      var con = o.construction;
      $('st-3dnote').textContent = con.label + ' · ' + o.density.wpc.toFixed(1) + ' wales × ' + o.density.cpc.toFixed(1) + ' courses /cm · ' + Math.round(o.countNe) + 's · ' + Math.round(o.gsm) + ' GSM' + (o.notes.length ? ' — ' + o.notes.join(' ') : '');
    }).catch(function (e) {
      if (window.console) console.error(e);
      $('st-cloth-wait').hidden = false;
      $('st-cloth-wait').textContent = 'The real view could not draw this programme: ' + (e && e.message || e);
    });
  }

  var shape = { wpc: 14, cpc: 19, tex: 590.5 / 30 };   // a 30s jersey until the engine answers
  function loopSpec() {
    if (last && last.fabric) shape = { wpc: last.fabric.wpc, cpc: last.fabric.cpc, tex: last.yarn.ground.tex };
    var f = { wpc: shape.wpc, cpc: shape.cpc }, y = { ground: { tex: groundNeOf() > 0 ? 590.5 / groundNeOf() : shape.tex } };
    var real = mode3d === 'cloth';
    var C = S.C, D = S.D, feeds = S.feeds;
    var ly = $('st-lycra').checked ? $('st-lyevery').value : null;
    // alternate plating on an odd repeat only repeats over twice the feeds
    if (ly === 'alternate' && C.length % 2) { C = C.concat(C); D = D ? D.concat(D) : null; feeds = feeds.concat(feeds); }
    var groundNe = 590.5 / y.ground.tex;
    var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
    var spec = {
      C: C, D: D, bed: S.bed, feeds: feeds, transferDir: $('st-tdir').value,
      // on a phone, fewer needles so each loop is big enough to read
      wales: real ? (S.D ? 20 : 32) : ($('st-loops').clientWidth < 520 ? 8 : null),
      courses: real ? (S.D ? 28 : 40) : null,
      real: real,
      h: clamp(f.wpc / f.cpc, 0.5, 1.4),
      // yarn diameter 0.907/√Ne mm (cotton), drawn a little flattened in the
      // relaxed loop; one wale = 10/wpc mm
      // a spun yarn lies about 1.3 × its packed diameter wide in the relaxed loop (fibre bulk)
      radius: feeds.map(function (fd) { var c = +fd.count > 0 ? +fd.count : +fd.ne; var ne = c > 0 ? (fd.count ? 590.5 / TEX[fd.unit || 'ne'](c) : c) : groundNe; return clamp(0.5 * 1.3 * (0.907 / Math.sqrt(ne)) * f.wpc / 10, 0.07, 0.24); }),
      plated: feeds.map(function (fd, i) { return !!ly && fd.role !== 'loop' && (ly === 'all' || i % 2 === 0); }),
      colourBy: real ? 'one' : $('st-colby').value, colour: $('st-col').value,
      stripeColour: (function () { var st = stripeOf(); return st ? function (c) { return st.colours[st.seq[((c % st.seq.length) + st.seq.length) % st.seq.length]]; } : null; })(),
    };
    // plush: the ground yarn is drawn on the loop feeder, the pile behind it
    // over the sinker, as tall as the sinker sets it (mm → wales: × wpc ÷ 10)
    if (last && last.plush && S.feeds.some(function (fd) { return fd.role === 'loop'; })) {
      var P = last.plush, gF = last.yarn.feeds[0], pF = last.yarn.feeds[1];
      spec.pileFeeds = feeds.map(function (fd, i) { return fd.role === 'loop' && C[i].indexOf('K') > -1; });
      spec.pileH = (P.shearing ? P.shearing.cut_to_mm : P.pile.sinker_height_mm) * f.wpc / 10;
      spec.pileArrangement = P.variant.arrangement;
      spec.radius = feeds.map(function () { return clamp(0.5 * (0.907 / Math.sqrt(590.5 / gF.tex)) * f.wpc / 10, 0.06, 0.22); });
      spec.pileRadius = clamp(0.5 * (0.907 / Math.sqrt(590.5 / pF.tex)) * f.wpc / 10, 0.06, 0.24);
      spec.feeds = feeds.map(function (fd) { return fd.role === 'loop' ? { role: 'ground' } : fd; });
      spec.pileColour = '#c2410c';
    }
    return spec;
  }

  function renderLoops() {
    var host = $('st-loops');
    if (!loopPromise) {
      loopPromise = import('/assets/js/studio-loops.js?v=20261110d').then(function (mod) {
        loopView = new mod.LoopView(host, showTip);
        loopView.feedColour = mod.feedColour;
        return loopView;
      });
    }
    loopPromise.then(function (v) {
      var spec = loopSpec();
      var geo = v.draw(spec);
      if (spec.real) { $('st-3dnote').textContent = geo.wales + ' needles × ' + geo.rows + ' courses, ' + (geo.wales / geo.W) + ' × ' + (geo.rows / geo.F) + ' repeats of your programme'; return; }
      var bs = $('st-bstep');
      bs.max = String(geo.rows); bs.value = String(geo.rows); v.setStep(null); stopBuild();
      $('st-bnote').textContent = geo.rows + ' courses · ' + geo.wales + ' needles a bed · ' + (geo.rows / geo.F) + ' × ' + (geo.wales / geo.W) + ' repeats';
      var F = geo.F, hl = v._hl;
      $('st-feedkey').innerHTML = '<span>Feeders:</span>' + Array.from({ length: F }, function (_, i) {
        var fd = spec.feeds[i] || {};
        return '<button type="button" class="fk' + (hl === i ? ' on' : '') + '" data-fk="' + i + '"><i style="background:' + v.feedColour(spec, i) + '"></i>F' + (i + 1) + ' ' + esc(fd.role || 'ground') + (spec.plated[i] ? ' + elastane' : '') + '</button>';
      }).join('') + (spec.plated.some(Boolean) ? '<span><i style="background:#f5f5f4;border:1px solid #bbb"></i>elastane, plated behind</span>' : '');
    }).catch(function (e) {
      if (window.console) console.error(e);
      if (!loopView) host.innerHTML = '<p class="st-p" style="padding:16px">The 3D view needs WebGL, which this browser does not have.</p>';
      else $('st-bnote').textContent = '3D could not draw this programme: ' + (e && e.message || e);
    });
  }

  var ACT = { K: 'knit', T: 'tuck', M: 'miss', E: 'transfer', R: 'transfer to the other bed', '-': 'no needle' };
  function showTip(s) {
    var tip = $('st-tip');
    if (!s) { tip.hidden = true; return; }
    var bed = s.bed === 'C' ? 'cylinder' : 'dial';
    var what = s.act === 'K' ? 'Knit loop' + (s.held ? ', held ' + s.held + ' course' + (s.held > 1 ? 's' : '') + ' (the needle tucks or misses above it)' : '') + (s.tucks ? '; drawn through ' + s.tucks + ' tuck' + (s.tucks > 1 ? 's' : '') + ' as well as the old loop' : '')
      : s.act === 'T' ? 'Tuck: the needle took the yarn but did not clear, so it is not knocked over. It is cleared with the held loop ' + (s.held + 1) + ' course' + (s.held ? 's' : '') + ' later'
        : s.act === 'M' ? 'Miss: the needle stayed down; the yarn floats behind the held loop'
        : s.act === 'R' ? 'Transfer to the other bed: the loop was handed to the needle opposite, so this needle is empty and the wale goes on on the other bed'
        : s.act === 'E' ? 'Transfer: the loop was handed to the next needle, so this needle is empty — the yarn passes and the eyelet opens; it starts a new loop at the next feed'
          : 'No needle in this slot: the yarn passes straight across';
    tip.innerHTML = '<b>F' + (s.feed + 1) + ' · ' + bed + ' needle ' + s.needle + ' · ' + ACT[s.act] + '</b>' + (s.elastane ? ' (elastane)' : '') + '<br>' + what + '.';
    tip.hidden = false;
    var host = $('st-loops'), x = Math.min(s.clientX + 14, host.clientWidth - 270), yy = Math.min(s.clientY + 14, host.clientHeight - 80);
    tip.style.left = Math.max(4, x) + 'px'; tip.style.top = Math.max(4, yy) + 'px';
  }

  function stopBuild() { if (buildTimer) { clearInterval(buildTimer); buildTimer = null; } $('st-bplay').textContent = 'Knit it feed by feed'; }
  function playBuild() {
    if (buildTimer) return stopBuild();
    if (!loopView || !loopView.geo) return;
    var bs = $('st-bstep'), n = loopView.geo.rows, k = 0;
    $('st-bplay').textContent = 'Stop';
    loopView.setStep(0); bs.value = '1';
    buildTimer = setInterval(function () {
      k++;
      if (k >= n) { loopView.setStep(null); bs.value = String(n); stopBuild(); return; }
      loopView.setStep(k); bs.value = String(k + 1);
      var f = k % loopView.geo.F;
      $('st-bnote').textContent = 'Course ' + (k + 1) + ' of ' + n + ' — feeder F' + (f + 1);
    }, 650);
  }

  function bindLoops() {
    $('st-3dmode').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      mode3d = b.getAttribute('data-mode');
      Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); });
      var lp = mode3d === 'loops';
      $('st-loopbar').hidden = !lp; $('st-build').hidden = !lp; $('st-feedkey').hidden = !lp; $('st-loophint').hidden = !lp;
      $('st-clothbar').hidden = lp; $('st-clothhint').hidden = lp;
      $('st-loops').hidden = !lp; $('st-cloth').hidden = lp;
      if (lp && cloth) { try { cloth.dispose(); } catch (_) {} cloth = null; clothKey = ''; }
      render3D();
      if (lp && loopView) loopPromise.then(function (v) { v.view('angle'); });
    });
    $('st-loopbar').addEventListener('click', function (e) {
      var b = e.target.closest('[data-view]'); if (b && loopView) loopView.view(b.getAttribute('data-view'));
    });
    $('st-colby').addEventListener('change', render3D);
    $('st-feedkey').addEventListener('click', function (e) {
      var b = e.target.closest('[data-fk]'); if (!b || !loopView) return;
      var i = +b.getAttribute('data-fk'), on = loopView._hl === i;
      loopView.highlight(on ? null : i);
      Array.prototype.forEach.call(this.querySelectorAll('.fk'), function (x) { x.classList.toggle('on', !on && x === b); });
    });
    $('st-bplay').addEventListener('click', playBuild);
    $('st-bstep').addEventListener('input', function () {
      stopBuild(); if (!loopView) return;
      var k = +this.value;
      loopView.setStep(k >= loopView.geo.rows ? null : k - 1);
      $('st-bnote').textContent = k >= loopView.geo.rows ? 'All ' + k + ' courses' : 'Course ' + k + ' of ' + loopView.geo.rows + ' — feeder F' + (((k - 1) % loopView.geo.F) + 1);
    });
  }

  // ── save / load ──────────────────────────────────────────────────────────
  var STORE = 'ka_studio_designs';
  function readStore() { try { return JSON.parse(localStorage.getItem(STORE) || '[]'); } catch (_) { return []; } }
  function writeStore(a) { try { localStorage.setItem(STORE, JSON.stringify(a)); return true; } catch (_) { return false; } }
  var FIELDS = ['st-ne', 'st-unit', 'st-ply', 'st-ytype', 'st-fil', 'yb-count', 'yb-unit', 'yb-fibre', 'yb-type', 'yb-ply', 'yb-fil', 'yl-count', 'yl-unit', 'yl-fibre', 'yl-type', 'yl-ply', 'yl-fil', 'st-fibre', 'st-gsm', 'st-width', 'st-gauge', 'st-dia', 'st-feeders', 'st-rpm', 'st-sl', 'st-eff', 'st-tc', 'st-td', 'st-lyd', 'st-lydraft', 'st-lyevery', 'st-v1r', 'st-v1l', 'st-v2r', 'st-v2l', 'st-sinker', 'st-parr', 'st-mprof', 'st-brush', 'st-passes', 'st-pile', 'st-tdir', 'st-shr', 'st-camd', 'st-timing', 'st-dgap', 'st-c1r', 'st-c1l', 'st-c2r', 'st-c2l', 'st-stripe', 'st-sc-A', 'st-sc-B', 'st-sc-C', 'st-sc-D', 'st-sc-E', 'st-sc-F'];
  function designNow() {
    var o = { v: 2, name: $('st-name').value || 'Untitled design', bed: S.bed, C: S.C, D: S.D, feeds: S.feeds, rolls: rolls, lycra: $('st-lycra').checked, cut: $('st-cut').checked, colour: $('st-col').value, fields: {} };
    FIELDS.forEach(function (id) { o.fields[id] = $(id).value; });
    return o;
  }
  function loadDesign(o) {
    if (!o || !Array.isArray(o.C) || !o.C.length) throw new Error('Not a Fabric Studio design file.');
    snapshot();
    S.bed = o.bed || (o.D ? 'rib' : 'single'); S.C = o.C; S.D = o.D || null; S.feeds = o.feeds || o.C.map(function () { return { role: 'ground' }; });
    $('st-name').value = o.name || ''; delete $('st-name').dataset.auto;
    $('st-lycra').checked = !!o.lycra; $('st-lycra-box').hidden = !o.lycra; $('st-cut').checked = !!o.cut;
    if (o.colour) $('st-col').value = o.colour;
    Object.keys(o.fields || {}).forEach(function (id) { if ($(id)) $(id).value = o.fields[id]; });
    S.templateId = ''; $('st-template').value = '';
    rolls = Array.isArray(o.rolls) ? o.rolls : [];
    writeRolls();
    renderAll();
  }
  var account = [], warpSaved = [], pendingWarp = null;          // designs saved to the signed-in account (weft here, warp on the warp page)
  window.KAStudioReloadAccount = function () { return loadAccount(); };
  function refreshSaved() {
    var local = readStore();
    $('st-saved').innerHTML = '<option value="">Saved designs…</option>' +
      (account.length ? '<optgroup label="My account">' + account.map(function (d, i) { return '<option value="a' + i + '">' + esc(d.name) + '</option>'; }).join('') + '</optgroup>' : '') +
      (local.length ? '<optgroup label="This browser only">' + local.map(function (d, i) { return '<option value="l' + i + '">' + esc(d.name) + '</option>'; }).join('') + '</optgroup>' : '');
    $('st-move').hidden = !local.length;
  }
  var wantDesign = new URLSearchParams(window.location.search).get('design');
  function loadAccount() {
    return apiFetch('/api/studio/designs').then(function (r) {
      // a warp design belongs to the warp page, a weft design to this one
      var all = r.designs || [], isWarp = function (d) { return d.design && d.design.tech === 'warp'; };
      account = all.filter(function (d) { return !isWarp(d); }); refreshSaved();
      var warp = all.filter(isWarp);
      // ?design=<id> (from the dashboard or search) opens that saved design once
      if (wantDesign) {
        var id = wantDesign; wantDesign = null;
        var wi = warp.findIndex(function (x) { return String(x.id) === id; });
        if (wi > -1) { pendingWarp = id; }
        else {
          var i = account.findIndex(function (x) { return String(x.id) === id; });
          if (i > -1) { loadDesign(account[i].design); $('st-del').dataset.id = account[i].id; $('st-del').hidden = false; }
        }
      }
      warpSaved = warp;
      if (window.KAStudioWarp) window.KAStudioWarp.setSaved(warp);
      if (pendingWarp) {
        // the warp page needs its templates first: wait for them, then open the design
        var pw = pendingWarp, tries = 0; pendingWarp = null;
        var timer = setInterval(function () {
          if (warpData && window.KAStudioWarp) { clearInterval(timer); setTech('warp'); setTimeout(function () { window.KAStudioWarp.openById(pw); }, 400); }
          else if (++tries > 60) clearInterval(timer);
        }, 150);
      }
    }).catch(function () { refreshSaved(); });
  }
  function flash(btn, text, back) { btn.textContent = text; setTimeout(function () { btn.textContent = back; }, 1800); }

  // ── wiring ───────────────────────────────────────────────────────────────
  function renderAll() {
    showYarnRows();
    rolls = readRolls(); renderRolls();
    renderBed(); renderEditor(); renderNotation(); schedule();
  }

  function init() {
    $('st-tech').addEventListener('click', function (e) { var b = e.target.closest('[data-tech]'); if (b && !b.disabled) setTech(b.getAttribute('data-tech')); });
    bindEditor();
    bindRolls();
    bindLoops();
    renderNeedleTypes();
    $('st-bed').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) setBed(b.getAttribute('data-bed')); });
    $('st-template').addEventListener('change', function () { applyTemplate(this.value); });
    $('st-lycra').addEventListener('change', function () { $('st-lycra-box').hidden = !this.checked; schedule(); });
    $('st-brush').addEventListener('change', function () { $('st-brush-box').hidden = this.value === 'none'; });
    $('st-gsm').addEventListener('input', function () { this.dataset.touched = '1'; });
    $('st-name').addEventListener('input', function () { delete this.dataset.auto; });
    document.querySelectorAll('aside input, aside select').forEach(function (el) {
      if (el.closest('#st-warp')) return;
      if (el.id === 'st-template' || el.id === 'st-saved' || el.id === 'st-name' || el.id === 'st-import') return;
      el.addEventListener('change', schedule);
      if (el.type === 'number') el.addEventListener('input', schedule);
    });
    $('st-col').addEventListener('change', render3D);
    $('st-zoom').addEventListener('click', function (e) {
      var b = e.target.closest('[data-z]'); if (!b) return;
      zoom = b.getAttribute('data-z');
      Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); });
      if (cloth) cloth.frame(zoom);
    });
    $('st-side').addEventListener('click', function () {
      showBack = !showBack; this.textContent = showBack ? 'Show face' : 'Show back';
      if (cloth) cloth.setView(showBack ? 'back' : 'front');
      else if (loopView) loopView.view(showBack ? 'back' : 'face');
    });
    document.querySelector('.st-tabs').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var t = b.getAttribute('data-tab');
      Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); });
      document.querySelectorAll('.st-pane').forEach(function (p) { p.classList.toggle('on', p.id === 'pane-' + t); });
      if (t === 'needle') { race.reset(); race.start(); cycle.start(); } else { race.stop(); cycle.stop(); }
      if (t === '3d') render3D();
    });
    $('st-play').addEventListener('click', function () { this.textContent = race.toggle() ? 'Pause' : 'Play'; });
    $('st-anibed').addEventListener('change', function () { race.reset(); cycle.refresh(); });
    cycle.bind();
    YROWS.forEach(function (R) { $(R.f).addEventListener('change', function () { yarnTypes(R); }); });
    $('st-editor').addEventListener('change', function (e) { if (e.target.getAttribute('data-k') === 'role') showYarnRows(); });
    loadMyMachine();
    $('st-mymach').addEventListener('change', function () { saveMyMachine(); $('st-mprof').dispatchEvent(new Event('change')); });
    $('st-mymach').addEventListener('input', function (e) { if (e.target.type === 'number' || e.target.type === 'text') { saveMyMachine(); schedule(); } });
    $('st-stripe').addEventListener('input', schedule);
    $('st-swatches').addEventListener('input', function () { render3D(); });
    $('st-mprof').addEventListener('change', function () {
      $('st-mymach').hidden = this.value !== 'custom';
      if (this.value === 'custom') {
        $('st-mymach').open = true;
        // a new machine starts from the beds drawn now
        var saved = null; try { saved = localStorage.getItem(MYM); } catch (_) {}
        if (!saved) { $('mm-kind').value = S.D ? 'double' : 'single'; $('mm-gating').value = S.bed === 'interlock' ? 'interlock' : 'rib'; saveMyMachine(); }
      }
      var mm = this.value === 'custom' ? myMachine() : null;
      var m = mm ? { kind: mm.kind, gatings: mm.kind === 'double' ? mm.gatings : ['single'], use: 'your machine, from its own specification', sinker: { text: '' }, cams: { C: mm.cams_cyl, D: mm.cams_dial }, transfer: mm.cams_cyl.indexOf('E') > -1, bed_transfer: mm.cams_cyl.indexOf('R') > -1 || mm.cams_dial.indexOf('R') > -1 } : machines.filter(function (x) { return x.id === this.value; }, this)[0];
      if (m) {
        if (m.kind === 'single' && S.D) setBed('single');
        else if (m.kind === 'double' && (!S.D || m.gatings.indexOf(S.bed) < 0)) setBed(m.gatings.indexOf(S.bed) > -1 ? S.bed : m.gatings[0]);
        $('st-mprof-hint').textContent = m.use.charAt(0).toUpperCase() + m.use.slice(1) + '. ' + m.sinker.text;
      } else $('st-mprof-hint').textContent = 'The studio picks the simplest machine that knits what you draw.';
      paletteFor();
      schedule();
    });
    $('pane-setup').addEventListener('click', function (e) {
      var a = e.target.closest('[data-prof]');
      if (a) { $('st-mprof').value = a.getAttribute('data-prof'); $('st-mprof').dispatchEvent(new Event('change')); return; }
      if (e.target.id === 'st-camapply') applyCams();
      var co = e.target.closest('[data-camop]');
      if (co) op(co.getAttribute('data-camop'));
    });
    $('pane-setup').addEventListener('change', function (e) {
      if (e.target.classList.contains('st-camsel')) e.target.className = 'st-camsel ' + e.target.value;
    });
    $('st-save').addEventListener('click', function () {
      var btn = this, d = designNow();
      apiFetch('/api/studio/designs', { method: 'PUT', body: { name: d.name, design: d } }).then(function () {
        flash(btn, 'Saved to your account ✓', 'Save to my account'); return loadAccount();
      }).catch(function (e) {
        var msg = (e.data && e.data.error) || '';
        if (e.status === 400) { alert(msg); return; }
        // the server could not be reached: keep it in this browser rather than lose it
        var a = readStore(), i = a.findIndex(function (x) { return x.name === d.name; });
        if (i > -1) a[i] = d; else a.push(d);
        flash(btn, writeStore(a) ? 'Saved in this browser (account unreachable)' : 'Could not save', 'Save to my account'); refreshSaved();
      });
    });
    $('st-saved').addEventListener('change', function () {
      var v = this.value, d = v[0] === 'a' ? (account[+v.slice(1)] || {}).design : readStore()[+v.slice(1)];
      if (d) { loadDesign(d); $('st-del').dataset.id = v[0] === 'a' ? account[+v.slice(1)].id : ''; $('st-del').hidden = v[0] !== 'a'; }
      this.value = '';
    });
    $('st-del').addEventListener('click', function () {
      var id = this.dataset.id; if (!id || !confirm('Delete this saved design from your account?')) return;
      apiFetch('/api/studio/designs/' + id, { method: 'DELETE' }).then(function () { $('st-del').hidden = true; return loadAccount(); }).catch(function (e) { alert((e.data && e.data.error) || 'Could not delete.'); });
    });
    $('st-move').addEventListener('click', function () {
      var btn = this, local = readStore();
      Promise.all(local.map(function (d) { return apiFetch('/api/studio/designs', { method: 'PUT', body: { name: d.name, design: d } }); })).then(function () {
        writeStore([]); flash(btn, 'Moved ✓', 'Move browser designs to my account'); return loadAccount();
      }).catch(function (e) { alert((e.data && e.data.error) || 'Could not move them.'); });
    });
    $('st-export').addEventListener('click', function () {
      var d = designNow();
      var blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (d.name || 'fabric').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '.knitstudio.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });
    $('st-import').addEventListener('change', function () {
      var file = this.files && this.files[0]; if (!file) return;
      var rd = new FileReader();
      rd.onload = function () { try { loadDesign(JSON.parse(rd.result)); } catch (e) { alert(e.message || 'Could not read that file.'); } };
      rd.readAsText(file); this.value = '';
    });
    $('st-print').addEventListener('click', function () { window.print(); });
    refreshSaved(); loadAccount();
    loadTemplates().then(function () { applyTemplate(S.templateId); undo = []; var t0 = null; try { t0 = localStorage.getItem('ka-studio-tech'); } catch (_) {} if (t0 === 'warp') setTech('warp'); })
      .catch(function (e) { $('st-status').innerHTML = '<div class="st-err">' + esc(e.message || 'Could not load the fabric catalogue.') + '</div>'; renderAll(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
