/**
 * Fabric Studio — the blend yarn card and its results tab (CVC, PC, cotton/viscose, T/R … at any count).
 *
 * Left (the "Blend yarn" card, under the Yarn card): the fibres and their shares for a yarn role (face / ground,
 * binder, loop). While it is on, that role's real fibre mix and density decide the yarn's size, the stitch length and the
 * factory factors the Studio weighs the fabric with — at ANY ratio. The count stays the Yarn card's count (or the one the
 * Studio solves from the target GSM).
 *
 * Right (the "Blend yarn" tab): everything the blend engine works out at that count — the load–elongation curve to break,
 * the strength against the blend ratio, composition and what the mill must weigh, geometry, evenness and the draw-frame
 * creel, lustre, texture, properties, process, the count and ratio sweeps, and the derivation of each figure
 * (backend/engine/domain/blend-yarn-engine.js). Each figure is tagged measured / law / blend / typical / estimate / calibrated.
 *
 * Plain script, no dependencies. window.KAStudioBlend:
 *   payload()            { ground: spec, … } for the roles that are on, or null
 *   state() / setState() the card as a plain object (saved with a design)
 *   setCatalogue(c)      fibres, spinning systems, grades, ready ratios (from /api/studio/templates)
 *   studioResult(r)      the Studio's last answer (carries r.blend per role)
 *   forYarnView(role)    the true fibre mix of a role's yarn, for the 3D yarn view
 */
