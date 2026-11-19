/**
 * Fabric Studio — the inspection room: the card and its results tab.
 *
 * Left (the "Inspect" card): switched on, the Studio puts the cloth in front of four inspections (backend lightbox-engine.js, burnout-engine.js,
 * defects-engine.js): the LIGHTBOX (the colour under daylight, the two shop fluorescents, tungsten and a black light; the brightener; colour
 * inconstancy; metamerism), the BURNOUT LAB (which reagent dissolves which fibre, what is left), BARRÉ (stripes across the cloth from feeder-to-feeder
 * spread) and GRINNING (a back yarn showing through the face).
 *
 * Right (the "Inspect" tab): the swatches and the numbers, each with its basis.
 *
 * Plain script, no dependencies. window.KAStudioInspect: payload(), state(), setState(), setCatalogue(c), studioResult(r), tint(id)
 */
(function () {
  'use strict';
  var CAT = null, S = blank(), last = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function blank() { return { enabled: false, back: '', tol: '', cv: '' }; }
  function ensureCss() {
    if (!$('ml-css') && window.KAStudioMelange && window.KAStudioMelange.css) { var m = document.createElement('style'); m.id = 'ml-css'; m.textContent = window.KAStudioMelange.css; document.head.appendChild(m); }
    if (!$('bl-css') && window.KAStudioBlend && window.KAStudioBlend.css) { var b = document.createElement('style'); b.id = 'bl-css'; b.textContent = window.KAStudioBlend.css; document.head.appendChild(b); }
    if (!$('in-css')) { var h = document.createElement('style'); h.id = 'in-css'; h.textContent = '.in-sw{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;margin:8px 0}.in-sw div{border-radius:8px;overflow:hidden;border:1px solid var(--line,#d7dbe0);font-size:11px}.in-sw i{display:block;height:54px}.in-sw span{display:block;padding:4px 6px;color:var(--t2)}.in-sw b{color:var(--t1);display:block}.in-stripes{height:90px;border-radius:8px;overflow:hidden;border:1px solid var(--line,#d7dbe0);display:flex;flex-direction:column}.in-stripes i{flex:1}.in-pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}.in-pair small{display:block;color:var(--t2);font-size:11px;margin-bottom:2px}'; document.head.appendChild(h); }
  }

  function buildCard() {
    var host = $('in-card'); if (!host) return;
    ensureCss();
    var c = S;
    host.innerHTML = '<div class="st-step"><b>2h</b> Inspect — lights, burnout, stripes, grin</div>' +
      '<p class="st-hint" style="margin-top:0">Put the cloth in front of the inspector: its colour under daylight, the shop lights, tungsten and a black light; which chemical dissolves which fibre; whether feeder differences will draw stripes (barré); and whether a back yarn will show through (grinning). Estimates until the mill\'s own readings replace them.</p>' +
      '<label class="st-check"><input type="checkbox" id="in-on"' + (c.enabled ? ' checked' : '') + '> Inspect this cloth</label>' +
      '<div id="in-body"' + (c.enabled ? '' : ' hidden') + '>' +
      '<div class="st-row"><div class="st-f"><label for="in-back">Back / binder yarn colour</label><input id="in-back" type="text" maxlength="7" placeholder="#f4f4f0" value="' + esc(c.back) + '"></div>' +
      '<div class="st-f"><label for="in-tol">Feeder loop tolerance (± mm)</label><input id="in-tol" type="number" min="0.002" max="0.3" step="0.005" placeholder="0.03" value="' + esc(c.tol) + '"></div></div>' +
      '<div class="st-row one"><div class="st-f"><label for="in-cv">Yarn count spread between packages (% 1σ)</label><input id="in-cv" type="number" min="0.1" max="6" step="0.1" placeholder="0.8" value="' + esc(c.cv) + '"></div></div>' +
      '<p class="st-hint">The face colour is the one you set under Look or Colour; without one, a typical shade. Give the back yarn\'s colour only if it is not the face colour.</p>' +
      '<div class="ml-sum" id="in-sum"></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button type="button" class="st-btn" id="in-open">Open the inspection</button></div></div>';
    summary();
  }
  function readCard() {
    var on = $('in-on'); if (!on) return;
    S.enabled = on.checked;
    if ($('in-back')) { S.back = $('in-back').value.trim(); S.tol = $('in-tol').value; S.cv = $('in-cv').value; }
  }
  function summary() {
    var el = $('in-sum'); if (!el) return;
    if (!last) { el.textContent = S.enabled ? 'Worked out with the Studio\'s next answer.' : ''; return; }
    if (last.success === false) { el.textContent = last.error; return; }
    var t = [];
    if (last.lightbox && last.lightbox.success !== false) t.push('colour moves ΔE <b>' + last.lightbox.inconstancy_index.value + '</b> to the shop lights · metamerism risk <b>' + esc(last.lightbox.metamerism.risk) + '</b>');
    if (last.barre) t.push('barré: <b>' + esc(last.barre.risk) + '</b> (ΔL* ' + last.barre.lightness_step.value + ')');
    if (last.grinning && last.grinning.applicable) t.push('grinning: <b>' + esc(last.grinning.status) + '</b>');
    el.innerHTML = t.join('<br>');
  }

  function tag(t) { return t ? '<span class="ml-b ml-b-' + esc(t) + '">' + esc(t) + '</span>' : ''; }
  function kpis(list) { return '<div class="bl-kpis">' + list.map(function (k) { return '<div class="bl-kpi"><b>' + esc(k[1]) + '</b><span>' + esc(k[0]) + (k[2] ? tag(k[2]) : '') + '</span></div>'; }).join('') + '</div>'; }
  function table(head, rows) { return '<div class="bl-scroll"><table class="ml-tbl"><tr>' + head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr>' + rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table></div>'; }
  function notes(list) { return (list || []).map(function (w) { return '<div class="ml-note' + (w.level === 'warn' ? ' warn' : '') + '">' + esc(w.text) + '</div>'; }).join(''); }

  function stripes(dl, k) {
    var base = 58;
    return '<div class="in-stripes">' + dl.map(function (v) { var L = Math.max(5, Math.min(95, base + v * k)); return '<i style="background:hsl(215,10%,' + L.toFixed(1) + '%)"></i>'; }).join('') + '</div>';
  }

  function render() {
    var pane = $('pane-inspect'); if (!pane) return;
    ensureCss();
    if (!last) { pane.innerHTML = '<p class="st-p">Switch on “Inspect this cloth” in the Inspect card (under Yarn) to see here: the cloth under daylight, TL84, CWF, tungsten and a black light; the burnout lab; barré; and grinning.</p>'; return; }
    if (last.success === false) { pane.innerHTML = '<div class="ml-note warn">' + esc(last.error) + '</div>'; return; }
    var h = '', lb = last.lightbox, bo = last.burnout, br = last.barre, gr = last.grinning;
    h += '<div class="ml-note">Face colour <b>' + esc(last.colour.hex) + '</b> — ' + esc(last.colour.source) + '.</div>';
    if (lb && lb.success !== false) {
      h += '<div class="ml-h">Lightbox</div>' + notes(lb.warnings);
      h += '<div class="in-sw">' + lb.illuminants.map(function (i) { return '<div><i style="background:' + esc(i.swatch) + '"></i><span><b>' + esc(i.id) + '</b>' + (i.delta_e_vs_d65 != null ? 'ΔE ' + i.delta_e_vs_d65 + ' from D65' : 'glow only') + '</span></div>'; }).join('') + '</div>';
      h += table(['Light', 'CCT K', 'L*', 'a*', 'b*', 'ΔE2000 from D65', 'Brightener Δb*', 'Where it matters'], lb.illuminants.map(function (i) { return [i.label, i.cct_k || '—', i.lab[0], i.lab[1], i.lab[2], i.delta_e_vs_d65 == null ? '—' : i.delta_e_vs_d65, i.oba ? i.oba.delta_b : '—', i.use]; }));
      h += kpis([['Colour inconstancy', lb.inconstancy_index.value + ' ΔE', 'estimate'], ['Metamerism risk', lb.metamerism.risk, lb.metamerism.basis], ['Brightener', lb.oba ? 'level ' + lb.oba.level : 'none', lb.oba ? 'estimate' : null]]);
      var mm = lb.metamerism;
      h += '<div class="ml-note' + (mm.risk === 'high' ? ' warn' : '') + '">' + esc(mm.verdict) + (mm.need ? '. ' + esc(mm.need) : '') + '</div>';
      if (mm.per_source) h += table(['Source', 'ΔE2000 between the two dyed curves'], mm.per_source.map(function (x) { return [x.label, x.delta_e]; }));
      h += '<div class="ml-rm">The swatches show the cloth with the cast of each light only partly discounted (as an eye adapts): an illustration. The numbers are Lab adapted to daylight (Bradford). ' + esc(lb.reconstruction.note) + ' (error ΔE ' + lb.reconstruction.error_de + ').</div>';
    }
    h += '<div class="ml-h">Burnout lab</div><div class="ml-note">Fibres: ' + esc(Object.keys(bo.fibres).map(function (k) { return k + ' ' + bo.fibres[k] + ' %'; }).join(', ')) + '. ' + esc(bo.note) + '</div>';
    h += table(['Reagent', 'Takes', 'Weight left', 'g/m² left', 'Left behind', 'What happens'], bo.reagents.map(function (r) { return [r.label, r.dissolves.join(', ') || (r.attacks.length ? 'partial only' : '—'), r.weight_left_pct + ' %', r.gsm_after == null ? '—' : r.gsm_after, Object.keys(r.residue).map(function (k) { return k + ' ' + r.residue[k] + ' %'; }).join(', '), r.word]; }));
    var best = bo.reagents.filter(function (r) { return r.id === bo.suggested; })[0];
    if (best) h += '<div class="ml-note"><b>' + esc(best.label) + '</b> (' + esc(best.conditions) + '): ' + esc(best.use) + ' <i>' + esc(best.hazard) + '</i>' + (best.feeds.length ? '<br>Feeds: ' + best.feeds.map(function (f) { return 'feed ' + f.feed + ' (' + esc(f.role) + ') ' + f.yarn_gone_pct + ' % gone' + (f.vanishes ? ' — vanishes' : ''); }).join('; ') + (best.holds_together === false ? '. <b>What is left cannot hold together.</b>' : '') : '') + '</div>';
    h += '<div class="ml-rm">' + esc(bo.basis.replaced_by ? 'Typical solubility; replaced by ' + bo.basis.replaced_by + '.' : '') + '</div>';
    h += '<div class="ml-h">Barré</div>' + notes(br.warnings) + kpis([['Cover spread, one feeder', br.cover_spread_pct.value + ' %', 'law'], ['Lightness step', 'ΔL* ' + br.lightness_step.value, 'estimate'], ['Visibility', br.risk, 'estimate'], ['Tolerance that stays invisible', '±' + br.tolerance_for_invisible_mm.value + ' mm', 'estimate']]);
    h += '<div class="in-pair"><div><small>As it is (one revolution of feeders, repeated)</small>' + stripes(br.profile.delta_l, 1) + '</div><div><small>Exaggerated ×5, to see the pattern</small>' + stripes(br.profile.delta_l, 5) + '</div></div>';
    h += '<div class="ml-rm">Spreads: loop length ±' + br.inputs.tol_sl_mm + ' mm taken as ±3σ, count ' + br.inputs.cv_count_pct + ' %. Seen from ΔL* ' + br.thresholds.visible + ', obvious from ' + br.thresholds.obvious + ' (estimates). Peak to peak across the feeders ' + br.profile.peak_to_peak + '.</div>';
    h += '<div class="ml-h">Grinning</div>';
    if (!gr.applicable) h += '<div class="ml-note">' + esc(gr.text) + '</div>';
    else if (gr.status === 'not_checked') h += '<div class="ml-note">' + esc(gr.text) + '</div>';
    else h += '<div class="ml-note' + (gr.status === 'warn' ? ' warn' : '') + '">' + esc(gr.text) + (gr.repair ? ' ' + esc(gr.repair) : '') + '</div>' + kpis([['Face to back yarn', gr.delta_e.value + ' ΔE', 'law'], ['Back visible at rest', gr.visible_back_pct.rest.value + ' %', 'estimate'], ['at 20 % stretch', gr.visible_back_pct.s20.value + ' %', 'estimate'], ['at 40 % stretch', gr.visible_back_pct.s40.value + ' %', 'estimate'], ['Porosity at 20 %', gr.porosity_pct.s20 + ' %', 'law']]) + '<div class="ml-rm">' + esc(gr.rule) + '.</div>';
    pane.innerHTML = h;
  }

  function bind() {
    var host = $('in-card'); if (host) {
      host.addEventListener('change', function (e) { readCard(); if (e.target.id === 'in-on') buildCard(); });
      host.addEventListener('input', function (e) { if (e.target.id === 'in-back') readCard(); });
      host.addEventListener('click', function (e) { if (e.target.id === 'in-open') { var tb = document.querySelector('.st-tabs [data-tab="inspect"]'); if (tb) tb.click(); } });
    }
  }
  function num(v) { var n = parseFloat(v); return n > 0 ? n : undefined; }
  function payload() { readCard(); if (!S.enabled) return null; return { enabled: true, back_colour: /^#[0-9a-f]{6}$/i.test(S.back) ? S.back : undefined, tol_sl_mm: num(S.tol), cv_count: num(S.cv) }; }
  function state() { readCard(); return JSON.parse(JSON.stringify(S)); }
  function setState(o) { S = Object.assign(blank(), o || {}); last = null; buildCard(); render(); }
  function setCatalogue(c) { CAT = c || null; }
  function studioResult(r) { last = r && r.inspect ? r.inspect : null; summary(); render(); }
  // the colour of a source's white relative to daylight (for the 3D light): from the catalogue
  function tint(id) { var s = CAT && CAT.lightbox && CAT.lightbox.sources.filter(function (x) { return x.id === id; })[0]; return s && s.tint ? s.tint : [1, 1, 1]; }

  window.KAStudioInspect = { payload: payload, state: state, setState: setState, setCatalogue: setCatalogue, studioResult: studioResult, tint: tint };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { buildCard(); bind(); render(); }); else { buildCard(); bind(); render(); }
})();
