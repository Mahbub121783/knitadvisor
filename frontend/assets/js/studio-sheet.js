/**
 * Fabric Studio — the development sheet: what an R&D person gives (composition, weight, colour depth, diameter, brushing, the drawn design) and the whole
 * development roll that comes back on one sheet (backend/engine/domain/dev-sheet.js, POST /api/studio/dev-sheet).
 * Needs window.KAStudioHost (set by studio.js: design(), fetch).
 */
(function () {
  'use strict';
  var busy = false;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function num(id) { var e = $(id); var v = e && e.value !== '' ? parseFloat(e.value) : NaN; return isFinite(v) ? v : null; }
  function note(t, bad) { var n = $('sh-note'); if (n) { n.textContent = t || ''; n.style.color = bad ? 'var(--danger, #b3261e)' : ''; } }
  function row(k, v, basis) { return '<tr><th>' + esc(k) + '</th><td>' + v + (basis ? ' <span class="st-hint" style="margin:0">' + esc(basis) + '</span>' : '') + '</td></tr>'; }
  function sec(title, rows, why) {
    return '<div class="st-card" style="margin-bottom:10px"><div class="st-step" style="margin-bottom:6px">' + esc(title) + '</div>' + (why ? '<div class="st-hint" style="margin:0 0 6px">' + esc(why) + '</div>' : '') +
      '<table class="st-tbl" style="width:100%;font-size:13px"><tbody>' + rows.join('') + '</tbody></table></div>';
  }
  function range(g, r, unit) { return esc(g) + (unit ? ' ' + unit : '') + (r ? ' <span class="st-hint" style="margin:0">(' + r[0] + '–' + r[1] + ')</span>' : ''); }

  function render(s) {
    var h = '';
    var badge = s.fabric.confidence === 'verified' || s.fabric.confidence === 'calibrated' ? 'ok' : 'estimate';
    h += '<div class="st-card" style="margin-bottom:10px"><div style="font-size:15px;font-weight:700">' + esc(s.fabric.title) + '</div><div class="st-hint" style="margin:2px 0 6px">' + esc(s.fabric.detail) + '</div>' +
      '<span class="st-badge ' + badge + '">' + esc(s.fabric.confidence) + '</span> <span class="st-badge ' + (s.verdict === 'fatal' ? 'bad' : 'estimate') + '">' + esc(s.verdict || 'not checked') + '</span>' +
      (s.export_locked ? ' <span class="st-badge bad">export locked</span>' : '') +
      '<div class="st-hint" style="margin:6px 0 0">' + esc(s.fabric.family) + (s.fabric.matches ? ' · same family as ' + esc(s.fabric.matches) : '') + '</div>' +
      '<div class="st-hint" style="margin:6px 0 0"><b>How the weight was found:</b> ' + esc(s.weight_basis.path) + ' — ' + esc(s.weight_basis.why) + (s.weight_basis.laws ? ' (laws ' + s.weight_basis.laws.sl_mm + ' mm, family table ' + s.weight_basis.laws.family_table_sl_mm + ' mm)' : '') + '</div>' +
      '<div class="st-hint" style="margin:4px 0 0"><b>Accuracy:</b> ' + esc(s.accuracy.weight) + '. ' + esc(s.accuracy.rule) + '</div></div>';
    var yr = s.yarn.feeds.map(function (f) { return row('Feed ' + f.feed + ' · ' + f.role, esc(f.yarn + ' ' + f.fibre) + ' — ' + f.ne + 's Ne, ' + f.tex + ' tex, SL ' + f.sl_mm + ' mm, ' + f.course_length_m + ' m per revolution'); });
    if (s.yarn.elastane) yr.push(row('Elastane', esc(s.yarn.elastane.denier + ' D at a draft of ' + s.yarn.elastane.draft) + ' — <b>' + esc(s.yarn.elastane.feeding) + '</b>'));
    if (s.yarn.composition_solved) yr.push(row('Composition', esc(Object.keys(s.yarn.composition_solved.achieved).map(function (k) { return s.yarn.composition_solved.achieved[k] + '% ' + k; }).join(' · ')), s.yarn.composition_solved.held));
    if (s.design) {
      var dz = s.design, ct = dz.counts || {};
      h += sec('0 · What your drawing decided', [row('Bed', esc(dz.bed === 'double' ? 'double bed (' + dz.gating + ' gating)' : 'single bed')), row('Repeat', esc(dz.repeat)), row('Yarn roles', esc((dz.roles || []).join(', '))),
        row('Stitches', 'knit ' + (ct.K || 0) + ' · tuck ' + (ct.T || 0) + ' · miss ' + (ct.M || 0) + (ct.E || ct.R ? ' · transfer ' + ((ct.E || 0) + (ct.R || 0)) : '') + ', longest float ' + (dz.longest_float || 0) + ' needles'), row('Family', esc(dz.family))].concat((dz.notes || []).map(function (n) { return '<tr><td colspan="2" class="st-hint">' + esc(n) + '</td></tr>'; })), 'The yarn, machine and finishing below follow from this drawing: change the drawing and the sheet follows.');
    }
    h += sec('1 · Yarn', yr);
    var m = s.machine, mr = [row('Machine', esc(m.type)), row('Gauge × diameter', m.gauge + ' GG × ' + m.dia + '" (' + m.needles + ' needles, ' + m.feeders + ' feeders)'),
      row('Stitch length', range(m.stitch_length_mm, m.stitch_length_range_mm, 'mm')), row('Speed', m.rpm + ' RPM at ' + m.efficiency_pct + '% → ' + m.kg_per_hour + ' kg/h')];
    if (m.vdq) m.vdq.groups.forEach(function (g) { mr.push(row('VDQ · feeds ' + g.feeds.join(', '), '<b>' + (g.pulley_reading != null ? 'pulley ' + g.pulley_reading + ' — ' : '') + '</b>course length ' + g.course_length_m + ' m/rev, yarn speed ' + g.yarn_speed_m_min + ' m/min')); });
    if (m.vdq) mr.push(row(m.vdq.pulley_method ? 'Pulley scale' : 'Pulley reading', '<span class="st-hint" style="margin:0">' + esc(m.vdq.note) + '</span>'));
    if (m.tracks && m.tracks.C) mr.push(row('Cam tracks', m.tracks.C.sequences.map(function (x) { return esc(x.track + ': ' + x.sequence); }).join(' · ')));
    if (m.sinker) mr.push(row('Sinker', esc(m.sinker)));
    h += sec('2 · Machine set-up', mr);
    if (s.greige) h += sec('3 · Greige (off the machine, relaxed)', [row('Weight', range(s.greige.gsm, s.greige.gsm_range, 'g/m²')), row('Width', s.greige.width_in + '"'), row('Density', s.greige.wales_per_cm + ' wales × ' + s.greige.courses_per_cm + ' courses per cm')]);
    if (s.dyeing) {
      var dr = s.dyeing.route.map(function (st) { return row(st.step + '. ' + st.name, (st.temp_c ? st.temp_c + ' °C' : '') + (st.time_min ? ', ' + st.time_min + ' min' : '') + (st.ph ? ', pH ' + st.ph : '') + (st.chemicals.length ? '<br><span class="st-hint" style="margin:0">' + esc(st.chemicals.map(function (c) { return c.name + (c.g_per_l != null ? ' ' + c.g_per_l + ' g/l' : ''); }).join(' · ')) + '</span>' : '')); });
      s.dyeing.dyes.forEach(function (d) { dr.push(row('Dye · ' + d.class, d.owf_pct + '% owf (' + d.kg_per_100kg + ' kg per 100 kg yarn), fixation ' + d.fixation_pct + '%')); });
      dr.push(row('Total / liquor', s.dyeing.total_time_h + ' h, liquor ' + s.dyeing.liquor_ratio + ':1'));
      h += sec('4 · Dyeing — ' + s.dyeing.shade, dr, s.dyeing.basis);
    }
    var f = s.finishing, fr = [];
    if (f.heat_set) fr.push(row('Heat-set', f.heat_set.temp_c + ' °C, ' + f.heat_set.time_s + ' s, ' + f.heat_set.when));
    fr.push(row('Stenter', 'width ' + f.stenter.set_width_in + '", ' + f.stenter.temp_c + ' °C, ' + f.stenter.speed_m_min + ' m/min' + (f.stenter.overfeed_pct != null ? ', overfeed ' + f.stenter.overfeed_pct + '%' : ''), 'typical (modelled)'));
    if (f.stenter.water_to_evaporate_g_m2) fr.push(row('Drying load', f.stenter.water_to_evaporate_g_m2 + ' g of water per m² to evaporate (pick-up ' + f.stenter.pickup_pct + '%)', 'physics'));
    if (f.compaction) fr.push(row('Compaction', (f.compaction.shorten_pct != null ? 'shorten by ' + f.compaction.shorten_pct + '% (buyer limit ' + f.compaction.limit_pct + '%) — ' : '') + esc(f.compaction.note || '')));
    if (f.brushing) fr.push(row('Brushing', esc(f.brushing.side) + ', ' + f.brushing.passes + ' passes → nap ' + f.brushing.nap_mm + ' mm, weight loss ' + f.brushing.weight_loss_pct + '%', 'modelled'));
    h += sec('5 · Finishing', fr, f.stenter.basis);
    if (f.sequence) h += sec('5b · Finishing order', f.sequence.map(function (x, i) { return row((i + 1) + '. ' + x.step, esc(x.params), x.basis); }));
    var fi = s.finished, er = [row('Weight', range(fi.gsm, fi.gsm_range, 'g/m²')), row('Width', fi.width_in + '"'), row('Density', fi.wales_per_cm + ' wales × ' + fi.courses_per_cm + ' courses per cm')];
    if (f.shrinkage_after_wash_pct) {
      var sw = f.shrinkage_after_wash_pct;
      er.push(row('Shrinkage after wash', 'length ' + sw.length + '%, width ' + sw.width + '%' + (sw.usual_route ? ' <span class="st-hint" style="margin:0">(usual route: ' + sw.usual_route.length + '% / ' + sw.usual_route.width + '%)</span>' : ''), 'modelled'));
      (sw.route_changes || []).forEach(function (c) { er.push('<tr><td colspan="2" class="st-hint">↳ ' + esc(c.text) + ' (' + (c.length_pts > 0 ? '+' : '') + c.length_pts + ' / ' + (c.width_pts > 0 ? '+' : '') + c.width_pts + ' pts)</td></tr>'); });
    }
    if (fi.spirality_helix_deg != null) er.push(row('Spirality (machine geometry)', fi.spirality_helix_deg + '°'));
    if (fi.thickness_mm) er.push(row('Thickness', fi.thickness_mm + ' mm', 'estimate'));
    h += sec('6 · Finished cloth', er);
    if (s.warnings.length) h += sec('Warnings', s.warnings.map(function (w) { return '<tr><td>' + (w.level === 'error' ? '❌ ' : '⚠ ') + esc(w.text) + '</td></tr>'; }));
    h += sec('First development roll', s.first_roll.map(function (t, i) { return '<tr><td>' + (i + 1) + '. ' + esc(t) + '</td></tr>'; }), s.accuracy.measured_vs_modelled);
    $('pane-sheet').innerHTML = h;
  }

  function vdqPoints() {
    var p = [];
    [['sh-v1r', 'sh-v1l'], ['sh-v2r', 'sh-v2l']].forEach(function (x) { var r = num(x[0]), l = num(x[1]); if (r > 0 && l > 0) p.push({ reading: r, course_length_m: l }); });
    return p;
  }
  var live = false, liveTimer = null, again = false;
  function make(quiet) {
    if (busy) { again = true; return; }
    var H = window.KAStudioHost;
    if (!H) { note('The sheet is not available here.', true); return; }
    var body = { design: H.design(), composition: $('sh-comp').value.trim(), gsm: num('sh-gsm'), shade: $('sh-shade').value, brush: $('sh-brush').value, dia: num('sh-dia'), width_in: num('sh-width'), shrinkage_pct: num('sh-shr'), vdq_points: vdqPoints() };
    busy = true; $('sh-go').disabled = true; note('Working out the development roll…'); var first = !live;
    H.fetch('/api/studio/dev-sheet', { method: 'POST', body: body }).then(function (r) {
      render(r); live = true; note('Live: the sheet follows your drawing (' + r.fabric.title + ').');
      if (first && quiet !== true) { var b = document.querySelector('.st-tabs [data-tab="sheet"]'); if (b) b.click(); }
    }).catch(function (e) { note((e && e.data && e.data.error) || (e && e.message) || 'The sheet could not be made.', true); })
      .then(function () { busy = false; $('sh-go').disabled = false; if (again) { again = false; make(true); } });
  }
  // the card's fields drive the same answer the rest of the Studio shows (the 3D view, the notation): they are written into the fields the engine already reads
  var MIRROR = { 'sh-comp': 'st-comp', 'sh-gsm': 'st-gsm', 'sh-dia': 'st-dia', 'sh-brush': 'st-brush', 'sh-width': 'st-width', 'sh-shr': 'st-shr' };
  function mirror(id) {
    var to = $(MIRROR[id]), from = $(id); if (!to || !from) return;
    if (from.type === 'text' && /^100% CO$/i.test(from.value.trim())) to.value = ''; else to.value = from.value;     // 100 % cotton is no composition target
    to.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function refreshSoon() { if (!live) return; clearTimeout(liveTimer); liveTimer = setTimeout(function () { make(true); }, 450); }
  function persist() { try { var o = {}; ['sh-v1r', 'sh-v1l', 'sh-v2r', 'sh-v2l'].forEach(function (i) { o[i] = $(i).value; }); localStorage.setItem('ka_vdq_ref', JSON.stringify(o)); } catch (_) { /* private window */ } }
  function restore() { try { var o = JSON.parse(localStorage.getItem('ka_vdq_ref') || 'null'); if (o) Object.keys(o).forEach(function (i) { if ($(i)) $(i).value = o[i]; }); } catch (_) { /* none */ } }
  function init() {
    var b = $('sh-go'); if (!b) return;
    b.addEventListener('click', function () { make(); });
    restore();
    Object.keys(MIRROR).forEach(function (id) { var e = $(id); if (e) e.addEventListener('change', function () { mirror(id); refreshSoon(); }); });
    ['sh-shade', 'sh-v1r', 'sh-v1l', 'sh-v2r', 'sh-v2l'].forEach(function (id) { var e = $(id); if (e) e.addEventListener('change', function () { persist(); refreshSoon(); }); });
    document.addEventListener('ka-studio-result', refreshSoon);           // the drawing changed: the sheet follows
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.KAStudioSheet = { make: make };
})();
