/**
 * Fabric Studio — Simple and Expert.
 *
 * An R&D person needs the drawing, the development sheet and the 3D view. The research cards (yarn blends, fancy yarns, chemistry, recovery, hand, colour,
 * lab, inspection, drape, melange, mill readings, the machine card…) are still all there and all still feed the answer: Simple hides them, Expert shows
 * them. Nothing is removed; the default is the short road.
 *
 * Simple (default): the R&D card, what you are making, start-from and bed, trial rolls, save, machine files, the needle programme; tabs: Development sheet,
 * 3D fabric, Fabric & yarn, Notation, Cam & needle set-out.
 */
(function () {
  'use strict';
  var KEY = 'ka_studio_mode';
  var EXPERT_IDS = ['bl-card', 'fy-card', 'ch-card', 'rc-card', 'hd-card', 'cl-card', 'lb-card', 'in-card', 'dp-card', 'ml-card', 'vb-card', 'inv-card'];
  var EXPERT_STEPS = /^(2|3|3b|4)\b|Calibration measurements|Design from a goal/;
  var SIMPLE_TABS = ['sheet', 'results', 'notation', 'setup'];
  var ORDER = ['sheet', 'results', 'notation', 'setup', 'needle', 'machine'];
  var mode = 'simple';
  function $(id) { return document.getElementById(id); }
  function get() { try { return localStorage.getItem(KEY) === 'expert' ? 'expert' : 'simple'; } catch (_) { return 'simple'; } }
  function save(m) { try { localStorage.setItem(KEY, m); } catch (_) { /* private window */ } }

  function expertCards() {
    var out = [];
    document.querySelectorAll('#st-weft .st-card').forEach(function (c) {
      if (c.id === 'sh-card') return;
      var step = c.querySelector(':scope > .st-step'), t = step ? step.textContent.replace(/\s+/g, ' ').trim() : '';
      if (EXPERT_IDS.indexOf(c.id) > -1 || EXPERT_STEPS.test(t)) out.push(c);
    });
    return out;
  }

  function orderTabs() {
    var bar = document.querySelector('.st-tabs'); if (!bar) return;
    ORDER.slice().reverse().forEach(function (t) { var b = bar.querySelector('[data-tab="' + t + '"]'); if (b) bar.insertBefore(b, bar.firstChild); });
  }

  function apply(m) {
    mode = m; save(m);
    var simple = m === 'simple';
    expertCards().forEach(function (c) { if (simple) { c.setAttribute('data-expert', '1'); c.style.display = 'none'; } else { c.removeAttribute('data-expert'); c.style.display = ''; } });
    document.querySelectorAll('.st-tabs [data-tab]').forEach(function (b) { b.style.display = simple && SIMPLE_TABS.indexOf(b.getAttribute('data-tab')) < 0 ? 'none' : ''; });
    if (simple) { var on = document.querySelector('.st-tabs .on'); if (!on || on.style.display === 'none') { var bs = document.querySelector('.st-tabs [data-tab="sheet"]'); if (bs) bs.click(); } }
    var b3h = document.querySelector('.st-tabs [data-tab="3d"]'); if (b3h && $('st-tabcard')) b3h.style.display = 'none';      // the 3D is pinned beside the design, not a tab
    var btn = $('st-modebtn');
    if (btn) { btn.textContent = simple ? 'Show expert tools' : 'Hide expert tools'; btn.setAttribute('aria-pressed', simple ? 'false' : 'true'); }
    var n = $('st-modenote'); if (n) n.textContent = simple ? 'Simple: the drawing, the sheet and the 3D view. The research cards are hidden, not removed.' : 'Expert: every card is shown and feeds the answer.';
  }

  // the 3D views stay beside the design, always: they leave the tab system, and the other tabs move to a card of their own
  // under the design's status, so opening the sheet or the notation never hides the cloth
  function pinViews() {
    var pane = $('pane-3d'), tabs = document.querySelector('#st-weft .st-view .st-tabs'), status = $('st-checks');
    if (!pane || !tabs || !status || $('st-tabcard')) return;
    var host = status.closest('.st-card');
    var card = document.createElement('div'); card.className = 'st-card'; card.id = 'st-tabcard';
    host.parentNode.insertBefore(card, host.nextSibling);
    card.appendChild(tabs);
    Array.prototype.forEach.call(document.querySelectorAll('#st-weft .st-view .st-pane'), function (p) { if (p !== pane) card.appendChild(p); });
    pane.classList.remove('st-pane'); pane.classList.add('on');
    // the views first; saving a picture and the material package go under them
    ['st-savebar', 'st-pbrbar'].forEach(function (id) { var b = $(id); if (b) pane.appendChild(b); });
    var b3 = tabs.querySelector('[data-tab="3d"]'); if (b3) b3.style.display = 'none';
    if (!tabs.querySelector('.on') || (tabs.querySelector('.on') === b3)) { var bs = tabs.querySelector('[data-tab="sheet"]'); if (bs) bs.click(); }
    if (!$('st-livetag')) { var t = document.createElement('span'); t.id = 'st-livetag'; t.className = 'st-livetag'; t.textContent = '● live: follows every edit'; pane.insertBefore(t, pane.firstChild); }
    // loops + real, both live, is where the Studio opens
    var both = document.querySelector('#st-3dmode [data-mode="both"]'); if (both) both.click();
  }

  function init() {
    pinViews();
    var card = $('sh-card'); if (!card) return;
    var head = card.querySelector('.st-step');
    if (head && !$('st-modebtn')) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'st-btn'; b.id = 'st-modebtn'; b.style.cssText = 'float:right;font-size:12px;padding:3px 9px'; head.appendChild(b);
      b.addEventListener('click', function () { apply(mode === 'simple' ? 'expert' : 'simple'); });
      var n = document.createElement('div'); n.id = 'st-modenote'; n.className = 'st-hint'; n.style.margin = '0 0 6px'; head.parentNode.insertBefore(n, head.nextSibling);
    }
    orderTabs();
    apply(get());
    // cards fill themselves after load: apply again once they exist
    setTimeout(function () { apply(mode); }, 1200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else window.addEventListener('load', init);
  window.KAStudioMode = { apply: apply, mode: function () { return mode; } };
})();
