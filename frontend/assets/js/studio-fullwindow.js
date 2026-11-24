/**
 * Fabric Studio — the design studio.
 *
 * The Design step of the workspace is a column beside a small cloth. This opens the same work in the whole window, the way a 3D design tool does: the
 * drawing and its feeders on the left, the cloth in the middle (it takes the space), the colourway, the jacquard picture, the yarn and the checks on
 * the right. Nothing is rebuilt: the cards are MOVED in and put back where they were, so every id, listener and engine call is the one it was.
 *
 * Keys (outside a field): K T M E R - choose the brush · Ctrl+Z undo · 1 2 3 4 face, back, edge, angle · F fit the cloth · [ ] hide the panels · ? this list · Esc leave.
 * Plain script. window.KAStudioFullWindow: open(), close(), isOpen().
 */
(function () {
  'use strict';
  var LS = 'ka_fw_layout_v1';

  var LEFT = [['Programme', ['#ws-c-draw']], ['Start from', ['#ws-c-fab', '#ws-c-target']], ['Cam sheet', ['#cs-card']]];
  var RIGHT = [['Colourway', ['#cw-card']], ['Picture', ['#jq-card']], ['Yarn', ['#ws-c-yarn']], ['Checks', ['#ws-c-status']]];
  var CENTRE = '#ws-view';
  var VIEW_TABS = ['3d', 'notation', 'needle', 'colours', 'results'];
  var KEYS = { k: 'K', t: 'T', m: 'M', e: 'E', r: 'R', '-': '-' };
  var VIEWS = { '1': 'face', '2': 'back', '3': 'edge', '4': 'angle' };

  var fw = null, open = false, moved = [], lastFocus = null, lastResult = null, E = {};
  var lay = { lw: 400, rw: 360, left: true, right: true, lt: 0, rt: 0 };

  function $(id) { return document.getElementById(id); }
  function q(s) { return document.querySelector(s); }
  function mk(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function loadLay() { try { var o = JSON.parse(localStorage.getItem(LS) || '{}'); Object.keys(lay).forEach(function (k) { if (o[k] != null && typeof o[k] === typeof lay[k]) lay[k] = o[k]; }); } catch (_) { /* private window */ } }
  function saveLay() { try { localStorage.setItem(LS, JSON.stringify(lay)); } catch (_) { /* private window */ } }
  function resized() { requestAnimationFrame(function () { window.dispatchEvent(new Event('resize')); }); }

  // ── the window ──
  function build() {
    if (fw) return fw;
    fw = mk('div', 'fw'); fw.id = 'fw'; fw.hidden = true; fw.setAttribute('role', 'dialog'); fw.setAttribute('aria-label', 'Design studio'); fw.setAttribute('data-m', 'centre');
    fw.innerHTML =
      '<header class="fw-top">' +
        '<button type="button" class="st-btn fw-x" data-fw="exit" title="Back to the steps (Esc)">&larr; Steps</button>' +
        '<div class="fw-title"><b>Design studio</b><span id="fw-what">Draw, colour and look at the cloth in one window</span></div>' +
        '<div class="fw-verdict" id="fw-verdict" title="Open the checks"><span class="ws-vtext">Draw a structure to begin.</span></div>' +
        '<div class="fw-actions">' +
          '<button type="button" class="st-btn on" data-fw="left" title="Show or hide the drawing panel ( [ )">Draw</button>' +
          '<button type="button" class="st-btn on" data-fw="right" title="Show or hide the colour panel ( ] )">Look</button>' +
          '<button type="button" class="st-btn" data-fw="fit" title="Fit the cloth to the window (F)">Fit</button>' +
          '<button type="button" class="st-btn" data-fw="help" title="Keys (?)">?</button>' +
        '</div>' +
      '</header>' +
      '<nav class="fw-mtabs"><button type="button" data-m="left">Draw</button><button type="button" data-m="centre" class="on">Cloth</button><button type="button" data-m="right">Look</button></nav>' +
      '<div class="fw-body">' +
        '<aside class="fw-side fw-left" aria-label="Drawing"><nav class="fw-tabs" role="tablist"></nav><div class="fw-panes"></div></aside>' +
        '<div class="fw-grip" data-side="left" role="separator" aria-orientation="vertical" title="Drag to resize"></div>' +
        '<main class="fw-centre"></main>' +
        '<div class="fw-grip" data-side="right" role="separator" aria-orientation="vertical" title="Drag to resize"></div>' +
        '<aside class="fw-side fw-right" aria-label="Colour and picture"><nav class="fw-tabs" role="tablist"></nav><div class="fw-panes"></div></aside>' +
      '</div>' +
      '<footer class="fw-foot"><span><kbd>K</kbd> <kbd>T</kbd> <kbd>M</kbd> <kbd>E</kbd> <kbd>R</kbd> <kbd>-</kbd> brush</span><span><kbd>Ctrl</kbd>+<kbd>Z</kbd> undo</span><span><kbd>1</kbd>–<kbd>4</kbd> face · back · edge · angle</span><span><kbd>F</kbd> fit</span><span><kbd>[</kbd> <kbd>]</kbd> panels</span><span><kbd>Esc</kbd> leave</span></footer>' +
      '<div class="fw-help" id="fw-help" hidden><b>Keys</b>' +
        '<div><span>Choose the brush: knit, tuck, miss, transfer, to other bed, no needle</span><span><kbd>K</kbd> <kbd>T</kbd> <kbd>M</kbd> <kbd>E</kbd> <kbd>R</kbd> <kbd>-</kbd></span></div>' +
        '<div><span>Undo the last edit</span><span><kbd>Ctrl</kbd> <kbd>Z</kbd></span></div>' +
        '<div><span>Face, back, edge, angle of the loop view</span><span><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd></span></div>' +
        '<div><span>Fit the cloth to the window</span><span><kbd>F</kbd></span></div>' +
        '<div><span>Hide or show the drawing / the colour panel</span><span><kbd>[</kbd> <kbd>]</kbd></span></div>' +
        '<div><span>Scroll over the cloth to zoom, drag to turn it</span><span>mouse</span></div>' +
        '<div><span>Leave the design studio</span><span><kbd>Esc</kbd></span></div>' +
      '</div>';
    document.body.appendChild(fw);
    E = { top: fw.querySelector('.fw-top'), verdict: $('fw-verdict'), what: $('fw-what'), centre: fw.querySelector('.fw-centre'), help: $('fw-help'),
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
    fw.addEventListener('click', onClick);
    E.verdict.addEventListener('click', function () { setPanel('right', true); tab('right', 3); });
    // the wheel zooms the cloth here: the page behind does not scroll, so the guard that keeps a wheel for the page has nothing to protect
    E.centre.addEventListener('wheel', function (e) { var t = e.target; if (t && t.tagName === 'CANVAS' && window.KAViewGuard) { var s = window.KAViewGuard.watch(t); if (s) s.armed = true; } }, true);
    ['left', 'right'].forEach(function (s) { grip(fw.querySelector('.fw-grip[data-side="' + s + '"]'), s); });
    return fw;
  }

  function onClick(e) {
    var b = e.target.closest && e.target.closest('[data-fw]');
    if (b) {
      var a = b.getAttribute('data-fw');
      if (a === 'exit') close();
      else if (a === 'left' || a === 'right') setPanel(a, !lay[a]);
      else if (a === 'fit') fit();
      else if (a === 'help') E.help.hidden = !E.help.hidden;
      return;
    }
    var m = e.target.closest && e.target.closest('.fw-mtabs [data-m]');
    if (m) mobile(m.getAttribute('data-m'));
    else if (!e.target.closest('.fw-help') && !E.help.hidden) E.help.hidden = true;
  }
  function mobile(k) {
    fw.setAttribute('data-m', k);
    Array.prototype.forEach.call(fw.querySelectorAll('.fw-mtabs [data-m]'), function (x) { x.classList.toggle('on', x.getAttribute('data-m') === k); });
    resized();
  }

  // ── the panels ──
  function tab(side, i) {
    var s = E[side]; i = Math.max(0, Math.min(s.tabs.length - 1, i)); lay[side === 'left' ? 'lt' : 'rt'] = i; saveLay();
    s.tabs.forEach(function (b, k) { b.classList.toggle('on', k === i); b.setAttribute('aria-selected', k === i ? 'true' : 'false'); });
    s.list.forEach(function (p, k) { p.hidden = k !== i; });
    // the jacquard card is a closed drawer in the page: here it is the whole tab
    s.list[i].querySelectorAll(':scope > .st-card > details').forEach(function (d) { d.open = true; });
  }
  function setPanel(side, on) {
    lay[side] = !!on; saveLay();
    fw.classList.toggle('no-' + side, !on);
    var b = fw.querySelector('.fw-actions [data-fw="' + side + '"]'); if (b) b.classList.toggle('on', !!on);
    if (!on && fw.getAttribute('data-m') === side) mobile('centre');
    resized();
  }
  function widths() { fw.style.setProperty('--fw-l', lay.lw + 'px'); fw.style.setProperty('--fw-r', lay.rw + 'px'); }
  function grip(el, side) {
    if (!el) return;
    el.addEventListener('pointerdown', function (e) {
      e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('drag');
      var x0 = e.clientX, w0 = side === 'left' ? lay.lw : lay.rw, max = Math.max(300, window.innerWidth - 520);
      var move = function (ev) { var d = ev.clientX - x0, w = Math.max(280, Math.min(max, w0 + (side === 'left' ? d : -d))); lay[side === 'left' ? 'lw' : 'rw'] = Math.round(w); widths(); };
      var up = function () { el.classList.remove('drag'); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); saveLay(); resized(); };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
    el.addEventListener('dblclick', function () { lay[side === 'left' ? 'lw' : 'rw'] = side === 'left' ? 400 : 360; widths(); saveLay(); resized(); });
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
    var weft = $('st-weft'); if (!weft || weft.hidden) return;
    build(); loadLay(); widths();
    lastFocus = document.activeElement;
    LEFT.forEach(function (t, i) { t[1].forEach(function (s) { take(s, E.left.list[i]); }); });
    RIGHT.forEach(function (t, i) { t[1].forEach(function (s) { take(s, E.right.list[i]); }); });
    take(CENTRE, E.centre);
    open = true; fw.hidden = false;
    document.documentElement.setAttribute('data-fullwindow', '1');
    fw.classList.toggle('no-left', !lay.left); fw.classList.toggle('no-right', !lay.right);
    Array.prototype.forEach.call(fw.querySelectorAll('.fw-actions [data-fw="left"], .fw-actions [data-fw="right"]'), function (b) { b.classList.toggle('on', !!lay[b.getAttribute('data-fw')]); });
    tab('left', lay.lt); tab('right', lay.rt);
    viewerTabs(); mirror(lastResult);
    mobile('centre');
    var x = fw.querySelector('.fw-x'); if (x) x.focus();
    resized(); setTimeout(function () { resized(); fit(); }, 250);
  }
  function close() {
    if (!open) return;
    open = false; fw.hidden = true; E.help.hidden = true;
    release();
    document.documentElement.removeAttribute('data-fullwindow');
    // the workspace puts its step, its tabs and its viewer back as they were
    if (window.KAStudioShell) window.KAStudioShell.go('weft', window.KAStudioShell.step('weft'), true);
    resized();
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (_) { /* gone */ } }
  }

  function fit() {
    var lv = window.__loopView;
    if (lv && lv.geo && !lv._close) { lv.view(lv._lastView || 'angle'); lv.redraw(); }
  }

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
    if (e.key === 'Escape') { if (!E.help.hidden) E.help.hidden = true; else close(); e.preventDefault(); return; }
    var t = e.target;
    if (t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey) { if ((e.key || '').toLowerCase() === 'z' && !e.shiftKey) { var u = q('#st-edtools [data-op="undo"]'); if (u) { u.click(); e.preventDefault(); } } return; }
    if (e.altKey) return;
    var k = (e.key || '').toLowerCase(), b;
    if (KEYS[k]) { b = q('#st-pal [data-s="' + KEYS[k] + '"]'); if (b && !b.disabled) { b.click(); e.preventDefault(); } }
    else if (VIEWS[k]) { b = q('#st-loopbar [data-view="' + VIEWS[k] + '"]'); if (b && b.offsetParent) { b.click(); e.preventDefault(); } }
    else if (k === 'f') { fit(); e.preventDefault(); }
    else if (k === '[') { setPanel('left', !lay.left); e.preventDefault(); }
    else if (k === ']') { setPanel('right', !lay.right); e.preventDefault(); }
    else if (k === '?') { E.help.hidden = !E.help.hidden; e.preventDefault(); }
  }

  // ── the doors: a button over the cloth, and one in the heads of the Yarn and Design steps ──
  function doors() {
    var weft = $('st-weft'); if (!weft) return;
    var btn = function (cls) { var b = mk('button', 'st-btn primary ' + cls, '<span aria-hidden="true">&#x26F6;</span> Open the design studio &mdash; full window'); b.type = 'button'; b.title = 'Draw, colour and look at the cloth in the whole window'; b.addEventListener('click', openIt); return b; };
    var right = weft.querySelector('.ws-right'), verdict = right && right.querySelector('.ws-verdict');
    if (right && verdict) { var row = mk('div', 'fw-enter'); row.appendChild(btn('')); right.insertBefore(row, verdict); }
    ['ws-weft-yarn', 'ws-weft-design'].forEach(function (id) { var h = $(id) && $(id).querySelector('.ws-stagehead'); if (h) h.appendChild(btn('fw-open')); });
  }

  function init() {
    if (!$('st-weft')) return;
    doors();
    document.addEventListener('keydown', onKey);
    document.addEventListener('ka-studio-result', function (e) { lastResult = e.detail; if (open) setTimeout(function () { mirror(e.detail); }, 0); });
  }
  window.KAStudioFullWindow = { open: openIt, close: close, isOpen: function () { return open; } };
  try { init(); } catch (err) { if (window.console) console.error('studio-fullwindow', err); }
})();
