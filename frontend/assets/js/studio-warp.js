// KnitAdvisor · Fabric Studio — WARP knitting (tricot / raschel): guide bars,
// lapping notation, threading and yarns; the engine (warp-studio.js) answers
// runner, weight, width, production, checks and the fabric's character; the
// lapping is drawn on point paper. Plain script.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var BAR_COL = ['#1857C4', '#c2410c', '#0f9d76', '#7a4fc2', '#b8860b', '#0e7490', '#be185d', '#4d7c0f'];
  var HINT_LOOPS = 'Each tube is one warp end, coloured by its guide bar. Every loop is drawn through the loop below it on the same needle; the underlaps run across the technical back — the front bar’s outermost. Closed laps cross at the loop’s foot. Drag to turn, scroll to zoom.', HINT_CLOTH = 'The real view: the knit3d engine draws every end from the same lapping in real yarn, at the finished wales and courses. Drag to turn, scroll to zoom; Show back shows the underlaps.';
  function barCol(i) { return (W.bars[i] && W.bars[i].colour) || BAR_COL[i % 8]; }
  var W = { bars: [], templates: [], fibres: {}, machines: {}, last: null, seq: 0, timer: null };

  function fibreOpts(sel) { return Object.keys(W.fibres).map(function (k) { return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + esc(W.fibres[k]) + '</option>'; }).join(''); }
  var UNITS = [['denier', 'D'], ['dtex', 'dtex'], ['tex', 'tex'], ['ne', 'Ne'], ['nm', 'Nm'], ['mm', 'mm (mono Ø)']];

  function renderBars() {
    $('wp-bars').innerHTML = W.bars.map(function (b, i) {
      var y = b.yarn || {};
      return '<div class="wp-bar" data-i="' + i + '"><div class="wp-barhead"><i style="background:' + barCol(i) + '"></i><b>GB' + (i + 1) + '</b>' + (i === 0 ? ' <span>front</span>' : i === W.bars.length - 1 && i > 0 ? ' <span>back</span>' : '') +
        (W.bars.length > 1 ? '<button type="button" class="wp-del" data-del="' + i + '" title="Remove this bar">×</button>' : '') + '</div>' +
        '<div class="st-row">' +
        '<div class="st-f" style="grid-column:1/-1"><label>Lapping (chain notation)</label><input class="wp-not" data-k="notation" value="' + esc(b.notation) + '" placeholder="1-0/1-2//" spellcheck="false" autocomplete="off"></div>' +
        '<div class="st-f"><label>Threading</label><input data-k="threading" value="' + esc(b.threading || 'X') + '" placeholder="X = full set, X. = 1 in 1 out" spellcheck="false"></div>' +
        '<div class="st-f"><label>Count</label><input data-k="count" type="number" min="1" step="0.1" value="' + esc(y.count || '') + '"></div>' +
        '<div class="st-f"><label>Unit</label><select data-k="unit">' + UNITS.map(function (u) { return '<option value="' + u[0] + '"' + ((y.unit || 'denier') === u[0] ? ' selected' : '') + '>' + u[1] + '</option>'; }).join('') + '</select></div>' +
        '<div class="st-f"><label>Fibre</label><select data-k="fibre">' + fibreOpts(y.fibre || 'nylon_filament') + '</select></div>' +
        '<div class="st-f"><label>Filaments (F)</label><input data-k="filaments" type="number" min="1" step="1" value="' + esc(y.filaments || '') + '"></div>' +
        '<div class="st-f"><label>3D colour</label><input type="color" data-k="colour" value="' + esc(b.colour || barCol(i)) + '"></div>' +
        (y.fibre === 'elastane' ? '<div class="st-f"><label title="Relaxed elastane to knitted: warping draft × let-off draft">Total draft</label><input data-k="draft" type="number" min="1.2" max="4.5" step="0.1" value="' + esc(y.draft || 2.2) + '"></div><div class="st-f"><label title="Put in at warping: the elastane is wound on the beam stretched">Beam draft</label><input data-k="beam_draft" type="number" min="1" max="3" step="0.1" placeholder="1.7" value="' + esc(y.beam_draft || '') + '"></div>' : '') +
        '</div></div>';
    }).join('');
  }

  function payload() {
    var n = function (id) { var v = parseFloat($(id).value); return isFinite(v) && v > 0 ? v : null; };
    return {
      machine: { type: $('wp-mtype').value, gauge: n('wp-gauge'), width_in: n('wp-width'), speed_cpm: n('wp-speed'), efficiency: n('wp-eff'), cpc: n('wp-cpc'), notation_step: +$('wp-nstep').value, gap_mm: n('wp-gap') },
      bars: W.bars.map(function (b) { return { notation: b.notation, threading: b.threading, yarn: b.yarn }; }), target: { gsm: n('wp-gsm'), width_in: n('wp-fwidth'), order_m: n('wp-order') },
      beams: { flange_in: n('wp-bflange'), barrel_in: n('wp-bbarrel'), width_in: n('wp-bwidth'), full_kg: n('wp-bkg'), full_m: n('wp-bm'), full_bar: n('wp-bbar'), residue_pct: $('wp-bresidue').value === '' ? null : +$('wp-bresidue').value, waste_pct: $('wp-bwaste').value === '' ? null : +$('wp-bwaste').value },
    };
  }
  function schedule() { clearTimeout(W.timer); W.timer = setTimeout(analyse, 280); }
  function analyse() {
    var my = ++W.seq;
    $('wp-status').innerHTML = '<span style="color:var(--t3)">Checking…</span>';
    window.apiFetch('/api/studio/warp/analyse', { method: 'POST', body: payload() }).then(function (r) {
      if (my !== W.seq) return; W.last = r; render();
    }).catch(function (e) {
      if (my !== W.seq) return; W.last = null;
      $('wp-status').innerHTML = '<div class="st-err">' + esc((e.data && e.data.error) || e.message) + '</div>';
      $('wp-out').innerHTML = ''; drawLapping(null);
    });
  }

  var kpi = function (l, v, s) { return '<div class="st-kpi"><div class="l">' + esc(l) + '<span class="src e">estimated</span></div><div class="v">' + v + '</div><div class="s">' + s + '</div></div>'; };
  function render() {
    var r = W.last, M = r.machine, F = r.fabric;
    var errs = r.checks.filter(function (c) { return c.level === 'error'; }).length;
    $('wp-status').innerHTML = '<span class="st-badge ' + (errs ? 'bad' : 'ok') + '">' + (errs ? errs + ' error' + (errs > 1 ? 's' : '') + ' — will not knit as drawn' : 'Knittable') + '</span>' +
      '<div style="margin-top:6px;font-weight:600">' + esc(r.structure.name || 'A new warp structure') + '</div><div style="font-size:12px;color:var(--t2)">' + r.structure.bars + ' guide bar' + (r.structure.bars > 1 ? 's' : '') + ', ' + r.structure.repeat_courses + '-course repeat' + (r.structure.counter_lapped ? ', counter-lapped' : '') + ' · ' + esc(M.label) + '</div>';
    var h = '<ul class="st-checks">' + r.checks.map(function (c) { return '<li class="' + c.level + '">' + esc(c.text) + '</li>'; }).join('') + '</ul>';
    h += '<div class="st-kpis">' + kpi('Weight', F.gsm + ' GSM', 'finished') + kpi('Width', F.width_in + '"', 'finished, from ' + M.width_in + '" on the machine') + kpi('Wales × courses', F.wpc + ' × ' + F.cpc, 'per cm, finished') +
      kpi('Quality', M.cpc_machine + ' courses/cm', 'on the machine — ' + esc(M.cpc_source)) + kpi('Production', M.finished_m_per_hour + ' m/h', M.kg_per_hour + ' kg/h at ' + M.speed_cpm + ' courses/min, ' + M.efficiency_pct + '%') +
      (F.spacer ? kpi('Thickness', F.spacer.thickness_mm + ' mm', 'bed gap ' + F.spacer.gap_mm + ' mm; ' + F.spacer.spacer_yarns_per_cm2 + ' spacer yarns/cm² at ' + F.spacer.angle_deg + '°') : '') + '</div>';
    h += '<div class="st-sub">Guide bars</div><div class="st-scroll"><table class="st-t"><tr><th>Bar</th><th>Lapping</th><th>What it knits</th><th>Threading</th><th>Yarn</th><th>Yarn / course</th><th>Runner (mm/rack)</th><th>Ends</th><th>Share</th><th>kg per 1,000 m</th></tr>' +
      r.bars.map(function (b) {
        return '<tr><td><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + barCol(b.bar - 1) + '"></i> GB' + b.bar + (r.structure.beds === 2 ? '<br><small>' + esc(b.bed) + '</small>' : '') + '</td><td style="font-family:var(--mono)">' + esc(b.notation) + '</td><td>' + esc(b.kind) + '<br><small>' + b.laps.map(function (l) { return l.lap; }).filter(function (v, k, a) { return a.indexOf(v) === k; }).join(' / ') + ' lap</small></td><td>' + esc(b.threading) + ' (' + b.threaded_pct + '%)</td><td>' + esc(b.yarn) + ' ' + esc(b.fibre) + (b.draft ? '<br><small>draft ' + b.draft + '</small>' : '') + '</td><td>' + b.mm_per_course + ' mm</td><td>' + b.runner_mm_per_rack + (b.draft ? '<br><small>fed ' + b.fed_mm_per_rack + '</small>' : '') + '</td><td>' + b.ends + '</td><td>' + b.pct + '%</td><td>' + b.kg_per_1000m + '</td></tr>';
      }).join('') + '</table></div>';
    h += beamsHtml(r);
    h += '<div class="st-sub">What the lapping makes</div><ul class="st-checks">' + r.character.map(function (c) { return '<li class="note"><b>' + esc(c.area) + ':</b> ' + esc(c.text) + '</li>'; }).join('') + '</ul>';
    h += '<p class="st-p" style="font-family:var(--mono);font-size:11px">' + esc(F.formula) + '</p><p class="st-p" style="font-size:12px">Finished state: ' + esc(F.relax.basis) + '. ' + esc(r.basis) + '. Needle pitch ' + M.pitch_mm + ' mm, ' + M.needles + ' needles, ' + esc(M.needle) + '.</p>';
    $('wp-out').innerHTML = h;
    drawLapping(r);
    render3D();
  }

  // beams and let-off: what each bar's beam set holds, how long it runs, and an order's yarn
  function beamsHtml(r) {
    var B = r.beams; if (!B) return '';
    var fmt = function (v) { return Number(v).toLocaleString('en'); };
    var h = '<div class="st-sub">Beams and let-off</div><p class="st-p" style="font-size:12px">' + B.beams_per_bar + ' section beams per bar, ' + B.flange_in + '" flange × ' + B.barrel_in + '" barrel × ' + B.width_in + '" wide. A full set runs <b>' + B.set_hours + ' h</b> and knits <b>' + fmt(B.set_fabric_m) + ' m</b> of finished fabric before GB' + B.limiting_bar + ' runs out first.</p>';
    h += '<div class="st-scroll"><table class="st-t"><tr><th>Bar</th><th>Ends / beam</th><th>Yarn / beam (full)</th><th>Warp length (full)</th><th>Run-in (mm/rack)</th><th>Let-off (m/min)</th><th>Full beam lasts</th><th>Matched set: wind</th></tr>' +
      B.per_bar.map(function (x, i) {
        var m = B.matched[i];
        return '<tr><td><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + barCol(x.bar - 1) + '"></i> GB' + x.bar + (x.bar === B.limiting_bar ? ' <small>(runs out first)</small>' : '') + '</td><td>' + x.ends_per_beam + '</td><td>' + x.kg_per_beam + ' kg<br><small>' + x.kg_per_set + ' kg per set</small></td><td>' + fmt(x.warp_length_m) + ' m</td><td>' + x.runin_mm_per_rack + '</td><td>' + x.let_off_m_per_min + '</td><td>' + x.hours + ' h<br><small>' + fmt(x.fabric_m) + ' m fabric</small></td><td>' + fmt(m.warp_length_m) + ' m, ' + m.kg_per_beam + ' kg<br><small>' + m.full_pct + '% of a full beam</small></td></tr>';
      }).join('') + '</table></div>';
    if (B.order) h += '<p class="st-p" style="font-size:12px">Order of <b>' + fmt(B.order.finished_m) + ' m</b> finished: ' + B.order.hours + ' h on the machine, ' + B.order.beam_sets + ' beam sets. Yarn to buy (with ' + B.order.residue_pct + '% left on the beams and ' + B.order.waste_pct + '% waste): ' + B.order.yarn.map(function (y) { return 'GB' + y.bar + ' <b>' + fmt(y.kg_gross) + ' kg</b> (' + fmt(y.kg) + ' kg in the fabric)'; }).join(', ') + ' — total ' + fmt(B.order.kg_gross) + ' kg.</p>';
    return h + '<p class="st-p" style="font-size:12px;color:var(--t3)">A matched set winds every bar to the courses of the bar that runs out first, so the whole set runs out together. ' + esc(B.basis.charAt(0).toUpperCase() + B.basis.slice(1)) + '.</p>';
  }

  // -- 3D: the same lapping, every end's path (studio-warp-geom.js) --
  var mode3d = 'loops', loopView = null, loopP = null, cloth = null, clothKey = '', clothSeq = 0, showBack = false, zoom = 'loops', lview = 'angle';
  var FIB3D = { nylon_filament: 'nylon', polyester_filament: 'polyester', elastane: 'nylon', polypropylene: 'polyester', cotton: 'cotton', polyester_spun: 'polyester', viscose: 'viscose', polyester_mono: 'polyester', nylon_mono: 'nylon' };
  // the spacer's thickness in wale pitches (one wale = 10 / wpc mm), kept drawable
  function gapUnits(r) { var sp = r.fabric.spacer; return sp ? Math.max(1, Math.min(14, sp.thickness_mm / (10 / r.fabric.wpc))) : 0; }
  function lappingSpec(r) {
    return { bars: r.lapping.map(function (b, i) { return { pairs: b.pairs, threading: (W.bars[i] || {}).threading || 'X' }; }), beds: r.structure.beds || 1, gap: gapUnits(r) };
  }
  function render3D() {
    if (!W.last || !W.last.success) return;
    if (mode3d === 'loops') renderLoops(); else renderCloth();
  }
  function renderLoops() {
    var r = W.last, F = r.fabric, L = lappingSpec(r);
    // loop shape from the finished wales and courses; yarn thickness from each bar's yarn
    var h = Math.max(0.45, Math.min(1.3, F.wpc / F.cpc));
    var R = r.structure.repeat_courses;
    var g = window.KAWarpGeom.buildWarpGeom({ bars: L.bars, beds: L.beds, gap: L.gap, needles: 10, h: h, courses: Math.max(R, R * Math.ceil(10 / R)) });
    var geo = { courses: g.paths.map(function (p) { return { course: p.guide, feed: p.bar, points: p.points, side: [], stitches: [] }; }), wales: g.needles, rows: g.courses, h: h, bed: L.beds === 2 ? 'double' : 'single', F: 1, W: 1 };
    var spec = { geo: geo, colours: r.bars.map(function (_, i) { return barCol(i); }), colourBy: 'feed', feeds: r.bars, plated: [], real: false,
      radius: r.bars.map(function (b) { return Math.max(0.04, Math.min(0.2, 0.5 * 1.3 * (b.d_mm || Math.sqrt(b.tex) / 28) / (10 / F.wpc))); }) };
    if (!loopP) loopP = import('/assets/js/studio-loops.js?v=20261110d').then(function (mod) { loopView = new mod.LoopView($('wp-loops'), function () {}); return loopView; });
    loopP.then(function (v) { v.draw(spec); v.view(lview); }).catch(function (e) { $('wp-loops').innerHTML = '<p class="st-p" style="padding:12px">3D could not draw: ' + esc(e.message || e) + '</p>'; });
  }
  // one colour, or each bar its own: the knit3d tint multiplies a grey base (in linear light)
  var lin = function (v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  function barTints(r) {
    if (!$('wp-barcol').checked) return null;
    var g0 = lin(0xb4);
    return r.bars.map(function (_, i) { var c = hexRgb(barCol(i)); return [lin(c.r), lin(c.g), lin(c.b)].map(function (x) { return Math.max(0.004, x) / g0; }); });
  }
  function baseHex() { return $('wp-barcol').checked ? '#b4b4b4' : $('wp-col').value; }
  function renderCloth() {
    var r = W.last, F = r.fabric, front = r.bars[0], L = lappingSpec(r);
    L.tints = barTints(r);
    var o = {
      photo: false, start: zoom === 'loops' ? 'loops' : undefined, dyed: hexRgb(baseHex()), baseHex: baseHex(),
      construction: { type: 'tricot', base: 'warp', label: r.structure.name || 'warp knit', mesh: false, brush: false },
      pattern: { lapping: L, rows: r.structure.repeat_courses, cols: 1, grid: [['K']] },
      sample: function () { return 'knit'; }, sampleBack: function () { return 'knit'; },
      countNe: 590.5 / front.tex, gsm: F.gsm, tf: 14, fiberType: FIB3D[(W.bars[0].yarn || {}).fibre] || 'nylon',
      density: { wpc: F.wpc, cpc: F.cpc, aspect: Math.max(0.9, Math.min(1.6, F.cpc / F.wpc)), scalar: 1, llMm: front.mm_per_course, tex: front.tex, fibreDensityScale: 1 },
      elastanePct: r.bars.some(function (b) { return /lastane/.test(b.fibre); }) ? 15 : 0, physics: null,
      thicknessMm: F.spacer ? F.spacer.thickness_mm : undefined,
      // a filament warp yarn is smooth: no staple fibres standing off the cloth
      yarnLook: /filament|mono|elastane|polypropylene/.test((W.bars[0].yarn || {}).fibre || 'nylon_filament') ? { filament: true, hair: 0, hairAbs: 0, gloss: 1.15 } : undefined,
    };
    var key = JSON.stringify([L, Math.round(F.wpc * 10), Math.round(F.cpc * 10), Math.round(front.tex * 10), o.fiberType, zoom === 'loops']);
    if (cloth && key === clothKey) { cloth.setColor(o.baseHex); return; }
    clothKey = key;
    var my = ++clothSeq, host = $('wp-cloth');
    $('wp-3dnote').textContent = 'Knitting the real view…';
    import('/assets/js/knit3d/index.js?v=20261111a').then(function (mod) {
      if (my !== clothSeq || mode3d !== 'cloth') return;
      if (cloth) { try { cloth.dispose(); } catch (_) {} cloth = null; }
      Array.prototype.forEach.call(host.querySelectorAll('canvas'), function (c) { c.remove(); });
      var k = new mod.Knit3D();
      try { k.mount(host, o); } catch (e) { try { k.dispose(); } catch (_) {} throw e; }
      cloth = k;
      if (showBack) k.setView('back');
      if (zoom !== 'loops' && k.frame) k.frame(zoom);
      $('wp-3dnote').textContent = (r.structure.name || 'warp knit') + ' · ' + F.wpc + ' wales × ' + F.cpc + ' courses /cm · ' + F.gsm + ' GSM' + (F.spacer ? ' · ' + F.spacer.thickness_mm + ' mm thick' : '');
    }).catch(function (e) { if (window.console) console.error(e); $('wp-3dnote').textContent = 'The real view could not draw this: ' + (e && e.message || e); });
  }
  function hexRgb(hx) { var n = parseInt(hx.slice(1), 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; }

  // point paper: dots are needles, the guide's path is drawn course by course
  // (overlap round the needle above the dots, underlap down to the next course)
  function drawLapping(r) {
    var host = $('wp-lap');
    if (!r) { host.innerHTML = ''; return; }
    var dbl = r.structure.beds === 2, reps = 2, C = r.structure.repeat_courses * reps * (dbl ? 2 : 1);
    var maxG = 0; r.lapping.forEach(function (b) { b.pairs.forEach(function (p) { maxG = Math.max(maxG, p[0], p[1]); }); });
    var cols = maxG + 2, dx = 26, dy = 30, x0 = 24, y0 = 18, Wd = x0 * 2 + cols * dx, Hd = y0 * 2 + C * dy;
    var s = '<svg viewBox="0 0 ' + Wd + ' ' + Hd + '" width="' + Math.min(Wd, 560) + '" style="max-width:100%;height:auto;display:block;background:#fff;border:1px solid var(--line);border-radius:8px">';
    // course k drawn from the bottom up; needle n sits between gap n and gap n+1
    var X = function (g) { return x0 + g * dx; }, Y = function (k) { return Hd - y0 - k * dy; };
    // two beds: the pairs alternate — front-bed rows are dots, back-bed rows crosses
    for (var k = 0; k < C; k++) {
      if (dbl) s += '<text x="5" y="' + (Y(k) + 3) + '" font-size="9" fill="#6b7280">' + (k % 2 ? 'B' : 'F') + '</text>';
      for (var n = 0; n < cols; n++) s += dbl && k % 2 ? '<path d="M' + (X(n) + dx / 2 - 2.4) + ' ' + (Y(k) - 2.4) + 'l4.8 4.8m0 -4.8l-4.8 4.8" stroke="#9aa1aa" stroke-width="1.3"/>' : '<circle cx="' + (X(n) + dx / 2) + '" cy="' + Y(k) + '" r="2.4" fill="#9aa1aa"/>';
    }
    r.lapping.forEach(function (b, bi) {
      var off = (bi - (r.lapping.length - 1) / 2) * 2.2, d = '';
      for (var k = 0; k < C; k++) {
        var p = b.pairs[k % b.pairs.length], a = p[0], z = p[1], y = Y(k) + off;
        if (k === 0) d += 'M' + (X(a) + off) + ' ' + (y + 6);
        if (a === z) d += ' L' + (X(a) + off) + ' ' + (y + 2);                       // inlay: no overlap
        else d += ' L' + (X(a) + off) + ' ' + (y + 2) + ' C' + (X(a) + off) + ' ' + (y - 14) + ' ' + (X(z) + off) + ' ' + (y - 14) + ' ' + (X(z) + off) + ' ' + (y + 2);
        var nx = b.pairs[(k + 1) % b.pairs.length][0];
        if (k < C - 1) d += ' L' + (X(nx) + off) + ' ' + (Y(k + 1) + off + 6);
      }
      s += '<path d="' + d + '" fill="none" stroke="' + barCol(bi) + '" stroke-width="2" stroke-linejoin="round" opacity=".9"/>';
    });
    for (var g = 0; g <= cols; g++) s += '<text x="' + X(g) + '" y="' + (Hd - 4) + '" font-size="9" fill="#9aa1aa" text-anchor="middle">' + g + '</text>';
    s += '</svg>';
    host.innerHTML = s + '<p class="st-p" style="font-size:12px">Point paper, ' + reps + ' repeats, course 1 at the bottom. ' + (dbl ? 'Two needle beds: F rows (dots) are the front bed, B rows (crosses) the back bed — a bar that wraps needles on both is a spacer yarn. The numbers' : 'Dots are needles; the numbers') + ' are the guide positions between them. Each bar\'s guide wraps a needle (the overlap, the loop) and shogs behind to the next course (the underlap). Colours: ' + r.lapping.map(function (b, i) { return '<span style="color:' + barCol(i) + ';font-weight:700">GB' + b.bar + '</span>'; }).join(' ') + '.</p>';
  }

  function applyTemplate(id) {
    var t = W.templates.filter(function (x) { return x.id === id; })[0]; if (!t) return;
    W.bars = t.bars.map(function (b) { return { notation: b.notation, threading: b.threading || 'X', yarn: Object.assign({}, b.yarn) }; });
    $('wp-mtype').value = t.machine; $('wp-gauge').value = t.gauge; $('wp-gsm').value = t.gsm; $('wp-cpc').value = '';
    $('wp-nstep').value = String(t.notation_step || 1); if (t.gap) $('wp-gap').value = t.gap;
    syncMachine();
    renderBars(); schedule();
  }

  function syncMachine() { var m = W.machines[$('wp-mtype').value]; $('wp-gapf').hidden = !(m && m.beds === 2); }
  function bind() {
    $('wp-bars').addEventListener('input', onBar);
    $('wp-bars').addEventListener('change', onBar);
    $('wp-bars').addEventListener('click', function (e) { var d = e.target.closest('[data-del]'); if (!d) return; W.bars.splice(+d.getAttribute('data-del'), 1); renderBars(); schedule(); });
    $('wp-addbar').addEventListener('click', function () { if (W.bars.length >= 8) return; W.bars.push({ notation: '1-0/1-2//', threading: 'X', yarn: { count: 40, unit: 'denier', fibre: 'nylon_filament' } }); renderBars(); schedule(); });
    $('wp-template').addEventListener('change', function () { applyTemplate(this.value); });
    $('wp-3dmode').addEventListener('click', function (e) {
      var b = e.target.closest('[data-m]'); if (!b) return;
      mode3d = b.getAttribute('data-m');
      Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); });
      var lp = mode3d === 'loops';
      $('wp-loops').hidden = !lp; $('wp-cloth').hidden = lp; $('wp-clothbar').hidden = lp; $('wp-loopbar').hidden = !lp;
      $('wp-3dhint').textContent = lp ? HINT_LOOPS : HINT_CLOTH;
      if (lp && cloth) { try { cloth.dispose(); } catch (_) {} cloth = null; clothKey = ''; }
      render3D();
    });
    $('wp-col').addEventListener('change', function () { if (cloth && !$('wp-barcol').checked) cloth.setColor(this.value); });
    $('wp-barcol').addEventListener('change', function () { clothKey = ''; render3D(); });
    $('wp-zoom').addEventListener('click', function (e) {
      var b = e.target.closest('[data-z]'); if (!b) return;
      var was = zoom; zoom = b.getAttribute('data-z');
      Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); });
      // the cloth views step back from the same build; the loops reopen close up
      if (cloth && cloth.frame && zoom !== 'loops' && was !== 'loops') cloth.frame(zoom); else { clothKey = ''; render3D(); }
    });
    $('wp-lview').addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]'); if (!b) return;
      lview = b.getAttribute('data-v');
      Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); });
      if (loopView) loopView.view(lview);
    });
    $('wp-mtype').addEventListener('change', syncMachine);
    $('wp-side').addEventListener('click', function () { showBack = !showBack; this.textContent = showBack ? 'Show face' : 'Show back'; if (cloth) cloth.setView(showBack ? 'back' : 'front'); });
    ['wp-mtype', 'wp-gauge', 'wp-width', 'wp-speed', 'wp-eff', 'wp-cpc', 'wp-gsm', 'wp-fwidth', 'wp-nstep', 'wp-gap', 'wp-bflange', 'wp-bbarrel', 'wp-bwidth', 'wp-order', 'wp-bresidue', 'wp-bwaste', 'wp-bkg', 'wp-bm', 'wp-bbar'].forEach(function (id) { $(id).addEventListener('input', schedule); $(id).addEventListener('change', schedule); });
  }
  function onBar(e) {
    var row = e.target.closest('.wp-bar'), k = e.target.getAttribute('data-k'); if (!row || !k) return;
    var b = W.bars[+row.getAttribute('data-i')];
    if (k === 'colour') {
      // a colour is only drawn: no new analysis
      b.colour = e.target.value; row.querySelector('.wp-barhead i').style.background = b.colour;
      if (W.last && W.last.success) { drawLapping(W.last); clothKey = ''; render3D(); }
      return;
    }
    if (k === 'notation' || k === 'threading') b[k] = e.target.value;
    else { b.yarn = b.yarn || {}; b.yarn[k] = e.target.type === 'number' ? (parseFloat(e.target.value) || null) : e.target.value; }
    if (k === 'fibre' && e.type === 'change') renderBars();
    schedule();
  }

  var started = false;
  function start(data) {
    if (started) { schedule(); return; }
    started = true;
    W.templates = data.templates || []; W.fibres = data.fibres || {}; W.machines = data.machines || {};
    $('wp-template').innerHTML = W.templates.map(function (t) { return '<option value="' + t.id + '">' + esc(t.name) + '</option>'; }).join('');
    $('wp-mtype').innerHTML = Object.keys(W.machines).map(function (k) { return '<option value="' + k + '">' + esc(W.machines[k].label) + '</option>'; }).join('');
    bind();
    applyTemplate((W.templates[1] || W.templates[0]).id);
    $('wp-template').value = (W.templates[1] || W.templates[0]).id;
  }
  window.KAStudioWarp = { start: start };
})();
