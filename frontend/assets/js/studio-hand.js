/**
 * Fabric Studio — the fabric hand card and its results tab.
 *
 * Left (the "Fabric hand" card, under the Yarn recovery card): the finish the cloth gets and the load the tensile numbers are read at.
 * Switched on, the Studio works out the tester-style physics numbers of the cloth it is showing — tensile, shear, bending,
 * compression, surface, weight — and what they say about how it feels (backend/engine/domain/fabric-hand-engine.js).
 *
 * Right (the "Fabric hand" tab): the hand in words and as five scores against a reference jersey; what each end use asks of it;
 * every group of numbers with its basis; the tensile curve; the same numbers in the second tester's terms; and the working.
 *
 * Plain script, no dependencies. window.KAStudioHand: payload(), state(), setState(), setCatalogue(c), studioResult(r)
 */
(function () {
  'use strict';
  var CAT = null, S = blank(), last = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function blank() { return { enabled: false, finish: 'none', load: '200' }; }
  function ensureCss() {
    if (!$('ml-css') && window.KAStudioMelange && window.KAStudioMelange.css) { var m = document.createElement('style'); m.id = 'ml-css'; m.textContent = window.KAStudioMelange.css; document.head.appendChild(m); }
    if (!$('bl-css') && window.KAStudioBlend && window.KAStudioBlend.css) { var b = document.createElement('style'); b.id = 'bl-css'; b.textContent = window.KAStudioBlend.css; document.head.appendChild(b); }
    if (!$('hd-css')) { var h = document.createElement('style'); h.id = 'hd-css'; h.textContent = '.hd-row{display:grid;grid-template-columns:104px 1fr 40px;gap:8px;align-items:center;margin:6px 0;font-size:13px}.hd-bar{position:relative;height:10px;border-radius:5px;background:rgba(127,127,127,.18)}.hd-bar i{position:absolute;left:0;top:0;bottom:0;border-radius:5px;background:#2f6fb0}.hd-bar u{position:absolute;top:-3px;bottom:-3px;width:2px;background:currentColor;opacity:.55}.hd-word{font-size:12px;opacity:.8;margin:-2px 0 6px 112px}.hd-chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.hd-chip{font-size:12px;padding:3px 8px;border-radius:12px;border:1px solid rgba(127,127,127,.35)}.hd-chip.ok{border-color:#2e8b57;color:#2e8b57}.hd-chip.no{border-color:#b5651d;color:#b5651d}'; document.head.appendChild(h); }
  }
  function opts(list, sel, key, lab) { return list.map(function (o) { var v = o[key], l = o[lab]; return '<option value="' + esc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join(''); }

  function buildCard() {
    var host = $('hd-card'); if (!host) return;
    ensureCss();
    if (!CAT) { host.innerHTML = '<div class="st-step"><b>2e</b> Fabric hand</div><p class="st-hint">Loading…</p>'; return; }
    var c = S;
    host.innerHTML = '<div class="st-step"><b>2e</b> Fabric hand — the numbers a tester reads, and how it feels</div>' +
      '<p class="st-hint" style="margin-top:0">Tensile, shear, bending, compression and surface numbers of the cloth you have drawn, from the yarn, the loops and the finish — and what they say about its hand, in words and as scores against a reference jersey.</p>' +
      '<label class="st-check"><input type="checkbox" id="hd-on"' + (c.enabled ? ' checked' : '') + '> Work out the hand of this cloth</label>' +
      '<div id="hd-body"' + (c.enabled ? '' : ' hidden') + '>' +
      '<div class="st-row"><div class="st-f"><label for="hd-fin">Chemical finish</label><select id="hd-fin">' + opts(CAT.finishes, c.finish, 'id', 'label') + '</select></div>' +
      '<div class="st-f"><label for="hd-load">Tensile read at</label><select id="hd-load">' + opts(CAT.loads, c.load, 'id', 'label') + '</select></div></div>' +
      '<p class="st-hint">Raising (brushing) is taken from the Finish: brushing choice in the Yarn card.</p>' +
      '<div class="ml-sum" id="hd-sum"></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button type="button" class="st-btn" id="hd-open">Open the hand analysis</button></div></div>';
    summary();
  }
  function readCard() {
    var on = $('hd-on'); if (!on) return;
    S.enabled = on.checked;
    if ($('hd-fin')) { S.finish = $('hd-fin').value; S.load = $('hd-load').value; }
  }
  function summary() {
    var el = $('hd-sum'); if (!el) return;
    if (!last) { el.textContent = S.enabled ? 'Worked out with the Studio\'s next answer.' : ''; return; }
    if (last.success === false) { el.textContent = last.error; return; }
    el.innerHTML = '<b>' + esc(last.hand.summary) + '</b><br>bending length ' + last.bending.bending_length.value + ' cm · ' + last.geometry.gsm + ' g/m² · thickness ' + last.compression.T0.value + ' mm';
  }

  function tag(t) { return t ? '<span class="ml-b ml-b-' + esc(t) + '">' + esc(t) + '</span>' : ''; }
  function val(o, d) { return o && o.value != null ? (d === undefined ? o.value : (+o.value).toFixed(d)) + (o.unit ? ' ' + esc(o.unit) : '') + tag(o.basis) : '—'; }
  function kpis(list) { return '<div class="bl-kpis">' + list.map(function (k) { return '<div class="bl-kpi"><b>' + esc(k[1]) + '</b><span>' + esc(k[0]) + (k[2] ? tag(k[2]) : '') + '</span></div>'; }).join('') + '</div>'; }
  function table(head, rows) { return '<div class="bl-scroll"><table class="ml-tbl"><tr>' + head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr>' + rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table></div>'; }
  function chart(w, l) {
    var W = 340, H = 150, x0 = 38, x1 = W - 10, y0 = 10, y1 = H - 24;
    var xs = w.steps.concat(l.steps).filter(function (p) { return p.stretch_pct != null; }), xm = Math.max(10, Math.max.apply(null, xs.map(function (p) { return p.stretch_pct; }))) * 1.05, ym = 500;
    var X = function (v) { return x0 + (x1 - x0) * Math.min(1, v / xm); }, Y = function (v) { return y1 - (y1 - y0) * Math.min(1, v / ym); };
    var path = function (st) { return st.filter(function (p) { return p.stretch_pct != null; }).map(function (p, i) { return (i ? 'L' : 'M') + X(p.stretch_pct).toFixed(1) + ' ' + Y(p.load_gf_cm).toFixed(1); }).join(''); };
    var g = '';
    [0, 100, 200, 300, 400, 500].forEach(function (v) { g += '<line x1="' + x0 + '" x2="' + x1 + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="currentColor" opacity=".12"/><text x="' + (x0 - 4) + '" y="' + (Y(v) + 3) + '" text-anchor="end" font-size="8" fill="currentColor" opacity=".65">' + v + '</text>'; });
    for (var t = 0; t <= xm; t += Math.max(10, Math.round(xm / 5 / 10) * 10)) g += '<text x="' + X(t) + '" y="' + (H - 10) + '" text-anchor="middle" font-size="8" fill="currentColor" opacity=".65">' + t + '</text>';
    return '<svg class="bl-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Load against stretch">' + g +
      '<path d="' + path(w.steps) + '" fill="none" stroke="#2f6fb0" stroke-width="1.8"/><path d="' + path(l.steps) + '" fill="none" stroke="#c98a12" stroke-width="1.8"/>' +
      '<text x="' + (x0 + (x1 - x0) / 2) + '" y="' + H + '" text-anchor="middle" font-size="8" fill="currentColor" opacity=".7">stretch, %  (load gf/cm up the side)</text></svg>' +
      '<div class="ml-rm"><span style="color:#2f6fb0">■</span> across the wales &nbsp; <span style="color:#c98a12">■</span> along the wales</div>';
  }

  var NAMES = [['stiffness', 'Stiffness', 'soft → stiff'], ['smoothness', 'Smoothness', 'rough → smooth'], ['fullness', 'Fullness', 'thin → bulky'], ['springiness', 'Springiness', 'dead → springy'], ['drape', 'Drape', 'stands off → fluid']];

  function render(r) {
    var pane = $('pane-hand'); if (!pane) return;
    ensureCss();
    if (!r) { pane.innerHTML = '<p class="st-p">Switch on “Work out the hand of this cloth” in the Fabric hand card (under Yarn) to see here: how the cloth feels in words and as scores, and the tensile, shear, bending, compression and surface numbers behind them.</p>'; return; }
    if (r.success === false) { pane.innerHTML = '<div class="ml-note warn">' + esc(r.error) + '</div>'; return; }
    var h = '', hd = r.hand, id = r.identity, ref = r.reference;
    h += '<div style="font:700 17px var(--head)">' + esc(id.structure) + ' — hand</div><div class="ml-note">' + id.yarn.count_ne + 's Ne (' + id.yarn.count_tex + ' tex), ' + esc(id.yarn.spinning) + '; ' + esc(id.finish.chemical) + (id.finish.brushed !== 'none' ? ', raised on the ' + esc(id.finish.brushed) : '') + '. ' + r.geometry.wales_per_cm + ' wales × ' + r.geometry.courses_per_cm + ' courses per cm, ' + r.geometry.gsm + ' g/m².</div>';
    r.warnings.forEach(function (w) { h += '<div class="ml-note' + (w.level === 'warn' ? ' warn' : '') + '">' + esc(w.text) + '</div>'; });
    h += '<div class="ml-h">How it feels</div><div style="font:600 15px var(--head);margin:4px 0 8px">' + esc(hd.summary) + '</div>';
    NAMES.forEach(function (n) { var s = hd.scores[n[0]]; h += '<div class="hd-row"><span>' + n[1] + '</span><span class="hd-bar" title="' + n[2] + '"><i style="width:' + s.score * 10 + '%"></i><u style="left:' + s.reference * 10 + '%" title="reference jersey"></u></span><b>' + s.score + '</b></div><div class="hd-word">' + esc(s.word) + ' · ' + (s.vs_reference >= 0 ? '+' : '') + s.vs_reference + ' against the reference jersey (the line)</div>'; });
    h += '<div class="ml-rm">' + esc(hd.note) + '</div>';
    h += '<div class="ml-h">What each end use asks of it</div><div class="hd-chips">' + hd.use_fit.map(function (u) { return '<span class="hd-chip ' + (u.fits ? 'ok' : 'no') + '">' + esc(u.label) + ': ' + esc(u.note) + '</span>'; }).join('') + '</div>';

    var b = r.bending, t = r.tensile, sh = r.shear, c = r.compression, su = r.surface;
    h += '<div class="ml-h">Bending</div>' + kpis([['Along the wales B', b.wale.value + ' gf·cm²/cm', 'blend'], ['Across B', b.course.value + ' gf·cm²/cm', 'blend'], ['Hysteresis 2HB', b.HB.value + ' gf·cm/cm', 'estimate'], ['Bending length', b.bending_length.value + ' cm', 'law']]) +
      '<div class="ml-rm">One yarn: ' + val(b.yarn_free) + '; ' + val(b.yarn_locked) + '. ' + esc(b.note) + '</div>';
    h += '<div class="ml-h">Tensile — read at ' + id.load_gf_cm + ' gf/cm</div>' + table(['', 'Across the wales', 'Along the wales'], [
      ['Stretch reached EMT %', t.width.EMT.value, t.length.EMT.value], ['Linearity LT', t.width.LT.value, t.length.LT.value], ['Energy WT gf·cm/cm²', t.width.WT.value, t.length.WT.value], ['Resilience RT %', t.width.RT.value, t.length.RT.value]]) +
      chart(t.width, t.length) + '<div class="ml-rm">' + esc(t.note) + '</div>';
    h += '<div class="ml-h">Shear</div>' + kpis([['Rigidity G', sh.G.value + ' gf/(cm·deg)', 'estimate'], ['Hysteresis 2HG', sh.HG.value + ' gf/cm', 'estimate'], ['2HG5', sh.HG5.value + ' gf/cm', 'estimate']]) + '<div class="ml-rm">' + esc(sh.note) + '</div>';
    h += '<div class="ml-h">Compression</div>' + kpis([['Thickness T0', c.T0.value + ' mm', 'estimate'], ['Under 50 gf/cm² Tm', c.Tm.value + ' mm', 'estimate'], ['Energy WC', c.WC.value + ' gf·cm/cm²', 'estimate'], ['Resilience RC', c.RC.value + ' %', 'estimate'], ['Linearity LC', c.LC.value, 'estimate'], ['Apparent density', c.apparent_density.value + ' g/cm³', 'law']]) + '<div class="ml-rm">' + esc(c.note) + '</div>';
    h += '<div class="ml-h">Surface and weight</div>' + kpis([['Friction MIU', su.MIU.value, 'estimate'], ['Variation MMD', su.MMD.value, 'estimate'], ['Roughness SMD', su.SMD.value + ' µm', 'estimate'], ['Weight W', r.weight.W.value + ' mg/cm²', 'law']]) + '<div class="ml-rm">' + esc(su.note) + '</div>';

    h += '<div class="ml-h">Against the reference jersey</div><div class="ml-note">' + esc(ref.label) + ' — bending ' + ref.ratios.bending + '×, shear ' + ref.ratios.shear + '×, thickness ' + ref.ratios.thickness + '×, roughness ' + ref.ratios.roughness + '×, compression energy ' + ref.ratios.compression_energy + '× the reference.</div>';
    var f = r.fast_style;
    h += '<div class="ml-h">The second tester\'s terms</div>' + table(['', 'Across', 'Along'], [['Extensibility at 5 gf/cm %', f.extensibility.width.E5, f.extensibility.length.E5], ['at 20 gf/cm %', f.extensibility.width.E20, f.extensibility.length.E20], ['at 100 gf/cm %', f.extensibility.width.E100, f.extensibility.length.E100]]) +
      '<div class="ml-rm">Bending length ' + f.bending_length_mm + ' mm · bending rigidity ' + f.bending_rigidity_uNm + ' µN·m · shear rigidity ' + f.shear_rigidity_N_m + ' N/m · thickness ' + f.thickness_mm.at_2_gf_cm2 + ' mm at 2 gf/cm², ' + f.thickness_mm.at_100_gf_cm2 + ' mm at 100. ' + esc(f.note) + '</div>';
    h += '<div class="ml-h">What rests on what</div><div class="ml-note">Law: ' + esc(r.basis.law.join('; ')) + '.<br>Measured: ' + esc(r.basis.measured.join('; ')) + '.<br>Estimated: ' + esc(r.basis.estimated.join('; ')) + '.<br>' + esc(r.basis.replaced_by) + '.</div>';
    h += '<div class="ml-h">Derivations</div><details><summary class="ml-note" style="cursor:pointer">Show the working (' + r.derivations.length + ')</summary>' + r.derivations.map(function (x) { return '<div class="bl-der"><b>' + esc(x.quantity) + ' = ' + esc(x.result) + (x.unit ? ' ' + esc(x.unit) : '') + tag(x.basis) + '</b><code>' + esc(x.formula) + '\n' + esc(x.working) + '</code></div>'; }).join('') + '</details>';
    pane.innerHTML = h;
  }

  function bind() {
    var host = $('hd-card'); if (host) {
      host.addEventListener('change', function (e) { readCard(); if (e.target.id === 'hd-on') buildCard(); });
      host.addEventListener('click', function (e) { if (e.target.id === 'hd-open') { var tb = document.querySelector('.st-tabs [data-tab="hand"]'); if (tb) tb.click(); } });
    }
  }
  function payload() { readCard(); if (!S.enabled) return null; return { enabled: true, finish: S.finish, load_gf_cm: parseFloat(S.load) || 200 }; }
  function state() { readCard(); return JSON.parse(JSON.stringify(S)); }
  function setState(o) { S = Object.assign(blank(), o || {}); last = null; buildCard(); render(null); }
  function setCatalogue(c) { CAT = c || null; buildCard(); }
  function studioResult(r) { last = r && r.hand ? r.hand : null; summary(); render(last); }

  window.KAStudioHand = { payload: payload, state: state, setState: setState, setCatalogue: setCatalogue, studioResult: studioResult };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { buildCard(); bind(); render(null); }); else { buildCard(); bind(); render(null); }
})();
