/**
 * Fabric Studio — load a cam sheet from the floor (backend/engine/domain/cam-sheet.js, POST /api/studio/cam-sheet).
 * The sheet's tracks, needle setting and feeder colours become the Studio's drawing; everything else then follows the drawing.
 * Needs window.KAStudioHost (studio.js: fetch, load).
 */
(function () {
  'use strict';
  var cat = null, busy = false;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function out(html, bad) { var o = $('cs-out'); if (o) { o.innerHTML = html || ''; o.style.color = bad ? 'var(--danger, #b3261e)' : ''; } }

  function fill(spec) {
    $('cs-tracks').value = (spec.tracks || []).join('\n');
    $('cs-needles').value = spec.needles || '';
    $('cs-colours').value = spec.colours || '';
    $('cs-legend').value = spec.legend || 'letters';
    $('cs-dtracks').value = (spec.dial_tracks || []).join('\n');
    $('cs-dneedles').value = spec.dial_needles || '';
  }
  function body() {
    var b = { tracks: $('cs-tracks').value, needles: $('cs-needles').value, legend: $('cs-legend').value, colours: $('cs-colours').value.trim() || undefined };
    if ($('cs-dtracks').value.trim()) { b.dial_tracks = $('cs-dtracks').value; b.dial_needles = $('cs-dneedles').value; b.gating = $('cs-gating').value; }
    var ex = cat && cat.examples.filter(function (e) { return e.id === $('cs-example').value; })[0];
    if (ex && ex.spec.name) b.name = ex.spec.name;
    return b;
  }

  function build() {
    if (busy) return;
    var H = window.KAStudioHost; if (!H || !H.load) { out('The Studio is not ready.', true); return; }
    busy = true; $('cs-go').disabled = true; out('Reading the sheet…');
    H.fetch('/api/studio/cam-sheet', { method: 'POST', body: body() }).then(function (r) {
      var fields = {};
      if (r.colours) Object.keys(r.colours.hex).forEach(function (k) { fields['st-sc-' + k] = r.colours.hex[k]; });
      fields['st-colby'] = 'feed'; fields['st-stripe'] = '';
      H.load({ bed: r.bed === 'double' ? r.gating : 'single', C: r.C, D: r.D, feeds: r.feeds, name: r.read.name || 'Cam sheet', fields: fields });
      out('<b>Built:</b> ' + r.read.feeders + ' feeders × ' + r.read.needles + ' needles' + (r.D ? ' on two beds' : '') + (r.colours ? ', ' + Object.keys(r.colours.letters).map(function (k) { return k + ' = ' + esc(r.colours.letters[k]); }).join(', ') : '') +
        '. The drawing below is now this sheet.<pre style="margin:6px 0 0;font:11px/1.35 var(--mono,monospace);white-space:pre;overflow:auto;max-height:160px">' + esc(r.preview.join('\n')) + '</pre>' +
        (r.notes.length ? '<div style="color:#9A5B00;margin-top:4px">' + r.notes.map(esc).join('<br>') + '</div>' : ''));
    }).catch(function (e) { out(esc((e && e.data && e.data.error) || (e && e.message) || 'The sheet could not be read.'), true); })
      .then(function () { busy = false; $('cs-go').disabled = false; });
  }

  function find() {
    var H = window.KAStudioHost; if (!H || busy) return;
    var b = { tracks: $('cs-tracks').value, legend: $('cs-legend').value, gsm: 200 }, n = parseInt($('cs-len').value, 10);
    if (n >= 2) { b.min_length = n; b.max_length = n; }
    $('cs-found').textContent = 'Searching…'; $('cs-find').disabled = true;
    H.fetch('/api/studio/cam-sheet/needles', { method: 'POST', body: b }).then(function (r) {
      var el = $('cs-found');
      el.innerHTML = '<div>' + r.considered + ' settings knit; the best ' + r.suggestions.length + ' (each is rebuilt and knits as drawn). ' + esc(r.basis) + '</div>' +
        r.suggestions.map(function (x, i) {
          return '<div style="border:1px solid var(--line);border-radius:8px;padding:6px 8px;margin-top:6px"><div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap"><b style="font-family:var(--mono,monospace)">' + esc(x.needles) + '</b><span>' + x.length + ' needles · knit ' + x.knit_pct + '%' + (x.tuck_pct ? ' · tuck ' + x.tuck_pct + '%' : '') + ' · float ' + x.longest_float + '</span><button type="button" class="st-btn cs-use" data-i="' + i + '" style="margin-left:auto;padding:2px 10px">Use this</button></div></div>';
        }).join('');
      el.querySelectorAll('.cs-use').forEach(function (btn) { btn.addEventListener('click', function () { $('cs-needles').value = r.suggestions[+btn.getAttribute('data-i')].needles; build(); }); });
    }).catch(function (e) { $('cs-found').innerHTML = '<span style="color:var(--danger,#b3261e)">' + esc((e && e.data && e.data.error) || (e && e.message) || 'The search failed.') + '</span>'; })
      .then(function () { $('cs-find').disabled = false; });
  }

  function init() {
    var card = $('cs-card'); if (!card) return;
    $('cs-go').addEventListener('click', build);
    $('cs-find').addEventListener('click', find);
    var H = window.KAStudioHost;
    (H ? H.fetch('/api/studio/cam-sheet/catalogue') : Promise.reject()).then(function (c) {
      cat = c;
      $('cs-legend').innerHTML = c.legends.map(function (l) { return '<option value="' + esc(l.id) + '">' + esc(l.label) + '</option>'; }).join('');
      $('cs-example').innerHTML += c.examples.map(function (e) { return '<option value="' + esc(e.id) + '">' + esc(e.label) + '</option>'; }).join('');
      $('cs-example').addEventListener('change', function () {
        var ex = c.examples.filter(function (e) { return e.id === this.value; }.bind(this))[0];
        if (ex) fill(ex.spec);
      });
    }).catch(function () { /* the card still works without the examples */ });
  }
  // the Studio's host object is set by studio.js, which loads after this file: wait for the page
  if (document.readyState === 'complete') setTimeout(init, 300); else window.addEventListener('load', function () { setTimeout(init, 300); });
})();
