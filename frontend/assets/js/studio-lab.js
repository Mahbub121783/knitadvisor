/**
 * Fabric Studio — the virtual lab card and its results tab.
 *
 * Left (the "Virtual lab" card): switched on, the Studio runs the lab tests of the cloth it is showing — air permeability, thermal
 * resistance (Rct, clo), what each end use asks of both — and a hundred rolls of it: the spread of weight and width, Cp and Cpk, the
 * share of rolls in spec, a shade pass rate. A second switch works out the collar and cuff that match the body fabric.
 * (backend/engine/domain/virtual-lab-engine.js; the trim is worked out by the Studio itself.)
 *
 * Right (the "Lab" tab): the numbers with their basis, the end-use fit, the roll histogram, the trim table and the working.
 *
 * Plain script, no dependencies. window.KAStudioLab: payload(), trimPayload(), state(), setState(), setCatalogue(c), studioResult(r)
 */
(function () {
  'use strict';
  var CAT = null, S = blank(), last = null, lastTrim = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function blank() { return { enabled: false, trim: false, end_use: '', cv_count: '', tol_sl: '', cv_finish: '', spec: '' }; }
  function ensureCss() {
    if (!$('ml-css') && window.KAStudioMelange && window.KAStudioMelange.css) { var m = document.createElement('style'); m.id = 'ml-css'; m.textContent = window.KAStudioMelange.css; document.head.appendChild(m); }
    if (!$('bl-css') && window.KAStudioBlend && window.KAStudioBlend.css) { var b = document.createElement('style'); b.id = 'bl-css'; b.textContent = window.KAStudioBlend.css; document.head.appendChild(b); }
    if (!$('lb-css')) { var h = document.createElement('style'); h.id = 'lb-css'; h.textContent = '.lb-hist{display:flex;align-items:flex-end;gap:2px;height:84px;margin:6px 0}.lb-hist i{flex:1;background:var(--accent);border-radius:2px 2px 0 0;min-height:1px;opacity:.85}.lb-axis{display:flex;justify-content:space-between;font-size:11px;color:var(--t2)}.lb-chip{display:inline-block;padding:2px 8px;border-radius:99px;font:600 11px var(--head);margin:2px 4px 2px 0}.lb-chip.ok{background:rgba(30,122,84,.12);color:var(--good)}.lb-chip.no{background:rgba(154,91,0,.1);color:var(--warn)}'; document.head.appendChild(h); }
  }
  function opts(list, sel, key, lab) { return list.map(function (o) { var v = o[key], l = o[lab]; return '<option value="' + esc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join(''); }

  function buildCard() {
    var host = $('lb-card'); if (!host) return;
    ensureCss();
    if (!CAT) { host.innerHTML = '<div class="st-step"><b>2g</b> Virtual lab</div><p class="st-hint">Loading…</p>'; return; }
    var c = S, d = CAT.defaults;
    host.innerHTML = '<div class="st-step"><b>2g</b> Virtual lab — air, warmth and a hundred rolls</div>' +
      '<p class="st-hint" style="margin-top:0">The lab tests of a cloth that is only drawn: air permeability, thermal resistance, and how a hundred rolls of it will spread in weight, width and shade. Estimates until the mill\'s own readings replace them.</p>' +
      '<label class="st-check"><input type="checkbox" id="lb-on"' + (c.enabled ? ' checked' : '') + '> Run the lab on this cloth</label>' +
      '<div id="lb-body"' + (c.enabled ? '' : ' hidden') + '>' +
      '<div class="st-row one"><div class="st-f"><label for="lb-use">What the cloth is for</label><select id="lb-use"><option value="">Not chosen</option>' + opts(CAT.end_uses, c.end_use, 'id', 'label') + '</select></div></div>' +
      '<div class="st-row"><div class="st-f"><label for="lb-cvc">Yarn count spread (% 1σ)</label><input id="lb-cvc" type="number" min="0.2" max="6" step="0.1" placeholder="' + d.cv_count_pct + '" value="' + esc(c.cv_count) + '"></div>' +
      '<div class="st-f"><label for="lb-sl">Stitch-length tolerance (± mm)</label><input id="lb-sl" type="number" min="0.005" max="0.2" step="0.005" placeholder="' + d.tol_sl_mm + '" value="' + esc(c.tol_sl) + '"></div></div>' +
      '<div class="st-row"><div class="st-f"><label for="lb-cvf">Finishing spread (% 1σ)</label><input id="lb-cvf" type="number" min="0.2" max="6" step="0.1" placeholder="' + d.cv_finish_pct + '" value="' + esc(c.cv_finish) + '"></div>' +
      '<div class="st-f"><label for="lb-spec">Weight tolerance (± %)</label><input id="lb-spec" type="number" min="1" max="20" step="0.5" placeholder="' + d.spec_pct + '" value="' + esc(c.spec) + '"></div></div>' +
      '</div>' +
      '<label class="st-check"><input type="checkbox" id="lb-trim"' + (c.trim ? ' checked' : '') + '> Work out the matching collar and cuff</label>' +
      '<div class="ml-sum" id="lb-sum"></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button type="button" class="st-btn" id="lb-open">Open the lab</button></div>';
    summary();
  }
  function readCard() {
    var on = $('lb-on'); if (!on) return;
    S.enabled = on.checked; S.trim = $('lb-trim').checked;
    if ($('lb-use')) { S.end_use = $('lb-use').value; S.cv_count = $('lb-cvc').value; S.tol_sl = $('lb-sl').value; S.cv_finish = $('lb-cvf').value; S.spec = $('lb-spec').value; }
  }
  function summary() {
    var el = $('lb-sum'); if (!el) return;
    if (!last && !lastTrim) { el.textContent = (S.enabled || S.trim) ? 'Worked out with the Studio\'s next answer.' : ''; return; }
    var t = [];
    if (last && last.success !== false) t.push('<b>' + last.air.air_permeability.value + ' mm/s</b> air · <b>' + last.thermal.clo.value + ' clo</b> · weight Cpk ' + last.spc.gsm.cpk_centred.value + ' (' + esc(last.spc.word) + ')');
    else if (last) t.push(esc(last.error));
    if (lastTrim && lastTrim.collar) t.push('collar ' + esc(lastTrim.collar.yarn) + ' on ' + lastTrim.collar.gauge + ' GG');
    el.innerHTML = t.join('<br>');
  }

  function tag(t) { return t ? '<span class="ml-b ml-b-' + esc(t) + '">' + esc(t) + '</span>' : ''; }
  function val(o, d) { return o && o.value != null ? (d === undefined ? o.value : (+o.value).toFixed(d)) + (o.unit ? ' ' + esc(o.unit) : '') + tag(o.basis) : '—'; }
  function kpis(list) { return '<div class="bl-kpis">' + list.map(function (k) { return '<div class="bl-kpi"><b>' + esc(k[1]) + '</b><span>' + esc(k[0]) + (k[2] ? tag(k[2]) : '') + '</span></div>'; }).join('') + '</div>'; }
  function table(head, rows) { return '<div class="bl-scroll"><table class="ml-tbl"><tr>' + head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr>' + rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table></div>'; }

  function render() {
    var pane = $('pane-lab'); if (!pane) return;
    ensureCss();
    if (!last && !lastTrim) { pane.innerHTML = '<p class="st-p">Switch on “Run the lab on this cloth” or “Work out the matching collar and cuff” in the Virtual lab card (under Yarn) to see here: air permeability, thermal resistance, the spread of a hundred rolls, and the rib that goes with this body fabric.</p>'; return; }
    var h = '', r = last;
    if (r && r.success === false) h += '<div class="ml-note warn">' + esc(r.error) + '</div>';
    else if (r) {
      r.warnings.forEach(function (w) { h += '<div class="ml-note' + (w.level === 'warn' ? ' warn' : '') + '">' + esc(w.text) + '</div>'; });
      var a = r.air, t = r.thermal;
      h += '<div class="ml-h">Air permeability (100 Pa)</div>' + kpis([['Air permeability', a.air_permeability.value + ' mm/s', 'estimate'], ['In CFM', a.cfm.value, 'estimate'], ['Open area', a.open_area.value + ' %', 'law'], ['Hole side', a.hole_side.value + ' mm', 'law']]) +
        '<div class="ml-rm">' + esc(a.word) + ' — likely range ' + a.air_permeability.range[0] + '–' + a.air_permeability.range[1] + ' mm/s. ' + a.through_holes.value + ' mm/s through the holes between the loops, ' + a.through_fibre.value + ' mm/s through the fibre mass. Path thickness ' + a.thickness_in_path.value + ' mm.</div>';
      h += '<div class="ml-h">Thermal resistance</div>' + kpis([['Rct', t.rct.value + ' m²K/W', 'estimate'], ['Clo', t.clo.value, 'estimate'], ['Conductivity', t.conductivity.value + ' W/mK', 'estimate'], ['Fibre fraction', t.fibre_fraction.value, 'estimate']]) +
        '<div class="ml-rm">' + esc(t.word) + '. Dry, still air, the cloth alone (no air layers, no wind).</div>';
      h += '<div class="ml-h">What each end use asks of it</div><div>' + r.end_use.fits.map(function (u) { return '<span class="lb-chip ' + (u.fits ? 'ok' : 'no') + '" title="' + esc(u.note) + '">' + esc(u.label) + ': ' + (u.fits ? 'fits' : 'does not fit') + '</span>'; }).join('') + '</div>';
      var s = r.spc, g = s.gsm, mx = Math.max.apply(null, g.histogram.counts);
      h += '<div class="ml-h">A hundred rolls — weight</div>' + kpis([['Mean', g.mean.value + ' g/m²', 'estimate'], ['Spread 1σ', g.sigma_pct.value + ' %', 'law'], ['Cp', g.cp.value, 'law'], ['Cpk, set to target', g.cpk_centred.value, 'law'], ['Cpk, set from the Studio untried', g.cpk_untried.value, 'estimate'], ['In ±' + g.spec_pct + ' %', g.in_spec_pct.value + ' %', 'estimate'], ['In spec, untried', g.in_spec_untried_pct.value + ' %', 'estimate']]) +
        '<div class="lb-hist">' + g.histogram.counts.map(function (c) { return '<i style="height:' + Math.round(c / mx * 100) + '%" title="' + c + ' rolls"></i>'; }).join('') + '</div><div class="lb-axis"><span>' + g.histogram.from + '</span><span>g/m² — ' + s.rolls + ' rolls</span><span>' + g.histogram.to + '</span></div>' +
        '<div class="ml-rm">Capability: <b>' + esc(s.word) + '</b> (1.33 or more is the usual aim). Spreads: yarn count ' + val(s.spreads.yarn_count_cv_pct) + ', stitch length ' + val(s.spreads.stitch_length_cv_pct) + ' (' + esc(s.spreads.stitch_length_cv_pct.from) + '), finishing ' + val(s.spreads.finishing_cv_pct) + '. ' + esc(g.cpk_untried.note) + '.</div>';
      h += '<div class="ml-h">Width and shade</div>' + kpis([['Width spread 1σ', s.width.sigma_pct.value + ' %', 'law'], ['Width Cp (±' + s.width.spec_pct + ' %)', s.width.cp.value, 'law'], ['Rolls in width spec', s.width.in_spec_pct.value + ' %', 'estimate'], ['Shade within ΔE00 ' + s.shade.delta_e_tolerance, s.shade.pass_pct.value + ' %', 'estimate'], ['Mean roll ΔE00', s.shade.mean_delta_e.value, 'estimate']]);
      h += '<div class="ml-h">What rests on what</div><div class="ml-note">Law: ' + esc(r.basis.law.join('; ')) + '.<br>Estimated: ' + esc(r.basis.estimated.join('; ')) + '.<br>Replaced by: ' + esc(r.basis.replaced_by) + '.</div>';
      h += '<div class="ml-h">Derivations</div><details><summary class="ml-note" style="cursor:pointer">Show the working (' + r.derivations.length + ')</summary>' + r.derivations.map(function (x) { return '<div class="bl-der"><b>' + esc(x.quantity) + ' = ' + esc(x.result) + ' ' + esc(x.unit) + tag(x.basis) + '</b><div>' + esc(x.formula) + '</div><div class="ml-rm">' + esc(x.working) + '</div></div>'; }).join('') + '</details>';
    }
    var tr = lastTrim;
    if (tr) {
      h += '<div class="ml-h">Collar and cuff that match this body</div>';
      h += table(['', 'Structure', 'Yarn', 'Gauge', 'Dia"', 'GSM', 'Open width"', 'Stitch mm', 'Elastane'], [tr.collar, tr.cuff].filter(Boolean).map(function (x) { return x.error ? [x.label, x.error, '', '', '', '', '', '', ''] : [x.label, x.structure, x.yarn + ' (' + x.yarn_ne + 's Ne)', x.gauge + ' GG', x.dia, x.gsm, x.width_open_in, x.sl_mm, x.elastane_pct + ' % — ' + x.elastane]; }));
      h += tr.notes.map(function (n) { return '<div class="ml-note">' + esc(n) + '</div>'; }).join('') + '<div class="ml-rm">' + esc(tr.basis) + '</div>';
    }
    pane.innerHTML = h;
  }

  function bind() {
    var host = $('lb-card'); if (host) {
      host.addEventListener('change', function (e) { readCard(); if (e.target.id === 'lb-on') buildCard(); });
      host.addEventListener('click', function (e) { if (e.target.id === 'lb-open') { var tb = document.querySelector('.st-tabs [data-tab="lab"]'); if (tb) tb.click(); } });
    }
  }
  function num(v) { var n = parseFloat(v); return n > 0 ? n : undefined; }
  function payload() { readCard(); if (!S.enabled) return null; return { enabled: true, end_use: S.end_use || undefined, cv_count: num(S.cv_count), tol_sl_mm: num(S.tol_sl), cv_finish: num(S.cv_finish), spec_pct: num(S.spec) }; }
  function trimPayload() { readCard(); return S.trim ? { enabled: true } : null; }
  function state() { readCard(); return JSON.parse(JSON.stringify(S)); }
  function setState(o) { S = Object.assign(blank(), o || {}); last = null; lastTrim = null; buildCard(); render(); }
  function setCatalogue(c) { CAT = c || null; buildCard(); }
  function studioResult(r) { last = r && r.lab ? r.lab : null; lastTrim = r && r.trim ? r.trim : null; summary(); render(); }

  window.KAStudioLab = { payload: payload, trimPayload: trimPayload, state: state, setState: setState, setCatalogue: setCatalogue, studioResult: studioResult };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { buildCard(); bind(); render(); }); else { buildCard(); bind(); render(); }
})();
