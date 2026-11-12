/**
 * KnitAdvisor — shared page shell (header, menu, search, footer).
 *
 * One place builds the header and footer of every product page, so the menu
 * cannot drift between pages. The menu is grouped by the work a mill does:
 * Calculate, R&D, Knowledge and Quotes, with the signed-in Dashboard as home.
 * Ctrl+K (or "/") opens a search over every tool, action, saved cost sheet
 * and saved studio design.
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

  /* ---------------- icons (24px line icons) ---------------- */
  var P = {
    home: 'M4 11.5 12 5l8 6.5V20h-5.5v-5h-5v5H4z',
    calc: 'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 7.5h8M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01',
    sheet: 'M5 4h14v16H5zM5 9h14M5 14h14M10 9v11',
    weft: 'M7 4v8a5 5 0 0 0 10 0V4M7 20h10',
    swap: 'M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4',
    grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    loop: 'M6 20c0-6 2-9 6-9s6 3 6 9M9 11C7 8 8 4 12 4s5 4 3 7',
    drop: 'M12 3.5c3.3 4 5.8 7 5.8 10.2a5.8 5.8 0 0 1-11.6 0C6.2 10.5 8.7 7.5 12 3.5z',
    chat: 'M5 5h14a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 16h-8l-5 4v-4H5a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 5 5z',
    alert: 'M12 4 21 19H3zM12 10v4M12 16.5h.01',
    cap: 'm3 9 9-4.5L21 9l-9 4.5zM7 11.5V16c0 1.2 2.2 2.5 5 2.5s5-1.3 5-2.5v-4.5',
    tag: 'M3.5 12.5v-8h8l9 9-8 8zM8 8.5h.01',
    check: 'm5 12.5 4.5 4.5L19 7.5',
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20c.8-3.5 3.8-5.5 7.5-5.5s6.7 2 7.5 5.5',
    lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
    list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
    out: 'M14 5h5v14h-5M10 8l-4 4 4 4M6 12h10',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
    scan: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10',
    plus: 'M12 5v14M5 12h14',
    leaf: 'M5 19c0-8 6-14 15-14 0 9-6 15-14 15zM5 19l8-8'
  };
  function icon(name, cls) {
    return '<svg class="' + (cls || 'ka-ic') + '" viewBox="0 0 24 24" aria-hidden="true"><path d="' + P[name] +
      '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  /* ---------------- the menu, grouped by the work ---------------- */
  var GROUPS = [
    { id: 'calc', t: 'Calculate', items: [
      { href: '/app.html',        t: 'Fabric calculator', d: 'Yarn, machine, stitch length, shrinkage and cost from one spec', i: 'calc', pages: ['app.html', 'result.html'], k: 'jersey rib interlock fleece pique terry gsm yarn count stitch length gauge shrinkage' },
      { href: '/costsheet.html',  t: 'Costing sheet',     d: 'Buyer quotation by size: yarn by role, CM, FOB, margin, PDF', i: 'sheet', badge: 'New', k: 'fob quotation cm smv trims embroidery print margin profit fleece rib consumption' },
      { href: '/studio-cost.html', t: 'Cost a Studio design', d: 'Open a design saved from the Fabric Studio and cost its yarn and processing', i: 'sheet', k: 'studio design warp cost price per metre kg yarn dyeing finishing' },
      { href: '/yarn-prices.html', t: 'Yarn price desk',   d: 'Where every yarn price comes from, how it is brought to today, duty and VAT', i: 'tag', badge: 'New', k: 'yarn price market quote cotton polyester lc duty vat tax benchmark country' },
      { href: '/carbon.html',     t: 'Carbon footprint',  d: 'CO2e per kg and per garment, stage by stage, and the strongest ways to cut it', i: 'leaf', badge: 'New', k: 'co2 co2e carbon footprint emissions sustainability scope climate lca energy water' },
      { href: '/weft-calc.html',  t: 'Weft calculator',   d: 'Loop length, production and yarn per fabric', i: 'weft' },
      { href: '/converter.html',  t: 'Unit converter',    d: 'Count systems, GSM, length and weight', i: 'swap' }
    ] },
    { id: 'rnd', t: 'R&D', items: [
      { href: '/scan.html',       t: 'Fabric scan',       d: 'Phone camera: loops counted, stitch length, count, gauge and GSM worked out', i: 'scan', badge: 'New', k: 'camera photo swatch analyse reverse engineer wales courses' },
      { href: '/scan-board.html', t: 'Scan board',        d: 'Pair a phone by QR code; every scan shows live on this screen', i: 'scan', k: 'expo big screen live qr' },
      { href: '/studio.html',     t: 'Fabric studio',     d: 'Design a structure needle by needle: checks, cam set-out, live 3D', i: 'grid', k: 'knit tuck miss cam 3d structure needle lacoste pointelle' },
      { href: '/patterns.html',   t: 'Pattern catalogue', d: 'Knit, tuck and miss programmes, feeder by feeder', i: 'loop' },
      { href: '/dyeing.html',     t: 'Dyeing lab',        d: 'Recipes, process flow, costing and dyeing faults', i: 'drop', k: 'reactive disperse shade recipe' }
    ] },
    { id: 'learn', t: 'Knowledge', items: [
      { href: '/api-docs.html',   t: 'API documentation', d: 'Use the engines from your own system with an API key', i: 'plus', k: 'api key integration erp json rest developer' },
      { href: '/assistant.html',  t: 'Knowledge assistant', d: 'Fibre, dyeing and costing questions answered from reference data', i: 'chat' },
      { href: '/diagnostics.html', t: 'Fault diagnostics',  d: 'From a symptom on the fabric to its cause and remedy', i: 'alert' },
      { href: '/academy.html',    t: 'Knitting academy',    d: 'Theory, formulas, formation cycles and quizzes', i: 'cap' }
    ] },
    { id: 'quote', t: 'Quotes', items: [
      { href: '/rfq.html',        t: 'Request a quote',   d: 'For buyers: a quote at a frozen reference price', i: 'tag' },
      { href: '/rfq-status.html', t: 'Quote status',      d: 'Look up a request already sent', i: 'check' }
    ] }
  ];
  var ALL = [];
  GROUPS.forEach(function (g) { g.items.forEach(function (it) { it.group = g.t; ALL.push(it); }); });
  function pagesOf(it) { return it.pages || [it.href.slice(1)]; }
  function groupOn(g) { return g.items.some(function (it) { return pagesOf(it).indexOf(page) > -1; }); }

  var LOGO = '<img src="/assets/img/logo-ka-320.png" alt="" width="46" height="28">';
  var CARET = '<svg viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M1.5 3.5L5 7l3.5-3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || '');

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
  function closeMenus(except) {
    document.querySelectorAll('.ka-dd-menu').forEach(function (m) {
      if (m === except) return;
      m.hidden = true;
      var b = document.querySelector('[aria-controls="' + m.id + '"]');
      if (b) b.setAttribute('aria-expanded', 'false');
    });
  }

  function buildHeader(hdr) {
    var groups = GROUPS.map(function (g) {
      var items = g.items.map(function (it) {
        var on = pagesOf(it).indexOf(page) > -1;
        return '<a href="' + it.href + '"' + (on ? ' class="on" aria-current="page"' : '') + '>' + icon(it.i, 'ka-ic mi') +
          '<span><b>' + esc(it.t) + (it.badge ? ' <em class="ka-badge">' + esc(it.badge) + '</em>' : '') + '</b><span>' + esc(it.d) + '</span></span></a>';
      }).join('');
      return '<div class="ka-dd">' +
        '<button type="button" class="ka-dd-btn' + (groupOn(g) ? ' on' : '') + '" aria-haspopup="true" aria-expanded="false" aria-controls="ka-mm-' + g.id + '">' + esc(g.t) + CARET + '</button>' +
        '<div class="ka-dd-menu" id="ka-mm-' + g.id + '" hidden><h5>' + esc(g.t) + '</h5>' + items + '</div>' +
      '</div>';
    }).join('');

    hdr.innerHTML =
      '<div class="ka-bar">' +
        '<a class="ka-brand" id="ka-brand" href="/">' + LOGO + '<b>KnitAdvisor</b></a>' +
        '<nav class="ka-nav" id="ka-nav" aria-label="Primary">' +
          '<a class="ka-link' + (page === 'dashboard.html' ? ' on' : '') + '" id="ka-home-link" href="/dashboard.html" hidden>' + icon('home') + 'Dashboard</a>' +
          groups +
        '</nav>' +
        '<button type="button" class="ka-search" id="ka-search" aria-label="Search tools and saved work">' + icon('search') +
          '<span>Search</span><kbd>' + (IS_MAC ? '⌘' : 'Ctrl') + ' K</kbd></button>' +
        '<div class="ka-right" id="ka-right"></div>' +
        '<button type="button" class="ka-burger" id="ka-burger" aria-label="Menu" aria-expanded="false" aria-controls="ka-nav">&#9776;</button>' +
      '</div>';

    var nav = document.getElementById('ka-nav');
    var burger = document.getElementById('ka-burger');
    burger.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    nav.addEventListener('click', function (e) {
      var b = e.target.closest('.ka-dd-btn');
      if (!b) return;
      e.stopPropagation();
      var m = document.getElementById(b.getAttribute('aria-controls'));
      var open = m.hidden;
      closeMenus(m);
      m.hidden = !open;
      b.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function (e) { if (!e.target.closest('.ka-dd')) closeMenus(); });
    document.getElementById('ka-search').addEventListener('click', openPalette);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeMenus();
        var um = document.getElementById('ka-user-menu');
        if (um) um.hidden = true;
      }
      var typing = /INPUT|TEXTAREA|SELECT/.test((e.target.tagName || '')) || e.target.isContentEditable;
      if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openPalette(); }
      else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey) { e.preventDefault(); openPalette(); }
    });
  }

  var currentUser = null;
  function renderRight(user) {
    currentUser = user;
    var right = document.getElementById('ka-right');
    if (!right) return;
    if (!user) {
      right.innerHTML = '<a class="ka-cta" href="/?login=1&amp;next=' + encodeURIComponent('/dashboard.html') + '">Sign in</a>';
      return;
    }
    var home = document.getElementById('ka-home-link');
    if (home) home.hidden = false;
    var brand = document.getElementById('ka-brand');
    if (brand) brand.setAttribute('href', '/dashboard.html');
    right.innerHTML =
      '<a class="ka-cta hide-sm" href="/app.html">' + icon('plus') + 'New calculation</a>' +
      '<div class="ka-user">' +
        '<button type="button" class="ka-avatar" id="ka-avatar" aria-haspopup="true" aria-expanded="false" aria-label="Account menu">' + esc(initials(user)) + '</button>' +
        '<div class="ka-user-menu" id="ka-user-menu" hidden role="menu">' +
          '<div class="who"><b>' + esc(user.full_name || 'Signed in') + '</b><span>' + esc(user.email) + '</span>' +
            (user.two_factor && user.two_factor !== 'off' ? '<i class="ok">Two-step on</i>' : '<i class="warn">Two-step off</i>') + '</div>' +
          '<a href="/dashboard.html" role="menuitem">' + icon('home') + 'Dashboard</a>' +
          '<a href="/account.html" role="menuitem">' + icon('list') + 'My calculations</a>' +
          '<a href="/costsheet.html" role="menuitem">' + icon('sheet') + 'My cost sheets</a>' +
          '<a href="/studio.html" role="menuitem">' + icon('grid') + 'My studio designs</a>' +
          '<a href="/account.html#profile" role="menuitem">' + icon('user') + 'Profile</a>' +
          '<a href="/account.html#security" role="menuitem">' + icon('lock') + 'Security and devices</a>' +
          '<button type="button" id="ka-signout" role="menuitem">' + icon('out') + 'Sign out</button>' +
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
    document.getElementById('ka-signout').addEventListener('click', signOut);
  }
  function signOut() {
    fetch(API + '/api/auth/logout', { method: 'POST' })
      .catch(function () {})
      .then(function () { window.location.href = '/'; });
  }

  /* ---------------- search (Ctrl+K) ---------------- */
  var pal = null, palItems = [], palSel = 0, savedLoaded = false, saved = [];
  function baseEntries() {
    var out = [];
    if (currentUser) out.push({ t: 'Dashboard', d: 'Your work, usage, yarn prices and account health', href: '/dashboard.html', i: 'home', g: 'Go to' });
    ALL.forEach(function (it) { out.push({ t: it.t, d: it.d, href: it.href, i: it.i, g: it.group, k: it.k }); });
    out.push({ t: 'New costing sheet', d: 'Start a blank buyer quotation', href: '/costsheet.html', i: 'plus', g: 'Actions', k: 'create cost fob quotation' });
    out.push({ t: 'New fabric calculation', d: 'GSM and fabric to yarn, machine and cost', href: '/app.html', i: 'plus', g: 'Actions', k: 'create spec' });
    out.push({ t: 'Design a new structure', d: 'Open the Fabric studio', href: '/studio.html', i: 'plus', g: 'Actions', k: 'create knit tuck miss cam' });
    if (currentUser) {
      out.push({ t: 'My calculations', d: 'Every calculation you have run', href: '/account.html', i: 'list', g: 'Account', k: 'history' });
      out.push({ t: 'Security and devices', d: 'Two-step sign-in, devices, activity', href: '/account.html#security', i: 'lock', g: 'Account', k: 'password 2fa two-step' });
      out.push({ t: 'Profile', d: 'Name, company, username, email', href: '/account.html#profile', i: 'user', g: 'Account' });
      out.push({ t: 'Sign out', d: 'End this session', act: signOut, i: 'out', g: 'Account', k: 'logout log out' });
    } else {
      out.push({ t: 'Sign in', d: 'Open your account', href: '/?login=1&next=%2Fdashboard.html', i: 'user', g: 'Account', k: 'login' });
    }
    return out.concat(saved);
  }
  function loadSaved() {
    if (savedLoaded || !currentUser) return;
    savedLoaded = true;
    var get = function (u) { return fetch(API + u, { headers: { Accept: 'application/json' }, cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }); };
    Promise.all([get('/api/cost-sheet/sheets'), get('/api/studio/designs')]).then(function (a) {
      saved = (a[0].sheets || []).map(function (s) {
        var h = (s.sheet && s.sheet.header) || {};
        return { t: s.name, d: 'Cost sheet' + (h.buyer ? ' · ' + h.buyer : '') + (h.order_no ? ' · order ' + h.order_no : ''), href: '/costsheet.html?sheet=' + s.id, i: 'sheet', g: 'Saved cost sheets', k: [h.buyer, h.order_no].join(' ') };
      }).concat((a[1].designs || []).map(function (d) {
        return { t: d.name, d: 'Studio design', href: '/studio.html?design=' + d.id, i: 'grid', g: 'Saved designs' };
      }));
      if (pal && !pal.hidden) renderPalette();
    });
  }
  function score(e, q) {
    if (!q) return 1;
    var hay = (e.t + ' ' + (e.d || '') + ' ' + (e.g || '') + ' ' + (e.k || '')).toLowerCase();
    var words = q.toLowerCase().split(/\s+/).filter(Boolean), s = 0;
    for (var i = 0; i < words.length; i++) {
      var w = words[i], at = hay.indexOf(w);
      if (at < 0) return 0;
      s += e.t.toLowerCase().indexOf(w) === 0 ? 6 : e.t.toLowerCase().indexOf(w) > -1 ? 4 : 1;
    }
    return s;
  }
  function renderPalette() {
    var q = document.getElementById('ka-pal-q').value.trim();
    palItems = baseEntries().map(function (e) { return { e: e, s: score(e, q) }; })
      .filter(function (x) { return x.s > 0; })
      .sort(function (a, b) { return q ? b.s - a.s : 0; })
      .slice(0, 40).map(function (x) { return x.e; });
    palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
    var last = null, html = '';
    palItems.forEach(function (e, n) {
      if (!q && e.g !== last) { html += '<div class="ka-pal-g">' + esc(e.g) + '</div>'; last = e.g; }
      html += '<a class="ka-pal-i' + (n === palSel ? ' sel' : '') + '" data-n="' + n + '"' + (e.href ? ' href="' + esc(e.href) + '"' : ' href="#"') + '>' +
        icon(e.i || 'grid') + '<span><b>' + esc(e.t) + '</b><span>' + esc(e.d || '') + '</span></span>' + (q ? '<em>' + esc(e.g) + '</em>' : '') + '</a>';
    });
    document.getElementById('ka-pal-list').innerHTML = html || '<div class="ka-pal-empty">Nothing matches “' + esc(q) + '”.</div>';
  }
  function go(n) {
    var e = palItems[n];
    if (!e) return;
    closePalette();
    if (e.act) e.act(); else window.location.href = e.href;
  }
  function openPalette() {
    closeMenus();
    if (!pal) {
      pal = document.createElement('div');
      pal.className = 'ka-pal';
      pal.hidden = true;
      pal.innerHTML = '<div class="ka-pal-back"></div><div class="ka-pal-box" role="dialog" aria-modal="true" aria-label="Search">' +
        '<div class="ka-pal-in">' + icon('search') + '<input id="ka-pal-q" type="text" placeholder="Search tools, actions, saved sheets and designs…" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div>' +
        '<div class="ka-pal-list" id="ka-pal-list" role="listbox"></div>' +
        '<div class="ka-pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>/</kbd> or <kbd>' + (IS_MAC ? '⌘' : 'Ctrl') + ' K</kbd> anywhere</span></div></div>';
      document.body.appendChild(pal);
      pal.querySelector('.ka-pal-back').addEventListener('click', closePalette);
      var q = document.getElementById('ka-pal-q');
      q.addEventListener('input', function () { palSel = 0; renderPalette(); });
      q.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(palItems.length - 1, palSel + 1); renderPalette(); scrollSel(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(0, palSel - 1); renderPalette(); scrollSel(); }
        else if (e.key === 'Enter') { e.preventDefault(); go(palSel); }
        else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
      });
      document.getElementById('ka-pal-list').addEventListener('click', function (e) {
        var a = e.target.closest('[data-n]');
        if (!a) return;
        e.preventDefault();
        go(+a.getAttribute('data-n'));
      });
    }
    pal.hidden = false;
    document.documentElement.classList.add('ka-pal-open');
    var input = document.getElementById('ka-pal-q');
    input.value = ''; palSel = 0;
    renderPalette();
    loadSaved();
    setTimeout(function () { input.focus(); }, 0);
  }
  function scrollSel() { var s = document.querySelector('.ka-pal-i.sel'); if (s) s.scrollIntoView({ block: 'nearest' }); }
  function closePalette() { if (pal) pal.hidden = true; document.documentElement.classList.remove('ka-pal-open'); }
  window.kaOpenSearch = openPalette;

  /* ---------------- footer ---------------- */
  function buildFooter(ft) {
    var cols = GROUPS.map(function (g) {
      return '<div><h4>' + esc(g.t) + '</h4><ul>' + g.items.map(function (it) {
        return '<li><a href="' + it.href + '">' + esc(it.t) + '</a></li>';
      }).join('') + '</ul></div>';
    }).join('');
    ft.innerHTML =
      '<div class="ka-foot">' +
        '<div class="ka-foot-grid five">' +
          '<div><a class="ka-brand" href="/">' + LOGO + '<b>KnitAdvisor</b></a>' +
            '<p>Knit fabric engineering, R&amp;D and costing for knitting mills and buying houses across Bangladesh.</p>' +
            '<p class="ka-foot-links"><a href="/dashboard.html">Dashboard</a> · <a href="/account.html">My account</a></p></div>' +
          cols +
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
