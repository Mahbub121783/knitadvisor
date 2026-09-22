/**
 * KnitAdvisor Admin Panel JS
 */

const API_BASE = (() => {
  const h = window.location.hostname;
  return (h === 'localhost' || h === '127.0.0.1') ? 'http://localhost:3001' : window.location.origin;
})();

// ── HTML ESCAPING ──────────────────────────────────────────
// Several tables below are built with innerHTML from values that originate in
// visitor-controlled request bodies: query_logs.input_text is a verbatim
// JSON.stringify of whatever was POSTed to the public /api/calculate endpoint.
// Interpolated raw, a crafted request became script that ran here, inside an
// authenticated admin session with the session token in sessionStorage.
// Everything from the API is escaped before it reaches innerHTML.
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── TOKEN ──────────────────────────────────────────────────
function getToken()      { return sessionStorage.getItem('adminToken'); }
function setToken(t)     { sessionStorage.setItem('adminToken', t); }
function clearToken()    { sessionStorage.removeItem('adminToken'); }

// ── FETCH HELPER ───────────────────────────────────────────
async function api(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': getToken() || '' }
  };
  if (body !== null) opts.body = JSON.stringify(body);

  const res = await fetch(API_BASE + path, opts);
  if (!res.ok) {
    if (res.status === 401) { clearToken(); showLogin(); throw new Error('Unauthorized'); }
    let msg = res.statusText;
    try { const d = await res.json(); msg = d.error || msg; } catch (_) {}
    throw new Error(msg);
  }
  return res.json();
}

// ── AUTH ───────────────────────────────────────────────────
function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('admin-app').classList.add('hidden');
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('admin-app').classList.remove('hidden');
}

async function doLogin() {
  const username = (document.getElementById('admin-username').value || '').trim();
  const password = document.getElementById('admin-password').value || '';
  const errEl = document.getElementById('login-error');
  const btn   = document.getElementById('login-btn');

  errEl.textContent = '';
  if (!username || !password) { errEl.textContent = 'Username and password required'; return; }

  btn.disabled = true; btn.textContent = 'Logging in…';
  try {
    const res = await fetch(API_BASE + '/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Login failed'; return; }
    setToken(data.token);
    showApp();
    initApp();
  } catch (e) {
    errEl.textContent = e.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Login';
  }
}

async function doLogout() {
  try { await api('/admin/logout', 'POST'); } catch (_) {}
  clearToken();
  document.getElementById('admin-username').value = '';
  document.getElementById('admin-password').value = '';
  showLogin();
}

// ── TOAST ──────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const wrap = document.getElementById('toast-wrap');
  const el = document.createElement('div');
  el.className = `toast toast-${type === 'success' ? 'ok' : type === 'error' ? 'err' : 'info'}`;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 3000);
}

// ── INIT APP ────────────────────────────────────────────────
function initApp() {
  loadOverview();
  loadLogStats();
  loadLogs(1, {});
}

// ── TABS ────────────────────────────────────────────────────
const tabState = { loaded: {} };

const TAB_TITLES = {
  'tab-overview': 'Dashboard', 'tab-logs': 'Query Logs', 'tab-providers': 'AI Providers',
  'tab-cache': 'Cache', 'tab-prices': 'Yarn Prices', 'tab-dyeing-prices': 'Dyeing Prices',
  'tab-validation': 'Real-Order Validation', 'tab-inquiries': 'Inquiries', 'tab-rfq': 'RFQ / Quotes',
  'tab-users': 'Users', 'tab-settings': 'Settings',
};

function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === tabId);
  });
  const title = document.getElementById('page-title');
  if (title) title.textContent = TAB_TITLES[tabId] || 'Admin';
  // Mobile: picking a section should close the off-canvas sidebar.
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar && sidebar.classList.contains('open')) {
    sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('show');
    const toggle = document.getElementById('sidebar-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }

  if (tabId === 'tab-providers' && !tabState.loaded.providers) {
    tabState.loaded.providers = true;
    loadProviders();
  } else if (tabId === 'tab-cache' && !tabState.loaded.cache) {
    tabState.loaded.cache = true;
    loadCacheStats(); loadCacheEntries(1);
  } else if (tabId === 'tab-inquiries' && !tabState.loaded.inquiries) {
    tabState.loaded.inquiries = true;
    loadInquiries(1, {});
  } else if (tabId === 'tab-users' && !tabState.loaded.users) {
    tabState.loaded.users = true;
    loadUsers(1, {});
  } else if (tabId === 'tab-rfq' && !tabState.loaded.rfq) {
    tabState.loaded.rfq = true;
    loadRfqList(1, {});
  } else if (tabId === 'tab-prices' && !tabState.loaded.prices) {
    tabState.loaded.prices = true;
    loadYarnPrices();
  } else if (tabId === 'tab-dyeing-prices' && !tabState.loaded.dyeingPrices) {
    tabState.loaded.dyeingPrices = true;
    loadDyeingPrices();
  } else if (tabId === 'tab-validation' && !tabState.loaded.validation) {
    tabState.loaded.validation = true;
    loadValidationTab();
  } else if (tabId === 'tab-settings') {
    loadSettings();
  }
}

// ── OVERVIEW / DASHBOARD ─────────────────────────────────────
// One aggregated call (see routes/admin.js's GET /api/overview) backs every
// card here — the trend chart and "Top fabrics" now read the real
// materialized-view rollups (mv_daily_query_stats / mv_fabric_popularity)
// instead of the old client-side count over the last 100 raw log rows.
const STATUS_COLOR = {
  pending: '#E0A64A', under_review: '#E0A64A', quoted: '#5B9DF5',
  accepted: '#49B58B', rejected: '#E06A6A', expired: '#7B818A',
};

// Named distinctly from the validation tab's fmtPct() further down this file
// — both are top-level function declarations, so a same-named pair silently
// collides (the later one in source order wins for every call site, hoisting
// makes call order irrelevant), which is exactly what happened here once.
function kpiPct(n) { return (Number(n) || 0).toFixed(1).replace(/\.0$/, '') + '%'; }
function fmtDelta(cur, prev) {
  if (prev == null) return { text: '', cls: '' };
  const diff = cur - prev;
  if (diff === 0) return { text: 'same as yesterday', cls: '' };
  const pct = prev > 0 ? Math.round(Math.abs(diff) / prev * 100) : null;
  const dir = diff > 0 ? 'up' : 'down';
  const arrow = diff > 0 ? '↑' : '↓';
  return { text: arrow + ' ' + Math.abs(diff) + (pct != null ? ' (' + pct + '%)' : '') + ' vs yesterday', cls: dir };
}

function renderAlerts(alerts) {
  const el = document.getElementById('ov-alerts');
  if (!alerts.length) { el.innerHTML = ''; return; }
  el.innerHTML = alerts.map(function (a, i) {
    return '<div class="alert-item ' + esc(a.level) + '" data-alert-tab="' + esc(a.tab) + '">' +
      '<span class="adot"></span><span class="at">' + esc(a.text) + '</span><span class="aarrow">View &rarr;</span></div>';
  }).join('');
}

function renderChart(series) {
  const el = document.getElementById('ov-chart');
  if (!series.length || !series.some(function (d) { return d.total > 0; })) {
    el.innerHTML = '<div style="color:var(--t3);font-size:11px;padding:20px 0;text-align:center;">No queries logged yet.</div>';
    return;
  }
  const W = 560, H = 150, PAD_B = 16, PAD_T = 8, gap = 4;
  const n = series.length;
  const barW = Math.max(4, (W - gap * (n - 1)) / n);
  const max = Math.max(1, Math.max.apply(null, series.map(function (d) { return d.total; })));
  const scale = (H - PAD_B - PAD_T) / max;

  const bars = series.map(function (d, i) {
    const x = i * (barW + gap);
    const totalH = d.total * scale;
    const hitH = d.cache_hits * scale;
    const missH = totalH - hitH;
    const yTotal = H - PAD_B - totalH;
    const yHit = H - PAD_B - hitH;
    // pg returns a DATE column as a full ISO-datetime string (midnight UTC) via
    // node-postgres/JSON, not a bare YYYY-MM-DD — slice(5) alone left the time
    // portion ("09-08T06:00:00.000Z") in every axis label, overlapping the next.
    const datePart = String(d.date).split('T')[0];
    const dateShort = datePart.slice(5).replace('-', '/');
    const showLabel = n <= 10 || i % Math.ceil(n / 7) === 0;
    return '<g class="chart-bar-group">' +
      '<title>' + esc(d.date) + ': ' + esc(d.total) + ' queries, ' + esc(d.cache_hits) + ' from cache</title>' +
      '<rect class="bar-total" x="' + x + '" y="' + yTotal + '" width="' + barW + '" height="' + Math.max(0, missH) + '" fill="#3A4A63" rx="2"/>' +
      '<rect x="' + x + '" y="' + yHit + '" width="' + barW + '" height="' + Math.max(0, hitH) + '" fill="#5B9DF5" rx="2"/>' +
      (showLabel ? '<text class="chart-axis-label" x="' + (x + barW / 2) + '" y="' + (H - 2) + '" text-anchor="middle">' + esc(dateShort) + '</text>' : '') +
      '</g>';
  }).join('');

  el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart-wrap" style="width:100%;height:150px;display:block;">' + bars + '</svg>' +
    '<div class="chart-legend"><span><i style="background:#5B9DF5;"></i>From cache</span><span><i style="background:#3A4A63;"></i>Computed fresh</span></div>';

  const totalSum = series.reduce(function (a, d) { return a + d.total; }, 0);
  document.getElementById('ov-chart-sub').textContent = totalSum.toLocaleString() + ' total over ' + n + ' days';
}

function renderFunnel(counts, total) {
  const el = document.getElementById('ov-rfq-funnel');
  document.getElementById('ov-rfq-total').textContent = total + ' total';
  if (!total) {
    el.innerHTML = '<div style="color:var(--t3);font-size:11px;padding:8px 0;">No quote requests yet.</div>';
    return;
  }
  const order = ['pending', 'under_review', 'quoted', 'accepted', 'rejected', 'expired'];
  el.innerHTML = order.map(function (status) {
    const n = counts[status] || 0;
    const pct = total ? Math.max(2, Math.round(n / total * 100)) : 0;
    return '<div class="funnel-row">' +
      '<span class="funnel-lbl">' + esc(status.replace('_', ' ')) + '</span>' +
      '<div class="funnel-track"><div class="funnel-fill" style="width:' + (n ? pct : 0) + '%;background:' + STATUS_COLOR[status] + ';"></div></div>' +
      '<span class="funnel-val">' + esc(n) + '</span>' +
      '</div>';
  }).join('');
}

function renderProviderHealth(health) {
  const hEl = document.getElementById('ov-provider-health');
  if (!health.length) { hEl.innerHTML = '<div style="color:var(--t3);font-size:11px;">No providers configured</div>'; return; }
  hEl.innerHTML = health.map(function (p) {
    const ok = p.is_enabled && p.is_healthy;
    const col = !p.is_enabled ? 'var(--t4)' : p.is_healthy ? 'var(--a1)' : 'var(--a3)';
    const status = !p.is_enabled ? 'Disabled' : p.is_healthy ? 'Healthy' : 'Unhealthy';
    return '<div class="ov-health-row">' +
      '<div style="display:flex;align-items:center;gap:10px;">' +
        '<span style="width:7px;height:7px;border-radius:50%;background:' + col + ';display:inline-block;flex-shrink:0;"></span>' +
        '<span style="font-weight:600;color:var(--t1);font-size:12px;">' + esc(String(p.provider_name).toUpperCase()) + '</span>' +
        '<span style="font-size:10px;color:var(--t3);">' + esc(p.model_name) + '</span>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:10px;">' +
        '<span style="font-size:10px;color:' + col + ';">' + status + '</span>' +
        '<span style="font-size:10px;color:var(--t3);">Priority #' + esc(p.priority) + '</span>' +
        '<span style="font-size:10px;color:var(--t3);">' + esc(p.requests_today) + ' req/today</span>' +
      '</div></div>';
  }).join('');
}

function renderTopFabrics(rows) {
  const topEl = document.getElementById('ov-top-fabrics');
  if (!rows.length) { topEl.innerHTML = '<div style="color:var(--t3);font-size:11px;">No queries yet</div>'; return; }
  const max = rows[0].count || 1;
  topEl.innerHTML = rows.map(function (r) {
    return '<div style="margin-bottom:10px;">' +
      '<div style="display:flex;justify-content:space-between;margin-bottom:4px;">' +
        '<span style="font-size:11px;color:var(--t2);">' + esc(String(r.fabric).replace(/_/g, ' ')) + (r.avg_gsm ? ' <span style="color:var(--t4);">&middot; avg ' + Math.round(r.avg_gsm) + ' GSM</span>' : '') + '</span>' +
        '<span style="font-size:10px;color:var(--t3);">' + esc(r.count) + '</span>' +
      '</div>' +
      '<div style="height:3px;background:var(--bg4);border-radius:2px;">' +
        '<div style="height:3px;background:var(--a1);border-radius:2px;width:' + Math.round(r.count / max * 100) + '%;"></div>' +
      '</div></div>';
  }).join('');
}

async function loadOverview() {
  try {
    const d = await api('/admin/api/overview');

    document.getElementById('kpi-users-total').textContent = d.users.total.toLocaleString();
    document.getElementById('kpi-users-sub').textContent = d.users.new_7d + ' new in last 7 days';
    document.getElementById('kpi-sessions').textContent = d.users.active_sessions;
    document.getElementById('kpi-today').textContent = d.today.today_total;
    const delta = fmtDelta(d.today.today_total, d.yesterday_total);
    document.getElementById('kpi-today-sub').textContent = delta.text || ' ';
    document.getElementById('kpi-today-sub').className = 'kpi-sub ' + delta.cls;
    document.getElementById('kpi-cache').textContent = kpiPct(d.today.cache_hit_pct);
    document.getElementById('kpi-avg-ms').textContent = (d.today.avg_response_ms || 0) + 'ms';
    document.getElementById('kpi-rfq-pending').textContent = d.rfq.counts.pending;
    document.getElementById('kpi-rfq-sub').textContent = d.rfq.total + ' total requests';
    document.getElementById('kpi-providers').textContent = d.providers.active + '/' + d.providers.total;
    document.getElementById('kpi-cache-entries').textContent = d.cache.db_entries.toLocaleString();
    document.getElementById('kpi-new-users').textContent = d.users.new_today;

    const rfqBadge = document.getElementById('sb-count-rfq');
    if (d.rfq.counts.pending > 0) { rfqBadge.textContent = d.rfq.counts.pending; rfqBadge.hidden = false; } else { rfqBadge.hidden = true; }
    const provBadge = document.getElementById('sb-count-providers');
    const unhealthyCount = d.providers.health.filter(function (p) { return p.is_enabled && !p.is_healthy; }).length;
    if (unhealthyCount > 0) { provBadge.textContent = unhealthyCount; provBadge.hidden = false; } else { provBadge.hidden = true; }

    renderAlerts(d.alerts);
    renderChart(d.series);
    renderFunnel(d.rfq.counts, d.rfq.total);
    renderProviderHealth(d.providers.health);
    renderTopFabrics(d.top_fabrics);
  } catch (e) {
    console.error('Overview error:', e);
    toast('Failed to load dashboard', 'error');
  }
}

// ── LOGS ───────────────────────────────────────────────────
let curLogPage = 1;

async function loadLogStats() {
  try {
    const d = await api('/admin/api/logs/stats');
    document.getElementById('stat-today').textContent    = d.today_total || 0;
    document.getElementById('stat-cache-pct').textContent = (d.cache_hit_pct || 0) + '%';
    document.getElementById('stat-avg-ms').textContent   = d.avg_response_ms || 0;
    document.getElementById('stat-nl').textContent       = d.nl_query_count || 0;
  } catch (e) { console.error(e); }
}

async function loadLogs(page, filters) {
  try {
    const p = new URLSearchParams({ page });
    if (filters.fabric)     p.append('fabric', filters.fabric);
    if (filters.date_from)  p.append('date_from', filters.date_from);
    if (filters.date_to)    p.append('date_to', filters.date_to);
    if (filters.from_cache !== undefined && filters.from_cache !== '') p.append('from_cache', filters.from_cache);
    if (filters.nl_only)    p.append('nl_only', 'true');

    const d = await api('/admin/api/logs?' + p);
    const tbody = document.getElementById('log-tbody');
    tbody.innerHTML = '';
    if (!d.rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--t3);">No logs found</td></tr>';
    }
    for (const r of d.rows) {
      const tr = document.createElement('tr');
      const hit = r.from_cache;
      tr.innerHTML = `
        <td class="tbl-td">${esc(new Date(r.created_at).toLocaleString())}</td>
        <td class="tbl-td" title="${esc(r.input_text)}" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc((r.input_text||'').substring(0,45))}${(r.input_text||'').length>45?'…':''}</td>
        <td class="tbl-td">${esc(r.parsed_fabric||'—')}</td>
        <td class="tbl-td">${esc(r.parsed_gsm||'—')}</td>
        <td class="tbl-td">${esc(r.response_ms||'—')}</td>
        <td class="tbl-td"><span class="badge ${hit?'badge-green':'badge-red'}">${hit?'HIT':'MISS'}</span></td>
        <td class="tbl-td">${esc(r.ai_provider||'—')}</td>
      `;
      tbody.appendChild(tr);
    }
    renderPagination('log-pagination', d.page, d.pages, (pg) => loadLogs(pg, getLogFilters()));
    curLogPage = page;
  } catch (e) { toast('Failed to load logs', 'error'); }
}

