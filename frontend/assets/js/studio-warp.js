// KnitAdvisor · Fabric Studio — WARP knitting (tricot / raschel): guide bars,
// lapping notation, threading and yarns; the engine (warp-studio.js) answers
// runner, weight, width, production, checks and the fabric's character; the
// lapping is drawn on point paper. Plain script.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var BAR_COL = ['#1857C4', '#c2410c', '#0f9d76', '#7a4fc2', '#b8860b', '#0e7490', '#be185d', '#4d7c0f'];
  var W = { bars: [], templates: [], fibres: {}, machines: {}, last: null, seq: 0, timer: null };

  function fibreOpts(sel) { return Object.keys(W.fibres).map(function (k) { return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + esc(W.fibres[k]) + '</option>'; }).join(''); }
  var UNITS = [['denier', 'D'], ['dtex', 'dtex'], ['tex', 'tex'], ['ne', 'Ne'], ['nm', 'Nm']];

  function renderBars() {
    $('wp-bars').innerHTML = W.bars.map(function (b, i) {
      var y = b.yarn || {};
      return '<div class="wp-bar" data-i="' + i + '"><div class="wp-barhead"><i style="background:' + BAR_COL[i % 8] + '"></i><b>GB' + (i + 1) + '</b>' + (i === 0 ? ' <span>front</span>' : i === W.bars.length - 1 && i > 0 ? ' <span>back</span>' : '') +
        (W.bars.length > 1 ? '<button type="button" class="wp-del" data-del="' + i + '" title="Remove this bar">×</button>' : '') + '</div>' +
        '<div class="st-row">' +
        '<div class="st-f" style="grid-column:1/-1"><label>Lapping (chain notation)</label><input class="wp-not" data-k="notation" value="' + esc(b.notation) + '" placeholder="1-0/1-2//" spellcheck="false" autocomplete="off"></div>' +
        '<div class="st-f"><label>Threading</label><input data-k="threading" value="' + esc(b.threading || 'X') + '" placeholder="X = full set, X. = 1 in 1 out" spellcheck="false"></div>' +
        '<div class="st-f"><label>Count</label><input data-k="count" type="number" min="1" step="0.1" value="' + esc(y.count || '') + '"></div>' +
        '<div class="st-f"><label>Unit</label><select data-k="unit">' + UNITS.map(function (u) { return '<option value="' + u[0] + '"' + ((y.unit || 'denier') === u[0] ? ' selected' : '') + '>' + u[1] + '</option>'; }).join('') + '</select></div>' +
        '<div class="st-f"><label>Fibre</label><select data-k="fibre">' + fibreOpts(y.fibre || 'nylon_filament') + '</select></div>' +
        '<div class="st-f"><label>Filaments (F)</label><input data-k="filaments" type="number" min="1" step="1" value="' + esc(y.filaments || '') + '"></div>' +
        (y.fibre === 'elastane' ? '<div class="st-f"><label>Draft</label><input data-k="draft" type="number" min="1.2" max="4" step="0.1" value="' + esc(y.draft || 2.2) + '"></div>' : '') +
        '</div></div>';
    }).join('');
  }

  function payload() {
    var n = function (id) { var v = parseFloat($(id).value); return isFinite(v) && v > 0 ? v : null; };
    return {
      machine: { type: $('wp-mtype').value, gauge: n('wp-gauge'), width_in: n('wp-width'), speed_cpm: n('wp-speed'), efficiency: n('wp-eff'), cpc: n('wp-cpc') },
      bars: W.bars, target: { gsm: n('wp-gsm'), width_in: n('wp-fwidth') },
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
      kpi('Quality', M.cpc_machine + ' courses/cm', 'on the machine — ' + esc(M.cpc_source)) + kpi('Production', M.finished_m_per_hour + ' m/h', M.kg_per_hour + ' kg/h at ' + M.speed_cpm + ' courses/min, ' + M.efficiency_pct + '%') + '</div>';
    h += '<div class="st-sub">Guide bars</div><div class="st-scroll"><table class="st-t"><tr><th>Bar</th><th>Lapping</th><th>What it knits</th><th>Threading</th><th>Yarn</th><th>Yarn / course</th><th>Runner (mm/rack)</th><th>Ends</th><th>Share</th><th>kg per 1,000 m</th></tr>' +
      r.bars.map(function (b) {
        return '<tr><td><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + BAR_COL[(b.bar - 1) % 8] + '"></i> GB' + b.bar + '</td><td style="font-family:var(--mono)">' + esc(b.notation) + '</td><td>' + esc(b.kind) + '<br><small>' + b.laps.map(function (l) { return l.lap; }).filter(function (v, k, a) { return a.indexOf(v) === k; }).join(' / ') + ' lap</small></td><td>' + esc(b.threading) + ' (' + b.threaded_pct + '%)</td><td>' + esc(b.yarn) + ' ' + esc(b.fibre) + (b.draft ? '<br><small>draft ' + b.draft + '</small>' : '') + '</td><td>' + b.mm_per_course + ' mm</td><td>' + b.runner_mm_per_rack + (b.draft ? '<br><small>fed ' + b.fed_mm_per_rack + '</small>' : '') + '</td><td>' + b.ends + '</td><td>' + b.pct + '%</td><td>' + b.kg_per_1000m + '</td></tr>';
      }).join('') + '</table></div>';
    h += '<div class="st-sub">What the lapping makes</div><ul class="st-checks">' + r.character.map(function (c) { return '<li class="note"><b>' + esc(c.area) + ':</b> ' + esc(c.text) + '</li>'; }).join('') + '</ul>';
    h += '<p class="st-p" style="font-family:var(--mono);font-size:11px">' + esc(F.formula) + '</p><p class="st-p" style="font-size:12px">Finished state: ' + esc(F.relax.basis) + '. ' + esc(r.basis) + '. Needle pitch ' + M.pitch_mm + ' mm, ' + M.needles + ' needles, ' + esc(M.needle) + '.</p>';
    $('wp-out').innerHTML = h;
    drawLapping(r);
  }

  // point paper: dots are needles, the guide's path is drawn course by course
  // (overlap round the needle above the dots, underlap down to the next course)
  function drawLapping(r) {
    var host = $('wp-lap');
    if (!r) { host.innerHTML = ''; return; }
    var reps = 2, C = r.structure.repeat_courses * reps;
    var maxG = 0; r.lapping.forEach(function (b) { b.pairs.forEach(function (p) { maxG = Math.max(maxG, p[0], p[1]); }); });
    var cols = maxG + 2, dx = 26, dy = 30, x0 = 24, y0 = 18, Wd = x0 * 2 + cols * dx, Hd = y0 * 2 + C * dy;
    var s = '<svg viewBox="0 0 ' + Wd + ' ' + Hd + '" width="' + Math.min(Wd, 560) + '" style="max-width:100%;height:auto;display:block;background:#fff;border:1px solid var(--line);border-radius:8px">';
    // course k drawn from the bottom up; needle n sits between gap n and gap n+1
    var X = function (g) { return x0 + g * dx; }, Y = function (k) { return Hd - y0 - k * dy; };
    for (var k = 0; k < C; k++) for (var n = 0; n < cols; n++) s += '<circle cx="' + (X(n) + dx / 2) + '" cy="' + Y(k) + '" r="2.4" fill="#9aa1aa"/>';
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
      s += '<path d="' + d + '" fill="none" stroke="' + BAR_COL[bi % 8] + '" stroke-width="2" stroke-linejoin="round" opacity=".9"/>';
    });
    for (var g = 0; g <= cols; g++) s += '<text x="' + X(g) + '" y="' + (Hd - 4) + '" font-size="9" fill="#9aa1aa" text-anchor="middle">' + g + '</text>';
    s += '</svg>';
    host.innerHTML = s + '<p class="st-p" style="font-size:12px">Point paper, ' + reps + ' repeats, course 1 at the bottom. Dots are needles; the numbers are the guide positions between them. Each bar\'s guide wraps a needle (the overlap, the loop) and shogs behind to the next course (the underlap). Colours: ' + r.lapping.map(function (b, i) { return '<span style="color:' + BAR_COL[i % 8] + ';font-weight:700">GB' + b.bar + '</span>'; }).join(' ') + '.</p>';
  }

  function applyTemplate(id) {
    var t = W.templates.filter(function (x) { return x.id === id; })[0]; if (!t) return;
    W.bars = t.bars.map(function (b) { return { notation: b.notation, threading: b.threading || 'X', yarn: Object.assign({}, b.yarn) }; });
    $('wp-mtype').value = t.machine; $('wp-gauge').value = t.gauge; $('wp-gsm').value = t.gsm; $('wp-cpc').value = '';
    renderBars(); schedule();
  }

  function bind() {
    $('wp-bars').addEventListener('input', onBar);
    $('wp-bars').addEventListener('change', onBar);
    $('wp-bars').addEventListener('click', function (e) { var d = e.target.closest('[data-del]'); if (!d) return; W.bars.splice(+d.getAttribute('data-del'), 1); renderBars(); schedule(); });
    $('wp-addbar').addEventListener('click', function () { if (W.bars.length >= 8) return; W.bars.push({ notation: '1-0/1-2//', threading: 'X', yarn: { count: 40, unit: 'denier', fibre: 'nylon_filament' } }); renderBars(); schedule(); });
    $('wp-template').addEventListener('change', function () { applyTemplate(this.value); });
    ['wp-mtype', 'wp-gauge', 'wp-width', 'wp-speed', 'wp-eff', 'wp-cpc', 'wp-gsm', 'wp-fwidth'].forEach(function (id) { $(id).addEventListener('input', schedule); $(id).addEventListener('change', schedule); });
  }
  function onBar(e) {
    var row = e.target.closest('.wp-bar'), k = e.target.getAttribute('data-k'); if (!row || !k) return;
    var b = W.bars[+row.getAttribute('data-i')];
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
