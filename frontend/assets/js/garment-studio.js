/**
 * KnitAdvisor — Garment studio: the workspace (garment.html)
 *
 * A menu bar; a library on the left (spec sheet, presets, paste, garments); the 3D and the 2D windows in the middle; the object browser and the property editor on
 * the right; measurements, spec check, pieces, sewing, marker and checks below; a status bar. Everything is linked through one selection: click a piece in the 2D window,
 * in the 3D window or in the object browser and it is selected in all three, and its details open in the property editor.
 *
 * The page's state and its engine calls stay in garment.js (window.KAGarment); this file is only the shell:
 *   layout   docks that drag to any width, collapse, remember their size; a UI scale; dark or light; a phone gets one window at a time and the panels as sheets
 *   menus    every command, with its key
 *   objects  pieces, fabric, seams, measures, trims: the lists and the property editor of what is selected
 */
(function () {
  'use strict';
  var LS = 'ka_garment_studio_v1';
  var gs = document.getElementById('gs');
  if (!gs) return;
  var $ = function (id) { return document.getElementById(id); };
  var qa = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var r1 = function (v) { return Math.round(v * 10) / 10; };
  var r2 = function (v) { return Math.round(v * 100) / 100; };
  var K = function () { return window.KAGarment; };
  var phoneMQ = window.matchMedia('(max-width: 760px)');

  // ── icons ──
  var P = {
    'menu': 'M4 6h16M4 12h16M4 18h16', 'upload': 'M12 16V4m0 0l-4 4m4-4l4 4M4 20h16', 'download': 'M12 4v12m0 0l-4-4m4 4l4-4M4 20h16', 'paste': 'M9 4h6v3H9zM7 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1',
    'layers': 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5', 'folder': 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'save': 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
    'camera': 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7', 'undo': 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3', 'redo': 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
    'reset': 'M4 12a8 8 0 1 0 3-6.2M4 4v5h5', 'copy': 'M8 8h11v12H8zM5 16V4h11', 'cube': 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
    'rotate': 'M20 12a8 8 0 1 1-3-6.2M20 4v5h-5', 'user': 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M5 21a7 7 0 0 1 14 0', 'pattern': 'M7 4l5 2 5-2 3 5-3 2v9H7v-9L4 9z',
    'node': 'M5 19L19 5M5 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M19 5m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0', 'fit': 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
    'seam': 'M3 12h3M9 12h3M15 12h3M21 12h0M12 5v4M12 15v4', 'zip': 'M12 3v18M9 6h3M12 9h3M9 12h3M12 15h3M9 18h3', 'scissors': 'M6 7a2.5 2.5 0 1 0 0-.01M6 17a2.5 2.5 0 1 0 0-.01M8 8.5L20 19M8 15.5L20 5',
    'fabric': 'M4 4h16v16H4zM4 9h16M4 14h16M9 4v16M14 4v16', 'ruler': 'M3 15L15 3l6 6L9 21zM7 11l2 2M10 8l2 2M13 5l2 2', 'check': 'M5 13l4 4L19 7', 'split': 'M4 5h16v14H4zM12 5v14',
    'panel-l': 'M4 5h16v14H4zM9 5v14', 'panel-r': 'M4 5h16v14H4zM15 5v14', 'panel-b': 'M4 5h16v14H4zM4 14h16', 'full': 'M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5', 'plus': 'M12 5v14M5 12h14', 'minus': 'M5 12h14',
    'theme': 'M12 3a9 9 0 1 0 0 18z', 'help': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h0',
    'shirt': 'M8 4L3 8l3 3 2-1v10h8V10l2 1 3-3-5-4a4 4 0 0 1-8 0z', 'chev-l': 'M15 6l-6 6 6 6', 'chev-r': 'M9 6l6 6-6 6', 'chev-d': 'M6 9l6 6 6-6', 'chev-u': 'M6 15l6-6 6 6', 'trash': 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13', 'cloth': 'M4 5c3 2 6 2 8 0s5-2 8 0v4c-1 3-1 6 0 10c-3-2-6-2-8 0s-5 2-8 0c1-4 1-7 0-10z', 'body': 'M12 5a2.5 2.5 0 1 0 0-.01M7 21v-7l-3-3 1-3h14l1 3-3 3v7M10 21v-5M14 21v-5', 'hand': 'M8 13V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v7a6 6 0 0 1-6 6h-1a5 5 0 0 1-4-2l-2-3a1.5 1.5 0 0 1 2-2l2 2', 'zin': 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4M11 8v6M8 11h6', 'zout': 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4M8 11h6',
  };
  function icon(n) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (P[n] || '') + '"/></svg>'; }
  function fillIcons(root) { qa('[data-ic]', root).forEach(function (e) { if (!e.firstChild) e.innerHTML = icon(e.getAttribute('data-ic')); }); }

  // ── the layout, kept between visits ──
  var DEF = { viewsWas: 0, left: 300, right: 340, bottom: 270, pe: 46, views: 50, L: 1, R: 1, B: 1, view: 'both', scale: 1, theme: 'dark', ltab: 'spec', otab: 'pieces', btab: 'chart', mode: 'pieces', side: 'insp', full: 0, pv: '3d' };
  var lay = JSON.parse(JSON.stringify(DEF)), fresh = true;
  try { var o = JSON.parse(localStorage.getItem(LS) || 'null'); if (o) { fresh = false; Object.keys(DEF).forEach(function (k) { if (o[k] != null && typeof o[k] === typeof DEF[k]) lay[k] = o[k]; }); } } catch (_) { /* private window */ }
  if (fresh && window.innerWidth < 1100) { lay.R = window.innerWidth < 900 ? 0 : 1; lay.L = 0; }
  function saveLay() { try { localStorage.setItem(LS, JSON.stringify(lay)); } catch (_) { /* private window */ } }
  var rafSize = 0;
  function notifySize() {
    if (rafSize) return;
    rafSize = requestAnimationFrame(function () {
      rafSize = 0;
      var v = K() && K().view && K().view(); if (v && v.resize) v.resize();
      if (lay.mode === 'edit' && window.KAGarmentEdit) window.KAGarmentEdit.fit();
    });
  }
  function topOffset() {
    var h = document.querySelector('.hdr'), t = lay.full || !h ? 0 : h.offsetHeight;
    document.documentElement.style.setProperty('--gm-top', t + 'px');
    if (h) h.style.display = lay.full ? 'none' : '';
  }
  function applyLay() {
    var set = function (k, v) { gs.style.setProperty(k, v); };
    set('--gs-left', lay.left + 'px'); set('--gs-right', lay.right + 'px'); set('--gs-bottom', lay.bottom + 'px'); set('--gs-pe', lay.pe + '%'); set('--gs-views', lay.views + '%'); set('--gs-zoom', lay.scale);
    gs.setAttribute('data-left', lay.L); gs.setAttribute('data-right', lay.R); gs.setAttribute('data-bottom', lay.B); gs.setAttribute('data-view', lay.view); gs.setAttribute('data-theme', lay.theme); gs.setAttribute('data-pv', lay.pv);
    qa('.gs-viewbtns [data-v]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === lay.view); });
    topOffset(); saveLay(); notifySize();
  }
  var toastT = 0;
  function toast(t) { var e = $('gs-toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { e.classList.remove('on'); }, 2600); }

  // ── splitters ──
  function zoom() { return lay.scale || 1; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function splitAction(kind, ev, st) {
    var z = zoom(), work = $('gs-work').getBoundingClientRect(), W = work.width / z;
    if (kind === 'left') { var v = st.v + (ev.clientX - st.x) / z; if (v < 110) { lay.L = 0; } else { lay.L = 1; lay.left = clamp(v, 170, Math.max(220, W * 0.5)); } }
    else if (kind === 'right') { var v2 = st.v - (ev.clientX - st.x) / z; if (v2 < 110) { lay.R = 0; } else { lay.R = 1; lay.right = clamp(v2, 190, Math.max(240, W * 0.55)); } }
    else if (kind === 'bottom') { var H = gs.getBoundingClientRect().height / z, v3 = st.v - (ev.clientY - st.y) / z; if (v3 < 56) { lay.B = 0; } else { lay.B = 1; lay.bottom = clamp(v3, 110, H * 0.7); } }
    else if (kind === 'pe') { var d = $('gs-right').getBoundingClientRect().height / z, v4 = st.v - ((ev.clientY - st.y) / z / d) * 100; lay.pe = clamp(v4, 14, 82); }
    else if (kind === 'views') {
      var c = $('gs-views').getBoundingClientRect(), stacked = getComputedStyle($('gs-views')).flexDirection === 'column';
      var tot = (stacked ? c.height : c.width) / z, dv = ((stacked ? ev.clientY - st.y : ev.clientX - st.x) / z / tot) * 100; lay.views = clamp(st.v + dv, 18, 82);
    }
    applyLay();
  }
  function startVal(kind) { return kind === 'left' ? lay.left : kind === 'right' ? lay.right : kind === 'bottom' ? lay.bottom : kind === 'pe' ? lay.pe : lay.views; }
  function bindSplit(el) {
    var kind = el.getAttribute('data-split'), st = null;
    el.addEventListener('pointerdown', function (e) {
      if (e.button != null && e.button > 0) return;
      st = { x: e.clientX, y: e.clientY, v: startVal(kind) }; el.setPointerCapture(e.pointerId); el.classList.add('drag'); document.body.classList.add('gs-dragging'); if (kind === 'bottom' || kind === 'pe' || (kind === 'views' && getComputedStyle($('gs-views')).flexDirection === 'column')) document.body.classList.add('gs-row'); e.preventDefault();
    });
    el.addEventListener('pointermove', function (e) { if (st) splitAction(kind, e, st); });
    var end = function () { st = null; el.classList.remove('drag'); document.body.classList.remove('gs-dragging', 'gs-row'); };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('dblclick', function () { lay[kind === 'left' ? 'left' : kind === 'right' ? 'right' : kind === 'bottom' ? 'bottom' : kind === 'pe' ? 'pe' : 'views'] = DEF[kind === 'left' ? 'left' : kind === 'right' ? 'right' : kind === 'bottom' ? 'bottom' : kind === 'pe' ? 'pe' : 'views']; if (kind === 'left') lay.L = 1; if (kind === 'right') lay.R = 1; if (kind === 'bottom') lay.B = 1; applyLay(); });
    el.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 60 : 20, d = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -step : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? step : 0; if (!d) return;
      e.preventDefault(); var sign = (kind === 'right' || kind === 'bottom' || kind === 'pe') ? -1 : 1, v = startVal(kind);
      if (kind === 'bottom') lay.bottom = clamp(v - d, 110, 900); else if (kind === 'left') lay.left = clamp(v + d, 170, 700); else if (kind === 'right') lay.right = clamp(v - d, 190, 700); else if (kind === 'pe') lay.pe = clamp(v + sign * d / 8, 14, 82); else lay.views = clamp(v + d / 8, 18, 82);
      applyLay();
    });
  }
  function edges() {
    [['l', 'chev-r', 'Show the library ([)', 'toggle-left'], ['r', 'chev-l', 'Show the object browser ( ] )', 'toggle-right'], ['b', 'chev-u', 'Show the lower panel (\\)', 'toggle-bottom']].forEach(function (x) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'gs-edge ' + x[0]; b.setAttribute('data-do', x[3]); b.title = x[2]; b.setAttribute('aria-label', x[2]); b.innerHTML = '<i>' + icon(x[1]) + '</i>'; gs.appendChild(b);
    });
  }

  // ── menus ──
  function closeMenus() { qa('.gs-menu.open').forEach(function (m) { m.classList.remove('open'); m.firstElementChild.setAttribute('aria-expanded', 'false'); }); }
  function openMenu(m) { closeMenus(); m.classList.add('open'); m.firstElementChild.setAttribute('aria-expanded', 'true'); }
  function bindMenus() {
    var bar = $('gs-menus');
    bar.addEventListener('click', function (e) { var mb = e.target.closest('.gs-mb'); if (!mb) return; var m = mb.parentNode; if (m.classList.contains('open')) closeMenus(); else openMenu(m); e.stopPropagation(); });
    bar.addEventListener('mouseover', function (e) { if (phoneMQ.matches) return; var mb = e.target.closest('.gs-mb'); if (mb && qa('.gs-menu.open').length && !mb.parentNode.classList.contains('open')) openMenu(mb.parentNode); });
    document.addEventListener('click', function (e) { if (!e.target.closest('.gs-menu') && !e.target.closest('#gs-burger')) closeMenus(); });
    bar.addEventListener('keydown', function (e) {
      var open = bar.querySelector('.gs-menu.open'), t = e.target;
      if (e.key === 'Escape') { closeMenus(); if (open) open.firstElementChild.focus(); return; }
      var menus = qa('.gs-menu', bar), items = open ? qa('.gs-mp button', open) : [];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!open) { var m0 = t.closest('.gs-menu'); if (m0) { openMenu(m0); qa('.gs-mp button', m0)[0].focus(); } return; } var i = items.indexOf(t); items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { var cur = t.closest('.gs-menu'); if (!cur) return; e.preventDefault(); var n = menus[(menus.indexOf(cur) + (e.key === 'ArrowRight' ? 1 : -1) + menus.length) % menus.length]; if (open) { openMenu(n); } n.firstElementChild.focus(); }
    });
    $('gs-burger').addEventListener('click', function () { var on = !gs.classList.contains('menu-open'); gs.classList.toggle('menu-open', on); this.setAttribute('aria-expanded', on ? 'true' : 'false'); closeMenus(); });
  }

  // ── what is selected ──
  var sel = { t: 'garment', id: '' }, creating = false, bound3d = false;
  var SWC = { front: 0, back: -6, sleeve: -12, band: -30, cuff: -30, hemband: -30, waistband: -30, pbag: -16, bpocket: -16, front_r: 0, front_l: 0, facing: -18, placket: -18 };
  var editable = function (id) { var o = cur(); return !!(o && o.edit && o.edit[id]); };
  function shade(hex, pct) { var n = parseInt(String(hex).slice(1), 16); if (!isFinite(n)) return '#3d5a80'; var f = function (c) { return clamp(Math.round(c + (pct / 100) * (pct < 0 ? c : 255 - c)), 0, 255); }; return '#' + ((1 << 24) | (f((n >> 16) & 255) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).slice(1); }
  function S() { return K() && K().state(); } function R() { return K() && K().result(); }
  function cur() { var r = R(), s = S(); return r && r.success && s ? (r.by_size.filter(function (o) { return o.size === s.size; })[0] || r.by_size[0]) : null; }
  function pieceOf(id) { var o = cur(); return o ? o.pieces.filter(function (p) { return p.id === id; })[0] : null; }
  function select(t, id, opt) {
    opt = opt || {}; sel = { t: t, id: id || '' };
    if (t === 'piece') { var E = window.KAGarmentEdit && window.KAGarmentEdit.state(); if (E && editable(id) && E.pid !== id) { E.pid = id; E.sel = null; E.pend = null; E.fitFor = ''; if (lay.mode === 'edit') window.KAGarmentEdit.render(); } }
    var tabFor = { piece: 'pieces', fabric: 'fabric', rib: 'fabric', cut: 'fabric', seam: 'seams', measure: 'measures', spec: 'measures', zipper: 'trims', trim: 'trims' }[t];
    if (tabFor && opt.tab !== false) { lay.otab = tabFor; }
    renderOB(); renderPE(); mark();
    if (opt.reveal && !phoneMQ.matches && !lay.R) { lay.R = 1; applyLay(); }
    if (opt.sheet && phoneMQ.matches) setTimeout(function () { sheet('obj'); }, 260);
  }
  function mark() {
    qa('#gm-patterns .gs-pp').forEach(function (g) { g.classList.toggle('sel', sel.t === 'piece' && g.getAttribute('data-piece') === sel.id); });
    var v = K() && K().view && K().view(); if (v && v.highlight) v.highlight(sel.t === 'piece' ? sel.id : sel.t === 'seam' ? 'seam:' + sel.id : sel.t === 'zipper' ? 'zipper' : (sel.t === 'rib' ? 'band' : null));
    qa('#gm-patterns .gs-edge').forEach(function (e) { e.classList.toggle('hot', sel.t === 'seam' && e.getAttribute('data-seam') === sel.id); });
    var t = { garment: 'Garment', piece: (pieceOf(sel.id) || {}).name || 'Piece', fabric: 'Main fabric', rib: 'Neck rib', cut: 'Cutting', seam: ((R() && R().seams && R().seams[sel.id]) || {}).name || 'Seam', measure: 'Measurement', spec: 'Spec measurement', zipper: 'Zipper', trim: 'Trim' }[sel.t] || '';
    $('gs-petitle').textContent = t;
  }

  // ── the object browser ──
  var SEAM_ORDER = ['shoulder', 'armhole', 'underarm', 'neck', 'waistband', 'rise', 'inseam', 'pocket', 'side', 'band_end', 'hem', 'sleeve_hem', 'hemband_end', 'cuff_end', 'cf', 'facing_end', 'facing_edge'];
  function orow(t, id, sw, title, sub, extra) {
    var on = sel.t === t && sel.id === id;
    return '<div class="gs-obr' + (on ? ' sel' : '') + '" role="option" aria-selected="' + on + '" tabindex="0" data-sel="' + t + '" data-id="' + esc(id) + '">' + (sw || '') + '<span class="gs-obt"><b>' + esc(title) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>' + (extra || '') + '</div>';
  }
  function renderOB() {
    var el = $('gs-oblist'), s = S(), r = R(), o = cur(); if (!el) return;
    qa('#gs-otabs button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-ot') === lay.otab); });
    if (!s || !r) { el.innerHTML = '<div class="gs-empty">Loading…</div>'; return; }
    if (!r.success || !o) { el.innerHTML = '<div class="gs-empty">' + esc(r.error || 'The garment is not built yet: the chart needs the chest and the length.') + '</div>'; return; }
    var h = '', col = s.fabric.colour || '#3d5a80';
    if (lay.otab === 'pieces') {
      h += '<div class="gs-obh">Pattern pieces · size ' + esc(o.size) + '</div>';
      o.pieces.forEach(function (p) {
        var ed = o.edit && o.edit[p.id] && o.edit[p.id].edited, man = o.edit && o.edit[p.id] && o.edit[p.id].manual;
        h += orow('piece', p.id, '<span class="gs-obsw" style="background:' + shade(col, SWC[p.id] != null ? SWC[p.id] : 0) + '">' + esc(p.name.charAt(0)) + '</span>', p.name + (p.qty > 1 ? ' × ' + p.qty : ''), 'cut ' + p.cut_w + ' × ' + p.cut_h + ' cm' + (p.rib ? ' · rib' : ''), (man ? '<span class="gs-obtag ed">manual</span>' : ed ? '<span class="gs-obtag ed">edited</span>' : ''));
      });
    } else if (lay.otab === 'fabric') {
      var f = s.fabric;
      h += '<div class="gs-obh">Materials</div>' +
        orow('fabric', 'main', '<span class="gs-obsw" style="background:' + esc(col) + '"></span>', f.name || 'Main fabric', f.gsm + ' GSM · shrinks ' + f.shrink_len_pct + ' / ' + f.shrink_wid_pct + ' %') +
        orow('rib', 'rib', '<span class="gs-obsw" style="background:' + shade(col, -22) + '"></span>', 'Neck rib', 'stretch ' + f.rib_stretch_pct + ' % · ' + (r.consumption ? r.consumption.rib_kg_per_garment + ' kg a garment' : '')) +
        '<div class="gs-obh">Cutting</div>' + orow('cut', 'cut', '<span class="gs-obsw"><i data-ic="scissors"></i></span>', 'Cutting and allowances', 'seam ' + s.opt.seam + ' cm · neck ' + s.opt.neck + ' cm · ease ' + s.opt.ease + ' cm');
    } else if (lay.otab === 'seams') {
      h += '<div class="gs-obh">Seams · ' + (r.sewing ? r1(r.sewing.thread_m) + ' m of thread' : '') + '</div>';
      var sw = {}; (o.sewing && o.sewing.seams || []).forEach(function (q) { sw[q.id] = q; });
      SEAM_ORDER.filter(function (id) { return r.seams[id] && sw[id]; }).forEach(function (id) {
        var c = r.seams[id], q = sw[id];
        h += orow('seam', id, '<span class="gs-obsw"><i data-ic="seam"></i></span>', c.name, c.type + ' · ' + (r.catalogue.stitch[c.type] ? r.catalogue.stitch[c.type].name.replace(/ \(\d+\)/, '') : '') + ' · ' + r1(q.a_len) + ' cm', '<span class="gs-obdot ' + (q.match ? '' : 'warn') + '" title="' + (q.match ? 'the two edges match' : 'the two edges differ') + '"></span>');
      });
    } else if (lay.otab === 'measures') {
      h += '<div class="gs-obh">Drawn from the chart · size ' + esc(o.size) + ' · ' + (s.unit === 'in' ? 'inches' : 'cm') + '</div>';
      var k = s.unit === 'in' ? 1 / 2.54 : 1;
      o.measured.forEach(function (m) { h += orow('measure', m.key, '<span class="gs-obsw"><i data-ic="ruler"></i></span>', m.label.split(',')[0], 'chart ' + r2(m.chart * k) + ' → pattern ' + r2(m.pattern * k) + (m.ok ? '' : ' (' + (m.diff > 0 ? '+' : '') + r2(m.diff * k) + ')'), '<span class="gs-obdot ' + (m.ok ? '' : 'bad') + '"></span>'); });
      var sc = r.spec_check;
      if (sc && sc.rows) {
        var extra = sc.rows.filter(function (x) { return x.how !== 'drawn'; });
        if (extra.length) h += '<div class="gs-obh">From the spec sheet</div>';
        extra.forEach(function (x) { var c = x.sizes[o.size]; h += orow('spec', x.key, '<span class="gs-obsw"><i data-ic="check"></i></span>', x.label, x.how, '<span class="gs-obdot ' + (!c || c.status === 'recorded' ? 'dim' : c.status === 'ok' ? '' : 'bad') + '"></span>'); });
      }
    } else if (lay.otab === 'trims') {
      var z = o.zipper;
      h += '<div class="gs-obh">Zipper</div>' + orow('zipper', 'zip', '<span class="gs-obsw"><i data-ic="zip"></i></span>', z && z.on ? 'Zipper ' + z.standard_cm + ' cm' : 'No zipper', z && z.on ? (z.kind === 'full' ? 'front opening' : 'quarter zip') + ' · ' + z.teeth + ' #' + z.size : 'tick it to put one in the centre front');
      h += '<div class="gs-obh">Bill of materials, one garment</div>';
      r.bom.forEach(function (b, i) { h += orow('trim', String(i), '<span class="gs-obsw"><i data-ic="layers"></i></span>', b.item, b.qty + ' ' + b.unit + (b.spec ? ' · from the spec sheet' : '')); });
    }
    el.innerHTML = h || '<div class="gs-empty">Nothing here yet.</div>'; fillIcons(el);
  }

  // ── the property editor ──
  function pk(label, val, cls) { return '<div class="' + (cls || '') + '"><span>' + esc(label) + '</span><b>' + val + '</b></div>'; }
  function field(label, html) { return '<div class="gs-pf"><label>' + esc(label) + '</label>' + html + '</div>'; }
  function showPB(name) { qa('#gs-pebody > .gs-pb').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-pb') === name); }); }
  function renderPE() {
    var s = S(), r = R(), o = cur(), t = sel.t; if (!s) return;
    var pb = t === 'rib' ? 'fabric' : t === 'spec' ? 'measure' : t;
    if ((t === 'seam' || t === 'piece' || t === 'measure' || t === 'spec' || t === 'trim' || t === 'garment') && (!r || !r.success || !o)) pb = 'garment';
    showPB(pb);
    if (pb === 'garment') {
      var h = '<p class="gs-ph">' + (s.fabric.name ? esc(s.fabric.name) : ({ longsleeve: 'Long-sleeve tee', sweatshirt: 'Sweatshirt', joggers: 'Joggers / trousers', leggings: 'Leggings' })[s.kind] || (s.style === 'shorts' ? 'Shorts' : 'T-shirt, crew neck')) + '</p><p class="gs-ps">' + (o ? 'Size ' + esc(o.size) + (o.m.chest != null ? ' · chest ' + o.m.chest + ' cm flat · length ' + o.m.length + ' cm' : ' · seat ' + o.m.seat_w + ' cm flat · outside leg ' + o.m.outseam + ' cm') : 'Fill in the chest and the length to build the garment.') + '</p>';
      if (r && r.success) { var c = r.consumption, errs = r.checks.filter(function (x) { return x.level === 'error'; }).length, warns = r.checks.filter(function (x) { return x.level === 'warn'; }).length;
        h += '<div class="gs-pk">' + pk('Fabric / garment', c.fabric_per_garment_m + ' m') + pk('Weight', c.gross_kg_per_garment + ' kg') + pk('Marker', c.efficiency_pct + ' %') + pk('Thread', r1(r.sewing.thread_m) + ' m') + pk('Checks', errs ? errs + ' error' + (errs > 1 ? 's' : '') : warns ? warns + ' to look at' : 'all good', errs ? 'bad' : warns ? '' : 'ok') + pk('Pieces', o.pieces.length) + '</div>'; }
      h += '<div class="gs-ik">Document</div><div class="gs-pf"><label>Garment</label><div class="gs-seg gs-segw" id="pe-style"><button type="button" data-do="garment-style" data-g="tee" class="' + (s.style !== 'shorts' ? 'on' : '') + '">T-shirt</button><button type="button" data-do="garment-style" data-g="shorts" class="' + (s.style === 'shorts' ? 'on' : '') + '">Shorts</button></div></div><div class="gs-pf"><label>Units of the chart</label><div class="gs-seg gs-segw"><button type="button" data-unit="cm" class="' + (s.unit !== 'in' ? 'on' : '') + '">cm</button><button type="button" data-unit="in" class="' + (s.unit === 'in' ? 'on' : '') + '">inch</button></div></div>';
      h += '<div class="gs-ik">Quick actions</div><div class="gs-qa"><button type="button" class="gm-btn" data-do="upload">Upload a spec sheet</button><button type="button" class="gm-btn" data-do="presetsave">Save as preset</button><button type="button" class="gm-btn" data-do="dlpat">Download patterns</button><button type="button" class="gm-btn" data-do="snap">Save a picture</button></div>';
      h += '<p class="gs-ps">Click a piece in the 3D window, the 2D window or the object browser: its details open here, with the actions that fit it. A spec sheet dropped in the library fills the chart, the fabric, the stitches and the trims.</p>';
      $('pe-garment').innerHTML = h;
    } else if (pb === 'piece') {
      var p = pieceOf(sel.id); if (!p) { $('pe-piece').innerHTML = '<div class="gs-empty">This piece is not in this size.</div>'; return; }
      var seams = {}; (p.finished_labels || []).forEach(function (l) { var id = K().seamOf[l]; if (id && r.seams[id]) seams[id] = r.seams[id]; });
      var ed = o.edit && o.edit[p.id], isEd = editable(p.id);
      $('pe-piece').innerHTML = '<p class="gs-ph">' + esc(p.name) + (p.qty > 1 ? ' × ' + p.qty : '') + '</p><p class="gs-ps">Size ' + esc(o.size) + (p.rib ? ' · cut from the rib' : ' · cut from the main fabric') + ' · grain along the ' + (p.grain === 'x' ? 'length of the strip' : 'wales') + (ed && ed.manual ? ' · points added or removed: the chart no longer moves it' : ed && ed.edited ? ' · edited by hand' : '') + '</p>' +
        '<div class="gs-pk">' + pk('Finished', p.finished_w + ' × ' + p.finished_h + ' cm') + pk('Cut', p.cut_w + ' × ' + p.cut_h + ' cm') + pk('Cut area', p.cut_area_cm2 + ' cm²') + pk('Quantity', p.qty) + '</div>' +
        '<div class="gs-ik">Seams on this piece</div><div class="gs-chips">' + Object.keys(seams).map(function (id) { return '<button type="button" class="gs-chip gs-chipb" data-sel="seam" data-id="' + id + '">' + esc(seams[id].name) + ' · ' + seams[id].type + '</button>'; }).join('') + '</div>' +
        '<div class="gs-ik">Quick actions</div><div class="gs-qa">' + (isEd ? '<button type="button" class="gm-btn primary" data-do="edit-piece">Edit its points in 2D</button>' : '') + '<button type="button" class="gm-btn" data-do="show3d">Show it on the garment</button>' + (isEd ? '<button type="button" class="gm-btn" data-do="resetpiece">Reset to the chart</button><button type="button" class="gm-btn" data-do="copyall">Copy its edit to all sizes</button>' : '') + '</div>';
    } else if (pb === 'seam') {
      var c2 = r.seams[sel.id], q = (o.sewing.seams || []).filter(function (x) { return x.id === sel.id; })[0];
      if (!c2 || !q) { $('pe-seam').innerHTML = '<div class="gs-empty">This seam is not in this garment.</div>'; return; }
      var cat = r.catalogue.stitch, hem = sel.id === 'hem' || sel.id === 'sleeve_hem';
      $('pe-seam').innerHTML = '<p class="gs-ph">' + esc(c2.name) + '</p><p class="gs-ps">' + esc(q.machine) + ' · the stitch decides the machine and how much thread the seam takes.</p>' +
        field('Stitch (ISO 4915)', '<select data-seam="' + sel.id + '" data-k="type">' + Object.keys(cat).map(function (k) { return '<option value="' + k + '"' + (k === c2.type ? ' selected' : '') + '>' + esc(cat[k].name) + '</option>'; }).join('') + '</select>') +
        field('Seam allowance (cm)' + (hem ? ': a hem has none, its depth is in the drawing' : ''), '<input type="number" min="0" max="5" step="0.1" data-seam="' + sel.id + '" data-k="allowance" value="' + c2.allowance + '"' + (hem ? ' disabled' : '') + '>') +
        '<div class="gs-pk">' + pk('Joins', r1(q.a_len) + ' / ' + r1(q.b_len) + ' cm', q.match ? 'ok' : 'bad') + pk('Thread', r1(q.thread_m) + ' m') + pk('Sewn', r1(q.sewn_cm) + ' cm') + pk('Machine', esc(cat[c2.type].machine)) + '</div>' + (q.match ? '' : '<p class="gs-ps">The two edges differ by ' + r1(q.diff_cm) + ' cm; this seam should differ by about ' + r1(q.expected_diff_cm) + ' cm (ease).</p>');
    } else if (pb === 'measure') {
      var s2 = s, k2 = s2.unit === 'in' ? 1 / 2.54 : 1, u = s2.unit === 'in' ? 'in' : 'cm', key = sel.id, m = o.measured.filter(function (x) { return x.key === key; })[0], sc = r.spec_check && r.spec_check.rows.filter(function (x) { return x.key === key; })[0], cs = sc && sc.sizes[o.size];
      var hh = '<p class="gs-ph">' + esc(m ? m.label : sc ? sc.label : key) + '</p><p class="gs-ps">Size ' + esc(o.size) + ' · ' + (m ? 'drawn from the chart' : esc(sc ? sc.how : '')) + '</p>';
      if (m) {
        var tol = m.tol_plus === m.tol_minus ? '± ' + r2(m.tol_plus * k2) : '+' + r2(m.tol_plus * k2) + ' / −' + r2(m.tol_minus * k2);
        hh += '<div class="gs-pk">' + pk('Chart', r2(m.chart * k2) + ' ' + u) + pk('Pattern', r2(m.pattern * k2) + ' ' + u) + pk('Difference', (m.diff > 0 ? '+' : '') + r2(m.diff * k2) + ' ' + u, m.ok ? 'ok' : 'bad') + pk('Tolerance', tol + ' ' + u) + '</div>' +
          field('Chart value, size ' + o.size + ' (' + u + ')', '<input type="text" inputmode="decimal" data-chart="' + key + '" value="' + esc((s2.chart[key] || {})[o.size] != null ? s2.chart[key][o.size] : '') + '">') +
          '<p class="gs-ps">Type a new value and the pattern, the marker and the garment follow. To bend the pattern by hand instead, edit its points in 2D: the measurement table there moves the right points for you.</p>';
      }
      if (cs && cs.pattern_cm != null) hh += '<div class="gs-ik">Against the spec sheet</div><div class="gs-pk">' + pk('Sheet asks', r2(cs.spec_cm * k2) + ' ' + u) + pk('Pattern', r2(cs.pattern_cm * k2) + ' ' + u) + pk('Difference', (cs.diff > 0 ? '+' : '') + r2(cs.diff * k2) + ' ' + u, cs.status === 'ok' ? 'ok' : 'bad') + pk('Tolerance', '+' + r2(cs.tol_plus * k2) + ' / −' + r2(cs.tol_minus * k2)) + '</div>' + (cs.assumed ? '<p class="gs-ps">' + esc(cs.assumed) + '</p>' : '');
      else if (cs) hh += '<div class="gs-ik">From the spec sheet</div><div class="gs-pk">' + pk('Sheet asks', r2(cs.spec_cm * k2) + ' ' + u) + '</div><p class="gs-ps">Kept with the spec: the pattern engine neither draws nor measures this one.</p>';
      $('pe-measure').innerHTML = hh;
    } else if (pb === 'trim') {
      var b = r.bom[+sel.id]; if (!b) { $('pe-trim').innerHTML = '<div class="gs-empty">Nothing selected.</div>'; return; }
      var idx = -1; (s.trims || []).forEach(function (tr, i) { if (tr.item === b.item) idx = i; });
      $('pe-trim').innerHTML = '<p class="gs-ph">' + esc(b.item) + '</p><p class="gs-ps">' + esc(b.note || '') + '</p><div class="gs-pk">' + pk('Quantity', b.qty + ' ' + b.unit) + '</div>' +
        (idx >= 0 ? field('Item', '<input type="text" data-trim="' + idx + '" data-k="item" value="' + esc(s.trims[idx].item) + '">') + field('Quantity', '<input type="number" min="1" max="99" data-trim="' + idx + '" data-k="qty" value="' + esc(s.trims[idx].qty) + '">') + '<div class="gs-pr"><button type="button" class="gm-btn" data-do="trim-remove" data-idx="' + idx + '">Remove from the bill of materials</button></div>' : '<p class="gs-ps">Worked out by the engine from the patterns, the marker and the seams.</p>');
    }
  }
  function onPEChange(e) {
    var t = e.target, s = S(); if (!s) return;
    if (t.hasAttribute('data-seam')) { var id = t.getAttribute('data-seam'), k = t.getAttribute('data-k'); s.seams = s.seams || {}; (s.seams[id] = s.seams[id] || {})[k] = k === 'allowance' ? (t.value === '' ? '' : +t.value) : t.value; K().schedule(); }
    else if (t.hasAttribute('data-chart')) { var key = t.getAttribute('data-chart'); s.chart[key] = s.chart[key] || {}; s.chart[key][s.size] = t.value; K().renderChart(); K().schedule(); }
    else if (t.hasAttribute('data-trim')) { var tr = s.trims[+t.getAttribute('data-trim')]; if (!tr) return; var kk = t.getAttribute('data-k'); tr[kk] = kk === 'qty' ? Math.max(1, parseInt(t.value, 10) || 1) : t.value; K().schedule(); }
  }

  // ── what the page tells the studio ──
  function render() {
    if (!K()) return;
    renderOB(); renderPE(); mark();
    var o = cur(), s = S();
    $('gs-2dinfo').textContent = o ? 'size ' + o.size + (lay.mode === 'edit' ? ' · edit points' : ' · as cut, seam allowance added') : '';
    ensure3D();
  }
  function ensure3D() {
    var r = R(); if (!r || !r.success || K().view() || creating) return;
    if (lay.view === '2d' || (phoneMQ.matches && lay.pv === '2d')) return;
    creating = true;
    Promise.resolve(K().make({ quiet: true, spin: false })).then(function () { setTimeout(function () { creating = false; bind3D(); mark(); }, 400); }, function () { creating = false; });
  }
  function bind3D() {
    if (bound3d || !K().view()) return; bound3d = true;
    var v0 = K().view(); if (v0) v0.onSim = function (e) {
      var t = $('gs-3dsim'), b = $('gm-drape'); if (!t) return;
      if (e.state === 'running') t.textContent = 'Draping… ' + Math.round((e.step / e.total) * 100) + ' %';
      else if (e.state === 'done') t.textContent = 'Draped · ' + e.stats.seams + ' seams · ' + e.stats.points + ' points';
      else if (e.state === 'off') t.textContent = ''; else if (e.state === 'unavailable') t.textContent = 'The simulation is not available here.'; else if (e.state === 'unsupported') { t.textContent = ''; toast(e.why); }
      if (b) b.classList.toggle('on', e.state === 'running' || e.state === 'done');
    };
    var host = $('gm-3d'), down = null;
    host.addEventListener('pointerdown', function (e) { down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
    host.addEventListener('pointerup', function (e) {
      if (!down) return; var d = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = Date.now() - down.t; down = null; if (d > 6 || dt > 600) return;
      var v = K().view(); if (!v || !v.pick) return; var id = v.pick(e.clientX, e.clientY);
      if (id && id.indexOf('seam:') === 0) select('seam', id.slice(5), { sheet: true, reveal: true });
      else if (id) select(id === 'zipper' ? 'zipper' : 'piece', id === 'zipper' ? 'zip' : id, { sheet: true, reveal: true }); else if (sel.t === 'piece') select('garment', '');
    });
    host.addEventListener('dblclick', function (e) { var id = K().view().pick(e.clientX, e.clientY); if (id && editable(id)) { select('piece', id); show('edit'); } });
    var sp = $('gm-spin'); if (sp) { var obs = new MutationObserver(function () { sp.classList.toggle('on', sp.classList.contains('primary')); }); obs.observe(sp, { attributes: true, attributeFilter: ['class'] }); }
  }

  // ── windows, panels, tabs ──
  function setMode(m) {
    lay.mode = m; $('gs-2dpieces').classList.toggle('on', m === 'pieces'); $('gs-2dedit').classList.toggle('on', m === 'edit');
    qa('#gs-2dmode button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-m') === m); });
    if (m === 'edit') { if (lay.view === '3d') lay.view = 'both'; if (phoneMQ.matches) lay.pv = '2d'; if (lay.views > 38 && !lay.viewsWas) { lay.viewsWas = lay.views; lay.views = 34; } }      // the editor gets the room
    else if (lay.viewsWas) { lay.views = lay.viewsWas; lay.viewsWas = 0; }
    applyLay(); render(); if (m === 'edit' && window.KAGarmentEdit) setTimeout(function () { window.KAGarmentEdit.fit(); }, 30);
  }
  function setSide(n) { lay.side = n; qa('#gs-sidetabs button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-sd') === n); }); $('gm-insp').hidden = n !== 'insp'; $('gm-edmeas').hidden = n !== 'meas'; saveLay(); }
  function setBottomTab(t) {
    lay.btab = t; qa('#gs-btabs [data-bt]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-bt') === t); }); qa('#gs-bbody .gm-pane').forEach(function (p) { p.classList.toggle('on', p.id === 'pane-' + t); });
    if (!lay.B) { lay.B = 1; } applyLay();
  }
  function sheet(name) { var on = gs.getAttribute('data-sheet') === name ? null : name; if (on) gs.setAttribute('data-sheet', on); else gs.removeAttribute('data-sheet'); qa('#gs-nav button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-nav') === on || (!on && b.getAttribute('data-nav') === lay.pv)); }); }
  function setView(v) { lay.view = v; if (phoneMQ.matches) lay.pv = v === '2d' ? '2d' : '3d'; applyLay(); render(); setTimeout(function () { var vw = K().view(); if (vw) vw.resize(); }, 40); }
  function show(t) {                                                              // garment.js's tab(): a centre window or a lower tab
    if (t === 'patterns') { setMode('pieces'); if (lay.view === '3d') setView('both'); if (phoneMQ.matches) { lay.pv = '2d'; applyLay(); } }
    else if (t === 'edit') { setMode('edit'); }
    else if (t === 'garment') { if (lay.view === '2d') setView('both'); if (phoneMQ.matches) { lay.pv = '3d'; applyLay(); } ensure3D(); }
    else { setBottomTab(t === 'checks' || t === 'spec' || t === 'sewing' || t === 'marker' || t === 'pieces' ? t : 'chart'); if (phoneMQ.matches) sheet('data'); }
  }

  // ── commands ──
  function key(k, o) { document.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true }, o || {}))); }
  function clickAct(a, need) { var b = document.querySelector('#gm-pane-edit-body [data-act="' + a + '"]'); if (b && !b.disabled) b.click(); else toast(need || 'Open a piece in the 2D window (Edit points) first.'); }
  function doAction(a, el) {
    var k = K();
    switch (a) {
      case 'upload': lay.L = 1; lay.ltab = 'spec'; ltab('spec'); if (phoneMQ.matches) sheet('lib'); applyLay(); setTimeout(function () { $('gm-file').click(); }, 60); break;
      case 'paste': lay.L = 1; ltab('paste'); if (phoneMQ.matches) sheet('lib'); applyLay(); setTimeout(function () { $('gm-paste').focus(); }, 80); break;
      case 'starter': $('gm-tpl').click(); toast('The standard tee chart is in.'); break;
      case 'library': lay.L = 1; ltab('spec'); if (phoneMQ.matches) sheet('lib'); applyLay(); setTimeout(function () { $('gm-preset').focus(); }, 80); break;
      case 'presetsave': lay.L = 1; ltab('spec'); if (phoneMQ.matches) sheet('lib'); applyLay(); $('gm-presetsave').click(); break;
      case 'dlpat': $('gm-dlpat').click(); break; case 'dlmk': $('gm-dlmk').click(); break;
      case 'snap': if (!k.view()) { toast('The garment is not made yet.'); break; } $('gm-snap').click(); break;
      case 'undo': if (lay.mode !== 'edit') setMode('edit'); key('z', { ctrlKey: true }); break; case 'redo': if (lay.mode !== 'edit') setMode('edit'); key('z', { ctrlKey: true, shiftKey: true }); break;
      case 'resetpiece': clickAct('reset'); break; case 'resetsize': clickAct('resetsize'); break; case 'copyall': clickAct('copyall'); break;
      case 'drape': { var vw = k.view(); if (!vw) { toast('The garment is not made yet.'); break; } if (lay.view === '2d') setView('both'); if (vw.simMode) vw.stopSim(); else { vw.startSim(); } break; }
      case 'drape-soft': case 'drape-medium': case 'drape-stiff': { var vw2 = k.view(); if (!vw2) break; vw2.setDrape(a.slice(6)); if (!vw2.simMode) vw2.startSim(); toast('Cloth: ' + a.slice(6)); break; }
      case 'mannequin': { var vw3 = k.view(); if (!vw3) break; if (!vw3.simMode) { toast('Drape the garment first: the mannequin is what it hangs on.'); break; } vw3.showMannequin(!vw3._showBody); break; }
      case 'refresh3d': k.make({ quiet: true, spin: false }); break;
      case 'spin': if (!k.view()) { k.make({ quiet: true, spin: true }); } else $('gm-spin').click(); break;
      case 'v-front': case 'v-back': case 'v-side': case 'v-quarter': if (!k.view()) { toast('The garment is not made yet.'); break; } if (lay.view === '2d') setView('both'); k.view().setView(a.slice(2)); break;
      case 'mode-pieces': setMode('pieces'); break; case 'mode-edit': setMode('edit'); break;
      case 'fit2d': if (lay.mode !== 'edit') setMode('edit'); else window.KAGarmentEdit.fit(); break;
      case 'bt-chart': case 'bt-spec': case 'bt-pieces': case 'bt-sewing': case 'bt-marker': case 'bt-checks': setBottomTab(a.slice(3)); if (phoneMQ.matches) sheet('data'); break;
      case 'sel-zipper': select('zipper', 'zip', { reveal: true }); if (phoneMQ.matches) sheet('obj'); break; case 'sel-fabric': select('fabric', 'main', { reveal: true }); if (phoneMQ.matches) sheet('obj'); break; case 'sel-cut': select('cut', 'cut', { reveal: true }); if (phoneMQ.matches) sheet('obj'); break;
      case 'fromstudio': if (!$('gm-fromstudio').hidden) $('gm-fromstudio').click(); else toast('No Fabric Studio design has been handed over yet: use "Make a garment from this fabric" in the Studio.'); break;
      case 'reviewspec': { var sp = S() && S().spec, ks = window.KAGarmentSpec; if (sp && ks) ks.open(sp, [], { kind: 'text', name: 'The last spec sheet', method: 'kept' }, null); else toast('No spec sheet has been read yet.'); break; }
      case 'view-both': setView('both'); break; case 'view-3d': setView('3d'); break; case 'view-2d': setView('2d'); break;
      case 'toggle-left': lay.L = lay.L ? 0 : 1; if (phoneMQ.matches) sheet('lib'); else applyLay(); break; case 'toggle-right': lay.R = lay.R ? 0 : 1; if (phoneMQ.matches) sheet('obj'); else applyLay(); break; case 'toggle-bottom': lay.B = lay.B ? 0 : 1; if (phoneMQ.matches) sheet('data'); else applyLay(); break;
      case 'fullscreen': lay.full = lay.full ? 0 : 1; applyLay(); break;
      case 'scale-up': lay.scale = clamp(r2(lay.scale + 0.1), 0.8, 1.5); applyLay(); toast('Text and buttons ' + Math.round(lay.scale * 100) + ' %'); break; case 'scale-down': lay.scale = clamp(r2(lay.scale - 0.1), 0.8, 1.5); applyLay(); toast('Text and buttons ' + Math.round(lay.scale * 100) + ' %'); break;
      case 'theme': lay.theme = lay.theme === 'dark' ? 'light' : 'dark'; applyLay(); break;
      case 'resetlayout': ['left', 'right', 'bottom', 'pe', 'views', 'L', 'R', 'B', 'view', 'scale', 'full'].forEach(function (n) { lay[n] = DEF[n]; }); if (window.innerWidth < 1100) { lay.L = 0; } applyLay(); toast('Layout reset.'); break;
      case 'help': openHelp(); break;
      case 'garment-style': { var g = el && el.getAttribute('data-g'), kd = el && el.getAttribute('data-kind'); if (g && (g !== (S().style || 'tee') || (kd || null) !== (S().kind || null))) { toast('Loading the standard ' + (kd || g) + ' chart…'); k.switchStyle(g, false, kd || null); } break; }
      case 'edit-piece': if (sel.t === 'piece') { setMode('edit'); } break;
      case 'show3d': if (lay.view === '2d') setView('both'); if (phoneMQ.matches) { lay.pv = '3d'; applyLay(); sheet(null); } ensure3D(); mark(); break;
      case 'trim-remove': { var i = +el.getAttribute('data-idx'); S().trims.splice(i, 1); select('garment', ''); k.schedule(); break; }
      default: break;
    }
  }
  function ltab(n) { lay.ltab = n; qa('#gs-ltabs button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-lt') === n); }); qa('[data-lp]').forEach(function (p) { p.classList.toggle('on', p.getAttribute('data-lp') === n); }); saveLay(); }

  function openHelp() {
    $('gs-helpbody').innerHTML = '<h3>What each window does</h3><p><b>3D window</b> — the garment, built from the finished pattern pieces: a form that shows the fit, not a cloth simulation. Click a part to select its piece; drag to turn, scroll or pinch to zoom.</p><p><b>2D pattern window</b> — Pieces: every piece as it is cut, with seam allowances and notches. Edit points: drag the anchors and handles of one piece, add or delete points, measure, and type a measurement to move the right points.</p><p><b>Object browser</b> — pieces, fabric, seams, measurements, trims. <b>Property editor</b> — the details of what is selected, and the fields that change it.</p><p><b>Lower panel</b> — the measurement chart, the spec check against the buyer\'s sheet, the pieces table, the seams and the bill of materials, the marker, the checks.</p>' +
      '<h3>Keys</h3><table><tr><td><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd></td><td>3D only · 2D only · both</td></tr><tr><td><kbd>[</kbd> <kbd>]</kbd> <kbd>\\</kbd></td><td>Library · object browser · lower panel</td></tr><tr><td><kbd>E</kbd></td><td>Edit the points of the piece / back to the pieces</td></tr><tr><td><kbd>O</kbd></td><td>Upload a spec sheet</td></tr><tr><td><kbd>Shift</kbd> <kbd>F</kbd></td><td>Hide or show the site header</td></tr><tr><td><kbd>V</kbd> <kbd>A</kbd> <kbd>M</kbd> <kbd>F</kbd> <kbd>Del</kbd></td><td>(editing points) select · add a point · measure · fit · delete</td></tr><tr><td><kbd>Ctrl</kbd> <kbd>Z</kbd></td><td>Undo (add <kbd>Shift</kbd> for redo)</td></tr></table>' +
      '<h3>Layout</h3><p>Drag the thin bars between the panels to any size (double-click one to reset it; drag it to the edge to close the panel). View menu: larger or smaller text and buttons, dark or light, hide the site header. The layout is remembered.</p><h3>What it does not do</h3><p>No cloth simulation or avatar fitting; only a crew-neck T-shirt is drawn (a polo, a hoodie or trousers in a spec sheet are named and their measures kept and checked); thread ratios are rules of thumb; the sewing time is the catalogue figure for a basic tee plus an estimate for a zipper.</p>';
    var m = $('gs-help'); m.hidden = false; document.body.classList.add('gm-lock'); $('gs-helpclose').focus();
  }
  function closeHelp() { $('gs-help').hidden = true; document.body.classList.remove('gm-lock'); }

  // ── events ──
  function typing(e) { var t = e.target; return t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable); }
  // the tools of the 2D editor, down its left edge: select, add a point, measure, hand, zoom, fit
  function buildTools() {
    var cv = document.querySelector('#gs-2dedit .gm-edcanvas'); if (!cv || $('gs-tools')) return;
    var T = [['select', 'node', 'Select and move points (V)'], ['add', 'plus', 'Add a point on an edge (A)'], ['measure', 'ruler', 'Measure between two points (M)'], ['hand', 'hand', 'Hand: drag the view (H)'], ['zin', 'zin', 'Zoom in'], ['zout', 'zout', 'Zoom out'], ['fit', 'fit', 'Fit the piece to the window (F)']];
    var d = document.createElement('div'); d.id = 'gs-tools'; d.className = 'gs-tools'; d.setAttribute('role', 'toolbar'); d.setAttribute('aria-label', 'Pattern tools');
    d.innerHTML = T.map(function (t, i) { return (i === 4 ? '<span class="gs-rsep"></span>' : '') + '<button type="button" class="gs-ib" data-rt="' + t[0] + '" title="' + t[2] + '" aria-label="' + t[2] + '"><i>' + icon(t[1]) + '</i></button>'; }).join('');
    cv.appendChild(d);
    d.addEventListener('click', function (e) {
      var b = e.target.closest('[data-rt]'); if (!b) return; var t = b.getAttribute('data-rt'), E = window.KAGarmentEdit;
      if (t === 'zin') E.zoomBy(0.8); else if (t === 'zout') E.zoomBy(1.25); else if (t === 'fit') E.fit();
      else { var src = document.querySelector('#gm-edtools [data-tool="' + t + '"]'); if (src) src.click(); }
    });
    var sync = function () { qa('[data-rt]', d).forEach(function (b) { var s = document.querySelector('#gm-edtools [data-tool="' + b.getAttribute('data-rt') + '"]'); b.classList.toggle('on', !!(s && s.classList.contains('on'))); }); };
    if (window.MutationObserver) new MutationObserver(sync).observe($('gm-edtools'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    sync();
  }
  function bind() {
    buildTools(); bindMenus(); qa('.gs-split').forEach(bindSplit); edges();
    gs.addEventListener('click', function (e) {
      var d = e.target.closest('[data-do]'); if (d && !d.disabled) { closeMenus(); gs.classList.remove('menu-open'); doAction(d.getAttribute('data-do'), d); return; }
      var s = e.target.closest('[data-sel]'); if (s && (s.classList.contains('gs-obr') || s.classList.contains('gs-chipb'))) { select(s.getAttribute('data-sel'), s.getAttribute('data-id'), { reveal: true }); return; }
      var un = e.target.closest('[data-unit]'); if (un && S() && un.getAttribute('data-unit') !== S().unit) { var ub = document.querySelector('#gm-unit [data-u="' + un.getAttribute('data-unit') + '"]'); if (ub) ub.click(); setTimeout(renderPE, 50); return; }
      var ot = e.target.closest('#gs-otabs [data-ot]'); if (ot) { lay.otab = ot.getAttribute('data-ot'); saveLay(); renderOB(); return; }
      var lt = e.target.closest('#gs-ltabs [data-lt]'); if (lt) { ltab(lt.getAttribute('data-lt')); return; }
      var bt = e.target.closest('#gs-btabs [data-bt]'); if (bt) { setBottomTab(bt.getAttribute('data-bt')); return; }
      var m = e.target.closest('#gs-2dmode [data-m]'); if (m) { setMode(m.getAttribute('data-m')); return; }
      var sd = e.target.closest('#gs-sidetabs [data-sd]'); if (sd) { setSide(sd.getAttribute('data-sd')); return; }
      var nv = e.target.closest('#gs-nav [data-nav]'); if (nv) { var n = nv.getAttribute('data-nav'); if (n === '3d' || n === '2d') { lay.pv = n; gs.removeAttribute('data-sheet'); applyLay(); setMode(n === '2d' ? lay.mode : lay.mode); if (n === '3d') ensure3D(); qa('#gs-nav button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-nav') === n); }); setTimeout(function () { var v = K().view(); if (v) v.resize(); if (lay.mode === 'edit') window.KAGarmentEdit.fit(); }, 60); } else sheet(n); return; }
      if (e.target.id === 'gs-scrim') { gs.removeAttribute('data-sheet'); qa('#gs-nav button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-nav') === lay.pv); }); return; }
      var pp = e.target.closest('#gm-patterns .gs-pp'); if (pp) { select('piece', pp.getAttribute('data-piece'), { reveal: true, sheet: true }); return; }
      if (e.target.closest('#gm-patterns') && !pp) select('garment', '');
    });
    $('gm-patterns').addEventListener('dblclick', function (e) { var pp = e.target.closest('.gs-pp'); if (pp) { select('piece', pp.getAttribute('data-piece')); setMode('edit'); } });
    $('gs-oblist').addEventListener('keydown', function (e) { var r = e.target.closest('.gs-obr'); if (!r) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); r.click(); } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); var rows = qa('.gs-obr', $('gs-oblist')), i = rows.indexOf(r), n = rows[i + (e.key === 'ArrowDown' ? 1 : -1)]; if (n) n.focus(); } });
    $('gs-pebody').addEventListener('change', onPEChange);
    $('gs-helpclose').addEventListener('click', closeHelp); $('gs-help').addEventListener('mousedown', function (e) { if (e.target === $('gs-help')) closeHelp(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { if (!$('gs-help').hidden) { closeHelp(); return; } if (gs.getAttribute('data-sheet')) { gs.removeAttribute('data-sheet'); return; } }
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey || !$('gm-specmodal').hidden || !$('gs-help').hidden) return;
      var k = e.key;
      if (k === '1') setView('3d'); else if (k === '2') setView('2d'); else if (k === '3') setView('both'); else if (k === '[') doAction('toggle-left'); else if (k === ']') doAction('toggle-right'); else if (k === '\\') doAction('toggle-bottom');
      else if (k === 'd') doAction('drape'); else if (k === 'E' && e.shiftKey) { /* shift E is nothing */ } else if (k === 'e') setMode(lay.mode === 'edit' ? 'pieces' : 'edit'); else if (k === 'o') doAction('upload'); else if (k === 'F') doAction('fullscreen'); else if (k === '?') openHelp();
    });
    window.addEventListener('resize', function () { topOffset(); notifySize(); });
    phoneMQ.addEventListener && phoneMQ.addEventListener('change', function () { gs.removeAttribute('data-sheet'); applyLay(); render(); });
    var st = $('gm-status'); if (st && window.MutationObserver) new MutationObserver(function () { $('gs-stmsg').textContent = st.textContent.trim() || 'Ready'; }).observe(st, { childList: true, characterData: true, subtree: true });
    if (window.ResizeObserver) { var ro = new ResizeObserver(function () { notifySize(); }); ro.observe($('gs-w3d')); ro.observe($('gs-w2d')); }
    var up = $('gs-2dedit'); if (window.MutationObserver) new MutationObserver(function () { notifySize(); }).observe(up, { attributes: true, attributeFilter: ['class'] });
  }

  function init() {
    fillIcons(document);
    applyLay(); ltab(lay.ltab); setBottomTab(lay.btab); setSide(lay.side); setMode(lay.mode === 'edit' ? 'edit' : 'pieces');
    qa('#gs-nav button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-nav') === lay.pv); });
    bind(); renderOB(); renderPE();
    if (K() && K().result()) render();
  }
  function styleChanged() {
    var s = S(); qa('#gs-garments [data-g]').forEach(function (b) { b.classList.toggle('on', !!s && b.getAttribute('data-g') === (s.style || 'tee') && (b.getAttribute('data-kind') || null) === (s.kind || null)); });
    var E = window.KAGarmentEdit && window.KAGarmentEdit.state(); if (E) { E.pid = 'front'; E.sel = null; E.fitFor = ''; }
    var v = K() && K().view && K().view(); if (v) { v._placed = false; }
    select('garment', ''); render();
  }
  window.KAGarmentStudio = { styleChanged: styleChanged, render: render, show: show, select: select, state: function () { return { lay: lay, sel: sel }; }, doAction: doAction, setView: setView, setMode: setMode };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
