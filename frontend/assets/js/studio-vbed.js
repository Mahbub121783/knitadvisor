/**
 * Fabric Studio — the flat V-bed card and its results tab.
 *
 * Chosen from "What are you making?" (Flat V-bed): the design is knitted on a flat machine — two needle beds, a carriage, loop transfer and
 * racking — instead of a circular one. The card sets the machine (gauge, bed width, carriage speed, systems, efficiency, racking); the tab shows
 * what the compiler makes of the programme (backend/engine/domain/vbed-compiler.js): the yarn against the needle, the transfers and the racking
 * against what the yarn gives, the width of a panel, the production, and the carriage programme pass by pass.
 *
 * Plain script, no dependencies. window.KAStudioVbed: payload(), state(), setState(), setActive(bool), setCatalogue(c), studioResult(r), setGauge(n)
 */
(function () {
  'use strict';
  var CAT = null, S = blank(), active = false, last = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function blank() { return { gauge: '', width: '', speed: '', systems: '2', eff: '', rack: '0' }; }
  function ensureCss() {
    if (!$('ml-css') && window.KAStudioMelange && window.KAStudioMelange.css) { var m = document.createElement('style'); m.id = 'ml-css'; m.textContent = window.KAStudioMelange.css; document.head.appendChild(m); }
    if (!$('bl-css') && window.KAStudioBlend && window.KAStudioBlend.css) { var b = document.createElement('style'); b.id = 'bl-css'; b.textContent = window.KAStudioBlend.css; document.head.appendChild(b); }
  }

  function buildCard() {
    var host = $('vb-card'); if (!host) return;
    ensureCss();
    host.hidden = !active;
    var d = (CAT && CAT.defaults) || { width_in: 52, speed_m_s: 1.2, efficiency_pct: 65 };
    host.innerHTML = '<div class="st-step"><b>4</b> Flat V-bed machine</div>' +
      '<p class="st-hint" style="margin-top:0">Two needle beds in a V, a carriage that knits one course per system per pass, loop transfer and racking. The loops, weight and width are the Studio\'s; the machine around them is set here. The circular machine card does not apply.</p>' +
      '<div class="st-row"><div class="st-f"><label for="vb-gauge">Gauge (GG, 5-18)</label><input id="vb-gauge" type="number" min="5" max="18" step="1" placeholder="auto" value="' + esc(S.gauge) + '"></div>' +
      '<div class="st-f"><label for="vb-width">Bed width (in)</label><input id="vb-width" type="number" min="20" max="90" step="1" placeholder="' + d.width_in + '" value="' + esc(S.width) + '"></div></div>' +
      '<div class="st-row"><div class="st-f"><label for="vb-speed">Carriage speed (m/s)</label><input id="vb-speed" type="number" min="0.4" max="1.6" step="0.1" placeholder="' + d.speed_m_s + '" value="' + esc(S.speed) + '"></div>' +
      '<div class="st-f"><label for="vb-sys">Knitting systems</label><select id="vb-sys">' + [1, 2, 3, 4].map(function (n) { return '<option value="' + n + '"' + (String(n) === String(S.systems) ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="st-row"><div class="st-f"><label for="vb-eff">Efficiency (%)</label><input id="vb-eff" type="number" min="20" max="95" step="1" placeholder="' + d.efficiency_pct + '" value="' + esc(S.eff) + '"></div>' +
      '<div class="st-f"><label for="vb-rack">Racking (needles, ±6)</label><input id="vb-rack" type="number" min="-6" max="6" step="1" value="' + esc(S.rack) + '"></div></div>' +
      '<div class="ml-sum" id="vb-sum"></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button type="button" class="st-btn" id="vb-open">Open the V-bed compile</button></div>';
    summary();
  }
  function readCard() {
    if (!$('vb-gauge')) return;
    S.gauge = $('vb-gauge').value; S.width = $('vb-width').value; S.speed = $('vb-speed').value; S.systems = $('vb-sys').value; S.eff = $('vb-eff').value; S.rack = $('vb-rack').value;
  }
  function summary() {
    var el = $('vb-sum'); if (!el) return;
    if (!last) { el.textContent = active ? 'Worked out with the Studio\'s next answer.' : ''; return; }
    if (last.success === false) { el.textContent = last.error; return; }
    el.innerHTML = '<b>' + last.machine.gauge + ' GG</b>, ' + last.machine.needles_per_bed + ' needles a bed · <b>' + (last.production.kg_per_hour ? last.production.kg_per_hour.value : '—') + ' kg/h</b> · ' + (last.ok_to_knit ? 'knits as drawn' : '<b>does not knit as set</b>');
  }

  function tag(t) { return t ? '<span class="ml-b ml-b-' + esc(t) + '">' + esc(t) + '</span>' : ''; }
  function kpis(list) { return '<div class="bl-kpis">' + list.map(function (k) { return '<div class="bl-kpi"><b>' + esc(k[1]) + '</b><span>' + esc(k[0]) + (k[2] ? tag(k[2]) : '') + '</span></div>'; }).join('') + '</div>'; }
  function table(head, rows) { return '<div class="bl-scroll"><table class="ml-tbl"><tr>' + head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr>' + rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table></div>'; }

  function render() {
    var pane = $('pane-vbed'); if (!pane) return;
    ensureCss();
    if (!active) { pane.innerHTML = '<p class="st-p">Choose “Flat V-bed” under “What are you making?” to see here what a flat machine makes of the programme: the yarn against the needle, transfers and racking, the width of a panel, the production and the carriage programme.</p>'; return; }
    if (!last) { pane.innerHTML = '<p class="st-p">Worked out with the Studio\'s next answer.</p>'; return; }
    if (last.success === false) { pane.innerHTML = '<div class="ml-note warn">' + esc(last.error) + '</div>'; return; }
    var r = last, m = r.machine, e = r.envelope, p = r.production, h = '';
    h += '<div class="ml-note' + (r.ok_to_knit ? '' : ' warn') + '"><b>' + (r.ok_to_knit ? 'This programme knits on a ' + m.gauge + ' GG flat V-bed.' : 'This programme does not knit on a ' + m.gauge + ' GG flat V-bed as set.') + '</b></div>';
    r.checks.forEach(function (c) { if (c.level !== 'ok') h += '<div class="ml-note' + (c.level === 'warn' || c.level === 'error' ? ' warn' : '') + '">' + (c.level === 'error' ? '✕ ' : c.level === 'warn' ? '⚠ ' : '') + esc(c.text) + '</div>'; });
    h += '<div class="ml-h">The machine</div>' + kpis([['Gauge', m.gauge + ' GG', null], ['Needle pitch', m.needle_pitch_mm + ' mm', 'law'], ['Needles a bed', m.needles_per_bed, 'law'], ['Systems', m.systems, null], ['Carriage speed', m.carriage_speed_m_s + ' m/s', null]]) +
      '<div class="ml-rm">Gauge from ' + esc(m.gauge_source) + (m.gauge_recommended !== m.gauge ? ' (the finest this yarn fits would be ' + m.gauge_recommended + ' GG)' : '') + '.</div>';
    h += '<div class="ml-h">The yarn against the needle</div>' + kpis([['Thickest knitting yarn', e.yarn_tex.value + ' tex (feed ' + e.yarn_tex.feed + (e.yarn_tex.plated ? ', plated' : '') + ')', 'law'], ['Envelope', e.limit_tex.value + ' tex', 'typical'], ['Fits', e.fits ? 'yes' : 'no', null], ['Elongation at break', e.elongation_pct ? e.elongation_pct.value + ' %' : '—', 'blend']]) +
      '<div class="ml-rm">Envelope ' + esc(e.limit_tex.formula) + '. Transfers: ' + r.transfers.to_other_bed + ' to the other bed, ' + r.transfers.to_next_needle + ' to the next needle per repeat; racking ' + r.transfers.racking + '.</div>';
    h += '<div class="ml-h">Width and production</div>' + kpis([['Wales across the bed', r.panel.wales, 'law'], ['Finished panel width', r.panel.finished_width_in ? r.panel.finished_width_in.value + ' in' : '—', 'estimate'], ['Courses an hour', p.courses_per_hour.value, 'estimate'], ['Production', p.kg_per_hour.value + ' kg/h', 'estimate'], ['One pass', p.pass_seconds + ' s', 'law']]) +
      '<div class="ml-rm">' + esc(p.formula) + '. ' + esc(r.panel.note) + '</div>';
    h += '<div class="ml-h">The carriage programme</div>' + table(['Pass', 'Direction', 'Carrier', 'Role', 'Stitch mm (× pitch)', 'Front bed', 'Back bed', 'Transfers'], r.program.map(function (x) { return [x.pass, x.direction, x.carrier, x.role, (x.stitch_mm == null ? '—' : x.stitch_mm) + (x.stitch_ratio ? ' (' + x.stitch_ratio + ')' : ''), x.front, x.back == null ? '—' : x.back, x.transfers]; })) +
      '<div class="ml-rm">One pass per feed, the carriage alternating direction. K knit, T tuck, M miss, E transfer to the next needle, R transfer to the other bed, – no needle.</div>';
    h += '<div class="ml-h">What rests on what</div><div class="ml-note">Law: ' + esc(r.basis.law.join('; ')) + '.<br>Typical: ' + esc(r.basis.typical.join('; ')) + '.<br>Replaced by: ' + esc(r.basis.replaced_by) + '.</div>';
    pane.innerHTML = h;
  }

  function bind() {
    var host = $('vb-card'); if (host) {
      host.addEventListener('change', readCard);
      host.addEventListener('input', function (e) { if (e.target.type === 'number') readCard(); });
      host.addEventListener('click', function (e) { if (e.target.id === 'vb-open') { var tb = document.querySelector('.st-tabs [data-tab="vbed"]'); if (tb) tb.click(); } });
    }
  }
  function num(v) { var n = parseFloat(v); return n > 0 ? n : undefined; }
  function payload() {
    if (!active) return null; readCard();
    return { enabled: true, gauge: num(S.gauge), width_in: num(S.width), speed_m_s: num(S.speed), systems: parseInt(S.systems, 10) || 2, efficiency: num(S.eff), rack: parseInt(S.rack, 10) || 0 };
  }
  function state() { readCard(); return JSON.parse(JSON.stringify(S)); }
  function setState(o) { S = Object.assign(blank(), o || {}); last = null; buildCard(); render(); }
  function setActive(on) {
    active = !!on;
    var tab = document.querySelector('.st-tabs [data-tab="vbed"]'); if (tab) tab.hidden = !active;
    var mp = $('st-mprof'); var mc = mp && mp.closest('.st-card'); if (mc) mc.hidden = active;
    if (!active) { last = null; var cur = document.querySelector('.st-tabs .on'); if (cur && cur.getAttribute('data-tab') === 'vbed') { var t3 = document.querySelector('.st-tabs [data-tab="3d"]'); if (t3) t3.click(); } }
    buildCard(); render();
  }
  function setCatalogue(c) { CAT = c || null; buildCard(); }
  function setGauge(n) { S.gauge = String(n); buildCard(); }
  function studioResult(r) { last = active && r && r.vbed ? r.vbed : null; summary(); render(); }

  window.KAStudioVbed = { payload: payload, state: state, setState: setState, setActive: setActive, setCatalogue: setCatalogue, studioResult: studioResult, setGauge: setGauge };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { buildCard(); bind(); render(); }); else { buildCard(); bind(); render(); }
})();
