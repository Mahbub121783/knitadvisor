/**
 * KnitAdvisor — Garment Studio (garment.html)
 *
 * The page draws; the engine decides. Every edit of the chart or the fabric posts the whole specification to /api/garment/build
 * (garment-pattern.js), which answers with the finished and cut outline of every piece of every size, the marker and the fabric per garment. The page
 * renders that answer as SVG, and the 3D garment (garment-3d.js) is built from the same finished pieces: one chart, one set of numbers.
 */
(function () {
  'use strict';
  var KEY = 'ka_garment_spec_v1', FROM = 'ka_garment_fabric', INCH = 2.54;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var r1 = function (v) { return Math.round(v * 10) / 10; };
  var r2 = function (v) { return Math.round(v * 100) / 100; };

  var POMS = [], poms = {}, POMS_BY = {};
  var S = null, R = null, view3d = null, mod3d = null, reqSeq = 0, timer = 0;
  var SIZE_COL = ['#1857C4', '#c2410c', '#0e7490', '#7a4fc2', '#b48a35', '#a5486f', '#3f8a6e', '#4a5568'];
  var EDGE = { waist: '#d97706', wband: '#d97706', centre: '#1857C4', crotch: '#7a4fc2', inseam: '#0e7490', inseamhem: '#0e7490', pocketopen: '#c2410c', pocketbag: '#c2410c', bpocket: '#c2410c', neck: '#d97706', bandneck: '#d97706', shoulder: '#7a4fc2', armhole: '#1857C4', cap: '#1857C4', side: '#0e7490', sidehem: '#0e7490', underarm: '#0e7490', underarmhem: '#0e7490', bandend: '#0e7490', hem: '#6b7280', shem: '#6b7280', cf: '#c2410c', faceend: '#6b7280', faceedge: '#6b7280' };
  var SEAM_OF = { waist: 'waistband', wband: 'waistband', centre: 'rise', crotch: 'rise', inseam: 'inseam', inseamhem: 'inseam', pocketopen: 'pocket', pocketbag: 'pocket', bpocket: 'pocket', neck: 'neck', bandneck: 'neck', shoulder: 'shoulder', armhole: 'armhole', cap: 'armhole', side: 'side', sidehem: 'side', underarm: 'underarm', underarmhem: 'underarm', hem: 'hem', shem: 'sleeve_hem', bandend: 'band_end', cf: 'cf', faceend: 'facing_end', faceedge: 'facing_edge' };

  // ── the specification ──
  function defaults(tpl) {
    return {
      unit: tpl.unit || 'cm', sizes: tpl.sizes.slice(), base: tpl.sizes.indexOf('M') >= 0 ? 'M' : tpl.sizes[0], size: tpl.sizes.indexOf('M') >= 0 ? 'M' : tpl.sizes[0],
      chart: JSON.parse(JSON.stringify(tpl.chart)), ratio: tpl.sizes.reduce(function (o, s) { o[s] = 1; return o; }, {}),
      fabric: { name: '', gsm: 180, width: 170, wunit: 'cm', shrink_len_pct: 6, shrink_wid_pct: 6, rib_stretch_pct: 25, colour: '#3d5a80', wpc: '', cpc: '' },
      opt: { seam: 1, neck: 0.7, ease: 0.5, orient: 'both', gap: 1 }, tab: 'patterns',
      style: 'tee', edits: {}, seams: {}, cornerFlags: {}, trims: [], tol: {}, spec: null, zipper: { on: false, kind: 'full', type: 'open_end', teeth: 'coil', size: 5, tape_w: 2.5, length_cm: 18, allow: 1.5, facing_w: 5.5 }
    };
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (_) { /* private window */ } }
  function load() { try { var o = JSON.parse(localStorage.getItem(KEY) || 'null'); return o && o.sizes && o.chart ? o : null; } catch (_) { return null; } }

  function payload() {
    var f = S.fabric, chart = {};
    Object.keys(S.chart).forEach(function (k) { var row = {}; S.sizes.forEach(function (s) { var v = S.chart[k] && S.chart[k][s]; if (v !== '' && v != null) row[s] = v; }); if (Object.keys(row).length) chart[k] = row; });
    return {
      style: S.style || 'tee', unit: S.unit, sizes: S.sizes, base: S.base, chart: chart, ratio: S.ratio, ease_cm: +S.opt.ease, orient: S.opt.orient, gap_cm: +S.opt.gap,
      allowance: { seam: +S.opt.seam, neck: +S.opt.neck }, edits: S.edits || {}, seams: S.seams || {}, trims: (S.trims || []).filter(function (t) { return t.use !== false; }), tolerances: S.tol || {}, spec: compactSpec(S.spec),
      zipper: S.style !== 'shorts' && S.zipper && S.zipper.on ? { on: true, kind: S.zipper.kind, type: S.zipper.type, teeth: S.zipper.teeth, size: +S.zipper.size, tape_w: +S.zipper.tape_w, length_cm: +S.zipper.length_cm, allow: +S.zipper.allow, facing_w: +S.zipper.facing_w } : { on: false },
      fabric: { name: f.name, gsm: +f.gsm, width_cm: f.wunit === 'in' ? +f.width * INCH : +f.width, shrink_len_pct: +f.shrink_len_pct, shrink_wid_pct: +f.shrink_wid_pct, rib_stretch_pct: +f.rib_stretch_pct, colour: f.colour, wpc: +f.wpc || 0, cpc: +f.cpc || 0 }
    };
  }

  // the points of measure of a garment type, from the engine (once)
  function ensureStyle(style) {
    style = style === 'shorts' ? 'shorts' : 'tee';
    if (POMS_BY[style]) return Promise.resolve(POMS_BY[style]);
    return api('/api/garment/template?style=' + style + '&unit=cm').then(function (t) { POMS_BY[style] = t; return t; });
  }
  function setPoms(style) {
    var t = POMS_BY[style]; if (!t) return; S.style = style; POMS = t.poms; poms = {}; POMS.forEach(function (p) { poms[p.key] = p; });
    POMS.forEach(function (p) { if (!S.chart[p.key]) S.chart[p.key] = {}; });
    var zc = $('gm-zipcard'); if (zc) zc.hidden = style !== 'tee';
    document.body.setAttribute('data-gstyle', style);
  }
  // another garment type: its own chart (the standard one), its own pieces
  function switchStyle(style, keepChart) {
    return ensureStyle(style).then(function (t) {
      S.style = style === 'shorts' ? 'shorts' : 'tee';
      if (!keepChart) {
        S.unit = t.unit || 'cm'; S.sizes = t.sizes.slice(); S.chart = JSON.parse(JSON.stringify(t.chart)); S.ratio = S.sizes.reduce(function (o, s) { o[s] = 1; return o; }, {});
        S.base = S.sizes.indexOf('M') >= 0 ? 'M' : S.sizes[0]; S.size = S.base; S.edits = {}; S.cornerFlags = {}; S.seams = {}; S.trims = []; S.tol = {}; S.spec = null; S.zipper = Object.assign({}, S.zipper, { on: false });
        S.fabric = Object.assign({}, S.fabric, { gsm: S.style === 'shorts' ? 240 : 180 });
      }
      setPoms(S.style); renderFabric(); renderChart(); renderZipper(); schedule();
      if (window.KAGarmentStudio) window.KAGarmentStudio.styleChanged();
    });
  }
  // what the engine needs of a spec sheet to check the pattern against it
  function compactSpec(sp) {
    if (!sp || !sp.poms) return undefined;
    return { unit: sp.unit, poms: sp.poms.filter(function (p) { return p.include !== false && p.key; }).map(function (p) { return { id: p.id, code: p.code, label: p.label, key: p.key, basis: p.basis, values: p.values, tol: p.tol ? { plus: p.tol.plus, minus: p.tol.minus, given: !!p.tol.given } : null, depth: p.depth || null }; }) };
  }
  // a spec sheet's chart, fabric, stitches, zipper, trims and tolerances put into the page (the answer of /api/garment/spec/apply)
  function applySpec(b, spec) {
    return ensureStyle(b.style || 'tee').then(function () { setPoms(b.style || 'tee'); applySpec2(b, spec); if (window.KAGarmentStudio) window.KAGarmentStudio.styleChanged(); });
  }
  function applySpec2(b, spec) {
    S.unit = b.unit === 'in' ? 'in' : 'cm'; S.sizes = b.sizes.slice(0, 8);
    S.chart = {}; POMS.forEach(function (p) { S.chart[p.key] = {}; });
    Object.keys(b.chart).forEach(function (k) { S.chart[k] = {}; Object.keys(b.chart[k]).forEach(function (s) { S.chart[k][s] = String(b.chart[k][s]); }); });
    S.ratio = S.sizes.reduce(function (o, s) { o[s] = 1; return o; }, {});
    S.base = b.base && S.sizes.indexOf(b.base) >= 0 ? b.base : S.sizes[Math.floor((S.sizes.length - 1) / 2)]; S.size = S.base;
    var F = S.fabric, bf = b.fabric || {};
    if (bf.name) F.name = bf.name; if (bf.gsm) F.gsm = bf.gsm; if (bf.width_cm) F.width = r1(F.wunit === 'in' ? bf.width_cm / INCH : bf.width_cm);
    if (bf.shrink_len_pct != null) F.shrink_len_pct = bf.shrink_len_pct; if (bf.shrink_wid_pct != null) F.shrink_wid_pct = bf.shrink_wid_pct;
    Object.keys(b.seams || {}).forEach(function (id) { S.seams[id] = Object.assign({}, S.seams[id] || {}, { type: b.seams[id].type }); });
    S.zipper = b.zipper && b.zipper.on ? Object.assign({}, S.zipper, b.zipper, { on: true }) : Object.assign({}, S.zipper, { on: false });
    S.trims = (b.trims || []).map(function (t) { return { item: t.item, qty: t.qty, unit: t.unit, note: t.note }; }); S.tol = b.tolerances || {}; S.spec = spec || null;
    S.edits = {}; S.cornerFlags = {};
    renderFabric(); renderChart(); renderZipper(); if (view3d) view3d.setColour(F.colour); schedule();
  }
  // a kept preset put into the page
  function loadState(p) {
    if (!p || !p.sizes || !p.chart) return;
    return ensureStyle(p.style || 'tee').then(function () { setPoms(p.style || 'tee'); loadState2(p); if (window.KAGarmentStudio) window.KAGarmentStudio.styleChanged(); });
  }
  function loadState2(p) {
    S.unit = p.unit === 'in' ? 'in' : 'cm'; S.sizes = p.sizes.slice(0, 8);
    S.chart = {}; POMS.forEach(function (q) { S.chart[q.key] = {}; });
    Object.keys(p.chart).forEach(function (k) { S.chart[k] = {}; Object.keys(p.chart[k]).forEach(function (s) { S.chart[k][s] = String(p.chart[k][s]); }); });
    S.ratio = p.ratio || S.sizes.reduce(function (o, s) { o[s] = 1; return o; }, {});
    S.base = p.base && S.sizes.indexOf(p.base) >= 0 ? p.base : S.sizes[Math.floor((S.sizes.length - 1) / 2)]; S.size = S.base;
    if (p.fabric) S.fabric = Object.assign({}, S.fabric, p.fabric);
    if (p.opt) S.opt = Object.assign({}, S.opt, p.opt);
    S.seams = p.seams || {}; S.zipper = p.zipper ? Object.assign({}, S.zipper, p.zipper) : Object.assign({}, S.zipper, { on: false });
    S.trims = p.trims || []; S.tol = p.tol || {}; S.spec = p.spec || null; S.edits = p.edits || {}; S.cornerFlags = p.cornerFlags || {};
    renderFabric(); renderChart(); renderZipper(); if (view3d) view3d.setColour(S.fabric.colour); schedule();
  }

  // ── the fabric card ──
  function renderFabric() {
    var f = S.fabric;
    $('gm-fname').value = f.name || ''; $('gm-gsm').value = f.gsm; $('gm-width').value = f.width; $('gm-wunit').value = f.wunit || 'cm';
    $('gm-shl').value = f.shrink_len_pct; $('gm-shw').value = f.shrink_wid_pct; $('gm-rib').value = f.rib_stretch_pct;
    $('gm-colour').value = f.colour || '#3d5a80'; $('gm-wpc').value = f.wpc || ''; $('gm-cpc').value = f.cpc || '';
    $('gm-seam').value = S.opt.seam; $('gm-neckal').value = S.opt.neck; $('gm-ease').value = S.opt.ease; $('gm-orient').value = S.opt.orient; $('gm-gap').value = S.opt.gap;
  }
  function bindFabric() {
    var map = { 'gm-fname': ['f', 'name'], 'gm-gsm': ['f', 'gsm'], 'gm-width': ['f', 'width'], 'gm-wunit': ['f', 'wunit'], 'gm-shl': ['f', 'shrink_len_pct'], 'gm-shw': ['f', 'shrink_wid_pct'], 'gm-rib': ['f', 'rib_stretch_pct'],
      'gm-colour': ['f', 'colour'], 'gm-wpc': ['f', 'wpc'], 'gm-cpc': ['f', 'cpc'], 'gm-seam': ['o', 'seam'], 'gm-neckal': ['o', 'neck'], 'gm-ease': ['o', 'ease'], 'gm-orient': ['o', 'orient'], 'gm-gap': ['o', 'gap'] };
    Object.keys(map).forEach(function (id) {
      $(id).addEventListener(id === 'gm-wunit' || id === 'gm-orient' ? 'change' : 'input', function () {
        var t = map[id], v = this.value;
        if (id === 'gm-wunit') { var w = +S.fabric.width; if (w > 0) { S.fabric.width = r1(v === 'in' ? w / INCH : w * INCH); $('gm-width').value = S.fabric.width; } }
        (t[0] === 'f' ? S.fabric : S.opt)[t[1]] = v;
        if (id === 'gm-colour' && view3d) view3d.setColour(v);
        schedule();
      });
    });
  }

  // ── the chart ──
  function sizeStep(s) { return s; }
  function renderChart() {
    var h = '<thead><tr><th>Point of measure</th>' + S.sizes.map(function (s, i) {
      return '<th class="' + (s === S.base ? 'on-base' : '') + '">' + esc(s) + (S.sizes.length > 1 ? ' <button type="button" class="gm-x" data-rm="' + i + '" title="Remove size ' + esc(s) + '" aria-label="Remove size ' + esc(s) + '">&times;</button>' : '') +
        '<span class="gm-base" data-base="' + esc(s) + '" title="The size shown in the garment">' + (s === S.base ? 'shown' : 'show') + '</span></th>';
    }).join('') + '</tr></thead><tbody>';
    POMS.forEach(function (p, ri) {
      if (S.style !== 'shorts' && ri === 9) h += '<tr class="sep"><td colspan="' + (S.sizes.length + 1) + '"></td></tr>';
      h += '<tr><td class="' + (p.required ? 'req' : '') + '">' + esc(p.label) + '</td>' + S.sizes.map(function (s) {
        var v = S.chart[p.key] && S.chart[p.key][s]; v = v == null ? '' : v;
        return '<td><input type="text" inputmode="decimal" data-pom="' + p.key + '" data-size="' + esc(s) + '" value="' + esc(v) + '" placeholder="' + (p.required && p.key !== 'chest' && p.key !== 'length' ? 'auto' : p.required ? '' : 'auto') + '" aria-label="' + esc(p.label + ', size ' + s) + '"></td>';
      }).join('') + '</tr>';
    });
    h += '<tr class="sep"><td colspan="' + (S.sizes.length + 1) + '"></td></tr><tr><td>Marker ratio (garments)</td>' + S.sizes.map(function (s) { return '<td><input type="text" inputmode="numeric" data-ratio="' + esc(s) + '" value="' + esc(S.ratio[s] != null ? S.ratio[s] : 1) + '" aria-label="Garments of size ' + esc(s) + '"></td>'; }).join('') + '</tr></tbody>';
    $('gm-chart').innerHTML = h;
    Array.prototype.forEach.call(document.querySelectorAll('#gm-unit button'), function (b) { b.classList.toggle('on', b.getAttribute('data-u') === S.unit); });
  }
  function bindChart() {
    var tb = $('gm-chart');
    tb.addEventListener('input', function (e) {
      var t = e.target;
      if (t.hasAttribute('data-pom')) { var k = t.getAttribute('data-pom'), s = t.getAttribute('data-size'); (S.chart[k] = S.chart[k] || {})[s] = t.value.trim(); }
      else if (t.hasAttribute('data-ratio')) S.ratio[t.getAttribute('data-ratio')] = t.value.trim() === '' ? 0 : +t.value;
      schedule();
    });
    tb.addEventListener('click', function (e) {
      var rm = e.target.closest('[data-rm]'), bs = e.target.closest('[data-base]');
      if (rm) { var i = +rm.getAttribute('data-rm'), s = S.sizes[i]; S.sizes.splice(i, 1); Object.keys(S.chart).forEach(function (k) { delete S.chart[k][s]; }); delete S.ratio[s]; if (S.base === s) S.base = S.sizes[Math.floor((S.sizes.length - 1) / 2)]; if (S.size === s) S.size = S.base; renderChart(); schedule(); }
      else if (bs) { S.base = bs.getAttribute('data-base'); S.size = S.base; renderChart(); renderSizes(); renderPatterns(); render3D(); save(); }
    });
    tb.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      var t = e.target; if (!t.matches || !t.matches('input')) return;
      var all = Array.prototype.slice.call(tb.querySelectorAll('input')), i = all.indexOf(t), cols = S.sizes.length, j = i + (e.key === 'ArrowUp' ? -cols : cols);
      if (all[j]) { all[j].focus(); all[j].select(); e.preventDefault(); }
    });
    $('gm-unit').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return; var u = b.getAttribute('data-u'); if (u === S.unit) return;
      var k = u === 'in' ? 1 / INCH : INCH;
      Object.keys(S.chart).forEach(function (key) { Object.keys(S.chart[key]).forEach(function (s) { var raw = S.chart[key][s], n = parseFloat(String(raw).replace(',', '.')); if (isFinite(n) && String(raw).indexOf('/') < 0) S.chart[key][s] = String(r2(n * k)); }); });
      Object.keys(S.tol || {}).forEach(function (key) { var t = S.tol[key]; if (t) { t.plus = r2(t.plus * k); t.minus = r2(t.minus * k); } });
      S.unit = u; renderChart(); schedule();
    });
    $('gm-addsize').addEventListener('click', function () {
      var name = window.prompt('Size name (for example 2XL):', ''); name = (name || '').trim().slice(0, 6); if (!name || S.sizes.indexOf(name) >= 0 || S.sizes.length >= 8) return;
      var last = S.sizes[S.sizes.length - 1]; S.sizes.push(name);
      Object.keys(S.chart).forEach(function (k) { if (S.chart[k][last] != null) S.chart[k][name] = S.chart[k][last]; });
      S.ratio[name] = 1; renderChart(); schedule();
    });
    $('gm-tpl').addEventListener('click', function () {
      api('/api/garment/template?sizes=' + encodeURIComponent(S.sizes.join(',')) + '&unit=' + S.unit).then(function (t) { S.chart = t.chart; S.sizes = t.sizes; renderChart(); schedule(); });
    });
    $('gm-readchart').addEventListener('click', function () {
      var note = $('gm-pnote'); note.textContent = 'Reading…';
      if (window.KAGarmentSpec) { window.KAGarmentSpec.fromText($('gm-paste').value, note); return; }
      api('/api/garment/parse', { method: 'POST', body: { text: $('gm-paste').value } }).then(function (q) {
        S.unit = q.unit; S.sizes = q.sizes.slice(0, 8); S.chart = {}; POMS.forEach(function (p) { S.chart[p.key] = {}; });
        Object.keys(q.chart).forEach(function (k) { S.chart[k] = {}; Object.keys(q.chart[k]).forEach(function (s) { S.chart[k][s] = String(q.chart[k][s]); }); });
        S.ratio = S.sizes.reduce(function (o, s) { o[s] = 1; return o; }, {}); S.base = S.sizes[Math.floor((S.sizes.length - 1) / 2)]; S.size = S.base;
        note.innerHTML = 'Read ' + q.mapped.length + ' measurements, taken as ' + (q.unit === 'in' ? '<b>inches</b> (a flat chest under 40 is inches)' : '<b>centimetres</b>') + ' — if that is wrong, change cm / inch above and paste again. Found: ' + q.mapped.map(function (m) { return esc(m.label); }).join(', ') + '.' + (q.unmapped.length ? '<br><b>Not used</b> (not part of a basic tee): ' + q.unmapped.map(esc).join(', ') + '.' : '');
        renderChart(); schedule();
      }).catch(function (e) { note.textContent = (e && e.message) || 'The chart could not be read.'; });
    });
  }

  // ── the engine ──
  function api(url, o) { return window.apiFetch(url, o || {}); }
  function schedule() { save(); clearTimeout(timer); $('gm-status').textContent = 'Working…'; timer = setTimeout(build, 300); }
  function build() {
    var my = ++reqSeq;
    api('/api/garment/build', { method: 'POST', body: payload() }).then(function (r) { if (my !== reqSeq) return; R = r; $('gm-status').textContent = ''; renderAll(); })
      .catch(function (e) {
        if (my !== reqSeq) return;
        var d = e && e.data;
        R = d && d.checks ? d : { success: false, error: (d && d.error) || (e && e.message) || 'The garment could not be built.', checks: [] };
        if (!R.success) R.checks = R.checks || []; $('gm-status').textContent = ''; renderAll();
      });
  }

  // ── what the answer says ──
  function sizeOf(name) { return R && R.success && R.by_size.filter(function (o) { return o.size === name; })[0]; }
  function renderAll() { renderSummary(); renderSizes(); renderPatterns(); renderSewing(); renderZipperInfo(); renderMarker(); renderChecks(); render3D(); markBad(); if (window.KAGarmentEdit) window.KAGarmentEdit.render(); if (window.KAGarmentSpec) window.KAGarmentSpec.renderCheck(); if (window.KAGarmentStudio) window.KAGarmentStudio.render(); }

  function kpi(l, v, s, cls) { return '<div class="gm-kpi ' + (cls || '') + '"><div class="l">' + esc(l) + '</div><div class="v">' + v + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</div>'; }
  function renderSummary() {
    var el = $('gm-summary');
    if (!R || !R.success) { el.innerHTML = kpi('Garment', 'Not yet', esc((R && R.error) || 'Fill in the chest and the length.'), 'bad'); $('gm-docksum').textContent = (R && R.error) || 'Fill in the chart'; return; }
    var c = R.consumption, errs = R.checks.filter(function (x) { return x.level === 'error'; }).length, warns = R.checks.filter(function (x) { return x.level === 'warn'; }).length;
    $('gm-docksum').innerHTML = '<b>' + c.fabric_per_garment_m + ' m</b> a garment · ' + c.gross_kg_per_garment + ' kg<br>marker ' + c.efficiency_pct + ' %' + (errs ? ' · ' + errs + ' error' + (errs > 1 ? 's' : '') : warns ? ' · ' + warns + ' to check' : '');
    el.innerHTML = kpi('Fabric per garment', c.fabric_per_garment_m + ' m', c.gross_kg_per_garment + ' kg · ' + c.gross_kg_per_dozen + ' kg a dozen') +
      kpi('Marker', c.efficiency_pct + ' %', c.garments_in_marker + ' garment' + (c.garments_in_marker > 1 ? 's' : '') + ' in ' + r1(c.marker_length_cm / 100) + ' m', c.efficiency_pct < 70 ? 'warn' : '') +
      kpi('Cut larger by', R.cut_factor.across === R.cut_factor.along ? r1((R.cut_factor.across - 1) * 100) + ' %' : r1((R.cut_factor.across - 1) * 100) + ' / ' + r1((R.cut_factor.along - 1) * 100) + ' %', 'across / along the wales') +
      kpi('Checks', errs ? errs + ' error' + (errs > 1 ? 's' : '') : warns ? warns + ' to look at' : 'All good', warns && !errs ? 'see the Checks tab' : '', errs ? 'bad' : warns ? 'warn' : '');
  }
  function renderSizes() {
    var html = (R && R.success ? R.by_size : []).map(function (o) { return '<button type="button" class="gm-chipb' + (o.size === S.size ? ' on' : '') + '" data-size="' + esc(o.size) + '">' + esc(o.size) + '</button>'; }).join('');
    ['gm-psizes', 'gm-gsizes', 'gm-edsizes', 'gm-ssizes', 'gs-sizes'].forEach(function (id) { if ($(id)) $(id).innerHTML = html; });
  }
  function markBad() {
    Array.prototype.forEach.call(document.querySelectorAll('#gm-chart input[data-pom]'), function (i) { i.classList.remove('bad', 'assumed'); });
    if (!R) return;
    (R.checks || []).forEach(function (c) {
      if (c.level !== 'error' || !c.size) return;
      var low = c.text.toLowerCase();
      POMS.forEach(function (p) { if (p.key !== 'hem' && low.indexOf(p.label.toLowerCase().split(',')[0].split(' (')[0]) >= 0) { var i = document.querySelector('#gm-chart input[data-pom="' + p.key + '"][data-size="' + c.size + '"]'); if (i) i.classList.add('bad'); } });
    });
    (R.checks || []).forEach(function (c) {
      var m = /^(.+?): not in the chart, taken as/.exec(c.text); if (!m) return;
      var p = POMS.filter(function (q) { return q.label === m[1]; })[0]; if (!p || !c.size) return;
      var i = document.querySelector('#gm-chart input[data-pom="' + p.key + '"][data-size="' + c.size + '"]'); if (i && !i.value) i.classList.add('assumed');
    });
  }

  // ── patterns ──
  function bboxOf(poly) { var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; poly.forEach(function (p) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }); return { x0: x0, y0: y0, x1: x1, y1: y1, w: x1 - x0, h: y1 - y0 }; }
  function runs(poly, labels) {                                                // consecutive edges of one label, as polylines
    var out = [], cur = null, n = poly.length;
    for (var i = 0; i < n; i++) {
      var l = labels[i] || 'seam', a = poly[i], b = poly[(i + 1) % n];
      if (!cur || cur.l !== l) { cur = { l: l, pts: [a] }; out.push(cur); }
      cur.pts.push(b);
    }
    return out;
  }
  function pathOf(pts) { return 'M' + pts.map(function (p) { return p[0] + ' ' + p[1]; }).join('L'); }
  function patternsSvg(o, oneToOne) {
    // every piece that is cut, in the order it is read, flowed into rows
    var order = R.style === 'shorts' ? o.pieces.map(function (q) { return q.id; }) : ['front', 'front_r', 'front_l', 'back', 'sleeve', 'band', 'facing', 'placket'], gap = 9, pad = 5, maxW = 150;
    var list = order.map(function (id) { return o.pieces.filter(function (p) { return p.id === id; })[0]; }).filter(Boolean);
    var x = pad, y = pad, rh = 0, W = 0, parts = [], sx = R.cut_factor.across, sy = R.cut_factor.along;
    list.forEach(function (p) {
      var b = bboxOf(p.cut), extra = p.grain === 'x' ? 9 : 0;
      if (x > pad && x + b.w > maxW) { y += rh + gap + 4; x = pad; rh = 0; }
      parts.push({ p: p, ox: x - b.x0, oy: y - b.y0, b: b });
      x += b.w + gap; rh = Math.max(rh, b.h + extra); W = Math.max(W, x - gap + pad);
    });
    var H = y + rh + pad, g = '';
    parts.forEach(function (q) {
      var p = q.p, tf = 'translate(' + q.ox + ' ' + q.oy + ')', cx = (q.b.x0 + q.b.x1) / 2, cy = (q.b.y0 + q.b.y1) / 2, horiz = p.grain === 'x';
      g += '<g class="gs-pp" data-piece="' + p.id + '" transform="' + tf + '">';
      g += '<path d="' + pathOf(p.cut) + 'Z" fill="rgba(24,87,196,.06)" stroke="none"/>';
      runs(p.cut, p.labels).forEach(function (r) { g += '<path d="' + pathOf(r.pts) + '" fill="none" stroke="' + (EDGE[r.l] || '#0e7490') + '" stroke-width="0.35" stroke-linejoin="round" stroke-linecap="round"/>'; });
      g += '<path d="' + pathOf(p.nominal) + 'Z" fill="none" stroke="#111" stroke-opacity=".55" stroke-width="0.18" stroke-dasharray="1 0.8"/>';
      (p.notches || []).forEach(function (nt) { g += '<line x1="' + (nt.x - nt.nx * 0.9) + '" y1="' + (nt.y - nt.ny * 0.9) + '" x2="' + (nt.x + nt.nx * 0.9) + '" y2="' + (nt.y + nt.ny * 0.9) + '" stroke="#111" stroke-width="0.32"/>'; });
      (p.marks || []).forEach(function (m) { g += '<line x1="' + (m.x1 * sx) + '" y1="' + (m.y1 * sy) + '" x2="' + (m.x2 * sx) + '" y2="' + (m.y2 * sy) + '" stroke="#c2410c" stroke-width="0.5" stroke-dasharray="1.4 0.8"/><text x="' + (m.x1 * sx + 1.6) + '" y="' + (m.y2 * sy) + '" font-size="1.9" fill="#c2410c">' + esc(m.label || 'slit') + '</text>'; });
      var ha = Math.min(9, q.b.h * 0.2), hl = Math.min(8, q.b.w * 0.2);
      var gl = horiz ? '<line x1="' + (cx - hl) + '" y1="' + cy + '" x2="' + (cx + hl) + '" y2="' + cy + '"/><path d="M' + (cx - hl) + ' ' + cy + 'l1.6 -.9v1.8zM' + (cx + hl) + ' ' + cy + 'l-1.6 -.9v1.8z" fill="#111"/>'
        : '<line x1="' + cx + '" y1="' + (cy - ha) + '" x2="' + cx + '" y2="' + (cy + ha) + '"/><path d="M' + cx + ' ' + (cy - ha) + 'l-.9 1.6h1.8zM' + cx + ' ' + (cy + ha) + 'l-.9 -1.6h1.8z" fill="#111"/>';
      g += '<g stroke="#111" stroke-width="0.2" opacity=".6">' + gl + '</g>';
      var low = !horiz && q.b.h < 40;                                           // a short piece (the sleeve): the name goes under the arrow, clear of the curve
      var ty = horiz ? q.b.y1 + 4.4 : low ? cy + ha + 3.2 : cy - ha - 2.6, dy2 = horiz ? q.b.y1 + 7.4 : low ? cy + ha + 6 : cy + ha + 4.6;
      g += '<text x="' + cx + '" y="' + ty + '" text-anchor="middle" font-size="2.7" font-weight="700" fill="#111">' + esc(p.name) + (p.qty > 1 ? ' × ' + p.qty : '') + '</text>';
      g += '<text x="' + cx + '" y="' + dy2 + '" text-anchor="middle" font-size="2.1" fill="#555">cut ' + p.cut_w + ' × ' + p.cut_h + ' cm</text>';
      g += '</g>';
    });
    var size = oneToOne ? ' width="' + W + 'cm" height="' + H + 'cm"' : '';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '"' + size + ' font-family="Public Sans, Arial, sans-serif" role="img" aria-label="Pattern pieces, size ' + esc(o.size) + '">' + g + '</svg>';
  }
  function renderPatterns() {
    var el = $('gm-patterns'), o = R && R.success ? sizeOf(S.size) || R.by_size[0] : null;
    if (!o) { el.innerHTML = '<div class="gm-empty">' + (R && !R.success ? esc(R.error) : 'Building the patterns…') + '</div>'; $('gm-ptable').innerHTML = ''; $('gm-plegend').innerHTML = ''; return; }
    S.size = o.size;
    el.innerHTML = patternsSvg(o, false);
    $('gm-plegend').innerHTML = R.style === 'shorts' ? '<span><i style="border-color:' + EDGE.centre + '"></i>centre seam</span><span><i style="border-color:' + EDGE.crotch + '"></i>crotch curve</span><span><i style="border-color:' + EDGE.inseam + '"></i>inseam</span><span><i style="border-color:' + EDGE.side + '"></i>side seam</span><span><i style="border-color:' + EDGE.waist + '"></i>waist</span><span><i style="border-color:' + EDGE.hem + '"></i>hem edge</span><span><i style="border-color:' + EDGE.pocketopen + '"></i>pockets</span><span><i class="dash" style="border-color:#555"></i>sewing line</span><span>ticks = notches</span>' : '<span><i style="border-color:' + EDGE.armhole + '"></i>armhole / cap</span><span><i style="border-color:' + EDGE.neck + '"></i>neckline</span><span><i style="border-color:' + EDGE.shoulder + '"></i>shoulder</span><span><i style="border-color:' + EDGE.side + '"></i>side / underarm seam</span><span><i style="border-color:' + EDGE.hem + '"></i>hem edge</span>' + (o.zipper && o.zipper.on ? '<span><i style="border-color:' + EDGE.cf + '"></i>centre front (zipper)</span>' : '') + '<span><i class="dash" style="border-color:#555"></i>sewing line</span><span>ticks = notches</span>';
    $('gm-ptable').innerHTML = '<thead><tr><th>Piece</th><th>Cut</th><th>Finished</th><th>Area</th><th>Seams</th></tr></thead><tbody>' + o.pieces.map(function (p) {
      var seams = {}; (p.finished_labels || []).forEach(function (l) { var id = SEAM_OF[l]; if (id && R.seams[id]) seams[R.seams[id].name] = 1; });
      return '<tr><td>' + esc(p.name) + (p.qty > 1 ? ' × ' + p.qty : '') + (p.rib ? ' <span class="gm-hint">(rib)</span>' : '') + '</td><td>' + p.cut_w + ' × ' + p.cut_h + ' cm</td><td>' + p.finished_w + ' × ' + p.finished_h + ' cm</td><td>' + p.cut_area_cm2 + ' cm²</td><td>' + esc(Object.keys(seams).join(', ')) + '</td></tr>';
    }).join('') + '</tbody>';
  }

  // ── sewing: the seams, the stitch of each, the thread, the order, the bill of materials ──
  function renderSewing() {
    var o = R && R.success ? sizeOf(S.size) || R.by_size[0] : null, tb = $('gm-seams');
    if (!o) { tb.innerHTML = ''; $('gm-sewsum').innerHTML = ''; $('gm-ops').innerHTML = ''; $('gm-bom').innerHTML = ''; $('gm-sam').textContent = ''; return; }
    var sw = o.sewing, cat = R.catalogue.stitch, sam = sw.sam;
    $('gm-sewsum').innerHTML = kpi('Thread a garment', r1(sw.thread_m) + ' m', r1(sw.thread_per_dozen_m) + ' m a dozen') + kpi('Sewing time', sam ? r1(sam.minutes) + ' min' : '—', sam ? 'a basic tee is ' + sam.benchmark_minutes + ' min' + (sam.addons.length ? ' + a zipper (estimate)' : '') : '') + kpi('Operations', sw.operations.length, 'in sewing order') + kpi('Seams', sw.seams.length, sw.seams.filter(function (s) { return !s.match; }).length ? sw.seams.filter(function (s) { return !s.match; }).length + ' do not match' : 'all match', sw.seams.some(function (s) { return !s.match; }) ? 'warn' : '');
    tb.innerHTML = '<thead><tr><th>Seam</th><th>Stitch</th><th>Allowance</th><th>Joins (cm)</th><th>Sewn</th><th>Thread</th></tr></thead><tbody>' + sw.seams.map(function (s) {
      var hem = s.id === 'hem' || s.id === 'sleeve_hem';
      return '<tr class="' + (s.match ? '' : 'off') + '"><td>' + esc(s.name) + '</td><td><select data-seam="' + s.id + '" data-k="type" aria-label="Stitch of the ' + esc(s.name) + '">' + Object.keys(cat).map(function (k) { return '<option value="' + k + '"' + (k === s.type ? ' selected' : '') + '>' + esc(cat[k].name) + '</option>'; }).join('') + '</select><div class="gm-hint">' + esc(s.machine) + '</div></td>' +
        '<td>' + (hem ? '<span class="gm-hint">in the drawing</span>' : '<input type="number" min="0" max="5" step="0.1" data-seam="' + s.id + '" data-k="allowance" value="' + s.allowance + '" aria-label="Allowance of the ' + esc(s.name) + '">') + '</td>' +
        '<td>' + s.a_len + ' / ' + s.b_len + (hem ? '' : ' <span class="gm-badge ' + (s.match ? 'ok' : 'bad') + '">' + (s.diff_cm > 0 ? '+' : '') + s.diff_cm + (s.expected_diff_cm ? ' (' + (s.expected_diff_cm > 0 ? '+' : '') + s.expected_diff_cm + ' intended)' : '') + '</span>') + '</td><td>' + s.sewn_cm + ' cm</td><td>' + s.thread_m + ' m</td></tr>';
    }).join('') + '</tbody><tfoot><tr><td colspan="5">Thread, all seams</td><td>' + r1(sw.thread_m) + ' m</td></tr></tfoot>';
    $('gm-ops').innerHTML = sw.operations.map(function (p) { return '<li><b>' + esc(p.name) + '</b><span>' + esc(p.machine) + ' (' + p.type + ') · ' + p.length_cm + ' cm · ' + p.thread_m + ' m of thread</span></li>'; }).join('');
    $('gm-sam').textContent = sam ? sam.note + (sam.addons.length ? ' Estimated add-on: ' + sam.addons.map(function (a) { return a.name + ' ' + a.basic_min + ' min'; }).join(', ') + '.' : '') : '';
    $('gm-bom').innerHTML = '<thead><tr><th>Item</th><th>Quantity</th><th>Note</th></tr></thead><tbody>' + R.bom.map(function (b) { return '<tr><td>' + esc(b.item) + '</td><td>' + b.qty + ' ' + esc(b.unit) + '</td><td style="text-align:left">' + esc(b.note) + '</td></tr>'; }).join('') + '</tbody>';
  }
  function bindSewing() {
    $('gm-seams').addEventListener('change', function (e) {
      var t = e.target, id = t.getAttribute('data-seam'), k = t.getAttribute('data-k'); if (!id) return;
      S.seams = S.seams || {}; (S.seams[id] = S.seams[id] || {})[k] = k === 'allowance' ? (t.value === '' ? '' : +t.value) : t.value; schedule();
    });
  }

  // ── the zipper ──
  function renderZipper() {
    var z = S.zipper;
    $('gm-zon').checked = !!z.on; $('gm-zbody').hidden = !z.on;
    $('gm-zkind').value = z.kind; $('gm-ztype').value = z.type; $('gm-zlen').value = z.length_cm; $('gm-zteeth').value = z.teeth; $('gm-zsize').value = z.size; $('gm-ztape').value = z.tape_w; $('gm-zallow').value = z.allow; $('gm-zface').value = z.facing_w;
    $('gm-zlenf').hidden = z.kind !== 'partial';
  }
  function bindZipper() {
    renderZipper();
    var map = { 'gm-zkind': 'kind', 'gm-ztype': 'type', 'gm-zlen': 'length_cm', 'gm-zteeth': 'teeth', 'gm-zsize': 'size', 'gm-ztape': 'tape_w', 'gm-zallow': 'allow', 'gm-zface': 'facing_w' };
    $('gm-zon').addEventListener('change', function () { S.zipper.on = this.checked; if (S.zipper.on && S.zipper.kind === 'partial' && S.zipper.type === 'open_end') S.zipper.type = 'closed_end'; renderZipper(); schedule(); });
    Object.keys(map).forEach(function (id) {
      $(id).addEventListener(id === 'gm-zkind' || id === 'gm-ztype' || id === 'gm-zteeth' ? 'change' : 'input', function () {
        S.zipper[map[id]] = this.value;
        if (id === 'gm-zkind') { S.zipper.type = this.value === 'partial' ? 'closed_end' : 'open_end'; renderZipper(); }
        schedule();
      });
    });
  }
  function renderZipperInfo() {
    var o = R && R.success ? sizeOf(S.size) || R.by_size[0] : null, z = o && o.zipper, box = $('gm-zinfo');
    if (!box) return;
    box.textContent = z && z.on ? 'Size ' + o.size + ': ' + z.opening_cm + ' cm of opening from the neck seam → buy a ' + z.standard_cm + ' cm zipper' + (z.trim_cm > 0.4 ? ' and trim ' + z.trim_cm + ' cm' : '') + '. ' + (z.kind === 'full' ? 'The front is cut in two halves, each with ' + z.allow + ' cm at the centre front, and two ' + z.facing_w + ' cm facings.' : 'The front keeps its width; a ' + r1(z.facing_w * 2) + ' cm placket goes over the slit.') : (S.zipper.on ? 'The zipper is left out of this size (see the Checks).' : '');
  }

  // ── marker ──
  function renderMarker() {
    var el = $('gm-marker');
    if (!R || !R.success) { el.innerHTML = '<div class="gm-empty">' + (R && !R.success ? esc(R.error) : 'Building the marker…') + '</div>'; $('gm-mlegend').innerHTML = ''; return; }
    el.innerHTML = markerSvg(false);
    var c = R.consumption;
    $('gm-mlegend').innerHTML = R.sizes.map(function (s, i) { return R.ratio[s] ? '<span><i style="border-color:' + SIZE_COL[i % SIZE_COL.length] + '"></i>' + esc(s) + ' × ' + R.ratio[s] + '</span>' : ''; }).join('') +
      '<span>' + c.marker_width_cm + ' cm wide, ' + c.marker_length_cm + ' cm long (grain →) · piece area ' + r1(c.net_area_per_garment_cm2 * c.garments_in_marker / 10000) + ' m² of ' + r1(c.marker_length_cm * c.marker_width_cm / 10000) + ' m² · wastage ' + c.wastage_pct + ' % · neck band ' + c.rib_area_per_garment_cm2 + ' cm² of rib a garment</span>';
  }
  function markerSvg(oneToOne) {
    var mk = R.marker, L = mk.length_cm, W = mk.width_cm, g = '';
    // drawn with the length along the page (grain to the right), the way a marker is read
    var T = function (p) { return [r2(p[1]), r2(p[0])]; };
    g += '<rect x="0" y="0" width="' + L + '" height="' + W + '" fill="#f4f1ea" stroke="#9a9488" stroke-width="0.4"/>';
    for (var k = 50; k < L; k += 50) g += '<line x1="' + k + '" y1="0" x2="' + k + '" y2="' + W + '" stroke="#d6d1c6" stroke-width="0.2"/><text x="' + k + '" y="' + (W + 6) + '" text-anchor="middle" font-size="4" fill="#777">' + k + '</text>';
    mk.pieces.forEach(function (p) {
      var i = R.sizes.indexOf(p.size), col = SIZE_COL[(i < 0 ? 0 : i) % SIZE_COL.length], pts = p.poly.map(T), cx = 0, cy = 0;
      pts.forEach(function (q) { cx += q[0]; cy += q[1]; }); cx /= pts.length; cy /= pts.length;
      g += '<path d="' + pathOf(pts) + 'Z" fill="' + col + '" fill-opacity=".2" stroke="' + col + '" stroke-width="0.4" stroke-linejoin="round"/>';
      g += '<text x="' + r2(cx) + '" y="' + r2(cy) + '" text-anchor="middle" font-size="4.2" font-weight="700" fill="' + col + '">' + esc(p.name.replace(/^(\S+) (\S+)/, function (m0, a, b) { return a + ' ' + (b === 'Front' ? 'F' : b === 'Back' ? 'B' : 'S'); })) + '</text>';
    });
    g += '<path d="M6 ' + (W + 14) + 'h40l-3 -1.8m3 1.8l-3 1.8" stroke="#555" stroke-width="0.5" fill="none"/><text x="50" y="' + (W + 15.5) + '" font-size="4" fill="#555">grain</text>';
    var size = oneToOne ? ' width="' + (L / 100) + 'm" height="' + ((W + 20) / 100) + 'm"' : '';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ' + (L + 4) + ' ' + (W + 22) + '"' + size + ' font-family="Public Sans, Arial, sans-serif" role="img" aria-label="Marker">' + g + '</svg>';
  }

  // ── checks ──
  function renderChecks() {
    var cs = R && R.checks ? R.checks : [], el = $('gm-checks');
    var order = { error: 0, warn: 1, ok: 2, note: 3 };
    cs = cs.slice().sort(function (a, b) { return order[a.level] - order[b.level]; });
    el.innerHTML = cs.length ? cs.map(function (c) { return '<li class="' + c.level + '">' + esc(c.text) + '</li>'; }).join('') : '<li class="note">Nothing to report yet.</li>';
    $('gm-basis').innerHTML = (R && R.basis || []).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('');
    var n = cs.filter(function (c) { return c.level === 'error' || c.level === 'warn'; }).length, b = $('gm-nchecks');
    b.hidden = !n; b.textContent = n; b.className = 'gm-n' + (cs.some(function (c) { return c.level === 'error'; }) ? ' bad' : '');
  }

  // ── the garment ──
  function ensure3D() {
    if (mod3d) return Promise.resolve(mod3d);
    return import('/assets/js/garment-3d.js?v=20261203a').then(function (m) { mod3d = m; return m; });
  }
  function render3D() {
    if (!view3d || !R || !R.success) return;
    var o = sizeOf(S.size) || R.by_size[0];
    try { if (R.style === 'shorts') { view3d.setShorts(o, R.fabric); $('gm-3dnote').textContent = 'Size ' + o.size + ' · seat ' + o.m.seat_w + ' · outside leg ' + o.m.outseam + ' · rise ' + o.m.front_rise + ' cm (flat, finished)'; } else { view3d.setGarment(o, R.fabric); $('gm-3dnote').textContent = 'Size ' + o.size + ' · chest ' + o.m.chest + ' · length ' + o.m.length + ' · sleeve ' + o.m.sleeve_l + ' cm (flat, finished)'; } } catch (e) { if (window.console) console.error(e); $('gm-3dnote').textContent = 'The garment could not be drawn from this chart.'; }
  }
  function makeGarment(o) {
    o = o && o.quiet !== undefined ? o : {};
    if (!o.quiet) tab('garment');
    if (!R || !R.success) { $('gm-3dwait').textContent = (R && R.error) || 'Fill in the chart first.'; return; }
    $('gm-3dwait').textContent = 'Making the garment…';
    ensure3D().then(function (m) {
      if (!view3d) { $('gm-3dwait').hidden = true; view3d = new m.GarmentView($('gm-3d')); view3d.setColour(S.fabric.colour); view3d.onSpin = function (on) { $('gm-spin').classList.toggle('primary', on); }; }
      render3D(); if (o.spin !== false) { view3d.setSpin(true); $('gm-spin').classList.add('primary'); }
    }).catch(function (e) { if (window.console) console.error(e); $('gm-3dwait').textContent = 'The 3D view needs WebGL, which this browser does not have.'; });
  }

  // ── tabs, downloads ──
  function tab(t) {
    S.tab = t; save();
    if (window.KAGarmentStudio) { window.KAGarmentStudio.show(t); return; }
    Array.prototype.forEach.call(document.querySelectorAll('#gm-tabs button'), function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === t); });
    Array.prototype.forEach.call(document.querySelectorAll('.gm-pane'), function (p) { p.classList.toggle('on', p.id === 'pane-' + t); });
    if (t === 'garment' && view3d) setTimeout(function () { view3d.resize(); }, 30);
    if (t === 'edit' && window.KAGarmentEdit) setTimeout(function () { window.KAGarmentEdit.fit(); }, 30);
  }
  function download(name, text, type) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'image/svg+xml' })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function slug() { return (S.fabric.name || 'tee').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'tee'; }

  // ── the Studio's fabric ──
  function fromStudio() {
    var f; try { f = JSON.parse(localStorage.getItem(FROM) || 'null'); } catch (_) { f = null; }
    var b = $('gm-fromstudio'); if (!f) return;
    b.hidden = false; $('gm-fromnote').textContent = 'From the Studio: ' + (f.name || 'your design') + ', ' + f.gsm + ' GSM.';
    b.addEventListener('click', function () {
      var F = S.fabric; F.name = f.name || F.name; if (f.gsm) F.gsm = f.gsm; if (f.width_cm) { F.width = r1(F.wunit === 'in' ? f.width_cm / INCH : f.width_cm); }
      if (f.shrink_len_pct != null) F.shrink_len_pct = f.shrink_len_pct; if (f.shrink_wid_pct != null) F.shrink_wid_pct = f.shrink_wid_pct;
      if (f.wpc) F.wpc = f.wpc; if (f.cpc) F.cpc = f.cpc; if (f.colour) F.colour = f.colour;
      renderFabric(); if (view3d) view3d.setColour(F.colour); schedule();
    });
    if (/[?&]fabric=studio/.test(location.search)) b.click();
  }

  function init() {
    api('/api/garment/template?sizes=S,M,L,XL&unit=cm').then(function (t) {
      POMS_BY.tee = t; POMS = t.poms; POMS.forEach(function (p) { poms[p.key] = p; });
      S = load() || defaults(t); if (!S.style) S.style = 'tee';
      return (S.style === 'shorts' ? ensureStyle('shorts') : Promise.resolve()).then(function () { return t; });
    }).then(function (t) {
      setPoms(S.style || 'tee');
      var D0 = defaults(t); ['edits', 'seams', 'cornerFlags', 'zipper', 'trims', 'tol'].forEach(function (k) { if (!S[k]) S[k] = D0[k]; });
      POMS.forEach(function (p) { if (!S.chart[p.key]) S.chart[p.key] = {}; });
      renderFabric(); renderChart(); bindFabric(); bindChart(); bindZipper(); bindSewing(); fromStudio();
      if (window.KAGarmentEdit) window.KAGarmentEdit.init({ state: function () { return S; }, result: function () { return R; }, size: function () { return S.size; }, change: schedule, save: save });
      if ($('gm-tabs')) $('gm-tabs').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) tab(b.getAttribute('data-tab')); });
      document.addEventListener('click', function (e) { var b = e.target.closest('.gm-chipb[data-size]'); if (b) { S.size = b.getAttribute('data-size'); renderSizes(); renderPatterns(); renderSewing(); renderZipperInfo(); render3D(); if (window.KAGarmentEdit) window.KAGarmentEdit.render(); save(); } });
      $('gm-make').addEventListener('click', makeGarment);
      $('gm-make2').addEventListener('click', makeGarment);
      $('gm-spin').addEventListener('click', function () { if (!view3d) return; var on = !view3d.spin; view3d.setSpin(on); this.classList.toggle('primary', on); });
      $('gm-snap').addEventListener('click', function () { if (!view3d) return; var a = document.createElement('a'); a.href = view3d.snapshot(); a.download = 'garment-' + slug() + '-' + S.size + '.png'; a.click(); });
      $('gm-dlpat').addEventListener('click', function () { var o = R && R.success && (sizeOf(S.size) || R.by_size[0]); if (o) download('patterns-' + slug() + '-' + o.size + '.svg', patternsSvg(o, true)); });
      $('gm-dlmk').addEventListener('click', function () { if (R && R.success) download('marker-' + slug() + '.svg', markerSvg(true)); });
      var top = document.querySelector('.hdr'); if (top) document.documentElement.style.setProperty('--gm-top', top.offsetHeight + 'px');
      if (!window.KAGarmentStudio) tab(S.tab || 'patterns');
      build();
    }).catch(function (e) { $('gm-patterns').innerHTML = '<div class="gm-empty">' + esc((e && e.message) || 'The garment engine could not be reached.') + '</div>'; });
  }
  window.KAGarment = { state: function () { return S; }, result: function () { return R; }, make: makeGarment, tab: tab, view: function () { return view3d; }, applySpec: applySpec, loadState: loadState, ensureStyle: ensureStyle, switchStyle: switchStyle, save: save, poms: function () { return POMS; }, schedule: schedule, seamOf: SEAM_OF, edgeColours: EDGE, sizeOf: sizeOf, patternsSvg: patternsSvg, markerSvg: markerSvg, download: download, slug: slug, renderChart: renderChart, renderFabric: renderFabric, renderZipper: renderZipper };
  init();
})();