(function () {
  'use strict';
  var CAT = null, ROLES = [['ground', 'Face / ground'], ['binder', 'Binder'], ['loop', 'Loop']];
  var S = { role: 'ground', specs: {} };
  var lastResult = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  function blank() {
    return { enabled: false, comps: [{ fibre: 'cotton', share: 60, lustre: 'semi_dull' }, { fibre: 'polyester', share: 40, lustre: 'semi_dull' }],
      spinning: '', grade: '', twist: '', mercerised: false, humidity: '', passages: '2', route: 'draw_frame', burst: '', preset: '' };
  }
  function cur() { return S.specs[S.role] || (S.specs[S.role] = blank()); }

  var CSS = '.bl-row{display:grid;grid-template-columns:1.4fr .7fr 1.2fr 22px;gap:5px;align-items:center;margin-bottom:5px}' +
    '.bl-row select,.bl-row input{width:100%;box-sizing:border-box;padding:6px 5px;border:1px solid var(--line2);border-radius:var(--radius-sm);font:12.5px var(--head);background:var(--bg);color:var(--t1)}' +
    '.bl-row button{border:0;background:none;color:var(--t3);cursor:pointer;font-size:16px}.bl-tot{font-size:11.5px;color:var(--t3);margin:0 0 6px}' +
    '.bl-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin:8px 0}.bl-kpi{border:1px solid var(--line);border-radius:10px;padding:8px 10px;background:var(--bg)}' +
    '.bl-kpi b{display:block;font:700 18px var(--head);color:var(--t1)}.bl-kpi span{font-size:11px;color:var(--t2)}.bl-chart{width:100%;max-width:520px;height:auto;display:block;margin:6px 0}' +
    '.bl-scroll{overflow:auto;max-height:340px;border:1px solid var(--line);border-radius:8px}.bl-scroll .ml-tbl{margin:0}.bl-scroll tr.on td{background:var(--accent-tint);font-weight:700}' +
    '.bl-der{font-size:12px;margin:0 0 8px;padding:6px 9px;border:1px solid var(--line);border-radius:8px}.bl-der b{display:block;color:var(--t1)}.bl-der code{display:block;font:11.5px/1.45 ui-monospace,Consolas,monospace;color:var(--t2);white-space:pre-wrap;word-break:break-word}';
  function ensureCss() {
    if (!$('ml-css') && window.KAStudioMelange && window.KAStudioMelange.css) { var m = document.createElement('style'); m.id = 'ml-css'; m.textContent = window.KAStudioMelange.css; document.head.appendChild(m); }
    if (!$('bl-css')) { var st = document.createElement('style'); st.id = 'bl-css'; st.textContent = CSS; document.head.appendChild(st); }
  }

  function opts(list, sel, key, lab) { return list.map(function (o) { var v = key != null ? o[key] : o[0], l = lab != null ? o[lab] : o[1]; return '<option value="' + esc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join(''); }

  // ── the card ───────────────────────────────────────────────────────────────────────────────
  function buildCard() {
    var host = $('bl-card'); if (!host) return;
    ensureCss();
    if (!CAT) { host.innerHTML = '<div class="st-step"><b>2a</b> Blend yarn</div><p class="st-hint">Loading…</p>'; return; }
    var c = cur();
    var roleBtns = ROLES.map(function (r) { return '<button type="button" data-bl-role="' + r[0] + '" class="' + (S.role === r[0] ? 'on' : '') + '">' + r[1] + ((S.specs[r[0]] && S.specs[r[0]].enabled) ? '<span class="ml-dot"></span>' : '') + '</button>'; }).join('');
    var rows = c.comps.map(function (k, i) {
      return '<div class="bl-row" data-i="' + i + '"><select data-f="fibre" aria-label="Fibre">' + opts(CAT.fibres, k.fibre, 'id', 'label') + '</select>' +
        '<input type="number" data-f="share" min="1" max="100" step="1" value="' + esc(k.share) + '" title="share, % (as on the label)" aria-label="Share">' +
        (k.fibre === 'polyester' ? '<select data-f="lustre" aria-label="Lustre">' + opts(CAT.lustres, k.lustre, 'id', 'label') + '</select>' : '<span></span>') +
        '<button type="button" data-bl-del="' + i + '" title="Remove" aria-label="Remove">&times;</button></div>';
    }).join('');
    var tot = c.comps.reduce(function (t, k) { return t + (+k.share || 0); }, 0);
    host.innerHTML = '<div class="st-step"><b>2a</b> Blend yarn — CVC, PC and other blends</div>' +
      '<p class="st-hint" style="margin-top:0">Any fibre blend at any ratio. Switch it on for a yarn role: the ratio sets the yarn\'s density, size and the stitch length, and every property (strength to break, lustre, hand, evenness) is worked out at the count the Studio uses.</p>' +
      '<div class="ml-seg" role="group" aria-label="Yarn role">' + roleBtns + '</div>' +
      '<label class="st-check"><input type="checkbox" id="bl-on"' + (c.enabled ? ' checked' : '') + '> This yarn is a fibre blend</label>' +
      '<div id="bl-body"' + (c.enabled ? '' : ' hidden') + '>' +
      '<div class="st-row one"><div class="st-f"><label for="bl-preset">Start from a ready ratio</label><select id="bl-preset"><option value="">— choose —</option>' + opts(CAT.presets, c.preset, 'id', 'label') + '</select></div></div>' +
      '<div class="st-sub" style="margin:8px 0 4px">Fibres (share % as on the label)</div>' + rows +
      '<div class="bl-tot">Total ' + tot + ' % — read as proportions of that total.</div>' +
      '<button type="button" class="st-btn" id="bl-add" style="margin:0 0 6px"' + (c.comps.length >= 4 ? ' disabled' : '') + '>+ Add a fibre</button>' +
      '<div class="st-row one"><div class="st-f"><label for="bl-spin">Spinning system</label><select id="bl-spin"><option value="">Auto by count</option>' + opts(CAT.spinning, c.spinning, 'id', 'label') + '</select></div></div>' +
      '<details class="ml-adv"' + (c.grade || c.twist || c.mercerised || c.burst ? ' open' : '') + '><summary>Grade, twist &amp; mill figures</summary>' +
      '<div class="st-row"><div class="st-f"><label for="bl-grade">Cotton grade</label><select id="bl-grade"><option value="">Combed Upland</option>' + opts(CAT.grades, c.grade, 'id', 'label') + '</select></div>' +
      '<div class="st-f"><label for="bl-tw">Twist multiplier αe</label><input id="bl-tw" type="number" min="2" max="6" step="0.05" placeholder="typical" value="' + esc(c.twist) + '"></div></div>' +
      '<div class="st-row"><div class="st-f"><label for="bl-rh">Room humidity (% RH)</label><input id="bl-rh" type="number" min="20" max="95" step="1" placeholder="65" value="' + esc(c.humidity) + '"></div>' +
      '<div class="st-f"><label for="bl-pass">Draw-frame passages</label><select id="bl-pass">' + opts([['1', '1'], ['2', '2'], ['3', '3']], c.passages) + '</select></div></div>' +
      '<div class="st-row"><div class="st-f"><label for="bl-route">Blending</label><select id="bl-route">' + opts([['draw_frame', 'Draw-frame (sliver)'], ['blow_room', 'Blow-room']], c.route) + '</select></div>' +
      '<div class="st-f"><label for="bl-burst">Measured bursting (kPa)</label><input id="bl-burst" type="number" min="50" max="3000" step="10" placeholder="fits the estimate" value="' + esc(c.burst) + '"></div></div>' +
      '<label class="st-check"><input type="checkbox" id="bl-merc"' + (c.mercerised ? ' checked' : '') + '> Mercerised cotton</label>' +
      '<p class="st-hint">Leave blank for the typical figure. A measured twist or bursting is used and labelled measured / calibrated.</p></details>' +
      '<div class="ml-sum" id="bl-sum"></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button type="button" class="st-btn" id="bl-open">Open the full blend analysis</button></div>' +
      '</div>';
    summary();
  }

  // ── reading the card back ──────────────────────────────────────────────────────────────────
  function readCard() {
    var c = cur(), on = $('bl-on'); if (!on) return;
    c.enabled = on.checked;
    var rows = document.querySelectorAll('#bl-card .bl-row');
    if (rows.length) {
      c.comps = Array.prototype.map.call(rows, function (row, i) {
        var g = function (f) { var e = row.querySelector('[data-f="' + f + '"]'); return e ? e.value : null; };
        var old = c.comps[i] || {};
        return { fibre: g('fibre') || old.fibre, share: parseFloat(g('share')) || 0, lustre: g('lustre') || old.lustre || 'semi_dull' };
      });
    }
    // a ready ratio stays selected only while the fibres still are that ratio
    var pr = (CAT && CAT.presets || []).filter(function (x) { return x.id === c.preset; })[0];
    if (pr && !(Object.keys(pr.fibres).length === c.comps.length && c.comps.every(function (k) { return pr.fibres[k.fibre] === k.share; }))) c.preset = '';
    if ($('bl-preset')) $('bl-preset').value = c.preset || '';
    var v = function (id) { var e = $(id); return e ? e.value : ''; };
    if ($('bl-spin')) { c.spinning = v('bl-spin'); c.grade = v('bl-grade'); c.twist = v('bl-tw'); c.humidity = v('bl-rh'); c.passages = v('bl-pass'); c.route = v('bl-route'); c.burst = v('bl-burst'); c.mercerised = $('bl-merc').checked; }
  }
  function specOf(c) {
    var n = function (x) { var q = parseFloat(x); return q > 0 ? q : undefined; };
    var spec = { components: c.comps.filter(function (k) { return k.share > 0; }).map(function (k) { var o = { fibre: k.fibre, share: k.share }; if (k.fibre === 'polyester') o.lustre = k.lustre; return o; }),
      spinning: c.spinning || undefined, grade: c.grade || undefined, twist_multiplier: n(c.twist), humidity_rh: n(c.humidity), passages: n(c.passages), blend_route: c.route, mercerised: !!c.mercerised };
    if (n(c.burst)) spec.fabric = { bursting_kpa: n(c.burst) };
    return spec;
  }
  function summary() {
    var el = $('bl-sum'); if (!el) return;
    var r = lastResult && lastResult[S.role];
    if (!r) { el.textContent = cur().enabled ? 'Worked out with the Studio’s next answer.' : ''; return; }
    var t = r.tensile;
    el.innerHTML = '<b>' + esc(r.identity.label) + '</b> · ' + r.count.ne.value + 's Ne · ' + esc(r.identity.spinning.label) + '<br>tenacity ' + t.tenacity.value + ' cN/tex · breaks at ' + t.elongation_at_break.value + ' % · ' + esc(r.lustre.class) + ' · ' + r.evenness.u_pct.value + ' % U';
  }

  // ── the results tab ────────────────────────────────────────────────────────────────────────
  function tag(t) { return t ? '<span class="ml-b ml-b-' + esc(t) + '">' + esc(t) + '</span>' : ''; }
  function val(o, d) { return o && o.value != null ? (d === undefined ? o.value : (+o.value).toFixed(d)) + (o.unit ? ' ' + esc(o.unit) : '') + tag(o.basis) : '—'; }
  var COLS = ['#2f6fb0', '#c98a12', '#2e8b57', '#9a4bb0'];
  function lineChart(opt) {
    var W = 340, H = 150, x0 = 38, x1 = W - 10, y0 = 10, y1 = H - 22;
    var xmax = opt.xmax, ymax = opt.ymax;
    var X = function (v) { return x0 + (x1 - x0) * v / xmax; }, Yv = function (v) { return y1 - (y1 - y0) * Math.min(1, v / ymax); };
    var path = function (pts) { return pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Yv(p[1]).toFixed(1); }).join(''); };
    var g = '';
    for (var i = 0; i <= 4; i++) { var v = ymax * i / 4; g += '<line x1="' + x0 + '" x2="' + x1 + '" y1="' + Yv(v) + '" y2="' + Yv(v) + '" stroke="currentColor" opacity=".12"/><text x="' + (x0 - 4) + '" y="' + (Yv(v) + 3) + '" text-anchor="end" font-size="8" fill="currentColor" opacity=".65">' + Math.round(v) + '</text>'; }
    for (var j = 0; j <= 4; j++) { var xv = xmax * j / 4; g += '<text x="' + X(xv) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="8" fill="currentColor" opacity=".65">' + (Math.round(xv * 10) / 10) + '</text>'; }
    var lines = opt.series.map(function (s, k) { return '<path d="' + path(s.pts) + '" fill="none" stroke="' + (s.color || COLS[k % 4]) + '" stroke-width="' + (s.w || 1.2) + '"' + (s.dash ? ' stroke-dasharray="4 3"' : '') + ' opacity="' + (s.op || 1) + '"/>'; }).join('');
    var mk = (opt.marks || []).map(function (m) { return '<circle cx="' + X(m[0]) + '" cy="' + Yv(m[1]) + '" r="3.2" fill="#c0392b"/><text x="' + Math.min(X(m[0]) + 5, W - 70) + '" y="' + (Yv(m[1]) - 5) + '" font-size="8.5" fill="currentColor">' + esc(m[2]) + '</text>'; }).join('');
    return '<svg class="bl-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opt.label) + '">' + g + lines + mk +
      '<text x="' + (x0 + (x1 - x0) / 2) + '" y="' + (H - 0) + '" text-anchor="middle" font-size="8" fill="currentColor" opacity=".7">' + esc(opt.xl) + '</text></svg>';
  }
  function kpis(list) { return '<div class="bl-kpis">' + list.map(function (k) { return '<div class="bl-kpi"><b>' + esc(k[1]) + '</b><span>' + esc(k[0]) + (k[2] ? tag(k[2]) : '') + '</span></div>'; }).join('') + '</div>'; }
  function table(head, rows, hl) { return '<div class="bl-scroll"><table class="ml-tbl"><tr>' + head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr>' + rows.map(function (r, i) { return '<tr' + (hl === i ? ' class="on"' : '') + '>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table></div>'; }

  function render(res) {
    var pane = $('pane-blend'); if (!pane) return;
    ensureCss();
    var roles = res ? Object.keys(res) : [];
    if (!roles.length) { pane.innerHTML = '<p class="st-p">Switch the blend yarn on for a yarn role (the Blend yarn card, under Yarn) to see its whole analysis here: the load–elongation curve to break, strength against the blend ratio, lustre, hand, the count sweep and the derivation of every figure.</p>'; return; }
    var role = res[S.role] ? S.role : roles[0], r = res[role], h = '';
    h += '<div class="ml-top"><div style="flex:1;min-width:220px"><div style="font:700 17px var(--head)">' + esc(r.identity.label) + ' — ' + esc(({ ground: 'face / ground', binder: 'binder', loop: 'loop' })[role] || role) + ' yarn</div><div class="ml-note">' + esc(r.identity.long) + '. Label: ' + esc(r.identity.code) + '.</div>' +
      '<div class="ml-note">' + r.count.ne.value + 's Ne (' + r.count.tex.value + ' tex) on ' + esc(r.identity.spinning.label) + (r.identity.spinning.chosen ? '' : ' — chosen by the count: ' + esc(r.identity.spinning.recommended.why)) + '.</div></div></div>';
    if (r.warnings.length) h += r.warnings.map(function (w) { return '<div class="ml-note ' + (w.level === 'warn' ? 'warn' : '') + '">' + (w.level === 'warn' ? '⚠ ' : '') + esc(w.text) + '</div>'; }).join('');
    // tensile
    var t = r.tensile;
    h += '<div class="ml-h">Strength and elongation to break</div>' + kpis([
      ['Breaking force', t.breaking_force.value + ' cN', t.breaking_force.basis], ['Tenacity', t.tenacity.value + ' cN/tex', t.tenacity.basis], ['Elongation at break', t.elongation_at_break.value + ' %', t.elongation_at_break.basis],
      ['Ultimate elongation', t.ultimate_elongation.value + ' %', t.ultimate_elongation.basis], ['Work of rupture', t.work_of_rupture.value + ' mN/tex', t.work_of_rupture.basis], ['Initial modulus', (Math.round(t.initial_modulus.value) / 100) + ' cN/tex per 1 %', t.initial_modulus.basis]]);
    var ymax = Math.max.apply(null, t.curve.map(function (p) { return p.force_cn; })) * 1.12, xmax = Math.max.apply(null, t.curve.map(function (p) { return p.strain_pct; }));
    var ids = Object.keys(t.curve[0].by_fibre);
    var series = [{ pts: t.curve.map(function (p) { return [p.strain_pct, p.force_cn]; }), color: 'currentColor', w: 2.3 }].concat(ids.map(function (id, i) { return { pts: t.curve.map(function (p) { return [p.strain_pct, p.by_fibre[id]]; }), color: COLS[i % 4], w: 1.1, op: 0.85 }; }));
    h += lineChart({ xmax: xmax, ymax: ymax, series: series, marks: [[t.elongation_at_break.value, t.breaking_force.value, 'break ' + t.breaking_force.value + ' cN']], label: 'Load against elongation of the yarn', xl: 'elongation, %   (force, cN: bold = yarn, coloured = each fibre\'s share of the load)' });
    h += '<div class="ml-rm">Load in cN. Bold: the yarn; coloured: the share of the load each fibre carries. ' + ids.map(function (id, i) { return '<span style="color:' + COLS[i % 4] + '">■</span> ' + esc(r.composition.per_fibre.filter(function (c) { return c.fibre === id; })[0].label); }).join(' &nbsp; ') + '</div>';
    h += '<div class="ml-note">' + esc(t.sequence_note) + '</div>';
    h += '<dl class="ml-kv"><dt>Weakest place</dt><dd>' + val(t.weakest_place_force) + ' — CV of the breaking force ' + val(t.cv_breaking_force_pct) + '</dd><dt>Against the running tension</dt><dd>' + val(t.safety_factor) + ' (running tension ' + val(t.running_tension) + ')</dd>' +
      '<dt>Dry · wet · hot-wet</dt><dd>' + t.scenarios.dry.tenacity + ' · ' + t.scenarios.wet.tenacity + ' · ' + t.scenarios.hot_wet.tenacity + ' cN/tex; elongation ' + t.scenarios.dry.elongation + ' · ' + t.scenarios.wet.elongation + ' · ' + t.scenarios.hot_wet.elongation + ' %</dd>' +
      '<dt>Count-strength product</dt><dd>' + val(t.csp) + '</dd></dl><div class="ml-rm">' + esc(t.note) + '</div>';
    if (r.bursting) {
      var b = r.bursting;
      h += '<div class="ml-h">Bursting of the knitted fabric</div><dl class="ml-kv"><dt>Bursting pressure</dt><dd><b>' + val(b.bursting_pressure) + '</b>, the dome rising ' + val(b.dome_height_at_burst) + '</dd><dt>Fabric strength</dt><dd>' + b.fabric_strength.wale_n_per_cm + ' N/cm along the wales · ' + b.fabric_strength.course_n_per_cm + ' N/cm along the courses</dd><dt>Loop efficiency</dt><dd>' + val(b.loop_efficiency, 2) + ' · interaction ' + val(b.interaction_factor, 2) + '</dd></dl><div class="ml-rm">' + esc(b.note) + (b.calibration ? '' : ' Enter one measured bursting value on this fabric (under Grade, twist & mill figures) to fit it.') + '</div>';
    }
    // the ratio sweep
    var rs = r.sweep.ratio;
    if (rs) {
      var pts = rs.points.map(function (p) { return [p.share_second_pct, p.tenacity_cn_tex]; }), ex = rs.points.map(function (p) { return [p.share_second_pct, p.elongation_pct]; });
      var second = r.composition.per_fibre.filter(function (c) { return c.fibre === rs.second; })[0];
      var cs = second ? second.label_share_pct : null;
      h += '<div class="ml-h">Strength against the blend ratio</div>' + lineChart({ xmax: 100, ymax: Math.max.apply(null, pts.map(function (p) { return p[1]; })) * 1.15, series: [{ pts: pts, color: 'currentColor', w: 2.2 }], marks: cs != null ? [[cs, interp(pts, cs), 'this blend']] : [], label: 'Tenacity against the share of the second fibre', xl: '% ' + (second ? second.label.toLowerCase() : rs.second) });
      h += '<div class="ml-note">' + esc(rs.note) + (rs.minimum ? ' ' + esc(rs.minimum.note) : '') + '</div>';
      h += table(['% ' + (second ? second.label : rs.second), 'Tenacity cN/tex', 'Elongation %', 'Regain %', 'Diameter mm', 'Hairiness', 'Sheen'], rs.points.map(function (p) { return [p.share_second_pct, p.tenacity_cn_tex, p.elongation_pct, p.regain_pct, p.diameter_mm, p.hairiness, p.sheen_index]; }), cs != null ? Math.round(cs / 10) : -1);
    }
    // composition
    var cp = r.composition;
    h += '<div class="ml-h">Composition — what the mill must weigh</div>' + table(['Fibre', 'Label %', 'Dry %', 'Regain %', 'Fibres in section', 'Number %', 'Area %', 'Realization %', 'Issue %', 'If weighed at label %'],
      cp.per_fibre.map(function (c) { return [c.label, c.label_share_pct, c.dry_share_pct, c.regain_pct.value, c.fibres_in_section, c.number_share_pct, c.area_share_pct, c.realization_pct, c.issue_share_pct, c.if_weighed_at_label_ratio_pct]; })) +
      '<div class="ml-rm">Blend regain ' + val(cp.blend_regain) + ' · density ' + val(cp.blend_density) + ' · per 100 kg of yarn the mill issues ' + cp.bale_issue_per_100kg.total_kg + ' kg of bale (overall realization ' + cp.bale_issue_per_100kg.overall_realization_pct + ' %). ' + esc(cp.note) + '</div>';
    // geometry
    var g = r.geometry;
    h += '<div class="ml-h">Count and geometry</div><dl class="ml-kv"><dt>Count</dt><dd>' + r.count.ne.value + 's Ne = ' + r.count.nm + ' Nm = ' + r.count.single_tex + ' tex = ' + r.count.denier + ' denier' + (r.count.ply > 1 ? ' per ply (' + r.count.ply + '-ply)' : '') + '</dd><dt>Fibres in the section</dt><dd>' + val(g.fibres_in_section) + ' (mean fibre ' + val(g.mean_fibre_tex) + ')</dd><dt>Diameter</dt><dd>' + val(g.diameter) + ' at a packing of ' + val(g.packing) + '</dd>' +
      '<dt>Twist</dt><dd>' + val(g.tpi) + ' (αe ' + val(g.twist_multiplier) + '; ' + val(g.tpm) + ')</dd><dt>Twist angle</dt><dd>surface ' + val(g.surface_twist_angle) + ' · mean fibre ' + val(g.mean_fibre_angle) + '</dd><dt>Finest count</dt><dd>' + esc(g.finest_count.note) + ' (' + esc(g.finest_count.governed_by) + ' governs)</dd></dl>';
    // evenness & mixing
    var e = r.evenness;
    h += '<div class="ml-h">Evenness, hairiness and the blend</div><dl class="ml-kv"><dt>Fibre-count limit</dt><dd>CVlim ' + val(e.cv_limit_pct) + ' · irregularity index ' + val(e.index_of_irregularity) + '</dd><dt>Evenness</dt><dd>CVm ' + val(e.cvm_pct) + ' · U ' + val(e.u_pct) + '</dd><dt>Imperfections per km</dt><dd>thin ' + e.imperfections_per_km.thin + ' · thick ' + e.imperfections_per_km.thick + ' · neps ' + e.imperfections_per_km.neps + ' (IPI ' + e.imperfections_per_km.ipi + ')</dd><dt>Hairiness</dt><dd>' + val(e.hairiness_h) + '</dd><dt>Mill ranking</dt><dd>' + esc(e.usp.label) + '</dd></dl>';
    if (e.mixing) {
      var m = e.mixing;
      h += '<div class="ml-note" style="margin-top:6px">' + esc(m.per_point_note) + '</div>';
      if (m.creel.length) h += '<div class="ml-note"><b>Draw-frame creel</b> — whole slivers only, for the ' + esc(m.minor_fibre) + ' share.</div>' + table(['Doublings', 'Minor : major slivers', 'Share with equal slivers %', 'Off target (points)', 'Minor sliver weight to hit it (% of major)'], m.creel.map(function (o) { return [o.doublings, o.effect_slivers + ' : ' + o.base_slivers, o.share_equal_weights_pct, o.error_points, o.effect_sliver_weight_needed_pct_of_base]; }));
    }
    // lustre & texture
    var l = r.lustre, x = r.texture;
    h += '<div class="ml-h">Lustre</div><dl class="ml-kv"><dt>Sheen index</dt><dd><b>' + val(l.index) + '</b> — ' + esc(l.class) + '</dd>' + l.fibres.map(function (f) { return '<dt>' + esc(f.label) + ' (' + f.area_share_pct + ' % of the surface)</dt><dd>' + f.index + ' — ' + esc(f.note) + '</dd>'; }).join('') + '</dl>' +
      '<div class="ml-rm">' + esc(l.note) + (l.dye_note ? ' ' + esc(l.dye_note) : '') + '</div>';
    h += '<div class="ml-h">Texture and hand</div><dl class="ml-kv"><dt>Handle</dt><dd>' + esc(x.handle) + '</dd><dt>Softness</dt><dd>' + val(x.softness) + '</dd><dt>Crispness</dt><dd>' + val(x.crispness) + '</dd><dt>Bending rigidity</dt><dd>' + val(x.bending_rigidity_vs_cotton, 2) + '</dd><dt>Bulk</dt><dd>' + val(x.bulk, 2) + '</dd><dt>Hairiness</dt><dd>' + val(x.hairiness_vs_combed_cotton, 2) + '</dd></dl><div class="ml-rm">' + esc(x.note) + '</div>';
    // properties
    var p = r.properties;
    h += '<div class="ml-h">Properties</div><dl class="ml-kv"><dt>Moisture regain</dt><dd>' + val(p.moisture.regain_conditioned) + ' — ' + esc(p.moisture.hand_dry_feel) + '</dd>' +
      '<dt>Pilling</dt><dd>' + val(p.pilling.martindale_grade_at_2000) + ' (index ' + p.pilling.index.value + ')</dd>' +
      (p.loop.loop_strength_pct_of_straight ? '<dt>Loop strength</dt><dd>' + val(p.loop.loop_strength_pct_of_straight) + ' of straight' + (p.loop.governed_by ? ' (' + esc(p.loop.governed_by) + ' governs)' : '') + '</dd>' : '') +
      (p.elastic_recovery.from_5pct ? '<dt>Recovery from 5 %</dt><dd>' + val(p.elastic_recovery.from_5pct) + ' · growth ' + val(p.elastic_recovery.growth_at_5pct) + '</dd>' : '') +
      '<dt>Static</dt><dd>' + esc(p.static.note) + '</dd><dt>Heat</dt><dd>' + esc(p.heat.note) + '</dd><dt>Shrinkage</dt><dd>' + esc(p.shrinkage.note) + '</dd></dl><div class="ml-rm">' + esc(p.pilling.note) + '</div>';
    // process
    h += '<div class="ml-h">Process</div>' + r.process.steps.map(function (s) { return '<div class="ml-step"><b>' + esc(s.stage) + '</b><span>' + esc(s.text) + '</span></div>'; }).join('');
    // count sweep
    var cw = r.sweep.count, hi = cw.reduce(function (b, c, i) { return Math.abs(c.ne - r.count.ne.value) < Math.abs(cw[b].ne - r.count.ne.value) ? i : b; }, 0);
    h += '<div class="ml-h">The same yarn at every count</div>' + table(['Ne', 'tex', 'System', 'Spinnable', 'Fibres', 'Ø mm', 'TPI', 'Tenacity', 'Force cN', 'Elong. %', 'U %', 'Hair', 'Sheen'], cw.map(function (c) { return [c.ne, c.tex, c.spinning.replace('_', '-'), c.spinnable ? 'yes' : 'no', c.fibres_in_section, c.diameter_mm, c.tpi, c.tenacity_cn_tex, c.breaking_force_cn, c.elongation_pct, c.u_pct, c.hairiness, c.sheen_index]; }), hi) +
      '<div class="ml-rm">The row nearest this yarn is highlighted. Each count takes the spinning system its range suggests unless you chose one.</div>';
    // derivations
    h += '<div class="ml-h">Derivations</div><details><summary class="ml-note" style="cursor:pointer">Show the working behind every figure (' + r.derivations.length + ')</summary>' + r.derivations.map(function (d) { return '<div class="bl-der"><b>' + esc(d.quantity) + ' = ' + esc(d.result) + (d.unit ? ' ' + esc(d.unit) : '') + tag(d.basis) + '</b><code>' + esc(d.formula) + '\n' + esc(d.working) + '</code></div>'; }).join('') + '</details>';
    pane.innerHTML = h;
  }
  function interp(pts, x) { for (var i = 1; i < pts.length; i++) if (x <= pts[i][0]) { var a = pts[i - 1], b = pts[i], t = (x - a[0]) / (b[0] - a[0] || 1); return a[1] + t * (b[1] - a[1]); } return pts[pts.length - 1][1]; }

  // ── events ─────────────────────────────────────────────────────────────────────────────────
  function bind() {
    var host = $('bl-card'); if (!host) return;
    host.addEventListener('click', function (e) {
      var rb = e.target.closest('[data-bl-role]');
      if (rb) { readCard(); S.role = rb.getAttribute('data-bl-role'); buildCard(); render(lastResult); return; }
      var del = e.target.closest('[data-bl-del]');
      if (del) { readCard(); var c = cur(); if (c.comps.length > 1) { c.comps.splice(+del.getAttribute('data-bl-del'), 1); buildCard(); changed(); } return; }
      if (e.target.id === 'bl-add') { readCard(); var c2 = cur(); if (c2.comps.length < 4) { var used = c2.comps.map(function (k) { return k.fibre; }), nxt = CAT.fibres.filter(function (f) { return used.indexOf(f.id) < 0; })[0]; c2.comps.push({ fibre: nxt ? nxt.id : 'viscose', share: 10, lustre: 'semi_dull' }); buildCard(); changed(); } return; }
      if (e.target.id === 'bl-open') { var tb = document.querySelector('.st-tabs [data-tab="blend"]'); if (tb) tb.click(); }
    });
    host.addEventListener('change', function (e) {
      var t = e.target;
      if (t.id === 'bl-preset') {
        var p = (CAT.presets || []).filter(function (x) { return x.id === t.value; })[0];
        if (p) { var c = cur(); c.enabled = true; c.preset = p.id; c.comps = Object.keys(p.fibres).map(function (f) { return { fibre: f, share: p.fibres[f], lustre: 'semi_dull' }; }); buildCard(); changed(); }
        return;
      }
      readCard();
      if (t.id === 'bl-on' || (t.getAttribute && t.getAttribute('data-f') === 'fibre')) buildCard();
      changed();
    });
    host.addEventListener('input', function (e) { var t = e.target; if (t.type === 'number') { readCard(); changed(); } });
  }
  // the Studio re-analyses on any change in the card (its own listener on #bl-card); we only keep the state
  function changed() { document.dispatchEvent(new Event('ka-blend')); }

  // ── the public side ────────────────────────────────────────────────────────────────────────
  function payload() {
    var out = {}, any = false;
    ROLES.forEach(function (r) {
      var c = S.specs[r[0]]; if (!c || !c.enabled) return;
      if (r[0] === S.role) readCard();
      out[r[0]] = specOf(c); any = true;
    });
    return any ? out : null;
  }
  function state() { readCard(); return JSON.parse(JSON.stringify(S)); }
  function setState(o) {
    S = o && o.specs ? JSON.parse(JSON.stringify(o)) : { role: 'ground', specs: {} };
    ROLES.forEach(function (r) { var c = S.specs[r[0]]; if (c) { var b = blank(); Object.keys(b).forEach(function (k) { if (c[k] === undefined) c[k] = b[k]; }); } });
    lastResult = null; buildCard(); render(null);
  }
  function setCatalogue(c) { CAT = c || null; buildCard(); }
  function studioResult(r) {
    lastResult = r && r.blend ? r.blend : null;
    summary(); render(lastResult);
    document.dispatchEvent(new Event('ka-blend-result'));
  }
  function forYarnView(role) {
    var c = S.specs[role], r = lastResult && lastResult[role];
    if (!c || !c.enabled || !r) return null;
    return { mix: r.studio_yarn.mix, label: r.identity.label };
  }
  function anyOn() { return ROLES.some(function (r) { return S.specs[r[0]] && S.specs[r[0]].enabled; }); }

  window.KAStudioBlend = { css: CSS, forYarnView: forYarnView, payload: payload, state: state, setState: setState, setCatalogue: setCatalogue, studioResult: studioResult, hasAny: anyOn };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { buildCard(); bind(); render(null); }); else { buildCard(); bind(); render(null); }
})();
