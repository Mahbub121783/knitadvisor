// KnitAdvisor · Fabric Studio — the knitting cycle of one needle, seen in
// section, for any cell of the drawn programme.
//
// The cycle of a latch needle on a circular machine (Spencer, Knitting
// Technology, the eight positions of the latch-needle cycle):
//   1 rest            the old loop sits in the closed hook, the sinker forward
//                     holds it in its throat
//   2 latch opening   the raising cam lifts the needle; the sinker holds the
//                     old loop down, so it slides inside the hook and turns the
//                     latch open
//   3 clearing        the old loop slides off the latch spoon onto the stem
//   4 yarn feeding    the needle starts down; the feeder lays the new yarn
//                     into the open hook; the sinker draws back
//   5 latch closing   the old loop meets the underside of the latch and
//                     closes it on the hook, trapping the new yarn
//   6 knock-over      the hook passes below the sinker belly: the old loop
//                     slides over the closed latch and off the needle
//   7 loop length     the stitch cam draws the hook to its lowest point; the
//                     new loop is pulled through the old one over the belly —
//                     the depth of this cam sets the stitch length
//   8 holding down    the needle rises back to rest, the sinker comes forward
//                     and holds the new loop in its throat
// A tuck is raised only to tuck height: the old loop stays on the latch spoon,
// slides back into the hook and the needle comes down holding both. A miss is
// not raised: the hook stays below the yarn line and the yarn floats behind.
// A transfer needle is raised higher still and hands its loop to its
// neighbour over the transfer spring.
// On a double bed there is no sinker: each bed knocks over across the edge
// of its trick wall (the verge) and the other bed holds the fabric.
//
// Plain script: window.KAStudioNeedle = { Cycle, renderTypes }.
(function (root) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var BELLY = 268;          // sinker belly = knock-over line (world y)
  var NX = 330;             // needle centre line
  var YT = BELLY - 7;       // where the sinker throat holds a loop
  var STITCH = 18;          // stitch cam depth below the belly (drawn)

  var PHASES = [
    { k: 'rest', t: 0.00, name: 'Rest' },
    { k: 'open', t: 0.10, name: 'Latch opening' },
    { k: 'clear', t: 0.28, name: 'Clearing' },
    { k: 'feed', t: 0.42, name: 'Yarn feeding' },
    { k: 'close', t: 0.55, name: 'Latch closing' },
    { k: 'knock', t: 0.65, name: 'Knock-over' },
    { k: 'form', t: 0.74, name: 'Loop length' },
    { k: 'hold', t: 0.84, name: 'Holding down' },
  ];

  var TEXT_R = {
    rest: 'The needle is at rest with its loop in the hook.',
    open: 'The transfer cam lifts the needle above clearing height.',
    clear: 'The loop opens the transfer spring on the side of the needle that faces the other bed.',
    feed: 'The needle opposite, on the other bed, is pushed out into the spring and takes the loop.',
    close: 'This needle comes down empty; its loop now hangs on the other bed.',
    knock: 'Nothing is knocked over here: the needle has no loop.',
    form: 'The wale goes on on the other bed: a face stitch becomes a reverse stitch (or a rib wale becomes jersey).',
    hold: 'Transfers between the beds are made on double jersey transfer machines and on flat machines: rib-to-jersey changes and purl-like effects.',
  };
  var TEXT = {
    K: {
      rest: 'The needle is at rest; the loop it knitted last time sits in the closed hook. The sinker is forward and holds that loop in its throat.',
      open: 'The raising cam lifts the needle. The sinker holds the old loop down, so it slides inside the hook and turns the latch open.',
      clear: 'Clearing height: the old loop has slid off the latch spoon onto the stem, below the latch. Only a knitting needle reaches this height.',
      feed: 'The needle starts down the stitch cam. The feeder lays the new yarn into the open hook; the sinker draws back so the yarn lies on its belly.',
      close: 'The old loop, still held on the stem, meets the underside of the latch and swings it shut on the hook — the new yarn is trapped inside.',
      knock: 'The hook drops below the sinker belly: the old loop slides over the closed latch and off the needle. It is now part of the fabric.',
      form: 'The stitch cam draws the hook to its lowest point and pulls the new loop through the old one, over the belly. This depth sets the stitch length (loop length).',
      hold: 'The needle rises back to rest and the sinker comes forward, holding the new loop in its throat while the fabric is taken down. The new loop is the old loop of the next cycle.',
    },
    T: {
      rest: 'The needle is at rest with its loop(s) in the hook; the sinker holds them in its throat.',
      open: 'The tuck cam lifts the needle — but only to tuck height. The old loop slides inside the hook and opens the latch.',
      clear: 'Tuck height: the old loop has reached the latch spoon but NOT the stem. It is not cleared.',
      feed: 'The needle comes down. The feeder lays the new yarn into the open hook beside the old loop.',
      close: 'Because the old loop never got below the latch, it slides back into the hook instead of closing the latch from below.',
      knock: 'Hook and latch pass below the belly with BOTH loops inside — nothing is knocked over.',
      form: 'The stitch cam draws the needle down holding the old loop and the new tuck loop together. The tuck loop forms an open arch, no new stitch.',
      hold: 'Back to rest holding two loops (or more after more tucks). They are knocked over together the next time this needle knits — the held loop grows long, which is what gives piqué its texture.',
    },
    M: {
      rest: 'The needle is at rest with its loop in the hook.',
      open: 'No cam lifts this needle (its butt is in a missing track, or it is not selected). It stays down.',
      clear: 'The neighbouring needles rise to clearing; this one stays below the yarn line.',
      feed: 'The feeder lays the yarn at the height of the raised needles — above this hook. The yarn passes behind the needle.',
      close: 'Nothing changes on this needle: its latch stays shut over the old loop.',
      knock: 'No knock-over. The old loop stays on the needle and is held one more course.',
      form: 'The yarn lies straight behind the needle: a float (a miss stitch) on the technical back.',
      hold: 'The old loop is held and stretches over the extra course; the next knit clears it. Floats make the fabric narrower and less extensible.',
    },
    E: {
      rest: 'The needle is at rest with its loop in the hook.',
      open: 'The transfer cam lifts the needle higher than clearing height.',
      clear: 'The loop opens the transfer spring on the side of the needle.',
      feed: 'The receiving needle beside it enters the spring and takes the loop.',
      close: 'This needle comes down empty; the loop now sits on its neighbour.',
      knock: 'Nothing is knocked over here: the needle has no loop.',
      form: 'At the next feed this empty needle starts a fresh loop with no old loop to pull through — the eyelet opens.',
      hold: 'Transfers are how pointelle eyelets are made (flat machines and pointelle circular machines with transfer needles).',
    },
  };

  // needle lift above rest (px) through the cycle, by stitch
  function lift(sym, t) {
    var top = sym === 'K' ? 66 : sym === 'T' ? 40 : sym === 'E' || sym === 'R' ? 90 : 0;
    if (sym === 'M' || sym === '-') return 0;
    var seg = [[0, 0], [0.10, 0], [0.28, top * 0.5], [0.36, top], [0.42, top], [0.55, top * 0.45], [0.65, top * 0.12],
      [0.70, -8], [0.80, -STITCH], [0.84, -STITCH], [1.0, 0]];
    for (var i = 1; i < seg.length; i++) {
      if (t <= seg[i][0]) {
        var a = seg[i - 1], b = seg[i], u = (t - a[0]) / (b[0] - a[0] || 1);
        u = u * u * (3 - 2 * u);
        return a[1] + (b[1] - a[1]) * u;
      }
    }
    return 0;
  }
  // sinker: 1 forward (nib over the needle), 0 back
  function sinkerFwd(t) {
    if (t < 0.40) return 1;
    if (t < 0.50) return 1 - (t - 0.40) / 0.10;
    if (t < 0.80) return 0;
    if (t < 0.92) return (t - 0.80) / 0.12;
    return 1;
  }
  var phaseAt = function (t) { var p = PHASES[0]; PHASES.forEach(function (q) { if (t >= q.t) p = q; }); return p; };

  /**
   * One needle's cycle, animated.
   * @param host     element to draw in
   * @param get      () => { sym, held, double, bed, feedRole, colour, label }
   */
  function Cycle(host, get, onPhase) {
    this.host = host; this.get = get; this.onPhase = onPhase || function () {};
    this.t = 0; this.playing = true; this.speed = 0.6; this.raf = null; this.last = null;
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 900 520'); svg.setAttribute('width', '100%');
    svg.style.display = 'block'; svg.style.maxHeight = '560px';
    svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Knitting cycle of one needle');
    host.innerHTML = ''; host.appendChild(svg);
    this.svg = svg;
    var self = this;
    this._tick = function (ts) { self._frame(ts); };
  }
  Cycle.prototype.start = function () { if (!this.raf) this.raf = requestAnimationFrame(this._tick); };
  Cycle.prototype.stop = function () { if (this.raf) cancelAnimationFrame(this.raf); this.raf = null; this.last = null; };
  Cycle.prototype.toggle = function () { this.playing = !this.playing; return this.playing; };
  Cycle.prototype.seek = function (t) { this.t = ((t % 1) + 1) % 1; this.draw(); };
  Cycle.prototype.stepPhase = function (dir) {
    var i = PHASES.indexOf(phaseAt(this.t)) + (dir || 1);
    i = (i + PHASES.length) % PHASES.length;
    this.playing = false; this.seek(PHASES[i].t + 0.02);
    return this.playing;
  };
  Cycle.prototype._frame = function (ts) {
    if (this.last == null) this.last = ts;
    var dt = Math.min(64, ts - this.last); this.last = ts;
    if (this.playing) this.t = (this.t + dt / 1000 * 0.11 * this.speed) % 1;
    this.draw();
    this.raf = requestAnimationFrame(this._tick);
  };

  Cycle.prototype.draw = function () {
    var d = this.get() || {};
    var sym = d.sym || 'K', t = this.t, dbl = !!d.double;
    var yc = d.colour || '#1857C4', oc = '#868C94';
    var h = lift(sym, t);
    var tip = BELLY - 18 - h;                  // hook top, world y
    var seat = tip + 9;                         // where a loop sits inside the hook
    var sf = dbl ? 0 : sinkerFwd(t);
    var sx = NX - 34 + 28 * sf;                 // sinker front x
    var ph = phaseAt(t);
    var held = Math.max(1, d.held || 1);         // loops on the needle before this feed

    // ── where the old loop is, and the latch angle (0 closed, 1 open) ──
    var rising = t < 0.42, oldY, latch, oldOn = true, castT = 0;
    var relOf = function (y) { return y - tip; };   // local y down the needle
    if (sym === 'R') sym = 'E', d = Object.assign({}, d, { toBed: true });
    if (sym === 'K' || sym === 'E') {
      oldY = h > 0 || t < 0.1 ? YT : seat;
      var rel = relOf(oldY);
      if (rising) latch = Math.max(0, Math.min(1, (rel - 12) / 26));
      else latch = t < 0.62 ? Math.max(0, Math.min(1, (rel - 38) / 28)) : 0;
      if (sym === 'K' && t >= 0.66) { oldOn = false; castT = Math.min(1, (t - 0.66) / 0.14); }
      if (sym === 'E' && t >= 0.36) { oldOn = false; castT = Math.min(1, (t - 0.36) / 0.12); }
    } else if (sym === 'T') {
      oldY = rising ? Math.max(YT, Math.min(seat, YT)) : Math.max(YT, seat);
      if (t < 0.1) oldY = seat;
      var relT = relOf(oldY);
      latch = rising ? Math.max(0, Math.min(1, (relT - 12) / 26)) : (t < 0.7 ? Math.max(0, Math.min(1, (relT - 8) / 26)) : 0);
      if (t > 0.42) oldY = Math.max(YT, seat);
    } else {
      oldY = seat; latch = 0;
    }

    // the new yarn is caught once the descending hook passes the yarn line
    var caught = (sym === 'K' || sym === 'T') && t >= 0.47;
    var yarnLineY = BELLY - 58;                 // height the feeder lays the yarn at

    var s = '';
    // backdrop: needle trick wall
    s += '<rect x="0" y="0" width="900" height="520" fill="#fbfcfd"/>';
    // the machine, in section, drawn 1.55 x so hook, latch and loops read clearly
    s += '<g transform="translate(-212,-92) scale(1.55)">';
    s += '<rect x="' + (NX + 6) + '" y="' + (BELLY - 4) + '" width="70" height="140" fill="#e7eaee"/>';
    // knock-over line
    s += '<line x1="40" x2="' + (NX + 76) + '" y1="' + BELLY + '" y2="' + BELLY + '" stroke="#9aa1aa" stroke-dasharray="3 3"/>';
    s += '<text x="' + (NX + 80) + '" y="' + (BELLY + 4) + '" font-size="10" fill="#6b7280">← ' + (dbl ? 'knock-over (trick verge)' : 'knock-over level') + '</text>';

    // fabric hanging below, pulled down by the take-down
    s += '<path d="M' + (NX - 40) + ' ' + (BELLY + 26) + ' C ' + (NX - 46) + ' ' + (BELLY + 70) + ' ' + (NX - 52) + ' 360 ' + (NX - 56) + ' 398" stroke="' + oc + '" stroke-width="10" fill="none" stroke-linecap="round" opacity=".55"/>';
    for (var k = 0; k < 5; k++) s += '<ellipse cx="' + (NX - 44 - k * 3) + '" cy="' + (BELLY + 36 + k * 22) + '" rx="9" ry="3" fill="none" stroke="#6b7280" stroke-width="1.4" opacity=".7"/>';
    s += '<text x="' + (NX - 140) + '" y="390" font-size="10" fill="#6b7280">fabric → take-down</text>';

    // sinker (single jersey)
    if (!dbl) {
      var p = function (x, y) { return (sx + x) + ' ' + (BELLY + y); };
      s += '<path d="M' + p(-150, 26) + ' L' + p(0, 26) + ' L' + p(0, 0) + ' L' + p(-14, 0) + ' L' + p(-14, -10) + ' L' + p(8, -10) + ' L' + p(8, -17) + ' L' + p(-30, -42) + ' L' + p(-150, -42) + ' Z" fill="#c9ced6" stroke="#59606b" stroke-width="1.2"/>';
      s += '<text x="' + Math.max(150, sx - 120) + '" y="' + (BELLY - 20) + '" font-size="11" font-weight="600" fill="#3f4650">sinker</text>';
      s += '<text x="' + (sx - 60) + '" y="' + (BELLY - 46) + '" font-size="9" fill="#6b7280">nib</text>';
      s += '<text x="' + (sx - 60) + '" y="' + (BELLY + 18) + '" font-size="9" fill="#6b7280">belly · throat</text>';
    }

    // feeder (yarn guide)
    var fx = NX + 120, fy = BELLY - 150;
    s += '<path d="M' + (fx - 12) + ' ' + (fy - 30) + ' L' + (fx + 12) + ' ' + (fy - 30) + ' L' + (fx + 5) + ' ' + fy + ' L' + (fx - 5) + ' ' + fy + ' Z" fill="#9aa1aa"/>';
    s += '<text x="' + (fx + 16) + '" y="' + (fy - 14) + '" font-size="10" fill="#3f4650">feeder' + (d.feedRole ? ' · ' + d.feedRole : '') + '</text>';

    // the new yarn
    var belly = dbl ? NX - 26 : sx - 4;
    if (sym === 'M') {
      // laid at the raised needles' height: passes behind this needle
      s += '<path d="M' + fx + ' ' + fy + ' L' + (NX + 10) + ' ' + yarnLineY + ' L' + (NX - 10) + ' ' + yarnLineY + ' L' + (belly - 30) + ' ' + (BELLY - 2) + '" stroke="' + yc + '" stroke-width="2.6" fill="none" stroke-dasharray="' + (t > 0.42 ? '0' : '5 4') + '"/>';
      if (t > 0.42) s += '<text x="' + (NX + 18) + '" y="' + (yarnLineY - 8) + '" font-size="10" fill="' + yc + '">float — behind the needle</text>';
    } else if (sym === 'E' || sym === '-') {
      // nothing caught
    } else if (!caught) {
      if (t >= 0.40) s += '<path d="M' + fx + ' ' + fy + ' Q ' + (NX + 30) + ' ' + (yarnLineY - 10) + ' ' + (NX - 6) + ' ' + yarnLineY + ' L' + belly + ' ' + (BELLY - 1) + '" stroke="' + yc + '" stroke-width="2.6" fill="none"/>';
    } else {
      // through the hook: two legs, one from the feeder, one over the belly
      var ny = seat;
      s += '<path d="M' + fx + ' ' + fy + ' Q ' + (NX + 20) + ' ' + (ny - 40) + ' ' + (NX - 4) + ' ' + ny + '" stroke="' + yc + '" stroke-width="2.6" fill="none"/>';
      s += '<path d="M' + (NX - 4) + ' ' + ny + ' Q ' + (NX - 14) + ' ' + (Math.min(ny, BELLY) - 6) + ' ' + belly + ' ' + (BELLY - 1) + ' L ' + (belly - 34) + ' ' + (BELLY + 4) + '" stroke="' + yc + '" stroke-width="2.6" fill="none"/>';
      s += '<ellipse cx="' + (NX - 3) + '" cy="' + ny + '" rx="9" ry="3.2" fill="none" stroke="' + yc + '" stroke-width="2.4"/>';
    }

    // the needle
    var g = '<g transform="translate(' + NX + ',' + tip + ')">';
    g += '<rect x="-2.6" y="2" width="5.2" height="150" rx="1.5" fill="#7b828c"/>';            // stem
    g += '<path d="M2.4 6 Q2.4 -6 -5 -6 Q-12 -6 -12 3 L-12 9" fill="none" stroke="#3b414a" stroke-width="3"/>'; // hook
    // latch: pivot at the rivet, closed onto the hook tip, open lying down the stem
    // closed: from the rivet up onto the hook tip; open: lying back down the front of the stem
    var ang = -109 + latch * 211;              // degrees, 0 = pointing right, y down
    var lx = 30.5 * Math.cos(ang * Math.PI / 180), ly = 30.5 * Math.sin(ang * Math.PI / 180);
    var rvx = -2, rvy = 38;
    g += '<line x1="' + rvx + '" y1="' + rvy + '" x2="' + (rvx + lx) + '" y2="' + (rvy + ly) + '" stroke="#111827" stroke-width="2.4" stroke-linecap="round"/>';
    g += '<circle cx="' + (rvx + lx) + '" cy="' + (rvy + ly) + '" r="2.6" fill="#111827"/>';      // spoon
    g += '<circle cx="' + rvx + '" cy="' + rvy + '" r="2.1" fill="#f3f4f6" stroke="#111827"/>';   // rivet
    g += '<rect x="2.6" y="118" width="10" height="9" fill="#1857C4"/>';                       // butt
    if (sym === 'E') g += '<path d="M2.6 50 Q14 64 2.6 84" fill="none" stroke="#0e7490" stroke-width="2"/>';
    g += '</g>';
    s += g;
    // labels on the needle
    s += '<text x="' + (NX + 16) + '" y="' + (tip + 4) + '" font-size="10" fill="#3f4650">hook</text>';
    s += '<text x="' + (NX + 16) + '" y="' + (tip + 40) + '" font-size="10" fill="#3f4650">latch · rivet</text>';
    s += '<text x="' + (NX + 16) + '" y="' + (tip + 126) + '" font-size="10" fill="#1857C4">butt → cam</text>';

    // old loop(s)
    var oldCol = d.prevColour || oc;
    if (oldOn) {
      for (var q = 0; q < held; q++) {
        var yy = oldY - q * 5;
        s += '<ellipse cx="' + (NX - 3) + '" cy="' + yy + '" rx="9.5" ry="3.4" fill="none" stroke="' + oldCol + '" stroke-width="2.6"/>';
        s += '<path d="M' + (NX - 12) + ' ' + yy + ' Q ' + (NX - 24) + ' ' + (yy + 14) + ' ' + (NX - 40) + ' ' + (BELLY + 26) + '" stroke="' + oldCol + '" stroke-width="2" fill="none" opacity=".8"/>';
      }
    } else if (castT < 1) {
      // knocked over: slides off the hook into the fabric (or onto the neighbour)
      var cx = sym === 'E' ? NX - 3 + 40 * castT : NX - 3 - 37 * castT, cy = sym === 'E' ? tip + 60 : YT + (BELLY + 30 - YT) * castT;
      s += '<ellipse cx="' + cx + '" cy="' + cy + '" rx="9.5" ry="3.4" fill="none" stroke="' + oldCol + '" stroke-width="2.6" opacity="' + (1 - castT * 0.6) + '"/>';
    }

    s += '</g>';
    // cam path of this needle (inset)
    var ix = 640, iy = 250, iw = 250, ih = 120;
    s += '<rect x="' + ix + '" y="' + (iy - 104) + '" width="' + iw + '" height="' + (ih + 46) + '" rx="8" fill="#fff" stroke="#e1e4e8"/>';
    s += '<text x="' + (ix + 10) + '" y="' + (iy - 88) + '" font-size="13" font-weight="600" fill="#3f4650">Cam path of this needle (butt height)</text>';
    var pth = '';
    for (var u = 0; u <= 1.0001; u += 0.01) pth += (u ? ' L' : 'M') + (ix + 10 + u * (iw - 20)) + ' ' + (iy - lift(sym, u) * 0.8);
    s += '<line x1="' + (ix + 10) + '" x2="' + (ix + iw - 10) + '" y1="' + iy + '" y2="' + iy + '" stroke="#c4c9d0" stroke-dasharray="2 3"/>';
    s += '<path d="' + pth + '" fill="none" stroke="' + (sym === 'K' ? '#1857C4' : sym === 'T' ? '#c27a00' : sym === 'E' ? '#0e7490' : '#6b7280') + '" stroke-width="2"/>';
    s += '<circle cx="' + (ix + 10 + t * (iw - 20)) + '" cy="' + (iy - h * 0.8) + '" r="4.5" fill="#111827"/>';
    s += '<text x="' + (ix + 12) + '" y="' + (iy + 30) + '" font-size="10" fill="#6b7280">raising cam → ' + (sym === 'K' ? 'clearing' : sym === 'T' ? 'tuck height' : sym === 'E' ? 'transfer height' : 'no lift') + ' → stitch cam</text><text x="' + (ix + 12) + '" y="' + (iy + 44) + '" font-size="10" fill="#6b7280">stitch cam depth = stitch length</text>';
    PHASES.forEach(function (P, i) {
      var x = ix + 10 + P.t * (iw - 20);
      s += '<line x1="' + x + '" x2="' + x + '" y1="' + (iy - 76) + '" y2="' + (iy + 18) + '" stroke="' + (P === ph ? '#111827' : '#eceef1') + '"/>';
      s += '<text x="' + (x + 2) + '" y="' + (iy + 16) + '" font-size="8" fill="#6b7280">' + (i + 1) + '</text>';
    });

    // phase caption
    s += '<text x="20" y="32" font-size="20" font-weight="700" fill="#111827">' + (PHASES.indexOf(ph) + 1) + ' · ' + ph.name + '</text>';
    s += '<text x="20" y="54" font-size="14" fill="#565C64">' + esc(d.label || '') + '</text>';
    this.svg.innerHTML = s;
    if (this._ph !== ph.k + sym) { this._ph = ph.k + sym; this.onPhase(PHASES.indexOf(ph), ph, (TEXT[sym] || TEXT.M)[ph.k]); }
  };

  function esc(v) { return String(v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ── needle types ──────────────────────────────────────────────────────
  function renderTypes() {
    var lbl = function (x, y, t, c) { return '<text x="' + x + '" y="' + y + '" font-size="10" fill="' + (c || '#565C64') + '">' + t + '</text>'; };
    var stem = function (x, y0, y1) { return '<rect x="' + (x - 3) + '" y="' + y0 + '" width="6" height="' + (y1 - y0) + '" rx="1.5" fill="#7b828c"/>'; };
    var hook = function (x, y) { return '<path d="M' + (x + 3) + ' ' + (y + 8) + ' Q' + (x + 3) + ' ' + (y - 8) + ' ' + (x - 7) + ' ' + (y - 8) + ' Q' + (x - 16) + ' ' + (y - 8) + ' ' + (x - 16) + ' ' + (y + 4) + ' L' + (x - 16) + ' ' + (y + 10) + '" fill="none" stroke="#3b414a" stroke-width="3.2"/>'; };
    var latchC = function (x, y) { return '<line x1="' + (x - 2) + '" y1="' + (y + 42) + '" x2="' + (x - 16) + '" y2="' + (y + 11) + '" stroke="#111" stroke-width="2.6"/><circle cx="' + (x - 2) + '" cy="' + (y + 42) + '" r="2.4" fill="#fff" stroke="#111"/>'; };
    var butt = function (x, y, c) { return '<rect x="' + (x + 3) + '" y="' + y + '" width="12" height="9" fill="' + (c || '#1857C4') + '"/>'; };
    var svg = function (inner, h) { return '<svg viewBox="0 0 240 ' + (h || 170) + '" width="100%" height="' + (h || 170) + '" role="img">' + inner + '</svg>'; };

    var cards = [];
    cards.push(['Latch needle', svg(stem(70, 30, 160) + hook(70, 30) + latchC(70, 30) + butt(70, 128) +
      lbl(96, 26, 'hook — holds the loop') + lbl(96, 46, 'latch spoon') + lbl(96, 74, 'rivet (latch pivot)') + lbl(96, 104, 'stem — the cleared loop') + lbl(96, 136, 'butt — rides in the cam track') + lbl(96, 158, 'tail')),
      'The needle of every circular weft machine in the Studio. It is self-acting: the old loop itself opens the latch on the way up and closes it on the way down, so the cam alone decides knit, tuck or miss for each needle. Wear points: a bent latch or rough hook gives drop stitches and needle lines. One needle per trick; the gauge (E) is needles per inch.']);
    // multi-butt
    var mb = '';
    ['A', 'B', 'C', 'D'].forEach(function (k, i) { var x = 34 + i * 52; mb += stem(x, 24, 158) + hook(x, 24) + latchC(x, 24) + butt(x, 92 + i * 14, ['#1857C4', '#c2410c', '#1E7A54', '#7a4fc2'][i]) + lbl(x - 4, 166, k, '#3f4650'); });
    cards.push(['Multi-butt needles (cam tracks)', svg(mb, 176),
      'The same latch needle made with its butt at one of 2–4 heights. Each butt height runs in its own cam track, and each feeder has a knit, tuck or miss cam in every track — that is how the Studio\'s "Cam & needle set-out" turns your notation into needle order (A B C D …) and cam settings. A repeat wider than the tracks needs a jacquard (selector) machine.']);
    // compound
    cards.push(['Compound needle', svg(stem(70, 34, 160) + '<path d="M73 42 Q73 20 61 20 Q49 20 49 34" fill="none" stroke="#3b414a" stroke-width="3.2"/><rect x="54" y="48" width="5" height="108" fill="#a7adb6"/>' + butt(70, 128) + '<rect x="41" y="140" width="12" height="9" fill="#c2410c"/>' +
      lbl(96, 26, 'open hook') + lbl(96, 60, 'closing element (tongue)') + lbl(96, 76, 'own cam, own butt') + lbl(96, 136, 'hook butt')),
      'Hook and closing element are separate parts moved by two cams. The stroke is short and the yarn is strained less, so it runs faster and finer — mostly warp knitting (tricot, raschel) and some fine-gauge circular machines. Knit, tuck and miss are set by timing the two parts.']);
    // bearded
    cards.push(['Bearded (spring) needle', svg(stem(70, 30, 160) + '<path d="M73 34 Q73 10 58 12 Q46 14 52 34 L62 84" fill="none" stroke="#3b414a" stroke-width="3.2"/><circle cx="68" cy="86" r="3" fill="none" stroke="#111"/><rect x="18" y="76" width="34" height="10" fill="#9aa1aa"/>' +
      lbl(96, 20, 'beard (springy hook)') + lbl(96, 88, 'eye in the stem') + lbl(10, 102, 'presser bar')),
      'One piece of wire. The beard is closed by a presser bar, not by the loop, so needles cannot be selected one by one — patterning is done by cutting the presser. Gentle on the yarn: old loop-wheel (tubular) machines and full-fashioned hosiery.']);
    // transfer
    cards.push(['Transfer (spring) needle', svg(stem(70, 30, 160) + hook(70, 30) + latchC(70, 30) + '<path d="M73 84 Q90 104 73 124" fill="none" stroke="#0e7490" stroke-width="2.6"/>' + butt(70, 136) +
      lbl(96, 100, 'transfer spring', '#0e7490') + lbl(96, 116, '(expansion slot)', '#0e7490')),
      'A latch needle with a side spring. Raised to transfer height, its loop opens the spring and the neighbouring needle (or the other bed) takes the loop: this is the "E" cell in your notation — pointelle eyelets, loop shaping and rib-to-jersey transfers on flat machines and transfer circular machines.']);
    // double-headed
    cards.push(['Double-headed latch needle', svg(stem(70, 34, 156) + hook(70, 34) + latchC(70, 34) + '<g transform="translate(140,174) rotate(180)">' + hook(70, 0) + latchC(70, 0) + '</g>' +
      lbl(96, 30, 'hook + latch, front bed') + lbl(96, 166, 'hook + latch, back bed') + lbl(96, 98, 'moved by sliders, no butt'), 190),
      'Two hooks, one at each end. Sliders in two facing beds pass it from one bed to the other, so one needle can knit a face stitch and then a reverse (purl) stitch in the same wale. Purl (links-links) machines: garter and moss stitches that rib and interlock machines cannot make.']);
    // jacquard / selector
    cards.push(['Needle with selector jack (jacquard)', svg(stem(70, 24, 108) + hook(70, 24) + latchC(70, 24) + butt(70, 86) + '<rect x="66" y="112" width="8" height="56" fill="#a7adb6"/><rect x="74" y="140" width="12" height="9" fill="#c2410c"/>' +
      lbl(96, 92, 'needle butt') + lbl(96, 126, 'selector jack') + lbl(96, 146, 'selected by a magnet / actuator')),
      'Each needle stands on a jack that an electronic actuator (or pattern wheel/drum) pushes in or leaves out at every feeder. Any needle can knit, tuck or miss at any feed — no limit of 2–4 tracks — which is what a wide or irregular repeat in your notation needs.']);
    // sinker
    cards.push(['Sinker (single jersey)', svg('<path d="M30 116 L170 116 L170 90 L156 90 L156 80 L178 80 L178 73 L140 48 L30 48 Z" fill="#c9ced6" stroke="#59606b"/>' + stem(198, 20, 160) + hook(198, 54) +
      lbl(120, 40, 'nib') + lbl(30, 132, 'belly = knock-over level') + lbl(118, 76, 'throat')),
      'Not a needle but half of every single-jersey stitch. Between each pair of needles a sinker moves in and out: its throat holds the old loop down while the needle rises, and its belly is the surface the new loop is drawn over — so belly height and stitch-cam depth together set the stitch length. Double-jersey (rib, interlock) machines have no sinkers: the two needle beds hold the fabric for each other.']);

    return cards.map(function (c) { return '<figure>' + c[1] + '<figcaption><b>' + c[0] + '</b> — ' + c[2] + '</figcaption></figure>'; }).join('');
  }

  TEXT.R = TEXT_R;
  var api = { Cycle: Cycle, renderTypes: renderTypes, PHASES: PHASES, lift: lift, TEXT: TEXT };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KAStudioNeedle = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
