/**
 * Fabric Studio — the fancy yarn card and its results tab (slub, flame, nep, bouclé, chenille, air-jet textured, filament core-spun).
 *
 * Left (the "Fancy yarn" card, under the Blend yarn card): which effect a yarn role carries and the parameters of that effect. While it
 * is on, the role's yarn takes that form: the Studio knits the cloth with it, and the 3D Yarn view draws the effect — the thick places, the
 * knots, the loops, the pile, the filament core — from the same numbers (backend/engine/domain/fancy-yarn-engine.js).
 *
 * Right (the "Fancy yarn" tab): the count and the parts it is made of, where the mass is, what carries the load, the evenness the effect
 * makes, the diameter it sets, the hand, the finest gauge it will pass, and the derivation of each figure.
 *
 * Plain script, no dependencies. window.KAStudioFancy: payload(), state(), setState(), setCatalogue(c), studioResult(r), forYarnView(role)
 */
(function () {
  'use strict';
  var CAT = null, ROLES = [['ground', 'Face / ground'], ['binder', 'Binder'], ['loop', 'Loop']];
  var S = { role: 'ground', specs: {} }, lastResult = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function blank() { return { enabled: false, form: 'slub', params: {} }; }
  function cur() { return S.specs[S.role] || (S.specs[S.role] = blank()); }
  function ensureCss() {
    if (!$('ml-css') && window.KAStudioMelange && window.KAStudioMelange.css) { var m = document.createElement('style'); m.id = 'ml-css'; m.textContent = window.KAStudioMelange.css; document.head.appendChild(m); }
    if (!$('bl-css') && window.KAStudioBlend && window.KAStudioBlend.css) { var b = document.createElement('style'); b.id = 'bl-css'; b.textContent = window.KAStudioBlend.css; document.head.appendChild(b); }
  }
  function opts(list, sel, key, lab) { return list.map(function (o) { var v = key != null ? o[key] : o[0], l = lab != null ? o[lab] : o[1]; return '<option value="' + esc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join(''); }

  // the parameters of each form: [key, label, min, max, step, scale] — scale 100 shows a fraction as a percentage
  var PARAMS = {
    slub: [['thickness', 'Slub thickness (× mass)', 1.2, 5, 0.1, 1], ['length_cm', 'Slub length (cm)', 1, 12, 0.5, 1], ['spacing_cm', 'Gap between slubs (cm)', 3, 60, 1, 1]],
    flame: [['thickness', 'Flame thickness, most (× mass)', 1.5, 5, 0.1, 1], ['length_mm', 'Mean flame length (mm)', 5, 60, 1, 1], ['spacing_cm', 'Mean gap (cm)', 3, 60, 1, 1]],
    nep: [['per_cm', 'Neps per cm', 0.2, 6, 0.1, 1], ['size', 'Nep size (× yarn diameter)', 1.5, 4, 0.1, 1], ['colour', 'Nep colour', null, null, null, 'colour']],
    boucle: [['effect_share', 'Effect yarn (% of the mass)', 30, 85, 1, 100], ['overfeed', 'Overfeed (× length)', 1.8, 6, 0.1, 1], ['spacing_mm', 'Loop spacing (mm)', 0.8, 6, 0.1, 1]],
    chenille: [['pile_share', 'Pile (% of the mass)', 40, 90, 1, 100], ['pile_mm', 'Pile length (mm)', 0.5, 4, 0.1, 1], ['pile_density', 'Tufts per mm', 8, 40, 1, 1]],
    core_fil: [['core_denier', 'Core filament (denier)', 10, 200, 5, 1], ['core_dpf', 'Core denier per filament', 0.5, 4, 0.1, 1]],
    aty: [['overfeed_pct', 'Overfeed (%)', 5, 50, 1, 1]],
  };
  function defOf(form, key) { var f = CAT && CAT.forms.filter(function (x) { return x.id === form; })[0]; return f && f.defaults ? f.defaults[key] : undefined; }
  function shown(form, key, scale) { var v = cur().params[key]; if (v == null) v = defOf(form, key); return v == null ? '' : (scale === 100 ? Math.round(v * 100) : v); }

  function buildCard() {
    var host = $('fy-card'); if (!host) return;
    ensureCss();
    if (!CAT) { host.innerHTML = '<div class="st-step"><b>2e</b> Fancy yarn</div><p class="st-hint">Loading…</p>'; return; }
    var c = cur(), f = CAT.forms.filter(function (x) { return x.id === c.form; })[0] || CAT.forms[0];
    var roleBtns = ROLES.map(function (r) { return '<button type="button" data-fy-role="' + r[0] + '" class="' + (S.role === r[0] ? 'on' : '') + '">' + r[1] + ((S.specs[r[0]] && S.specs[r[0]].enabled) ? '<span class="ml-dot"></span>' : '') + '</button>'; }).join('');
    var rows = (PARAMS[c.form] || []).map(function (q) {
      var id = 'fy-p-' + q[0];
      if (q[5] === 'colour') return '<div class="st-f"><label for="' + id + '">' + esc(q[1]) + '</label><input id="' + id + '" data-fy-p="' + q[0] + '" type="color" value="' + esc(c.params[q[0]] || defOf(c.form, q[0]) || '#1d3f8a') + '" style="height:32px;padding:2px"></div>';
      return '<div class="st-f"><label for="' + id + '">' + esc(q[1]) + '</label><input id="' + id + '" data-fy-p="' + q[0] + '" data-scale="' + q[5] + '" type="number" min="' + q[2] + '" max="' + q[3] + '" step="' + q[4] + '" value="' + esc(shown(c.form, q[0], q[5])) + '"></div>';
    });
    var grid = ''; for (var i = 0; i < rows.length; i += 2) grid += '<div class="st-row">' + rows[i] + (rows[i + 1] || '') + '</div>';
    host.innerHTML = '<div class="st-step"><b>2e</b> Fancy yarn — slub, bouclé, chenille …</div>' +
      '<p class="st-hint" style="margin-top:0">A yarn with an effect built into it. The count above is the yarn as knitted; the parts it is made of, where the strength is, the diameter and the finest gauge follow from the effect. The 3D Yarn view draws the effect.</p>' +
      '<div class="ml-seg" role="group" aria-label="Yarn role">' + roleBtns + '</div>' +
      '<label class="st-check"><input type="checkbox" id="fy-on"' + (c.enabled ? ' checked' : '') + '> This yarn is a fancy yarn</label>' +
      '<div id="fy-body"' + (c.enabled ? '' : ' hidden') + '>' +
      '<div class="st-row one"><div class="st-f"><label for="fy-form">Effect</label><select id="fy-form">' + opts(CAT.forms, c.form, 'id', 'label') + '</select></div></div>' +
      '<p class="st-hint" style="margin:-2px 0 8px">' + esc(f.what) + (f.staple ? '' : ' Use a polyester filament yarn: the Studio sets it as one.') + '</p>' + grid +
      '<div class="ml-sum" id="fy-sum"></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button type="button" class="st-btn" id="fy-open">Open the fancy yarn analysis</button></div></div>';
    summary();
  }
  function readCard() {
    var c = cur(), on = $('fy-on'); if (!on) return;
    c.enabled = on.checked;
    if ($('fy-form')) c.form = $('fy-form').value;
    Array.prototype.forEach.call(document.querySelectorAll('#fy-card [data-fy-p]'), function (e) {
      var k = e.getAttribute('data-fy-p'), sc = e.getAttribute('data-scale');
      if (e.type === 'color') c.params[k] = e.value;
      else if (e.value !== '') { var v = parseFloat(e.value); if (v > 0) c.params[k] = sc === '100' ? v / 100 : v; }
    });
  }
  function summary() {
    var el = $('fy-sum'); if (!el) return;
    var r = lastResult && lastResult[S.role];
    if (!r) { el.textContent = cur().enabled ? 'Worked out with the Studio\'s next answer.' : ''; return; }
    el.innerHTML = '<b>' + esc(r.identity.label) + '</b> · ' + r.count_labels.resultant_ne + 's Ne as knitted' + (r.count_labels.declared_base_ne ? ' (declared base ' + r.count_labels.declared_base_ne + 's)' : '') + '<br>tenacity ' + r.tensile.tenacity.value + ' cN/tex of the whole yarn · finest gauge ' + r.knitting.finest_gauge.value + ' GG';
  }

  // ── the results tab ────────────────────────────────────────────────────────────────────────
  function tag(t) { return t ? '<span class="ml-b ml-b-' + esc(t) + '">' + esc(t) + '</span>' : ''; }
  function val(o, d) { return o && o.value != null ? (d === undefined ? o.value : (+o.value).toFixed(d)) + (o.unit ? ' ' + esc(o.unit) : '') + tag(o.basis) : '—'; }
  function kpis(list) { return '<div class="bl-kpis">' + list.map(function (k) { return '<div class="bl-kpi"><b>' + esc(k[1]) + '</b><span>' + esc(k[0]) + (k[2] ? tag(k[2]) : '') + '</span></div>'; }).join('') + '</div>'; }
  function render(res) {
    var pane = $('pane-fancy'); if (!pane) return;
    ensureCss();
    var roles = res ? Object.keys(res) : [];
    if (!roles.length) { pane.innerHTML = '<p class="st-p">Switch a yarn role to a fancy yarn (the Fancy yarn card, under Yarn) to see here the parts it is made of, where the mass and the strength are, the evenness and diameter the effect sets, the finest gauge it will pass, and the derivation of every figure. The 3D Yarn view draws the effect.</p>'; return; }
    var role = res[S.role] ? S.role : roles[0], r = res[role], h = '';
    h += '<div style="font:700 17px var(--head)">' + esc(r.identity.label) + ' — ' + esc(({ ground: 'face / ground', binder: 'binder', loop: 'loop' })[role] || role) + ' yarn</div><div class="ml-note">' + esc(r.identity.what) + '</div>';
    r.warnings.forEach(function (w) { h += '<div class="ml-note ' + (w.level === 'warn' ? 'warn' : '') + '">' + (w.level === 'warn' ? '⚠ ' : '') + esc(w.text) + '</div>'; });
    var t = r.tensile, cl = r.count_labels;
    h += '<div class="ml-h">Count and its parts</div><dl class="ml-kv"><dt>As knitted</dt><dd>' + cl.resultant_ne + 's Ne = ' + cl.resultant_nm + ' Nm = ' + r.count.resultant_tex + ' tex = ' + cl.resultant_denier + ' denier</dd>' +
      Object.keys(r.count).filter(function (k) { return k !== 'resultant_tex'; }).map(function (k) { return '<dt>' + esc(k.replace(/_/g, ' ')) + '</dt><dd>' + esc(r.count[k]) + '</dd>'; }).join('') + '</dl>';
    h += '<div class="ml-h">Where the mass is</div>' + r.mass.map(function (m) { return '<div class="lk-row" style="display:grid;grid-template-columns:170px 1fr 56px;gap:8px;align-items:center;font-size:12px;margin:0 0 5px"><span>' + esc(m.part) + '</span><span style="height:8px;border-radius:4px;background:var(--bg2,#eef1f5);overflow:hidden"><u style="display:block;height:100%;width:' + Math.min(100, m.share_pct) + '%;background:var(--accent);text-decoration:none"></u></span><b style="text-align:right">' + m.share_pct + ' %</b></div>'; }).join('');
    h += '<div class="ml-h">Strength</div>' + kpis([['Breaking force', t.breaking_force.value + ' cN', t.breaking_force.basis], ['Tenacity of the whole yarn', t.tenacity.value + ' cN/tex', t.tenacity.basis], ['Elongation at break', t.elongation_at_break.value + ' %', t.elongation_at_break.basis], ['Against a plain yarn', '× ' + t.factor_vs_plain.value, 'typical']]) +
      '<div class="ml-note"><b>Carried by:</b> ' + esc(t.carried_by) + '. ' + esc(t.note) + '</div>' + (t.sequence ? '<div class="ml-note">' + esc(t.sequence) + '</div>' : '');
    h += '<div class="ml-h">Evenness</div><div class="ml-note">' + (r.evenness.cvm_pct ? 'Mass variation CVm ' + val(r.evenness.cvm_pct) + '. ' : '') + esc(r.evenness.note) + '</div>';
    h += '<div class="ml-h">Geometry</div><dl class="ml-kv">' + Object.keys(r.geometry).map(function (k) { var g = r.geometry[k]; return '<dt>' + esc(k.replace(/_/g, ' ')) + '</dt><dd>' + (g && typeof g === 'object' && 'value' in g ? val(g) : esc(g)) + '</dd>'; }).join('') + '</dl>';
    h += '<div class="ml-h">Hand</div><dl class="ml-kv"><dt>Hairiness</dt><dd>' + val(r.hand.hairiness) + '</dd><dt>Bulk</dt><dd>' + val(r.hand.bulk) + '</dd>' + (r.hand.shedding ? '<dt>Shedding</dt><dd>' + esc(r.hand.shedding) + '</dd>' : '') + '</dl><div class="ml-rm">' + esc(r.hand.note) + '</div>';
    h += '<div class="ml-h">Knitting it</div><dl class="ml-kv"><dt>Knitting diameter</dt><dd>' + val(r.knitting.effective_diameter_mm) + '</dd><dt>Finest gauge</dt><dd><b>' + val(r.knitting.finest_gauge) + '</b> — ' + esc(r.knitting.finest_gauge.note) + '</dd></dl>' + r.knitting.notes.map(function (n) { return '<div class="ml-note">' + esc(n) + '</div>'; }).join('');
    h += '<div class="ml-h">Derivations</div><details><summary class="ml-note" style="cursor:pointer">Show the working (' + r.derivations.length + ')</summary>' + r.derivations.map(function (d) { return '<div class="bl-der"><b>' + esc(d.quantity) + ' = ' + esc(d.result) + (d.unit ? ' ' + esc(d.unit) : '') + tag(d.basis) + '</b><code>' + esc(d.formula) + '\n' + esc(d.working) + '</code></div>'; }).join('') + '</details>';
    pane.innerHTML = h;
  }

  function changed() { document.dispatchEvent(new Event('ka-fancy')); }
  function bind() {
    var host = $('fy-card'); if (!host) return;
    host.addEventListener('click', function (e) {
      var rb = e.target.closest('[data-fy-role]');
      if (rb) { readCard(); S.role = rb.getAttribute('data-fy-role'); buildCard(); render(lastResult); return; }
      if (e.target.id === 'fy-open') { var tb = document.querySelector('.st-tabs [data-tab="fancy"]'); if (tb) tb.click(); }
    });
    host.addEventListener('change', function (e) {
      var t = e.target; readCard();
      if (t.id === 'fy-on') buildCard();
      if (t.id === 'fy-form') { cur().params = {}; buildCard(); }
    });
    host.addEventListener('input', function (e) { if (e.target.type === 'number') readCard(); });
    var pane = $('pane-fancy'); if (pane) pane.addEventListener('click', function () {});
  }
  function specOf(c) { var p = {}; for (var k in c.params) p[k] = c.params[k]; return { form: c.form, params: p }; }
  function payload() {
    var out = {}, any = false;
    ROLES.forEach(function (r) { var c = S.specs[r[0]]; if (!c || !c.enabled) return; if (r[0] === S.role) readCard(); out[r[0]] = specOf(c); any = true; });
    return any ? out : null;
  }
  function state() { readCard(); return JSON.parse(JSON.stringify(S)); }
  function setState(o) { S = o && o.specs ? JSON.parse(JSON.stringify(o)) : { role: 'ground', specs: {} }; lastResult = null; buildCard(); render(null); }
  function setCatalogue(c) { CAT = c || null; buildCard(); }
  function studioResult(r) { lastResult = r && r.fancy ? r.fancy : null; summary(); render(lastResult); document.dispatchEvent(new Event('ka-fancy-result')); }
  /** What the 3D Yarn view draws for a role: the form and the effect's own numbers (from the engine's answer, else from the card). */
  function forYarnView(role) {
    var c = S.specs[role]; if (!c || !c.enabled) return null;
    var r = lastResult && lastResult[role];
    if (r && r.render) return { form: r.render.form, fancy: r.render.fancy, label: r.identity.label };
    var f = CAT && CAT.forms.filter(function (x) { return x.id === c.form; })[0];
    return { form: c.form, fancy: Object.assign({}, f ? f.defaults : {}, c.params), label: f ? f.label : c.form };
  }

  window.KAStudioFancy = { payload: payload, state: state, setState: setState, setCatalogue: setCatalogue, studioResult: studioResult, forYarnView: forYarnView };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { buildCard(); bind(); render(null); }); else { buildCard(); bind(); render(null); }
})();
