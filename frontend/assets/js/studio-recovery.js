/**
 * Fabric Studio — the yarn recovery card and its results tab.
 *
 * Left (the "Yarn recovery" card, under the Yarn chemistry card): the strain the yarn is held at, how long it is held and
 * rested, the room (dry, humid, wet, hot-wet) and the creep load. Switched on, the Studio works out the recovery of every STAPLE
 * yarn the design uses, at the count it settled on (backend/engine/domain/yarn-recovery-engine.js).
 *
 * Right (the "Yarn recovery" tab): what the yarn gives back at once, after a rest and after a day, and the permanent set; the
 * recovery against strain; creep; stress relaxation; growth over cycles; mechanical conditioning; the four conditions; what the
 * knitting tension does and gives back; and what it means for the cloth — with the derivation of each figure.
 *
 * Plain script, no dependencies. window.KAStudioRecovery: payload(), state(), setState(), setCatalogue(c), studioResult(r)
 */
(function () {
  'use strict';
  var CAT = null, S = blank(), lastResult = null, role = 'ground';

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function blank() { return { enabled: false, strain: '2', hold: '', rest: '', condition: 'dry', load: '10', imposed: '' }; }
  function ensureCss() {
    if (!$('ml-css') && window.KAStudioMelange && window.KAStudioMelange.css) { var m = document.createElement('style'); m.id = 'ml-css'; m.textContent = window.KAStudioMelange.css; document.head.appendChild(m); }
    if (!$('bl-css') && window.KAStudioBlend && window.KAStudioBlend.css) { var b = document.createElement('style'); b.id = 'bl-css'; b.textContent = window.KAStudioBlend.css; document.head.appendChild(b); }
  }
  function opts(list, sel, key, lab) { return list.map(function (o) { var v = key != null ? o[key] : o[0], l = lab != null ? o[lab] : o[1]; return '<option value="' + esc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join(''); }

  function buildCard() {
    var host = $('rc-card'); if (!host) return;
    ensureCss();
    if (!CAT) { host.innerHTML = '<div class="st-step"><b>2d</b> Yarn recovery</div><p class="st-hint">Loading…</p>'; return; }
    var c = S;
    host.innerHTML = '<div class="st-step"><b>2d</b> Yarn recovery — what it gives back and keeps</div>' +
      '<p class="st-hint" style="margin-top:0">Elastic recovery and permanent set at any strain, creep, stress relaxation, growth over many stretches, and how a wet or hot-wet yarn behaves — from the fibres\' measured recovery, with the stiff fibres setting what the soft ones can give back.</p>' +
      '<label class="st-check"><input type="checkbox" id="rc-on"' + (c.enabled ? ' checked' : '') + '> Work out the recovery of my yarns</label>' +
      '<div id="rc-body"' + (c.enabled ? '' : ' hidden') + '>' +
      '<div class="st-row"><div class="st-f"><label for="rc-strain">Held at a strain of (%)</label><input id="rc-strain" type="number" min="0.2" max="30" step="0.1" value="' + esc(c.strain) + '"></div>' +
      '<div class="st-f"><label for="rc-cond">In a room that is</label><select id="rc-cond">' + opts(CAT.conditions, c.condition, 'id', 'label') + '</select></div></div>' +
      '<div class="st-row"><div class="st-f"><label for="rc-hold">Held for (s)</label><input id="rc-hold" type="number" min="1" step="1" placeholder="30" value="' + esc(c.hold) + '"></div>' +
      '<div class="st-f"><label for="rc-rest">Rested for (s)</label><input id="rc-rest" type="number" min="1" step="1" placeholder="60" value="' + esc(c.rest) + '"></div></div>' +
      '<div class="st-row"><div class="st-f"><label for="rc-load">Creep load (% of breaking)</label><input id="rc-load" type="number" min="1" max="90" step="1" value="' + esc(c.load) + '"></div>' +
      '<div class="st-f"><label for="rc-imp">Cycle strain (%)</label><input id="rc-imp" type="number" min="0.5" max="10" step="0.1" placeholder="2" value="' + esc(c.imposed) + '"></div></div>' +
      '<div class="ml-sum" id="rc-sum"></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button type="button" class="st-btn" id="rc-open">Open the recovery analysis</button></div></div>';
    summary();
  }
  function readCard() {
    var on = $('rc-on'); if (!on) return;
    S.enabled = on.checked;
    if ($('rc-strain')) { S.strain = $('rc-strain').value; S.condition = $('rc-cond').value; S.hold = $('rc-hold').value; S.rest = $('rc-rest').value; S.load = $('rc-load').value; S.imposed = $('rc-imp').value; }
  }
  function summary() {
    var el = $('rc-sum'); if (!el) return;
    var r = lastResult && (lastResult[role] || lastResult[Object.keys(lastResult)[0]]);
    if (!r) { el.textContent = S.enabled ? 'Worked out with the Studio\'s next answer.' : ''; return; }
    el.innerHTML = '<b>' + esc(r.identity.label) + '</b> · ' + esc(r.identity.condition.label) + '<br>recovers ' + r.recovery.recovery_after_rest.value + ' % at ' + r.recovery.at_strain_pct.value + ' % strain · set ' + r.recovery.permanent_set.value + ' % · growth ' + r.cloth.growth_tendency;
  }

  function tag(t) { return t ? '<span class="ml-b ml-b-' + esc(t) + '">' + esc(t) + '</span>' : ''; }
  function val(o, d) { return o && o.value != null ? (d === undefined ? o.value : (+o.value).toFixed(d)) + (o.unit ? ' ' + esc(o.unit) : '') + tag(o.basis) : '—'; }
  function kpis(list) { return '<div class="bl-kpis">' + list.map(function (k) { return '<div class="bl-kpi"><b>' + esc(k[1]) + '</b><span>' + esc(k[0]) + (k[2] ? tag(k[2]) : '') + '</span></div>'; }).join('') + '</div>'; }
  function table(head, rows) { return '<div class="bl-scroll"><table class="ml-tbl"><tr>' + head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr>' + rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table></div>'; }
  var COLS = ['#2f6fb0', '#c98a12', '#2e8b57', '#9a4bb0'];
  function lineChart(opt) {
    var W = 340, H = 140, x0 = 38, x1 = W - 10, y0 = 10, y1 = H - 22;
    var X = function (v) { return x0 + (x1 - x0) * (opt.xlog ? Math.log10(1 + v) / Math.log10(1 + opt.xmax) : v / opt.xmax); }, Yv = function (v) { return y1 - (y1 - y0) * Math.min(1, Math.max(0, (v - (opt.ymin || 0)) / (opt.ymax - (opt.ymin || 0)))); };
    var path = function (pts) { return pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Yv(p[1]).toFixed(1); }).join(''); };
    var g = '';
    for (var i = 0; i <= 4; i++) { var v = (opt.ymin || 0) + (opt.ymax - (opt.ymin || 0)) * i / 4; g += '<line x1="' + x0 + '" x2="' + x1 + '" y1="' + Yv(v) + '" y2="' + Yv(v) + '" stroke="currentColor" opacity=".12"/><text x="' + (x0 - 4) + '" y="' + (Yv(v) + 3) + '" text-anchor="end" font-size="8" fill="currentColor" opacity=".65">' + (Math.round(v * 10) / 10) + '</text>'; }
    (opt.ticks || []).forEach(function (t) { g += '<text x="' + X(t[0]) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="8" fill="currentColor" opacity=".65">' + esc(t[1]) + '</text>'; });
    var lines = opt.series.map(function (s, k) { return '<path d="' + path(s.pts) + '" fill="none" stroke="' + (s.color || COLS[k % 4]) + '" stroke-width="' + (s.w || 1.6) + '"' + (s.dash ? ' stroke-dasharray="4 3"' : '') + '/>'; }).join('');
    return '<svg class="bl-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opt.label) + '">' + g + lines + '<text x="' + (x0 + (x1 - x0) / 2) + '" y="' + H + '" text-anchor="middle" font-size="8" fill="currentColor" opacity=".7">' + esc(opt.xl) + '</text></svg>' +
      (opt.legend ? '<div class="ml-rm">' + opt.legend.map(function (l, i) { return '<span style="color:' + COLS[i % 4] + '">■</span> ' + esc(l); }).join(' &nbsp; ') + '</div>' : '');
  }

  function render(res) {
    var pane = $('pane-recovery'); if (!pane) return;
    ensureCss();
    var roles = res ? Object.keys(res) : [];
    if (!roles.length) { pane.innerHTML = '<p class="st-p">Switch on “Work out the recovery of my yarns” in the Yarn recovery card (under Yarn) to see here: what the yarn gives back and keeps, creep, relaxation, growth over cycles, and what it means for the cloth. (A filament yarn is not a staple yarn: its recovery is its fibre\'s, in the fibre table.)</p>'; return; }
    if (!res[role]) role = roles[0];
    var r = res[role], h = '';
    if (roles.length > 1) h += '<div class="ml-seg" role="group">' + roles.map(function (k) { return '<button type="button" data-rc-role="' + esc(k) + '" class="' + (k === role ? 'on' : '') + '">' + esc(({ ground: 'Face / ground', binder: 'Binder', loop: 'Loop', plate: 'Plated' })[k] || k) + '</button>'; }).join('') + '</div>';
    var rc = r.recovery;
    h += '<div style="font:700 17px var(--head)">' + esc(r.identity.label) + ' — recovery</div><div class="ml-note">' + r.identity.count.ne + 's Ne (' + r.identity.count.tex + ' tex), ' + esc(r.identity.spinning) + '; ' + esc(r.identity.condition.label) + '. The mean fibre angle is ' + r.identity.mean_fibre_angle + '°.</div>';
    if (r.warnings.length) h += r.warnings.map(function (w) { return '<div class="ml-note warn">' + esc(w.text) + '</div>'; }).join('');
    h += '<div class="ml-h">What it gives back at ' + rc.at_strain_pct.value + ' % strain (held ' + rc.hold_s + ' s, rested ' + rc.rest_s + ' s)</div>' + kpis([
      ['Recovered at once', rc.immediate_recovery.value + ' %', 'blend'], ['After the rest', rc.recovery_after_rest.value + ' %', 'blend'], ['After a day', rc.recovery_after_a_day.value + ' %', 'blend'],
      ['Permanent set', rc.permanent_set.value + ' %', 'blend'], ['Standard test', rc.standard_test.value + ' %', 'blend'], ['Growth after 1000 cycles', r.cloth.yarn_growth_after_1000_cycles.value + ' %', 'blend']]);
    h += '<div class="ml-note">' + esc(rc.note) + '</div>';
    h += table(['Fibre', 'Mass share %', 'Stiffness share %', 'Recovery %', 'Set % of its strain', 'Table'], rc.by_fibre.map(function (f) { return [f.label, f.mass_share_pct, f.stiffness_share_pct, f.recovery_pct, f.set_pct_of_fibre_strain, f.table_basis]; })) +
      '<div class="ml-rm">A mass-weighted mean would give a set of ' + rc.mass_weighted_set.value + ' %; the stiffness-weighted set that the mechanics gives is ' + rc.set_after_rest.value + ' %.</div>';
    // recovery curve
    var cv = rc.curve;
    h += '<div class="ml-h">Recovery against strain</div>' + lineChart({ xmax: cv[cv.length - 1].strain_pct, ymin: 0, ymax: 100, label: 'Recovery against strain', xl: 'strain, %', ticks: cv.filter(function (_, i) { return i % 2 === 0; }).map(function (p) { return [p.strain_pct, p.strain_pct]; }),
      series: [{ pts: cv.map(function (p) { return [p.strain_pct, p.recovery_pct]; }) }, { pts: cv.map(function (p) { return [p.strain_pct, p.recovery_24h_pct]; }), dash: true }, { pts: cv.map(function (p) { return [p.strain_pct, p.recovery_conditioned_pct]; }) }], legend: ['after the rest', 'after a day', 'after conditioning (second loading)'] });
    h += table(['Strain %', 'Recovery %', 'Set %', 'After a day %', 'Conditioned %'], cv.map(function (p) { return [p.strain_pct, p.recovery_pct, p.set_pct, p.recovery_24h_pct, p.recovery_conditioned_pct]; }));
    // creep
    var cr = r.creep;
    h += '<div class="ml-h">Creep under a constant load</div><dl class="ml-kv"><dt>Load</dt><dd>' + val(cr.load) + ' = ' + val(cr.load_cn) + '</dd><dt>Instantaneous strain</dt><dd>' + val(cr.instantaneous_strain) + '</dd><dt>Creep per decade of time</dt><dd>' + val(cr.creep_per_decade) + '</dd><dt>Primary (recoverable) share</dt><dd>' + val(cr.primary_share) + '</dd></dl>' +
      lineChart({ xmax: 8640000, xlog: true, ymin: Math.min.apply(null, cr.rows.map(function (x) { return x.strain_pct; })) * 0.9, ymax: Math.max.apply(null, cr.rows.map(function (x) { return x.strain_pct; })) * 1.05, label: 'Strain against time under load', xl: 'time under load (log scale)', ticks: cr.rows.filter(function (_, i) { return i % 2 === 0; }).map(function (x) { return [x.seconds, x.time]; }), series: [{ pts: cr.rows.map(function (x) { return [x.seconds, x.strain_pct]; }) }] }) +
      table(['Time', 'Strain %', 'Creep %', 'Set after unloading %'], cr.rows.map(function (x) { return [x.time, x.strain_pct, x.creep_pct, x.set_after_unloading_pct]; })) + '<div class="ml-rm">' + esc(cr.note) + '</div>';
    // relaxation
    var rl = r.relaxation;
    h += '<div class="ml-h">Stress relaxation at a held strain</div><dl class="ml-kv"><dt>Per decade of time</dt><dd>' + val(rl.per_decade) + '</dd></dl>' +
      lineChart({ xmax: 8640000, xlog: true, ymin: 0, ymax: 100, label: 'Stress remaining against time', xl: 'time held (log scale)', ticks: rl.rows.filter(function (_, i) { return i % 2 === 0; }).map(function (x) { return [x.seconds, x.time]; }), series: [{ pts: rl.rows.map(function (x) { return [x.seconds, x.stress_remaining_pct]; }) }] }) + '<div class="ml-rm">' + esc(rl.note) + '</div>';
    // cycles
    var cy = r.cyclic;
    h += '<div class="ml-h">Growth over stretch cycles (at ' + cy.imposed_strain.value + ' % imposed strain)</div>' + table(['Cycles', 'Yarn growth %'].concat(Object.keys(cy.rows[0].by_fibre).map(function (f) { return f + ' %'; })), cy.rows.map(function (x) { return [x.cycles, x.growth_pct].concat(Object.keys(x.by_fibre).map(function (f) { return x.by_fibre[f]; })); })) +
      '<div class="ml-note">' + (cy.cycles_to_break ? 'Cycles to break at 2 % imposed extension: ' + val(cy.cycles_to_break) + ' (' + esc(cy.cycles_to_break.governed_by) + ' governs). ' : '') + esc(cy.note) + '</div>';
    // conditioning & conditions
    var cd = r.conditioning;
    h += '<div class="ml-h">Mechanical conditioning</div><dl class="ml-kv"><dt>First loading</dt><dd>' + val(cd.first_loading) + '</dd><dt>Second loading</dt><dd>' + val(cd.second_loading) + '</dd><dt>Set after ÷ before</dt><dd>' + val(cd.set_ratio, 2) + '</dd></dl><div class="ml-rm">' + esc(cd.note) + '</div>';
    h += '<div class="ml-h">The same yarn in four rooms</div>' + table(['Room', 'Recovery %', 'Set %', 'Creep per decade %', 'Relaxation per decade %'], r.conditions.map(function (x) { return [x.label, x.recovery_pct, x.set_pct, x.creep_per_decade_pct, x.relaxation_per_decade_pct]; }));
    // knitting & cloth
    var k = r.knitting, c = r.cloth;
    h += '<div class="ml-h">Knitting</div><dl class="ml-kv"><dt>Running tension</dt><dd>' + val(k.running_tension) + '</dd><dt>Yarn strain</dt><dd>' + val(k.yarn_strain) + '</dd><dt>Given back in finishing</dt><dd>' + val(k.returned_in_finishing) + '</dd><dt>Set left</dt><dd>' + val(k.set_left_in_the_yarn) + '</dd></dl><div class="ml-rm">' + esc(k.note) + '</div>';
    h += '<div class="ml-h">What it means for the cloth</div><dl class="ml-kv"><dt>Growth tendency</dt><dd><b>' + esc(c.growth_tendency) + '</b> (' + val(c.yarn_growth_after_1000_cycles) + ' after 1000 cycles)</dd><dt>Recovery</dt><dd>' + esc(c.recovery_class) + '</dd></dl><div class="ml-note">' + esc(c.note) + '</div>' + (c.elastane ? '<div class="ml-note"><b>Elastane ' + c.elastane.share_pct + ' %:</b> ' + esc(c.elastane.note) + '</div>' : '') + c.advice.map(function (a) { return '<div class="ml-note warn">⚠ ' + esc(a) + '</div>'; }).join('');
    h += '<div class="ml-h">Derivations</div><details><summary class="ml-note" style="cursor:pointer">Show the working (' + r.derivations.length + ')</summary>' + r.derivations.map(function (x) { return '<div class="bl-der"><b>' + esc(x.quantity) + ' = ' + esc(x.result) + (x.unit ? ' ' + esc(x.unit) : '') + tag(x.basis) + '</b><code>' + esc(x.formula) + '\n' + esc(x.working) + '</code></div>'; }).join('') + '</details>';
    pane.innerHTML = h;
  }

  function bind() {
    var host = $('rc-card'); if (host) {
      host.addEventListener('change', function (e) { readCard(); if (e.target.id === 'rc-on') buildCard(); });
      host.addEventListener('input', function (e) { if (e.target.type === 'number') readCard(); });
      host.addEventListener('click', function (e) { if (e.target.id === 'rc-open') { var tb = document.querySelector('.st-tabs [data-tab="recovery"]'); if (tb) tb.click(); } });
    }
    var pane = $('pane-recovery'); if (pane) pane.addEventListener('click', function (e) { var b = e.target.closest('[data-rc-role]'); if (b) { role = b.getAttribute('data-rc-role'); render(lastResult); summary(); } });
  }
  function payload() {
    readCard();
    if (!S.enabled) return null;
    var n = function (x) { var v = parseFloat(x); return v > 0 ? v : undefined; };
    return { enabled: true, strain_pct: n(S.strain), hold_s: n(S.hold), rest_s: n(S.rest), condition: S.condition, load_pct: n(S.load), imposed_strain_pct: n(S.imposed) };
  }
  function state() { readCard(); return JSON.parse(JSON.stringify(S)); }
  function setState(o) { S = Object.assign(blank(), o || {}); lastResult = null; buildCard(); render(null); }
  function setCatalogue(c) { CAT = c || null; buildCard(); }
  function studioResult(r) { lastResult = r && r.recovery ? r.recovery : null; summary(); render(lastResult); }

  window.KAStudioRecovery = { payload: payload, state: state, setState: setState, setCatalogue: setCatalogue, studioResult: studioResult };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { buildCard(); bind(); render(null); }); else { buildCard(); bind(); render(null); }
})();
