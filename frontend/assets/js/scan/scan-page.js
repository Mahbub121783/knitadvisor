/**
 * KnitAdvisor — the phone's scan page.
 * Photos are measured here (fabric-scan-core.js); only the numbers, the
 * structure and a small flattened thumbnail go to the server.
 */
(function () {
  'use strict';
  var KS = window.KAScan, SY = window.KAScanSynth, V = window.KAScanView;
  var $ = function (id) { return document.getElementById(id); };
  var host = window.location.hostname;
  var API = (host === '127.0.0.1' || host === 'localhost') ? window.location.protocol + '//' + host + ':3001' : '';
  var esc = V.esc;

  var st = document.createElement('style'); st.textContent = V.CSS; document.head.appendChild(st);

  var pair = (new URLSearchParams(window.location.search).get('pair') || '').toUpperCase();
  if (!/^[A-Z2-9]{8}$/.test(pair)) pair = '';
  var S = { faces: [], backs: [], adj: { w: 1, c: 1 }, structure: null, result: null, signedIn: false, busy: 0 };

  // ── who is this for ─────────────────────────────────────────────────
  if (pair) {
    $('sc-pair').className = 'sc-pair on';
    $('sc-pair').innerHTML = '● Connected to screen <b style="font-family:var(--mono)">' + pair.slice(0, 4) + '-' + pair.slice(4) + '</b> — results show there too.';
  }
  fetch(API + '/api/auth/me', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    S.signedIn = !!(d && d.user);
    if (!pair && !S.signedIn) {
      $('sc-pair').innerHTML = 'Not signed in. Scan the QR code on a signed-in screen, or <a href="/?login=1&amp;next=%2Fscan.html">sign in</a> to save results.';
    }
  }).catch(function () {});

  $('sc-howbtn').addEventListener('click', function () { $('sc-how').hidden = !$('sc-how').hidden; });

  // ── reading a photo ─────────────────────────────────────────────────
  var MAX_SIDE = 2400;
  function loadFile(file) {
    var draw = function (src, w, h) {
      var s = Math.min(1, MAX_SIDE / Math.max(w, h)), W = Math.round(w * s), H = Math.round(h * s);
      var c = document.createElement('canvas'); c.width = W; c.height = H;
      var g = c.getContext('2d'); g.drawImage(src, 0, 0, W, H);
      return { rgba: g.getImageData(0, 0, W, H).data, w: W, h: H };
    };
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (b) { var o = draw(b, b.width, b.height); b.close && b.close(); return o; })
        .catch(function () { return viaImg(); });
    }
    return viaImg();
    function viaImg() {
      return new Promise(function (ok, bad) {
        var url = URL.createObjectURL(file), im = new Image();
        im.onload = function () { URL.revokeObjectURL(url); ok(draw(im, im.naturalWidth, im.naturalHeight)); };
        im.onerror = function () { URL.revokeObjectURL(url); bad(new Error('This photo could not be opened.')); };
        im.src = url;
      });
    }
  }

  // No card in the photo: the loops are still counted, on the fabric's own axes; only the scale is estimated —
  // from the camera's focus distance when it reports one, else a phone held about 10 cm away (66 degree lens).
  var FOV = 66 * Math.PI / 180, ASSUME_MM = 100;
  function freeScale(img) {
    var f = img.focus_mm, d = f >= 40 && f <= 300 ? f : ASSUME_MM;
    return { pxPerMm: Math.max(img.w, img.h) / (2 * d * Math.tan(FOV / 2)), source: d === f ? 'focus' : 'assumed', dist_mm: d,
      note: d === f ? 'from the camera focus (' + Math.round(d / 10) + ' cm)' : 'phone about 10 cm from the fabric' };
  }
  function analyseAny(img) {
    var r = KS.analysePhoto(img.rgba, img.w, img.h);
    if (!r.error || r.code !== 'no_card') return r;
    var sc = freeScale(img), f = KS.analyseFree(img.rgba, img.w, img.h, sc);
    if (f.error) return f;
    f.scale.dist_mm = sc.dist_mm;
    if (f.kind && f.kind.kind === 'none') return { error: 'No regular loop pattern in this photo — come closer (8–12 cm), fill the frame with the fabric, and keep it in focus.', code: 'no_loops' };
    if (f.confidence === 'high') f.confidence = 'medium';                // the count is good; the scale is an estimate
    return f;
  }

  function addShot(list, box) {
    var el = document.createElement('div'); el.className = 'sc-shot';
    el.innerHTML = '<canvas width="160" height="160"></canvas><div><span class="sc-busy"></span> Measuring…</div>';
    $(box).appendChild(el);
    var item = { el: el, res: null };
    list.push(item);
    return item;
  }
  function finishShot(item, res, kind) {
    item.res = res;
    var txt = item.el.querySelector('div');
    if (res.error) {
      item.el.classList.add('err');
      txt.textContent = res.error;
      return;
    }
    drawFlat(item.el.querySelector('canvas'), res, false, null);
    txt.innerHTML = kind === 'back' ? 'Back read ✓' : '<b>' + res.wpc.toFixed(1) + '</b> w · <b>' + res.cpc.toFixed(1) + '</b> c /cm<br>' + esc(res.confidence) + ' confidence' + (res.faults.length ? ' · ' + res.faults.length + ' fault' + (res.faults.length > 1 ? 's' : '') : '')
      + (res.card ? '' : '<br><span style="color:#B26A00">no card · scale estimated</span>') + (res.kind && res.kind.kind === 'woven' ? '<br><span style="color:#B26A00">looks woven</span>' : '');
  }
  function run(kind, getImage) {
    var list = kind === 'face' ? S.faces : S.backs;
    if (kind === 'face' && S.faces.length >= 3) { S.faces.shift().el.remove(); }
    if (kind === 'back' && S.backs.length >= 1) { S.backs.shift().el.remove(); }
    var item = addShot(list, kind === 'face' ? 'sc-face-shots' : 'sc-back-shots');
    S.busy++;
    Promise.resolve().then(getImage).then(function (img) {
      return new Promise(function (ok) {
        setTimeout(function () {
          var r;
          try { r = analyseAny(img); } catch (e) { r = { error: 'This photo could not be measured: ' + e.message }; }
          ok(r);
        }, 30);
      });
    }).catch(function (e) { return { error: e.message }; }).then(function (r) {
      if (kind === 'back' && r.error && /No regular loop pattern/.test(r.error)) r = { backOnly: true, features: { regularity: 0, orient: { diagonal: 0, across: 0 } } };
      S.busy--;
      if (r.backOnly) { item.res = r; item.el.querySelector('div').textContent = 'Back: no regular loops (loop or brushed yarn)'; drawBlank(item.el.querySelector('canvas')); }
      else finishShot(item, r, kind);
      update();
    });
  }
  function addMeasured(kind, r) {
    var list = kind === 'face' ? S.faces : S.backs;
    if (kind === 'face' && S.faces.length >= 3) { S.faces.shift().el.remove(); }
    if (kind === 'back' && S.backs.length >= 1) { S.backs.shift().el.remove(); }
    var item = addShot(list, kind === 'face' ? 'sc-face-shots' : 'sc-back-shots');
    if (r.backOnly) { item.res = r; item.el.querySelector('div').textContent = 'Back: no regular loops (loop or brushed yarn)'; drawBlank(item.el.querySelector('canvas')); }
    else finishShot(item, r, kind);
    update();
  }
  // the live camera: each auto-captured photo is measured at once and kept only if it measures
  $('sc-cam').addEventListener('click', function () {
    var hadFaces = goodFaces().length;
    var steps = [];
    for (var k = hadFaces; k < 3; k++) steps.push({ kind: 'face', label: 'Face ' + (k + 1) + ' of 3' });
    steps.push({ kind: 'back', label: 'Back' });
    window.KAScanCamera.open({
      steps: steps,
      onCapture: function (kind, img) {
        var r;
        try { r = analyseAny(img); } catch (e) { r = { error: e.message }; }
        if (kind === 'back' && r.error && /No regular loop pattern/.test(r.error)) r = { backOnly: true, features: { regularity: 0, orient: { diagonal: 0, across: 0 } } };
        if (r.error) return Promise.resolve({ ok: false, error: r.error.replace(/\. .*/, '.') });
        if (kind === 'face' && r.confidence === 'low' && r.card) return Promise.resolve({ ok: false, error: 'the loops are not clear enough' });
        if (kind === 'face' && r.confidence === 'low' && r.regularity < 0.3) return Promise.resolve({ ok: false, error: 'the loops are not clear — come a little closer and hold still' });
        // a face photo far from the ones before it is the back, or a different fabric
        var before = goodFaces();
        if (kind === 'face' && before.length) {
          var mw = KS.median(before.map(function (x) { return x.wpc; })), mc = KS.median(before.map(function (x) { return x.cpc; }));
          if (Math.abs(r.wpc / mw - 1) > 0.15 || Math.abs(r.cpc / mc - 1) > 0.15) return Promise.resolve({ ok: false, error: 'different from the earlier photos — is this the face side of the same fabric?' });
        }
        addMeasured(kind, r);
        return Promise.resolve({ ok: true, note: kind === 'back' ? 'Back captured' : r.kind && r.kind.kind === 'woven' ? 'Woven fabric seen' : r.wpc.toFixed(1) + ' wales · ' + r.cpc.toFixed(1) + ' courses per cm' + (r.card ? '' : ' (scale estimated)') });
      },
      onSendFrame: function (img, info) {
        var c = document.createElement('canvas'), k = Math.min(1, 2000 / Math.max(img.w, img.h));
        c.width = Math.round(img.w * k); c.height = Math.round(img.h * k);
        var t = document.createElement('canvas'); t.width = img.w; t.height = img.h;
        t.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.w, img.h), 0, 0);
        c.getContext('2d').drawImage(t, 0, 0, c.width, c.height);
        return fetch(API + '/api/scan/debug', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pair: pair || undefined, image: c.toDataURL('image/jpeg', 0.9), info: info }) }).then(function (r) { return r.ok; });
      },
      onDone: function () { update(); if (goodFaces().length) $('sc-count-card').scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    });
  });
  function drawBlank(c) { var g = c.getContext('2d'); g.fillStyle = '#e9ecef'; g.fillRect(0, 0, c.width, c.height); }

  /** The flattened window, optionally a 12 mm crop with the check grid. */
  function drawFlat(canvas, r, withGrid, adj, k) {
    var f = r._flat, g = canvas.getContext('2d'), W = canvas.width;
    var cropPx = withGrid ? Math.min(f.w, Math.round(12 * f.pxPerMm)) : f.w;
    var x0 = Math.floor((f.w - cropPx) / 2), y0 = Math.floor((f.h - cropPx) / 2), s = W / cropPx;
    var img = g.createImageData(W, W);
    for (var y = 0; y < W; y++) for (var x = 0; x < W; x++) {
      var sx = Math.min(f.w - 1, x0 + Math.floor(x / s)), sy = Math.min(f.h - 1, y0 + Math.floor(y / s));
      var v = Math.max(0, Math.min(255, f.data[sy * f.w + sx] * 255)), o = (y * W + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    if (!withGrid) return;
    var m = { wpc: r.wpc * adj.w, cpc: r.cpc * adj.c, lattice: r.lattice };
    var G = KS.grid(f, m);
    var line = function (L, colour) {
      g.strokeStyle = colour; g.lineWidth = 1.6; g.globalAlpha = 0.9;
      var big = f.w * 2;
      var kMin = Math.floor(-big / L.spacing), kMax = Math.ceil(big / L.spacing);
      for (var k = kMin; k <= kMax; k++) {
        var d = L.offset + k * L.spacing, px = L.normal[0] * d, py = L.normal[1] * d;
        var ax = (px - L.dir[0] * big - x0) * s, ay = (py - L.dir[1] * big - y0) * s, bx = (px + L.dir[0] * big - x0) * s, by = (py + L.dir[1] * big - y0) * s;
        if ((ax < 0 && bx < 0) || (ax > W && bx > W) || (ay < 0 && by < 0) || (ay > W && by > W)) continue;
        g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      }
      g.globalAlpha = 1;
    };
    line(G.wale, '#00B3A4'); line(G.course, '#FF7A00');
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, W - 22, W, 22);
    g.fillStyle = '#fff'; g.font = '12px system-ui, sans-serif';
    k = k || 1;
    g.fillText((r.card ? '12 × 12 mm · ' : '≈ ' + (12 / k).toFixed(0) + ' mm · ') + (m.wpc * k).toFixed(1) + ' wales/cm · ' + (m.cpc * k).toFixed(1) + ' courses/cm', 8, W - 7);
  }

  // ── combining the photos ────────────────────────────────────────────
  function goodFaces() { return S.faces.filter(function (f) { return f.res && !f.res.error; }).map(function (f) { return f.res; }); }
  function combined() {
    var g = goodFaces();
    if (!g.length) return null;
    var wpc = KS.median(g.map(function (r) { return r.wpc; })), cpc = KS.median(g.map(function (r) { return r.cpc; }));
    var spread = g.length > 1 ? Math.max.apply(null, g.map(function (r) { return Math.max(Math.abs(r.wpc / wpc - 1), Math.abs(r.cpc / cpc - 1)); })) : g[0].spread;
    var best = g.slice().sort(function (a, b) { return b.regularity - a.regularity; })[0];
    var conf = g.some(function (r) { return r.confidence === 'low'; }) || spread > 0.06 ? 'low' : g.every(function (r) { return r.confidence === 'high'; }) && spread < 0.03 ? 'high' : 'medium';
    var free = g.filter(function (r) { return !r.card; });
    var woven = g.filter(function (r) { return r.kind && r.kind.kind === 'woven'; }).length > g.length / 2;
    return { wpc: wpc, cpc: cpc, spread: spread, best: best, n: g.length, confidence: conf, estimated: free.length > 0, dist: free.length ? free[0].scale.dist_mm : null, woven: woven,
      wovenWhy: woven ? g.filter(function (r) { return r.kind && r.kind.kind === 'woven'; })[0].kind.why : '' };
  }

  var CHIP = ['single_jersey', 'pique', 'rib', 'interlock', 'fleece', 'terry'];
  // without the card: "how far was the phone?" — counts per cm scale with 1 / distance
  function distK(c) { return c && c.estimated && S.dist && c.dist ? c.dist / S.dist : 1; }
  function scaleBox(c) {
    var box = $('sc-scale');
    if (!box) { box = document.createElement('div'); box.id = 'sc-scale'; box.className = 'sc-why'; $('sc-agree').parentNode.insertBefore(box, $('sc-agree')); }
    if (!c.estimated) { box.hidden = true; return; }
    box.hidden = false;
    var now = S.dist || c.dist;
    box.innerHTML = '<b>No scan card — the scale is estimated.</b> The loop grid is exact; the per-cm numbers assume the phone was ' + (now / 10).toFixed(0) + ' cm from the fabric. Held closer or farther? Tap it:<div class="sc-row" style="margin-top:6px">'
      + [60, 80, 100, 120, 150].map(function (d) { return '<button type="button" class="sc-chip' + (Math.abs(d - now) < 5 ? ' on' : '') + '" data-dist="' + d + '">' + d / 10 + ' cm</button>'; }).join('')
      + '</div><span style="font-size:12px">For an exact count, lay the printed scan card on the fabric.</span>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-dist]'); if (!b) return;
    S.dist = +b.getAttribute('data-dist'); update();
  });
  function update() {
    var c = combined();
    var hasFace = !!c;
    $('sc-back-card').hidden = !hasFace;
    $('sc-count-card').hidden = !hasFace;
    $('sc-struct-card').hidden = !hasFace;
    if (!hasFace) return;
    var k = distK(c);
    $('sc-wpc').textContent = (c.estimated ? '≈ ' : '') + (c.wpc * S.adj.w * k).toFixed(c.estimated ? 1 : 2);
    $('sc-cpc').textContent = (c.estimated ? '≈ ' : '') + (c.cpc * S.adj.c * k).toFixed(c.estimated ? 1 : 2);
    drawFlat($('sc-check'), c.best, true, S.adj, k);
    scaleBox(c);
    $('sc-agree').textContent = c.n > 1 ? c.n + ' photos agree within ' + (c.spread * 100).toFixed(1) + '%' + (c.spread > 0.04 ? ' — retake the one that differs' : '.') : 'One photo — a second at another place makes it surer.';
    // suggestions
    var back = S.backs[0] && S.backs[0].res && !S.backs[0].res.error ? S.backs[0].res.features : null;
    var sug = KS.suggest(c.best.features, back), p = {}, why = {};
    sug.forEach(function (x) {
      if (x.structure === 'fleece_or_terry') { p.fleece = x.p * 0.55; p.terry = x.p * 0.45; why.fleece = why.terry = x.why; }
      else { p[x.structure] = x.p; why[x.structure] = x.why; }
    });
    var order = CHIP.slice().sort(function (a, b) { return (p[b] || 0) - (p[a] || 0); });
    if (!S.structure || !S.userPicked) S.structure = order[0];
    $('sc-chips').innerHTML = order.map(function (k) {
      return '<button type="button" class="sc-chip' + (k === S.structure ? ' on' : '') + '" data-s="' + k + '">' + esc(V.NAMES[k]) + '<small>' + Math.round((p[k] || 0) * 100) + '%</small></button>';
    }).join('');
    $('sc-why').textContent = why[S.structure] ? 'Why: ' + why[S.structure] + '.' : '';
    if (c.woven) $('sc-why').innerHTML = '<b style="color:#B26A00">This looks woven, not knitted</b> — ' + esc(c.wovenWhy) + '. The scan works out knitting specs; for woven cloth use the Woven calculator in the <a href="/app.html">Calculator</a>. If it is a knit, pick the structure above.';
    if ((S.structure === 'pique' || S.structure === 'fleece' || S.structure === 'terry') && S.adj.c === 1) $('sc-agree').textContent += ' Tuck and loop fabrics often read one course per cell of two — if a grid cell holds two loops, tap × 2 on courses. Wales, stitch length and count are not affected.';
    S.suggest = order.map(function (k) { return { structure: k, p: p[k] || 0 }; });
  }
  $('sc-chips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-s]'); if (!b) return;
    S.structure = b.getAttribute('data-s'); S.userPicked = true; update();
  });
  document.querySelectorAll('[data-adj]').forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.getAttribute('data-adj'), f = +b.getAttribute('data-f');
      S.adj[k] = Math.max(0.25, Math.min(4, S.adj[k] * f)); update();
    });
  });

  // ── inputs ──────────────────────────────────────────────────────────
  $('sc-face').addEventListener('click', function () { $('sc-face-in').click(); });
  $('sc-face-file').addEventListener('click', function () { $('sc-face-pick').click(); });
  $('sc-back').addEventListener('click', function () { $('sc-back-in').click(); });
  $('sc-face-in').addEventListener('change', function () { var f = this.files[0]; this.value = ''; if (f) run('face', function () { return loadFile(f); }); });
  $('sc-face-pick').addEventListener('change', function () { var fs = Array.prototype.slice.call(this.files, 0, 3); this.value = ''; fs.forEach(function (f) { run('face', function () { return loadFile(f); }); }); });
  $('sc-back-in').addEventListener('change', function () { var f = this.files[0]; this.value = ''; if (f) run('back', function () { return loadFile(f); }); });

  // a made-up swatch, photographed: the whole chain without a printed card
  var SAMPLES = [
    { structure: 'single_jersey', wpc: 14, cpc: 19, colour: [40, 60, 120] }, { structure: 'single_jersey', wpc: 17, cpc: 23, colour: [210, 210, 205] },
    { structure: 'rib', wpc: 10.5, cpc: 17, colour: [150, 30, 40] }, { structure: 'interlock', wpc: 15, cpc: 15, colour: [30, 30, 32] },
    { structure: 'pique', wpc: 11, cpc: 27, colour: [235, 235, 235] },
  ];
  $('sc-sample').addEventListener('click', function () {
    var smp = SAMPLES[Math.floor(Math.random() * SAMPLES.length)];
    var j = function (v) { return Math.round(v * (0.94 + Math.random() * 0.12) * 10) / 10; };
    var o = { structure: smp.structure, wpc: j(smp.wpc), cpc: j(smp.cpc), colour: smp.colour, seed: Math.floor(Math.random() * 1e6), KAScan: KS, pxPerMm: 15, width: 1500, height: 1150 };
    if (Math.random() < 0.35) o.faults = [{ type: 'hole', x: 25 + Math.random() * 20, y: 25 + Math.random() * 20, r: 0.8 }];
    S.sampleTruth = o;
    run('face', function () { var p = SY.photo(o, KS.CARD); return { rgba: p.rgba, w: p.w, h: p.h }; });
    run('back', function () { var p = SY.photo(Object.assign({}, o, { side: 'back', faults: [], seed: o.seed + 1 }), KS.CARD); return { rgba: p.rgba, w: p.w, h: p.h }; });
    $('sc-msg').textContent = '';
  });

  // ── the spec ────────────────────────────────────────────────────────
  $('sc-go').addEventListener('click', function () {
    var c = combined(), btn = this, msg = $('sc-msg');
    if (!c) return;
    if (S.busy) { msg.textContent = 'Still measuring a photo…'; return; }
    var best = c.best, thumb = null, k = distK(c);
    try { thumb = $('sc-check').toDataURL('image/jpeg', 0.82); } catch (_) {}
    var body = {
      pair: pair || undefined, structure: S.structure, wpc: +(c.wpc * S.adj.w * k).toFixed(3), cpc: +(c.cpc * S.adj.c * k).toFixed(3),
      gsm: $('sc-gsm').value || null, composition: $('sc-comp').value, colour_hex: best.colour ? best.colour.hex : null, confidence: c.confidence,
      measure: { spread: c.spread, regularity: best.regularity, skew_deg: best.skew_deg, px_per_mm: best.card ? best.card.px_per_mm : best.scale.px_per_mm * k, scale: best.card ? 'card' : best.scale.source, photos: c.n, faults: best.faults, suggest: S.suggest, colour: best.colour },
      thumb: thumb,
    };
    btn.disabled = true; msg.className = 'sc-msg'; msg.innerHTML = '<span class="sc-busy"></span> Working out the spec…';
    fetch(API + '/api/scan/analyse', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok || !d.success) throw new Error(d.error || 'The spec could not be worked out.'); return d; }); })
      .then(function (d) {
        S.result = d.result;
        msg.textContent = '';
        $('sc-result').innerHTML = (c.estimated ? '<p class="sv-note" style="background:#FFF4E0;color:#7A4A00">Measured without the scan card: the loop pattern and structure are read from the photo, the per-cm counts assume the phone was ' + ((S.dist || c.dist) / 10).toFixed(0) + ' cm away. Lay the printed card on the fabric for an exact count.</p>' : '') + V.render(d.result) + (S.sampleTruth && S.sampleTruth.structure === d.result.structure ? '<p class="sv-note" style="background:#E8F0FD;color:#1857C4">Sample fabric: drawn at ' + S.sampleTruth.wpc + ' wales and ' + S.sampleTruth.cpc + ' courses per cm — compare with what was measured.</p>' : '');
        $('sc-result-card').hidden = false;
        $('sc-result-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
      })
      .catch(function (e) { msg.className = 'sc-msg err'; msg.textContent = e.message; })
      .then(function () { btn.disabled = false; });
  });
  $('sc-full').addEventListener('click', function () {
    if (!S.result) return;
    if (!S.signedIn) { alert(pair ? 'Open the full analysis on the screen — the result is already there.' : 'Sign in to open the full analysis.'); return; }
    if (typeof savePending === 'function') savePending(S.result.full_params);
    window.location.href = '/result.html';
  });
  $('sc-again').addEventListener('click', function () {
    S.faces.forEach(function (f) { f.el.remove(); }); S.backs.forEach(function (f) { f.el.remove(); });
    S.faces = []; S.backs = []; S.adj = { w: 1, c: 1 }; S.dist = null; S.structure = null; S.userPicked = false; S.result = null; S.sampleTruth = null;
    $('sc-result-card').hidden = true; $('sc-gsm').value = ''; update();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();
