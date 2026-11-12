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
  var S = { faces: [], backs: [], adj: { w: 1, c: 1 }, wadj: { e: 1, p: 1 }, family: null, structure: null, result: null, signedIn: false, busy: 0 };

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
    var sc = freeScale(img);
    return finishFree(KS.analyseFree(img.rgba, img.w, img.h, sc), sc);
  }
  // The same measurement in a Web Worker, so the camera preview and the spinner keep moving while it runs.
  var worker = null, wseq = 0, wpend = {};
  function getWorker() {
    if (worker !== null) return worker;
    try {
      worker = new Worker('assets/js/scan/scan-worker.js?v=20261113b');
      worker.onmessage = function (e) { var p = wpend[e.data.id]; if (p) { delete wpend[e.data.id]; p(e.data.r); } };
      worker.onerror = function () { worker = false; Object.keys(wpend).forEach(function (k) { var p = wpend[k]; delete wpend[k]; p(null); }); };
    } catch (_) { worker = false; }
    return worker;
  }
  function analyseAsync(img) {
    var sc = freeScale(img), w = getWorker();
    var here = function () { var r; try { r = analyseAny(img); } catch (e) { r = { error: 'This photo could not be measured: ' + e.message }; } return r; };
    if (!w) return new Promise(function (ok) { setTimeout(function () { ok(here()); }, 20); });
    return new Promise(function (ok) {
      var id = ++wseq, copy = new Uint8ClampedArray(img.rgba);          // the worker gets its own copy; this one stays usable
      var t = setTimeout(function () { delete wpend[id]; ok(here()); }, 25000);
      wpend[id] = function (r) { clearTimeout(t); ok(r == null ? here() : r.card === null ? finishFree(r, sc) : r); };
      w.postMessage({ id: id, buf: copy.buffer, w: img.w, h: img.h, skip_card: img.card_seen === false, free: { pxPerMm: sc.pxPerMm, source: sc.source, note: sc.note } }, [copy.buffer]);
    });
  }
  function finishFree(f, sc) {
    if (f.error) return f;
    f.scale.dist_mm = sc.dist_mm;
    if (f.kind && f.kind.kind === 'none') return { error: 'No regular loop pattern in this photo — come closer (8–12 cm), fill the frame with the fabric, and keep it in focus.', code: 'no_loops' };
    if (f.card && f.card.type === 'id') return f;                          // a bank / NID card in the photo: the scale is exact
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
    if (res._flat) drawFlat(item.el.querySelector('canvas'), res, false, null); else drawBlank(item.el.querySelector('canvas'));
    var wv = res.woven && res.woven.ok ? res.woven : null;
    if (kind !== 'back' && res.family === 'woven' && wv) {
      txt.innerHTML = '<b>' + wv.ends_per_cm.toFixed(1) + '</b> ends · <b>' + wv.picks_per_cm.toFixed(1) + '</b> picks /cm<br>' + esc(wv.weave.name) + (res.card ? (res.card.type === 'id' ? '<br><span style="color:#1E7A54">ID card · exact scale</span>' : '') : '<br><span style="color:#B26A00">no card · scale estimated</span>');
      return;
    }
    txt.innerHTML = kind === 'back' ? 'Back read ✓' : '<b>' + res.wpc.toFixed(1) + '</b> w · <b>' + res.cpc.toFixed(1) + '</b> c /cm<br>' + esc(res.confidence) + ' confidence' + (res.faults.length ? ' · ' + res.faults.length + ' fault' + (res.faults.length > 1 ? 's' : '') : '')
      + (res.card ? (res.card.type === 'id' ? '<br><span style="color:#1E7A54">ID card · exact scale</span>' : '') : '<br><span style="color:#B26A00">no card · scale estimated</span>');
  }
  function run(kind, getImage) {
    var list = kind === 'face' ? S.faces : S.backs;
    if (kind === 'face' && S.faces.length >= 3) { S.faces.shift().el.remove(); }
    if (kind === 'back' && S.backs.length >= 1) { S.backs.shift().el.remove(); }
    var item = addShot(list, kind === 'face' ? 'sc-face-shots' : 'sc-back-shots');
    S.busy++;
    Promise.resolve().then(getImage).then(function (img) {
      return analyseAsync(img);
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
    var hadFaces = goodFaces().length, shotNow = false;
    // both sides: a knitted cloth is told apart by its back (jersey's back is all loop heads, rib and interlock look
    // the same both sides, fleece and terry show loops or pile), and a twill's back runs the other way
    var steps = [{ kind: 'face', label: hadFaces ? 'One more photo of the face' : 'Face side — point at the fabric' }];
    if (!(S.backs[0] && S.backs[0].res)) steps.push({ kind: 'back', label: 'Now the back — turn the cloth over' });
    window.KAScanCamera.open({
      steps: steps,
      onCapture: function (kind, img) {
        return analyseAsync(img).then(function (r) { return accept(kind, r, img); });
      },
      onSendFrame: sendFrame,
      onDone: function () {
        update();
        if (goodFaces().length) $('sc-count-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
        // one shot: the spec follows the photo without another tap
        if (shotNow && goodFaces().length) setTimeout(function () { var c = combined(); $(c && c.family === 'woven' ? 'sc-wgo' : 'sc-go').click(); }, 350);
      },
    });
    function accept(kind, r, img) {
        if (!r) r = { error: 'This photo could not be measured.' };
        // the live view was counting the same cloth a moment ago: a photo that reads double or half of it caught a
        // double image from the moving hand, not a different fabric — take it again (it is quick)
        var isWoven = !r.error && r.family === 'woven';
        if (kind === 'face' && !r.error && r.card && img && img.live && !isWoven) {
          var q = r.wpc / img.live.wpc;
          if (q > 1.6 || q < 0.62) return Promise.resolve({ ok: false, error: 'blurred by the movement — taking it again' });
        }
        if (kind === 'back' && r.error && /No regular loop pattern/.test(r.error)) r = { backOnly: true, features: { regularity: 0, orient: { diagonal: 0, across: 0 } } };
        if (r.error) return Promise.resolve({ ok: false, error: r.error.replace(/\. .*/, '.') });
        if (kind === 'face' && !isWoven && r.confidence === 'low' && r.card) return Promise.resolve({ ok: false, error: 'the loops are not clear enough' });
        if (kind === 'face' && !isWoven && r.confidence === 'low' && r.regularity < 0.3) return Promise.resolve({ ok: false, error: 'the loops are not clear — come a little closer, with the fabric filling the picture' });
        // a face photo far from the ones before it is the back, or a different fabric
        var before = goodFaces();
        if (kind === 'face' && before.length) {
          var mw = KS.median(before.map(function (x) { return x.wpc; })), mc = KS.median(before.map(function (x) { return x.cpc; }));
          if (Math.abs(r.wpc / mw - 1) > 0.15 || Math.abs(r.cpc / mc - 1) > 0.15) return Promise.resolve({ ok: false, error: 'different from the earlier photos — is this the face side of the same fabric?' });
        }
        addMeasured(kind, r);
        if (kind === 'face') shotNow = true;
        return Promise.resolve({ ok: true, note: kind === 'back' ? 'Back captured' : isWoven && r.woven && r.woven.ok ? 'Woven: ' + r.woven.weave.name + ' · ' + r.woven.ends_per_cm.toFixed(1) + ' × ' + r.woven.picks_per_cm.toFixed(1) + ' threads per cm' : r.wpc.toFixed(1) + ' wales · ' + r.cpc.toFixed(1) + ' courses per cm' + (r.card ? '' : ' (scale estimated)') });
    }
    function sendFrame(img, info) {
        var c = document.createElement('canvas'), k = Math.min(1, 2000 / Math.max(img.w, img.h));
        c.width = Math.round(img.w * k); c.height = Math.round(img.h * k);
        var t = document.createElement('canvas'); t.width = img.w; t.height = img.h;
        t.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.w, img.h), 0, 0);
        c.getContext('2d').drawImage(t, 0, 0, c.width, c.height);
        return fetch(API + '/api/scan/debug', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pair: pair || undefined, image: c.toDataURL('image/jpeg', 0.9), info: info }) }).then(function (r) { return r.ok; });
    }
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
    var ids = g.filter(function (r) { return r.identity; });
    var pW = ids.length ? ids.reduce(function (t, r) { return t + r.identity.p_woven; }, 0) / ids.length : 0;
    // the back adds its own verdict, at a lower weight than the face (log-odds, so a sure back still counts)
    var bk = S.backs[0] && S.backs[0].res && !S.backs[0].res.error && S.backs[0].res.identity ? S.backs[0].res : null;
    var lg = function (q) { q = Math.max(0.02, Math.min(0.98, q)); return Math.log(q / (1 - q)); };
    if (bk && ids.length) pW = 1 / (1 + Math.exp(-(lg(pW) + 0.6 * lg(bk.identity.p_woven))));
    var autoFamily = pW >= 0.5 ? 'woven' : 'knit';
    // the woven reading: the clearest of the photos, and the thread counts as the median of all of them
    var rank = { high: 3, medium: 2, low: 1 };
    var wr = g.filter(function (r) { return r.woven && r.woven.ok; });
    var wov = wr.slice().sort(function (a, b) { return (rank[b.woven.confidence] || 0) - (rank[a.woven.confidence] || 0) || (b.woven.matrix_match || 0) - (a.woven.matrix_match || 0); })[0];
    var idBest = ids.slice().sort(function (a, b) { return Math.abs(b.identity.p_woven - 0.5) - Math.abs(a.identity.p_woven - 0.5); })[0];
    return { wpc: wpc, cpc: cpc, spread: spread, best: best, n: g.length, confidence: conf, estimated: free.length > 0, dist: free.length ? free[0].scale.dist_mm : null,
      family: S.family || autoFamily, autoFamily: autoFamily, pWoven: pW, identity: idBest ? idBest.identity : null, back: bk, sides: twoSides(idBest || null, bk),
      wov: wov ? wov.woven : null, wovBest: wov || null,
      epc: wr.length ? KS.median(wr.map(function (r) { return r.woven.ends_per_cm; })) : null, ppc: wr.length ? KS.median(wr.map(function (r) { return r.woven.picks_per_cm; })) : null,
      wspread: wr.length > 1 ? Math.max.apply(null, wr.map(function (r) { return Math.abs(r.woven.ends_per_cm / KS.median(wr.map(function (x) { return x.woven.ends_per_cm; })) - 1); })) : null };
  }

  var CHIP = ['single_jersey', 'pique', 'rib', 'interlock', 'fleece', 'terry'];
  // without the card: "how far was the phone?" — counts per cm scale with 1 / distance
  function distK(c) { return c && c.estimated && S.dist && c.dist ? c.dist / S.dist : 1; }
  function scaleBox(c, woven) {
    var id = woven ? 'sc-wscale' : 'sc-scale', anchor = woven ? 'sc-wagree' : 'sc-agree', box = $(id);
    if (!box) { box = document.createElement('div'); box.id = id; box.className = 'sc-why'; $(anchor).parentNode.insertBefore(box, $(anchor)); }
    if (!c.estimated) { box.hidden = true; return; }
    box.hidden = false;
    var now = S.dist || c.dist;
    box.innerHTML = '<b>No scan card — the scale is estimated.</b> The ' + (woven ? 'weave and the thread lattice are' : 'loop grid is') + ' exact; the per-cm numbers assume the phone was ' + (now / 10).toFixed(0) + ' cm from the fabric. Held closer or farther? Tap it:<div class="sc-row" style="margin-top:6px">'
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
    $('sc-id-card').hidden = !hasFace;
    var isW = !!c && c.family === 'woven', knitOK = !!c && !!c.best.lattice;
    $('sc-woven-card').hidden = !hasFace || !isW;
    $('sc-back-card').hidden = !hasFace || isW;
    $('sc-count-card').hidden = !hasFace || isW || !knitOK;
    $('sc-struct-card').hidden = !hasFace || isW || !knitOK;
    if (!hasFace) return;
    renderId(c);
    if (isW) { renderWovenCard(c); return; }
    if (!knitOK) return;
    var k = distK(c);
    $('sc-wpc').textContent = (c.estimated ? '≈ ' : '') + (c.wpc * S.adj.w * k).toFixed(c.estimated ? 1 : 2);
    $('sc-cpc').textContent = (c.estimated ? '≈ ' : '') + (c.cpc * S.adj.c * k).toFixed(c.estimated ? 1 : 2);
    drawFlat($('sc-check'), c.best, true, S.adj, k);
    scaleBox(c);
    $('sc-agree').textContent = c.n > 1 ? c.n + ' photos agree within ' + (c.spread * 100).toFixed(1) + '%' + (c.spread > 0.04 ? ' — retake the one that differs' : '.') : 'One photo — a second at another place makes it surer.';
    // suggestions
    var back = S.backs[0] && S.backs[0].res && !S.backs[0].res.error ? S.backs[0].res.features : null;
    var sug = KS.suggest(c.best.features, back), p = {}, why = {};
    // the recogniser's structure answer (when it ran), folded in the same way the identification does
    if (c.best.model && c.best.model.knit && KS.blendKnit) sug = KS.blendKnit(sug, c.best.model.knit);
    sug.forEach(function (x) {
      if (x.structure === 'fleece_or_terry') { p.fleece = x.p * 0.55; p.terry = x.p * 0.45; why.fleece = why.terry = x.why; }
      else { p[x.structure] = x.p; why[x.structure] = x.why; }
    });
    if (c.sides && c.sides.double != null) {
      var dbl = c.sides.double, tot = 0;
      CHIP.forEach(function (k) { var isDouble = k === 'rib' || k === 'interlock'; p[k] = (p[k] || 0.01) * (isDouble === dbl ? 1.8 : 0.55); tot += p[k]; });
      CHIP.forEach(function (k) { p[k] /= tot; });
      var lead = dbl ? 'rib' : 'single_jersey';
      if (!why[lead]) why[lead] = c.sides.notes[0];
    }
    var order = CHIP.slice().sort(function (a, b) { return (p[b] || 0) - (p[a] || 0); });
    if (!S.structure || !S.userPicked) S.structure = order[0];
    $('sc-chips').innerHTML = order.map(function (k) {
      return '<button type="button" class="sc-chip' + (k === S.structure ? ' on' : '') + '" data-s="' + k + '">' + esc(V.NAMES[k]) + '<small>' + Math.round((p[k] || 0) * 100) + '%</small></button>';
    }).join('');
    $('sc-why').textContent = why[S.structure] ? 'Why: ' + why[S.structure] + '.' : '';
    if ((S.structure === 'pique' || S.structure === 'fleece' || S.structure === 'terry') && S.adj.c === 1) $('sc-agree').textContent += ' Tuck and loop fabrics often read one course per cell of two — if a grid cell holds two loops, tap × 2 on courses. Wales, stitch length and count are not affected.';
    S.suggest = order.map(function (k) { return { structure: k, p: p[k] || 0 }; });
  }
  // The classic hand test, done on the photos: is the cloth the same on both sides?
  function twoSides(face, back) {
    if (!face || !back) return null;
    var fl = face.legs, bl = back.legs, out = { notes: [], double: null };
    if (fl && bl) {
      if (fl.legs && bl.legs) { out.double = true; out.notes.push('loop legs on both sides — a double knit (rib or interlock)'); }
      else if (fl.legs && !bl.legs) { out.double = false; out.notes.push('loop legs on the face only — a single knit (jersey, piqué, fleece or terry)'); }
    }
    var fw = face.woven && face.woven.ok ? face.woven.weave : null, bw = back.woven && back.woven.ok ? back.woven.weave : null;
    if (fw && bw && fw.cls === 'twill' && bw.cls === 'twill' && fw.hand && bw.hand) out.notes.push(fw.hand !== bw.hand ? 'the twill runs the other way on the back, as a twill does' : 'the twill runs the same way on both sides — check which side is the face');
    if (fw && bw && fw.face && bw.face && fw.face !== bw.face && fw.face !== 'balanced' && bw.face !== 'balanced') out.notes.push(fw.face + '-faced on the face, ' + bw.face + '-faced on the back');
    if (!back.woven || !back.woven.ok) { if (back.backOnly) out.notes.push('no regular loops on the back — loop yarn or brushed (fleece / terry)'); }
    return out;
  }
  var FAMN = { knit: 'Knitted', woven: 'Woven' };
  function pct(v) { return Math.round(v * 100) + '%'; }
  function renderId(c) {
    var id = c.identity, pW = c.pWoven, fam = c.family;
    var kw = Math.max(10, Math.min(90, (1 - pW) * 100));
    $('sc-fam').innerHTML = '<div class="k" style="width:' + kw + '%">' + (kw < 28 ? '' : 'Knitted ') + pct(1 - pW) + '</div><div class="w" style="width:' + (100 - kw) + '%">' + (100 - kw < 28 ? '' : 'Woven ') + pct(pW) + '</div>';
    document.querySelectorAll('[data-fam]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-fam') === fam); });
    var rows = [];
    if (S.family && S.family !== c.autoFamily) rows.push('<div class="sc-idrow"><span>Your choice: <b>' + FAMN[fam] + '</b> — the photo read ' + FAMN[c.autoFamily].toLowerCase() + ' (' + pct(c.autoFamily === 'woven' ? pW : 1 - pW) + ').</span></div>');
    if (id) {
      var list = id.candidates.filter(function (x) { return x.family === fam; });
      var tot = list.reduce(function (t, x) { return t + x.p; }, 0) || 1;
      if (fam === 'knit' && S.suggest && S.suggest.length) list = S.suggest.slice(0, 3).map(function (x) { return { family: 'knit', category: V.NAMES[x.structure] || x.structure, structure: '', p: x.p, why: '' }; }), tot = 1;
      if (fam === 'woven' && c.wov) list[0] && (list[0].structure = c.wov.weave.name);
      list.slice(0, 3).forEach(function (x, i) {
        rows.push('<div class="sc-idrow' + (i ? '' : ' top') + '"><span><b>' + esc(FAMN[fam]) + ' › ' + esc(x.category) + '</b>' + (x.structure && x.structure !== x.category ? ' › ' + esc(x.structure) : '')
          + (x.why ? '<small>' + esc(x.why) + '</small>' : '') + '</span><span class="p">' + pct(x.p / tot) + '</span></div>');
      });
      $('sc-evid').innerHTML = (id.evidence || []).map(function (e) {
        return '<li><i class="' + (e.says === 'woven' ? 'w' : 'k') + '">' + (e.says === 'woven' ? 'woven +' : 'knitted +') + e.weight.toFixed(1) + '</i><span>' + esc(e.why) + '</span></li>';
      }).join('') + (c.sides && c.sides.notes.length ? c.sides.notes.map(function (n) { return '<li><i>both sides</i><span>' + esc(n) + '</span></li>'; }).join('') : '')
        + (c.back ? '' : '<li><i></i><span>Photograph the back too: the two sides together tell rib from jersey, and confirm a twill.</span></li>')
        + '<li><i></i><span>Each item is a measurement on the photo; the weights add up as log-odds into the knitted / woven split above.</span></li>';
    }
    if (fam === 'knit' && !c.best.lattice) rows.push('<div class="sc-idrow"><span>These photos were read only as woven, so no loop count was kept. Take the photo again; it will be counted as knitted.</span></div>');
    $('sc-idlist').innerHTML = rows.join('');
  }
  var DENIM = ['#243B6B', '#E9E6DC'];
  function renderWovenCard(c) {
    var w = c.wov, btn = $('sc-wgo');
    if (!$('sc-wcomp').options.length) $('sc-wcomp').innerHTML = $('sc-comp').innerHTML;
    if (!w) {
      $('sc-wv').innerHTML = '<div class="d">No thread lattice was read in these photos — the threads may be too fine at this distance. Come closer (6–8 cm), keep the cloth flat and filling the frame, and take it again. For knitted cloth, tap Knitted above.</div>';
      $('sc-epc').textContent = $('sc-ppc').textContent = '—'; $('sc-epi').textContent = $('sc-ppi').textContent = '';
      btn.disabled = true; return;
    }
    btn.disabled = false;
    var k = distK(c), e = c.epc * S.wadj.e * k, p = c.ppc * S.wadj.p * k, wv = w.weave, id = c.identity || {};
    var cols = id.denim_like ? DENIM : null;
    var bits = [];
    if (wv.cls === 'twill') bits.push(wv.direction + (wv.angle_deg ? ', the twill line at about ' + Math.round(wv.angle_deg) + '° to the weft' : ''));
    bits.push(wv.face === 'warp' ? 'warp-faced (more end than pick on the face)' : wv.face === 'weft' ? 'weft-faced (more pick than end on the face)' : 'balanced face');
    bits.push('repeat ' + (w.matrix ? w.matrix[0].length + ' ends × ' + w.matrix.length + ' picks' : wv.repeat + ' threads'));
    bits.push(w.confidence + ' confidence' + (w.matrix_match != null ? ' · ' + Math.round(w.matrix_match * 100) + '% of the crossings fit the diagram' : '') + (w.read_by === 'colour' ? ' · crossings read by the two yarn colours' : ''));
    if (wv.runner_up) bits.push('next best: ' + wv.runner_up.id.replace(/^twill(\d)([RL])$/, 'twill, repeat $1').replace(/^satin(\d)\w$/, '$1-end satin').replace('basket22', 'basket').replace('weftrib', 'rib weave'));
    $('sc-wv').innerHTML = (w.matrix ? V.weaveSvg(w.matrix, 12, cols && cols[0], cols && cols[1]) : '') + '<div><div class="t">' + esc(wv.name) + '</div><div class="d">' + bits.map(esc).join('<br>') + '</div></div>';
    $('sc-epc').textContent = (c.estimated ? '≈ ' : '') + e.toFixed(1);
    $('sc-ppc').textContent = (c.estimated ? '≈ ' : '') + p.toFixed(1);
    $('sc-epi').textContent = Math.round(e * 2.54) + ' EPI';
    $('sc-ppi').textContent = Math.round(p * 2.54) + ' PPI';
    scaleBox(c, true);
    $('sc-wagree').textContent = (c.n > 1 && c.wspread != null ? c.n + ' photos agree within ' + (c.wspread * 100).toFixed(1) + '%.' : 'One photo — a second at another place makes it surer.')
      + ' If a count reads double or half (two threads seen as one), correct it with ÷ 2 / × 2.';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-fam]'); if (!b) return;
    var f = b.getAttribute('data-fam'), c = combined();
    S.family = c && f === c.autoFamily ? null : f; update();
  });
  document.querySelectorAll('[data-wadj]').forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.getAttribute('data-wadj'), f = +b.getAttribute('data-f');
      S.wadj[k] = Math.max(0.25, Math.min(4, S.wadj[k] * f)); update();
    });
  });
  $('sc-wgo').addEventListener('click', function () {
    var c = combined(), btn = this, msg = $('sc-wmsg');
    if (!c || !c.wov) return;
    if (S.busy) { msg.textContent = 'Still measuring a photo…'; return; }
    var w = c.wov, wv = w.weave, k = distK(c), best = c.wovBest || c.best, id = c.identity || {};
    var body = {
      pair: pair || undefined, family: 'woven',
      weave: { cls: wv.cls, repeat: wv.repeat, notation: wv.notation || null, hand: wv.hand || null, face: wv.face, name: wv.name, angle_deg: wv.angle_deg || null },
      matrix: w.matrix || null, ends_per_cm: +(c.epc * S.wadj.e * k).toFixed(2), picks_per_cm: +(c.ppc * S.wadj.p * k).toFixed(2),
      gsm: $('sc-wgsm').value || null, composition: $('sc-wcomp').value, warp_count: $('sc-wwarp').value.trim() || null, weft_count: $('sc-wweft').value.trim() || null,
      denim: !!id.denim_like, confidence: w.confidence,
      measure: { px_per_mm: best.card ? best.card.px_per_mm : best.scale.px_per_mm * k, scale: best.card ? 'card' : best.scale.source, photos: c.n, colour: best.colour, p_woven: c.pWoven },
    };
    btn.disabled = true; msg.className = 'sc-msg'; msg.innerHTML = '<span class="sc-busy"></span> Working out the woven spec…';
    fetch(API + '/api/scan/analyse', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok || !d.success) throw new Error(d.error || 'The woven spec could not be worked out.'); return d; }); })
      .then(function (d) {
        S.result = d.result; msg.textContent = '';
        $('sc-result').innerHTML = V.render(d.result);
        $('sc-full').textContent = 'Open in the woven calculator';
        $('sc-result-card').hidden = false;
        $('sc-result-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
      })
      .catch(function (e) { msg.className = 'sc-msg err'; msg.textContent = e.message; })
      .then(function () { btn.disabled = false; });
  });

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
        $('sc-full').textContent = 'Full analysis: cost, CO₂, 3D';
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
    if (S.result.family === 'woven') {
      var fp = S.result.full_params || {};
      if (typeof savePending === 'function') savePending({ fabric: fp.fabric_id, woven: true, epi: fp.epi, ppi: fp.ppi, warp_count: fp.warp_count, weft_count: fp.weft_count, composition: fp.composition });
      window.location.href = '/app.html?recalc=1';
      return;
    }
    if (typeof savePending === 'function') savePending(S.result.full_params);
    window.location.href = '/result.html';
  });
  $('sc-again').addEventListener('click', function () {
    S.faces.forEach(function (f) { f.el.remove(); }); S.backs.forEach(function (f) { f.el.remove(); });
    S.faces = []; S.backs = []; S.adj = { w: 1, c: 1 }; S.wadj = { e: 1, p: 1 }; S.family = null; S.dist = null; S.structure = null; S.userPicked = false; S.result = null; S.sampleTruth = null;
    $('sc-result-card').hidden = true; $('sc-gsm').value = ''; $('sc-wgsm').value = ''; $('sc-wwarp').value = ''; $('sc-wweft').value = ''; update();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();