function getLogFilters() {
  return {
    fabric:     document.getElementById('filter-fabric').value,
    date_from:  document.getElementById('filter-date-from').value,
    date_to:    document.getElementById('filter-date-to').value,
    from_cache: document.getElementById('filter-cache').value,
    nl_only:    document.getElementById('filter-nl-only').checked
  };
}

// ── AI PROVIDERS ───────────────────────────────────────────
let _currentStrategy = 'priority';

async function loadProviders() {
  const container = document.getElementById('providers-list');
  try {
    const d = await api('/admin/api/providers');
    _currentStrategy = d.strategy || 'priority';

    // Update strategy buttons
    document.querySelectorAll('.strategy-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.strategy === _currentStrategy);
    });

    // Render fallback chain
    renderFallbackChain(d.providers, _currentStrategy);

    container.innerHTML = '';
    if (!d.providers || !d.providers.length) {
      container.innerHTML = '<div style="color:var(--t3);font-size:11px;padding:20px 0;">No providers found in database</div>';
      return;
    }
    for (const p of d.providers) {
      container.appendChild(buildProviderCard(p));
    }
  } catch (e) {
    container.innerHTML = `<div style="color:var(--a3);font-size:11px;padding:20px 0;">Error: ${esc(e.message)}</div>`;
    toast('Failed to load providers: ' + e.message, 'error');
  }
}

function renderFallbackChain(providers, strategy) {
  const el = document.getElementById('fallback-chain');
  if (!providers || !providers.length) { el.innerHTML = '<span style="font-size:10px;color:var(--t4);">No providers</span>'; return; }

  // Order by strategy (visual representation)
  let ordered = [...providers].filter(p => p.is_enabled);
  if (strategy === 'fastest') {
    ordered.sort((a, b) => (a.avg_response_ms || 99999) - (b.avg_response_ms || 99999));
  } else {
    ordered.sort((a, b) => a.priority - b.priority);
  }

  const disabled = providers.filter(p => !p.is_enabled);

  const html = ordered.map((p, i) => {
    const isActive = p.is_healthy && p.is_enabled;
    const isCooldown = p.cooldown_until && new Date(p.cooldown_until) > new Date();
    let cls = 'chain-node';
    let dotCls = 'chain-dot chain-dot-ok';
    if (!p.is_enabled) { cls += ' disabled'; dotCls = 'chain-dot chain-dot-dis'; }
    else if (!p.is_healthy || isCooldown) { cls += ' unhealthy'; dotCls = 'chain-dot chain-dot-bad'; }
    else { cls += ' active'; }

    const msLabel = p.avg_response_ms ? `${p.avg_response_ms}ms` : '—';
    const arrow = i < ordered.length - 1 ? '<span class="chain-arrow">→</span>' : '';
    const rrLabel = strategy === 'round_robin' ? '<span style="font-size:8px;color:var(--t4);margin-left:3px;">RR</span>' : '';
    return `
      <span class="${cls}">
        <span class="${dotCls}"></span>
        ${p.display_name || p.provider_name.toUpperCase()}
        <span style="font-size:9px;color:var(--t4);font-weight:400;">${msLabel}</span>
        ${rrLabel}
      </span>${arrow}`;
  }).join('');

  const disabledHtml = disabled.length
    ? `<span style="font-size:9px;color:var(--t4);margin-left:12px;">+ ${disabled.length} disabled</span>`
    : '';

  el.innerHTML = html + disabledHtml || '<span style="font-size:10px;color:var(--t4);">All providers disabled</span>';
}

