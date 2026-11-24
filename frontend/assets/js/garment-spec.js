/**
 * KnitAdvisor — Garment Studio: the spec sheet (garment.html)
 *
 * A buyer's spec sheet (Excel, PDF, a photo, a CSV, pasted text) is read on the server (engine/domain/garment-spec.js, services/spec-reader.js): the points of
 * measure with their tolerance and grade, the fabric, the stitching, the zipper, the trims. This file is the page for it:
 *   - the drop zone, a pasted screenshot, a pasted table;
 *   - the review window, where every row is put right BEFORE anything is used (what the row is, flat or round, the figures, the sizes, the unit),
 *     the details around the table (fabric, stitches, zipper, trims) are chosen, and the sheet itself is shown with the header row it was read from;
 *   - Apply: the chart, fabric, seams, zipper, trims and tolerances go into the garment page (KAGarment.applySpec);
 *   - the Spec check tab: the pattern against every measurement of the sheet, with the sheet's own tolerance;
 *   - presets: a spec kept under a name, and the starter charts.
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var r2 = function (v) { return Math.round(v * 100) / 100; };
  var INCH = 2.54;
  var API = (location.hostname === '127.0.0.1' || location.hostname === 'localhost') ? location.protocol + '//' + location.hostname + ':3001' : '';
  var CAT = null, M = null, presets = [], abort = null, lastFocus = null;
  var G = function () { return window.KAGarment; };
  var engineOf = function (sp) { return sp && sp.style && sp.style.engine === 'shorts' ? 'shorts' : 'tee'; };
  var drawnFor = function (key, sp) { var e = CAT && CAT.by[key]; return !!(e && e.engines && e.engines.indexOf(engineOf(sp)) >= 0); };
  var NEED = { tee: [['chest', 'chest'], ['length', 'length']], shorts: [['outseam', 'outside leg'], ['front_rise', 'front rise'], ['seat_w', 'seat width'], ['thigh', 'thigh'], ['leg_opening', 'leg opening']] };
  var api = function (url, o) { return window.apiFetch(url, o || {}); };

  // a number as a person types it: 21 1/2, 21-1/2, 21.5, 21,5
  function num(v) {
    if (v == null) return NaN;
    var s = String(v).trim().replace(/[½¼¾⅛]/g, function (c) { return { '½': ' 1/2', '¼': ' 1/4', '¾': ' 3/4', '⅛': ' 1/8' }[c]; }).replace(/,/g, '.');
    if (!s) return NaN;
    s = s.replace(/^(\d+)-(\d+\/\d+)$/, '$1 $2');
    var m = /^(-?\d+)\s+(\d+)\/(\d+)$/.exec(s); if (m) return (m[1][0] === '-' ? -1 : 1) * (Math.abs(+m[1]) + (+m[2]) / (+m[3]));
    m = /^(\d+)\/(\d+)$/.exec(s); if (m) return (+m[1]) / (+m[2]);
    var n = +s; return isFinite(n) ? n : NaN;
  }
  var fmt = function (v) { return v == null || !isFinite(v) ? '' : String(Math.round(v * 1000) / 1000); };
  var say = function (t, bad) { var n = $('gm-specnote'); if (n) { n.textContent = t; n.classList.toggle('bad', !!bad); } };

  function catalogue() {
    if (CAT) return Promise.resolve(CAT);
    return api('/api/garment/spec/catalogue').then(function (c) { CAT = c; CAT.by = {}; c.points.forEach(function (p) { CAT.by[p.key] = p; }); return c; });
  }

  // ── reading a file ──
  function shrink(file) {                                                       // a phone photo is scaled to a size the OCR reads well, and fits the upload
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || (file.size < 1400000 && !window.createImageBitmap)) return Promise.resolve(file);
    return (window.createImageBitmap ? createImageBitmap(file) : Promise.reject()).then(function (bm) {
      var k = Math.min(1, 2800 / Math.max(bm.width, bm.height));
      if (k >= 1 && file.size < 3000000) return file;
      var c = document.createElement('canvas'); c.width = Math.round(bm.width * k); c.height = Math.round(bm.height * k);
      c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height);
      return new Promise(function (res) { c.toBlob(function (b) { res(b || file); }, 'image/jpeg', 0.9); });
    }).catch(function () { return file; });
  }
  var pendingFile = null;
  function upload(file, opts) {
    if (!file) return;
    opts = opts || {}; pendingFile = file;
    if (file.size > 30 * 1024 * 1024) { say('That file is larger than 8 MB.', true); return; }
    var pic = /^image\//.test(file.type), t0 = Date.now();
    say(pic ? 'Reading the picture… this can take up to a minute.' : 'Reading ' + file.name + '…');
    $('gm-drop').classList.add('busy');
    if (abort) abort.abort(); abort = window.AbortController ? new AbortController() : null;
    shrink(file).then(function (blob) {
      if (blob.size > 8 * 1024 * 1024) throw new Error('That file is larger than 8 MB.');
      return fetch(API + '/api/garment/spec/read' + (opts.sheet != null ? '?sheet=' + opts.sheet : ''), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Accept': 'application/json', 'X-File-Name': encodeURIComponent(file.name || 'spec') }, body: blob, signal: abort ? abort.signal : undefined });
    }).then(function (res) { return res.json().then(function (d) { if (res.status === 401 && window.kaSignInRedirect) window.kaSignInRedirect(); if (!res.ok || !d.success) throw new Error(d.error || ('HTTP ' + res.status)); return d; }); })
      .then(function (d) { $('gm-drop').classList.remove('busy'); say('Read ' + (file.name || 'the sheet') + ' in ' + Math.round((Date.now() - t0) / 100) / 10 + ' s: check it, then apply it.'); return catalogue().then(function () { open(d.spec, d.rows, d.source, d.spec ? null : (d.extract_error || 'No table of measurements was found in this file.')); }); })
      .catch(function (e) { $('gm-drop').classList.remove('busy'); if (e && e.name === 'AbortError') return; say((e && e.message) || 'This file could not be read.', true); });
  }
  function fromText(text, note) {
    if (!String(text || '').trim()) { if (note) note.textContent = 'Paste the table first.'; return; }
    if (note) note.textContent = 'Reading…';
    api('/api/garment/spec/extract', { method: 'POST', body: { text: text } }).then(function (d) {
      if (note) note.textContent = ''; return catalogue().then(function () { open(d.spec, d.rows, { kind: 'text', name: 'Pasted sheet', method: 'text' }, null); });
    }).catch(function (e) {
      if (note) note.textContent = (e && e.message) || 'The sheet could not be read.';
      if (e && e.data && e.data.rows) catalogue().then(function () { open(null, e.data.rows, { kind: 'text', name: 'Pasted sheet', method: 'text' }, e.message); });
    });
  }

  // ── the review window ──
  function open(spec, rows, source, error) {
    M = { file: source && source.kind !== 'text' ? pendingFile : null, spec: spec ? JSON.parse(JSON.stringify(spec)) : null, rows: rows || [], source: source || {}, tab: spec ? 'poms' : 'sheet', error: error || null, grade: { sizes: 'S,M,L,XL', base: 'M' }, rowsKind: source && source.kind };
    lastFocus = document.activeElement; $('gm-specmodal').hidden = false; document.body.classList.add('gm-lock');
    $('gm-specpn').hidden = true; $('gm-specpreset').hidden = false;
    render(); $('gm-specclose').focus();
  }
  function close() { $('gm-specmodal').hidden = true; document.body.classList.remove('gm-lock'); M = null; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  function render() {
    if (!M) return;
    var sp = M.spec, s = M.source;
    $('gm-spectitle').textContent = (s.name || 'Spec sheet');
    $('gm-specsrc').textContent = [({ xlsx: 'Excel workbook', csv: 'CSV / text', text: 'Pasted text', pdf: 'PDF', image: 'Picture' })[s.kind] || s.kind, s.method === 'ocr' ? 'read by OCR (' + Math.round((s.confidence || 0) * 100) + ' % sure: check every figure)' : null, s.pages ? s.pages + ' page(s)' : null, s.sheets && s.sheets.length > 1 ? 'sheet "' + s.sheets[s.sheet || 0] + '"' : null, sp ? 'unit: ' + (sp.unit === 'in' ? 'inches' : 'cm') + ' (' + sp.unit_how + ')' : null].filter(Boolean).join(' · ');
    Array.prototype.forEach.call(document.querySelectorAll('#gm-spectabs button'), function (b) { b.classList.toggle('on', b.getAttribute('data-st') === M.tab); b.disabled = !sp && b.getAttribute('data-st') !== 'sheet'; });
    $('gm-specbody').innerHTML = (M.error ? '<p class="gm-merr">' + esc(M.error) + (sp ? '' : ' Click the row that holds the sizes (S M L XL) in the sheet below, or try "Sizes run down the page".') + '</p>' : '') + (M.tab === 'poms' && sp ? pomsHtml() : M.tab === 'details' && sp ? detailsHtml() : sheetHtml());
    summary();
  }
  function summary() {
    var sp = M.spec, el = $('gm-specsum'), ap = $('gm-specapply'), pr = $('gm-specpreset');
    if (!sp) { el.textContent = 'Nothing read yet.'; ap.disabled = true; pr.disabled = true; return; }
    var on = sp.poms.filter(function (p) { return p.include && p.key; }), drawn = on.filter(function (p) { return drawnFor(p.key, sp); }).length;
    var has = function (k) { return sp.poms.some(function (p) { return p.include && p.key === k || (k === 'length' && p.include && (p.key === 'cb_length' || p.key === 'front_length' || p.key === 'back_length')); }); };
    var need = NEED[engineOf(sp)], lacking = need.filter(function (n) { return !has(n[0]); }).map(function (n) { return n[1]; });
    if (engineOf(sp) === 'shorts' && !has('waist') && !has('waist_stretched')) lacking.push('waist');
    el.innerHTML = '<b>' + on.length + '</b> measurements used · <b>' + drawn + '</b> drawn in the pattern · <b>' + (on.length - drawn) + '</b> kept for the spec check · <b>' + esc(sp.style.name) + '</b>' + (lacking.length ? ' · <span class="bad">needed: ' + esc(lacking.join(', ')) + '</span>' : '');
    ap.disabled = lacking.length > 0; pr.disabled = ap.disabled;
  }

  function pointOptions(sel) {
    var groups = {}, order = [];
    CAT.points.forEach(function (p) { if (!groups[p.group]) { groups[p.group] = []; order.push(p.group); } groups[p.group].push(p); });
    return '<option value="">— not a point of measure —</option>' + order.map(function (g) { return '<optgroup label="' + esc(g) + '">' + groups[g].map(function (p) { return '<option value="' + p.key + '"' + (p.key === sel ? ' selected' : '') + '>' + esc(p.name) + (drawnFor(p.key, M.spec) ? '' : ' (kept, not drawn)') + '</option>'; }).join('') + '</optgroup>'; }).join('');
  }
  function pomsHtml() {
    var sp = M.spec, sizes = sp.sizes, h = '';
    h += '<div class="gm-mtool"><span class="gm-seg" id="gm-sunit"><button type="button" data-u="cm"' + (sp.unit === 'cm' ? ' class="on"' : '') + '>cm</button><button type="button" data-u="in"' + (sp.unit === 'in' ? ' class="on"' : '') + '>inch</button></span>' +
      (M.rowsKind === 'xlsx' || M.rowsKind === 'csv' || M.rowsKind === 'text' ? '<button type="button" class="gm-btn" id="gm-stranspose">Sizes run down the page</button>' : '') +
      '<label class="gm-sbase">Base size <select id="gm-sbase">' + sizes.map(function (z) { return '<option' + (z === (sp.base || '') ? ' selected' : '') + '>' + esc(z) + '</option>'; }).join('') + '</select></label></div>';
    if (!sp.single && sizes.length > 1) h += '<div class="gm-mtool gm-usesizes"><span class="gm-hint" style="margin:0">Build these sizes (up to 8 at once):</span>' + sizes.map(function (z) { var on = (sp.use_sizes || sizes).indexOf(z) >= 0; return '<button type="button" class="gm-chipu' + (on ? ' on' : '') + '" data-usz="' + esc(z) + '" aria-pressed="' + on + '">' + esc(z) + '</button>'; }).join('') + '</div>';
    if (sp.single) h += '<div class="gm-mgrade"><b>One column of measurements</b>: the sheet gives no sizes. Grade them to <input id="gm-gsz" value="' + esc(M.grade.sizes) + '" aria-label="Sizes"> from the base size <input id="gm-gbase" value="' + esc(M.grade.base) + '" size="4" aria-label="Base size">' + (sp.poms.some(function (p) { return p.grade && p.grade.step != null; }) ? ' using the sheet\'s grade column.' : '. The sheet has no grade column, so only the base size can be made.') + '</div>';
    (sp.notes || []).forEach(function (n) { h += '<p class="gm-mnote">' + esc(n) + '</p>'; });
    h += '<div class="gm-stwrap"><table class="gm-stab"><thead><tr><th>Use</th><th>Code</th><th>Name in the sheet</th><th>Point of measure</th><th>Taken as</th><th>Tol +</th><th>Tol −</th>' +
      sizes.map(function (z) { return '<th><input class="gm-szin" data-size="' + esc(z) + '" value="' + esc(z) + '" aria-label="Size name" size="4"></th>'; }).join('') + '<th>Grade</th></tr></thead><tbody>';
    var grp = '';
    sp.poms.forEach(function (p, i) {
      var e = p.key ? CAT.by[p.key] : null;
      if ((p.group || '') !== grp) { grp = p.group || ''; if (grp) h += '<tr class="gm-sgrp"><td colspan="' + (8 + sizes.length) + '">' + esc(grp) + '</td></tr>'; }
      var flags = (p.check ? '<span class="gm-flag ed" title="The picture was hard to read here">check</span>' : '') + (p.dup ? '<span class="gm-flag man" title="Another row already gives this measurement">repeat</span>' : '') + (p.basis_auto && p.include ? '<span class="gm-flag man" title="Decided from the size of the figure: check it">round/flat?</span>' : '');
      h += '<tr data-i="' + i + '" class="' + (!p.key ? 'un' : !p.include ? 'off' : '') + '"><td><input type="checkbox" class="gm-suse"' + (p.include ? ' checked' : '') + (p.key ? '' : ' disabled') + ' aria-label="Use this row"></td><td>' + esc(p.code || '') + '</td>' +
        '<td class="gm-sname" title="' + esc(p.remark || '') + '">' + esc(p.label) + flags + '</td>' +
        '<td><select class="gm-skey" aria-label="Point of measure">' + pointOptions(p.key) + '</select></td>' +
        '<td>' + (e && e.halves ? '<select class="gm-sbasis" aria-label="Taken as"><option value="flat"' + (p.basis === 'flat' ? ' selected' : '') + '>flat width</option><option value="full"' + (p.basis === 'full' ? ' selected' : '') + '>round (halved)</option></select>' : '<span class="gm-dim">—</span>') + '</td>' +
        '<td><input class="gm-stol' + (p.tol && !p.tol.given ? ' gm-assumed' : '') + '" data-k="plus" value="' + esc(p.tol ? fmt(p.tol.plus) : '') + '" inputmode="decimal" aria-label="Tolerance plus"' + (p.tol && !p.tol.given ? ' title="Not in the sheet: the usual tolerance is used"' : '') + '></td>' +
        '<td><input class="gm-stol' + (p.tol && !p.tol.given ? ' gm-assumed' : '') + '" data-k="minus" value="' + esc(p.tol ? fmt(p.tol.minus) : '') + '" inputmode="decimal" aria-label="Tolerance minus"></td>' +
        sizes.map(function (z) { var v = p.values[z]; return '<td><input class="gm-sval" data-size="' + esc(z) + '" value="' + esc(v == null ? '' : fmt(v)) + '" inputmode="decimal" aria-label="' + esc(p.label) + ' ' + esc(z) + '"></td>'; }).join('') +
        '<td class="gm-sgr' + (p.grade && !p.grade.regular ? ' odd' : '') + '" title="' + esc(p.grade && p.grade.steps.length ? 'step between sizes: ' + p.grade.steps.join(', ') : '') + '">' + (p.grade && p.grade.step != null ? (p.grade.step > 0 ? '+' : '') + fmt(p.grade.step) : '') + (p.grade && !p.grade.regular ? ' !' : '') + '</td></tr>';
    });
    h += '</tbody></table></div><p class="gm-hint">Measurements marked <b>kept, not drawn</b> are not part of a basic tee: they are kept with the spec and checked against the pattern where the pattern can measure them (across back, armhole curve, centre-back length, sleeve from the centre back). A tolerance the sheet does not give is the usual one, shown in grey. Change anything that was read wrongly: nothing is used until you press Apply.</p>';
    return h;
  }

  function detailsHtml() {
    var sp = M.spec, h = '';
    var chips = function (a) { return a.map(function (x) { return '<span class="gm-chip' + (x.drawn === true ? ' ok' : x.drawn ? ' mid' : '') + '">' + esc(x.name) + (x.drawn === true ? ' · drawn' : x.drawn ? ' · ' + esc(x.drawn) : ' · not drawn yet') + '</span>'; }).join(''); };
    h += '<div class="gm-dsec"><div class="gm-ik">The garment</div><p class="gm-dline"><b>' + esc(sp.style.name) + '</b>' + (sp.style.drawn ? '' : ' <span class="gm-chip">the engine draws a crew-neck tee</span>') + '</p>' +
      (Object.keys(sp.meta || {}).length ? '<dl class="gm-meta">' + Object.keys(sp.meta).filter(function (k) { return k !== 'unit_text'; }).map(function (k) { return '<dt>' + esc(k.replace(/_/g, ' ')) + '</dt><dd>' + esc(sp.meta[k]) + '</dd>'; }).join('') + '</dl>' : '') +
      '<div class="gm-ik" style="margin-top:8px">Parts the sheet names</div><div>' + (sp.parts.length ? chips(sp.parts) : '<span class="gm-dim">none named</span>') + '</div></div>';
    var F = sp.fabric || {}, fr = [['composition', 'Composition', 'text', 0], ['construction', 'Construction', 'text', 0], ['gsm', 'GSM', 'number', 1], ['width_cm', 'Cutting width (cm)', 'number', 1], ['shrink_len_pct', 'Shrinkage along (%)', 'number', 1], ['shrink_wid_pct', 'Shrinkage across (%)', 'number', 1], ['yarn_count', 'Yarn count', 'text', 0], ['spi', 'Stitches per inch', 'number', 0]];
    h += '<div class="gm-dsec"><div class="gm-ik">Fabric</div>' + (fr.some(function (f) { return F[f[0]]; }) ? '<table class="gm-dtab">' + fr.filter(function (f) { return F[f[0]]; }).map(function (f) { var x = F[f[0]]; return '<tr data-fab="' + f[0] + '"><td>' + (f[3] ? '<input type="checkbox" class="gm-fuse"' + (x.use !== false ? ' checked' : '') + ' aria-label="Use">' : '') + '</td><td>' + f[1] + '</td><td><input class="gm-fval" value="' + esc(x.value) + '"' + (f[2] === 'number' ? ' inputmode="decimal"' : '') + '></td><td class="gm-src" title="' + esc(x.src) + '">' + esc(x.src) + '</td></tr>'; }).join('') + '</table>' : '<p class="gm-dim">No fabric details found.</p>') + '<p class="gm-hint">The ticked ones go into the Fabric card. Shrinkage figures are read as shrinkage (a "-5 %" is a cloth that shrinks 5 %); the order length / width is taken from the words next to them, else the first figure is the length.</p></div>';
    var sm = Object.keys(sp.seams || {});
    h += '<div class="gm-dsec"><div class="gm-ik">Stitching</div>' + (sm.length ? '<table class="gm-dtab">' + sm.map(function (id) { var x = sp.seams[id]; return '<tr data-seam="' + id + '"><td><input type="checkbox" class="gm-suse2"' + (x.use !== false ? ' checked' : '') + ' aria-label="Use"></td><td>' + esc(CAT.seams[id] || id) + '</td><td><select class="gm-sstitch">' + Object.keys(CAT.stitches).map(function (k) { return '<option value="' + k + '"' + (k === x.type ? ' selected' : '') + '>' + esc(CAT.stitches[k]) + '</option>'; }).join('') + '</select></td><td class="gm-src" title="' + esc(x.src) + '">' + esc(x.src) + (x.conf < 0.5 ? ' <span class="gm-flag ed">"overlock" alone: 4-thread assumed</span>' : '') + '</td></tr>'; }).join('') + '</table>' : '<p class="gm-dim">No seam with a stitch type found.</p>') + '</div>';
    var z = sp.zipper;
    h += '<div class="gm-dsec"><div class="gm-ik">Zipper</div>' + (z ? '<table class="gm-dtab"><tr><td><input type="checkbox" id="gm-zuse"' + (z.use !== false ? ' checked' : '') + ' aria-label="Use"></td><td>Where</td><td><select id="gm-zk"><option value="full"' + (z.kind !== 'partial' ? ' selected' : '') + '>Front opening (the front is cut in two)</option><option value="partial"' + (z.kind === 'partial' ? ' selected' : '') + '>Quarter zip (slit and placket)</option></select></td><td class="gm-src">' + esc(z.src) + '</td></tr>' +
      '<tr><td></td><td>Length (cm)</td><td><input id="gm-zl" value="' + esc(z.length_cm || '') + '" inputmode="decimal"></td><td class="gm-src">' + [z.type && z.type.replace('_', '-'), z.teeth, z.size && '#' + z.size, z.brand].filter(Boolean).join(' · ') + '</td></tr></table>' : '<p class="gm-dim">No zipper in this sheet.</p>') + '</div>';
    var tr = (sp.trims || []).map(function (t) { return ['trims', t]; }).concat((sp.packing || []).map(function (t) { return ['packing', t]; }));
    h += '<div class="gm-dsec"><div class="gm-ik">Trims, labels and packing</div>' + (tr.length ? '<table class="gm-dtab">' + tr.map(function (q, i) { var t = q[1]; return '<tr data-tr="' + q[0] + ':' + (q[0] === 'trims' ? sp.trims.indexOf(t) : sp.packing.indexOf(t)) + '"><td><input type="checkbox" class="gm-truse"' + (t.use !== false ? ' checked' : '') + ' aria-label="Use"></td><td><input class="gm-trname" value="' + esc(t.item) + '"></td><td><input class="gm-trqty" value="' + esc(t.qty) + '" size="3" inputmode="numeric" aria-label="Quantity"></td><td class="gm-src">' + esc(q[0] === 'packing' ? 'packing' : t.kind) + '</td></tr>'; }).join('') + '</table><p class="gm-hint">These go into the bill of materials of the Sewing tab.</p>' : '<p class="gm-dim">No labels, trims or packing found.</p>') + '</div>';
    if ((sp.construction || []).length || (sp.care || []).length) h += '<div class="gm-dsec"><div class="gm-ik">Construction notes and care (kept with the spec)</div><ul class="gm-nl">' + sp.construction.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + sp.care.map(function (t) { return '<li class="care">' + esc(t) + '</li>'; }).join('') + '</ul></div>';
    return h;
  }

  function sheetHtml() {
    var rowsOf = {}, heads = {};
    if (M.spec) { M.spec.poms.forEach(function (p) { rowsOf[p.row] = p.include ? 'pom' : 'off'; }); (M.spec.tables || []).forEach(function (t) { heads[t.header] = 1; }); }
    var h = '<div class="gm-mtool"><span class="gm-hint" style="margin:0">Green rows are the measurements read; the amber row holds the sizes. If the sizes are on another row, click its number.</span>' +
      (M.rowsKind === 'xlsx' || M.rowsKind === 'csv' || M.rowsKind === 'text' ? '<button type="button" class="gm-btn" id="gm-stranspose">Sizes run down the page</button>' : '') + '</div>';
    if (M.source.sheets && M.source.sheets.length > 1) h += '<div class="gm-mtool">Sheet: ' + M.source.sheets.map(function (n, i) { return '<button type="button" class="gm-btn gm-sheetbtn' + (i === (M.source.sheet || 0) ? ' primary' : '') + '" data-sheet="' + i + '">' + esc(n) + '</button>'; }).join('') + '</div>';
    h += '<div class="gm-stwrap"><table class="gm-raw"><tbody>' + M.rows.slice(0, 400).map(function (r, i) {
      return '<tr class="' + (heads[i] ? 'hd ' : '') + (rowsOf[i] || '') + '"><th><button type="button" class="gm-rowbtn" data-row="' + i + '" title="Use this row as the header (the sizes)">' + (i + 1) + '</button></th>' + r.map(function (c) { return '<td class="' + (c[3] != null && c[3] < 0.7 ? 'low' : '') + '">' + esc(c[0]) + '</td>'; }).join('') + '</tr>';
    }).join('') + '</tbody></table></div>';
    return h;
  }

  function reextract(extra) {
    var b = { rows: M.rows, unit: M.spec ? M.spec.unit : undefined };
    Object.keys(extra || {}).forEach(function (k) { b[k] = extra[k]; });
    $('gm-specbody').classList.add('busy');
    return api('/api/garment/spec/extract', { method: 'POST', body: b }).then(function (d) {
      M.spec = d.spec; M.rows = d.rows; M.error = null; M.tab = 'poms'; if (extra && extra.transpose) M.rowsKind = 'text';
    }).catch(function (e) { M.error = (e && e.message) || 'The sheet could not be read that way.'; if (e && e.data && e.data.rows) M.rows = e.data.rows; if (!M.spec) M.tab = 'sheet'; }).then(function () { $('gm-specbody').classList.remove('busy'); render(); });
  }

  // ── editing in the review window ──
  function onBody(e) {
    if (!M || !M.spec) return;
    var t = e.target, sp = M.spec, tr = t.closest('tr[data-i]'), p = tr ? sp.poms[+tr.getAttribute('data-i')] : null, ev = e.type;
    if (t.classList.contains('gm-suse') && p) { p.include = t.checked && !!p.key; if (ev === 'change') { tr.className = !p.key ? 'un' : !p.include ? 'off' : ''; summary(); } return; }
    if (t.classList.contains('gm-skey') && p && ev === 'change') { p.key = t.value || null; p.include = !!p.key; p.drawn = !!(p.key && drawnFor(p.key, M.spec)); if (p.key && !CAT.by[p.key].halves) p.basis = 'flat'; p.basis_auto = false; render(); return; }
    if (t.classList.contains('gm-sbasis') && p && ev === 'change') { p.basis = t.value; p.basis_auto = false; render(); return; }
    if (t.classList.contains('gm-stol') && p && ev === 'change') { var v = num(t.value); if (!p.tol) p.tol = { plus: null, minus: null, given: true }; p.tol[t.getAttribute('data-k')] = isFinite(v) ? Math.abs(v) : null; p.tol.given = true; if (p.tol.minus == null) p.tol.minus = p.tol.plus; if (p.tol.plus == null) p.tol.plus = p.tol.minus; t.classList.remove('gm-assumed'); return; }
    if (t.classList.contains('gm-sval') && p && ev === 'change') { var z = t.getAttribute('data-size'), n = num(t.value); if (t.value.trim() === '') delete p.values[z]; else if (isFinite(n)) p.values[z] = n; t.classList.toggle('bad', t.value.trim() !== '' && !isFinite(n)); return; }
    if (t.classList.contains('gm-szin') && ev === 'change') {
      var old = t.getAttribute('data-size'), nu = String(t.value || '').trim().toUpperCase().replace(/\s+/g, ''); if (!nu || nu === old || sp.sizes.indexOf(nu) >= 0) { t.value = old; return; }
      sp.sizes[sp.sizes.indexOf(old)] = nu; if (sp.base === old) sp.base = nu; sp.poms.forEach(function (q) { if (q.values[old] != null) { q.values[nu] = q.values[old]; delete q.values[old]; } }); render(); return;
    }
    if (t.id === 'gm-sbase' && ev === 'change') { sp.base = t.value; return; }
    if (t.id === 'gm-gsz' || t.id === 'gm-gbase') { M.grade.sizes = ($('gm-gsz') || {}).value || M.grade.sizes; M.grade.base = (($('gm-gbase') || {}).value || M.grade.base).toUpperCase(); return; }
    // details
    var f = t.closest('tr[data-fab]'); if (f) { var x = sp.fabric[f.getAttribute('data-fab')]; if (t.classList.contains('gm-fuse')) x.use = t.checked; else if (t.classList.contains('gm-fval')) { var raw = t.value, nn = num(raw); x.value = ['gsm', 'width_cm', 'shrink_len_pct', 'shrink_wid_pct', 'spi'].indexOf(f.getAttribute('data-fab')) >= 0 && isFinite(nn) ? nn : raw; } return; }
    var sm = t.closest('tr[data-seam]'); if (sm) { var y = sp.seams[sm.getAttribute('data-seam')]; if (t.classList.contains('gm-suse2')) y.use = t.checked; else if (t.classList.contains('gm-sstitch')) y.type = t.value; return; }
    var tt = t.closest('tr[data-tr]'); if (tt) { var pr = tt.getAttribute('data-tr').split(':'), it = sp[pr[0]][+pr[1]]; if (!it) return; if (t.classList.contains('gm-truse')) it.use = t.checked; else if (t.classList.contains('gm-trname')) it.item = t.value; else if (t.classList.contains('gm-trqty')) { var q = parseInt(t.value, 10); it.qty = q > 0 ? q : 1; } return; }
    if (sp.zipper) { if (t.id === 'gm-zuse') sp.zipper.use = t.checked; else if (t.id === 'gm-zk') sp.zipper.kind = t.value; else if (t.id === 'gm-zl') { var l = num(t.value); sp.zipper.length_cm = isFinite(l) ? l : null; } }
  }
  function onClick(e) {
    if (!M) return; var t = e.target;
    var uz = t.closest('.gm-chipu'); if (uz && M.spec) { var z0 = uz.getAttribute('data-usz'), us = (M.spec.use_sizes || M.spec.sizes).slice(), ix = us.indexOf(z0); if (ix >= 0) { if (us.length > 1) us.splice(ix, 1); } else if (us.length < 8) us.push(z0); else { say('Up to 8 sizes at once: untick one first.', true); } M.spec.use_sizes = M.spec.sizes.filter(function (q) { return us.indexOf(q) >= 0; }); render(); return; }
    var u = t.closest('#gm-sunit button'); if (u && M.spec && u.getAttribute('data-u') !== M.spec.unit) { reextract({ unit: u.getAttribute('data-u') }); return; }
    if (t.closest('#gm-stranspose')) { reextract({ transpose: true }); return; }
    var rb = t.closest('.gm-rowbtn'); if (rb) { reextract({ header_row: +rb.getAttribute('data-row') }); return; }
    var sb = t.closest('.gm-sheetbtn'); if (sb && M.file) { var f0 = M.file; close(); upload(f0, { sheet: +sb.getAttribute('data-sheet') }); }
  }

  // ── apply ──
  function apply(savePreset) {
    if (!M || !M.spec) return;
    var sp = M.spec, body = { spec: sp }, btn = $('gm-specapply');
    if (sp.single) { var sizes = String(M.grade.sizes).split(/[,\s]+/).map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean).slice(0, 8), base = M.grade.base; if (sizes.indexOf(base) < 0) sizes.unshift(base); body.sizes = sizes; body.base = base; body.grade = true; }
    else { if (sp.use_sizes && sp.use_sizes.length) body.sizes = sp.use_sizes; if (sp.base && (!body.sizes || body.sizes.indexOf(sp.base) >= 0)) body.base = sp.base; }
    btn.disabled = true; btn.textContent = 'Applying…';
    api('/api/garment/spec/apply', { method: 'POST', body: body }).then(function (r) {
      G().applySpec(r.build, r.spec);
      var b = r.build, drawn = b.drawn.length, kept = b.recorded.length;
      say('Applied: ' + drawn + ' measurements drawn' + (kept ? ', ' + kept + ' kept for the spec check' : '') + (b.conversions.length ? '. Converted: ' + b.conversions.join('; ') : '') + '.');
      var name = savePreset && String($('gm-specpname').value || '').trim();
      close();
      if (name) return savePresetAs(name);
    }).catch(function (e) { say((e && e.message) || 'The spec could not be applied.', true); }).then(function () { btn.disabled = false; btn.textContent = 'Apply to my garment'; });
  }

  // ── the spec check tab ──
  function renderCheck() {
    var el = $('gm-speccheck'), badge = $('gm-nspec'); if (!el || !G()) return;
    var S = G().state(), R = G().result();
    if (!S || !S.spec) { el.innerHTML = '<div class="gm-empty">Upload a spec sheet and the pattern is checked against every measurement in it, with the sheet\'s own tolerances.</div>'; badge.hidden = true; return; }
    if (!R || !R.success) { el.innerHTML = '<div class="gm-empty">The pattern is not built yet.</div>'; return; }
    var c = R.spec_check; if (!c) { el.innerHTML = '<div class="gm-empty">Checking…</div>'; return; }
    var sp = S.spec, inch = sp.unit === 'in', d = function (v) { return r2(inch ? v / INCH : v); }, sizes = R.sizes, ul = inch ? 'in' : 'cm';
    badge.hidden = !c.off; badge.textContent = c.off; badge.className = 'gm-n bad';
    var h = '<div class="gm-summary">' + kpi('Checked', c.checked, 'figures, all sizes') + kpi('In tolerance', c.ok, '', 'ok') + kpi('Out of tolerance', c.off, c.off ? 'see the red cells' : 'none', c.off ? 'bad' : '') + kpi('Kept only', c.recorded, 'not drawn or measured') + '</div>';
    if (sp.style && sp.style.drawn === false) h += '<p class="gm-mnote">This sheet is for a ' + esc(sp.style.name.toLowerCase()) + '. The engine draws a crew-neck tee, so only the measurements a tee has are checked.</p>';
    h += '<div class="gm-stwrap"><table class="gm-stab gm-ctab"><thead><tr><th>Code</th><th>Measurement</th><th>Tol</th>' + sizes.map(function (z) { return '<th>' + esc(z) + '</th>'; }).join('') + '</tr></thead><tbody>';
    c.rows.forEach(function (r) {
      var any = sizes.map(function (z) { return r.sizes[z]; }).filter(Boolean)[0], tolTxt = any && any.limit ? (any.limit === 'min' ? 'at least' : 'at most') : any && any.tol_plus != null ? (any.tol_plus === any.tol_minus ? '±' + d(any.tol_plus) : '+' + d(any.tol_plus) + ' / −' + d(any.tol_minus)) : '';
      h += '<tr><td>' + esc(r.code) + '</td><td class="gm-sname" title="' + esc(r.note || '') + '">' + esc(r.label) + '<span class="gm-how ' + (r.how === 'recorded' ? 'rec' : '') + '">' + esc(r.how) + '</span>' + (r.tol_given ? '' : ' <span class="gm-dim" title="The sheet gives no tolerance: the usual one is used">(usual tol)</span>') + '</td><td class="gm-dim">' + tolTxt + '</td>' +
        sizes.map(function (z) {
          var x = r.sizes[z]; if (!x) return '<td class="gm-dim">—</td>';
          if (x.status === 'recorded') return '<td class="rec" title="Kept: the engine neither draws nor measures this">' + d(x.spec_cm) + '</td>';
          return '<td class="' + x.status + '" title="spec ' + d(x.spec_cm) + ' ' + ul + ', pattern ' + d(x.pattern_cm) + ' ' + ul + ', ' + (x.limit ? (x.limit === 'min' ? 'a minimum' : 'a maximum') : 'tolerance +' + d(x.tol_plus) + ' / −' + d(x.tol_minus)) + (x.assumed ? '. ' + x.assumed : '') + '"><b>' + (d(x.diff) > 0 ? '+' : '') + d(x.diff) + '</b><small>' + d(x.spec_cm) + '</small></td>';
        }).join('') + '</tr>';
    });
    h += '</tbody></table></div><p class="gm-hint">Each cell is the pattern minus the sheet (' + ul + '); the small figure is what the sheet asks. Red is outside the sheet\'s own tolerance. The sheet\'s figures are kept as they were read, so a change you made in the chart shows here. Cells in grey are kept with the spec and not measured on the pattern.</p>';
    if (c.grade_notes && c.grade_notes.length) h += '<div class="gm-dsec"><div class="gm-ik">Grading</div><ul class="gm-nl">' + c.grade_notes.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>';
    if (sp.parts && sp.parts.length) h += '<div class="gm-dsec"><div class="gm-ik">Parts the sheet names</div>' + sp.parts.map(function (x) { return '<span class="gm-chip' + (x.drawn === true ? ' ok' : x.drawn ? ' mid' : '') + '">' + esc(x.name) + (x.drawn === true ? ' · drawn' : x.drawn ? ' · ' + esc(x.drawn) : ' · not drawn yet') + '</span>'; }).join('') + '</div>';
    if (sp.meta && Object.keys(sp.meta).length) h += '<div class="gm-dsec"><div class="gm-ik">From the sheet</div><dl class="gm-meta">' + Object.keys(sp.meta).filter(function (k) { return k !== 'unit_text'; }).map(function (k) { return '<dt>' + esc(k.replace(/_/g, ' ')) + '</dt><dd>' + esc(sp.meta[k]) + '</dd>'; }).join('') + '</dl></div>';
    el.innerHTML = h;
  }
  function kpi(l, v, s, cls) { return '<div class="gm-kpi ' + (cls || '') + '"><div class="l">' + esc(l) + '</div><div class="v">' + v + '</div>' + (s ? '<div class="s">' + esc(s) + '</div>' : '') + '</div>'; }

  // ── presets ──
  function pick(S) { var o = {}; ['style', 'unit', 'sizes', 'base', 'chart', 'ratio', 'fabric', 'opt', 'seams', 'zipper', 'trims', 'tol', 'spec', 'edits', 'cornerFlags'].forEach(function (k) { if (S[k] !== undefined) o[k] = JSON.parse(JSON.stringify(S[k])); }); return o; }
  function loadPresets(keep) {
    return Promise.all([catalogue(), api('/api/garment/presets').catch(function () { return { presets: [] }; })]).then(function (r) {
      presets = r[1].presets || []; var sel = $('gm-preset'), cur = keep || sel.value;
      sel.innerHTML = '<option value="">Choose…</option>' + (CAT.starters.length ? '<optgroup label="Starters">' + CAT.starters.map(function (s) { return '<option value="s:' + esc(s.id) + '">' + esc(s.name) + '</option>'; }).join('') + '</optgroup>' : '') +
        (presets.length ? '<optgroup label="My presets">' + presets.map(function (p) { return '<option value="p:' + p.id + '">' + esc(p.name) + ' (' + p.sizes + ' sizes)</option>'; }).join('') + '</optgroup>' : '');
      sel.value = cur || ''; $('gm-presetdel').hidden = !/^p:/.test(sel.value);
    });
  }
  function savePresetAs(name) {
    var S = G().state(), note = $('gm-presetnote');
    return api('/api/garment/presets', { method: 'POST', body: { name: name, preset: pick(S) } }).then(function (r) { note.textContent = 'Saved the preset "' + name + '".'; return loadPresets('p:' + r.id); })
      .catch(function (e) { note.textContent = (e && e.message) || 'The preset could not be saved.'; });
  }

  function bind() {
    var drop = $('gm-drop'), file = $('gm-file');
    $('gm-pick').addEventListener('click', function (e) { e.stopPropagation(); file.click(); });
    drop.addEventListener('click', function () { file.click(); });
    drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
    file.addEventListener('change', function () { if (file.files[0]) upload(file.files[0]); file.value = ''; });
    ['dragenter', 'dragover'].forEach(function (n) { drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (n) { drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { var f = e.dataTransfer && e.dataTransfer.files[0]; if (f) upload(f); });
    document.addEventListener('paste', function (e) { if (M || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || '')) return; var items = (e.clipboardData && e.clipboardData.files) || []; if (items[0] && /^image\//.test(items[0].type)) { e.preventDefault(); upload(items[0]); } });
    var body = $('gm-specbody');
    body.addEventListener('change', onBody); body.addEventListener('input', onBody); body.addEventListener('click', onClick);
    $('gm-specclose').addEventListener('click', close);
    $('gm-specmodal').addEventListener('mousedown', function (e) { if (e.target === $('gm-specmodal')) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && M) close(); });
    $('gm-spectabs').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b || b.disabled || !M) return; M.tab = b.getAttribute('data-st'); render(); });
    $('gm-specapply').addEventListener('click', function () { apply(false); });
    $('gm-specpreset').addEventListener('click', function () { this.hidden = true; $('gm-specpn').hidden = false; $('gm-specpname').value = ((M.spec.meta && (M.spec.meta.style_no || M.spec.meta.name)) || M.source.name || '').toString().slice(0, 60); $('gm-specpname').focus(); });
    $('gm-specpgo').addEventListener('click', function () { if (String($('gm-specpname').value || '').trim()) apply(true); else $('gm-specpname').focus(); });
    // presets
    $('gm-preset').addEventListener('change', function () {
      var v = this.value; $('gm-presetdel').hidden = !/^p:/.test(v); if (!v) return;
      if (v[0] === 's') { var s = CAT.starters.filter(function (x) { return 's:' + x.id === v; })[0]; if (s) { G().loadState(s.state); $('gm-presetnote').textContent = s.note; } return; }
      api('/api/garment/presets/' + v.slice(2)).then(function (r) { G().loadState(r.preset); $('gm-presetnote').textContent = 'Loaded "' + r.name + '".'; }).catch(function (e) { $('gm-presetnote').textContent = (e && e.message) || 'The preset could not be loaded.'; });
    });
    $('gm-presetsave').addEventListener('click', function () { $('gm-presetname').hidden = false; var S = G().state(); $('gm-presetinput').value = (S.spec && S.spec.meta && (S.spec.meta.style_no || S.spec.meta.name)) || S.fabric.name || ''; $('gm-presetinput').focus(); });
    $('gm-presetcancel').addEventListener('click', function () { $('gm-presetname').hidden = true; });
    $('gm-presetgo').addEventListener('click', function () { var n = String($('gm-presetinput').value || '').trim(); if (!n) { $('gm-presetinput').focus(); return; } $('gm-presetname').hidden = true; savePresetAs(n); });
    $('gm-presetinput').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('gm-presetgo').click(); });
    var del = $('gm-presetdel'), armed = 0;
    del.addEventListener('click', function () {
      var v = $('gm-preset').value; if (!/^p:/.test(v)) return;
      if (!armed) { armed = setTimeout(function () { armed = 0; del.textContent = 'Delete'; }, 4000); del.textContent = 'Sure? Delete'; return; }
      clearTimeout(armed); armed = 0; del.textContent = 'Delete';
      api('/api/garment/presets/' + v.slice(2), { method: 'DELETE' }).then(function () { $('gm-presetnote').textContent = 'Deleted.'; $('gm-preset').value = ''; return loadPresets(''); }).catch(function (e) { $('gm-presetnote').textContent = (e && e.message) || 'Could not delete.'; });
    });
    loadPresets().catch(function () {});
  }

  window.KAGarmentSpec = { renderCheck: renderCheck, fromText: fromText, upload: upload, open: function (sp, rows, src, err) { return catalogue().then(function () { open(sp, rows, src, err); }); }, state: function () { return M; }, reload: loadPresets, num: num };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})();
