/**
 * KnitAdvisor — signed-in home dashboard.
 *
 * One call to /api/account/dashboard fills every block: today's usage, the
 * work in progress (fabric calculations, costing sheets, studio designs), the
 * yarn prices the costing uses today, and the account's security health.
 */
(function () {
  'use strict';

  var host = window.location.hostname;
  var API = (host === '127.0.0.1' || host === 'localhost') ? window.location.protocol + '//' + host + ':3001' : '';
  var $ = function (id) { return document.getElementById(id); };

  var P = {
    calc: 'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 7.5h8M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01',
    sheet: 'M5 4h14v16H5zM5 9h14M5 14h14M10 9v11',
    grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    drop: 'M12 3.5c3.3 4 5.8 7 5.8 10.2a5.8 5.8 0 0 1-11.6 0C6.2 10.5 8.7 7.5 12 3.5z',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
    clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2',
    chart: 'M4 20V4M4 20h16M8 15l3.5-4 3 2.5L19 8',
    shield: 'M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z',
    loop: 'M6 20c0-6 2-9 6-9s6 3 6 9M9 11C7 8 8 4 12 4s5 4 3 7',
    apps: 'M5 5h4v4H5zM15 5h4v4h-4zM5 15h4v4H5zM15 15h4v4h-4z',
    ok: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12.3l2.8 2.7L16.5 9.5',
    warn: 'M12 4 21 19H3zM12 10v4M12 16.5h.01',
    weft: 'M7 4v8a5 5 0 0 0 10 0V4M7 20h10',
    swap: 'M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4',
    chat: 'M5 5h14a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 16h-8l-5 4v-4H5a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 5 5z',
    alert: 'M12 4 21 19H3zM12 10v4M12 16.5h.01',
    cap: 'm3 9 9-4.5L21 9l-9 4.5zM7 11.5V16c0 1.2 2.2 2.5 5 2.5s5-1.3 5-2.5v-4.5',
    tag: 'M3.5 12.5v-8h8l9 9-8 8zM8 8.5h.01',
    check: 'm5 12.5 4.5 4.5L19 7.5'
  };
  function icon(n) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + (P[n] || P.grid) + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function ago(t) {
    if (!t) return '';
    var s = (Date.now() - new Date(t).getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 86400 * 7) return Math.floor(s / 86400) + ' d ago';
    return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function usd(v, d) { return v == null ? '—' : '$' + Number(v).toFixed(d == null ? 2 : d); }
  function num(v) { return v == null ? '—' : Number(v).toLocaleString(); }

  // static icons in the markup
  document.querySelectorAll('[data-i]').forEach(function (el) { el.innerHTML = icon(el.getAttribute('data-i')); });
  if (/Mac|iPhone|iPad/.test(navigator.platform || '')) $('db-kbd').textContent = '⌘ K';
  $('db-search').addEventListener('click', function () { if (window.kaOpenSearch) window.kaOpenSearch(); });

  var now = new Date();
  $('db-date').textContent = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  var hr = now.getHours();
  var greet = hr < 5 ? 'Working late' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';

  /* ---------------- workspace (static) ---------------- */
  var TOOLS = [
    ['Calculate', [['/app.html', 'Fabric calculator', 'calc'], ['/costsheet.html', 'Costing sheet', 'sheet'], ['/weft-calc.html', 'Weft calculator', 'weft'], ['/converter.html', 'Unit converter', 'swap']]],
    ['R&D', [['/studio.html', 'Fabric studio', 'grid'], ['/patterns.html', 'Pattern catalogue', 'loop'], ['/dyeing.html', 'Dyeing lab', 'drop']]],
    ['Knowledge', [['/assistant.html', 'Knowledge assistant', 'chat'], ['/diagnostics.html', 'Fault diagnostics', 'alert'], ['/academy.html', 'Knitting academy', 'cap']]],
    ['Quotes', [['/rfq.html', 'Request a quote', 'tag'], ['/rfq-status.html', 'Quote status', 'check']]]
  ];
  $('db-tools-list').innerHTML = TOOLS.map(function (g) {
    return '<h3>' + esc(g[0]) + '</h3>' + g[1].map(function (t) { return '<a href="' + t[0] + '">' + icon(t[2]) + esc(t[1]) + '</a>'; }).join('');
  }).join('');

  /* ---------------- blocks ---------------- */
  function hero(d) {
    var u = d.user || {};
    var first = (u.full_name || u.username || '').trim().split(/\s+/)[0];
    $('db-hello').textContent = greet + (first ? ', ' + first : '') + '.';
    var bits = [];
    if (u.company) bits.push(u.company);
    if (u.last_login_at) bits.push('last sign-in ' + ago(u.last_login_at));
    if (u.member_since) bits.push('member since ' + new Date(u.member_since).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }));
    if (bits.length) $('db-sub').textContent = bits.join(' · ');

    var us = d.usage || {};
    var box = $('db-usage');
    var planName = { free: 'Free', student: 'Student', paid: 'Mill' }[us.plan] || us.plan;
    if (us.daily_limit == null) {
      box.innerHTML = '<svg class="db-ring" viewBox="0 0 54 54"><circle class="tr" cx="27" cy="27" r="23"/><circle class="fg" cx="27" cy="27" r="23" style="stroke:#1E7A54"/><text x="27" y="31" text-anchor="middle">∞</text></svg>' +
        '<div><b>Unlimited requests<span class="db-plan">' + esc(planName) + '</span></b><span>' + num(us.used_today) + ' used today</span></div>';
    } else {
      var used = us.used_today || 0, lim = us.daily_limit, left = Math.max(0, lim - used);
      var C = 2 * Math.PI * 23, frac = Math.min(1, used / lim);
      var col = frac >= 1 ? '#B23B3B' : frac >= 0.8 ? '#9A5B00' : '#1857C4';
      box.innerHTML = '<svg class="db-ring" viewBox="0 0 54 54"><circle class="tr" cx="27" cy="27" r="23"/><circle class="fg" cx="27" cy="27" r="23" style="stroke:' + col + ';stroke-dasharray:' + C + ';stroke-dashoffset:' + C + '" id="db-ring-fg"/>' +
        '<text x="27" y="31" text-anchor="middle">' + left + '</text></svg>' +
        '<div><b>' + left + ' of ' + lim + ' requests left<span class="db-plan">' + esc(planName) + '</span></b>' +
        '<span>' + (left ? 'Resets at midnight, Dhaka time' : 'Back at midnight, Dhaka time') + '</span>' +
        (us.plan === 'free' ? '<span><a href="/account.html#profile" style="color:var(--accent);font-weight:600;text-decoration:none">Student? Verify for 30 a day →</a></span>' : '') + '</div>';
      requestAnimationFrame(function () { var fg = $('db-ring-fg'); if (fg) fg.style.strokeDashoffset = String(C * (1 - frac)); });
    }
    box.hidden = false;
  }

  function kpis(d) {
    var t = d.totals || {}, sheets = d.cost_sheets || [];
    var costed = sheets.filter(function (s) { return s.status === 'costed'; });
    var margins = costed.map(function (s) { return s.margin_pct; }).filter(function (v) { return v != null; });
    var avgM = margins.length ? margins.reduce(function (a, b) { return a + b; }, 0) / margins.length : null;
    var tiles = [
      ['/account.html', 'Fabric specs', num(t.calculations), (t.runs ? num(t.runs) + ' runs' : 'none yet') + (t.specs_30d ? ' · ' + t.specs_30d + ' this month' : '')],
      ['/costsheet.html', 'Costing sheets', num(t.cost_sheets), costed.length ? costed.length + ' costed today' : 'build your first quote'],
      ['/costsheet.html', 'Avg. profit margin', avgM == null ? '—' : avgM.toFixed(1) + '%', avgM == null ? 'from saved sheets' : 'on FOB, latest sheets'],
      ['/studio.html', 'R&D designs', num(t.designs), (d.designs || []).reduce(function (a, x) { return a + (x.rolls || 0); }, 0) + ' trial rolls logged'],
      ['/account.html#security', 'Signed-in devices', num((d.security || {}).devices), (d.security || {}).two_factor !== 'off' ? 'two-step on' : 'two-step off']
    ];
    $('db-kpis').innerHTML = tiles.map(function (k) {
      return '<a class="db-kpi" href="' + k[0] + '"><div class="k">' + esc(k[1]) + '</div><div class="v">' + esc(k[2]) + '</div><div class="d">' + esc(k[3]) + '</div></a>';
    }).join('');
  }

  var TL = { calculation: ['k-calc', 'calc', 'Fabric'], cost_sheet: ['k-sheet', 'sheet', 'Costing'], design: ['k-design', 'grid', 'R&D'] };
  var calcById = {};
  function linkOf(t) {
    if (t.kind === 'cost_sheet') return '/costsheet.html?sheet=' + encodeURIComponent(t.id);
    if (t.kind === 'design') return '/studio.html?design=' + encodeURIComponent(t.id);
    return '#calc-' + t.id;
  }
  var timeline = [], tlFilter = 'all';
  function renderTimeline() {
    var rows = timeline.filter(function (t) { return tlFilter === 'all' || t.kind === tlFilter; });
    $('db-tl').innerHTML = rows.length ? rows.map(function (t) {
      var k = TL[t.kind] || TL.calculation;
      return '<li><a href="' + linkOf(t) + '" data-kind="' + t.kind + '" data-id="' + esc(t.id) + '"><span class="ic ' + k[0] + '">' + icon(k[1]) + '</span>' +
        '<span><b>' + esc(t.title) + '</b><small>' + esc(k[2]) + (t.sub ? ' · ' + esc(t.sub) : '') + '</small></span><time>' + esc(ago(t.at)) + '</time></a></li>';
    }).join('') : '<li class="db-empty">Nothing here yet. Start with a <a href="/app.html">fabric calculation</a>, a <a href="/costsheet.html">costing sheet</a> or a <a href="/studio.html">studio design</a>.</li>';
  }
  $('db-tl-tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    tlFilter = b.getAttribute('data-f');
    Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); });
    renderTimeline();
  });
  function openCalc(id) {
    var c = calcById[id];
    if (!c || !c.params) { window.location.href = '/account.html'; return; }
    if (typeof savePending === 'function') savePending(c.params);
    window.location.href = '/result.html';
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-kind="calculation"], [data-opencalc]');
    if (!a) return;
    e.preventDefault();
    openCalc(a.getAttribute('data-id') || a.getAttribute('data-opencalc'));
  });

  function sheetsBlock(list) {
    if (!list.length) {
      $('db-sheets').innerHTML = '<div class="db-empty">No saved costing sheets yet. <a href="/costsheet.html">Build a buyer quotation</a> — sizes, yarn by role, CM, FOB and margin.</div>';
      return;
    }
    $('db-sheets').innerHTML = '<div class="db-scroll"><table class="db-t"><tr><th>Style</th><th>Sizes</th><th class="num">FOB / pc</th><th class="num">Margin</th><th>Status</th><th>Updated</th></tr>' +
      list.map(function (s) {
        var fob = s.fob ? usd(s.fob.min) + (s.fob.max !== s.fob.min ? ' – ' + usd(s.fob.max) : '') : '—';
        var st = s.status === 'costed'
          ? (s.warnings ? '<span class="pill warn">' + s.warnings + ' check' + (s.warnings > 1 ? 's' : '') + '</span>' : '<span class="pill ok">Costed</span>')
          : '<span class="pill mute" title="' + esc(s.note || '') + '">Incomplete</span>';
        var sub = [s.buyer, s.order_no ? 'order ' + s.order_no : null, s.quantity ? num(s.quantity) + ' pcs' : null].filter(Boolean).join(' · ');
        return '<tr><td><a class="nm" href="/costsheet.html?sheet=' + encodeURIComponent(s.id) + '">' + esc(s.name) + '</a>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</td>' +
          '<td>' + esc(s.sizes.length ? s.sizes[0] + (s.sizes.length > 1 ? ' to ' + s.sizes[s.sizes.length - 1] : '') : '—') + '<small>' + s.sizes.length + ' sizes · ' + s.shells + ' fabric' + (s.shells === 1 ? '' : 's') + '</small></td>' +
          '<td class="num">' + fob + '</td><td class="num">' + (s.margin_pct == null ? '—' : s.margin_pct.toFixed(1) + '%') + '</td>' +
          '<td>' + st + '</td><td style="white-space:nowrap;color:var(--t3);font-size:12px">' + esc(ago(s.updated_at)) + '</td></tr>';
      }).join('') + '</table></div>' +
      '<p style="margin:8px 0 0;font-size:11.5px;color:var(--t3)">FOB and margin are re-costed now, at today\'s yarn, knitting and dyeing prices.</p>';
  }

  var CELL = { K: '#1857C4', T: '#E3A008', M: '#E9ECEF', '-': '#FFFFFF' };
  function designsBlock(list) {
    if (!list.length) {
      $('db-designs').innerHTML = '<div class="db-empty">No saved designs. <a href="/studio.html">Open the Fabric studio</a> to draw a new structure and log trial rolls.</div>';
      return;
    }
    $('db-designs').innerHTML = '<div class="db-designs">' + list.map(function (d, n) {
      var bits = [d.bed === 'rib' ? 'Double bed' : 'Single bed', d.feeds + ' feeds'];
      if (d.gsm) bits.push(d.gsm + ' GSM');
      if (d.count) bits.push(d.count + 's');
      return '<a class="db-design" href="/studio.html?design=' + encodeURIComponent(d.id) + '"><canvas data-grid="' + n + '" width="160" height="74"></canvas>' +
        '<div><b>' + esc(d.name) + '</b><small>' + esc(bits.join(' · ')) + '</small><small>' + (d.rolls ? d.rolls + ' trial roll' + (d.rolls > 1 ? 's' : '') + ' · ' : '') + esc(ago(d.updated_at)) + '</small></div></a>';
    }).join('') + '</div>';
    // a thumbnail of the programme: knit blue, tuck amber, miss grey, repeated to fill
    list.forEach(function (d, n) {
      var cv = document.querySelector('canvas[data-grid="' + n + '"]');
      if (!cv || !d.grid || !d.grid.length) return;
      var g = cv.getContext('2d'), rows = d.grid.length, cols = d.grid[0].length || 1, s = 9;
      for (var y = 0; y * s < cv.height; y++) {
        for (var x = 0; x * s < cv.width; x++) {
          var ch = d.grid[y % rows][x % cols] || '-';
          g.fillStyle = CELL[ch] || CELL['-'];
          g.fillRect(x * s, y * s, s - 1, s - 1);
        }
      }
    });
  }

  function calcsBlock(list) {
    calcById = {};
    list.forEach(function (c) { calcById[c.id] = c; });
    if (!list.length) {
      $('db-calcs').innerHTML = '<div class="db-empty">No calculations yet. <a href="/app.html">Run your first fabric</a> — it is kept here so you can reopen it.</div>';
      return;
    }
    $('db-calcs').innerHTML = '<div class="db-calcs">' + list.map(function (c) {
      var s = c.summary || {}, chips = [];
      if (s.yarn_count) chips.push(['Yarn', s.yarn_count]);
      if (s.loop_length_mm != null) chips.push(['Loop', s.loop_length_mm + ' mm']);
      if (s.fabric_price_usd_per_kg != null) chips.push(['Fabric', usd(s.fabric_price_usd_per_kg) + '/kg']);
      if (s.kg_per_day != null) chips.push(['Output', Math.round(s.kg_per_day) + ' kg/d']);
      return '<div class="db-calc"><div class="tt"><b>' + esc(c.fabric) + '</b><span class="g">' + (c.gsm ? esc(c.gsm) + ' GSM' : '') + '</span></div>' +
        '<div class="c">' + esc(c.composition || 'Composition not set') + ' · ' + esc(ago(c.at)) + (c.runs > 1 ? ' · run ' + c.runs + '×' : '') + '</div>' +
        (chips.length ? '<div class="db-chips">' + chips.map(function (x) { return '<span>' + esc(x[0]) + ' <b>' + esc(x[1]) + '</b></span>'; }).join('') + '</div>' : '') +
        '<button type="button" data-opencalc="' + esc(c.id) + '">Open result</button></div>';
    }).join('') + '</div>';
  }

  var FRESH = {
    current: ['#1E7A54', 'Market prices are current'], recent: ['#1E7A54', 'Market prices are recent'],
    stale: ['#9A5B00', 'Market prices are getting old'], 'out of date': ['#B23B3B', 'Market prices are out of date'],
    none: ['#868C94', 'Reference price list in use'], unknown: ['#868C94', 'Reference price list in use']
  };
  function marketBlock(m) {
    if (!m) { $('db-market').innerHTML = '<div class="db-empty">Prices could not be read just now.</div>'; return; }
    var f = m.feed || {}, fr = FRESH[f.freshness] || FRESH.unknown;
    var head = '<div class="db-feed"><span class="db-dot" style="background:' + fr[0] + '"></span><b style="color:' + fr[0] + '">' + esc(fr[1]) + '</b>' +
      (f.last_updated ? '<span>· quoted ' + esc(new Date(f.last_updated).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })) + (f.age_days != null ? ' (' + f.age_days + ' d)' : '') + '</span>' : '') + '</div>';
    var rows = (m.prices || []).map(function (p) {
      return '<tr><td>' + esc(p.label.replace(/\s*\((Regular|ring)\)/i, '')) + (p.count ? ' <b class="db-mono">' + p.count + 's</b>' : '') + '</td>' +
        '<td class="num">' + usd(p.price) + '</td><td><span class="pill ' + (p.kind === 'market' ? 'ok' : 'mute') + '">' + (p.kind === 'market' ? 'market' : 'reference') + '</span></td></tr>';
    }).join('');
    $('db-market').innerHTML = head + '<div class="db-scroll"><table class="db-t"><tr><th>Yarn</th><th class="num">$/kg</th><th></th></tr>' + rows + '</table></div>' +
      '<p style="margin:8px 0 0;font-size:11.5px;color:var(--t3)">The same prices the costing sheet and fabric calculator use.</p>';
  }

  function healthBlock(sec, user) {
    var items = [
      [sec.email_verified, 'Email verified', sec.email_verified ? 'Codes and alerts reach you' : 'Verify so you can reset your password', '/account.html#security', 'Verify'],
      [sec.two_factor !== 'off', 'Two-step sign-in', sec.two_factor === 'app' ? 'Authenticator app' : sec.two_factor === 'email' ? 'Emailed code' : 'A password alone protects this account', '/account.html#security', 'Turn on'],
      [sec.devices != null && sec.devices <= 3, 'Signed-in devices', (sec.devices == null ? '—' : sec.devices) + ' active' + (sec.devices > 3 ? ' — sign out the ones you do not know' : ''), '/account.html#security', 'Review'],
      [!!(user.full_name && user.company), 'Profile complete', user.company ? user.company : 'Add your company so quotes carry it', '/account.html#profile', 'Edit']
    ];
    var good = items.filter(function (x) { return x[0]; }).length, pct = Math.round(good / items.length * 100);
    var col = pct === 100 ? '#1E7A54' : pct >= 50 ? '#9A5B00' : '#B23B3B';
    var recent = (sec.recent || []).slice(0, 3).map(function (e) {
      return '<li style="grid-template-columns:22px minmax(0,1fr) auto"><span style="color:var(--t3)">' + icon('clock') + '</span><span>' + esc(e.what) + '<small>' + esc(e.device || '') + '</small></span><small>' + esc(ago(e.at)) + '</small></li>';
    }).join('');
    $('db-health').innerHTML = '<div class="db-score"><div class="bar"><i style="width:' + pct + '%;background:' + col + '"></i></div><b style="color:' + col + '">' + pct + '%</b></div>' +
      '<ul class="db-health">' + items.map(function (x) {
        return '<li><span style="color:' + (x[0] ? '#1E7A54' : '#9A5B00') + '">' + icon(x[0] ? 'ok' : 'warn') + '</span><span>' + esc(x[1]) + '<small>' + esc(x[2]) + '</small></span>' +
          (x[0] ? '' : '<a href="' + x[3] + '">' + esc(x[4]) + ' →</a>') + '</li>';
      }).join('') + '</ul>' +
      (recent ? '<p style="margin:12px 0 2px;font:700 11px var(--head);text-transform:uppercase;letter-spacing:.06em;color:var(--t3)">Recent activity</p><ul class="db-health">' + recent + '</ul>' : '');
  }

  function topBlock(top) {
    if (!top || !top.length) return;
    var max = Math.max.apply(null, top.map(function (t) { return t.runs; })) || 1;
    $('db-top').innerHTML = top.map(function (t) {
      return '<li><div class="row"><span>' + esc(t.fabric) + '</span><b class="db-mono">' + t.runs + '</b></div><div class="bar"><i style="width:' + Math.round(t.runs / max * 100) + '%"></i></div></li>';
    }).join('');
    $('db-top-card').hidden = false;
  }

  function fail(msg) {
    ['db-tl', 'db-sheets', 'db-designs', 'db-calcs', 'db-market', 'db-health'].forEach(function (id) {
      $(id).innerHTML = '<div class="db-empty">' + esc(msg) + ' <a href="#" onclick="location.reload();return false">Try again</a></div>';
    });
    $('db-kpis').innerHTML = '';
  }

  fetch(API + '/api/account/dashboard', { headers: { Accept: 'application/json' }, cache: 'no-store', credentials: 'same-origin' })
    .then(function (r) {
      if (r.status === 401 && window.kaSignInRedirect) { window.kaSignInRedirect(); throw new Error('signed out'); }
      return r.json();
    })
    .then(function (d) {
      if (!d || !d.success) throw new Error((d && d.error) || 'Could not load your dashboard.');
      hero(d);
      kpis(d);
      timeline = d.timeline || [];
      calcsBlock(d.calculations || []);
      renderTimeline();
      sheetsBlock(d.cost_sheets || []);
      designsBlock(d.designs || []);
      marketBlock(d.market);
      healthBlock(d.security || {}, d.user || {});
      topBlock((d.totals || {}).top_fabrics);
    })
    .catch(function (e) { if (e.message !== 'signed out') fail(e.message || 'Could not load your dashboard.'); });
})();