function buildProviderCard(p) {
  const card = document.createElement('div');
  const healthy = p.is_healthy;
  const enabled = p.is_enabled;
  let keyIsSet = !!p.key_is_set;
  const isCooldown = p.cooldown_until && new Date(p.cooldown_until) > new Date();

  card.className = 'prov-card' + (healthy && enabled ? ' healthy' : !healthy && enabled ? ' unhealthy' : '') + (!enabled ? ' disabled' : '');
  card.dataset.id = p.id;
  card.dataset.priority = p.priority;

  const hdotClass = !enabled ? 'hdot hdot-dis' : healthy ? 'hdot hdot-ok' : 'hdot hdot-bad';
  const statusText = !enabled ? 'Disabled' : isCooldown ? 'Cooldown' : healthy ? 'Healthy' : 'Unhealthy';

  const keyStatusBadge = keyIsSet
    ? `<span class="key-set-badge">● KEY SET</span>`
    : `<span class="key-notset-badge">⚠ NOT SET</span>`;
  const keyCurrentDisplay = keyIsSet
    ? `<span class="key-current-value">${p.api_key_env} = ••••••••••••••••••••••••••••••</span>`
    : `<span class="key-current-value" style="color:var(--t4);">No key configured</span>`;

  const cooldownHtml = isCooldown
    ? `<div style="display:flex;align-items:center;gap:6px;padding:7px 10px;background:rgba(255,68,68,.08);border:1px solid rgba(255,68,68,.2);border-radius:var(--rad-sm);">
         <span style="color:var(--a3);font-size:10px;">⏱ Cooldown until ${new Date(p.cooldown_until).toLocaleTimeString()}</span>
         <button class="btn btn-xs prov-clear-cooldown" style="border:none;background:transparent;color:var(--a2);cursor:pointer;padding:0;">Clear</button>
       </div>` : '';

  const lastFailHtml = p.last_failure_at
    ? `<span style="font-size:10px;color:var(--t4);">Last fail: ${new Date(p.last_failure_at).toLocaleString()}</span>` : '';

  const displayName = p.display_name || p.provider_name.toUpperCase();
  const typeBadge = p.provider_type && p.provider_type !== p.provider_name
    ? `<span style="font-size:9px;padding:1px 6px;border-radius:3px;background:rgba(108,142,255,.1);color:var(--a2);border:1px solid rgba(108,142,255,.2);margin-left:4px;">${p.provider_type.toUpperCase()}</span>`
    : '';
  const avgMs = p.avg_response_ms ? `<span style="font-size:9px;color:var(--t4);">${p.avg_response_ms}ms avg</span>` : '';

  card.innerHTML = `
    <div class="prov-head">
      <div style="display:flex;flex-direction:column;align-items:center;gap:3px;">
        <div class="prov-rank">${p.priority}</div>
        <div class="prov-order-btns">
          <button class="prov-order-btn prov-up" title="Move up">▲</button>
          <button class="prov-order-btn prov-dn" title="Move down">▼</button>
        </div>
      </div>
      <div class="prov-meta">
        <div class="prov-name">${displayName}${typeBadge}</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="prov-model">${p.model_name}</div>
          ${avgMs}
        </div>
      </div>
      <div class="prov-stats">
        <div class="prov-stat">
          <div class="prov-stat-val">${p.requests_today}</div>
          <div class="prov-stat-lbl">Req/Day</div>
        </div>
        <div class="prov-stat">
          <div class="prov-stat-val">${(p.tokens_today||0).toLocaleString()}</div>
          <div class="prov-stat-lbl">Tokens</div>
        </div>
        <div class="prov-stat">
          <div class="prov-stat-val" style="color:${p.failures_today>0?'var(--a3)':'inherit'}">${p.failures_today}</div>
          <div class="prov-stat-lbl">Fails</div>
        </div>
      </div>
      <div class="prov-right">
        <div class="health-indicator">
          <span class="${hdotClass}"></span>
          <span style="font-size:10px;color:var(--t3);">${statusText}</span>
        </div>
        <label class="toggle prov-toggle-wrap" title="Enable/disable provider">
          <input type="checkbox" class="prov-toggle" ${enabled ? 'checked' : ''}>
          <span class="toggle-track"></span>
        </label>
        <span class="prov-expand-icon">▾</span>
      </div>
    </div>

    <div class="prov-body">

      <!-- API KEY SECTION -->
      <div class="prov-body-section">
        <div class="prov-section-label">API Key Configuration</div>
        <div class="key-section">
          <div class="key-current-row">
            <span class="key-current-label">Current:</span>
            ${keyCurrentDisplay}
            ${keyStatusBadge}
          </div>
          <div class="key-new-row">
            <input type="password" class="key-input prov-apikey"
              value="${keyIsSet ? '••••••••••••••••••••••••••••••' : ''}"
              placeholder="${keyIsSet ? '••••••••••••••••••••••••••••••' : `Enter new ${p.api_key_env}…`}"
              autocomplete="new-password" spellcheck="false">
            <button class="key-toggle-btn prov-key-show" type="button">Show</button>
            <button class="btn btn-primary btn-sm prov-apikey-save">Save Key</button>
          </div>
          <div class="prov-key-warning" style="margin-top:5px;font-size:10px;color:var(--a3);display:none;font-weight:600;">
            ⚠ Warning: You are editing an existing API key. Typing and saving will overwrite it!
          </div>
          <div class="prov-key-feedback" style="margin-top:8px;font-size:10px;min-height:14px;color:var(--t3);">
            Env var: <code style="color:var(--t2);background:var(--bg3);padding:1px 5px;border-radius:3px;">${p.api_key_env}</code>
            — writes to secure database storage
          </div>
        </div>
      </div>

      <!-- MODEL SECTION -->
      <div class="prov-body-section">
        <div class="prov-section-label">Model Configuration</div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <input type="text" class="key-input prov-model-input" value="${p.model_name}"
            style="max-width:300px;" placeholder="model name">
          <button class="btn btn-ghost btn-sm prov-model-save">Save Model</button>
          <span class="prov-model-feedback" style="font-size:10px;color:var(--t3);">Change model if current one is deprecated</span>
        </div>
      </div>

      <!-- TEST SECTION -->
      <div class="prov-body-section">
        <div class="prov-section-label">Connection Test</div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <button class="btn btn-ghost btn-sm prov-test">▶ Test Connection</button>
          <div class="prov-test-result" id="prov-test-${p.id}"></div>
          ${cooldownHtml}
        </div>
        <div class="prov-test-detail" id="prov-test-detail-${p.id}" style="display:none;margin-top:10px;padding:10px;background:var(--bg4);border-radius:var(--rad-sm);border:1px solid var(--line);font-size:10px;color:var(--t2);line-height:1.6;"></div>
        ${lastFailHtml ? `<div style="margin-top:8px;">${lastFailHtml}</div>` : ''}
      </div>

      <!-- LIMITS & DANGER SECTION -->
      <div class="prov-body-section">
        <div class="prov-section-label">Rate Limits & Usage</div>
        <div class="prov-limits">
          <div class="prov-limit-item">
            <div class="prov-limit-val">${(p.daily_limit||0).toLocaleString()}</div>
            <div class="prov-limit-lbl">Daily Limit</div>
          </div>
          <div class="prov-limit-item">
            <div class="prov-limit-val">${p.per_min_limit||0}</div>
            <div class="prov-limit-lbl">Per Minute</div>
          </div>
          <div class="prov-limit-item">
            <div class="prov-limit-val">${(p.tokens_today||0).toLocaleString()}</div>
            <div class="prov-limit-lbl">Tokens Used</div>
          </div>
          <div class="prov-limit-item">
            <div class="prov-limit-val">${Math.round(((p.tokens_today||0)/(p.daily_limit||1))*100)}%</div>
            <div class="prov-limit-lbl">Used Today</div>
          </div>
          <div class="prov-limit-item">
            <div class="prov-limit-val" style="color:${p.avg_response_ms?'var(--t1)':'var(--t4)'};">${p.avg_response_ms ? p.avg_response_ms+'ms' : '—'}</div>
            <div class="prov-limit-lbl">Avg Response</div>
          </div>
        </div>
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;">
          <span style="font-size:10px;color:var(--t4);">Provider ID: #${p.id} · ${p.provider_name}</span>
          <button class="btn btn-danger btn-xs prov-delete-btn" title="Remove this provider instance">✕ Remove</button>
        </div>
      </div>

    </div>
  `;

  // Toggle expand
  card.querySelector('.prov-head').addEventListener('click', (e) => {
    if (e.target.closest('.prov-toggle-wrap') || e.target.closest('.prov-order-btn')) return;
    card.classList.toggle('open');
  });

  // Show/hide key
  const keyInput = card.querySelector('.prov-apikey');
  const showBtn  = card.querySelector('.prov-key-show');
  const keyWarning = card.querySelector('.prov-key-warning');

  // Input warnings for editing existing key
  if (keyIsSet) {
    keyInput.addEventListener('focus', () => {
      if (keyInput.value === '••••••••••••••••••••••••••••••') {
        keyInput.value = '';
      }
    });

    keyInput.addEventListener('input', () => {
      if (keyInput.value.trim() !== '' && keyInput.value !== '••••••••••••••••••••••••••••••') {
        keyWarning.style.display = 'block';
      } else {
        keyWarning.style.display = 'none';
      }
    });

    keyInput.addEventListener('blur', () => {
      if (keyInput.value.trim() === '') {
        keyInput.value = '••••••••••••••••••••••••••••••';
        keyWarning.style.display = 'none';
      }
    });
  }

  showBtn.addEventListener('click', () => {
    const visible = keyInput.type === 'text';
    keyInput.type = visible ? 'password' : 'text';
    showBtn.textContent = visible ? 'Show' : 'Hide';
  });

  // Save key
  const saveBtn = card.querySelector('.prov-apikey-save');
  saveBtn.addEventListener('click', async () => {
    const key = keyInput.value.trim();
    if (!key) { toast('Enter an API key first', 'error'); return; }
    if (key === '••••••••••••••••••••••••••••••') {
      toast('API key is unchanged', 'info');
      return;
    }

    if (keyIsSet) {
      const confirmOverwrite = confirm(`Are you sure you want to overwrite the existing API key for ${p.provider_name.toUpperCase()}?`);
      if (!confirmOverwrite) return;
    }

    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    const feedback = card.querySelector('.prov-key-feedback');
    try {
      await api(`/admin/api/providers/${p.id}/apikey`, 'POST', { key });
      toast(`${p.provider_name.toUpperCase()} API key saved successfully`, 'success');
      
      keyIsSet = true; // Mark as set now
      keyInput.value = '••••••••••••••••••••••••••••••';
      keyInput.type = 'password';
      showBtn.textContent = 'Show';
      keyWarning.style.display = 'none';

      // Update current key display
      const currentRow = card.querySelector('.key-current-row');
      currentRow.querySelector('.key-current-value').textContent = `${p.api_key_env} = ••••••••••••••••••••••••••••••`;
      const badge = currentRow.querySelector('.key-notset-badge');
      if (badge) { badge.className = 'key-set-badge'; badge.textContent = '● KEY SET'; }
      feedback.style.color = 'var(--a1)';
      feedback.innerHTML = '✓ Key saved — active immediately (no restart needed)';

      // Wire focus/input listeners if it was not previously set
      keyInput.addEventListener('focus', () => {
        if (keyInput.value === '••••••••••••••••••••••••••••••') {
          keyInput.value = '';
        }
      });
      keyInput.addEventListener('input', () => {
        if (keyInput.value.trim() !== '' && keyInput.value !== '••••••••••••••••••••••••••••••') {
          keyWarning.style.display = 'block';
        } else {
          keyWarning.style.display = 'none';
        }
      });
      keyInput.addEventListener('blur', () => {
        if (keyInput.value.trim() === '') {
          keyInput.value = '••••••••••••••••••••••••••••••';
          keyWarning.style.display = 'none';
        }
      });
    } catch (e) {
      toast('Failed to save key: ' + e.message, 'error');
      feedback.style.color = 'var(--a3)';
      feedback.textContent = '✗ Save failed: ' + e.message;
    } finally {
      saveBtn.disabled = false; saveBtn.textContent = 'Save Key';
    }
  });

  // Toggle enable
  card.querySelector('.prov-toggle').addEventListener('change', async (e) => {
    try {
      await api(`/admin/api/providers/${p.id}/enabled`, 'PATCH', { enabled: e.target.checked });
      toast(`${p.provider_name.toUpperCase()} ${e.target.checked ? 'enabled' : 'disabled'}`, 'success');
      setTimeout(loadProviders, 400);
    } catch (err) {
      toast('Toggle failed: ' + err.message, 'error');
      e.target.checked = !e.target.checked; // revert
    }
  });

  // Move up/down
  card.querySelector('.prov-up').addEventListener('click', () => moveProvider(p.id, 'up'));
  card.querySelector('.prov-dn').addEventListener('click', () => moveProvider(p.id, 'down'));

  // Save model
  card.querySelector('.prov-model-save').addEventListener('click', async () => {
    const modelInput = card.querySelector('.prov-model-input');
    const modelName = modelInput.value.trim();
    const feedback = card.querySelector('.prov-model-feedback');
    if (!modelName) { toast('Model name required', 'error'); return; }
    const btn = card.querySelector('.prov-model-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await api(`/admin/api/providers/${p.id}/model`, 'PATCH', { model_name: modelName });
      toast(`${p.provider_name.toUpperCase()} model updated`, 'success');
      card.querySelector('.prov-model').textContent = modelName;
      feedback.style.color = 'var(--a1)';
      feedback.textContent = 'Model saved — test connection to verify';
    } catch (e) {
      toast('Model save failed: ' + e.message, 'error');
      feedback.style.color = 'var(--a3)';
      feedback.textContent = e.message;
    } finally {
      btn.disabled = false; btn.textContent = 'Save Model';
    }
  });

  // Test
  card.querySelector('.prov-test').addEventListener('click', async () => {
    const resultEl   = document.getElementById(`prov-test-${p.id}`);
    const detailEl   = document.getElementById(`prov-test-detail-${p.id}`);
    const btn        = card.querySelector('.prov-test');
    btn.disabled = true; btn.textContent = 'Testing…';
    resultEl.style.display = 'none';
    detailEl.style.display = 'none';
    try {
      const r = await api(`/admin/api/providers/${p.id}/test`, 'POST');
      const isRateLimited = !!r.result?.rate_limited;
      if (isRateLimited) {
        resultEl.className = 'prov-test-result warn';
        resultEl.textContent = `OK (Rate Limited) · 429`;
      } else {
        resultEl.className = 'prov-test-result ok';
        resultEl.textContent = `OK · ${r.response_ms}ms`;
      }
      resultEl.style.display = 'block';

      // Show parsed result detail
      const parsed = r.result?.parsed || r.result || {};
      detailEl.style.display = 'block';
      if (isRateLimited) {
        detailEl.innerHTML = `<strong style="color:var(--a4);">Status Note:</strong> <span style="color:var(--t2);">${esc(r.result?.message || 'API key validated but rate limited.')}</span>`;
      } else {
        detailEl.innerHTML = `<strong style="color:var(--a1);">Parse Result:</strong> ` +
          Object.entries(parsed).filter(([k]) => !['message'].includes(k)).map(([k,v]) =>
            `<span style="color:var(--t3);">${k}:</span> <span style="color:var(--t1);">${v}</span>`
          ).join(' &nbsp;·&nbsp; ');
      }
      // Update health dot in card header
      const hdot = card.querySelector('.hdot');
      hdot.className = 'hdot hdot-ok';
      card.querySelector('.health-indicator span:last-child').textContent = 'Healthy';
      card.classList.remove('unhealthy'); card.classList.add('healthy');
    } catch (e) {
      resultEl.className = 'prov-test-result err';
      resultEl.textContent = 'Failed: ' + e.message;
      resultEl.style.display = 'block';
      const hdot = card.querySelector('.hdot');
      hdot.className = 'hdot hdot-bad';
      card.querySelector('.health-indicator span:last-child').textContent = 'Unhealthy';
      card.classList.remove('healthy'); card.classList.add('unhealthy');
    } finally {
      btn.disabled = false; btn.textContent = '▶ Test Connection';
    }
  });

  // Delete provider
  card.querySelector('.prov-delete-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`Remove "${displayName}"? This cannot be undone.`)) return;
    try {
      await api(`/admin/api/providers/${p.id}`, 'DELETE');
      toast(`${displayName} removed`, 'success');
      loadProviders();
    } catch (err) {
      toast('Remove failed: ' + err.message, 'error');
    }
  });

  // Clear cooldown — present only while the provider is actually in cooldown.
  // Wired here rather than as an inline onclick so the admin panel can run
  // under a CSP with script-src-attr 'none', which is the whole point of
  // having a separate policy for it.
  const clearBtn = card.querySelector('.prov-clear-cooldown');
  if (clearBtn) {
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearCooldown(p.id);
    });
  }

  return card;
}

