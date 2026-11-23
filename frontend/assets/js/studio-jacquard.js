/**
 * Fabric Studio — paint a colour motif and knit it (backend/engine/domain/jacquard-builder.js, POST /api/studio/jacquard).
 * Every pixel is a needle in one colour; a pixel row of n colours becomes n feeds. The result is loaded as the drawing, with a colour on every feeder.
 * The six colours are the Studio's own yarn colours (the pickers in the Colours card). Needs window.KAStudioHost (studio.js).
 */
(function () {
  'use strict';
  var LET = ['A', 'B', 'C', 'D', 'E', 'F'], cat = null, busy = false, cur = 'B', down = false, rows = [], W = 12, Hh = 12;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function hex(l) { var e = $('st-sc-' + l); return e && /^#[0-9a-f]{6}$/i.test(e.value) ? e.value : '#808080'; }
  function out(html, bad) { var o = $('jq-out'); if (o) { o.innerHTML = html || ''; o.style.color = bad ? 'var(--danger, #b3261e)' : ''; } }

  function blank(w, h) { var r = []; for (var y = 0; y < h; y++) r.push(new Array(w + 1).join('A')); return r; }
  function resize() {
    var w = Math.max(2, Math.min(96, parseInt($('jq-w').value, 10) || W)), h = Math.max(2, Math.min(192, parseInt($('jq-h').value, 10) || Hh));
    var next = [];
    for (var y = 0; y < h; y++) { var src = rows[y] || '', line = ''; for (var x = 0; x < w; x++) line += src[x] || 'A'; next.push(line); }
    rows = next; W = w; Hh = h; $('jq-w').value = w; $('jq-h').value = h; drawGrid();
  }
  function palette() {
    var p = $('jq-pal'); if (!p) return;
    p.innerHTML = LET.map(function (l) {
      return '<button type="button" class="st-btn jq-pick' + (l === cur ? ' on' : '') + '" data-l="' + l + '" title="Paint with colour ' + l + '" style="display:inline-flex;align-items:center;gap:5px;padding:2px 8px;margin:0 4px 4px 0' + (l === cur ? ';outline:2px solid var(--accent, #1857C4)' : '') + '"><i style="display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid var(--line);background:' + hex(l) + '"></i>' + l + '</button>';
    }).join('');
  }
  function drawGrid() {
    var g = $('jq-grid'); if (!g) return;
    var cs = W > 32 ? 12 : W > 20 ? 16 : 20;
    var h = '<table style="border-collapse:collapse;user-select:none;touch-action:none" id="jq-tab">';
    rows.forEach(function (r, y) {
      h += '<tr>';
      for (var x = 0; x < W; x++) h += '<td data-x="' + x + '" data-y="' + y + '" style="width:' + cs + 'px;height:' + cs + 'px;padding:0;border:1px solid rgba(128,128,128,.35);background:' + hex(r[x]) + ';cursor:crosshair"></td>';
      h += '</tr>';
    });
    g.innerHTML = h + '</table>';
  }
  function paint(td) {
    if (!td || td.tagName !== 'TD') return;
    var x = +td.getAttribute('data-x'), y = +td.getAttribute('data-y');
    if (rows[y][x] === cur) return;
    rows[y] = rows[y].slice(0, x) + cur + rows[y].slice(x + 1);
    td.style.background = hex(cur);
  }
  function repaintColours() { drawGrid(); palette(); }

  function build() {
    if (busy) return;
    var H = window.KAStudioHost; if (!H || !H.load) { out('The Studio is not ready.', true); return; }
    busy = true; $('jq-go').disabled = true; out('Building the programme…');
    var bedv = $('jq-bed').value;
    var body = { motif: rows, bed: bedv, back: $('jq-back').value, max_float: +$('jq-float').value || 4, ground_colour: 'A', tie_floats: !!($('jq-tie') && $('jq-tie').checked), name: 'Jacquard ' + W + '×' + Hh };
    H.fetch('/api/studio/jacquard', { method: 'POST', body: body }).then(function (r) {
      var fields = { 'st-colby': 'feed', 'st-stripe': '' };
      H.load({ bed: r.bed === 'double' ? r.gating : 'single', C: r.C, D: r.D, feeds: r.feeds, name: r.name, fields: fields, colourway: window.KAStudioColourway ? window.KAStudioColourway.state() : null });
      out('<b>Built:</b> ' + r.motif.height + ' pixel rows × ' + r.motif.width + ' needles → ' + r.feeds_total + ' feeds' + (r.D ? ' on two beds' : '') + ', ' + r.colours.length + ' colours (' + r.colours.join(' ') + '), longest float ' + r.longest_float + ' needle' + (r.longest_float === 1 ? '' : 's') + '. The drawing below is now this motif; the Colours tab shows the yarn plan.' +
        r.checks.map(function (c) { return '<div style="color:' + (c.level === 'warn' ? '#9A5B00' : 'inherit') + ';margin-top:3px">' + esc(c.text) + '</div>'; }).join('') +
        r.notes.map(function (n) { return '<div style="margin-top:3px">' + esc(n) + '</div>'; }).join(''));
    }).catch(function (e) { out(esc((e && e.data && e.data.error) || (e && e.message) || 'The motif could not be built.'), true); })
      .then(function () { busy = false; $('jq-go').disabled = false; });
  }

  // ── a picture instead of a painted motif ──
  function imgOut(html, bad) { var o = $('jq-imgout'); if (o) { o.innerHTML = html || ''; o.style.color = bad ? 'var(--danger, #b3261e)' : ''; } }
  // the picture as a small grid of RGB (transparent areas laid on white): the engine does the rest
  function readPicture(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        try {
          var s = Math.min(1, 160 / Math.max(im.naturalWidth, im.naturalHeight)), w = Math.max(4, Math.round(im.naturalWidth * s)), h = Math.max(4, Math.round(im.naturalHeight * s));
          var c = document.createElement('canvas'); c.width = w; c.height = h;
          var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(im, 0, 0, w, h);
          var d = x.getImageData(0, 0, w, h).data, rgb = new Uint8Array(w * h * 3);
          for (var i = 0, j = 0; i < d.length; i += 4) { rgb[j++] = d[i]; rgb[j++] = d[i + 1]; rgb[j++] = d[i + 2]; }
          var bin = '', CH = 8192; for (var k = 0; k < rgb.length; k += CH) bin += String.fromCharCode.apply(null, rgb.subarray(k, k + CH));
          URL.revokeObjectURL(url); resolve({ width: w, height: h, rgb: btoa(bin), src: url });
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That file is not a picture the browser can read (use PNG, JPG, GIF, WebP or SVG).')); };
      im.src = url;
    });
  }
  var lastPic = null;
  function fromPicture(file) {
    var H = window.KAStudioHost; if (!H || busy || (!file && !lastPic)) return;
    imgOut(file ? 'Reading the picture…' : 'Making the motif again…');
    (file ? readPicture(file) : Promise.resolve(lastPic)).then(function (pic) {
      lastPic = pic;
      var den = H.density && H.density(), bedv = $('jq-bed').value;
      var body = { width: pic.width, height: pic.height, rgb: pic.rgb, needles: +$('jq-imgw').value || 24, bed: bedv, back: $('jq-back').value, colours: $('jq-imgk').value, max_colours: +$('jq-imgmax').value || 4, max_float: +$('jq-float').value || 4, tie_floats: !!$('jq-tie').checked };
      if (den) { body.wpc = den.wpc; body.cpc = den.cpc; }
      return H.fetch('/api/studio/jacquard/from-image', { method: 'POST', body: body });
    }).then(function (r) {
      rows = r.motif.slice(); W = r.width; Hh = r.height; $('jq-w').value = W; $('jq-h').value = Hh;
      if (window.KAStudioColourway) window.KAStudioColourway.setColours(r.palette);
      repaintColours();
      imgOut('<b>' + r.width + ' needles × ' + r.height + ' rows</b>' + (r.size ? ' = ' + r.size.width_cm + ' × ' + r.size.height_cm + ' cm on the cloth' : '') + ' · ' + r.palette.length + ' yarn colours: ' +
        r.palette.map(function (p) { return '<span style="display:inline-block;width:12px;height:12px;border-radius:3px;border:1px solid var(--line);background:' + p.hex + ';vertical-align:-2px"></span> ' + p.letter + ' ' + p.share_pct + ' %' + (p.pantone ? ' (' + esc(p.pantone.name) + ')' : ''); }).join(' · ') +
        r.checks.map(function (c) { return '<div style="color:' + (c.level === 'warn' ? '#9A5B00' : 'inherit') + ';margin-top:3px">' + esc(c.text) + '</div>'; }).join('') + r.notes.map(function (n) { return '<div style="margin-top:3px">' + esc(n) + '</div>'; }).join(''));
      build();
    }).catch(function (e) { imgOut(esc((e && e.data && e.data.error) || (e && e.message) || 'The picture could not be used.'), true); });
  }

  function loadPreset(id) {
    var p = cat && cat.presets.filter(function (x) { return x.id === id; })[0]; if (!p) return;
    rows = p.rows.slice(); W = rows[0].length; Hh = rows.length; $('jq-w').value = W; $('jq-h').value = Hh; drawGrid();
  }

  function init() {
    var card = $('jq-card'); if (!card) return;
    var H = window.KAStudioHost; if (!H) return;
    rows = blank(W, Hh); $('jq-w').value = W; $('jq-h').value = Hh;
    palette(); drawGrid();
    $('jq-pal').addEventListener('click', function (e) { var b = e.target.closest('.jq-pick'); if (b) { cur = b.getAttribute('data-l'); palette(); } });
    var g = $('jq-grid');
    g.addEventListener('pointerdown', function (e) { down = true; paint(e.target); });
    g.addEventListener('pointerover', function (e) { if (down) paint(e.target); });
    window.addEventListener('pointerup', function () { down = false; });
    $('jq-w').addEventListener('change', resize); $('jq-h').addEventListener('change', resize);
    $('jq-clear').addEventListener('click', function () { rows = blank(W, Hh); drawGrid(); });
    $('jq-go').addEventListener('click', build);
    if ($('jq-img')) $('jq-img').addEventListener('change', function () { if (this.files && this.files[0]) fromPicture(this.files[0]); });
    // the picture is kept: a different width, colour count, bed or back makes the motif again from it
    ['jq-imgw', 'jq-imgk', 'jq-imgmax', 'jq-bed', 'jq-back', 'jq-tie', 'jq-float'].forEach(function (id) { var e = $(id); if (e) e.addEventListener('change', function () { if (lastPic) fromPicture(null); }); });
    $('jq-bed').addEventListener('change', function () { $('jq-backrow').hidden = this.value === 'single'; });
    $('jq-backrow').hidden = $('jq-bed').value === 'single';
    // the colours are the Studio's pickers: repaint when one changes
    var sw = $('st-swatches'); if (sw) sw.addEventListener('input', repaintColours);
    H.fetch('/api/studio/jacquard/catalogue').then(function (c) {
      cat = c;
      $('jq-preset').innerHTML = '<option value="">a blank motif</option>' + c.presets.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.label) + '</option>'; }).join('');
      $('jq-back').innerHTML = c.backs.map(function (b) { return '<option value="' + esc(b.id) + '">' + esc(b.label) + '</option>'; }).join('');
      $('jq-preset').addEventListener('change', function () { if (this.value) loadPreset(this.value); else { rows = blank(W, Hh); drawGrid(); } });
    }).catch(function () { /* the painter still works without the presets */ });
  }
  if (document.readyState === 'complete') setTimeout(init, 350); else window.addEventListener('load', function () { setTimeout(init, 350); });
})();
