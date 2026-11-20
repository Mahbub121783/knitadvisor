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
  var SIMPLE_TABS = ['sheet', '3d', 'results', 'notation', 'setup'];
  var ORDER = ['sheet', '3d', 'results', 'notation', 'setup', 'needle', 'machine'];
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
    if (simple) { var on = document.querySelector('.st-tabs .on'); if (on && on.style.display === 'none') { var b3 = document.querySelector('.st-tabs [data-tab="3d"]'); if (b3) b3.click(); } }
    var btn = $('st-modebtn');
    if (btn) { btn.textContent = simple ? 'Show expert tools' : 'Hide expert tools'; btn.setAttribute('aria-pressed', simple ? 'false' : 'true'); }
    var n = $('st-modenote'); if (n) n.textContent = simple ? 'Simple: the drawing, the sheet and the 3D view. The research cards are hidden, not removed.' : 'Expert: every card is shown and feeds the answer.';
  }

  function init() {
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