async function clearCooldown(id) {
  try {
    await api(`/admin/api/providers/reset-stats`, 'POST');
    toast('Cooldowns cleared', 'success');
    loadProviders();
  } catch (e) { toast('Failed: ' + e.message, 'error'); }
}

// ── ADD PROVIDER MODAL ─────────────────────────────────────
let _providerTypes = [];
let _selectedType = null;

async function openAddProviderModal() {
  const modal = document.getElementById('add-provider-modal');
  modal.classList.remove('hidden');
  document.getElementById('ap-error').textContent = '';

  // Load provider types if not yet loaded
  if (!_providerTypes.length) {
    try {
      const d = await api('/admin/api/providers/types');
      _providerTypes = d.types || [];
    } catch (e) {
      _providerTypes = [
        { type: 'groq',    default_model: 'llama-3.3-70b-versatile', env_var_hint: 'GROQ_API_KEY_2',    default_daily_limit: 14400, default_per_min_limit: 30 },
        { type: 'gemini',  default_model: 'gemini-1.5-flash',        env_var_hint: 'GEMINI_API_KEY',    default_daily_limit: 50000, default_per_min_limit: 15 },
        { type: 'mistral', default_model: 'mistral-small-latest',    env_var_hint: 'MISTRAL_API_KEY',   default_daily_limit: 10000, default_per_min_limit: 10 },
        { type: 'cohere',  default_model: 'command-r',               env_var_hint: 'COHERE_API_KEY',    default_daily_limit:  1000, default_per_min_limit:  5 },
        { type: 'openai',  default_model: 'gpt-4o-mini',             env_var_hint: 'OPENAI_API_KEY',    default_daily_limit: 10000, default_per_min_limit: 60 },
      ];
    }
  }

  // Render type cards
  const grid = document.getElementById('type-grid');
  grid.innerHTML = _providerTypes.map(t => `
    <div class="type-card" data-type="${t.type}">
      <div class="type-card-name">${t.type.toUpperCase()}</div>
      <div class="type-card-model">${t.default_model.substring(0, 14)}…</div>
    </div>
  `).join('');

  grid.querySelectorAll('.type-card').forEach(card => {
    card.addEventListener('click', () => {
      grid.querySelectorAll('.type-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      const t = _providerTypes.find(x => x.type === card.dataset.type);
      _selectedType = t;
      // Autofill defaults
      document.getElementById('ap-model').value = t.default_model || '';
      document.getElementById('ap-env-var').value = t.env_var_hint || '';
      document.getElementById('ap-daily-limit').value = t.default_daily_limit || '';
      document.getElementById('ap-per-min').value = t.default_per_min_limit || '';
      document.getElementById('ap-display-name').placeholder = t.type.toUpperCase() + ' (Account 2)';
      document.getElementById('ap-url').value = '';
    });
  });

  // Auto-select first
  grid.querySelector('.type-card')?.click();
}

function closeAddProviderModal() {
  document.getElementById('add-provider-modal').classList.add('hidden');
  _selectedType = null;
  document.getElementById('ap-display-name').value = '';
  document.getElementById('ap-env-var').value = '';
  document.getElementById('ap-model').value = '';
  document.getElementById('ap-daily-limit').value = '';
  document.getElementById('ap-per-min').value = '';
  document.getElementById('ap-url').value = '';
  document.getElementById('ap-error').textContent = '';
}

async function doAddProvider() {
  const errEl = document.getElementById('ap-error');
  errEl.textContent = '';

  if (!_selectedType) { errEl.textContent = 'Select a provider type'; return; }
  const envVar = document.getElementById('ap-env-var').value.trim();
  if (!envVar) { errEl.textContent = 'API Key Env Variable name is required'; return; }

  const body = {
    provider_type: _selectedType.type,
    display_name: document.getElementById('ap-display-name').value.trim() || null,
    api_key_env: envVar,
    model_name: document.getElementById('ap-model').value.trim() || _selectedType.default_model,
    api_url: document.getElementById('ap-url').value.trim() || null,
    daily_limit: parseInt(document.getElementById('ap-daily-limit').value) || null,
    per_min_limit: parseInt(document.getElementById('ap-per-min').value) || null,
  };

  const btn = document.getElementById('ap-save');
  btn.disabled = true; btn.textContent = 'Adding…';

  try {
    const r = await api('/admin/api/providers', 'POST', body);
    toast(`Provider ${r.provider_name} added`, 'success');
    closeAddProviderModal();
    loadProviders();
  } catch (e) {
    errEl.textContent = e.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Add Provider';
  }
}

async function moveProvider(id, dir) {
  const cards = [...document.querySelectorAll('.prov-card')];
  const idx = cards.findIndex(c => Number(c.dataset.id) === Number(id));
  if (idx === -1) return;
  const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= cards.length) return;

  const myPri    = parseInt(cards[idx].dataset.priority);
  const otherId  = Number(cards[swapIdx].dataset.id);
  const otherPri = parseInt(cards[swapIdx].dataset.priority);

  try {
    await api(`/admin/api/providers/${id}/priority`,     'PATCH', { priority: otherPri });
    await api(`/admin/api/providers/${otherId}/priority`, 'PATCH', { priority: myPri });
    loadProviders();
  } catch (e) {
    toast('Reorder failed: ' + e.message, 'error');
  }
}

// ── CACHE ──────────────────────────────────────────────────
let curCachePage = 1;

async function loadCacheStats() {
  try {
    const d = await api('/admin/api/cache/stats');
    document.getElementById('cache-stat-entries').textContent = (d.db_entries || 0).toLocaleString();
    document.getElementById('cache-stat-hits').textContent    = (d.db_hits || 0).toLocaleString();
    document.getElementById('cache-stat-mem').textContent     = d.mem_size || 0;
    document.getElementById('cache-stat-oldest').textContent  = d.oldest_entry ? new Date(d.oldest_entry).toLocaleDateString() : '—';
  } catch (e) { console.error(e); }
}

async function loadCacheEntries(page) {
  try {
    const d = await api(`/admin/api/cache/entries?page=${page}`);
    const tbody = document.getElementById('cache-tbody');
    tbody.innerHTML = '';
    if (!d.rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--t3);">Cache is empty</td></tr>';
    }
    for (const r of d.rows) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="padding:9px 10px;color:var(--t2);font-family:var(--mono);font-size:10px;word-break:break-all;">${esc(String(r.cache_key).substring(0,24))}…</td>
        <td style="padding:9px 10px;color:var(--t2);font-family:var(--mono);">${esc(r.hit_count)}</td>
        <td style="padding:9px 10px;color:var(--t2);font-family:var(--mono);">${new Date(r.created_at).toLocaleString()}</td>
        <td style="padding:9px 10px;color:var(--t2);font-family:var(--mono);">${new Date(r.expires_at).toLocaleString()}</td>
        <td style="padding:9px 10px;">
          <div style="display:flex;gap:6px;">
            <button class="btn btn-ghost btn-xs cache-view" data-key="${esc(r.cache_key)}">View</button>
            <button class="btn btn-danger btn-xs cache-del" data-key="${esc(r.cache_key)}">Delete</button>
          </div>
        </td>
      `;
      tr.querySelector('.cache-view').addEventListener('click', () => viewCacheEntry(r.cache_key));
      tr.querySelector('.cache-del').addEventListener('click',  () => deleteCacheEntry(r.cache_key));
      tbody.appendChild(tr);
    }
    renderPagination('cache-pagination', d.page, d.pages, (pg) => loadCacheEntries(pg));
    curCachePage = page;
  } catch (e) { toast('Failed to load cache', 'error'); }
}

async function viewCacheEntry(key) {
  try {
    const d = await api(`/admin/api/cache/entry/${key}`);
    document.getElementById('entry-key-display').textContent = d.cache_key;
    document.getElementById('entry-json-display').textContent = JSON.stringify(d.result_json, null, 2);
    document.getElementById('cache-entry-viewer').classList.remove('hidden');
  } catch (e) { toast('Failed to load entry', 'error'); }
}

async function deleteCacheEntry(key) {
  if (!confirm('Delete this cache entry?')) return;
  try {
    await api(`/admin/api/cache/entry/${key}`, 'DELETE');
    loadCacheEntries(curCachePage);
    toast('Entry deleted', 'success');
  } catch (e) { toast('Delete failed: ' + e.message, 'error'); }
}

async function flushCache() {
  if (!confirm('Flush ALL cache entries? Cannot be undone.')) return;
  try {
    const r = await api('/admin/api/cache/flush', 'DELETE');
    loadCacheStats(); loadCacheEntries(1);
    toast(`Deleted ${r.deleted} entries`, 'success');
  } catch (e) { toast('Flush failed: ' + e.message, 'error'); }
}

// ── INQUIRIES ──────────────────────────────────────────────
let curInqPage = 1;

function getInqFilters() {
  return {
    fabric:    document.getElementById('inq-filter-fabric').value,
    date_from: document.getElementById('inq-filter-from').value,
    date_to:   document.getElementById('inq-filter-to').value,
  };
}

async function loadInquiries(page, filters) {
  try {
    const p = new URLSearchParams({ page, limit: 50 });
    if (filters.fabric)    p.append('fabric', filters.fabric);
    if (filters.date_from) p.append('date_from', filters.date_from);
    if (filters.date_to)   p.append('date_to', filters.date_to);

    const d = await api('/admin/api/inquiries?' + p);
    const tbody = document.getElementById('inq-tbody');
    tbody.innerHTML = '';
    if (!d.rows.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--t3);">No inquiries found</td></tr>';
    }
    for (const r of d.rows) {
      const tr = document.createElement('tr');
      const hit = r.from_cache;
      tr.innerHTML = `
        <td style="padding:9px 10px;color:var(--t3);font-family:var(--mono);">${esc(r.id)}</td>
        <td style="padding:9px 10px;color:var(--t2);font-family:var(--mono);">${esc(new Date(r.created_at).toLocaleString())}</td>
        <td style="padding:9px 10px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--t2);" title="${esc(r.input_text)}">${esc((r.input_text||'').substring(0,40))}${(r.input_text||'').length>40?'…':''}</td>
        <td style="padding:9px 10px;color:var(--t2);">${esc(r.parsed_fabric||'—')}</td>
        <td style="padding:9px 10px;color:var(--t2);">${esc(r.parsed_gsm||'—')}</td>
        <td style="padding:9px 10px;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--t2);" title="${esc(r.parsed_composition)}">${esc((r.parsed_composition||'—').substring(0,20))}</td>
        <td style="padding:9px 10px;color:var(--t2);">${esc(r.ai_provider||'—')}</td>
        <td style="padding:9px 10px;color:var(--t2);">${esc(r.response_ms||'—')}</td>
        <td style="padding:9px 10px;"><span class="badge ${hit?'badge-green':'badge-red'}">${hit?'HIT':'MISS'}</span></td>
      `;
      tbody.appendChild(tr);
    }
    renderPagination('inq-pagination', d.page, d.pages, (pg) => loadInquiries(pg, getInqFilters()), d.total);
    curInqPage = page;
  } catch (e) { toast('Failed to load inquiries', 'error'); }
}

async function downloadInquiriesCSV() {
  const f = getInqFilters();
  const p = new URLSearchParams({ format: 'csv' });
  if (f.fabric)    p.append('fabric', f.fabric);
  if (f.date_from) p.append('date_from', f.date_from);
  if (f.date_to)   p.append('date_to', f.date_to);
  try {
    const res = await fetch(API_BASE + '/admin/api/inquiries?' + p, { headers: { 'X-Admin-Token': getToken() } });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `inquiries_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('CSV downloaded', 'success');
  } catch (e) { toast('CSV download failed', 'error'); }
}

