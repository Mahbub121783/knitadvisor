/**
 * Fabric Studio — the design studio.
 *
 * The Design step in the whole window, the way a 3D design tool works: the drawing and its feeders on the left, the cloth in the middle with its tools
 * and views on it, the inspector, the colours, the picture and the checks on the right. Everything is linked:
 *
 *   · click a loop in the cloth  → its cell is selected in the grid, ringed on every repeat in the cloth, and opened in the inspector;
 *   · with the Paint tool, the same click sets that needle (or the whole feeder, or the whole needle column) to the brush: one undo step;
 *   · click a cell, a feeder row or an item of the feeder list → the cloth shows it; click a check that names a feeder → the drawing goes to it;
 *   · the inspector sets a feeder's role, yarn and colour through the same path as the grid, so the cloth, the checks and the verdict follow at once.
 *
 * Nothing is rebuilt: the Studio's cards are MOVED in and put back where they were (ids and listeners untouched). The page's own state is reached only
 * through window.KAStudioDesign (studio.js). A phone gets the cloth on top and a sheet under it.
 *
 * Keys (outside a field): V select · B paint · K T M E R - brush · arrows move · Enter paint · Ctrl+Z undo · Ctrl+Shift+Z redo · 1 2 3 4 views · F fit · [ ] panels · ? list · Esc.
 * Plain script. window.KAStudioFullWindow: open(), close(), isOpen(), select(cell).
 */
