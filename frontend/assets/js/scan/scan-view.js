/**
 * KnitAdvisor — how a scan result is shown (phone and big screen alike).
 * Every number carries where it came from: measured on the photo,
 * calculated from a measurement with a factory constant, or estimated.
 */
(function (root) {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var SRC = { measured: ['m', 'measured'], calculated: ['c', 'calculated'], estimated: ['e', 'estimated'], 'factory practice': ['c', 'factory practice'] };
  function tag(s) { var t = SRC[s] || ['e', s || '']; return '<span class="sv-tag ' + t[0] + '">' + esc(t[1]) + '</span>'; }
  function f(v, d) { return v == null ? '—' : Number(v).toFixed(d == null ? 1 : d); }
  var FAULT = { needle_line: 'Needle line (a wale out of line)', barre: 'Barré (a course band)', hole_or_slub: 'Hole, slub or knot' };
  var NAMES = { single_jersey: 'Single jersey', pique: 'Piqué / lacoste', rib: '1×1 rib', interlock: 'Interlock', fleece: 'Fleece', terry: 'French terry' };

  /** @param r the API result; @param opts {big: boolean} */
  function render(r, opts) {
    opts = opts || {};
    var s = r.scan || {}, m = r.measured || {};
    var conf = s.confidence ? '<span class="sv-conf ' + esc(s.confidence) + '">' + esc(s.confidence) + ' confidence</span>' : '';
    var cells = [
      ['Wales / cm', f(m.wpc, 2), 'measured'], ['Courses / cm', m.cpc == null ? '—' : f(m.cpc, 2), 'measured'],
      ['Stitch length', f(r.stitch_length.mm, 2) + ' mm', r.stitch_length.source, f(r.stitch_length.range[0], 2) + '–' + f(r.stitch_length.range[1], 2)],
    ];
    if (r.count) cells.push(['Yarn count', f(r.count.ne, 1) + ' Ne', r.count.source, '≈ ' + r.count.nearest + 's · ' + f(r.count.range[0], 0) + '–' + f(r.count.range[1], 0)]);
    if (r.gsm) cells.push(['GSM', r.gsm.value, r.gsm.source, r.gsm.range ? r.gsm.range[0] + '–' + r.gsm.range[1] : '']);
    if (r.gauge) cells.push(['Machine gauge', r.gauge.value + ' GG', r.gauge.source, r.gauge.share_pct + '% of similar fabrics']);
    if (r.tightness) cells.push(['Tightness factor', f(r.tightness.tf, 1), r.tightness.source, r.tightness.verdict + ' (factory ' + r.tightness.window[0] + '–' + r.tightness.window[1] + ')']);
    var html = '<div class="sv ' + (opts.big ? 'big' : '') + '">' +
      '<div class="sv-head"><div><div class="sv-k">Structure</div><div class="sv-title">' + esc(NAMES[r.structure] || r.label) + '</div></div>' + conf +
      (s.colour ? '<div class="sv-col"><i style="background:' + esc(s.colour.hex) + '"></i><span>' + esc(s.colour.hex) + (s.colour.lab ? '<br>L* ' + f(s.colour.lab[0]) + ' a* ' + f(s.colour.lab[1]) + ' b* ' + f(s.colour.lab[2]) : '') + '</span></div>' : '') + '</div>' +
      '<div class="sv-grid">' + cells.map(function (c) {
        return '<div class="sv-cell"><div class="sv-k">' + esc(c[0]) + ' ' + tag(c[2]) + '</div><div class="sv-v">' + esc(c[1]) + '</div>' + (c[3] ? '<div class="sv-d">' + esc(c[3]) + '</div>' : '') + '</div>';
      }).join('') + '</div>';
    if (r.finish) html += '<p class="sv-p"><b>Finish:</b> ' + esc(r.finish.verdict) + ' (' + (r.finish.compaction_pct > 0 ? '+' : '') + esc(r.finish.compaction_pct) + '% courses against factory cloth)' + (r.finish.note ? ' — ' + esc(r.finish.note) : '') + '</p>';
    if (s.skew_deg != null && Math.abs(s.skew_deg) >= 1.5) html += '<p class="sv-p"><b>Spirality:</b> courses lean ' + f(Math.abs(s.skew_deg), 1) + '° — check twist liveliness and compacting.</p>';
    var faults = s.faults || [];
    html += '<p class="sv-p"><b>Faults seen:</b> ' + (faults.length ? faults.map(function (x) { return esc(FAULT[x.type] || x.type) + (x.x_mm != null ? ' at ' + f(x.x_mm, 0) + (x.y_mm != null ? ', ' + f(x.y_mm, 0) : '') + ' mm' : x.y_mm != null ? ' at ' + f(x.y_mm, 0) + ' mm' : ''); }).join('; ') : 'none in the scanned area') + '</p>';
    (r.notes || []).forEach(function (n) { html += '<p class="sv-note">' + esc(n) + '</p>'; });
    if (opts.basis !== false) html += '<details class="sv-basis"><summary>Where each number comes from</summary><ul>' +
      '<li>Stitch length: ' + esc(r.stitch_length.basis) + '</li>' + (r.count ? '<li>Count: ' + esc(r.count.basis) + '</li>' : '') +
      (r.gauge ? '<li>Gauge: ' + esc(r.gauge.basis) + '</li>' : '') + '<li>Fibre: ' + esc(r.fibre.basis) + '</li>' +
      '<li>Wales and courses: counted on the photo from the repeat of the loops (no AI), scaled by the card.</li></ul></details>';
    return html + '</div>';
  }
  var CSS = '.sv-tag{font:700 9.5px/1 var(--head,system-ui);text-transform:uppercase;letter-spacing:.04em;padding:2px 5px;border-radius:4px;vertical-align:1px}' +
    '.sv-tag.m{background:#E6F4EC;color:#1E7A54}.sv-tag.c{background:#E8F0FD;color:#1857C4}.sv-tag.e{background:#FDF1DE;color:#9A5B00}' +
    '.sv-head{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:12px}.sv-title{font-size:20px;font-weight:800}.big .sv-title{font-size:30px}' +
    '.sv-k{font-size:11.5px;color:var(--t3,#6F7680);font-weight:600;text-transform:uppercase;letter-spacing:.03em}' +
    '.sv-conf{font:700 11px var(--head,system-ui);padding:4px 8px;border-radius:999px;background:#F1F3F5;color:#565C64}.sv-conf.high{background:#E6F4EC;color:#1E7A54}.sv-conf.low{background:#FBE9E9;color:#B23B3B}' +
    '.sv-col{display:flex;gap:8px;align-items:center;font:12px var(--mono,monospace);color:#565C64}.sv-col i{width:34px;height:34px;border-radius:8px;border:1px solid #D2D5DA;display:inline-block}' +
    '.sv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}.big .sv-grid{grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}' +
    '.sv-cell{border:1px solid var(--line,#E4E6E9);border-radius:10px;padding:10px 12px;background:var(--bg,#fff)}' +
    '.sv-v{font:700 22px/1.2 var(--mono,monospace);margin-top:4px}.big .sv-v{font-size:34px}.sv-d{font-size:11.5px;color:var(--t3,#6F7680);margin-top:2px}' +
    '.sv-p{font-size:13px;margin:10px 0 0;line-height:1.5}.big .sv-p{font-size:15px}.sv-note{font-size:12px;color:#9A5B00;background:#FDF1DE;border-radius:8px;padding:8px 10px;margin:8px 0 0}' +
    '.sv-basis{margin-top:10px;font-size:12px;color:var(--t2,#565C64)}.sv-basis summary{cursor:pointer;font-weight:600}';
  root.KAScanView = { render: render, CSS: CSS, NAMES: NAMES, esc: esc };
})(typeof self !== 'undefined' ? self : this);
