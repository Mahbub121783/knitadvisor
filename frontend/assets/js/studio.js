/**
 * KnitAdvisor — Fabric Studio (studio.html)
 *
 * The page draws; the engine decides. Every edit posts the whole design to
 * /api/studio/analyse (fabric-studio.js), which checks it and answers with
 * the set-out, the yarn per feeder, the fabric and the machine — the page
 * only renders that answer, so the numbers here and on the floor cannot drift
 * apart. The 3D swatch is the knit3d engine the result page uses, fed the
 * drawn programme directly.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
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

  function loadTemplates() {
    return apiFetch('/api/studio/templates').then(function (d) {
      templates = d.templates || [];
      var fib = $('st-fibre');
      fib.innerHTML = Object.keys(d.fibres || {}).map(function (k) { return '<option value="' + k + '">' + esc(d.fibres[k].label) + '</option>'; }).join('');
      var sel = $('st-template');
      var groups = {};
      templates.forEach(function (t) { (groups[t.category] = groups[t.category] || []).push(t); });
      sel.innerHTML = '<option value="">Blank — draw from scratch</option>' + Object.keys(groups).map(function (g) {
        return '<optgroup label="' + esc(CAT_LABEL[g] || g) + '">' + groups[g].map(function (t) {
          return '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>';
        }).join('') + '</optgroup>';
      }).join('');
      sel.value = S.templateId;
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
      S.feeds = t.roles.map(function (r) { return { role: r }; });
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
            '</select> <input data-feed="' + i + '" data-k="ne" type="number" min="5" max="150" placeholder="Ne" value="' + esc(f.ne || '') + '" title="Count on this feeder (Ne). Empty = the ground count."> ' +
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
      S.feeds[+i][el.getAttribute('data-k')] = el.value;
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

  // ── engine call ──────────────────────────────────────────────────────────
  var timer = null, timer3d = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(analyse, 280);
  }

  function num(id) { var v = parseFloat($(id).value); return isFinite(v) && v > 0 ? v : null; }

  function payload() {
    var vdq = [];
    if (num('st-v1r') && num('st-v1l')) vdq.push({ reading: num('st-v1r'), course_length_m: num('st-v1l') });
    if (num('st-v2r') && num('st-v2l')) vdq.push({ reading: num('st-v2r'), course_length_m: num('st-v2l') });
    return {
      bed: S.D ? 'double' : 'single',
      gating: S.bed === 'interlock' ? 'interlock' : 'rib',
      grid: { C: S.C.map(function (r) { return r.join(''); }), D: S.D ? S.D.map(function (r) { return r.join(''); }) : null },
      feeds: S.feeds.map(function (f) {
        return { role: f.role || 'ground', yarn: +f.ne > 0 ? { ne: +f.ne, fibre: $('st-fibre').value } : null, sl_ratio: +f.sl_ratio > 0 ? +f.sl_ratio : null };
      }),
      yarn: num('st-ne') ? { ne: num('st-ne'), fibre: $('st-fibre').value } : { fibre: $('st-fibre').value },
      elastane: $('st-lycra').checked ? { denier: +$('st-lyd').value, draft: num('st-lydraft') || 2.6, every: $('st-lyevery').value } : null,
      target: { gsm: num('st-gsm'), width_in: num('st-width') },
      machine: {
        gauge: num('st-gauge'), dia: num('st-dia'), feeders: num('st-feeders'), rpm: num('st-rpm'),
        sl_mm: num('st-sl'), efficiency: num('st-eff'), tracks_cyl: +$('st-tc').value, tracks_dial: +$('st-td').value,
        vdq: { points: vdq },
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
      '<span class="st-badge ' + conf.level + '">' + ({ calibrated: 'Calibrated on factory records', close: 'Close to a measured family', estimate: 'New structure — estimate' })[conf.level] + '</span>' +
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
    renderSetup(); renderResults(); renderMachine(); renderNotation();
    clearTimeout(timer3d); timer3d = setTimeout(render3D, 350);
    race.reset();
  }

  function kpi(label, value, sub, k) {
    return '<div class="st-kpi"><div class="l">' + esc(label) + (k ? src(k) : '') + '</div><div class="v">' + value + '</div><div class="s">' + (sub || '') + '</div></div>';
  }

  function renderResults() {
    var r = last, f = r.fabric, y = r.yarn;
    var est = r.structure.confidence.level === 'calibrated' ? 'm' : 'e';
    var html = '<div class="st-kpis">' +
      kpi('Ground yarn', esc(y.ground.count), esc(y.ground.fibre) + ' · ' + y.ground.tex + ' tex' + (y.ground.source === 'solved' ? ' · solved' : ''), r.solver ? 'm' : null) +
      kpi('Stitch length', f.sl_mm + ' mm', esc(f.sl_source) + (f.sl_range_mm ? ' · range ' + f.sl_range_mm.join('–') : ''), est) +
      kpi('Finished GSM', f.gsm, 'likely ' + f.gsm_range.join('–') + (f.target_gsm ? ' · target ' + f.target_gsm : ''), est) +
      kpi('Open width', f.width_open_in + '"', 'tube ' + f.tube_in + '" · likely ' + f.width_range_in.join('–') + '"', est) +
      kpi('Tightness factor', f.tf, f.tf_window ? 'factory middle ' + f.tf_window.q1 + '–' + f.tf_window.q3 : '', 'c') +
      kpi('Wales × courses', f.wpi + ' × ' + f.cpi, 'per inch · ' + f.wpc + ' × ' + f.cpc + ' per cm', est) +
      '</div>';
    html += '<p class="st-p">State: ' + esc(f.state) + '. Kw ' + f.kw + ' (' + esc(f.kw_basis) + '), Ks ' + f.ks + ' (' + esc(f.ks_basis) + ').</p>';
    html += '<p class="st-p" style="font-family:var(--mono);font-size:11px">' + esc(f.formulas.gsm) + '<br>' + esc(f.formulas.width) + '</p>';
    if (r.solver) {
      html += '<div class="st-sub">Count options ' + src('m') + '</div><p class="st-p">' + esc(r.solver.basis) + '.</p><div class="st-scroll"><table class="st-t"><tr><th>Count</th><th>Stitch length</th><th>TF</th><th>Gauge</th><th>Gauge fit</th></tr>' +
        r.solver.options.map(function (o, i) {
          return '<tr' + (i === 0 ? ' style="background:var(--accent-tint)"' : '') + '><td>' + esc(o.count) + (i === 0 ? ' ✓' : '') + '</td><td>' + o.sl_mm + ' mm</td><td>' + o.tf + '</td><td>' + o.gauge + ' GG</td><td>' + esc(o.gauge_fit) + '</td></tr>';
        }).join('') + '</table></div>';
    }
    html += '<div class="st-sub">Yarn on every feeder ' + src('c') + '</div><div class="st-scroll"><table class="st-t"><tr><th>Feed</th><th>Role</th><th>Yarn</th><th>SL mm</th><th>TF</th><th>Yarn per needle</th><th>Course length m/rev</th><th>Yarn speed m/min</th><th>Share of fabric</th><th>Input tension cN ' + src('e') + '</th></tr>' +
      y.feeds.map(function (x) {
        return '<tr><td>F' + x.feed + '</td><td style="color:' + ROLE_COL[x.role] + '">' + x.role + '</td><td>' + esc(x.yarn) + '</td><td>' + x.sl_mm + '</td><td>' + (x.tf == null ? '—' : x.tf) + '</td><td>' + x.share + '</td><td>' + x.course_length_m + '</td><td>' + x.yarn_speed_m_min + '</td><td>' + x.mass_share_pct + '%</td><td>' + x.tension_cN.join('–') + '</td></tr>';
      }).join('') + '</table></div>';
    html += '<p class="st-p">Yarn per needle: the yarn a feeder lays at one needle position as a share of a full knitted loop (knit 1, tuck about 0.7, a miss is the float; on a double bed both beds count). Input tension is a starting range at 0.12–0.16 cN per tex for knit feeders and 0.08–0.10 for loop feeders — confirm with a tension meter.</p>';
    html += '<div class="st-sub">Composition by weight ' + src('c') + '</div><div class="st-scroll"><table class="st-t"><tr><th>Part</th><th>Share</th></tr>' +
      y.composition.map(function (c) { return '<tr><td>' + esc(c.part) + '</td><td>' + c.pct + '%</td></tr>'; }).join('') + '</table></div>';
    $('pane-results').innerHTML = html;
  }

  function renderSetup() {
    var r = last, t = r.setup.tracks;
    var html = '<div class="st-kpis">' +
      kpi('Feeds per repeat', r.structure.feeds, 'feeders must be a whole number of these', 'c') +
      kpi('Needles per repeat', r.structure.needles_per_repeat, 'needles on the machine round to this', 'c') +
      kpi('Cylinder tracks', t.C ? t.C.count : '—', 'different needle sequences = butt positions needed', 'c') +
      (t.D ? kpi('Dial tracks', t.D.count, '', 'c') : '') + '</div>';
    ['C', 'D'].forEach(function (b) {
      if (!t[b]) return;
      html += '<div class="st-sub">' + (b === 'C' ? 'Cylinder' : 'Dial') + ' needle set-out (butt track per needle, one repeat)</div>' +
        '<p class="st-p" style="font-family:var(--mono);font-size:14px;letter-spacing:2px">' + esc(t[b].setout) + '</p>' +
        '<div class="st-scroll"><table class="st-t"><tr><th>Track</th><th>What its needles do at feeders 1 → ' + r.structure.feeds + '</th></tr>' +
        t[b].sequences.map(function (s) { return '<tr><td>' + s.track + '</td><td style="letter-spacing:3px">' + esc(s.sequence) + '</td></tr>'; }).join('') + '</table></div>';
    });
    var cols = [];
    if (t.C) t.C.sequences.forEach(function (s) { cols.push(['C', s.track]); });
    if (t.D) t.D.sequences.forEach(function (s) { cols.push(['D', s.track]); });
    html += '<div class="st-sub">Cam chart — the cam to fit in each track at each feeder</div><div class="st-scroll"><table class="st-t"><tr><th>Feeder</th><th>Yarn</th>' +
      cols.map(function (c) { return '<th>' + (c[0] === 'C' ? 'Cyl ' : 'Dial ') + c[1] + '</th>'; }).join('') + '</tr>' +
      r.setup.cam_chart.map(function (row) {
        return '<tr><td>F' + row.feed + '</td><td style="color:' + ROLE_COL[row.role] + '">' + row.role + '</td>' + cols.map(function (c) {
          var v = row[c[0]] && row[c[0]][c[1]];
          return '<td>' + ({ K: 'Knit', T: 'Tuck', M: 'Miss' }[v] || '—') + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</table></div>';
    html += '<p class="st-p">Repeat the cam chart round the machine: feeder ' + (r.structure.feeds + 1) + ' takes the cams of feeder 1, and so on. Needles with the same sequence share one butt track, so the set-out above is the order to load the needles into the tricks.</p>';
    if (r.setup.timing) html += '<div class="st-sub">Dial timing</div><p class="st-p">' + esc(r.setup.timing) + '</p>';
    $('pane-setup').innerHTML = html;
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
    html += '<div class="st-sub">Gauge against yarn</div><p class="st-p">Needle pitch ' + m.gauge_fit.pitch_mm + ' mm, yarn diameter ' + m.gauge_fit.yarn_d_mm + ' mm, ratio ' + m.gauge_fit.ratio + '. The factory knits this family between ' + m.gauge_fit.band.join(' and ') + ' ' + src('m') + '.</p>';
    $('pane-machine').innerHTML = html;
  }

  // ── notation (SVG) ───────────────────────────────────────────────────────
  function renderNotation() {
    var F = nFeeds(), W = nNeedles(), rep = Math.min(3, Math.max(1, Math.floor(24 / W)));
    var n = W * rep, dx = 26, rowH = S.D ? 86 : 54, left = 46;
    var w = left + n * dx + 20, h = F * rowH + 14;
    var roles = S.feeds.map(function (f) { return (f && f.role) || 'ground'; });
    var out = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" font-family="IBM Plex Mono, monospace">';
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
    var ZONE = 230, GAP = 34, H = 300, BASE = 210;       // BASE: sinker (verge) line
    var LIFT = { K: 110, T: 62, M: 0, '-': 0 };           // clearing / tuck / rest
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

  function renderNeedleTypes() {
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
  var k3 = null, showBack = false;
  function hexRgb(h) { var n = parseInt(h.slice(1), 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; }

  function construction() {
    var roles = S.feeds.map(function (f) { return (f && f.role) || 'ground'; });
    if (!S.D) {
      if (roles.indexOf('loop') > -1) {
        var br = $('st-brushed').checked;
        return { type: br ? 'fleece' : 'terry', base: 'single', label: br ? 'fleece' : 'loopback', mesh: false, brush: br, pile: br ? 'brush' : 'loop' };
      }
      var hasT = S.C.some(function (r) { return r.indexOf('T') > -1; });
      return { type: hasT ? 'pique' : 'jersey', base: 'single', label: hasT ? 'tuck structure' : 'single jersey', mesh: false, brush: false };
    }
    if (S.bed === 'interlock') return { type: 'interlock', base: 'double', label: 'interlock gating', mesh: false, brush: false };
    var a = S.C[0].filter(function (x) { return x !== '-'; }).length, b = S.D[0].filter(function (x) { return x !== '-'; }).length;
    return { type: 'rib', base: 'double', label: 'rib', mesh: false, brush: false, ribRepeat: { a: Math.max(1, a), b: Math.max(1, b) } };
  }

  function render3D() {
    if (!last || !$('pane-3d').classList.contains('on')) return;
    var host = $('st-3d');
    var con = construction();
    var mm = function (g) { return g.map(function (r) { return r.map(function (x) { return x === '-' ? 'M' : x; }); }); };
    var grid = mm(S.C), dial = S.D ? mm(S.D) : null;
    var roles = S.feeds.map(function (f) { return (f && f.role) || 'ground'; });
    var pattern = {
      grid: grid, rows: grid.length, cols: grid[0].length,
      hasTM: grid.some(function (r) { return r.indexOf('T') > -1 || r.indexOf('M') > -1; }),
      hasM: grid.some(function (r) { return r.indexOf('M') > -1; }),
      feedYarns: roles.map(function (r) { return r === 'loop' ? 'fleece' : r === 'binder' ? 'binder' : 'ground'; }),
    };
    if (dial) { pattern.dial = dial; pattern.dialRows = dial.length; pattern.dialCols = dial[0].length; }
    var mod = function (n, m) { return ((n % m) + m) % m; };
    var tok = function (w, c, back, useDial) {
      var front = 'knit';
      if (con.type === 'rib') { var rp = con.ribRepeat; front = mod(w, rp.a + rp.b) < rp.a ? 'knit' : 'purl'; }
      if (front === 'knit') {
        var g = useDial && dial ? dial : grid;
        var cell = g[mod(c, g.length)][mod(w, g[0].length)];
        if (cell === 'T') front = 'tuck'; else if (cell === 'M') front = 'miss';
      }
      if (back && con.type !== 'interlock') front = front === 'knit' ? 'purl' : front === 'purl' ? 'knit' : front;
      return front;
    };
    var f = last.fabric, y = last.yarn;
    var dbl = !!S.D;
    var wpc = f.wpc, cpc = f.cpc;
    var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
    var density = {
      wpc: wpc, cpc: cpc, aspect: clamp(cpc / wpc, 0.9, 1.6),
      scalar: clamp(Math.sqrt(clamp(cpc / (dbl ? 9.5 : 8), 0.5, 2.6)) * clamp(f.gsm / (dbl ? 260 : 190), 0.85, 1.18), 0.7, 1.7),
      tex: y.ground.tex, llMm: f.sl_mm,
    };
    var loopFeed = y.feeds.filter(function (x) { return x.role === 'loop'; })[0];
    var binderFeed = y.feeds.filter(function (x) { return x.role === 'binder'; })[0];
    var opts = {
      dyed: hexRgb($('st-col').value), construction: con, countNe: 590.5 / y.ground.tex,
      loopNe: loopFeed ? 590.5 / loopFeed.tex : null, tieNe: binderFeed ? 590.5 / binderFeed.tex : null,
      tf: f.tf, fiberType: 'cotton', sample: function (w, c) { return tok(w, c, false); },
      sampleBack: function (w, c) { return tok(w, c, false, true); },
      density: density, pattern: pattern, gsm: f.gsm,
      elastanePct: (y.composition.filter(function (c) { return /elastane/.test(c.part); })[0] || {}).pct || 0,
    };
    $('st-3dnote').textContent = 'Rendering…';
    import('/assets/js/knit3d/index.js?v=20260608g').then(function (mod3) {
      if (k3) { try { k3.dispose(); } catch (_) {} k3 = null; }
      host.innerHTML = '';
      var k = new mod3.Knit3D();
      try { k.mount(host, opts); } catch (e) { try { k.dispose(); } catch (_) {} $('st-3dnote').textContent = '3D could not draw this structure.'; return; }
      k3 = k;
      if (showBack && k.setView) k.setView('back');
      $('st-3dnote').textContent = con.label;
    }).catch(function () { $('st-3dnote').textContent = '3D needs WebGL — not available in this browser.'; });
  }

  // ── save / load ──────────────────────────────────────────────────────────
  var STORE = 'ka_studio_designs';
  function readStore() { try { return JSON.parse(localStorage.getItem(STORE) || '[]'); } catch (_) { return []; } }
  function writeStore(a) { try { localStorage.setItem(STORE, JSON.stringify(a)); return true; } catch (_) { return false; } }
  var FIELDS = ['st-ne', 'st-fibre', 'st-gsm', 'st-width', 'st-gauge', 'st-dia', 'st-feeders', 'st-rpm', 'st-sl', 'st-eff', 'st-tc', 'st-td', 'st-lyd', 'st-lydraft', 'st-lyevery', 'st-v1r', 'st-v1l', 'st-v2r', 'st-v2l'];
  function designNow() {
    var o = { v: 1, name: $('st-name').value || 'Untitled design', bed: S.bed, C: S.C, D: S.D, feeds: S.feeds, lycra: $('st-lycra').checked, brushed: $('st-brushed').checked, colour: $('st-col').value, fields: {} };
    FIELDS.forEach(function (id) { o.fields[id] = $(id).value; });
    return o;
  }
  function loadDesign(o) {
    if (!o || !Array.isArray(o.C) || !o.C.length) throw new Error('Not a Fabric Studio design file.');
    snapshot();
    S.bed = o.bed || (o.D ? 'rib' : 'single'); S.C = o.C; S.D = o.D || null; S.feeds = o.feeds || o.C.map(function () { return { role: 'ground' }; });
    $('st-name').value = o.name || ''; delete $('st-name').dataset.auto;
    $('st-lycra').checked = !!o.lycra; $('st-lycra-box').hidden = !o.lycra;
    $('st-brushed').checked = !!o.brushed; if (o.colour) $('st-col').value = o.colour;
    Object.keys(o.fields || {}).forEach(function (id) { if ($(id)) $(id).value = o.fields[id]; });
    S.templateId = ''; $('st-template').value = '';
    renderAll();
  }
  function refreshSaved() {
    $('st-saved').innerHTML = '<option value="">Saved designs…</option>' + readStore().map(function (d, i) { return '<option value="' + i + '">' + esc(d.name) + '</option>'; }).join('');
  }

  // ── wiring ───────────────────────────────────────────────────────────────
  function renderAll() {
    renderBed(); renderEditor(); renderNotation(); schedule();
  }

  function init() {
    bindEditor();
    renderNeedleTypes();
    $('st-bed').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) setBed(b.getAttribute('data-bed')); });
    $('st-template').addEventListener('change', function () { applyTemplate(this.value); });
    $('st-lycra').addEventListener('change', function () { $('st-lycra-box').hidden = !this.checked; schedule(); });
    $('st-gsm').addEventListener('input', function () { this.dataset.touched = '1'; });
    $('st-name').addEventListener('input', function () { delete this.dataset.auto; });
    document.querySelectorAll('aside input, aside select').forEach(function (el) {
      if (el.id === 'st-template' || el.id === 'st-saved' || el.id === 'st-name' || el.id === 'st-import') return;
      el.addEventListener('change', schedule);
      if (el.type === 'number') el.addEventListener('input', schedule);
    });
    $('st-col').addEventListener('change', render3D);
    $('st-brushed').addEventListener('change', render3D);
    $('st-side').addEventListener('click', function () {
      showBack = !showBack; this.textContent = showBack ? 'Show face' : 'Show back';
      if (k3 && k3.setView) k3.setView(showBack ? 'back' : 'front');
    });
    document.querySelector('.st-tabs').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var t = b.getAttribute('data-tab');
      Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); });
      document.querySelectorAll('.st-pane').forEach(function (p) { p.classList.toggle('on', p.id === 'pane-' + t); });
      if (t === 'needle') { race.reset(); race.start(); } else race.stop();
      if (t === '3d') render3D();
    });
    $('st-play').addEventListener('click', function () { this.textContent = race.toggle() ? 'Pause' : 'Play'; });
    $('st-anibed').addEventListener('change', function () { race.reset(); });
    $('st-save').addEventListener('click', function () {
      var a = readStore(), d = designNow();
      var i = a.findIndex(function (x) { return x.name === d.name; });
      if (i > -1) a[i] = d; else a.push(d);
      this.textContent = writeStore(a) ? 'Saved ✓' : 'Browser storage is off';
      var b = this; setTimeout(function () { b.textContent = 'Save in this browser'; }, 1500);
      refreshSaved();
    });
    $('st-saved').addEventListener('change', function () { var d = readStore()[+this.value]; if (d) loadDesign(d); this.value = ''; });
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
    refreshSaved();
    loadTemplates().then(function () { applyTemplate(S.templateId); undo = []; })
      .catch(function (e) { $('st-status').innerHTML = '<div class="st-err">' + esc(e.message || 'Could not load the fabric catalogue.') + '</div>'; renderAll(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
