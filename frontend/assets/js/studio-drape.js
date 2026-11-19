/**
 * Fabric Studio — the drape and water-drop card and its results tab.
 *
 * Left (the "Drape & drop" card): the cloth is hung under gravity from the hand engine's own numbers (backend/engine/domain/drape-engine.js) — a Cusick drape test
 * (30 cm round sample on an 18 cm disc: the drape coefficient and the number of folds) or a circular skirt from a waist ring — when "Run" is pressed (a run
 * takes about a second, so it is asked for, not run on every edit). The water-repellent finish (DWR) choice is worked out with every answer
 * (backend/engine/domain/repellency-engine.js): the contact angle, the spray rating and the angle a drop rolls off at.
 *
 * Right (the "Drape" tab): the hung cloth as a picture you can turn, the outline seen from above, the numbers, and the lotus drop on the cloth — tilt it and
 * watch the drop roll off (or cling).
 *
 * Plain script, no dependencies. window.KAStudioDrape: payload(), state(), setState(), setCatalogue(c), studioResult(r), setHost({ design, fetch })
 */
(function () {
  'use strict';
  var CAT = null, S = blank(), last = null, run = null, host = null, busy = false, view = { az: 35, el: 38 }, tilt = 0, anim = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function blank() { return { enabled: false, test: 'cusick', dwr: 'none' }; }
  function ensureCss() {
    if (!$('ml-css') && window.KAStudioMelange && window.KAStudioMelange.css) { var m = document.createElement('style'); m.id = 'ml-css'; m.textContent = window.KAStudioMelange.css; document.head.appendChild(m); }
    if (!$('bl-css') && window.KAStudioBlend && window.KAStudioBlend.css) { var b = document.createElement('style'); b.id = 'bl-css'; b.textContent = window.KAStudioBlend.css; document.head.appendChild(b); }
    if (!$('dp-css')) { var h = document.createElement('style'); h.id = 'dp-css'; h.textContent = '.dp-cv{width:100%;aspect-ratio:4/3;background:var(--bg2,#eef1f5);border-radius:10px;border:1px solid var(--line,#d7dbe0);cursor:grab;touch-action:none;display:block}.dp-pair{display:grid;grid-template-columns:2fr 1fr;gap:10px;align-items:start}@media(max-width:700px){.dp-pair{grid-template-columns:1fr}}.dp-top{width:100%;aspect-ratio:1/1;background:var(--bg2,#eef1f5);border-radius:10px;border:1px solid var(--line,#d7dbe0);display:block}.dp-drop{width:100%;height:150px;background:var(--bg2,#eef1f5);border-radius:10px;border:1px solid var(--line,#d7dbe0);display:block}'; document.head.appendChild(h); }
  }
  function opts(list, sel) { return list.map(function (o) { return '<option value="' + esc(o.id) + '"' + (String(o.id) === String(sel) ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join(''); }

  function buildCard() {
    var el = $('dp-card'); if (!el) return;
    ensureCss();
    if (!CAT) { el.innerHTML = '<div class="st-step"><b>2i</b> Drape &amp; drop</div><p class="st-hint">Loading…</p>'; return; }
    var c = S;
    el.innerHTML = '<div class="st-step"><b>2i</b> Drape &amp; drop — how it hangs, how it sheds water</div>' +
      '<p class="st-hint" style="margin-top:0">Hang the cloth under gravity from its own tester numbers (weight, bending, shear, stretch) and read the drape coefficient and the folds; and see what a drop of water does on it, with or without a water-repellent finish.</p>' +
      '<label class="st-check"><input type="checkbox" id="dp-on"' + (c.enabled ? ' checked' : '') + '> Work out the drape and the water drop</label>' +
      '<div id="dp-body"' + (c.enabled ? '' : ' hidden') + '>' +
      '<div class="st-row"><div class="st-f"><label for="dp-test">Drape test</label><select id="dp-test">' + opts(CAT.tests, c.test) + '</select></div>' +
      '<div class="st-f"><label for="dp-dwr">Water-repellent finish</label><select id="dp-dwr">' + opts(CAT.finishes, c.dwr) + '</select></div></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="st-btn primary" id="dp-run">Run the drape test</button><button type="button" class="st-btn" id="dp-open">Open the drape</button></div>' +
      '<div class="ml-sum" id="dp-sum"></div></div>';
    summary();
  }
  function readCard() { var on = $('dp-on'); if (!on) return; S.enabled = on.checked; if ($('dp-test')) { S.test = $('dp-test').value; S.dwr = $('dp-dwr').value; } }
  function summary() {
    var el = $('dp-sum'); if (!el) return;
    var t = [];
    if (busy) t.push('Hanging the cloth…');
    else if (run && run.success !== false) t.push(run.test === 'cusick' ? 'drape coefficient <b>' + run.drape_coefficient.value + ' %</b> · ' + run.folds.nodes + ' folds' : 'skirt hem sweep <b>' + run.skirt.hem_sweep_ratio + '</b> · ' + run.folds.nodes + ' folds');
    else if (run) t.push(esc(run.error));
    if (last && last.success !== false) t.push('drop on the cloth: <b>' + last.contact_angle.value + '°</b> · spray ' + last.spray_rating.value);
    el.innerHTML = t.join('<br>') || (S.enabled ? 'The water drop is worked out with the Studio\'s next answer; press Run to hang the cloth.' : '');
  }

  function tag(t) { return t ? '<span class="ml-b ml-b-' + esc(t) + '">' + esc(t) + '</span>' : ''; }
  function kpis(list) { return '<div class="bl-kpis">' + list.map(function (k) { return '<div class="bl-kpi"><b>' + esc(k[1]) + '</b><span>' + esc(k[0]) + (k[2] ? tag(k[2]) : '') + '</span></div>'; }).join('') + '</div>'; }
  function notes(list) { return (list || []).map(function (w) { return '<div class="ml-note' + (w.level === 'warn' ? ' warn' : '') + '">' + esc(w.text) + '</div>'; }).join(''); }

  // ── the hung cloth: the lattice drawn as shaded triangles, turned by dragging ─────────────────────────
  function drawCloth() {
    var cv = $('dp-cv'); if (!cv || !run || !run.mesh) return;
    var dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (W < 40 || H < 40) return;                                    // the tab is not showing: it is drawn when it is opened
    cv.width = W * dpr; cv.height = H * dpr;
    var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    var m = run.mesh, n = m.x.length, id = {}, k;
    for (k = 0; k < n; k++) id[m.i[k] + ',' + m.j[k]] = k;
    var az = view.az * Math.PI / 180, el = view.el * Math.PI / 180, ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(el), se = Math.sin(el);
    var P = [];
    for (k = 0; k < n; k++) { var x = m.x[k] * ca - m.y[k] * sa, y = m.x[k] * sa + m.y[k] * ca, z = m.z[k]; P.push({ x: x, y: y * se + z * ce, d: y * ce - z * se, X: x, Y: y, Z: z }); }
    var span = run.test === 'skirt' ? 62 : 17, sc = Math.min(W, H) / (2.2 * span), cx = W / 2, cy = H / 2 + (run.test === 'skirt' ? span * sc * 0.15 : 0);
    var tris = [];
    for (k = 0; k < n; k++) {
      var a = k, b = id[(m.i[k] + 1) + ',' + m.j[k]], c = id[(m.i[k] + 1) + ',' + (m.j[k] + 1)], d = id[m.i[k] + ',' + (m.j[k] + 1)];
      if (b == null || c == null || d == null) continue;
      tris.push([a, b, c]); tris.push([a, c, d]);
    }
    var base = (($('st-col') && $('st-col').value) || '#6f8fb8'), rgb = [parseInt(base.slice(1, 3), 16) || 110, parseInt(base.slice(3, 5), 16) || 143, parseInt(base.slice(5, 7), 16) || 184];
    var L = [0.35, -0.45, 0.82], ll = Math.hypot(L[0], L[1], L[2]); L = L.map(function (v) { return v / ll; });
    var items = tris.map(function (t) {
      var p0 = P[t[0]], p1 = P[t[1]], p2 = P[t[2]];
      var ux = p1.X - p0.X, uy = p1.Y - p0.Y, uz = p1.Z - p0.Z, vx = p2.X - p0.X, vy = p2.Y - p0.Y, vz = p2.Z - p0.Z;
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, nl = Math.hypot(nx, ny, nz) || 1;
      var dot = Math.abs((nx * L[0] + ny * L[1] + nz * L[2]) / nl);
      return { t: t, depth: (p0.d + p1.d + p2.d) / 3, shade: 0.35 + 0.65 * dot };
    }).sort(function (u, v) { return v.depth - u.depth; });
    items.forEach(function (it) {
      var q = it.t.map(function (i) { return P[i]; });
      g.beginPath(); g.moveTo(cx + q[0].x * sc, cy - q[0].y * sc); g.lineTo(cx + q[1].x * sc, cy - q[1].y * sc); g.lineTo(cx + q[2].x * sc, cy - q[2].y * sc); g.closePath();
      g.fillStyle = 'rgb(' + Math.round(rgb[0] * it.shade) + ',' + Math.round(rgb[1] * it.shade) + ',' + Math.round(rgb[2] * it.shade) + ')'; g.fill();
      g.strokeStyle = g.fillStyle; g.lineWidth = 0.6; g.stroke();
    });
  }
  function drawTop() {
    var cv = $('dp-top'); if (!cv || !run) return;
    var dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (W < 40 || H < 40) return;
    cv.width = W * dpr; cv.height = H * dpr;
    var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    var R = run.sample.diameter_cm / 2, sc = (Math.min(W, H) / 2 - 8) / R, cx = W / 2, cy = H / 2;
    g.strokeStyle = '#9aa3ad'; g.setLineDash([4, 3]); g.beginPath(); g.arc(cx, cy, R * sc, 0, 2 * Math.PI); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(120,130,145,.35)'; g.beginPath(); g.arc(cx, cy, run.sample.support_cm / 2 * sc, 0, 2 * Math.PI); g.fill();
    var o = run.outline; g.beginPath();
    o.forEach(function (r, b) { var th = -Math.PI + (b + 0.5) * (2 * Math.PI / o.length); var x = cx + r * sc * Math.cos(th), y = cy - r * sc * Math.sin(th); if (b) g.lineTo(x, y); else g.moveTo(x, y); });
    g.closePath(); g.fillStyle = 'rgba(47,111,176,.18)'; g.fill(); g.strokeStyle = '#2f6fb0'; g.lineWidth = 1.6; g.stroke();
  }

  // ── the lotus drop: a spherical cap with the contact angle; tilt the cloth and it rolls off at the roll-off angle, or clings ──
  function dropSvg(tl) {
    var th = last.contact_angle.value, ro = last.roll_off.value, sticks = last.roll_off.sticks;
    var W = 300, H = 150, thr = Math.max(8, Math.min(172, th)) * Math.PI / 180, wBase = th < 12 ? 70 : 46;
    var R = wBase / (2 * Math.sin(thr)), hh = R * (1 - Math.cos(thr));
    var slid = !sticks && ro != null && tl >= ro ? Math.min(1, (tl - ro) / Math.max(6, 90 - ro)) : 0, dx = slid * 110;
    var big = th > 90 ? 1 : 0;
    var path = 'M ' + (-wBase / 2) + ' 0 A ' + R.toFixed(1) + ' ' + R.toFixed(1) + ' 0 ' + big + ' 1 ' + (wBase / 2) + ' 0 Z';
    if (th < 12) path = 'M ' + (-wBase / 2) + ' 0 Q 0 ' + (-hh).toFixed(1) + ' ' + (wBase / 2) + ' 0 Z';
    return '<svg class="dp-drop" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="A drop on the cloth">' +
      '<g transform="translate(' + W / 2 + ' ' + (H * 0.62) + ') rotate(' + (-tl * 0.5).toFixed(1) + ')"><rect x="-130" y="0" width="260" height="9" rx="3" fill="#8a94a1" opacity=".75"/>' +
      '<g transform="translate(' + (dx - (tl > 0 ? 0 : 0)).toFixed(1) + ' 0)"><path d="' + path + '" fill="#5aa9e6" fill-opacity=".72" stroke="#2f78b8" stroke-width="1.4"/>' + (th >= 90 ? '<ellipse cx="' + (-R * 0.28).toFixed(1) + '" cy="' + (-hh * 0.62).toFixed(1) + '" rx="' + (R * 0.14).toFixed(1) + '" ry="' + (R * 0.07).toFixed(1) + '" fill="#fff" opacity=".6"/>' : '') + '</g></g>' +
      '<text x="8" y="16" font-size="11" fill="currentColor" opacity=".75">contact angle ' + th + '° · cloth tilted ' + Math.round(tl) + '°' + (sticks ? ' — the drop clings' : (ro != null && tl >= ro ? ' — rolling off' : '')) + '</text></svg>';
  }
  function animateTilt() {
    if (anim) { cancelAnimationFrame(anim); anim = null; }
    var t0 = null;
    function step(ts) { if (!t0) t0 = ts; tilt = Math.min(90, (ts - t0) / 3200 * 90); var box = $('dp-dropbox'); if (box && last) box.innerHTML = dropSvg(tilt); var sl = $('dp-tilt'); if (sl) sl.value = tilt; if (tilt < 90) anim = requestAnimationFrame(step); else anim = null; }
    anim = requestAnimationFrame(step);
  }

  function render() {
    var pane = $('pane-drape'); if (!pane) return;
    ensureCss();
    if (!S.enabled && !run && !last) { pane.innerHTML = '<p class="st-p">Switch on “Work out the drape and the water drop” in the Drape &amp; drop card (under Yarn) to see here: the cloth hung under gravity, the drape coefficient and folds, and what a drop of water does on it.</p>'; return; }
    var h = '';
    if (run && run.success === false) h += '<div class="ml-note warn">' + esc(run.error) + '</div>';
    else if (run) {
      h += '<div class="ml-h">' + (run.test === 'cusick' ? 'Cusick drape test' : 'Circular skirt') + '</div>' + notes(run.warnings);
      h += '<div class="dp-pair"><canvas class="dp-cv" id="dp-cv" aria-label="The hung cloth: drag to turn"></canvas><div><canvas class="dp-top" id="dp-top" aria-label="The shadow seen from above"></canvas><div class="ml-rm">From above: the shadow of the hung cloth (blue) inside the flat sample (dashed) and the clamped disc (grey).</div></div></div>';
      h += '<div class="ml-rm">Drag the picture to turn it. ' + esc(run.word || '') + '.</div>';
      if (run.test === 'cusick') h += kpis([['Drape coefficient', run.drape_coefficient.value + ' % (' + run.drape_coefficient.range[0] + '–' + run.drape_coefficient.range[1] + ')', 'estimate'], ['Folds (nodes)', run.folds.nodes, 'estimate'], ['Shadow', run.shadow.area_cm2 + ' cm²', 'law'], ['Sample', run.shadow.sample_cm2 + ' cm²', 'law'], ['Disc', run.shadow.disc_cm2 + ' cm²', 'law']]);
      else h += kpis([['Hem sweep', run.skirt.hem_sweep_ratio, 'estimate'], ['Hem radius', run.skirt.hem_radius_cm + ' cm of ' + run.skirt.hem_flat_radius_cm, 'estimate'], ['Hangs', run.skirt.hem_drop_cm + ' cm', 'estimate'], ['Waist', run.skirt.waist_cm + ' cm', null], ['Folds at the hem', run.folds.nodes, 'estimate']]);
      var f = run.from_hand;
      h += '<div class="ml-rm">Hung from the cloth\'s own numbers: ' + f.gsm + ' g/m², bending ' + f.bending_course + ' (courses) and ' + f.bending_wale + ' (wales) gf·cm²/cm, shear ' + f.shear + ' gf/(cm·deg), stretch ' + f.stretch_course_pct + ' % and ' + f.stretch_wale_pct + ' % at ' + f.load_gf_cm + ' gf/cm. Bending length ' + run.inputs.bending_length_cm + ' cm. ' + run.sample.particles + ' particles, ' + run.sample.steps + ' steps.</div>';
      h += '<div class="ml-rm">Law: ' + esc(run.basis.law.join('; ')) + '. Estimated: ' + esc(run.basis.estimated.join('; ')) + '. Replaced by: ' + esc(run.basis.replaced_by) + '.</div>';
    } else h += '<div class="ml-note">Press “Run the drape test” in the card to hang the cloth (about a second).</div>';
    if (last && last.success !== false) {
      h += '<div class="ml-h">The water drop</div>' + notes(last.warnings);
      h += '<div id="dp-dropbox">' + dropSvg(tilt) + '</div><div style="display:flex;gap:8px;align-items:center;margin:4px 0"><label for="dp-tilt" style="font-size:12px">Tilt the cloth</label><input type="range" id="dp-tilt" min="0" max="90" step="1" value="' + tilt + '" style="flex:1"><button type="button" class="st-btn" id="dp-roll">Tilt it</button></div>';
      h += kpis([['Contact angle', last.contact_angle.value + '°', 'estimate'], ['Stretched 20 %', last.contact_angle_stretched_20.value + '°', 'estimate'], ['Spray rating', last.spray_rating.value, 'estimate'], ['Rolls off at', last.roll_off.sticks || last.roll_off.value == null ? 'does not roll off' : last.roll_off.value + '° tilt', 'estimate'], ['Flat surface', last.flat_angle.value + '°', 'estimate']]);
      h += '<div class="ml-rm">' + esc(last.word) + '. ' + esc(last.contact_angle.regime) + '; solid share of the surface ' + last.contact_angle.solid_share + '. ' + esc(last.finish.label) + '.</div>';
      h += '<div class="ml-rm">Law: ' + esc(last.basis.law.join('; ')) + '. Estimated: ' + esc(last.basis.estimated.join('; ')) + '.</div>';
    }
    pane.innerHTML = h;
    drawCloth(); drawTop();
  }

  function doRun() {
    if (busy || !host) return;
    readCard(); busy = true; summary();
    var btn = $('dp-run'); if (btn) { btn.disabled = true; btn.textContent = 'Hanging…'; }
    host.fetch('/api/studio/drape', { method: 'POST', body: { design: host.design(), test: S.test } }).then(function (r) { run = r; }).catch(function (e) { run = { success: false, error: (e.data && e.data.error) || e.message || 'The drape could not be worked out.' }; })
      .then(function () { busy = false; var b2 = $('dp-run'); if (b2) { b2.disabled = false; b2.textContent = 'Run the drape test'; } summary(); render(); var tb = document.querySelector('.st-tabs [data-tab="drape"]'); if (tb && run && run.success !== false) tb.click(); });
  }

  function bind() {
    var el = $('dp-card'); if (el) {
      el.addEventListener('change', function (e) { readCard(); if (e.target.id === 'dp-on') buildCard(); if (e.target.id === 'dp-test') { run = null; render(); } });
      el.addEventListener('click', function (e) {
        if (e.target.id === 'dp-run') doRun();
        if (e.target.id === 'dp-open') { var tb = document.querySelector('.st-tabs [data-tab="drape"]'); if (tb) tb.click(); }
      });
    }
    var tabs = document.querySelector('.st-tabs');
    if (tabs) tabs.addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (b && b.getAttribute('data-tab') === 'drape') setTimeout(function () { drawCloth(); drawTop(); }, 30); });
    var pane = $('pane-drape'); if (pane) {
      pane.addEventListener('input', function (e) { if (e.target.id === 'dp-tilt') { tilt = +e.target.value; if (anim) { cancelAnimationFrame(anim); anim = null; } var b = $('dp-dropbox'); if (b && last) b.innerHTML = dropSvg(tilt); } });
      pane.addEventListener('click', function (e) { if (e.target.id === 'dp-roll') { tilt = 0; animateTilt(); } });
      var drag = null;
      pane.addEventListener('pointerdown', function (e) { if (e.target.id === 'dp-cv') { drag = { x: e.clientX, y: e.clientY, az: view.az, el: view.el }; e.target.setPointerCapture(e.pointerId); e.target.style.cursor = 'grabbing'; } });
      pane.addEventListener('pointermove', function (e) { if (!drag) return; view.az = drag.az + (e.clientX - drag.x) * 0.5; view.el = Math.max(5, Math.min(85, drag.el + (e.clientY - drag.y) * 0.4)); drawCloth(); });
      pane.addEventListener('pointerup', function (e) { if (drag && e.target.id === 'dp-cv') e.target.style.cursor = 'grab'; drag = null; });
    }
  }
  function payload() { readCard(); return S.enabled ? { enabled: true, dwr: S.dwr } : null; }
  function state() { readCard(); return JSON.parse(JSON.stringify(S)); }
  function setState(o) { S = Object.assign(blank(), o || {}); last = null; run = null; buildCard(); render(); }
  function setCatalogue(c) { CAT = c || null; buildCard(); }
  function studioResult(r) { last = r && r.repel ? r.repel : null; summary(); var b = $('dp-dropbox'); if (b && last) { render(); } else render(); }
  function setHost(h) { host = h; }

  window.KAStudioDrape = { payload: payload, state: state, setState: setState, setCatalogue: setCatalogue, studioResult: studioResult, setHost: setHost };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { buildCard(); bind(); render(); }); else { buildCard(); bind(); render(); }
})();