// ── USERS ──────────────────────────────────────────────────
const PLAN_LABELS = { floor: 'Floor', mill: 'Mill', buying_house: 'Buying House' };

function getUsrFilters() {
  return { search: document.getElementById('usr-filter-search').value.trim() };
}

async function loadUsers(page, filters) {
  try {
    const p = new URLSearchParams({ page, limit: 25 });
    if (filters.search) p.append('search', filters.search);
    const d = await api('/admin/api/users?' + p);

    const tbody = document.getElementById('usr-tbody');
    tbody.innerHTML = '';
    if (!d.rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--t3);">No users found</td></tr>';
    }
    for (const u of d.rows) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="padding:9px 10px;color:var(--t2);">${esc(u.full_name)}<div style="font-size:10px;color:var(--t3);">${esc(u.email)}</div></td>
        <td style="padding:9px 10px;color:var(--t2);font-family:var(--mono);">${esc(u.username || '—')}</td>
        <td style="padding:9px 10px;color:var(--t2);">${esc(u.company || '—')}</td>
        <td style="padding:9px 10px;color:var(--t2);">${esc(PLAN_LABELS[u.plan_interest] || '—')}</td>
        <td style="padding:9px 10px;color:var(--t3);font-family:var(--mono);">${esc(new Date(u.created_at).toLocaleDateString())}</td>
        <td style="padding:9px 10px;color:var(--t3);font-family:var(--mono);">${u.last_login_at ? esc(new Date(u.last_login_at).toLocaleString()) : '—'}</td>
        <td style="padding:9px 10px;white-space:nowrap;">
          <span class="badge ${u.disabled ? 'badge-red' : 'badge-green'}">${u.disabled ? 'disabled' : 'active'}</span>
          ${u.email_verified ? '' : '<span class="badge badge-yellow" title="Has not entered their activation code yet">unverified</span>'}
        </td>
        <td style="padding:9px 10px;white-space:nowrap;">
          <button class="btn btn-ghost btn-sm" data-usr-view="${esc(u.id)}">View</button>
          <button class="btn btn-ghost btn-sm" data-usr-id="${esc(u.id)}" data-usr-disable="${u.disabled ? 'false' : 'true'}">${u.disabled ? 'Enable' : 'Disable'}</button>
        </td>
      `;
      tbody.appendChild(tr);
    }
    renderPagination('usr-pagination', d.page, d.pages, (pg) => loadUsers(pg, getUsrFilters()), d.total);
  } catch (e) { toast('Failed to load users', 'error'); }
}

async function setUserDisabled(id, disabled) {
  try {
    await api('/admin/api/users/' + id + '/disabled', 'PATCH', { disabled });
    toast(disabled ? 'User disabled and signed out' : 'User enabled', 'success');
    loadUsers(1, getUsrFilters());
    if (openUserId === id) openUserDetail(id);
  } catch (e) { toast('Failed to update user', 'error'); }
}

// ── USER DETAIL MODAL ────────────────────────────────────────
let openUserId = null;

function userInitials(u) {
  const parts = (u.full_name || u.email || '?').trim().split(/\s+/);
  return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

async function openUserDetail(id) {
  try {
    const u = await api('/admin/api/users/' + id);
    openUserId = id;
    document.getElementById('ud-avatar').textContent = userInitials(u);
    document.getElementById('ud-name').textContent = u.full_name || '(no name)';
    document.getElementById('ud-email').textContent = u.username ? '@' + u.username + '  ·  ' + u.email : u.email;
    document.getElementById('ud-runs').textContent = u.stats.total_runs || 0;
    document.getElementById('ud-specs').textContent = u.stats.distinct_specs || 0;
    document.getElementById('ud-sessions').textContent = u.active_sessions;
    document.getElementById('ud-joined').textContent = new Date(u.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

    const meta = [];
    meta.push(u.email_verified ? '<span style="color:var(--a1);">email verified</span>' : '<span style="color:var(--a4);">email NOT verified</span>');
    meta.push(u.company ? esc(u.company) : 'No company on file');
    meta.push(PLAN_LABELS[u.plan_interest] ? esc(PLAN_LABELS[u.plan_interest]) + ' plan interest' : 'No plan interest recorded');
    meta.push(u.last_login_at ? 'last signed in ' + esc(new Date(u.last_login_at).toLocaleString()) : 'never signed in again after signup');
    document.getElementById('ud-meta').innerHTML = meta.join(' &middot; ');

    const recentEl = document.getElementById('ud-recent');
    if (!u.recent_calculations.length) {
      recentEl.innerHTML = '<div style="color:var(--t3);font-size:11px;">No calculations yet.</div>';
    } else {
      recentEl.innerHTML = u.recent_calculations.map((r) => {
        const s = r.summary || {};
        const chips = [];
        if (s.fabric_price_usd_per_kg != null) chips.push('<span class="chip">Fabric<b>$' + Number(s.fabric_price_usd_per_kg).toFixed(2) + '/kg</b></span>');
        if (s.yarn_count) chips.push('<span class="chip">Yarn<b>' + esc(s.yarn_count) + '</b></span>');
        return '<div class="u-recent-item">' +
          '<div class="u-recent-title">' + esc(r.fabric_name || r.fabric_id) + ' <span style="color:var(--a1);font-family:var(--mono);">' + esc(Number(r.gsm)) + ' GSM</span></div>' +
          '<div class="u-recent-sub">' + esc(new Date(r.last_run_at).toLocaleString()) + (r.run_count > 1 ? ' &middot; run ' + esc(r.run_count) + ' times' : '') + '</div>' +
          (chips.length ? '<div>' + chips.join('') + '</div>' : '') +
          '</div>';
      }).join('');
    }

    const toggleBtn = document.getElementById('ud-toggle-disabled');
    toggleBtn.textContent = u.disabled ? 'Enable account' : 'Disable account';
    toggleBtn.className = u.disabled ? 'btn btn-primary' : 'btn btn-danger';
    toggleBtn.dataset.disabled = u.disabled ? 'false' : 'true';

    document.getElementById('ud-username-input').value = u.username || '';
    document.getElementById('ud-email-input').value = u.email;
    document.getElementById('ud-pw-input').value = '';
    setUdMsg('ud-username-msg', '3–30 characters: letters, numbers, underscore, period. No 60-day wait for an admin change.', null);
    setUdMsg('ud-email-msg', '', null);
    setUdMsg('ud-pw-msg', 'At least 10 characters, 3 of: lower/upper/number/symbol. Signs out every device.', null);

    document.getElementById('user-detail-modal').classList.remove('hidden');
  } catch (e) { toast('Failed to load user detail', 'error'); }
}

function closeUserDetail() {
  document.getElementById('user-detail-modal').classList.add('hidden');
  openUserId = null;
}

function setUdMsg(elId, text, ok) {
  const el = document.getElementById(elId);
  el.textContent = text;
  el.style.color = ok === true ? 'var(--a1)' : ok === false ? 'var(--a3)' : 'var(--t3)';
}

async function saveUserUsername() {
  if (openUserId == null) return;
  const input = document.getElementById('ud-username-input');
  const username = input.value.trim();
  const btn = document.getElementById('ud-username-save');
  btn.disabled = true;
  try {
    await api('/admin/api/users/' + openUserId + '/username', 'PATCH', { username });
    toast('Username changed', 'success');
    loadUsers(1, getUsrFilters());
    await openUserDetail(openUserId);
    setUdMsg('ud-username-msg', 'Username changed.', true);
  } catch (e) {
    setUdMsg('ud-username-msg', e.message, false);
  } finally { btn.disabled = false; }
}

async function saveUserEmail() {
  if (openUserId == null) return;
  const input = document.getElementById('ud-email-input');
  const email = input.value.trim();
  const btn = document.getElementById('ud-email-save');
  btn.disabled = true;
  try {
    await api('/admin/api/users/' + openUserId + '/email', 'PATCH', { email });
    toast('Email changed', 'success');
    loadUsers(1, getUsrFilters());
    await openUserDetail(openUserId); // refreshes every field (email_verified flips, username prefix, etc.)
    setUdMsg('ud-email-msg', 'Email updated — an activation code was sent to the new address.', true);
  } catch (e) {
    setUdMsg('ud-email-msg', e.message, false);
  } finally { btn.disabled = false; }
}

async function saveUserPassword() {
  if (openUserId == null) return;
  const input = document.getElementById('ud-pw-input');
  const new_password = input.value;
  if (!new_password) { setUdMsg('ud-pw-msg', 'Enter a new password first.', false); return; }
  const btn = document.getElementById('ud-pw-save');
  btn.disabled = true;
  try {
    await api('/admin/api/users/' + openUserId + '/reset-password', 'POST', { new_password });
    input.value = '';
    toast('Password reset', 'success');
    // openUserDetail() re-populates every field, including this message's
    // neutral hint — refresh first, then set the success message, or the
    // refresh silently wipes it.
    await openUserDetail(openUserId);
    setUdMsg('ud-pw-msg', 'Password set — the user was emailed and every device was signed out.', true);
  } catch (e) {
    setUdMsg('ud-pw-msg', e.message, false);
  } finally { btn.disabled = false; }
}

// ── RFQ / QUOTES ───────────────────────────────────────────
const STATUS_BADGE_CLASS = {
  pending: 'badge-yellow', under_review: 'badge-yellow', quoted: 'badge-blue',
  accepted: 'badge-green', rejected: 'badge-red', expired: 'badge-red',
};
let curRfqPage = 1;
let openRfqId = null;

function getRfqFilters() {
  return {
    status: document.getElementById('rfq-filter-status').value,
    search: document.getElementById('rfq-filter-search').value.trim(),
  };
}

async function loadRfqList(page, filters) {
  try {
    const p = new URLSearchParams({ page, limit: 25 });
    if (filters.status) p.append('status', filters.status);
    if (filters.search) p.append('search', filters.search);

    const d = await api('/admin/api/rfq?' + p);

    const countsEl = document.getElementById('rfq-status-counts');
    const sc = d.status_counts || {};
    countsEl.innerHTML = Object.entries(sc).map(([status, n]) =>
      `<div class="stat-card"><div class="stat-val">${esc(n)}</div><div class="stat-lbl">${esc(status.replace('_', ' '))}</div></div>`
    ).join('');

    const tbody = document.getElementById('rfq-tbody');
    tbody.innerHTML = '';
    if (!d.rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--t3);">No quote requests found</td></tr>';
    }
    for (const r of d.rows) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="padding:9px 10px;font-family:var(--mono);color:var(--t2);">${esc(r.reference_code)}</td>
        <td style="padding:9px 10px;color:var(--t2);">${esc(r.buyer_name)}<div style="font-size:10px;color:var(--t3);">${esc(r.buyer_email)}</div></td>
        <td style="padding:9px 10px;color:var(--t2);">${esc(r.buyer_company || '—')}</td>
        <td style="padding:9px 10px;color:var(--t2);">${esc(r.line_item_count)}</td>
        <td style="padding:9px 10px;"><span class="badge ${STATUS_BADGE_CLASS[r.status] || 'badge-gray'}">${esc(r.status.replace('_', ' '))}</span></td>
        <td style="padding:9px 10px;color:var(--t3);font-family:var(--mono);">${esc(new Date(r.created_at).toLocaleDateString())}</td>
        <td style="padding:9px 10px;"><button class="btn btn-ghost btn-sm" data-rfq-id="${esc(r.id)}">View</button></td>
      `;
      tbody.appendChild(tr);
    }
    renderPagination('rfq-pagination', d.page, d.pages, (pg) => loadRfqList(pg, getRfqFilters()), d.total);
    curRfqPage = page;
  } catch (e) { toast('Failed to load RFQs', 'error'); }
}

