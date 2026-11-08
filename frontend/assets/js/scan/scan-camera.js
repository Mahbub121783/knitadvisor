/**
 * KnitAdvisor — live camera with automatic capture.
 *
 * The camera opens full screen. About eight times a second a small copy of the
 * frame is searched for the scan card, and the picture is checked:
 *   card      the four squares are found
 *   distance  the card is big enough for the loops to count (px per mm of the
 *             photo that will be taken), and not so big it leaves the frame
 *   straight  phone square to the card (no perspective) and turned to it
 *   centred   card in the middle
 *   steady    the card has not moved between frames
 *   sharp     the window is as sharp as the camera has managed (autofocus done)
 *   light     the white paper is neither dark nor burnt out
 * When every check holds for about half a second, the box turns green and the
 * photo is taken by itself, measured at once, and kept or retaken. Then it
 * waits for the card to move to a new spot, and finally asks for the back.
 */
(function (root) {
  'use strict';
  var KS = root.KAScan;
  var FOV_DEG = 66;              // typical main phone camera, horizontal — the distance shown is approximate
  var MIN_PX_PER_MM = 11, GOOD_PX_PER_MM = 14, MAX_SIDE = 2400;
  var TICK_MS = 120, HOLD_TICKS = 5, LOOP_EVERY = 4, LIVE_MIN_PXMM = 6.5;

  var CSS = '.kc{position:fixed;inset:0;z-index:2000;background:#000;color:#fff;font-family:var(--head,system-ui);overflow:hidden;touch-action:none}' +
    '.kc video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}.kc canvas.ov{position:absolute;inset:0;width:100%;height:100%}' +
    '.kc-top{position:absolute;left:0;right:0;top:0;padding:max(12px,env(safe-area-inset-top)) 14px 10px;display:flex;align-items:center;gap:10px;background:linear-gradient(#000a,#0000)}' +
    '.kc-top b{font-size:15px;flex:1}.kc-x,.kc-t{width:40px;height:40px;border-radius:50%;border:0;background:#0008;color:#fff;font-size:18px;cursor:pointer}.kc-t.on{background:#FFC83D;color:#000}' +
    '.kc-dots{display:flex;gap:5px}.kc-dots i{width:9px;height:9px;border-radius:50%;background:#fff5}.kc-dots i.done{background:#2BD47D}.kc-dots i.now{background:#fff}' +
    '.kc-msg{position:absolute;left:50%;top:calc(max(12px,env(safe-area-inset-top)) + 58px);transform:translateX(-50%);background:#000b;padding:9px 16px;border-radius:999px;font:700 16px var(--head,system-ui);white-space:nowrap;max-width:92vw;overflow:hidden;text-overflow:ellipsis;transition:background .2s}' +
    '.kc-msg.ok{background:#1E9E5Aee}.kc-msg.warn{background:#C77700ee}' +
    '.kc-checks{position:absolute;left:0;right:0;bottom:calc(max(14px,env(safe-area-inset-bottom)) + 74px);display:flex;flex-wrap:wrap;justify-content:center;gap:6px;padding:0 10px}' +
    '.kc-checks span{font:600 12px var(--head,system-ui);padding:5px 9px;border-radius:999px;background:#0009;color:#fffc}.kc-checks span.ok{background:#1E9E5Acc;color:#fff}.kc-checks span.bad{background:#B23B3Bcc;color:#fff}' +
    '.kc-bot{position:absolute;left:0;right:0;bottom:0;padding:10px 16px max(14px,env(safe-area-inset-bottom));display:flex;align-items:center;justify-content:space-between;gap:10px;background:linear-gradient(#0000,#000a)}' +
    '.kc-bot button{border:0;border-radius:999px;background:#ffffff26;color:#fff;font:600 14px var(--head,system-ui);padding:12px 16px;cursor:pointer}' +
    '.kc-shut{width:66px;height:66px;border-radius:50%!important;padding:0!important;background:#fff!important;box-shadow:0 0 0 4px #0006,0 0 0 7px #fff8;position:relative}' +
    '.kc-shut svg{position:absolute;inset:-7px;width:80px;height:80px;transform:rotate(-90deg)}.kc-shut circle{fill:none;stroke:#2BD47D;stroke-width:5;stroke-linecap:round}' +
    '.kc-flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;transition:opacity .25s}.kc-flash.go{opacity:.85;transition:none}' +
    '.kc-err{position:absolute;inset:0;display:grid;place-items:center;padding:30px;text-align:center;font-size:15px;line-height:1.5;background:#111}' +
    '.kc-err button{margin-top:14px;border:0;border-radius:10px;padding:12px 18px;font:600 14px var(--head,system-ui);background:#1857C4;color:#fff}';

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  /**
   * @param opts {steps: [{kind:'face'|'back', label}], onCapture(kind, img) → Promise<{ok, error, note}>, onDone()}
   */
  function open(opts) {
    if (!document.getElementById('kc-css')) { var s = el('style'); s.id = 'kc-css'; s.textContent = CSS; document.head.appendChild(s); }
    var steps = opts.steps, stepIx = 0;
    var root = el('div', 'kc');
    root.innerHTML = '<video playsinline muted autoplay></video><canvas class="ov"></canvas>' +
      '<div class="kc-top"><button class="kc-x" aria-label="Close camera">✕</button><b class="kc-step"></b><div class="kc-dots"></div><button class="kc-t" hidden aria-label="Light">⚡</button><button class="kc-x kc-send" aria-label="Send this frame for help" title="Send this frame to KnitAdvisor">?</button></div>' +
      '<div class="kc-msg">Starting the camera…</div><div class="kc-checks"></div>' +
      '<div class="kc-bot"><button class="kc-skip">Skip</button><button class="kc-shut" aria-label="Take the photo now"><svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="36" stroke-dasharray="226" stroke-dashoffset="226"></circle></svg></button><button class="kc-done">Done</button></div>' +
      '<div class="kc-flash"></div>';
    document.body.appendChild(root);
    document.documentElement.style.overflow = 'hidden';
    var video = root.querySelector('video'), ov = root.querySelector('canvas.ov'), msg = root.querySelector('.kc-msg');
    var checksEl = root.querySelector('.kc-checks'), ring = root.querySelector('.kc-shut circle');
    var small = document.createElement('canvas'), sg = small.getContext('2d', { willReadFrequently: true });
    var crop = document.createElement('canvas'); crop.width = crop.height = 192; var cg = crop.getContext('2d', { willReadFrequently: true });
    var live = null, tickN = 0, fullCanvas = document.createElement('canvas'), fg = fullCanvas.getContext('2d', { willReadFrequently: true }), moves = [];
    var stream = null, track = null, imageCapture = null, captureW = 0, timer = null, closed = false;
    var okTicks = 0, prev = null, sharpBest = 0, armed = true, busy = false, lastPrint = null, lostTicks = 0, capturedAt = 0, movedSince = false;

    function setStepUI() {
      var st = steps[stepIx];
      root.querySelector('.kc-step').textContent = st ? st.label : 'Done';
      root.querySelector('.kc-dots').innerHTML = steps.map(function (s, i) { return '<i class="' + (i < stepIx ? 'done' : i === stepIx ? 'now' : '') + '"></i>'; }).join('');
      root.querySelector('.kc-skip').textContent = st && st.kind === 'back' ? 'Skip back' : 'Skip';
      root.querySelector('.kc-skip').hidden = !st || (st.kind === 'face' && stepIx === 0);
    }
    function say(text, cls) { msg.textContent = text; msg.className = 'kc-msg' + (cls ? ' ' + cls : ''); }
    function close(done) {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      root.remove();
      document.documentElement.style.overflow = '';
      if (done && opts.onDone) opts.onDone();
    }
    root.querySelector('.kc-x').addEventListener('click', function () { close(true); });
    root.querySelector('.kc-done').addEventListener('click', function () { close(true); });
    root.querySelector('.kc-skip').addEventListener('click', function () { next(); });
    root.querySelector('.kc-shut').addEventListener('click', function () { if (!busy) capture(true); });
    root.querySelector('.kc-send').addEventListener('click', function () {
      if (!opts.onSendFrame || busy) return;
      busy = true; say('Sending this frame…', 'ok');
      grabPhoto().then(function (img) {
        return opts.onSendFrame(img, { video: video.videoWidth + '×' + video.videoHeight, capture_w: captureW || null, last: lastState, live: live ? { wpc: live.wpc, cpc: live.cpc, reg: live.regularity, at: live.at } : null, ua: navigator.userAgent });
      }).then(function (ok) { say(ok ? 'Sent — thank you. KnitAdvisor will look at it.' : 'Could not send the frame', ok ? 'ok' : 'warn'); })
        .catch(function () { say('Could not send the frame', 'warn'); })
        .then(function () { setTimeout(function () { busy = false; }, 1500); });
    });
    var lastState = null;
    var torchOn = false;
    root.querySelector('.kc-t').addEventListener('click', function () {
      torchOn = !torchOn;
      track.applyConstraints({ advanced: [{ torch: torchOn }] }).catch(function () {});
      this.classList.toggle('on', torchOn);
    });
    setStepUI();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showError('This browser cannot open the camera here. Use "Take a photo" instead.');
      return { close: close };
    }
    navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } } })
      .then(function (s) {
        if (closed) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
        stream = s; track = s.getVideoTracks()[0];
        video.srcObject = s;
        var caps = track.getCapabilities ? track.getCapabilities() : {};
        if (caps.torch) root.querySelector('.kc-t').hidden = false;
        if (caps.focusMode && caps.focusMode.indexOf('continuous') > -1) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(function () {});
        if (window.ImageCapture) {
          try {
            imageCapture = new ImageCapture(track);
            imageCapture.getPhotoCapabilities().then(function (pc) { if (pc && pc.imageWidth && pc.imageWidth.max) captureW = pc.imageWidth.max; }).catch(function () {});
          } catch (_) { imageCapture = null; }
        }
        return video.play().catch(function () {});
      })
      .then(function () { if (!closed) { say('Point at the scan card'); loop(); } })
      .catch(function (e) {
        showError(e && e.name === 'NotAllowedError' ? 'Camera permission was refused. Allow the camera for this site in the browser settings, or use "Take a photo".' : 'The camera could not be opened (' + (e && e.message || e) + '). Use "Take a photo" instead.');
      });

    function showError(t) {
      var d = el('div', 'kc-err', '<div>' + t + '<br><button type="button">Back</button></div>');
      root.appendChild(d);
      d.querySelector('button').addEventListener('click', function () { close(false); });
    }

    // ── one look at the frame ─────────────────────────────────────────
    function look() {
      var vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return null;
      var sw = 480, sh = Math.round(480 * vh / vw);
      if (vh > vw) { sh = 480; sw = Math.round(480 * vw / vh); }
      if (small.width !== sw) { small.width = sw; small.height = sh; }
      sg.drawImage(video, 0, 0, sw, sh);
      var px = sg.getImageData(0, 0, sw, sh).data, g = KS.toGray(px, sw, sh);
      var det = KS.detectCard(g, sw, sh);
      var out = { vw: vw, vh: vh, sw: sw, sh: sh, det: det, checks: [] };
      if (det.error) { out.found = false; return out; }
      out.found = true;
      var c = det.corners, minS = Math.min(sw, sh);
      // distance: px per mm in the photo that will be analysed
      var fullW = Math.max(vw, captureW || 0), longFull = Math.max(fullW, fullW * Math.max(vw, vh) / vw);
      var keep = Math.min(1, MAX_SIDE / longFull);
      var pxmmPhoto = det.pxPerMm * (fullW / sw) * keep;
      var span = det.pxPerMm * 60;                                   // marker-to-marker, small px
      var distCm = (vw / (det.pxPerMm * vw / sw)) / (2 * Math.tan(FOV_DEG / 2 * Math.PI / 180)) / 10;
      var inFrame = c.every(function (p) { return p[0] > sw * 0.06 && p[0] < sw * 0.94 && p[1] > sh * 0.06 && p[1] < sh * 0.94; });
      var tooBig = span > minS * 0.82 || !inFrame;
      out.distance = { ok: !tooBig && pxmmPhoto >= MIN_PX_PER_MM, cm: distCm, pxmm: pxmmPhoto, hint: tooBig ? 'Move back a little' : pxmmPhoto < MIN_PX_PER_MM ? 'Move closer' : null, good: pxmmPhoto >= GOOD_PX_PER_MM };
      // straight: perspective and turn
      var ang = Math.atan2(c[1][1] - c[0][1], c[1][0] - c[0][0]) * 180 / Math.PI;
      out.straight = { ok: det.tilt < 1.12 && Math.abs(ang) < 12, hint: det.tilt >= 1.12 ? 'Hold the phone flat above the card' : Math.abs(ang) >= 12 ? 'Turn the phone to line up with the card' : null };
      var cx = (c[0][0] + c[1][0] + c[2][0] + c[3][0]) / 4, cy = (c[0][1] + c[1][1] + c[2][1] + c[3][1]) / 4;
      out.centred = { ok: Math.abs(cx - sw / 2) < sw * 0.12 && Math.abs(cy - sh / 2) < sh * 0.12, hint: 'Centre the card' };
      var move = prev ? Math.max.apply(null, c.map(function (p, i) { return Math.hypot(p[0] - prev[i][0], p[1] - prev[i][1]); })) / Math.hypot(sw, sh) : 1;
      moves.push(move); if (moves.length > 3) moves.shift();
      var mv = moves.slice().sort(function (a2, b2) { return a2 - b2; })[Math.floor(moves.length / 2)];
      out.steady = { ok: mv < 0.015, hint: 'Hold still', move: mv };
      // light, from the white paper and the window
      var H = KS.homography(KS.CARD.markers, c);
      var at = function (mx, my) { var q = KS.apply(H, mx, my), x = Math.round(q[0]), y = Math.round(q[1]); return x >= 0 && y >= 0 && x < sw && y < sh ? g[y * sw + x] : null; };
      var whites = KS.CARD.white.map(function (p) { return at(p[0], p[1]); }).filter(function (v) { return v != null; });
      var white = whites.length ? whites.reduce(function (t, v) { return t + v; }, 0) / whites.length : 0;
      // where the fabric is: where the loops were last found, else the window
      var reg = live && !live.error && live.region ? live.region : KS.CARD.regions.window;
      var win = [], fp = [], stx = (reg[1] - reg[0]) / 11, sty = (reg[3] - reg[2]) / 11;
      for (var yy = 0; yy < 12; yy++) for (var xx = 0; xx < 12; xx++) { var v = at(reg[0] + xx * stx, reg[2] + yy * sty); if (v != null) { win.push(v); fp.push(v); } }
      var wmean = win.length ? win.reduce(function (t, v) { return t + v; }, 0) / win.length : 0;
      // only real darkness or a burnt-out fabric stops the photo; bright paper is normal over dark cloth
      var torchHint = track && track.getCapabilities && track.getCapabilities().torch ? ' (⚡)' : '';
      out.light = { ok: white > 0.3 && wmean > 0.03 && wmean < 0.975, hint: white <= 0.3 ? 'Too dark — more light' + torchHint : wmean >= 0.975 ? 'Glare on the fabric — move the light' : 'The fabric is too dark — more light' + torchHint };
      out.print = fp;
      // sharpness of the window, from the full-resolution video
      var a = KS.apply(H, reg[0] + (reg[1] - reg[0]) * 0.1, reg[2] + (reg[3] - reg[2]) * 0.1), b = KS.apply(H, reg[1] - (reg[1] - reg[0]) * 0.1, reg[3] - (reg[3] - reg[2]) * 0.1), sx = vw / sw;
      var x0 = Math.max(0, Math.min(a[0], b[0]) * sx), y0 = Math.max(0, Math.min(a[1], b[1]) * sx), wv = Math.abs(b[0] - a[0]) * sx * 0.5, hv = Math.abs(b[1] - a[1]) * sx * 0.5;
      x0 += wv * 0.5; y0 += hv * 0.5;                                   // the middle of the fabric area
      cg.drawImage(video, x0, y0, wv, hv, 0, 0, 192, 192);
      var d2 = cg.getImageData(0, 0, 192, 192).data, gs = KS.toGray(d2, 192, 192), e = 0, m = 0, m2 = 0;
      for (var i = 0; i < gs.length; i++) { m += gs[i]; m2 += gs[i] * gs[i]; }
      m /= gs.length; var varc = Math.max(1e-5, m2 / gs.length - m * m);
      for (var y = 1; y < 191; y++) for (var x = 1; x < 191; x++) { var k = y * 192 + x, l = 4 * gs[k] - gs[k - 1] - gs[k + 1] - gs[k - 192] - gs[k + 192]; e += l * l; }
      var sharp = e / (190 * 190) / varc;
      if (out.steady.ok) sharpBest = Math.max(sharpBest * 0.995, sharp);
      // loops counted on the live video means the picture is sharp enough already
      var loopsSeen = live && !live.error && live.regularity > 0.28 && Date.now() - live.t < 2500;
      out.sharp = { ok: loopsSeen || (sharp >= sharpBest * 0.75 && sharpBest > 0), hint: 'Focusing…', value: sharp };
      prev = c;
      // the loops themselves, counted on the video every few looks
      var pxmmVideo = det.pxPerMm * vw / sw;
      if (pxmmVideo < LIVE_MIN_PXMM) out.loops = { ok: true, pending: true, hint: null };
      else {
        if (tickN % LOOP_EVERY === 0 && out.steady.ok) {
          try {
            var k = Math.min(1, 1920 / Math.max(vw, vh)), fw = Math.round(vw * k), fh = Math.round(vh * k);
            if (fullCanvas.width !== fw) { fullCanvas.width = fw; fullCanvas.height = fh; }
            fg.drawImage(video, 0, 0, fw, fh);
            var fgray = KS.toGray(fg.getImageData(0, 0, fw, fh).data, fw, fh), fs = fw / sw;
            var pick = KS.findFabric(fgray, fw, fh, c.map(function (p) { return [p[0] * fs, p[1] * fs]; }), det.pxPerMm * fs, { maxPxPerMm: 10, maxN: 256 });
            live = pick.error ? { error: pick.error, code: pick.code, t: Date.now() } : { wpc: pick.m.wpc, cpc: pick.m.cpc, regularity: pick.m.regularity, confidence: pick.m.confidence, at: pick.name, region: pick.region, flat: pick.flat, m: pick.m, t: Date.now() };
          } catch (e) { live = { error: e.message, t: Date.now() }; }
        }
        var fresh = live && Date.now() - live.t < 2500;
        out.loops = fresh && !live.error && live.regularity > 0.28
          ? { ok: true, wpc: live.wpc, cpc: live.cpc, live: live }
          : { ok: false, hint: fresh && live.error ? (live.code === 'no_fabric' ? 'No fabric seen — cut the window, or lay the card beside the fabric' : 'Loops not clear — hold steady, closer, more light') : 'Reading the loops…' };
      }
      return out;
    }

    function corr(a, b) {
      if (!a || !b || a.length !== b.length || a.length < 10) return 0;
      var ma = 0, mb = 0, n = a.length, i;
      for (i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
      ma /= n; mb /= n;
      var s = 0, sa = 0, sb = 0;
      for (i = 0; i < n; i++) { s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) * (a[i] - ma); sb += (b[i] - mb) * (b[i] - mb); }
      return sa && sb ? s / Math.sqrt(sa * sb) : 0;
    }

    // ── drawing the guide ─────────────────────────────────────────────
    function draw(L, state) {
      var W = ov.clientWidth, Hh = ov.clientHeight, dpr = window.devicePixelRatio || 1;
      if (ov.width !== Math.round(W * dpr)) { ov.width = Math.round(W * dpr); ov.height = Math.round(Hh * dpr); }
      var g = ov.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, Hh);
      var col = state === 'ok' ? '#2BD47D' : state === 'warn' ? '#FFB020' : '#ffffffcc';
      // the video as shown (object-fit: contain), and the target box inside it
      var vw0 = video.videoWidth || W, vh0 = video.videoHeight || Hh, s0 = Math.min(W / vw0, Hh / vh0);
      var rw = vw0 * s0, rh = vh0 * s0, rx = (W - rw) / 2, ry = (Hh - rh) / 2;
      var box = Math.min(rw, rh) * 0.72, bx = rx + (rw - box) / 2, by = ry + (rh - box) / 2, arm = box * 0.12;
      g.lineWidth = 4; g.strokeStyle = L && L.found ? '#ffffff55' : col; g.lineCap = 'round';
      [[bx, by, 1, 1], [bx + box, by, -1, 1], [bx + box, by + box, -1, -1], [bx, by + box, 1, -1]].forEach(function (k) {
        g.beginPath(); g.moveTo(k[0] + k[2] * arm, k[1]); g.lineTo(k[0], k[1]); g.lineTo(k[0], k[1] + k[3] * arm); g.stroke();
      });
      if (!L || !L.found) return;
      // the card as seen, mapped from the small frame to the screen (object-fit: contain)
      var s = Math.min(W / L.vw, Hh / L.vh), ox = (W - L.vw * s) / 2, oy = (Hh - L.vh * s) / 2, f = L.vw / L.sw;
      var Hm = KS.homography(KS.CARD.markers, L.det.corners);
      var map = function (mx, my) { var q = KS.apply(Hm, mx, my); return [q[0] * f * s + ox, q[1] * f * s + oy]; };
      g.lineWidth = 3; g.strokeStyle = col; g.fillStyle = state === 'ok' ? '#2BD47D33' : '#ffffff14';
      var win = [map(15, 15), map(55, 15), map(55, 55), map(15, 55)];
      g.beginPath(); win.forEach(function (p, i) { if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); g.closePath(); g.fill(); g.stroke();
      var frame = [map(0, 0), map(70, 0), map(70, 70), map(0, 70)];
      g.setLineDash([8, 6]); g.lineWidth = 2;
      g.beginPath(); frame.forEach(function (p, i) { if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); g.closePath(); g.stroke();
      g.setLineDash([]);
      L.det.corners.forEach(function (c) { var p = [c[0] * f * s + ox, c[1] * f * s + oy]; g.beginPath(); g.arc(p[0], p[1], 9, 0, Math.PI * 2); g.fillStyle = col; g.fill(); });
      if (L.loops && L.loops.live && L.loops.live.flat) drawLoops(g, L.loops.live, map);
      if (L.distance) {
        var t = '≈ ' + L.distance.cm.toFixed(0) + ' cm · ' + L.distance.pxmm.toFixed(0) + ' px/mm';
        var c0 = map(35, 72);
        g.font = '600 14px system-ui, sans-serif'; g.textAlign = 'center';
        var tw = g.measureText(t).width + 16;
        g.fillStyle = '#000a'; g.fillRect(c0[0] - tw / 2, c0[1] + 4, tw, 24);
        g.fillStyle = '#fff'; g.fillText(t, c0[0], c0[1] + 21);
      }
    }

    // the counted grid, drawn over the fabric where it was counted (every 2nd line, so it stays legible)
    function drawLoops(g, lv, map) {
      var f = lv.flat, reg = lv.region, P = f.pxPerMm, G = KS.grid(f, lv.m);
      var toMm = function (x, y) { return map(reg[0] + x / P, reg[2] + y / P); };
      var clip = function (px, py, dx, dy) {          // the line through (px,py) along (dx,dy), inside the flat box
        var t0 = -1e9, t1 = 1e9;
        [[px, dx, f.w], [py, dy, f.h]].forEach(function (a) {
          if (Math.abs(a[1]) < 1e-9) { if (a[0] < 0 || a[0] > a[2]) { t0 = 1; t1 = 0; } return; }
          var ta = (0 - a[0]) / a[1], tb = (a[2] - a[0]) / a[1];
          t0 = Math.max(t0, Math.min(ta, tb)); t1 = Math.min(t1, Math.max(ta, tb));
        });
        return t1 > t0 ? [[px + dx * t0, py + dy * t0], [px + dx * t1, py + dy * t1]] : null;
      };
      g.lineWidth = 1.2;
      [[G.wale, '#00E5D0'], [G.course, '#FFB020']].forEach(function (pair) {
        var Ln = pair[0], n = Math.ceil(Math.hypot(f.w, f.h) / Ln.spacing) + 2;
        g.strokeStyle = pair[1]; g.globalAlpha = 0.85;
        for (var k = -n; k <= n; k += 2) {
          var d = Ln.offset + k * Ln.spacing, seg = clip(Ln.normal[0] * d, Ln.normal[1] * d, Ln.dir[0], Ln.dir[1]);
          if (!seg) continue;
          var a = toMm(seg[0][0], seg[0][1]), b = toMm(seg[1][0], seg[1][1]);
          g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
        }
      });
      g.globalAlpha = 1;
      var lab = map((reg[0] + reg[1]) / 2, reg[2]), txt = lv.wpc.toFixed(1) + ' wales · ' + lv.cpc.toFixed(1) + ' courses /cm';
      g.font = '700 14px system-ui, sans-serif'; g.textAlign = 'center';
      var tw = g.measureText(txt).width + 14;
      g.fillStyle = '#00000099'; g.fillRect(lab[0] - tw / 2, lab[1] - 26, tw, 22);
      g.fillStyle = '#fff'; g.fillText(txt, lab[0], lab[1] - 10);
    }

    function setRing(fr) { ring.setAttribute('stroke-dashoffset', String(226 * (1 - Math.max(0, Math.min(1, fr))))); }

    // ── the loop ──────────────────────────────────────────────────────
    function loop() {
      if (closed) return;
      timer = setTimeout(loop, TICK_MS);
      if (busy || !steps[stepIx]) return;
      var L;
      try { L = look(); } catch (e) { L = null; }
      if (!L) return;
      tickN++;
      var names = [['found', 'Card'], ['distance', 'Distance'], ['straight', 'Straight'], ['steady', 'Steady'], ['sharp', 'Sharp'], ['light', 'Light'], ['loops', 'Loops']];
      var allOk = L.found && names.slice(1).every(function (n) { return L[n[0]] && L[n[0]].ok; });
      lastState = names.map(function (n) { return n[1] + ':' + (n[0] === 'found' ? L.found : !!(L[n[0]] && L[n[0]].ok)); }).join(' ');
      // waiting for a new spot after a photo
      if (!armed) {
        if (!L.found) lostTicks++; else lostTicks = 0;
        if (L.found && L.steady && !L.steady.ok) movedSince = true;
        var c = corr(L.print, lastPrint);
        if (lostTicks >= 3 || (L.found && c < 0.55) || (movedSince && Date.now() - capturedAt > 4000)) { armed = true; sharpBest = 0; }
      }
      checksEl.innerHTML = names.map(function (n) {
        var ok = n[0] === 'found' ? L.found : L[n[0]] && L[n[0]].ok;
        var extra = n[0] === 'distance' && L.distance ? ' ≈' + L.distance.cm.toFixed(0) + ' cm' : n[0] === 'loops' && L.loops && L.loops.wpc ? ' ' + L.loops.wpc.toFixed(1) + '×' + L.loops.cpc.toFixed(1) : n[0] === 'loops' && L.loops && L.loops.pending ? ' (in photo)' : '';
        return '<span class="' + (ok ? 'ok' : L.found ? 'bad' : '') + '">' + (ok ? '✓ ' : '') + n[1] + extra + '</span>';
      }).join('');
      if (!armed) {
        okTicks = 0; setRing(0); draw(L, 'idle');
        say(steps[stepIx].kind === 'back' ? 'Turn the fabric over — back side up' : 'Move the card to another place on the fabric');
        return;
      }
      if (!L.found) { okTicks = 0; setRing(0); draw(L, 'idle'); say('Point at the scan card — all four black squares'); return; }
      if (allOk) {
        okTicks++;
        setRing(okTicks / HOLD_TICKS);
        draw(L, 'ok');
        say(okTicks >= HOLD_TICKS ? 'Capturing…' : 'Perfect — hold still', 'ok');
        if (okTicks >= HOLD_TICKS) { okTicks = 0; capture(false, L); }
        return;
      }
      okTicks = 0; setRing(0); draw(L, 'warn');
      var first = names.slice(1).filter(function (n) { return !(L[n[0]] && L[n[0]].ok); })[0];
      say(first ? (L[first[0]].hint || first[1]) : 'Hold still', 'warn');
    }

    // ── taking the photo ─────────────────────────────────────────────
    function grabVideo() {
      var vw = video.videoWidth, vh = video.videoHeight, k = Math.min(1, MAX_SIDE / Math.max(vw, vh));
      var c = document.createElement('canvas'); c.width = Math.round(vw * k); c.height = Math.round(vh * k);
      var g = c.getContext('2d'); g.drawImage(video, 0, 0, c.width, c.height);
      return { rgba: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height, source: 'video ' + vw + '×' + vh };
    }
    function grabPhoto() {
      if (!imageCapture || !imageCapture.takePhoto) return Promise.resolve(grabVideo());
      return imageCapture.takePhoto().then(function (blob) { return createImageBitmap(blob); }).then(function (bm) {
        var k = Math.min(1, MAX_SIDE / Math.max(bm.width, bm.height));
        var c = document.createElement('canvas'); c.width = Math.round(bm.width * k); c.height = Math.round(bm.height * k);
        c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height);
        var o = { rgba: c.getContext('2d').getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height, source: 'photo ' + bm.width + '×' + bm.height };
        bm.close && bm.close();
        return o;
      }).catch(function () { return grabVideo(); });
    }
    function capture(manual, L) {
      var st = steps[stepIx];
      if (!st) return;
      busy = true;
      say('Hold still…', 'ok');
      var fl = root.querySelector('.kc-flash');
      fl.classList.add('go'); setTimeout(function () { fl.classList.remove('go'); }, 60);
      if (navigator.vibrate) navigator.vibrate(40);
      grabPhoto().then(function (img) {
        say('Measuring the loops…', 'ok');
        return new Promise(function (ok) { setTimeout(function () { ok(img); }, 20); });
      }).then(function (img) { return opts.onCapture(st.kind, img); }).then(function (res) {
        busy = false; setRing(0);
        if (!res || !res.ok) {
          say('Retake: ' + ((res && res.error) || 'not measurable'), 'warn');
          armed = false; movedSince = true; capturedAt = Date.now() - 2600;    // a short pause, then try again where it is
          lastPrint = L ? L.print : null;
          return;
        }
        if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
        say('✓ ' + (res.note || 'Captured'), 'ok');
        lastPrint = L ? L.print : null; armed = false; movedSince = false; capturedAt = Date.now(); lostTicks = 0;
        setTimeout(next, 900);
      }).catch(function (e) { busy = false; say('Retake: ' + e.message, 'warn'); });
    }
    function next() {
      stepIx++;
      setStepUI();
      if (stepIx >= steps.length) { say('All done', 'ok'); setTimeout(function () { close(true); }, 700); }
    }
    return { close: close };
  }

  root.KAScanCamera = { open: open };
})(typeof self !== 'undefined' ? self : this);