(function () {
  'use strict';
  var LS = 'ka_fw_layout_v2';

  var LEFT = [['Programme', ['#ws-c-draw']], ['Feeders', null], ['Start from', ['#ws-c-fab', '#ws-c-target']], ['Cam sheet', ['#cs-card']]];
  var RIGHT = [['Inspector', null], ['Colourway', ['#cw-card']], ['Picture', ['#jq-card']], ['Yarn', ['#ws-c-yarn']], ['Checks', ['#ws-c-status']]];
  var CENTRE = '#ws-view';
  var VIEW_TABS = ['3d', 'notation', 'needle', 'colours', 'results'];
  var BRUSH = { k: 'K', t: 'T', m: 'M', e: 'E', r: 'R', '-': '-' };
  var VIEWS = { '1': 'face', '2': 'back', '3': 'edge', '4': 'angle' };
  var NAMES = { K: 'knit', T: 'tuck', M: 'miss', E: 'transfer', R: 'to other bed', '-': 'no needle' };
  var BEDS = { single: 'Single bed', rib: 'Rib gating', interlock: 'Interlock gating' };
  var ROLES = ['ground', 'face', 'binder', 'loop'];
  var UNITS = [['ne', 'Ne'], ['nm', 'Nm'], ['tex', 'tex'], ['dtex', 'dtex'], ['denier', 'D']];
  var LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

  var fw = null, open = false, moved = [], lastFocus = null, lastResult = null, E = {}, D = null;
  var st = { tool: 'select', scope: 'cell', sel: null, hover: null };
  var lay = { lw: 400, rw: 360, left: true, right: true, lt: 0, rt: 0, sh: 0 };
  var raf = 0, narrow = window.matchMedia ? window.matchMedia('(max-width: 900px)') : { matches: false };

  function $(id) { return document.getElementById(id); }
  function q(s) { return document.querySelector(s); }
  function mk(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function loadLay() { try { var o = JSON.parse(localStorage.getItem(LS) || '{}'); Object.keys(lay).forEach(function (k) { if (o[k] != null && typeof o[k] === typeof lay[k]) lay[k] = o[k]; }); } catch (_) { /* private window */ } }
  function saveLay() { try { localStorage.setItem(LS, JSON.stringify(lay)); } catch (_) { /* private window */ } }
  function resized() { requestAnimationFrame(function () { window.dispatchEvent(new Event('resize')); place(); }); }
  function later(fn) { if (raf) return; raf = requestAnimationFrame(function () { raf = 0; if (open) fn(); }); }
  function lv() { return window.__loopView && window.__loopView.geo ? window.__loopView : null; }
  function hexOf(l) { var e = $('st-sc-' + l); return e && /^#[0-9a-f]{6}$/i.test(e.value) ? e.value : '#808080'; }
  function ink(hex) { var n = parseInt(hex.slice(1), 16); return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255) > 150 ? '#111' : '#fff'; }

  var I = {
    cursor: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M4 2l11 7-5 1.5L7.5 16z" fill="currentColor"/></svg>',
    brush: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M14.5 2.5l3 3-8 8-3-3zM5.5 11.5L3 17l5.5-2.5z" fill="currentColor"/></svg>',
    undo: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M7 4L2.5 8.5 7 13V10c4 0 7 1 8.5 5 .5-5-2-9-8.5-9z" fill="currentColor"/></svg>',
    redo: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M13 4l4.5 4.5L13 13v-3c-4 0-7 1-8.5 5-.5-5 2-9 8.5-9z" fill="currentColor"/></svg>',
    fit: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M3 3h5v2H5v3H3zm9 0h5v5h-2V5h-3zM3 12h2v3h3v2H3zm12 0h2v5h-5v-2h3z" fill="currentColor"/></svg>',
    cell: '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><rect x="7" y="7" width="6" height="6" fill="currentColor"/><rect x="2.5" y="2.5" width="15" height="15" fill="none" stroke="currentColor" stroke-opacity=".4"/></svg>',
    row: '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><rect x="2.5" y="7" width="15" height="6" fill="currentColor"/><rect x="2.5" y="2.5" width="15" height="15" fill="none" stroke="currentColor" stroke-opacity=".4"/></svg>',
    col: '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><rect x="7" y="2.5" width="6" height="15" fill="currentColor"/><rect x="2.5" y="2.5" width="15" height="15" fill="none" stroke="currentColor" stroke-opacity=".4"/></svg>'
  };

  // ── the window ──
  function build() {
    if (fw) return fw;
    fw = mk('div', 'fw'); fw.id = 'fw'; fw.hidden = true; fw.setAttribute('role', 'dialog'); fw.setAttribute('aria-label', 'Design studio'); fw.setAttribute('data-sheet', ''); fw.setAttribute('data-active', 'select');
    fw.innerHTML =
      '<header class="fw-top">' +
        '<button type="button" class="st-btn fw-x" data-fw="exit" title="Back to the steps (Esc)">&larr; <span class="fw-hide-s">Steps</span></button>' +
        '<div class="fw-title"><b>Design studio</b><span id="fw-what">Draw, colour and look at the cloth in one window</span></div>' +
        '<div class="fw-verdict" id="fw-verdict" title="Open the checks"><span class="ws-vtext">Draw a structure to begin.</span></div>' +
        '<div class="fw-actions">' +
          '<button type="button" class="st-btn fw-ic" data-fw="undo" title="Undo (Ctrl+Z)" aria-label="Undo">' + I.undo + '</button>' +
          '<button type="button" class="st-btn fw-ic" data-fw="redo" title="Redo (Ctrl+Shift+Z)" aria-label="Redo">' + I.redo + '</button>' +
          '<button type="button" class="st-btn on fw-hide-s" data-fw="left" title="Show or hide the drawing panel ( [ )">Draw</button>' +
          '<button type="button" class="st-btn on fw-hide-s" data-fw="right" title="Show or hide the inspector panel ( ] )">Look</button>' +
          '<button type="button" class="st-btn fw-ic" data-fw="help" title="Keys (?)" aria-label="Keys">?</button>' +
        '</div>' +
      '</header>' +
      '<div class="fw-body">' +
        '<aside class="fw-side fw-left" aria-label="Drawing"><div class="fw-handle" data-handle="left"><i></i></div><nav class="fw-tabs" role="tablist"></nav><div class="fw-panes"></div></aside>' +
        '<div class="fw-grip" data-side="left" role="separator" aria-orientation="vertical" title="Drag to resize"></div>' +
        '<main class="fw-centre">' +
          '<div class="fw-rail" role="toolbar" aria-label="Tools">' +
            '<button type="button" data-tool="select" title="Select (V): click a loop to open it" class="on">' + I.cursor + '</button>' +
            '<button type="button" data-tool="paint" title="Paint (B): click a loop to set it to the brush">' + I.brush + '</button>' +
            '<span class="fw-sep"></span>' +
            ['K', 'T', 'M', 'E', 'R', '-'].map(function (s) { return '<button type="button" class="fw-br m-' + (s === '-' ? 'x' : s) + '" data-brush="' + s + '" title="' + NAMES[s] + ' (' + s + ')">' + (s === '-' ? '&ndash;' : s) + '</button>'; }).join('') +
            '<span class="fw-sep"></span>' +
            '<button type="button" data-scope="cell" title="Apply to one needle" class="on">' + I.cell + '</button>' +
            '<button type="button" data-scope="row" title="Apply to the whole feeder">' + I.row + '</button>' +
            '<button type="button" data-scope="col" title="Apply to the whole needle column">' + I.col + '</button>' +
          '</div>' +
          '<div class="fw-gizmo" role="toolbar" aria-label="Views">' +
            '<button type="button" data-gv="face">Face</button><button type="button" data-gv="back">Back</button><button type="button" data-gv="edge">Edge</button><button type="button" data-gv="angle">Angle</button>' +
            '<button type="button" class="fw-ic" data-fw="fit" title="Fit the cloth (F)" aria-label="Fit">' + I.fit + '</button><span class="fw-sep"></span>' +
            '<button type="button" data-gm="loops">Loops</button><button type="button" data-gm="cloth">Fabric</button><button type="button" data-gm="both">Both</button>' +
          '</div>' +
        '</main>' +
        '<div class="fw-grip" data-side="right" role="separator" aria-orientation="vertical" title="Drag to resize"></div>' +
        '<aside class="fw-side fw-right" aria-label="Inspector and colour"><div class="fw-handle" data-handle="right"><i></i></div><nav class="fw-tabs" role="tablist"></nav><div class="fw-panes"></div></aside>' +
      '</div>' +
      '<nav class="fw-mtabs" aria-label="Panels">' +
        '<button type="button" data-mn="cloth" class="on">Cloth</button><button type="button" data-mn="feeders">Feeders</button><button type="button" data-mn="draw">Draw</button><button type="button" data-mn="inspect">Inspect</button><button type="button" data-mn="colour">Colour</button>' +
      '</nav>' +
      '<footer class="fw-status"><span id="fw-hint" class="fw-hint"></span><span class="fw-sp"></span><span id="fw-info" class="fw-info"></span><span class="fw-keys"><kbd>V</kbd> select <kbd>B</kbd> paint <kbd>?</kbd> keys</span></footer>' +
      '<div class="fw-help" id="fw-help" hidden><b>Keys</b>' +
        '<div><span>Select tool / Paint tool</span><span><kbd>V</kbd> <kbd>B</kbd></span></div>' +
        '<div><span>Brush: knit, tuck, miss, transfer, to other bed, no needle</span><span><kbd>K</kbd> <kbd>T</kbd> <kbd>M</kbd> <kbd>E</kbd> <kbd>R</kbd> <kbd>-</kbd></span></div>' +
        '<div><span>Move the selection</span><span><kbd>&larr;</kbd> <kbd>&rarr;</kbd> <kbd>&uarr;</kbd> <kbd>&darr;</kbd></span></div>' +
        '<div><span>Paint the selection with the brush</span><span><kbd>Enter</kbd></span></div>' +
        '<div><span>Undo / redo</span><span><kbd>Ctrl</kbd> <kbd>Z</kbd> / <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>Z</kbd></span></div>' +
        '<div><span>Face, back, edge, angle · fit the cloth</span><span><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd> · <kbd>F</kbd></span></div>' +
        '<div><span>Hide or show the drawing / the inspector panel</span><span><kbd>[</kbd> <kbd>]</kbd></span></div>' +
        '<div><span>Scroll over the cloth to zoom, drag to turn it</span><span>mouse · touch</span></div>' +
        '<div><span>Clear the selection, then leave</span><span><kbd>Esc</kbd></span></div>' +
      '</div>';
    document.body.appendChild(fw);
    E = { top: fw.querySelector('.fw-top'), verdict: $('fw-verdict'), what: $('fw-what'), centre: fw.querySelector('.fw-centre'), help: $('fw-help'), hint: $('fw-hint'), info: $('fw-info'),
      rail: fw.querySelector('.fw-rail'), gizmo: fw.querySelector('.fw-gizmo'),
      left: { nav: fw.querySelector('.fw-left .fw-tabs'), panes: fw.querySelector('.fw-left .fw-panes'), tabs: [], list: [] },
      right: { nav: fw.querySelector('.fw-right .fw-tabs'), panes: fw.querySelector('.fw-right .fw-panes'), tabs: [], list: [] } };
    [['left', LEFT], ['right', RIGHT]].forEach(function (p) {
      var side = E[p[0]];
      p[1].forEach(function (t, i) {
        var b = mk('button', 'fw-tab', esc(t[0])); b.type = 'button'; b.setAttribute('role', 'tab');
        b.addEventListener('click', function () { tab(p[0], i); });
        side.nav.appendChild(b); side.tabs.push(b);
        var pane = mk('div', 'fw-pane'); pane.hidden = true; side.panes.appendChild(pane); side.list.push(pane);
      });
    });
    E.feedersPane = E.left.list[1]; E.feedersPane.classList.add('fw-own');
    E.inspPane = E.right.list[0]; E.inspPane.classList.add('fw-own');
    fw.addEventListener('click', onClick);
    fw.addEventListener('change', onChange);
    fw.addEventListener('input', onInput);
    fw.addEventListener('pointerdown', onDown);
    E.verdict.addEventListener('click', function () { reveal('right', 4); });
    // the wheel zooms the cloth here: the page behind does not scroll, so the guard that keeps a wheel for the page has nothing to protect
    E.centre.addEventListener('wheel', function (e) { var t = e.target; if (t && t.tagName === 'CANVAS' && window.KAViewGuard) { var s = window.KAViewGuard.watch(t); if (s) s.armed = true; } }, true);
    ['left', 'right'].forEach(function (s) { grip(fw.querySelector('.fw-grip[data-side="' + s + '"]'), s); handle(fw.querySelector('.fw-handle[data-handle="' + s + '"]')); });
    if (window.ResizeObserver) { new ResizeObserver(function () { later(place); }).observe(E.centre); }
    if (window.MutationObserver) { new MutationObserver(function () { later(place); }).observe(E.centre, { attributes: true, subtree: true, attributeFilter: ['hidden', 'class', 'style'] }); }
    return fw;
  }

  // ── what a click means ──
  function onClick(e) {
    var t = e.target, b;
    if ((b = t.closest('[data-fw]'))) {
      var a = b.getAttribute('data-fw');
      if (a === 'exit') close();
      else if (a === 'left' || a === 'right') setPanel(a, !lay[a]);
      else if (a === 'fit') fit();
      else if (a === 'undo' || a === 'redo') D.op(a);
      else if (a === 'help') E.help.hidden = !E.help.hidden;
      return;
    }
    if ((b = t.closest('[data-tool]'))) return setTool(b.getAttribute('data-tool'));
    if ((b = t.closest('.fw-rail [data-brush]'))) { D.setBrush(b.getAttribute('data-brush')); return setTool('paint'); }
    if ((b = t.closest('[data-scope]'))) return setScope(b.getAttribute('data-scope'));
    if ((b = t.closest('[data-gv]'))) { var vb = q('#st-loopbar [data-view="' + b.getAttribute('data-gv') + '"]'); if (vb) vb.click(); return void setTimeout(syncGizmo, 60); }
    if ((b = t.closest('[data-gm]'))) { var mb = q('#st-3dmode [data-mode="' + b.getAttribute('data-gm') + '"]'); if (mb) mb.click(); return void setTimeout(function () { syncGizmo(); place(); }, 120); }
    if ((b = t.closest('[data-mn]'))) return mobileNav(b.getAttribute('data-mn'));
    if ((b = t.closest('[data-fd]'))) { var i = +b.getAttribute('data-fd'); return select(st.sel && st.sel.j == null && st.sel.i === i ? null : { i: i }, { reveal: true }); }
    if ((b = t.closest('[data-set]'))) { if (st.sel && st.sel.j != null) paintSel(st.sel, b.getAttribute('data-set')); return; }
    if ((b = t.closest('[data-chip]'))) { if (st.sel) D.feed(st.sel.i, 'colour', b.getAttribute('data-chip')); return; }
    if ((b = t.closest('[data-step]'))) return stepSel(b.getAttribute('data-step'));
    if ((b = t.closest('[data-iso]'))) { if (st.sel) select(st.sel.j != null ? { i: st.sel.i } : null); return; }
    var li = t.closest('#st-checks li');
    if (li) {
      var m = /Feed (\d+)(?:, needle (\d+))?/.exec(li.textContent || '');
      if (m) { var F = D.size().F, i2 = Math.max(0, Math.min(F - 1, +m[1] - 1)); reveal('left', 0); select(m[2] ? { bed: 'C', i: i2, j: Math.max(0, +m[2] - 1) } : { i: i2 }, { reveal: true }); }
      return;
    }
    if (!t.closest('.fw-help') && !E.help.hidden) E.help.hidden = true;
  }
  function onChange(e) {
    var t = e.target, k = t.getAttribute && t.getAttribute('data-ik');
    if (k && st.sel) D.feed(st.sel.i, k, t.type === 'checkbox' ? t.checked : t.value);
  }
  function onInput(e) {
    var t = e.target, L = t.getAttribute && t.getAttribute('data-pal');
    if (!L) return;
    var sw = $('st-sc-' + L); if (!sw) return;
    sw.value = t.value; sw.dispatchEvent(new Event('input', { bubbles: true })); sw.dispatchEvent(new Event('change', { bubbles: true }));
    later(function () { renderFeeders(); chips(); });
  }
  // a press in the grid selects what it paints (the Studio's own handler paints); a press on a feeder's name selects the feeder
  function onDown(e) {
    var td = e.target.closest && e.target.closest('#st-editor td.c');
    if (td) { var tb = td.closest('table'); return select({ bed: tb.getAttribute('data-bed'), i: +td.getAttribute('data-i'), j: +td.getAttribute('data-j') }); }
    var th = e.target.closest && e.target.closest('#st-editor th');
    if (th) { var m = /^F(\d+)$/.exec((th.textContent || '').trim()); if (m) select({ i: +m[1] - 1 }); }
  }

  // ── the tools ──
  function setTool(t) {
    st.tool = t;
    Array.prototype.forEach.call(fw.querySelectorAll('[data-tool]'), function (b) { b.classList.toggle('on', b.getAttribute('data-tool') === t); });
    fw.setAttribute('data-active', t); hint();
  }
  function setScope(s) {
    st.scope = s;
    Array.prototype.forEach.call(fw.querySelectorAll('[data-scope]'), function (b) { b.classList.toggle('on', b.getAttribute('data-scope') === s); });
    hint();
  }
  function cellsFor(c, scope) {
    var s = D.state(), g = c.bed === 'C' ? s.C : s.D, out = [], i, j;
    if (!g) return out;
    if (scope === 'row') for (j = 0; j < g[0].length; j++) out.push({ bed: c.bed, i: c.i, j: j });
    else if (scope === 'col') for (i = 0; i < g.length; i++) out.push({ bed: c.bed, i: i, j: c.j });
    else out.push({ bed: c.bed, i: c.i, j: c.j });
    return out;
  }
  function paintSel(c, sym) { return D.paint(cellsFor(c, st.scope), sym || D.state().brush); }

  // ── selection: one place, every view follows ──
  function select(sel, o) {
    var z = D.size();
    if (sel && (sel.i < 0 || sel.i >= z.F || (sel.j != null && sel.j >= z.W))) sel = null;
    st.sel = sel;
    paintMarks(); renderInspector(); renderFeeders(); info();
    if (sel && o && o.reveal) revealCell();
    if (sel && sel.j != null && o && o.from === '3d' && narrow.matches && !fw.getAttribute('data-sheet') && st.tool === 'select') setTimeout(function () { if (open && !fw.getAttribute('data-sheet')) mobileNav('inspect'); }, 260);
  }
  function stepSel(dir) {
    var z = D.size(), s = st.sel || { bed: 'C', i: 0, j: 0 };
    if (s.j == null) s = { bed: 'C', i: s.i, j: 0 };
    var i = s.i, j = s.j;
    if (dir === 'left') j--; else if (dir === 'right') j++; else if (dir === 'up') i--; else if (dir === 'down') i++;
    i = Math.max(0, Math.min(z.F - 1, i)); j = Math.max(0, Math.min(z.W - 1, j));
    select({ bed: s.bed, i: i, j: j }, { reveal: true });
  }
  function paintMarks() {
    var s = st.sel, v = lv(), z = D.size();
    Array.prototype.forEach.call(document.querySelectorAll('#st-editor .fw-sel, #st-editor .fw-selrow'), function (n) { n.classList.remove('fw-sel', 'fw-selrow'); });
    if (s) {
      Array.prototype.forEach.call(document.querySelectorAll('#st-editor td.c[data-i="' + s.i + '"]'), function (td) {
        td.parentNode.classList.add('fw-selrow');
        if (s.j != null && +td.getAttribute('data-j') === s.j && td.closest('table').getAttribute('data-bed') === s.bed) td.classList.add('fw-sel');
      });
    }
    if (v) {
      if (s && s.j != null) { v.markCell(s.bed, s.i, s.j + 1, z.F); if (v._hl != null) v.highlight(null); }
      else { v.markCell(null); v.highlight(s ? s.i : null); }
      Array.prototype.forEach.call(document.querySelectorAll('#st-feedkey .fk'), function (b) { b.classList.toggle('on', v._hl === +b.getAttribute('data-fk')); });
    }
  }
  function revealCell() {
    var s = st.sel; if (!s || !E.left.tabs[0].classList.contains('on') || fw.classList.contains('no-left')) return;
    var td = s.j != null ? document.querySelector('#st-editor table[data-bed="' + s.bed + '"] td.c[data-i="' + s.i + '"][data-j="' + s.j + '"]') : document.querySelector('#st-editor td.c[data-i="' + s.i + '"]');
    if (td && td.scrollIntoView) td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // ── the cloth's own clicks ──
  function onPick(e) {
    if (!open) return;
    var s = e.detail, F = D.size().F;
    if (!s) return select(null);
    var c = { bed: s.bed, i: s.feed % F, j: s.needle - 1 };
    if (st.tool === 'paint') paintSel(c);
    select(c, { from: '3d', reveal: true });
  }
  function onHoverStitch(e) { st.hover = e.detail || null; later(info); }

  // ── the strip at the bottom ──
  function hint() {
    var b = D ? D.state().brush : 'K';
    E.hint.textContent = st.tool === 'paint'
      ? 'Paint: click a loop to set ' + { cell: 'that needle', row: 'its whole feeder', col: 'its whole needle column' }[st.scope] + ' to ' + b + ' (' + NAMES[b] + ')'
      : 'Select: click a loop in the cloth, a cell or a feeder to inspect it';
  }
  function info() {
    var z = D.size(), h = st.hover, s = st.sel, txt = z.F + ' feeder' + (z.F === 1 ? '' : 's') + ' × ' + z.W + ' needles · ' + (BEDS[z.bed] || z.bed);
    if (h) txt = 'F' + (h.feed % z.F + 1) + ' · ' + (h.bed === 'C' ? 'cylinder' : 'dial') + ' needle ' + h.needle + ' · ' + NAMES[h.act] + '   |   ' + txt;
    else if (s) txt = 'Selected ' + (s.j != null ? 'F' + (s.i + 1) + ' · ' + (s.bed === 'C' ? 'cylinder' : 'dial') + ' needle ' + (s.j + 1) : 'feeder F' + (s.i + 1)) + '   |   ' + txt;
    E.info.textContent = txt;
  }

  // ── the feeders ──
  function renderFeeders() {
    if (!open || !E.feedersPane) return;
    var s = D.state(), v = lv(), sel = st.sel, h = '';
    h += '<div class="fw-fhead"><b>' + s.C.length + ' feeder' + (s.C.length === 1 ? '' : 's') + '</b><span>' + (BEDS[s.bed] || '') + ' · repeat ' + s.C[0].length + ' needles</span>' +
      '<span class="fw-fbtn"><button type="button" class="st-btn" data-op-x="addFeed">+ Feeder</button><button type="button" class="st-btn" data-op-x="delFeed">&minus; Feeder</button></span></div><ul class="fw-flist">';
    s.C.forEach(function (row, i) {
      var f = s.feeds[i] || {}, col = v && v.feedColour ? v.feedColour(v.spec, i) : '#1857C4', n = { K: 0, T: 0, M: 0 };
      row.concat(s.D ? s.D[i] : []).forEach(function (c) { if (n[c] != null) n[c]++; });
      var yarn = f.count || f.ne ? (f.count || f.ne) + ' ' + ((f.unit || 'ne') === 'ne' ? 'Ne' : f.unit) : 'role yarn';
      var strip = s.C[0].length <= 40 ? '<span class="fw-mini">' + row.map(function (c) { return '<i class="m-' + (c === '-' ? 'x' : c) + '"></i>'; }).join('') + '</span>' : '';
      h += '<li><button type="button" class="fw-fd' + (sel && sel.i === i && sel.j == null ? ' on' : '') + (sel && sel.i === i && sel.j != null ? ' near' : '') + '" data-fd="' + i + '">' +
        '<i class="fw-dot" style="background:' + col + '"></i><b>F' + (i + 1) + '</b><span class="fw-role">' + esc(f.role || 'ground') + (f.plate ? ' + plated' : '') + (f.colour ? ' · ' + esc(f.colour) : '') + '</span><span class="fw-yarn">' + esc(yarn) + '</span>' + strip +
        '<span class="fw-n">K' + n.K + (n.T ? ' T' + n.T : '') + (n.M ? ' M' + n.M : '') + '</span></button></li>';
    });
    h += '</ul>';
    E.feedersPane.innerHTML = h;
  }

  // ── the inspector ──
  function chips() {
    var s = st.sel; if (!s || !E.inspPane) return;
    var cur = (D.state().feeds[s.i] || {}).colour || '';
    Array.prototype.forEach.call(E.inspPane.querySelectorAll('[data-chip]'), function (b) {
      var L = b.getAttribute('data-chip'); if (!L) return;
      var hx = hexOf(L); b.style.background = hx; b.style.color = ink(hx); b.classList.toggle('on', L === cur);
    });
    var p = E.inspPane.querySelector('[data-pal]'); if (p && cur) { p.setAttribute('data-pal', cur); p.value = hexOf(cur); }
  }
  function renderInspector() {
    if (!open || !E.inspPane) return;
    var a = document.activeElement;
    if (a && E.inspPane.contains(a) && /^(INPUT|SELECT)$/.test(a.tagName) && a.type !== 'checkbox' && a.type !== 'color' && st.sel) return;   // do not pull a field from under the hand
    var s = D.state(), z = D.size(), sel = st.sel, h = '';
    h += '<section class="fw-sec"><div class="fw-k">Design</div><div class="fw-big">' + z.F + ' feeder' + (z.F === 1 ? '' : 's') + ' × ' + z.W + ' needles</div><div class="fw-sub">' + esc(BEDS[z.bed] || z.bed) + ' · brush ' + esc(s.brush) + ' (' + NAMES[s.brush] + ')</div></section>';
    if (!sel) {
      h += '<section class="fw-sec fw-empty"><b>Nothing selected</b><p>Click a loop in the cloth, a cell in the drawing, or a feeder in the list. The inspector then shows what it is and lets you change it.</p><p>Pick the <b>Paint</b> tool on the cloth to set loops with a click.</p></section>';
    } else {
      var f = s.feeds[sel.i] || {};
      if (sel.j != null) {
        var g = sel.bed === 'C' ? s.C : s.D, sym = g && g[sel.i] ? g[sel.i][sel.j] : '-', ex = '';
        try { ex = D.explain({ act: sym, held: 0, tucks: 0, feed: sel.i, bed: sel.bed, needle: sel.j + 1 }); } catch (_) { ex = ''; }
        h += '<section class="fw-sec"><div class="fw-k">Loop</div><div class="fw-cellhead"><span class="fw-sym m-' + (sym === '-' ? 'x' : sym) + '">' + (sym === '-' ? '&ndash;' : esc(sym)) + '</span><div><div class="fw-big">F' + (sel.i + 1) + ' &middot; ' + (sel.bed === 'C' ? 'cylinder' : 'dial') + ' needle ' + (sel.j + 1) + '</div><div class="fw-sub">' + esc(NAMES[sym] || sym) + '</div></div></div>' +
          '<p class="fw-expl">' + esc(ex) + '</p>' +
          '<div class="fw-k">Set to</div><div class="fw-setrow">' + ['K', 'T', 'M', 'E', 'R', '-'].map(function (c) { return '<button type="button" class="fw-set m-' + (c === '-' ? 'x' : c) + (c === sym ? ' on' : '') + '" data-set="' + c + '" title="' + NAMES[c] + '">' + (c === '-' ? '&ndash;' : c) + '</button>'; }).join('') + '</div>' +
          '<div class="fw-k">Applies to</div><div class="fw-scope">' + [['cell', 'One needle', I.cell], ['row', 'Whole feeder', I.row], ['col', 'Needle column', I.col]].map(function (x) { return '<button type="button" data-scope="' + x[0] + '" class="' + (st.scope === x[0] ? 'on' : '') + '">' + x[2] + '<span>' + x[1] + '</span></button>'; }).join('') + '</div>' +
          '<div class="fw-arrows"><button type="button" data-step="left" aria-label="Previous needle">&larr;</button><button type="button" data-step="up" aria-label="Previous feeder">&uarr;</button><button type="button" data-step="down" aria-label="Next feeder">&darr;</button><button type="button" data-step="right" aria-label="Next needle">&rarr;</button><span>move the selection</span></div></section>';
      }
      h += '<section class="fw-sec"><div class="fw-k">Feeder F' + (sel.i + 1) + '</div>' +
        '<div class="fw-row"><label>Yarn role<select data-ik="role">' + ROLES.map(function (r) { return '<option' + ((f.role || 'ground') === r ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select></label>' +
        '<label>Count<input type="number" min="1" max="2000" step="0.1" data-ik="count" placeholder="role yarn" value="' + esc(f.count || f.ne || '') + '"></label>' +
        '<label>Unit<select data-ik="unit">' + UNITS.map(function (u) { return '<option value="' + u[0] + '"' + ((f.unit || 'ne') === u[0] ? ' selected' : '') + '>' + u[1] + '</option>'; }).join('') + '</select></label></div>' +
        '<label class="fw-check"><input type="checkbox" data-ik="plate"' + (f.plate ? ' checked' : '') + '> Plate a second yarn behind this feeder</label>' +
        '<div class="fw-k">Yarn colour</div><div class="fw-chips"><button type="button" class="fw-chip none' + (f.colour ? '' : ' on') + '" data-chip="" title="No stripe colour">&ndash;</button>' +
        LETTERS.map(function (L) { return '<button type="button" class="fw-chip" data-chip="' + L + '" title="Colour ' + L + '">' + L + '</button>'; }).join('') + '<input type="color" class="fw-pick" data-pal="' + (f.colour || 'A') + '" value="' + hexOf(f.colour || 'A') + '" title="Change this colour" aria-label="Change this colour"></div>' +
        '<button type="button" class="st-btn" data-iso="1">' + (sel.j != null ? 'Show the whole feeder in the cloth' : 'Clear the feeder highlight') + '</button></section>';
    }
    E.inspPane.innerHTML = h;
    chips();
  }

  // ── docks, panels, grips ──
  function tab(side, i) {
    var s = E[side]; i = Math.max(0, Math.min(s.tabs.length - 1, i)); lay[side === 'left' ? 'lt' : 'rt'] = i; saveLay();
    s.tabs.forEach(function (b, k) { b.classList.toggle('on', k === i); b.setAttribute('aria-selected', k === i ? 'true' : 'false'); });
    s.list.forEach(function (p, k) { p.hidden = k !== i; });
    s.list[i].querySelectorAll(':scope > .st-card > details').forEach(function (d) { d.open = true; });
    if (side === 'left' && i === 1) renderFeeders();
    if (side === 'right' && i === 0) renderInspector();
  }
  function reveal(side, i) {
    if (narrow.matches) { mobileNav(side === 'left' ? (i === 1 ? 'feeders' : 'draw') : (i === 0 ? 'inspect' : 'colour')); tab(side, i); return; }
    setPanel(side, true); tab(side, i);
  }
  function setPanel(side, on) {
    lay[side] = !!on; saveLay();
    fw.classList.toggle('no-' + side, !on);
    var b = fw.querySelector('.fw-actions [data-fw="' + side + '"]'); if (b) b.classList.toggle('on', !!on);
    resized();
  }
  function widths() { fw.style.setProperty('--fw-l', lay.lw + 'px'); fw.style.setProperty('--fw-r', lay.rw + 'px'); fw.style.setProperty('--fw-sh', (lay.sh || Math.round(window.innerHeight * 0.44)) + 'px'); }
  function grip(el, side) {
    if (!el) return;
    el.addEventListener('pointerdown', function (e) {
      e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('drag');
      var x0 = e.clientX, w0 = side === 'left' ? lay.lw : lay.rw, max = Math.max(300, window.innerWidth - 520);
      var move = function (ev) { var d = ev.clientX - x0, w = Math.max(280, Math.min(max, w0 + (side === 'left' ? d : -d))); lay[side === 'left' ? 'lw' : 'rw'] = Math.round(w); widths(); later(place); };
      var up = function () { el.classList.remove('drag'); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); saveLay(); resized(); };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
    el.addEventListener('dblclick', function () { lay[side === 'left' ? 'lw' : 'rw'] = side === 'left' ? 400 : 360; widths(); saveLay(); resized(); });
  }
  // the phone's sheet: drag its handle to make it taller or shorter
  function handle(el) {
    if (!el) return;
    el.addEventListener('pointerdown', function (e) {
      e.preventDefault(); el.setPointerCapture(e.pointerId);
      var y0 = e.clientY, h0 = lay.sh || Math.round(window.innerHeight * 0.44), max = Math.round(window.innerHeight * 0.82);
      var move = function (ev) { lay.sh = Math.round(Math.max(150, Math.min(max, h0 + (y0 - ev.clientY)))); widths(); later(place); };
      var up = function () { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); saveLay(); resized(); };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
  }
  function mobileNav(k) {
    var map = { cloth: ['', 0], feeders: ['left', 1], draw: ['left', 0], inspect: ['right', 0], colour: ['right', 1] }, m = map[k] || map.cloth;
    fw.setAttribute('data-sheet', m[0]);
    if (m[0]) { fw.classList.remove('no-' + m[0]); tab(m[0], m[1]); }
    Array.prototype.forEach.call(fw.querySelectorAll('.fw-mtabs [data-mn]'), function (b) { b.classList.toggle('on', b.getAttribute('data-mn') === k); });
    resized();
  }

  // ── the tools and views float over the cloth: they follow the place the cloth is drawn in ──
  function place() {
    if (!open || !E.centre) return;
    var host = ['st-loops', 'st-cloth', 'st-yarn', 'st-twin'].map($).filter(function (h) { return h && !h.hidden && h.offsetParent; })[0];
    var on3d = !!host && !!q('#pane-3d.on');
    fw.classList.toggle('no-canvas', !on3d);
    if (!on3d) return;
    // the part of the drawing area that is on screen (the card clips it when the window is short)
    var cr = E.centre.getBoundingClientRect(), hr = host.getBoundingClientRect(), vr = (q('#ws-view') || host).getBoundingClientRect();
    var top = Math.max(hr.top, vr.top), bottom = Math.min(hr.bottom, vr.bottom), left = Math.max(hr.left, vr.left), right = Math.min(hr.right, vr.right);
    if (bottom - top < 70 || right - left < 120) { fw.classList.add('no-canvas'); return; }
    E.centre.style.setProperty('--cv-t', Math.round(top - cr.top) + 'px'); E.centre.style.setProperty('--cv-l', Math.round(left - cr.left) + 'px');
    E.centre.style.setProperty('--cv-w', Math.round(right - left) + 'px'); E.centre.style.setProperty('--cv-h', Math.round(bottom - top) + 'px');
    fw.classList.toggle('on-loops', host.id === 'st-loops');
  }
  function syncGizmo() {
    var m = q('#st-3dmode .on'), mode = m && m.getAttribute('data-mode'), v = window.__loopView, view = v && v._lastView;
    Array.prototype.forEach.call(fw.querySelectorAll('[data-gm]'), function (b) { b.classList.toggle('on', b.getAttribute('data-gm') === mode); });
    Array.prototype.forEach.call(fw.querySelectorAll('[data-gv]'), function (b) { b.classList.toggle('on', b.getAttribute('data-gv') === view && (mode === 'loops' || mode === 'both')); });
  }
  function syncRail() {
    var cur = D.state().brush;
    Array.prototype.forEach.call(fw.querySelectorAll('.fw-rail [data-brush]'), function (b) {
      var s = b.getAttribute('data-brush'), p = q('#st-pal [data-s="' + s + '"]');
      b.classList.toggle('on', s === cur); b.disabled = !!(p && p.disabled);
    });
    var h = D.history(), u = fw.querySelector('[data-fw="undo"]'), r = fw.querySelector('[data-fw="redo"]');
    if (u) u.disabled = !h.undo;
    if (r) r.disabled = !h.redo;
    hint();
  }

  // ── moving the cards in, and back ──
  function take(sel, host) {
    var n = q(sel); if (!n || !n.parentNode) return null;
    var ph = document.createComment('fw'); n.parentNode.insertBefore(ph, n); host.appendChild(n); moved.push([n, ph]); return n;
  }
  function release() {
    while (moved.length) { var m = moved.pop(); if (m[1].parentNode) m[1].parentNode.replaceChild(m[0], m[1]); }
  }
  function viewerTabs() {
    var on = q('.st-tabs .on');
    document.querySelectorAll('.st-tabs [data-tab]').forEach(function (b) { var i = VIEW_TABS.indexOf(b.getAttribute('data-tab')); b.style.display = i < 0 ? 'none' : ''; b.style.order = i < 0 ? 99 : i; });
    if (!on || VIEW_TABS.indexOf(on.getAttribute('data-tab')) < 0) { var t = q('.st-tabs [data-tab="3d"]'); if (t) t.click(); }
  }

  function openIt() {
    if (open) return;
    D = window.KAStudioDesign;
    var weft = $('st-weft'); if (!weft || weft.hidden || !D) return;
    build(); loadLay(); widths();
    lastFocus = document.activeElement;
    LEFT.forEach(function (t, i) { (t[1] || []).forEach(function (s) { take(s, E.left.list[i]); }); });
    RIGHT.forEach(function (t, i) { (t[1] || []).forEach(function (s) { take(s, E.right.list[i]); }); });
    take(CENTRE, E.centre);
    open = true; fw.hidden = false;
    document.documentElement.setAttribute('data-fullwindow', '1');
    fw.classList.toggle('no-left', !lay.left); fw.classList.toggle('no-right', !lay.right);
    Array.prototype.forEach.call(fw.querySelectorAll('.fw-actions [data-fw="left"], .fw-actions [data-fw="right"]'), function (b) { b.classList.toggle('on', !!lay[b.getAttribute('data-fw')]); });
    tab('left', lay.lt); tab('right', lay.rt);
    viewerTabs(); mirror(lastResult);
    fw.setAttribute('data-sheet', ''); st.sel = null; st.hover = null;
    setTool(st.tool); setScope(st.scope); syncRail(); syncGizmo(); info(); renderFeeders(); renderInspector();
    var x = fw.querySelector('.fw-x'); if (x) x.focus();
    resized(); setTimeout(function () { resized(); fit(); syncGizmo(); }, 250);
  }
  function close() {
    if (!open) return;
    var v = lv(); if (v) { v.markCell(null); if (v._hl != null) v.highlight(null); }
    open = false; fw.hidden = true; E.help.hidden = true;
    Array.prototype.forEach.call(document.querySelectorAll('#st-editor .fw-sel, #st-editor .fw-selrow'), function (n) { n.classList.remove('fw-sel', 'fw-selrow'); });
    release();
    document.documentElement.removeAttribute('data-fullwindow');
    // the workspace puts its step, its tabs and its viewer back as they were
    if (window.KAStudioShell) window.KAStudioShell.go('weft', window.KAStudioShell.step('weft'), true);
    resized();
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (_) { /* gone */ } }
  }
  function fit() { var v = lv(); if (v && !v._close) { v.view(v._lastView || 'angle'); v.redraw(); } }

  // ── the strip at the top: the same verdict the steps show ──
  function mirror(r) {
    var v = q('#st-weft .ws-verdict'); if (!v || !E.verdict) return;
    E.verdict.className = 'fw-verdict ' + ((/\b(ok|warn|bad)\b/.exec(v.className) || [''])[0]);
    E.verdict.innerHTML = v.innerHTML;
    var t = r && r.structure && r.structure.identity && r.structure.identity.title;
    if (t && E.what) E.what.textContent = t;
  }

  // ── keys ──
  function onKey(e) {
    if (!open) return;
    if (e.key === 'Escape') { if (!E.help.hidden) E.help.hidden = true; else if (st.sel) select(null); else close(); e.preventDefault(); return; }
    var t = e.target;
    if (t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)) return;
    var k = (e.key || '').toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (k === 'z') { D.op(e.shiftKey ? 'redo' : 'undo'); e.preventDefault(); } else if (k === 'y') { D.op('redo'); e.preventDefault(); }
      return;
    }
    if (e.altKey) return;
    var arrows = { arrowleft: 'left', arrowright: 'right', arrowup: 'up', arrowdown: 'down' }, b;
    if (BRUSH[k]) { var p = q('#st-pal [data-s="' + BRUSH[k] + '"]'); if (p && !p.disabled) { D.setBrush(BRUSH[k]); setTool('paint'); e.preventDefault(); } }
    else if (k === 'v') { setTool('select'); e.preventDefault(); }
    else if (k === 'b') { setTool('paint'); e.preventDefault(); }
    else if (arrows[k]) { stepSel(arrows[k]); e.preventDefault(); }
    else if ((k === 'enter' || k === ' ') && st.sel && st.sel.j != null) { paintSel(st.sel); e.preventDefault(); }
    else if (VIEWS[k]) { b = q('#st-loopbar [data-view="' + VIEWS[k] + '"]'); if (b) { b.click(); setTimeout(syncGizmo, 60); e.preventDefault(); } }
    else if (k === 'f') { fit(); e.preventDefault(); }
    else if (k === '[') { setPanel('left', !lay.left); e.preventDefault(); }
    else if (k === ']') { setPanel('right', !lay.right); e.preventDefault(); }
    else if (k === '?') { E.help.hidden = !E.help.hidden; e.preventDefault(); }
  }

  // ── what the page tells us ──
  function onEdit() {
    if (!open) return;
    later(function () {
      var z = D.size();
      if (st.sel && (st.sel.i >= z.F || (st.sel.j != null && st.sel.j >= z.W))) st.sel = null;
      paintMarks(); renderFeeders(); renderInspector(); syncRail(); info(); place(); syncGizmo();
    });
  }

  // ── the doors: a button over the cloth, and one in the heads of the Yarn and Design steps ──
  function doors() {
    var weft = $('st-weft'); if (!weft) return;
    var btn = function (cls) { var b = mk('button', 'st-btn primary ' + cls, '<span aria-hidden="true">&#x26F6;</span> Open the design studio &mdash; full window'); b.type = 'button'; b.title = 'Draw, colour and look at the cloth in the whole window'; b.addEventListener('click', openIt); return b; };
    var right = weft.querySelector('.ws-right'), verdict = right && right.querySelector('.ws-verdict');
    if (right && verdict) {
      var row = mk('div', 'fw-enter'); row.appendChild(btn(''));
      // the cloth on the screen, taken to the Garment studio: its weight, width, shrinkage and colour
      var gb = mk('button', 'st-btn fw-garment', 'Make a garment from this fabric &rarr;'); gb.type = 'button'; gb.title = 'Open the Garment studio with this cloth: patterns, marker and a 3D garment';
      gb.addEventListener('click', function () { var h = window.KAStudioHost && window.KAStudioHost.fabric && window.KAStudioHost.fabric(); if (!h) { gb.textContent = 'Draw a structure first'; setTimeout(function () { gb.innerHTML = 'Make a garment from this fabric &rarr;'; }, 2200); return; } try { localStorage.setItem('ka_garment_fabric', JSON.stringify(h)); } catch (_) { /* private window */ } location.href = '/garment.html?fabric=studio'; });
      row.appendChild(gb); right.insertBefore(row, verdict);
    }
    ['ws-weft-yarn', 'ws-weft-design'].forEach(function (id) { var h = $(id) && $(id).querySelector('.ws-stagehead'); if (h) h.appendChild(btn('fw-open')); });
  }

  function init() {
    if (!$('st-weft')) return;
    doors();
    document.addEventListener('keydown', onKey);
    document.addEventListener('ka-studio-result', function (e) { lastResult = e.detail; if (open) setTimeout(function () { mirror(e.detail); renderFeeders(); }, 0); });
    document.addEventListener('ka-design-edit', onEdit);
    document.addEventListener('ka-brush', function () { if (open) { syncRail(); later(renderInspector); } });
    document.addEventListener('ka-3d-pick', onPick);
    document.addEventListener('ka-3d-hover', onHoverStitch);
    document.addEventListener('click', function (e) {
      if (!open) return;
      var b = e.target.closest && e.target.closest('[data-op-x]'); if (b) { D.op(b.getAttribute('data-op-x')); return; }
      if (e.target.closest && e.target.closest('.fw-centre')) setTimeout(function () { place(); syncGizmo(); }, 80);
    });
  }
  window.KAStudioFullWindow = { open: openIt, close: close, isOpen: function () { return open; }, select: function (c) { if (open) select(c || null, { reveal: true }); } };
  try { init(); } catch (err) { if (window.console) console.error('studio-fullwindow', err); }
})();