async function openRfqDetail(id) {
  try {
    const rfq = await api('/admin/api/rfq/' + id);
    openRfqId = id;

    document.getElementById('rfqd-title').textContent = `RFQ ${rfq.reference_code}`;
    document.getElementById('rfqd-buyer').innerHTML =
      `${esc(rfq.buyer_name)} &lt;${esc(rfq.buyer_email)}&gt;` +
      (rfq.buyer_company ? `<br>${esc(rfq.buyer_company)}` : '') +
      (rfq.buyer_country ? ` · ${esc(rfq.buyer_country)}` : '') +
      (rfq.buyer_phone ? ` · ${esc(rfq.buyer_phone)}` : '');
    document.getElementById('rfqd-message').textContent = rfq.message || '(no message)';
    document.getElementById('rfqd-status').value = rfq.status;
    document.getElementById('rfqd-admin-notes').value = rfq.admin_notes || '';

    const linesEl = document.getElementById('rfqd-lines');
    linesEl.innerHTML = rfq.line_items.map(li => `
      <div class="card mb-8" style="padding:10px;">
        <div style="font-weight:700;font-size:11px;margin-bottom:6px;">#${esc(li.line_number)} — ${esc(li.fabric_name)} · ${esc(li.gsm)}gsm${li.garment_type ? ' · ' + esc(li.garment_type) : ''}${li.order_quantity ? ' · qty ' + esc(li.order_quantity.toLocaleString()) : ''}</div>
        <div style="font-size:10px;color:var(--t3);margin-bottom:8px;">
          Reference fabric price: $${li.reference_fabric_price_usd != null ? esc(li.reference_fabric_price_usd) : '—'}/kg
          ${li.reference_fob_price_usd != null ? ` · Reference FOB: $${esc(li.reference_fob_price_usd)}/garment` : ''}
          ${li.target_price_usd != null ? ` · Buyer's target: $${esc(li.target_price_usd)}` : ''}
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Quoted price (USD)</label>
            <input type="number" step="0.01" min="0" class="form-input rfqd-line-price" data-line-id="${li.id}" value="${li.quoted_price_usd != null ? esc(li.quoted_price_usd) : ''}">
          </div>
          <div class="form-group" style="flex:2;">
            <label class="form-label">Notes</label>
            <input type="text" class="form-input rfqd-line-notes" data-line-id="${li.id}" value="${esc(li.quoted_notes || '')}">
          </div>
        </div>
      </div>
    `).join('');

    document.getElementById('rfqd-error').textContent = '';
    document.getElementById('rfq-detail-modal').classList.remove('hidden');
  } catch (e) { toast('Failed to load RFQ detail', 'error'); }
}

function closeRfqDetail() {
  document.getElementById('rfq-detail-modal').classList.add('hidden');
  openRfqId = null;
}

async function saveRfqDetail() {
  if (!openRfqId) return;
  const errEl = document.getElementById('rfqd-error');
  errEl.textContent = '';
  const btn = document.getElementById('rfqd-save');
  btn.disabled = true;
  try {
    await api(`/admin/api/rfq/${openRfqId}/status`, 'PATCH', {
      status: document.getElementById('rfqd-status').value,
      admin_notes: document.getElementById('rfqd-admin-notes').value.trim() || undefined,
    });

    const lineUpdates = Array.from(document.querySelectorAll('.rfqd-line-price')).map(input => {
      const lineId = input.dataset.lineId;
      const notesInput = document.querySelector(`.rfqd-line-notes[data-line-id="${lineId}"]`);
      return api(`/admin/api/rfq/line-items/${lineId}`, 'PATCH', {
        quoted_price_usd: input.value !== '' ? parseFloat(input.value) : undefined,
        quoted_notes: notesInput.value.trim() || undefined,
      });
    });
    await Promise.all(lineUpdates);

    toast('RFQ updated', 'success');
    closeRfqDetail();
    loadRfqList(curRfqPage, getRfqFilters());
  } catch (e) {
    errEl.textContent = e.message || 'Save failed';
  } finally {
    btn.disabled = false;
  }
}

// ── YARN PRICES ────────────────────────────────────────────
//
// The costing engine ran for four months on a matrix typed into a source file
// and headed "Updated May 2026". By September it was 3% high on cotton and 5-7%
// high on CVC and PC, and nothing could report that, because a typed constant
// carries no date.
//
// What this screen exists to answer is one question — HOW OLD ARE THESE PRICES
// — so the quote date is the headline and the fetch time sits beside it as a
// separate figure. They are not the same question: a feed that has stopped
// updating goes on giving a fresh fetch time forever, and a screen that showed
// only that would put a green tick over a year-old price.

const PRICE_AGE_TONE = {
  current:      { c: '#4ade80', label: 'current' },
  recent:       { c: '#fbbf24', label: 'recent' },
  stale:        { c: '#fb923c', label: 'stale' },
  'out of date': { c: '#ff4d6d', label: 'out of date' },
  unknown:      { c: 'var(--t3)', label: 'unknown' },
};

function priceMsg(html, tone) {
  const el = document.getElementById('prices-msg');
  if (!html) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  const c = tone === 'bad' ? '#ff4d6d' : tone === 'warn' ? '#fbbf24' : '#4ade80';
  el.classList.remove('hidden');
  el.innerHTML = `<div style="border:1px solid ${c}55;background:${c}12;border-radius:8px;` +
    `padding:10px 12px;font-size:11px;line-height:1.6;color:var(--t1);">${html}</div>`;
}

async function loadYarnPrices() {
  try {
    const d = await api('/admin/api/yarn-prices');
    const st = d.status || {};
    const tone = PRICE_AGE_TONE[st.freshness] || PRICE_AGE_TONE.unknown;

    document.getElementById('prices-updated').textContent = st.last_updated || 'never';
    const ageEl = document.getElementById('prices-age');
    ageEl.textContent = st.age_days == null ? '—'
      : st.age_days === 0 ? 'today'
      : st.age_days === 1 ? '1 day' : `${st.age_days} days`;
    ageEl.style.color = tone.c;
    document.getElementById('prices-items').textContent = st.items || 0;

    const last = st.last_sync;
    document.getElementById('prices-checked').textContent = last && last.at
      ? new Date(last.at).toLocaleDateString() : 'never';

    // "It ran" and "it worked" are different, and the failure mode worth
    // shouting about is a sync that keeps succeeding against a feed that has
    // stopped moving — the prices then look maintained and are not.
    if (last && !last.ok) {
      priceMsg(`The last update <strong>failed</strong>: ${esc(last.error || 'no reason recorded')}. ` +
        `The prices below are whatever was stored before it.`, 'bad');
    } else if (st.age_days != null && st.age_days > 21) {
      priceMsg(`These prices were published <strong>${st.age_days} days ago</strong>. ` +
        `Costings still use them up to 60 days, and say so; past that the built-in ` +
        `reference list answers instead.`, 'warn');
    } else {
      priceMsg('');
    }

    // ── Sources ─────────────────────────────────────────────────────────
    const srcEl = document.getElementById('prices-sources');
    srcEl.innerHTML = (d.sources || []).map(s => {
      // Three states, not two. "Never connected" is not "broken", and showing
      // them the same colour is how a source nobody set up gets mistaken for a
      // source that is down.
      const live = s.configured && s.quotes > 0;
      const c = live ? '#4ade80' : s.configured ? '#fb923c' : 'var(--t3)';
      const state = live ? `${s.quotes} quotes`
                  : s.configured ? 'connected, no data' : 'not connected';
      const countries = (s.countries || []).map(x =>
        `<span style="display:inline-block;background:var(--bg3);border:1px solid var(--line);border-radius:4px;padding:1px 6px;margin:2px 4px 0 0;font-size:9px;">`
        + `${esc(x.country)} · ${x.quotes} · ${esc(x.newest)}</span>`).join('');
      return `<div style="border:1px solid ${c}44;background:${c}0d;border-radius:8px;padding:9px 12px;margin-bottom:8px;">
        <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;">
          <span style="width:7px;height:7px;border-radius:50%;background:${c};display:inline-block;"></span>
          <strong style="font-size:11px;color:var(--t1);">${esc(s.label)}</strong>
          <span style="font-size:9px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;">${esc(s.kind)}</span>
          <span style="margin-left:auto;font-size:10px;color:${c};">${esc(state)}</span>
        </div>
        ${countries ? `<div style="margin-top:6px;">${countries}</div>` : ''}
        ${s.note ? `<div style="font-size:9px;color:var(--t3);margin-top:6px;line-height:1.5;">${esc(s.note)}</div>` : ''}
      </div>`;
    }).join('');

    const tb = document.getElementById('prices-tbody');
    tb.innerHTML = (d.quotes || []).map(q => {
      const ref = q.reference_price;
      const gap = q.reference_gap_pct;
      const gapColor = gap == null ? 'var(--t3)' : Math.abs(gap) >= 5 ? '#fb923c' : 'var(--t2)';
      return `<tr>
        <td style="font-size:10px;">${esc(q.label)}</td>
        <td>${q.count_ne || '—'}</td>
        <td style="font-size:10px;color:var(--t2);">${esc(q.as_published)}</td>
        <td style="font-variant-numeric:tabular-nums;">$${q.usd_per_kg.toFixed(2)}</td>
        <td style="font-variant-numeric:tabular-nums;color:var(--t3);">${ref == null ? '—' : '$' + ref.toFixed(2)}</td>
        <td style="font-variant-numeric:tabular-nums;color:${gapColor};">${gap == null ? '—' : (gap > 0 ? '+' : '') + gap + '%'}</td>
        <td style="font-size:10px;color:var(--t3);">${esc(q.quoted_on)}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="7" style="color:var(--t3);font-size:11px;">No market prices stored yet. Press Update Now.</td></tr>';

    const sb = document.getElementById('prices-sync-tbody');
    sb.innerHTML = (d.syncs || []).map(x => `<tr>
      <td style="font-size:10px;">${new Date(x.started_at).toLocaleString()}</td>
      <td style="font-size:10px;color:var(--t3);">${esc(x.trigger)}</td>
      <td style="font-size:10px;color:${x.ok ? '#4ade80' : '#ff4d6d'};">${x.ok ? 'ok' : esc((x.error || 'failed').slice(0, 90))}</td>
      <td>${x.rows_stored}</td>
      <td>${x.rows_rejected}</td>
      <td style="font-size:10px;color:var(--t3);">${x.newest_quote ? String(x.newest_quote).slice(0, 10) : '—'}</td>
    </tr>`).join('') || '<tr><td colspan="6" style="color:var(--t3);font-size:11px;">Never run.</td></tr>';
  } catch (err) {
    priceMsg(`Could not load prices: ${esc(err.message)}`, 'bad');
  }
}

async function updateYarnPrices() {
  const btn = document.getElementById('prices-update-btn');
  const was = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Updating…';
  priceMsg('Fetching the published list…');
  try {
    const r = await api('/admin/api/yarn-prices/refresh', 'POST');
    if (r.skipped) {
      priceMsg(`Nothing to do — ${esc(r.reason)}.`, 'warn');
    } else {
      priceMsg(`Updated. ${r.stored} new quotes stored from ${r.costable} costable rows; ` +
        `the newest is dated <strong>${esc(r.newest_quote || 'unknown')}</strong>.` +
        (r.rejected && r.rejected.length
          ? ` ${r.rejected.length} rows were refused: ${r.rejected.map(x => esc(x.label)).join(', ')}.`
          : ''));
    }
    await loadYarnPrices();
  } catch (err) {
    // A failing gate comes back as 422 with its reasons, and those reasons are
    // the useful part — this is the feed having changed shape, not a crash.
    priceMsg(`Update refused: ${esc(err.message)}`, 'bad');
  } finally {
    btn.disabled = false;
    btn.textContent = was;
  }
}

// ── DYEING PRICES ──────────────────────────────────────────
function dyeingPriceMsg(html, tone) {
  const el = document.getElementById('dyeing-prices-msg');
  if (!html) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  const c = tone === 'bad' ? '#ff4d6d' : tone === 'warn' ? '#fbbf24' : '#4ade80';
  el.classList.remove('hidden');
  el.innerHTML = `<div style="border:1px solid ${c}55;background:${c}12;border-radius:8px;` +
    `padding:10px 12px;font-size:11px;line-height:1.6;color:var(--t1);">${html}</div>`;
}

async function loadDyeingPrices() {
  try {
    const d = await api('/admin/api/dyeing-prices');

    const tb = document.getElementById('dyeing-prices-tbody');
    tb.innerHTML = '';
    if (!(d.prices || []).length) {
      tb.innerHTML = '<tr><td colspan="4" style="color:var(--t3);font-size:11px;">No prices yet — run the dyeing reference import first.</td></tr>';
    }
    for (const p of d.prices || []) {
      const dated = p.updated_at
        ? new Date(p.updated_at).toLocaleDateString()
        : '<span style="color:var(--t3);">original extracted value</span>';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-size:11px;">${esc(p.chemical_name)}</td>
        <td><input type="number" step="0.01" min="0" class="form-input dp-input" style="width:100px;" value="${p.unit_price_tk}"></td>
        <td style="font-size:10px;">${dated}</td>
        <td><button class="btn btn-ghost btn-xs dp-save">Save</button></td>
      `;
      tr.querySelector('.dp-save').addEventListener('click', () =>
        saveDyeingPrice(p.chemical_name, tr.querySelector('.dp-input')));
      tb.appendChild(tr);
    }

    const ub = document.getElementById('dyeing-prices-unresolved-tbody');
    ub.innerHTML = '';
    if (!(d.unresolved || []).length) {
      ub.innerHTML = '<tr><td colspan="4" style="color:var(--t3);font-size:11px;">None — every priced chemical currently has one consistent value.</td></tr>';
    }
    for (const p of d.unresolved || []) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-size:11px;">${esc(p.chemical_name)}</td>
        <td style="font-size:10px;color:var(--t3);">${p.prices_seen.join(' / ')}</td>
        <td><input type="number" step="0.01" min="0" class="form-input dpu-input" style="width:100px;" placeholder="unify at…"></td>
        <td><button class="btn btn-ghost btn-xs dpu-save">Set</button></td>
      `;
      tr.querySelector('.dpu-save').addEventListener('click', () =>
        saveDyeingPrice(p.chemical_name, tr.querySelector('.dpu-input')));
      ub.appendChild(tr);
    }
  } catch (err) {
    dyeingPriceMsg(`Could not load dyeing prices: ${esc(err.message)}`, 'bad');
  }
}

async function saveDyeingPrice(chemicalName, input) {
  const value = parseFloat(input.value);
  if (!(value > 0)) {
    dyeingPriceMsg('Enter a positive price first.', 'warn');
    return;
  }
  try {
    await api(`/admin/api/dyeing-prices/${encodeURIComponent(chemicalName)}`, 'PATCH', { unit_price_tk: value });
    dyeingPriceMsg(`Saved — <strong>${esc(chemicalName)}</strong> is now ${value} Tk/kg, live immediately, no restart needed.`);
    await loadDyeingPrices();
  } catch (err) {
    dyeingPriceMsg(`Save failed: ${esc(err.message)}`, 'bad');
  }
}

// ── REAL-ORDER VALIDATION ─────────────────────────────────
const TIER_BADGE_CLASS = {
  verified: 'badge-green', derived: 'badge-blue', estimated: 'badge-amber',
  none: 'badge-red', neutral: 'badge-gray',
};
let valCurPage = 1;
let valFabricListLoaded = false;

function valMsg(html, tone) {
  const el = document.getElementById('val-msg');
  if (!html) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  const c = tone === 'bad' ? '#ff4d6d' : tone === 'warn' ? '#fbbf24' : '#4ade80';
  el.classList.remove('hidden');
  el.innerHTML = `<div style="border:1px solid ${c}55;background:${c}12;border-radius:8px;` +
    `padding:10px 12px;font-size:11px;line-height:1.6;color:var(--t1);">${html}</div>`;
}

function fmtPct(v) {
  if (v == null) return '<span style="color:var(--t3);">—</span>';
  const sign = v > 0 ? '+' : '';
  const color = Math.abs(v) <= 5 ? 'var(--a1)' : Math.abs(v) <= 15 ? '#fbbf24' : '#ff4d6d';
  return `<span style="color:${color};">${sign}${v}%</span>`;
}

async function loadValidationFabricList() {
  if (valFabricListLoaded) return;
  valFabricListLoaded = true;
  try {
    const list = await fetch(API_BASE + '/api/fabrics').then(r => r.json());
    const dl = document.getElementById('val-fabric-list');
    dl.innerHTML = (list || []).map(f => `<option value="${esc(f.id)}">${esc(f.name || f.id)}</option>`).join('');
  } catch (_) { /* datalist is a convenience, not required */ }
}

async function loadValidationSummary() {
  try {
    const s = await api('/admin/api/validation/summary');
    document.getElementById('val-sum-total').textContent =
      `${s.usable_records}${s.failed_records ? ` (+${s.failed_records} failed)` : ''}`;
    document.getElementById('val-sum-count-err').innerHTML = fmtPct(s.overall.count_mean_abs_pct);
    document.getElementById('val-sum-count-bias').innerHTML = fmtPct(s.overall.count_bias_pct);
    document.getElementById('val-sum-sl-err').innerHTML = fmtPct(s.overall.sl_mean_abs_pct);
    document.getElementById('val-sum-sl-bias').innerHTML = fmtPct(s.overall.sl_bias_pct);

    const famTb = document.getElementById('val-by-family-tbody');
    famTb.innerHTML = (s.by_family || []).length ? s.by_family.map(g => `
      <tr><td style="font-size:11px;">${esc(g.key)}</td><td>${g.n}</td>
        <td>${fmtPct(g.count_mean_abs_pct)} <span style="color:var(--t3);font-size:9px;">(n=${g.count_n})</span></td>
        <td>${fmtPct(g.sl_mean_abs_pct)} <span style="color:var(--t3);font-size:9px;">(n=${g.sl_n})</span></td></tr>
    `).join('') : '<tr><td colspan="4" style="color:var(--t3);font-size:11px;">No records yet.</td></tr>';

    const tierTb = document.getElementById('val-by-tier-tbody');
    tierTb.innerHTML = (s.by_confidence_tier || []).length ? s.by_confidence_tier.map(g => `
      <tr><td style="font-size:11px;">${esc(g.key)}</td><td>${g.n}</td>
        <td>${fmtPct(g.count_mean_abs_pct)} <span style="color:var(--t3);font-size:9px;">(n=${g.count_n})</span></td>
        <td>${fmtPct(g.sl_mean_abs_pct)} <span style="color:var(--t3);font-size:9px;">(n=${g.sl_n})</span></td></tr>
    `).join('') : '<tr><td colspan="4" style="color:var(--t3);font-size:11px;">No records yet.</td></tr>';
  } catch (err) {
    console.error('[Validation Summary]', err);
  }
}

async function loadValidationRecords(page = 1) {
  valCurPage = page;
  try {
    const d = await api(`/admin/api/validation/records?page=${page}&limit=20`);
    const tb = document.getElementById('val-records-tbody');
    tb.innerHTML = '';
    if (!(d.records || []).length) {
      tb.innerHTML = '<tr><td colspan="8" style="color:var(--t3);font-size:11px;">No records yet — add a real order above.</td></tr>';
    }
    for (const r of d.records || []) {
      const tr = document.createElement('tr');
      if (r.calc_error) {
        tr.innerHTML = `
          <td style="font-size:11px;">${esc(r.fabric_id)}</td>
          <td>${r.target_gsm ?? '—'}</td>
          <td colspan="4" style="color:#ff4d6d;font-size:10px;">Spec no longer calculates: ${esc(r.calc_error)}</td>
          <td style="font-size:10px;">${esc(r.mill_name || '')} ${esc(r.order_ref || '')}</td>
          <td><button class="btn btn-ghost btn-xs val-del">Delete</button></td>
        `;
      } else {
        const tier = r.predicted?.source_confidence;
        const tierBadge = tier
          ? `<span class="badge ${TIER_BADGE_CLASS[tier.badge] || 'badge-gray'}" title="${esc(tier.note)}">${esc(tier.label)}</span>`
          : '—';
        tr.innerHTML = `
          <td style="font-size:11px;">${esc(r.fabric_id)}</td>
          <td>${r.target_gsm ?? '—'}</td>
          <td style="font-size:10px;">Ne ${r.predicted?.count_ne ?? '—'} · SL ${r.predicted?.sl_mm ?? '—'}mm</td>
          <td style="font-size:10px;">Ne ${r.actual.count_ne ?? '—'} · SL ${r.actual.sl_mm ?? '—'}mm · GSM ${r.actual.gsm ?? '—'}</td>
          <td style="font-size:10px;">Ne ${fmtPct(r.errors.count_pct)} · SL ${fmtPct(r.errors.sl_pct)}</td>
          <td>${tierBadge}</td>
          <td style="font-size:10px;">${esc(r.mill_name || '')} ${esc(r.order_ref || '')}${r.notes ? `<br><span style="color:var(--t3);">${esc(r.notes)}</span>` : ''}</td>
          <td><button class="btn btn-ghost btn-xs val-del">Delete</button></td>
        `;
      }
      tr.querySelector('.val-del').addEventListener('click', () => deleteValidationRecord(r.id));
      tb.appendChild(tr);
    }
    renderPagination('val-pagination', d.page, d.pages, loadValidationRecords, d.total);
  } catch (err) {
    valMsg(`Could not load records: ${esc(err.message)}`, 'bad');
  }
}

async function deleteValidationRecord(id) {
  if (!confirm('Delete this record?')) return;
  try {
    await api(`/admin/api/validation/records/${id}`, 'DELETE');
    await Promise.all([loadValidationRecords(valCurPage), loadValidationSummary()]);
  } catch (err) {
    valMsg(`Delete failed: ${esc(err.message)}`, 'bad');
  }
}

async function addValidationRecord() {
  const fabric = document.getElementById('val-fabric').value.trim();
  const gsm = parseFloat(document.getElementById('val-gsm').value);
  const composition = document.getElementById('val-composition').value.trim();
  const gauge = parseFloat(document.getElementById('val-gauge').value);
  const dia = parseFloat(document.getElementById('val-dia').value);
  const actualCount = parseFloat(document.getElementById('val-actual-count').value);
  const actualSl = parseFloat(document.getElementById('val-actual-sl').value);
  const actualGsm = parseFloat(document.getElementById('val-actual-gsm').value);
  const mill = document.getElementById('val-mill').value.trim();
  const ref = document.getElementById('val-ref').value.trim();
  const notes = document.getElementById('val-notes').value.trim();

  if (!fabric || !(gsm > 0)) { valMsg('Fabric ID and ordered GSM are required.', 'warn'); return; }
  if (isNaN(actualCount) && isNaN(actualSl) && isNaN(actualGsm)) {
    valMsg('At least one actual value (count, SL, or finished GSM) is required.', 'warn');
    return;
  }

  const spec_input = { fabric, gsm };
  if (composition) spec_input.composition = composition;
  if (gauge > 0) spec_input.gauge = gauge;
  if (dia > 0) spec_input.dia = dia;

  const btn = document.getElementById('val-add-btn');
  btn.disabled = true;
  try {
    await api('/admin/api/validation/records', 'POST', {
      spec_input,
      actual_count_ne: isNaN(actualCount) ? null : actualCount,
      actual_sl_mm: isNaN(actualSl) ? null : actualSl,
      actual_gsm: isNaN(actualGsm) ? null : actualGsm,
      mill_name: mill || null,
      order_ref: ref || null,
      notes: notes || null,
    });
    valMsg('Record added.', 'ok');
    ['val-fabric','val-gsm','val-composition','val-gauge','val-dia','val-actual-count','val-actual-sl','val-actual-gsm','val-mill','val-ref','val-notes']
      .forEach(id => document.getElementById(id).value = '');
    await Promise.all([loadValidationRecords(1), loadValidationSummary()]);
  } catch (err) {
    valMsg(`Could not add record: ${esc(err.message)}`, 'bad');
  } finally {
    btn.disabled = false;
  }
}

function loadValidationTab() {
  loadValidationFabricList();
  loadValidationSummary();
  loadValidationRecords(1);
}

// ── SETTINGS ───────────────────────────────────────────────
async function loadSettings() {
  try {
    const d = await api('/admin/api/settings');
    document.getElementById('set-sysinfo').innerHTML = `
      <div>Username: <span style="color:var(--a1);">${d.username}</span></div>
      <div>Server: <span style="color:var(--t1);">${location.hostname}:3001</span></div>
      <div>Environment: <span style="color:var(--t1);">${location.hostname==='localhost'?'Development':'Production'}</span></div>
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line);font-size:10px;color:var(--t3);">
        Yarn price matrix: costing-engine.js<br>
        Admin auth: .env file (process.env)<br>
        Session storage: admin_sessions table
      </div>
    `;
  } catch (e) { console.error(e); }
}

async function saveCredentials() {
  const cur     = document.getElementById('set-cur-pass').value;
  const newUser = document.getElementById('set-new-user').value.trim();
  const newPass = document.getElementById('set-new-pass').value;
  const msgEl   = document.getElementById('set-creds-msg');
  msgEl.textContent = '';

  if (!cur)               { msgEl.style.color = 'var(--a3)'; msgEl.textContent = 'Current password required'; return; }
  if (!newUser && !newPass){ msgEl.style.color = 'var(--a3)'; msgEl.textContent = 'Provide new username or password'; return; }

  try {
    const body = { current_password: cur };
    if (newUser) body.new_username = newUser;
    if (newPass) body.new_password = newPass;
    await api('/admin/api/settings/credentials', 'POST', body);
    msgEl.style.color = 'var(--a1)';
    msgEl.textContent = '✓ Credentials updated successfully';
    document.getElementById('set-cur-pass').value = '';
    document.getElementById('set-new-user').value = '';
    document.getElementById('set-new-pass').value = '';
  } catch (e) {
    msgEl.style.color = 'var(--a3)'; msgEl.textContent = e.message;
  }
}

// ── PAGINATION HELPER ──────────────────────────────────────
function renderPagination(containerId, page, pages, onPage, total) {
  const c = document.getElementById(containerId);
  c.innerHTML = '';
  if (total !== undefined) {
    const span = document.createElement('span');
    span.style.cssText = 'font-size:10px;color:var(--t3);margin-right:12px;';
    span.textContent = `${total.toLocaleString()} total`;
    c.appendChild(span);
  }
  if (pages <= 1) return;

  const prev = document.createElement('button');
  prev.className = 'btn btn-ghost btn-xs';
  prev.textContent = '← Prev'; prev.disabled = page === 1;
  prev.onclick = () => onPage(page - 1);
  c.appendChild(prev);

  const info = document.createElement('span');
  info.style.cssText = 'font-size:10px;color:var(--t3);';
  info.textContent = `${page} / ${pages}`;
  c.appendChild(info);

  const next = document.createElement('button');
  next.className = 'btn btn-ghost btn-xs';
  next.textContent = 'Next →'; next.disabled = page === pages;
  next.onclick = () => onPage(page + 1);
  c.appendChild(next);
}

// ── DOM READY ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {

  // Tab clicks
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Login
  document.getElementById('login-btn').addEventListener('click', doLogin);
  document.getElementById('admin-password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('admin-username').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('admin-password').focus(); });

  // Logout
  document.getElementById('logout-btn').addEventListener('click', doLogout);

  // Log filters
  document.getElementById('logs-apply-btn').addEventListener('click', () => loadLogs(1, getLogFilters()));

  // Providers
  document.getElementById('reset-stats-btn').addEventListener('click', async () => {
    if (!confirm('Reset all daily stats?')) return;
    try { await api('/admin/api/providers/reset-stats', 'POST'); loadProviders(); toast('Stats reset', 'success'); }
    catch (e) { toast('Reset failed: ' + e.message, 'error'); }
  });

  // Strategy buttons
  document.querySelectorAll('.strategy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const strategy = btn.dataset.strategy;
      try {
        await api('/admin/api/providers/strategy', 'POST', { strategy });
        document.querySelectorAll('.strategy-btn').forEach(b => b.classList.toggle('active', b.dataset.strategy === strategy));
        const msg = document.getElementById('strategy-save-msg');
        msg.style.display = 'inline';
        setTimeout(() => { msg.style.display = 'none'; }, 2000);
        loadProviders();
        toast(`Strategy: ${strategy.replace('_', ' ')}`, 'success');
      } catch (e) { toast('Strategy save failed: ' + e.message, 'error'); }
    });
  });

  // Add Provider button
  document.getElementById('add-provider-btn').addEventListener('click', () => openAddProviderModal());
  document.getElementById('ap-cancel').addEventListener('click', () => closeAddProviderModal());
  document.getElementById('add-provider-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeAddProviderModal();
  });
  document.getElementById('ap-save').addEventListener('click', () => doAddProvider());

  // Cache
  document.getElementById('cache-flush-btn').addEventListener('click', flushCache);
  document.getElementById('prices-reload-btn').addEventListener('click', loadYarnPrices);
  document.getElementById('prices-update-btn').addEventListener('click', updateYarnPrices);
  document.getElementById('dyeing-prices-reload-btn').addEventListener('click', loadDyeingPrices);
  document.getElementById('val-reload-btn').addEventListener('click', loadValidationTab);
  document.getElementById('val-add-btn').addEventListener('click', addValidationRecord);
  document.getElementById('cache-refresh-btn').addEventListener('click', () => { loadCacheStats(); loadCacheEntries(curCachePage); });
  document.getElementById('entry-viewer-close').addEventListener('click', () => document.getElementById('cache-entry-viewer').classList.add('hidden'));

  // Inquiries
  document.getElementById('inq-apply-btn').addEventListener('click', () => loadInquiries(1, getInqFilters()));
  document.getElementById('inq-download-btn').addEventListener('click', downloadInquiriesCSV);

  // Users — delegated for the same reason as the RFQ table below
  document.getElementById('usr-apply-btn').addEventListener('click', () => loadUsers(1, getUsrFilters()));
  document.getElementById('usr-tbody').addEventListener('click', (e) => {
    const viewBtn = e.target.closest('[data-usr-view]');
    if (viewBtn) { openUserDetail(parseInt(viewBtn.dataset.usrView, 10)); return; }
    const btn = e.target.closest('[data-usr-id]');
    if (btn) setUserDisabled(parseInt(btn.dataset.usrId, 10), btn.dataset.usrDisable === 'true');
  });
  document.getElementById('ud-cancel').addEventListener('click', closeUserDetail);
  document.getElementById('user-detail-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeUserDetail();
  });
  document.getElementById('ud-toggle-disabled').addEventListener('click', (e) => {
    if (openUserId != null) setUserDisabled(openUserId, e.currentTarget.dataset.disabled === 'true');
  });
  document.getElementById('ud-username-save').addEventListener('click', saveUserUsername);
  document.getElementById('ud-email-save').addEventListener('click', saveUserEmail);
  document.getElementById('ud-pw-save').addEventListener('click', saveUserPassword);

  // Dashboard alerts jump straight to the tab they are about
  document.getElementById('ov-alerts').addEventListener('click', (e) => {
    const item = e.target.closest('[data-alert-tab]');
    if (item && item.dataset.alertTab) switchTab(item.dataset.alertTab);
  });

  // Sidebar (mobile off-canvas)
  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  function closeSidebar() {
    sidebar.classList.remove('open');
    sidebarBackdrop.classList.remove('show');
    sidebarToggle.setAttribute('aria-expanded', 'false');
  }
  sidebarToggle.addEventListener('click', () => {
    const open = !sidebar.classList.contains('open');
    sidebar.classList.toggle('open', open);
    sidebarBackdrop.classList.toggle('show', open);
    sidebarToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  sidebarBackdrop.addEventListener('click', closeSidebar);

  // RFQ / Quotes
  document.getElementById('rfq-apply-btn').addEventListener('click', () => loadRfqList(1, getRfqFilters()));
  document.getElementById('rfqd-cancel').addEventListener('click', () => closeRfqDetail());
  document.getElementById('rfqd-save').addEventListener('click', () => saveRfqDetail());
  document.getElementById('rfq-detail-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeRfqDetail();
  });
  // Delegated — rows are rebuilt on every load, so a per-row listener would
  // need re-attaching each time; one listener on the static container covers
  // every row past and future. Also required under script-src-attr 'none':
  // an inline onclick written into innerHTML never fires (see admin_surface
  // .test.js), so this is the only way a dynamically-created row's button works.
  document.getElementById('rfq-tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-rfq-id]');
    if (btn) openRfqDetail(parseInt(btn.dataset.rfqId, 10));
  });

  // Settings
  document.getElementById('set-save-creds').addEventListener('click', saveCredentials);

  // Check existing session
  const token = getToken();
  if (token) {
    try {
      await api('/admin/ping');
      showApp();
      initApp();
    } catch (_) {
      showLogin();
    }
  } else {
    showLogin();
  }
});
