/**
 * Fabric Studio — the yarn chemistry card and its results tab.
 *
 * Left (the "Yarn chemistry" card, under the Blend yarn card): the shade the yarn is going to take, the liquor ratio and the
 * choices of the wet route (mercerise, bio-polish, heat-set). Switched on, the Studio works out the chemistry of EVERY yarn the
 * design uses, at the count it settled on (backend/engine/domain/yarn-chemistry-engine.js).
 *
 * Right (the "Yarn chemistry" tab): the dye class each fibre takes and the blend's dyeing problem; the wet route in the order the
 * chemistry allows (temperature, pH, time, chemicals, and the yarn's strength after each step); the recipe in kg per 100 kg of yarn
 * and g/L (no money); the resistance of each fibre to the agents of the dyehouse; the fastness; moisture; the shade ladder; and the
 * derivation of each figure. Each figure is tagged measured / law / blend / typical / estimate.
 *
 * Plain script, no dependencies. window.KAStudioChem:
 *   payload()            the options when the card is on, else null
 *   state() / setState() the card as a plain object (saved with a design)
 *   setCatalogue(c)      shades, agents, processes (from /api/studio/templates)
 *   studioResult(r)      the Studio's last answer (carries r.chemistry per yarn role)
 */
(function () {
  'use strict';
  var CAT = null, S = blank(), lastResult = null, role = 'ground';

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function blank() { return { enabled: false, shade: 'medium', liquor: '', mercerise: false, biopolish: true, heatset: '', process: {} }; }

  var CSS = '.ch-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:2px}' +
    '.ch-step{display:grid;grid-template-columns:26px 1fr;gap:10px;margin:0 0 4px}.ch-step i{width:26px;height:26px;border-radius:50%;background:var(--accent-tint);color:var(--accent);font:700 12px var(--head);display:flex;align-items:center;justify-content:center;font-style:normal;margin-top:2px}' +
    '.ch-step .ch-b{border-left:3px solid var(--accent-line,#9bb8e8);padding:2px 0 8px 10px;font-size:12.5px;line-height:1.45}.ch-step .ch-b b{color:var(--t1);display:block}.ch-step .ch-b span{color:var(--t2);display:block}' +
    '.ch-bar{height:6px;border-radius:3px;background:var(--bg2,#eef1f5);margin-top:4px;overflow:hidden}.ch-bar u{display:block;height:100%;background:var(--accent);text-decoration:none}' +
    '.ch-r{display:inline-block;min-width:22px;padding:1px 6px;border-radius:6px;font:700 11px var(--head);text-align:center}.ch-r0{background:rgba(178,59,59,.2);color:#8f2020}.ch-r1{background:rgba(214,120,30,.2);color:#8a4a00}.ch-r2{background:rgba(220,180,40,.22);color:#6d5600}.ch-r3{background:rgba(30,122,84,.14);color:#1e7a54}.ch-r4{background:rgba(30,122,84,.26);color:#14603f}';
  function ensureCss() {
    if (!$('ml-css') && window.KAStudioMelange && window.KAStudioMelange.css) { var m = document.createElement('style'); m.id = 'ml-css'; m.textContent = window.KAStudioMelange.css; document.head.appendChild(m); }
    if (!$('bl-css') && window.KAStudioBlend && window.KAStudioBlend.css) { var b = document.createElement('style'); b.id = 'bl-css'; b.textContent = window.KAStudioBlend.css; document.head.appendChild(b); }
    if (!$('ch-css')) { var st = document.createElement('style'); st.id = 'ch-css'; st.textContent = CSS; document.head.appendChild(st); }
  }
  function opts(list, sel, key, lab) { return list.map(function (o) { var v = key != null ? o[key] : o[0], l = lab != null ? o[lab] : o[1]; return '<option value="' + esc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join(''); }

  // ── the card ───────────────────────────────────────────────────────────────────────────────
  function buildCard() {
    var host = $('ch-card'); if (!host) return;
    ensureCss();
    if (!CAT) { host.innerHTML = '<div class="st-step"><b>2c</b> Yarn chemistry</div><p class="st-hint">Loading…</p>'; return; }
    var c = S;
    host.innerHTML = '<div class="st-step"><b>2c</b> Yarn chemistry — dyeing &amp; the wet route</div>' +
      '<p class="st-hint" style="margin-top:0">What the yarn\'s fibres are chemically: the dye class each takes, the wet route in the order the chemistry allows, the dye and chemical amounts (no money), how each fibre stands to bleach, alkali and acid, the strength left after the route, and the fastness.</p>' +
      '<label class="st-check"><input type="checkbox" id="ch-on"' + (c.enabled ? ' checked' : '') + '> Work out the chemistry of my yarns</label>' +
      '<div id="ch-body"' + (c.enabled ? '' : ' hidden') + '>' +
      '<div class="st-row"><div class="st-f"><label for="ch-shade">Shade</label><select id="ch-shade">' + opts(CAT.shades, c.shade, 'id', 'label') + '</select></div>' +
      '<div class="st-f"><label for="ch-lr">Liquor ratio</label><input id="ch-lr" type="number" min="3" max="30" step="0.5" placeholder="8" value="' + esc(c.liquor) + '"></div></div>' +
      '<label class="st-check"><input type="checkbox" id="ch-merc"' + (c.mercerise ? ' checked' : '') + '> Mercerise the cotton</label>' +
      '<label class="st-check"><input type="checkbox" id="ch-bio"' + (c.biopolish ? ' checked' : '') + '> Bio-polish the cellulosic fibres</label>' +
      '<div class="st-row one"><div class="st-f"><label for="ch-hs">Heat-setting</label><select id="ch-hs">' + opts([['', 'As the yarn needs'], ['before', 'Before dyeing'], ['none', 'None']], c.heatset) + '</select></div></div>' +
      '<details class="gt-force"' + (Object.keys(c.process || {}).length ? ' open' : '') + '><summary>Force the process (against the compiler\'s advice)</summary>' +
      '<p class="st-hint" style="margin:4px 0">The route is compiled so that every fibre survives it. Ask for something else here and the feasibility gate shows what it would do to the cloth, and refuses it if it destroys a fibre.</p>' +
      '<label class="st-check"><input type="checkbox" id="ch-p-caustic"' + (c.process.scour_caustic ? ' checked' : '') + '> Scour with caustic soda</label>' +
      '<label class="st-check"><input type="checkbox" id="ch-p-killer"' + (c.process.skip_killer ? ' checked' : '') + '> Skip the peroxide killer after bleaching</label>' +
      '<label class="st-check"><input type="checkbox" id="ch-p-rf"' + (c.process.reactive_first ? ' checked' : '') + '> Dye the reactive before the disperse</label>' +
      '<div class="st-row"><div class="st-f"><label for="ch-p-disp">Disperse dyeing (°C)</label><input id="ch-p-disp" type="number" min="60" max="160" step="1" placeholder="auto" value="' + esc(c.process.disperse_c || '') + '"></div>' +
      '<div class="st-f"><label for="ch-p-hs">Heat-set (°C)</label><input id="ch-p-hs" type="number" min="80" max="240" step="1" placeholder="auto" value="' + esc(c.process.heatset_c || '') + '"></div></div>' +
      '<div class="st-row one"><div class="st-f"><label for="ch-p-soft">Softener</label><select id="ch-p-soft">' + opts([['', 'As the route needs'], ['cationic', 'Cationic'], ['silicone', 'Silicone'], ['nonionic', 'Non-ionic']], c.process.softener || '') + '</select></div></div>' +
      '<div class="st-hint" style="margin:6px 0 2px">Extra finishes</div>' +
      [['dwr', 'Water repellent (DWR)'], ['wet_rub', 'Wet-rubbing improver'], ['gsm_improver', 'GSM improver'], ['hydrophilic', 'Hydrophilic softener'], ['anti_crease', 'Anti-creasing agent'], ['oil_remover', 'Oil remover']].map(function (f) {
        return '<label class="st-check"><input type="checkbox" class="ch-p-fin" value="' + f[0] + '"' + ((c.process.finishes || []).indexOf(f[0]) > -1 ? ' checked' : '') + '> ' + f[1] + '</label>'; }).join('') +
      '</details>' +
      '<div class="ml-sum" id="ch-sum"></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button type="button" class="st-btn" id="ch-open">Open the chemistry analysis</button></div></div>';
    summary();
  }
  function readCard() {
    var on = $('ch-on'); if (!on) return;
    S.enabled = on.checked;
    if ($('ch-shade')) { S.shade = $('ch-shade').value; S.liquor = $('ch-lr').value; S.mercerise = $('ch-merc').checked; S.biopolish = $('ch-bio').checked; S.heatset = $('ch-hs').value; }
    if ($('ch-p-caustic')) {
      var p = {}, n;
      if ($('ch-p-caustic').checked) p.scour_caustic = true;
      if ($('ch-p-killer').checked) p.skip_killer = true;
      if ($('ch-p-rf').checked) p.reactive_first = true;
      n = parseFloat($('ch-p-disp').value); if (n > 0) p.disperse_c = n;
      n = parseFloat($('ch-p-hs').value); if (n > 0) p.heatset_c = n;
      if ($('ch-p-soft').value) p.softener = $('ch-p-soft').value;
      var fin = Array.prototype.map.call(document.querySelectorAll('.ch-p-fin:checked'), function (x) { return x.value; });
      if (fin.length) p.finishes = fin;
      S.process = p;
    }
  }
  function summary() {
    var el = $('ch-sum'); if (!el) return;
    var r = lastResult && (lastResult[role] || lastResult[Object.keys(lastResult)[0]]);
    if (!r) { el.textContent = S.enabled ? 'Worked out with the Studio\'s next answer.' : ''; return; }
    el.innerHTML = '<b>' + esc(r.identity.label) + '</b> · ' + esc(r.identity.shade) + '<br>' + (r.dyeing.classes.length ? r.dyeing.classes.map(function (c) { return esc(c.label); }).join(' → ') + ' · ' + r.dyeing.baths + ' bath' + (r.dyeing.baths > 1 ? 's' : '') : 'no dyeing: a white') + ' · strength left ' + r.strength.retained_pct.value + ' %';
  }

  // ── the results tab ────────────────────────────────────────────────────────────────────────
  function tag(t) { return t ? '<span class="ml-b ml-b-' + esc(t) + '">' + esc(t) + '</span>' : ''; }
  function val(o, d) { return o && o.value != null ? (d === undefined ? o.value : (+o.value).toFixed(d)) + (o.unit ? ' ' + esc(o.unit) : '') + tag(o.basis) : '—'; }
  function table(head, rows, hl) { return '<div class="bl-scroll"><table class="ml-tbl"><tr>' + head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr>' + rows.map(function (r, i) { return '<tr' + (hl === i ? ' class="on"' : '') + '>' + r.map(function (c) { return '<td>' + (c && c.html ? c.html : esc(c)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table></div>'; }
  function grade(g) { return g.length > 1 ? g[0] + '–' + g[1] : String(g[0]); }

  function render(res) {
    var pane = $('pane-chem'); if (!pane) return;
    ensureCss();
    var roles = res ? Object.keys(res) : [];
    if (!roles.length) { pane.innerHTML = '<p class="st-p">Switch on “Work out the chemistry of my yarns” in the Yarn chemistry card (under Yarn) to see here: the dye classes, the wet route in order, the recipe, resistance, the strength left after the route and the fastness.</p>'; return; }
    if (!res[role]) role = roles[0];
    var r = res[role], h = '';
    if (roles.length > 1) h += '<div class="ml-seg" role="group">' + roles.map(function (k) { return '<button type="button" data-ch-role="' + esc(k) + '" class="' + (k === role ? 'on' : '') + '">' + esc(({ ground: 'Face / ground', binder: 'Binder', loop: 'Loop', plate: 'Plated' })[k] || k) + '</button>'; }).join('') + '</div>';
    h += '<div style="font:700 17px var(--head)">' + esc(r.identity.label) + ' — ' + esc(r.identity.shade) + '</div><div class="ml-note">' + r.identity.count.ne + 's Ne (' + r.identity.count.tex + ' tex)' + (r.identity.filament ? ', filament' : '') + '. Families: ' + esc(r.identity.families.join(', ')) + '.</div>';
    if (r.warnings.length) h += r.warnings.map(function (w) { return '<div class="ml-note ' + (w.level === 'warn' ? 'warn' : '') + '">' + (w.level === 'warn' ? '⚠ ' : '') + esc(w.text) + '</div>'; }).join('');
    // fibres
    h += '<div class="ml-h">The fibres and the dye each takes</div>' + table(['Fibre', 'Chemistry', 'Label %', 'Dry %', 'Regain %', 'Dye class', 'Alternatives'],
      r.fibres.map(function (f) { return [f.label, f.polymer, f.label_share_pct, f.dry_share_pct, f.regain.value, f.primary_class_label, f.alternatives.join(', ') || '—']; }));
    // dyeing
    var d = r.dyeing;
    h += '<div class="ml-h">Dyeing</div>';
    h += d.classes.length ? '<dl class="ml-kv"><dt>Classes, in order</dt><dd>' + d.classes.map(function (c) { return esc(c.label) + ' (' + c.t_c + ' °C, pH ' + c.ph + ', ' + c.time_min + ' min)'; }).join(' → ') + '</dd><dt>Baths</dt><dd><b>' + d.baths + '</b> — ' + esc(d.why) + '</dd>' + (d.order_note ? '<dt>Order</dt><dd>' + esc(d.order_note) + '</dd>' : '') + (d.dye_rate_split ? '<dt>Dye rate</dt><dd>The fibres take dye at different rates: compensate.</dd>' : '') + '</dl>' : '<div class="ml-note">A white: no dye class is needed; the route bleaches and brightens.</div>';
    // route
    var st = r.route.steps, t0 = r.strength.before ? r.strength.before.tenacity.value : null;
    h += '<div class="ml-h">The wet route, in order</div>' + st.map(function (s, i) {
      var pct = s.yarn_after ? s.yarn_after.retained_pct : null;
      return '<div class="ch-step"><i>' + (i + 1) + '</i><div class="ch-b"><b>' + esc(s.label) + '</b><span>' + (s.t_c != null ? s.t_c + ' °C' : '') + (s.ph != null ? ' · pH ' + s.ph : '') + ' · ' + s.time_min + ' min' + (s.chemicals.length ? ' · ' + s.chemicals.map(function (c) { return esc(c.name) + ' ' + c.g_per_l + ' g/L'; }).join(', ') : '') + '</span>' +
        (s.purpose ? '<span>' + esc(s.purpose) + '</span>' : '') + (s.note ? '<span>' + esc(s.note) + '</span>' : '') +
        (pct != null ? '<div class="ch-bar" title="yarn strength after this step"><u style="width:' + Math.min(100, pct) + '%"></u></div><span>yarn after this step: ' + s.yarn_after.tenacity + ' cN/tex (' + pct + ' % of the start)</span>' : '') + '</div></div>';
    }).join('') + '<div class="ml-rm">' + esc(r.route.note) + ' Total about ' + r.route.total_time_min + ' min in the bath.</div>';
    // strength
    var sg = r.strength;
    h += '<div class="ml-h">The yarn\'s strength after the route</div><dl class="ml-kv"><dt>Retained</dt><dd><b>' + val(sg.retained_pct) + '</b></dd>' +
      (sg.before ? '<dt>Tenacity</dt><dd>' + val(sg.before.tenacity) + ' → ' + val(sg.after.tenacity) + '</dd><dt>Elongation at break</dt><dd>' + val(sg.before.elongation) + ' → ' + val(sg.after.elongation) + '</dd><dt>Breaking force</dt><dd>' + val(sg.before.force) + ' → ' + val(sg.after.force) + '</dd>' : '') +
      '<dt>By fibre</dt><dd>' + sg.by_fibre.map(function (f) { return esc(f.label) + ' ' + f.retained_pct + ' %'; }).join(' · ') + '</dd></dl><div class="ml-rm">' + esc(sg.note) + '</div>';
    // recipe
    var rc = r.recipe;
    h += '<div class="ml-h">The recipe (amounts, no money)</div>';
    if (rc.dyes.length) h += table(['Dye class', 'Fibre', '% owf', 'Share %', 'kg', 'Fixed %', 'Unfixed kg'], [].concat.apply([], rc.dyes.map(function (dy) { return dy.by_fibre.map(function (b, i) { return [i === 0 ? dy.class_label : '', b.label, b.owf_pct, b.share_pct, b.kg, i === 0 ? dy.fixation_pct.value : '', i === 0 ? dy.unfixed_kg : '']; }); })));
    h += table(['Chemical', 'g/L', 'kg', 'Bath / step', 'What it does'], rc.chemicals.map(function (c) { return [c.name, c.g_per_l, c.kg, c.bath, c.role]; }));
    h += '<dl class="ml-kv"><dt>Per</dt><dd>' + rc.yarn_kg + ' kg of yarn (' + rc.dry_yarn_kg + ' kg dry) in ' + rc.liquor_volume_l + ' L of liquor (' + val(rc.liquor_ratio) + ')</dd><dt>Effluent</dt><dd>' + rc.effluent.unfixed_dye_kg + ' kg unfixed dye · ' + rc.effluent.salt_kg + ' kg salt (' + rc.effluent.salt_g_per_l + ' g/L) — ' + esc(rc.effluent.note) + '</dd></dl><div class="ml-rm">' + esc(rc.note) + ' ' + esc(rc.basis) + '.</div>';
    // resistance
    h += '<div class="ml-h">How the fibres stand to the dyehouse</div>' + table(['Agent'].concat(r.fibres.map(function (f) { return f.label; })).concat(['Governs']),
      r.resistance.map(function (a) { return [a.label].concat(a.per_fibre.map(function (p) { return { html: '<span class="ch-r ch-r' + p.rating + '" title="' + esc(p.word) + '">' + p.rating + '</span>' }; })).concat([{ html: '<b>' + esc(a.governed_by.label) + '</b>: ' + esc(a.verdict) }]); })) +
      '<div class="ml-rm">4 resistant · 3 good · 2 fair, with care · 1 poor · 0 destroyed. A blend is no better than its weakest fibre for each agent. Typical wet-processing knowledge; the light order is the fibre tables\'.</div>';
    // fastness
    if (r.fastness) {
      var ks = r.fastness.test_keys;
      h += '<div class="ml-h">Fastness (grades 1–5; light 1–8)</div>' + table(['Dye class'].concat(ks.map(function (k) { return k.label; })), r.fastness.per_class.map(function (p) { return [p.class_label].concat(ks.map(function (k) { return grade(p.grades[k.key]); })); }).concat([['The blend (lowest)'].concat(ks.map(function (k) { return grade(r.fastness.overall[k.key]); }))])) +
        r.fastness.risks.map(function (x) { return '<div class="ml-note warn">⚠ ' + esc(x) + '</div>'; }).join('') + '<div class="ml-rm">' + esc(r.fastness.overall_note) + ' Typical grades by class and depth; test your own.</div>';
    }
    // moisture
    var m = r.moisture;
    h += '<div class="ml-h">Moisture and liquor</div><dl class="ml-kv"><dt>Regain</dt><dd>' + val(m.regain) + '</dd>' + (m.swelling_diameter_gain ? '<dt>Swelling</dt><dd>' + val(m.swelling_diameter_gain) + (m.swelling_diameter_gain.note ? ' (' + esc(m.swelling_diameter_gain.note) + ')' : '') + '</dd>' : '') + (m.water_after_extraction ? '<dt>Water held after extraction</dt><dd>' + val(m.water_after_extraction) + '</dd>' : '') + '<dt>Boil-off shrinkage</dt><dd>' + val(m.boil_off_shrinkage) + '</dd>' + (m.heat_ceiling_c ? '<dt>Heat ceiling</dt><dd>' + val(m.heat_ceiling_c) + '</dd>' : '') + '</dl><div class="ml-rm">' + esc(m.note) + '</div>';
    if (r.whitening) h += '<div class="ml-h">Whitening</div>' + r.whitening.steps.map(function (x) { return '<div class="ml-step"><span>' + esc(x) + '</span></div>'; }).join('') + r.whitening.risks.map(function (x) { return '<div class="ml-note warn">⚠ ' + esc(x) + '</div>'; }).join('');
    // sweep
    var cur = r.sweep.depth.map(function (x) { return x.label; }).indexOf(r.identity.shade);
    h += '<div class="ml-h">The same yarn at every depth</div>' + table(['Shade', 'Dye kg', 'Salt g/L', 'Alkali g/L', 'Baths', 'Steps', 'Time min'], r.sweep.depth.map(function (x) { return [x.label, x.dye_kg, x.salt_g_l, x.alkali_g_l, x.baths, x.steps, x.time_min]; }), cur);
    // derivations
    h += '<div class="ml-h">Derivations</div><details><summary class="ml-note" style="cursor:pointer">Show the working (' + r.derivations.length + ')</summary>' + r.derivations.map(function (x) { return '<div class="bl-der"><b>' + esc(x.quantity) + ' = ' + esc(x.result) + (x.unit ? ' ' + esc(x.unit) : '') + tag(x.basis) + '</b><code>' + esc(x.formula) + '\n' + esc(x.working) + '</code></div>'; }).join('') + '</details>';
    pane.innerHTML = h;
  }

  // ── events ─────────────────────────────────────────────────────────────────────────────────
  function bind() {
    var host = $('ch-card'); if (host) {
      host.addEventListener('change', function (e) { readCard(); if (e.target.id === 'ch-on') buildCard(); });
      host.addEventListener('input', function (e) { if (e.target.type === 'number') readCard(); });
      host.addEventListener('click', function (e) { if (e.target.id === 'ch-open') { var tb = document.querySelector('.st-tabs [data-tab="chem"]'); if (tb) tb.click(); } });
    }
    var pane = $('pane-chem'); if (pane) pane.addEventListener('click', function (e) { var b = e.target.closest('[data-ch-role]'); if (b) { role = b.getAttribute('data-ch-role'); render(lastResult); summary(); } });
  }
  function payload() {
    readCard();
    if (!S.enabled) return null;
    var n = parseFloat(S.liquor);
    return { enabled: true, shade: S.shade, liquor_ratio: n > 0 ? n : undefined, mercerise: !!S.mercerise, biopolish: S.biopolish ? undefined : false, heatset: S.heatset || undefined, process: S.process && Object.keys(S.process).length ? S.process : undefined };
  }
  // a repair from the feasibility gates: clear one forced setting
  function clearProcess(key) { if (S.process) delete S.process[key]; buildCard(); }
  function state() { readCard(); return JSON.parse(JSON.stringify(S)); }
  function setState(o) { S = Object.assign(blank(), o || {}); if (!S.process) S.process = {}; lastResult = null; buildCard(); render(null); }
  function setCatalogue(c) { CAT = c || null; buildCard(); }
  function studioResult(r) { lastResult = r && r.chemistry ? r.chemistry : null; summary(); render(lastResult); }

  window.KAStudioChem = { clearProcess: clearProcess, payload: payload, state: state, setState: setState, setCatalogue: setCatalogue, studioResult: studioResult };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { buildCard(); bind(); render(null); }); else { buildCard(); bind(); render(null); }
})();
