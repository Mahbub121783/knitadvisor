/**
 * KnitAdvisor — shared page shell (header + footer).
 *
 * Every product page used to carry its own copy of the header — nine emoji
 * pill buttons in a row — and its own footer, which had drifted (one still
 * said "29 fabric structures"). This builds both from one place so they cannot
 * drift again, and adds the account menu.
 *
 * Runs against the existing <header class="hdr"> and <footer class="footer">
 * elements, replacing their contents. A page with neither is left alone.
 */
(function () {
  'use strict';

  var host = window.location.hostname;
  var API = (host === '127.0.0.1' || host === 'localhost')
    ? window.location.protocol + '//' + host + ':3001' : '';

  var page = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();

  var TOOLS = [
    { href: '/converter.html',   t: 'Unit converter',    d: 'GSM, yarn count, length and weight conversions' },
    { href: '/patterns.html',    t: 'Pattern catalog',   d: 'K/T/M patterns and fabric constructions' },
    { href: '/weft-calc.html',   t: 'Weft calculator',   d: 'Loop length, production and yarn per fabric' },
    { href: '/diagnostics.html', t: 'Diagnostics hub',   d: 'Knitting faults, causes and remedies' },
    { href: '/dyeing.html',      t: 'Dyeing recipes',    d: 'Real recipes, costing and dyeing faults' },
    { href: '/academy.html',     t: 'Knitting academy',  d: 'Theory, formulas and quizzes' }
  ];
  var CALC_PAGES = ['app.html', 'result.html'];
  var TOOL_PAGES = TOOLS.map(function (t) { return t.href.slice(1); });

  var LOGO = '<svg viewBox="0 0 26 26" fill="none" aria-hidden="true"><path d="M3 13c0-4 3-7 7-7M3 13c0 4 3 7 7 7M3 13h20M13 6c4 0 7 3 7 7s-3 7-7 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  var CARET = '<svg viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M1.5 3.5L5 7l3.5-3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function initials(u) {
    var parts = (u.full_name || u.email || '?').trim().split(/\s+/);
    return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  /* ---------------- header ---------------- */
  function buildHeader(hdr) {
    var toolsOn = TOOL_PAGES.indexOf(page) > -1;
    var menu = TOOLS.map(function (t) {
      var on = t.href.slice(1) === page;
      return '<a href="' + t.href + '"' + (on ? ' class="on" aria-current="page"' : '') + '><b>' + esc(t.t) + '</b><span>' + esc(t.d) + '</span></a>';
    }).join('');

    hdr.innerHTML =
      '<div class="ka-bar">' +
        '<a class="ka-brand" href="/">' + LOGO + '<b>KnitAdvisor</b></a>' +
        '<nav class="ka-nav" id="ka-nav" aria-label="Primary">' +
          '<a class="ka-link' + (CALC_PAGES.indexOf(page) > -1 ? ' on' : '') + '" href="/app.html">Calculator</a>' +
          '<div class="ka-dd">' +
            '<button type="button" class="ka-dd-btn' + (toolsOn ? ' on' : '') + '" id="ka-tools-btn" aria-haspopup="true" aria-expanded="false">Tools' + CARET + '</button>' +
            '<div class="ka-dd-menu" id="ka-tools-menu" hidden>' + menu + '</div>' +
          '</div>' +
          '<a class="ka-link' + (page === 'assistant.html' ? ' on' : '') + '" href="/assistant.html">Assistant</a>' +
          '<a class="ka-link' + (page === 'rfq.html' || page === 'rfq-status.html' ? ' on' : '') + '" href="/rfq.html">Request a quote</a>' +
        '</nav>' +
        '<div class="ka-right" id="ka-right"></div>' +
        '<button type="button" class="ka-burger" id="ka-burger" aria-label="Menu" aria-expanded="false" aria-controls="ka-nav">&#9776;</button>' +
      '</div>';

    var nav = document.getElementById('ka-nav');
    var burger = document.getElementById('ka-burger');
    burger.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    var tb = document.getElementById('ka-tools-btn');
    var tm = document.getElementById('ka-tools-menu');
    tb.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = tm.hidden;
      tm.hidden = !open;
      tb.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function (e) {
      if (!tm.hidden && !e.target.closest('.ka-dd')) { tm.hidden = true; tb.setAttribute('aria-expanded', 'false'); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        tm.hidden = true; tb.setAttribute('aria-expanded', 'false');
        var um = document.getElementById('ka-user-menu');
        if (um) um.hidden = true;
      }
    });
  }

  function renderRight(user) {
    var right = document.getElementById('ka-right');
    if (!right) return;
    if (!user) {
      right.innerHTML = '<a class="ka-cta" href="/?login=1&amp;next=' + encodeURIComponent('/app.html') + '">Sign in</a>';
      return;
    }
    right.innerHTML =
      '<a class="ka-cta hide-sm" href="/app.html">New calculation</a>' +
      '<div class="ka-user">' +
        '<button type="button" class="ka-avatar" id="ka-avatar" aria-haspopup="true" aria-expanded="false" aria-label="Account menu">' + esc(initials(user)) + '</button>' +
        '<div class="ka-user-menu" id="ka-user-menu" hidden role="menu">' +
          '<div class="who"><b>' + esc(user.full_name || 'Signed in') + '</b><span>' + esc(user.email) + '</span></div>' +
          '<a href="/app.html" role="menuitem">New calculation</a>' +
          '<a href="/account.html" role="menuitem">My calculations</a>' +
          '<a href="/account.html#profile" role="menuitem">Account settings</a>' +
          '<button type="button" id="ka-signout" role="menuitem">Sign out</button>' +
        '</div>' +
      '</div>';

    var av = document.getElementById('ka-avatar');
    var um = document.getElementById('ka-user-menu');
    av.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = um.hidden;
      um.hidden = !open;
      av.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function (e) {
      if (!um.hidden && !e.target.closest('.ka-user')) { um.hidden = true; av.setAttribute('aria-expanded', 'false'); }
    });
    document.getElementById('ka-signout').addEventListener('click', function () {
      fetch(API + '/api/auth/logout', { method: 'POST' })
        .catch(function () {})
        .then(function () { window.location.href = '/'; });
    });
  }

  /* ---------------- footer ---------------- */
  function buildFooter(ft) {
    var tools = TOOLS.map(function (t) { return '<li><a href="' + t.href + '">' + esc(t.t) + '</a></li>'; }).join('');
    ft.innerHTML =
      '<div class="ka-foot">' +
        '<div class="ka-foot-grid">' +
          '<div><a class="ka-brand" href="/">' + LOGO + '<b>KnitAdvisor</b></a>' +
            '<p>Knit fabric calculation engine for knitting mills and buying houses across Bangladesh.</p></div>' +
          '<div><h4>Product</h4><ul>' +
            '<li><a href="/app.html">Calculator</a></li>' +
            '<li><a href="/assistant.html">Knowledge assistant</a></li>' +
            '<li><a href="/account.html">My calculations</a></li>' +
          '</ul></div>' +
          '<div><h4>Tools</h4><ul>' + tools + '</ul></div>' +
          '<div><h4>For buyers</h4><ul>' +
            '<li><a href="/rfq.html">Request a quote</a></li>' +
            '<li><a href="/rfq-status.html">Check quote status</a></li>' +
          '</ul></div>' +
        '</div>' +
        '<div class="ka-foot-bottom">' +
          '<span>Part of <a href="https://www.onlinetextileschool.com" target="_blank" rel="noopener">onlinetextileschool.com</a></span>' +
          '<span class="sp">Proud sponsor <a href="https://www.asutex.com" target="_blank" rel="noopener"><b>Asutex</b></a></span>' +
        '</div>' +
      '</div>';
    ft.className = 'footer';
  }

  /* ---------------- boot ---------------- */
  function boot() {
    var hdr = document.querySelector('header.hdr');
    var ft = document.querySelector('footer.footer');
    if (!hdr && !ft) return;
    if (hdr) buildHeader(hdr);
    if (ft) buildFooter(ft);

    var ready = window.kaUserPromise ||
      fetch(API + '/api/auth/me', { headers: { Accept: 'application/json' }, cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { return d && d.user ? d.user : null; })
        .catch(function () { return null; });
    ready.then(renderRight);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
