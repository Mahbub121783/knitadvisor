/**
 * Fabric Studio — the melange card and its results tab.
 *
 * Left (the "Melange / marl / heather" card, under the Yarn card): what the yarn is made of — construction, route,
 * spinning system, count, and the components (fibre, share, how it is coloured, its colour). It belongs to a yarn
 * role (face / ground, binder, loop); while it is on, that role's count, spinning system and real fibre mix come from
 * here and the Studio weighs the fabric with them (the engine: backend/engine/domain/melange-engine.js).
 *
 * Right (the "Melange" tab): the whole chain from the bale to the yarn — mass chain, colour, mixing, yarn, marl look,
 * knitting, wet route, defects — each figure tagged measured / law / typical / estimate.
 *
 * Plain script, no dependencies. window.KAStudioMelange:
 *   payload()            { ground: spec, binder: spec, loop: spec } for the roles that are on, or null
 *   state() / setState() the card as a plain object (saved with a design)
 *   setCatalogue(c)      the constructions, fibres and recipes (from /api/studio/templates)
 *   studioResult(r)      the Studio's last answer (its stitch length feeds the marl look)
 */
(function () {
  'use strict';
  var CAT = null, ROLES = [['ground', 'Face / ground'], ['binder', 'Binder'], ['loop', 'Loop']];
  var S = { role: 'ground', specs: {} };
  var lastStudioSl = null, timer = null, seq = 0, lastResult = {};

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function r1(v) { return Math.round(v * 10) / 10; }

  // ── the defaults of a fresh melange ────────────────────────────────────────────────────────
  function blank() {
    return { enabled: false, type: 'fibre_melange', route: 'draw_frame', spinning: 'compact', count: 30, unit: 'ne',
      comps: [{ fibre: 'cotton', share: 90, method: '', colour: '#ede9df', ne: 30 }, { fibre: 'viscose', share: 10, method: 'dope_dyed', colour: '#1d1d20', ne: 30 }],
      adv: { target: '#9b9b9b', targetOn: false, trial: '', trialOn: false, sliver_cv: '', passages: '2', tolerance: '', max_doublings: '8', feeder_cv: '', ply_twist: '', slub_thick: '1.8', slub_len: '4', slub_gap: '20' } };
  }
  function cur() { return S.specs[S.role] || (S.specs[S.role] = blank()); }

  // ── CSS (self-contained: this card does not touch the page's stylesheet) ────────────────────
  var CSS = '' +
    '.ml-seg{display:flex;gap:4px;margin:4px 0 8px}.ml-seg button{flex:1;padding:6px 4px;border:1px solid var(--line2);background:var(--bg);border-radius:var(--radius-sm);font:600 11.5px var(--head);color:var(--t2);cursor:pointer;position:relative}' +
    '.ml-seg button.on{background:var(--accent-tint);border-color:var(--accent);color:var(--accent)}.ml-seg button .ml-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--good);margin-left:5px}' +
    '.ml-crow{display:grid;grid-template-columns:1.15fr .6fr 1.3fr 30px 22px;gap:5px;align-items:center;margin-bottom:5px}.ml-crow.ml-fold{grid-template-columns:1.15fr .7fr 1.3fr 30px 22px}' +
    '.ml-crow select,.ml-crow input[type=number]{width:100%;box-sizing:border-box;padding:6px 5px;border:1px solid var(--line2);border-radius:var(--radius-sm);font:12.5px var(--head);background:var(--bg);color:var(--t1);min-width:0}' +
    '.ml-crow input[type=color]{width:30px;height:28px;padding:0;border:1px solid var(--line2);border-radius:6px;background:none}.ml-crow button{border:0;background:none;color:var(--t3);cursor:pointer;font-size:16px;padding:0}' +
    '.ml-sum{font-size:12px;color:var(--t2);margin:8px 0 0;line-height:1.45}.ml-sw{display:inline-block;width:14px;height:14px;border-radius:4px;border:1px solid rgba(0,0,0,.15);vertical-align:-2px;margin-right:6px}' +
    '.ml-h{font:700 12px var(--head);letter-spacing:.04em;text-transform:uppercase;color:var(--t2);margin:18px 0 6px;padding-top:12px;border-top:1px solid var(--line)}.ml-h:first-child{margin-top:0;padding-top:0;border:0}' +
    '.ml-top{display:flex;gap:16px;align-items:center;flex-wrap:wrap}.ml-big{width:92px;height:92px;border-radius:12px;border:1px solid rgba(0,0,0,.15);flex:none}' +
    '.ml-strip{display:flex;height:22px;border-radius:6px;overflow:hidden;border:1px solid rgba(0,0,0,.12);margin:6px 0}.ml-strip i{display:block}' +
    '.ml-tbl{width:100%;border-collapse:collapse;font-size:12px;margin:4px 0 8px}.ml-tbl th{font:600 11px var(--head);color:var(--t2);text-align:right;padding:4px 6px;border-bottom:1px solid var(--line)}.ml-tbl th:first-child,.ml-tbl td:first-child{text-align:left}' +
    '.ml-tbl td{padding:4px 6px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums}.ml-tbl td.ml-warn{color:var(--danger);font-weight:700}' +
    '.ml-kv{display:grid;grid-template-columns:minmax(120px,max-content) 1fr;gap:3px 14px;font-size:12.5px}.ml-kv dt{color:var(--t2)}.ml-kv dd{margin:0}' +
    '.ml-b{display:inline-block;font:600 10px var(--mono,monospace);padding:1px 6px;border-radius:99px;margin-left:6px;vertical-align:1px;background:var(--bg2,#eef1f5);color:var(--t2)}' +
    '.ml-b-measured,.ml-b-calibrated{background:rgba(30,122,84,.12);color:var(--good)}.ml-b-law,.ml-b-blend,.ml-b-bound{background:rgba(24,87,196,.1);color:var(--accent)}.ml-b-typical,.ml-b-estimate{background:rgba(227,160,8,.15);color:#8a5b00}' +
    '.ml-step{border-left:3px solid var(--accent-line,#9bb8e8);padding:3px 0 3px 10px;margin:0 0 8px;font-size:12.5px}.ml-step b{display:block;color:var(--t1)}.ml-step span{color:var(--t2)}' +
    '.ml-bar{display:flex;align-items:center;gap:8px;font-size:12.5px;margin:0 0 7px}.ml-bar .ml-bt{flex:none;width:34%;color:var(--t1)}.ml-bar .ml-bg{flex:1;height:8px;background:var(--bg2,#eef1f5);border-radius:6px;overflow:hidden}.ml-bar .ml-bg i{display:block;height:100%}' +
    '.ml-lv{flex:none;font:700 10px var(--head);text-transform:uppercase;padding:1px 7px;border-radius:99px}.ml-lv-high{background:rgba(178,59,59,.12);color:var(--danger)}.ml-lv-medium{background:rgba(227,160,8,.18);color:#8a5b00}.ml-lv-low{background:rgba(30,122,84,.12);color:var(--good)}' +
    '.ml-note{font-size:12px;color:var(--t2);line-height:1.5;margin:4px 0}.ml-note.warn{color:#8a5b00}.ml-adv summary{cursor:pointer;font:600 12px var(--head);color:var(--t2);margin:8px 0 4px}' +
    '.ml-cv{width:100%;height:84px;display:block}.ml-rm{font-size:11.5px;color:var(--t3);margin:2px 0 8px;line-height:1.45}';

  // ── the card ───────────────────────────────────────────────────────────────────────────────
  function opts(list, sel, key, lab) { return list.map(function (o) { var v = key != null ? o[key] : o, l = lab != null ? o[lab] : o; return '<option value="' + esc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join(''); }
  function methodsFor(type) {
    if (type === 'cross_dye_heather') return [['', 'Undyed'], ['cross_dye', 'Dyed in the fabric']];
    return [['', 'Undyed'], ['stock_dyed', 'Stock-dyed'], ['dope_dyed', 'Spun-dyed']];
  }
  function buildCard() {
    var host = $('ml-card'); if (!host) return;
    if (!$('ml-css')) { var st = document.createElement('style'); st.id = 'ml-css'; st.textContent = CSS; document.head.appendChild(st); }
    if (!CAT) { host.innerHTML = '<div class="st-step"><b>2b</b> Melange / marl / heather</div><p class="st-hint">Loading…</p>'; return; }
    var c = cur(), cons = CAT.constructions.filter(function (x) { return x.id === c.type; })[0] || CAT.constructions[0];
    var fold = c.type === 'folded_marl';
    var roleBtns = ROLES.map(function (r) { return '<button type="button" data-ml-role="' + r[0] + '" class="' + (S.role === r[0] ? 'on' : '') + '">' + r[1] + ((S.specs[r[0]] && S.specs[r[0]].enabled) ? '<span class="ml-dot"></span>' : '') + '</button>'; }).join('');
    var rows = c.comps.map(function (k, i) {
      var undy = !k.method;
      return '<div class="ml-crow' + (fold ? ' ml-fold' : '') + '" data-i="' + i + '">' +
        '<select data-f="fibre" aria-label="Fibre">' + opts(CAT.fibres, k.fibre, 'id', 'label') + '</select>' +
        (fold ? '<input type="number" data-f="ne" min="4" max="120" step="0.5" value="' + esc(k.ne) + '" title="Count of this single yarn (Ne)" aria-label="Ne">' : '') +
        (fold ? '' : '<input type="number" data-f="share" min="0.5" max="100" step="0.5" value="' + esc(k.share) + '" title="share, % (as on the label)" aria-label="Share">') +
        '<select data-f="method" aria-label="How it is coloured">' + opts(methodsFor(c.type), k.method, 0, 1) + '</select>' +
        '<input type="color" data-f="colour" value="' + esc(undy ? (fibreHex(k.fibre) || '#ede9df') : k.colour) + '"' + (undy ? ' disabled' : '') + ' aria-label="Colour">' +
        '<button type="button" data-ml-del="' + i + '" title="Remove" aria-label="Remove">&times;</button></div>';
    }).join('');
    var adv = c.adv;
    host.innerHTML = '<div class="st-step"><b>2b</b> Melange / marl / heather</div>' +
      '<p class="st-hint" style="margin-top:0">A coloured yarn made by construction: fibres of different colour blended, spun or plied together. Switch it on for a yarn role; the Studio then uses its count, spinning system and true fibre mix.</p>' +
      '<div class="ml-seg" role="group" aria-label="Yarn role">' + roleBtns + '</div>' +
      '<label class="st-check"><input type="checkbox" id="ml-on"' + (c.enabled ? ' checked' : '') + '> This yarn is a melange / marl / heather</label>' +
      '<div id="ml-body"' + (c.enabled ? '' : ' hidden') + '>' +
      '<div class="st-row one"><div class="st-f"><label for="ml-preset">Start from a ready recipe</label><select id="ml-preset"><option value="">— choose —</option>' + opts(CAT.presets, '', 'id', 'label') + '</select></div></div>' +
      '<div class="st-row one"><div class="st-f"><label for="ml-type">Construction</label><select id="ml-type">' + opts(CAT.constructions, c.type, 'id', 'label') + '</select></div></div>' +
      '<p class="st-hint" style="margin:-2px 0 8px">' + esc(cons.what) + '</p>' +
      '<div class="st-row one"><div class="st-f"><label for="ml-route">Route</label><select id="ml-route">' + opts(cons.routes, c.route, 'id', 'label') + '</select></div></div>' +
      '<div class="st-row one"><div class="st-f"><label for="ml-spin">Spinning system</label><select id="ml-spin">' + opts(CAT.spinning, c.spinning, 'id', 'label') + '</select></div></div>' +
      (fold ? '' : '<div class="st-row"><div class="st-f"><label for="ml-count">Yarn count</label><input id="ml-count" type="number" min="3" max="120" step="0.5" value="' + esc(c.count) + '"></div>' +
        '<div class="st-f"><label for="ml-unit">Unit</label><select id="ml-unit">' + opts([['ne', 'Ne'], ['nm', 'Nm'], ['tex', 'tex']], c.unit, 0, 1) + '</select></div></div>') +
      '<div class="st-sub" style="margin:8px 0 4px">Components' + (fold ? ' — one single yarn each (fibre · Ne)' : ' (fibre · share % · colouring)') + '</div>' + rows +
      '<button type="button" class="st-btn" id="ml-add" style="margin:2px 0 6px"' + (c.comps.length >= 4 ? ' disabled' : '') + '>+ Add a fibre</button>' +
      '<details class="ml-adv"' + (adv.trialOn || adv.targetOn || adv.sliver_cv || adv.tolerance ? ' open' : '') + '><summary>Calibration &amp; mill figures</summary>' +
      '<label class="st-check" style="margin-top:4px"><input type="checkbox" id="ml-target-on"' + (adv.targetOn ? ' checked' : '') + '> I have a target shade to match</label>' +
      '<div class="st-row one"><div class="st-f"><label for="ml-target">Target colour — solve the share</label><input id="ml-target" type="color" value="' + esc(adv.target || '#9b9b9b') + '"' + (adv.targetOn ? '' : ' disabled') + ' style="height:32px;padding:2px"></div></div>' +
      '<label class="st-check" style="margin-top:4px"><input type="checkbox" id="ml-trial-on"' + (adv.trialOn ? ' checked' : '') + '> I have measured a trial blend</label>' +
      '<div class="st-row"><div class="st-f"><label for="ml-trial">Its colour</label><input id="ml-trial" type="color" value="' + esc(adv.trial || '#b5b5b5') + '"' + (adv.trialOn ? '' : ' disabled') + ' style="height:32px;padding:2px"></div>' +
      '<div class="st-f"><label for="ml-tol">Shade tolerance (ΔE)</label><input id="ml-tol" type="number" min="0.2" max="5" step="0.1" placeholder="1.0" value="' + esc(adv.tolerance) + '"></div></div>' +
      '<div class="st-row"><div class="st-f"><label for="ml-pass">Draw-frame passages</label><select id="ml-pass">' + opts([['1', '1'], ['2', '2'], ['3', '3']], adv.passages, 0, 1) + '</select></div>' +
      '<div class="st-f"><label for="ml-scv">Sliver weight CV (%)</label><input id="ml-scv" type="number" min="0.2" max="6" step="0.1" placeholder="typical 1.0" value="' + esc(adv.sliver_cv) + '"></div></div>' +
      '<div class="st-row"><div class="st-f"><label for="ml-dbl">Max doublings</label><select id="ml-dbl">' + opts([['6', '6'], ['8', '8']], adv.max_doublings, 0, 1) + '</select></div>' +
      '<div class="st-f"><label for="ml-fcv">Weigh-feeder CV (%)</label><input id="ml-fcv" type="number" min="0.2" max="8" step="0.1" placeholder="typical 2.0" value="' + esc(adv.feeder_cv) + '"></div></div>' +
      (c.type === 'folded_marl' ? '<div class="st-row one"><div class="st-f"><label for="ml-ptw">Ply twist (turns/m)</label><input id="ml-ptw" type="number" min="50" max="1500" step="10" placeholder="typical" value="' + esc(adv.ply_twist) + '"></div></div>' : '') +
      (c.type === 'slub_melange' ? '<div class="st-row"><div class="st-f"><label for="ml-sth">Slub thickness ×</label><input id="ml-sth" type="number" min="1.2" max="5" step="0.1" value="' + esc(adv.slub_thick) + '"></div><div class="st-f"><label for="ml-sln">Slub length (cm)</label><input id="ml-sln" type="number" min="1" max="30" step="0.5" value="' + esc(adv.slub_len) + '"></div></div><div class="st-row one"><div class="st-f"><label for="ml-sgp">Gap between slubs (cm)</label><input id="ml-sgp" type="number" min="2" max="100" step="1" value="' + esc(adv.slub_gap) + '"></div></div>' : '') +
      '<p class="st-hint">Leave blank to use the typical figure; enter your own and it is used and labelled measured. A trial blend (spun, knitted, measured) fits the colour model.</p></details>' +
      '<div class="ml-sum" id="ml-sum"></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button type="button" class="st-btn" id="ml-use-col" disabled>Use this colour in the 3D view</button><button type="button" class="st-btn" id="ml-open">Open the full chain</button></div>' +
      '</div>';
  }
  function fibreHex(id) { var f = (CAT && CAT.fibres || []).filter(function (x) { return x.id === id; })[0]; return f && f.natural_hex; }

  // ── reading the card back into the state ───────────────────────────────────────────────────
  function readRow(row, k) {
    var g = function (f) { var e = row.querySelector('[data-f="' + f + '"]'); return e ? e.value : null; };
    k.fibre = g('fibre'); k.method = g('method') || '';
    if (g('share') != null) k.share = parseFloat(g('share')) || 0;
    if (g('ne') != null) k.ne = parseFloat(g('ne')) || 30;
    var col = g('colour'); if (col && !k.method) { /* undyed: its natural colour is the engine's */ } else if (col) k.colour = col;
  }
  function readCard() {
    var c = cur(); var on = $('ml-on'); if (!on) return;
    c.enabled = on.checked;
    if (!$('ml-type')) return;
    c.type = $('ml-type').value; c.route = $('ml-route').value; c.spinning = $('ml-spin').value;
    if ($('ml-count')) { c.count = parseFloat($('ml-count').value) || c.count; c.unit = $('ml-unit').value; }
    Array.prototype.forEach.call(document.querySelectorAll('#ml-card .ml-crow'), function (row) { var k = c.comps[+row.getAttribute('data-i')]; if (k) readRow(row, k); });
    var a = c.adv, v = function (id) { var e = $(id); return e ? e.value : ''; };
    a.targetOn = $('ml-target-on').checked; a.target = v('ml-target') || a.target;
    a.trialOn = $('ml-trial-on').checked; a.trial = v('ml-trial'); a.tolerance = v('ml-tol'); a.passages = v('ml-pass'); a.sliver_cv = v('ml-scv'); a.max_doublings = v('ml-dbl'); a.feeder_cv = v('ml-fcv');
    if ($('ml-ptw')) a.ply_twist = v('ml-ptw');
    if ($('ml-sth')) { a.slub_thick = v('ml-sth'); a.slub_len = v('ml-sln'); a.slub_gap = v('ml-sgp'); }
  }
  function specOf(c) {
    var fold = c.type === 'folded_marl', a = c.adv, n = function (x) { var v = parseFloat(x); return v > 0 ? v : undefined; };
    var spec = { type: c.type, route: c.route, spinning: c.spinning, count: { value: c.count, unit: c.unit },
      components: c.comps.map(function (k) {
        var o = { fibre: k.fibre, share: k.share };
        if (k.method) { o.method = k.method; o.colour = k.colour; }
        if (fold) o.tex = 590.5 / (k.ne || 30);
        return o;
      }),
      passages: n(a.passages), sliver_cv_pct: n(a.sliver_cv), feeder_cv_pct: n(a.feeder_cv), tolerance_dE: n(a.tolerance), max_doublings: n(a.max_doublings), ply_twist_tpm: n(a.ply_twist) };
    if (a.trialOn && a.trial) spec.trial = { colour: a.trial };
    if (a.targetOn && a.target) spec.target = { colour: a.target };
    if (c.type === 'slub_melange') spec.slub = { thickness: n(a.slub_thick), length_cm: n(a.slub_len), spacing_cm: n(a.slub_gap) };
    if (lastStudioSl > 0) spec.stitch_length_mm = lastStudioSl;
    return spec;
  }

  // ── the one-line summary under the card, and the full tab ──────────────────────────────────
  function summary(r) {
    var el = $('ml-sum'); if (!el) return;
    if (!r) { el.textContent = ''; return; }
    if (r.error) { el.innerHTML = '<span style="color:var(--danger)">' + esc(r.error) + '</span>'; $('ml-use-col').disabled = true; return; }
    el.innerHTML = '<span class="ml-sw" style="background:' + esc(r.colour.blend.hex) + '"></span><b>' + esc(r.identity.title) + '</b><br>' + esc(r.identity.detail) + '<br>blend colour L* ' + r.colour.blend.L + ' · ' + esc(r.colour.contrast_note);
    $('ml-use-col').disabled = false; $('ml-use-col').setAttribute('data-hex', r.colour.blend.hex);
  }
  function tag(t) { return t ? '<span class="ml-b ml-b-' + esc(t) + '">' + esc(t) + '</span>' : ''; }
  function val(o, d) { return o && o.value != null ? (d === undefined ? o.value : (+o.value).toFixed(d)) + (o.unit ? ' ' + o.unit : '') + tag(o.basis) : '—'; }
  function curveSvg(r) {
    var cu = r.colour.curve, W = 100, stops = cu.map(function (p) { return '<stop offset="' + p.share_pct + '%" stop-color="' + p.hex + '"/>'; }).join('');
    var p0 = r.colour._eff_share != null ? r.colour._eff_share : null;
    var dark = r.components.filter(function (c) { return c.dry_share_pct === Math.min.apply(null, r.components.map(function (x) { return x.dry_share_pct; })); })[0];
    void dark;
    return '<svg class="ml-cv" viewBox="0 0 ' + W + ' 14" preserveAspectRatio="none"><defs><linearGradient id="ml-g" x1="0" x2="1">' + stops + '</linearGradient></defs><rect x="0" y="0" width="100" height="9" rx="1.5" fill="url(#ml-g)" stroke="rgba(0,0,0,.2)" stroke-width=".25"/>' +
      (p0 != null ? '<path d="M' + p0 + ' 9 l-1.6 3.8 h3.2z" fill="#1d1d20"/>' : '') + '</svg>';
  }
  function render(r) {
    var pane = $('pane-melange'); if (!pane) return;
    if (!r) { pane.innerHTML = '<p class="st-p">Switch the melange on for a yarn role (the Melange card, under Yarn) to see its whole chain here.</p>'; return; }
    if (r.error) { pane.innerHTML = '<div class="st-err">' + esc(r.error) + '</div>'; return; }
    var h = '';
    var comp = r.components;
    h += '<div class="ml-top"><div class="ml-big" style="background:' + esc(r.colour.blend.hex) + '"></div><div style="flex:1;min-width:220px"><div style="font:700 17px var(--head)">' + esc(r.identity.title) + '</div><div class="ml-note">' + esc(r.identity.detail) + '</div>' +
      '<div class="ml-strip">' + comp.map(function (c) { return '<i style="width:' + c.area_share_pct + '%;background:' + esc(c.hex) + '" title="' + esc(c.label) + ' ' + c.area_share_pct + '% of the surface"></i>'; }).join('') + '</div>' +
      '<div class="ml-note">' + esc(r.construction.what) + ' <b>' + esc(r.construction.route.label) + '</b> — ' + esc(r.construction.route.note) + '.</div></div></div>';
    // colour
    var cl = r.colour;
    h += '<div class="ml-h">Colour</div><dl class="ml-kv"><dt>Blend colour</dt><dd><span class="ml-sw" style="background:' + esc(cl.blend.hex) + '"></span>' + esc(cl.blend.hex) + ' · L* ' + cl.blend.L + tag(cl.model.basis) + '</dd>' +
      '<dt>Model</dt><dd>' + esc(cl.model.label) + '</dd><dt>Contrast between components</dt><dd>ΔE ' + cl.contrast_dE + ' — ' + esc(cl.contrast_note) + '</dd>' +
      (r.trade_shade ? '<dt>Trade shade</dt><dd>' + esc(r.trade_shade.label) + ' (' + r.trade_shade.dark_share_pct + ' % dark fibre; usually ' + r.trade_shade.usual_range[0] + '–' + r.trade_shade.usual_range[1] + ' %)</dd>' : '') +
      '<dt>Steepness</dt><dd>' + esc(cl.sensitivity.note) + tag(cl.sensitivity.basis) + '</dd></dl>' +
      curveSvg({ colour: Object.assign({}, cl, { _eff_share: effShare(r) }), components: comp }) +
      '<div class="ml-rm">The strip is the blend colour as the share of ' + esc((comp.filter(function (c) { return c.fibre === r.effect_component; })[0] || comp[0]).label.toLowerCase()) + ' goes from 0 to 100 %; ▲ is this recipe. A light shade sits on the steep part: a point of share moves it most.</div>';
    var tg = cl.target;
    if (tg) {
      h += '<div class="ml-h">To match ' + esc(tg.target_hex) + '</div>' + (tg.reachable
        ? '<dl class="ml-kv"><dt>Needed</dt><dd><span class="ml-sw" style="background:' + esc(tg.hex_at) + '"></span><b>' + tg.label_share_pct + ' % ' + esc(tg.effect_component) + '</b> on the label (' + tg.dry_share_pct + ' % dry)' + tag(tg.basis) + '</dd><dt>What is left</dt><dd>ΔE ' + tg.remaining_dE + ' — ' + esc(tg.remaining_note) + '</dd></dl>' +
          '<table class="ml-tbl"><tr><th>Doublings</th><th>Coloured : base</th><th>Share with equal slivers %</th><th>Off target (points)</th><th>Coloured sliver weight to hit it (% of base)</th></tr>' + tg.creel.slice(0, 3).map(function (o) { return '<tr><td>' + o.doublings + '</td><td>' + o.effect_slivers + ' : ' + o.base_slivers + '</td><td>' + o.share_equal_weights_pct + '</td><td>' + o.error_points + '</td><td>' + o.effect_sliver_weight_needed_pct_of_base + '</td></tr>'; }).join('') + '</table>' +
          '<button type="button" class="st-btn" data-ml-apply-share="' + tg.effect_index + '|' + tg.label_share_pct + '">Set the recipe to ' + tg.label_share_pct + ' %</button>'
        : '<div class="ml-note warn">' + esc(tg.note) + '</div>');
    }
    // mass chain
    var mc = r.mass_chain;
    h += '<div class="ml-h">Mass chain — what the mill must weigh</div><table class="ml-tbl"><tr><th>Fibre</th><th>Label %</th><th>Dry %</th><th>Regain %</th><th>Realization %</th><th>Bale issue kg</th><th>Issue %</th><th>If weighed at label %</th></tr>' +
      mc.per_component.map(function (c) { var drift = Math.abs(c.if_weighed_at_label_ratio_pct - c.label_share_pct) > 0.5; return '<tr><td>' + esc(c.label) + '</td><td>' + c.label_share_pct + '</td><td>' + c.dry_share_pct + '</td><td>' + c.regain_pct + '</td><td>' + c.realization_pct + (c.waste_basis === 'typical' ? '*' : '') + '</td><td>' + c.issue_conditioned_kg + '</td><td>' + c.issue_share_pct + '</td><td class="' + (drift ? 'ml-warn' : '') + '">' + c.if_weighed_at_label_ratio_pct + '</td></tr>'; }).join('') + '</table>' +
      '<div class="ml-rm">Per ' + mc.basis_kg_conditioned_yarn + ' kg of finished yarn (conditioned): ' + mc.issue_total_conditioned_kg + ' kg of bale, overall realization ' + mc.overall_realization_pct + ' %; blend regain ' + mc.blend_regain.value + ' %. * waste figures are typical — enter your own records. Issue the bales by <b>Issue %</b>; weighing at the label ratio gives the last column (red where the shade drifts).</div>';
    // mixing
    var mx = r.mixing;
    h += '<div class="ml-h">Mixing — how even the blend is</div><dl class="ml-kv"><dt>Fibres in the yarn section</dt><dd>' + mx.fibres_in_section + tag('law') + '</dd>' +
      (r.construction.group === 'ply' ? '' : '<dt>Random-mix spread</dt><dd>' + mx.random_mix.cv_section_pct + ' % of the ' + esc(mx.effect_component) + ' share in one section (ideal ' + mx.random_mix.ideal_cv_pct + ' %, route factor ' + mx.random_mix.mixing_factor + ')' + tag('law') + '</dd>') +
      (r.construction.group === 'ply' ? '' : '<dt>Mottle in one stitch</dt><dd>ΔE ±' + mx.mottle.shade_dE_1sigma + ' — of which the route adds ±' + mx.mottle.extra_from_mixing_dE + tag('estimate') + '</dd>') +
      (mx.lot ? '<dt>Lot-to-lot share spread</dt><dd>±' + mx.lot.sigma_points + ' points (1σ) → ΔE ±' + mx.lot_shade.two_sigma_dE + ' (2σ) against ' + mx.lot_shade.tolerance_dE + ' <span class="ml-lv ml-lv-' + (mx.lot_shade.grade === 'safe' ? 'low' : mx.lot_shade.grade === 'tight' ? 'medium' : 'high') + '">' + mx.lot_shade.grade + '</span></dd>' : '') + '</dl>';
    if (mx.creel) {
      h += '<div class="ml-note" style="margin-top:8px"><b>Draw-frame creel</b> — whole slivers only; ' + esc(mx.creel.per_pct_note) + '.</div><table class="ml-tbl"><tr><th>Doublings</th><th>Coloured : base</th><th>Share with equal slivers %</th><th>Off target (points)</th><th>Coloured sliver weight to hit it (% of base)</th></tr>' +
        mx.creel.options.map(function (o) { return '<tr><td>' + o.doublings + '</td><td>' + o.effect_slivers + ' : ' + o.base_slivers + '</td><td>' + o.share_equal_weights_pct + '</td><td>' + o.error_points + '</td><td>' + o.effect_sliver_weight_needed_pct_of_base + '</td></tr>'; }).join('') + '</table>' +
        (mx.creel.sliver_weight_shift ? '<div class="ml-note">A ' + mx.creel.sliver_weight_shift.shift_g_per_m + ' g/m shift in a ' + mx.creel.sliver_weight_shift.sliver_g_per_m + ' g/m sliver moves the share by ' + mx.creel.sliver_weight_shift.share_moves_points + ' points.</div>' : '');
    }
    // yarn
    var y = r.yarn;
    h += '<div class="ml-h">The yarn</div><dl class="ml-kv"><dt>Count</dt><dd>' + y.count.ne.value + 's Ne · ' + y.count.tex.value + ' tex · ' + y.count.nm.value + ' Nm' + tag('law') + (y.count.plies ? '<br>plies: ' + y.count.plies.map(function (p) { return p.ne + 's'; }).join(' + ') + ' → nominal ' + y.count.nominal_ne.value + 's, resultant ' + y.count.resultant_ne.value + 's' : '') + (y.count.slub ? '<br>slub: base ' + y.count.slub.base_ne + 's → resultant ' + y.count.slub.resultant_ne + 's (+' + y.count.slub.extra_mass_pct + ' % mass)' : '') + '</dd>' +
      '<dt>Spinning</dt><dd>' + esc(y.spinning.label || y.spinning.id) + '</dd>' +
      '<dt>Diameter</dt><dd>' + val(y.diameter, 3) + '</dd>' + (y.twist ? '<dt>Twist</dt><dd>' + val(y.twist.tpm, 0) + ' · αe ' + (+y.twist.alpha_e.value).toFixed(2) + '</dd>' : '') +
      (y.strength.rkm ? '<dt>Strength</dt><dd>' + val(y.strength.rkm, 1) + ' — breaking load ' + val(y.strength.breaking_load, 2) + '</dd>' : '') +
      '<dt>What dyed fibre costs</dt><dd>' + val(y.strength.dyed_fibre_loss_pct, 1) + ' of the strength (range ' + y.strength.dyed_fibre_loss_pct.range.join('–') + ' %)</dd>' +
      (y.evenness.cvm_pct ? '<dt>Evenness</dt><dd>CVm ' + val(y.evenness.cvm_pct, 1) + ' (ideal limit ' + y.evenness.limit_pct.value + ' %) · IPI ≈ ' + (y.evenness.ipi ? y.evenness.ipi.ipi : '—') + '</dd>' : '') +
      '<dt>Hairiness</dt><dd>' + val(y.hairiness, 1) + '</dd>' +
      (y.knitting_performance ? '<dt>Knitting performance</dt><dd>' + esc(y.knitting_performance.rating) + ' — about ' + y.knitting_performance.expected_efficiency_pct + ' % efficiency</dd>' : '') + '</dl>';
    if (r.marl) {
      h += '<div class="ml-h">Marl look — the colour turn against the stitch</div><dl class="ml-kv"><dt>Colour pitch</dt><dd>' + val(r.marl.colour_pitch_mm, 2) + ' per turn (ply twist ' + val(r.marl.ply_twist_tpm, 0) + ')</dd><dt>Turns per stitch</dt><dd>' + r.marl.turns_per_stitch + ' at a ' + r.marl.stitch_length_mm + ' mm stitch</dd></dl>' +
        '<div class="ml-note' + (r.marl.level === 'warn' ? ' warn' : '') + '">' + esc(r.marl.look) + (r.marl.advice ? '. ' + esc(r.marl.advice) : '') + '</div>';
    }
    // knitting
    h += '<div class="ml-h">Knitting</div><dl class="ml-kv"><dt>Running tension</dt><dd>' + val(r.knitting.running_tension_cN, 1) + '</dd>' + (r.knitting.strength_margin ? '<dt>Strength margin</dt><dd>' + val(r.knitting.strength_margin, 1) + ' (breaking load ÷ tension)</dd>' : '') + '</dl>' +
      '<ul class="ml-note" style="padding-left:18px;margin:4px 0">' + r.knitting.recommendations.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
    // wet route
    var w = r.wet;
    h += '<div class="ml-h">Wet route — ' + esc(w.title) + '</div>' + w.stages.map(function (s) { return '<div class="ml-step"><b>' + esc(s.stage) + '</b>' + esc(s.conditions) + '<br><span>' + esc(s.why) + '</span></div>'; }).join('');
    var wk = w.water && (w.water.route_a_l_per_kg || w.water.cross_dye_l_per_kg);
    if (wk) h += '<div class="ml-rm">Water: ' + (w.water.route_a_l_per_kg ? 'about ' + w.water.route_a_l_per_kg.value + ' L/kg here against about ' + w.water.piece_dye_l_per_kg.value + ' L/kg for piece-dyeing the same cloth' : 'about ' + wk.value + ' L/kg') + tag('typical') + '</div>';
    // defects
    h += '<div class="ml-h">Defects this construction carries</div>' + r.defects.map(function (d) {
      return '<div class="ml-bar"><span class="ml-bt">' + esc(d.label) + '</span><span class="ml-bg"><i style="width:' + Math.round(d.risk * 100) + '%;background:' + (d.level === 'high' ? 'var(--danger)' : d.level === 'medium' ? '#e3a008' : 'var(--good)') + '"></i></span><span class="ml-lv ml-lv-' + d.level + '">' + d.level + '</span></div><div class="ml-rm" style="margin-top:-3px"><b>Why:</b> ' + esc(d.why) + '. <b>Remedy:</b> ' + esc(d.remedy) + '</div>';
    }).join('');
    // checks
    var ck = r.checks.filter(function (c) { return c.level !== 'ok'; });
    if (ck.length) h += '<div class="ml-h">Notes</div>' + ck.map(function (c) { return '<div class="ml-note' + (c.level === 'warn' ? ' warn' : '') + '">' + (c.level === 'warn' ? '⚠ ' : '• ') + esc(c.text) + '</div>'; }).join('');
    pane.innerHTML = h;
  }
  function effShare(r) { return r.colour.sensitivity ? r.colour.sensitivity.at_share_pct : null; }

  // ── talking to the engine ──────────────────────────────────────────────────────────────────
  function run() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      var c = cur(); if (!c.enabled) { summary(null); lastResult[S.role] = null; render(firstResult()); return; }
      var my = ++seq;
      var apiFetch = window.apiFetch; if (!apiFetch) return;
      apiFetch('/api/studio/melange', { method: 'POST', body: specOf(c) }).then(function (r) { if (my !== seq) return; lastResult[S.role] = r; summary(r); render(r); })
        .catch(function (e) { if (my !== seq) return; var r = { error: (e.data && e.data.error) || e.message || 'Could not work this yarn out.' }; lastResult[S.role] = r; summary(r); render(r); });
    }, 260);
  }
  function firstResult() { for (var i = 0; i < ROLES.length; i++) if (lastResult[ROLES[i][0]] && S.specs[ROLES[i][0]] && S.specs[ROLES[i][0]].enabled) return lastResult[ROLES[i][0]]; return null; }

  // ── events ─────────────────────────────────────────────────────────────────────────────────
  function applyPreset(id) {
    var p = (CAT.presets || []).filter(function (x) { return x.id === id; })[0]; if (!p) return;
    var sp = p.spec, c = cur(), keep = c.enabled;
    var b = blank();
    b.enabled = keep || true; b.type = sp.type; b.route = sp.route || (CAT.constructions.filter(function (x) { return x.id === sp.type; })[0].routes[0].id);
    b.spinning = sp.spinning || 'combed'; b.count = sp.count.value; b.unit = sp.count.unit;
    b.comps = sp.components.map(function (k) { return { fibre: k.fibre, share: k.share, method: k.method || '', colour: k.colour || fibreHex(k.fibre) || '#ede9df', ne: sp.count.value }; });
    S.specs[S.role] = b;
  }
  // "Set the recipe to x %" sits in the results tab, outside the card
  function applyShare(btn) {
    var pr = btn.getAttribute('data-ml-apply-share').split('|'), ix = +pr[0], pc = parseFloat(pr[1]), c = cur();
    var others = c.comps.reduce(function (t, k, i) { return i === ix ? t : t + k.share; }, 0) || 1;
    c.comps.forEach(function (k, i) { k.share = i === ix ? pc : Math.round((k.share / others) * (100 - pc) * 100) / 100; });
    buildCard(); run();
  }
  function bind() {
    var pane = $('pane-melange');
    if (pane) pane.addEventListener('click', function (e) { var b = e.target.closest('[data-ml-apply-share]'); if (b) applyShare(b); });
    var host = $('ml-card'); if (!host) return;
    host.addEventListener('click', function (e) {
      var rb = e.target.closest('[data-ml-role]');
      if (rb) { readCard(); S.role = rb.getAttribute('data-ml-role'); buildCard(); summary(lastResult[S.role]); run(); return; }
      var del = e.target.closest('[data-ml-del]');
      if (del) { readCard(); var c = cur(); if (c.comps.length > 2) { c.comps.splice(+del.getAttribute('data-ml-del'), 1); buildCard(); run(); } return; }
      if (e.target.id === 'ml-add') { readCard(); var c2 = cur(); if (c2.comps.length < 4) { c2.comps.push({ fibre: 'viscose', share: 10, method: '', colour: '#ede9df', ne: c2.count }); buildCard(); run(); } return; }
      if (e.target.id === 'ml-use-col') { var hx = e.target.getAttribute('data-hex'), col = $('st-col'); if (col && hx) { col.value = hx; col.dispatchEvent(new Event('change', { bubbles: true })); } return; }
      if (e.target.id === 'ml-open') { var tb = document.querySelector('.st-tabs [data-tab="melange"]'); if (tb) tb.click(); }
    });
    host.addEventListener('change', function (e) {
      var t = e.target;
      if (t.id === 'ml-preset') { applyPreset(t.value); buildCard(); run(); return; }
      var wasType = cur().type; readCard();
      if (t.id === 'ml-type') {
        var cons = CAT.constructions.filter(function (x) { return x.id === cur().type; })[0];
        if (cons.routes.map(function (r) { return r.id; }).indexOf(cur().route) < 0) cur().route = cons.routes[0].id;
        if (cur().type === 'siro_marl' && cur().spinning !== 'siro' && cur().spinning !== 'siro_compact') cur().spinning = 'siro';
        // methods differ by construction: an undyed fibre stays undyed, a dyed one takes the construction's usual method
        cur().comps.forEach(function (k) { if (k.method && cur().type === 'cross_dye_heather') k.method = 'cross_dye'; else if (k.method === 'cross_dye') k.method = 'stock_dyed'; });
        if (cur().type !== wasType) buildCard();
      }
      if (t.getAttribute && t.getAttribute('data-f') === 'method') buildCard();
      if (t.id === 'ml-on') { buildCard(); }
      if (t.id === 'ml-trial-on' || t.id === 'ml-target-on') buildCard();
      run();
    });
    host.addEventListener('input', function (e) { var t = e.target; if (t.type === 'number' || t.type === 'color') { readCard(); run(); } });
  }

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
    ROLES.forEach(function (r) { var c = S.specs[r[0]]; if (c) { var b = blank(); Object.keys(b).forEach(function (k) { if (c[k] === undefined) c[k] = b[k]; }); c.adv = Object.assign(blank().adv, c.adv || {}); } });
    buildCard(); run();
  }
  function setCatalogue(c) { CAT = c || null; buildCard(); run(); }
  function studioResult(r) {
    var sl = r && r.fabric && +r.fabric.sl_mm;
    if (!(sl > 0)) return;
    if (!lastStudioSl || Math.abs(sl - lastStudioSl) / lastStudioSl > 0.02) { lastStudioSl = sl; if (S.specs[S.role] && S.specs[S.role].enabled && /marl/.test(cur().type + '')) run(); else if (anyOn()) run(); }
  }
  function anyOn() { return ROLES.some(function (r) { return S.specs[r[0]] && S.specs[r[0]].enabled; }); }

  window.KAStudioMelange = { payload: payload, state: state, setState: setState, setCatalogue: setCatalogue, studioResult: studioResult, hasAny: anyOn };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { buildCard(); bind(); render(null); }); else { buildCard(); bind(); render(null); }
})();
