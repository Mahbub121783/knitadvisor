/**
 * Fabric Studio — the colour target card and its results tab.
 *
 * Left (the "Colour target" card, under the Fabric hand card): the colour as a buyer gives it — a Pantone TCX code or name, a hex, an
 * RGB, or a Lab reading (D50 or D65) — and, if there is one, the lab dip to check against it with its tolerance. Switched on, the colour
 * sets the shade of the Look and Yarn chemistry cards, the target of a melange, and the swatch of the 3D cloth
 * (backend/engine/domain/colour-target-engine.js).
 *
 * Right (the "Colour" tab): the colour in both whites and as LCh, the nearest catalogue colours, the shade depth with its K/S and the dye on
 * the weight of fibre per dye class, what a colour like this asks of the dyehouse, the lab dip's verdict, and the working.
 *
 * Plain script, no dependencies. window.KAStudioColour: payload(), state(), setState(), setCatalogue(c), studioResult(r)
 */
(function () {
  'use strict';
  var CAT = null, S = blank(), last = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function blank() { return { enabled: false, text: '', illuminant: 'D50', trial: '', tolerance: '1' }; }
  function ensureCss() {
    if (!$('ml-css') && window.KAStudioMelange && window.KAStudioMelange.css) { var m = document.createElement('style'); m.id = 'ml-css'; m.textContent = window.KAStudioMelange.css; document.head.appendChild(m); }
    if (!$('bl-css') && window.KAStudioBlend && window.KAStudioBlend.css) { var b = document.createElement('style'); b.id = 'bl-css'; b.textContent = window.KAStudioBlend.css; document.head.appendChild(b); }
    if (!$('cl-css')) { var h = document.createElement('style'); h.id = 'cl-css'; h.textContent = '.cl-sw{display:inline-block;width:44px;height:44px;border-radius:8px;border:1px solid rgba(127,127,127,.4);vertical-align:middle}.cl-pair{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin:8px 0}.cl-near{display:flex;gap:8px;flex-wrap:wrap}.cl-near div{font-size:12px;border:1px solid rgba(127,127,127,.3);border-radius:8px;padding:6px 8px;min-width:120px}.cl-near i{display:block;height:16px;border-radius:4px;margin-bottom:4px;border:1px solid rgba(127,127,127,.3)}'; document.head.appendChild(h); }
  }
  function opts(list, sel) { return list.map(function (o) { return '<option value="' + esc(o.id) + '"' + (o.id === sel ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join(''); }

  function buildCard() {
    var host = $('cl-card'); if (!host) return;
    ensureCss();
    if (!CAT) { host.innerHTML = '<div class="st-step"><b>2f</b> Colour target</div><p class="st-hint">Loading…</p>'; return; }
    var c = S;
    host.innerHTML = '<div class="st-step"><b>2f</b> Colour target — Pantone, Lab, RGB or hex</div>' +
      '<p class="st-hint" style="margin-top:0">Give the colour the way the buyer gave it. It sets the shade of the Look and Yarn chemistry cards, the target of a melange and the colour of the 3D cloth, and tells the dye amount and what the dyehouse must watch.</p>' +
      '<label class="st-check"><input type="checkbox" id="cl-on"' + (c.enabled ? ' checked' : '') + '> Work from a colour target</label>' +
      '<div id="cl-body"' + (c.enabled ? '' : ' hidden') + '>' +
      '<div class="st-row"><div class="st-f"><label for="cl-text">Colour</label><input id="cl-text" type="text" placeholder="19-4052, classic blue, #0f4c81, L 31 a 2 b -35" value="' + esc(c.text) + '"></div>' +
      '<div class="st-f"><label for="cl-ill">A Lab reading is in</label><select id="cl-ill">' + opts(CAT.illuminants, c.illuminant) + '</select></div></div>' +
      '<div class="st-row"><div class="st-f"><label for="cl-trial">Lab dip (optional)</label><input id="cl-trial" type="text" placeholder="the dip\'s colour, in any of the same forms" value="' + esc(c.trial) + '"></div>' +
      '<div class="st-f"><label for="cl-tol">Tolerance ΔE00</label><input id="cl-tol" type="number" min="0.1" max="5" step="0.1" value="' + esc(c.tolerance) + '"></div></div>' +
      '<div class="ml-sum" id="cl-sum"></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button type="button" class="st-btn" id="cl-open">Open the colour analysis</button></div></div>';
    summary();
  }
  function readCard() {
    var on = $('cl-on'); if (!on) return;
    S.enabled = on.checked;
    if ($('cl-text')) { S.text = $('cl-text').value; S.illuminant = $('cl-ill').value; S.trial = $('cl-trial').value; S.tolerance = $('cl-tol').value; }
  }
  function summary() {
    var el = $('cl-sum'); if (!el) return;
    if (!last) { el.textContent = S.enabled ? 'Worked out with the Studio\'s next answer.' : ''; return; }
    if (last.success === false) { el.innerHTML = '<span style="color:#b5651d">' + esc(last.error) + '</span>'; return; }
    el.innerHTML = '<span class="cl-sw" style="width:22px;height:22px;background:' + esc(last.colour.hex) + '"></span> <b>' + esc(last.colour.words) + '</b> · ' + esc(last.depth.label) + ' shade' + (last.trial ? '<br>lab dip ΔE00 ' + last.trial.delta_e00.value + (last.trial.pass ? ' — pass' : ' — out') : '');
  }

  function tag(t) { return t ? '<span class="ml-b ml-b-' + esc(t) + '">' + esc(t) + '</span>' : ''; }
  function kpis(list) { return '<div class="bl-kpis">' + list.map(function (k) { return '<div class="bl-kpi"><b>' + esc(k[1]) + '</b><span>' + esc(k[0]) + (k[2] ? tag(k[2]) : '') + '</span></div>'; }).join('') + '</div>'; }
  function table(head, rows) { return '<div class="bl-scroll"><table class="ml-tbl"><tr>' + head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr>' + rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table></div>'; }
  var CLS = { reactive: 'Reactive (cotton, viscose)', disperse: 'Disperse (polyester)', acid: 'Acid (nylon, wool, silk)', cationic: 'Cationic (acrylic)' };

  function render(r) {
    var pane = $('pane-colour'); if (!pane) return;
    ensureCss();
    if (!r) { pane.innerHTML = '<p class="st-p">Switch on “Work from a colour target” in the Colour target card (under Yarn) to see here: the colour in Lab and LCh, the nearest Pantone colours, the shade depth and the dye amount, what the colour asks of the dyehouse, and a lab dip checked against it.</p>'; return; }
    if (r.success === false) { pane.innerHTML = '<div class="ml-note warn">' + esc(r.error) + '</div>'; return; }
    var c = r.colour, d = r.depth, h = '';
    h += '<div class="cl-pair"><span class="cl-sw" style="background:' + esc(c.hex) + '"></span><div><div style="font:700 17px var(--head)">' + esc(c.words) + '</div><div class="ml-note">' + esc(c.hex) + ' · from ' + esc(c.source) + (c.catalogue ? ' — ' + esc(c.catalogue.code) + ' ' + esc(c.catalogue.name) : '') + '</div></div></div>';
    if (c.catalogue) h += '<div class="ml-rm">' + esc(c.catalogue.note) + '.</div>';
    r.checks.forEach(function (x) { h += '<div class="ml-note' + (x.level === 'warn' ? ' warn' : '') + '">' + esc(x.text) + '</div>'; });
    h += '<div class="ml-h">The colour</div>' + kpis([['L*', c.lch.L, 'law'], ['Chroma C*', c.lch.C, 'law'], ['Hue h°', c.lch.h, 'law'], ['Luminance Y', c.luminance_Y, 'law']]) +
      table(['', 'L*', 'a*', 'b*'], [['Lab, D65 (screen, daylight)', c.lab[0], c.lab[1], c.lab[2]], ['Lab, D50 (print, swatch book)', c.lab_d50[0], c.lab_d50[1], c.lab_d50[2]]]);
    h += '<div class="ml-h">Nearest catalogue colours</div><div class="cl-near">' + r.nearest.map(function (n) { return '<div><i style="background:' + esc(n.hex) + '"></i><b>' + esc(n.code) + '</b><br>' + esc(n.name) + '<br>ΔE00 ' + n.delta_e00 + '</div>'; }).join('') + '</div><div class="ml-rm">The catalogue holds approximate screen values; the physical swatch, or the mill\'s own Lab file, rules.</div>';
    h += '<div class="ml-h">Shade depth and dye</div>' + kpis([['Depth', d.label, 'law'], ['K/S of the shade', d.ks.value, 'law']]) +
      table(['Dye class', 'This shade, % owf', 'Nominal depth, % owf'], Object.keys(d.dye_owf).filter(function (k) { return CLS[k]; }).map(function (k) { return [CLS[k], d.dye_owf[k].value, d.nominal_owf[k].value]; })) + '<div class="ml-rm">' + esc(d.note) + '</div>';
    if (r.trial) {
      var t = r.trial;
      h += '<div class="ml-h">Lab dip against the target</div><div class="cl-pair"><span class="cl-sw" style="background:' + esc(c.hex) + '" title="target"></span><span class="cl-sw" style="background:' + esc(t.hex) + '" title="lab dip"></span><div><div style="font:700 16px var(--head)">ΔE00 ' + t.delta_e00.value + ' — ' + (t.pass ? 'pass' : 'out of tolerance') + ' (' + t.tolerance.value + ')</div><div class="ml-note">' + esc(t.says) + '</div></div></div>' +
        kpis([['ΔL*', t.dL, 'law'], ['Δa*', t.da, 'law'], ['Δb*', t.db, 'law'], ['ΔC*', t.dC, 'law'], ['Dye correction', t.dye_correction_pct.value + ' %', 'estimate']]) + '<div class="ml-note ' + (t.pass ? '' : 'warn') + '">' + esc(t.advice) + '</div>';
    }
    if (r.applied) h += '<div class="ml-h">Where it is used</div><div class="ml-note">Look card: ' + (r.applied.look ? 'colour and shade set' : 'not used') + ' · Yarn chemistry: ' + (r.applied.chemistry ? 'shade set to ' + esc(d.label) : 'switch the card on to use it') + ' · Melange: ' + (r.applied.melange ? 'the target colour of each melange without its own' : 'no melange switched on') + '.</div>';
    h += '<div class="ml-h">Derivations</div><details><summary class="ml-note" style="cursor:pointer">Show the working (' + r.derivations.length + ')</summary>' + r.derivations.map(function (x) { return '<div class="bl-der"><b>' + esc(x.quantity) + ' = ' + esc(x.result) + (x.unit ? ' ' + esc(x.unit) : '') + tag(x.basis) + '</b><code>' + esc(x.formula) + '\n' + esc(x.working) + '</code></div>'; }).join('') + '</details>';
    pane.innerHTML = h;
  }

  function bind() {
    var host = $('cl-card'); if (!host) return;
    host.addEventListener('change', function (e) { readCard(); if (e.target.id === 'cl-on') buildCard(); });
    host.addEventListener('click', function (e) { if (e.target.id === 'cl-open') { var tb = document.querySelector('.st-tabs [data-tab="colour"]'); if (tb) tb.click(); } });
  }
  function payload() {
    readCard();
    if (!S.enabled || !S.text.trim()) return null;
    var o = { enabled: true, text: S.text, illuminant: S.illuminant, tolerance: parseFloat(S.tolerance) || 1 };
    if (S.trial.trim()) o.trial = { text: S.trial };
    return o;
  }
  function state() { readCard(); return JSON.parse(JSON.stringify(S)); }
  function setState(o) { S = Object.assign(blank(), o || {}); last = null; buildCard(); render(null); }
  function setCatalogue(c) { CAT = c || null; buildCard(); }
  function studioResult(r) {
    last = r && r.colour ? r.colour : null; summary(); render(last);
    // the Yarn chemistry card shows the shade the colour set
    var cs = $('ch-shade');
    if (last && last.success !== false && last.applied && last.applied.chemistry && cs && cs.value !== last.depth.id) cs.value = last.depth.id;
    // the 3D cloth takes the target as its swatch
    var sw = $('st-col');
    if (last && last.success !== false && sw && sw.value.toLowerCase() !== last.colour.hex) { sw.value = last.colour.hex; sw.dispatchEvent(new Event('change', { bubbles: true })); }
  }

  window.KAStudioColour = { payload: payload, state: state, setState: setState, setCatalogue: setCatalogue, studioResult: studioResult };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { buildCard(); bind(); render(null); }); else { buildCard(); bind(); render(null); }
})();
