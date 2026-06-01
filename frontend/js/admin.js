/**
 * KnitAdvisor Admin Panel JS
 */

const API_BASE = (() => {
  const h = window.location.hostname;
  return (h === 'localhost' || h === '127.0.0.1') ? 'http://localhost:3001' : window.location.origin;
})();

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

function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === tabId);
  });

  if (tabId === 'tab-providers' && !tabState.loaded.providers) {
    tabState.loaded.providers = true;
    loadProviders();
  } else if (tabId === 'tab-cache' && !tabState.loaded.cache) {
    tabState.loaded.cache = true;
    loadCacheStats(); loadCacheEntries(1);
  } else if (tabId === 'tab-inquiries' && !tabState.loaded.inquiries) {
    tabState.loaded.inquiries = true;
    loadInquiries(1, {});
  } else if (tabId === 'tab-settings') {
    loadSettings();
  }
}

// ── OVERVIEW ───────────────────────────────────────────────
async function loadOverview() {
  try {
    const [logStats, cacheStats, provData, inqData] = await Promise.all([
      api('/admin/api/logs/stats'),
      api('/admin/api/cache/stats'),
      api('/admin/api/providers'),
      api('/admin/api/inquiries?limit=1'),
    ]);

    document.getElementById('ov-total').textContent       = (inqData.total || 0).toLocaleString();
    document.getElementById('ov-today').textContent       = logStats.today_total || 0;
    document.getElementById('ov-cache').textContent       = (logStats.cache_hit_pct || 0) + '%';
    document.getElementById('ov-avg-ms').textContent      = (logStats.avg_response_ms || 0) + 'ms';
    document.getElementById('ov-cache-entries').textContent = (cacheStats.db_entries || 0).toLocaleString();

    const active = provData.providers.filter(p => p.is_enabled && p.is_healthy).length;
    document.getElementById('ov-providers').textContent = active + '/' + provData.providers.length;

    // Provider health
    const hEl = document.getElementById('ov-provider-health');
    hEl.innerHTML = provData.providers.map(p => {
      const ok = p.is_enabled && p.is_healthy;
      const col = !p.is_enabled ? 'var(--t4)' : p.is_healthy ? 'var(--a1)' : 'var(--a3)';
      const status = !p.is_enabled ? 'Disabled' : p.is_healthy ? 'Healthy' : 'Unhealthy';
      return `<div class="ov-health-row">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="width:7px;height:7px;border-radius:50%;background:${col};display:inline-block;flex-shrink:0;"></span>
          <span style="font-weight:600;color:var(--t1);font-size:12px;">${p.provider_name.toUpperCase()}</span>
          <span style="font-size:10px;color:var(--t3);">${p.model_name}</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:10px;color:${col};">${status}</span>
          <span style="font-size:10px;color:var(--t3);">Priority #${p.priority}</span>
          <span style="font-size:10px;color:var(--t3);">${p.requests_today} req/today</span>
        </div>
      </div>`;
    }).join('');

    // Top fabrics (simple from logs)
    const topEl = document.getElementById('ov-top-fabrics');
    topEl.innerHTML = '<div style="color:var(--t3);font-size:11px;">Fetching from logs…</div>';
    try {
      const logsData = await api('/admin/api/logs?limit=100');
      const fabricCount = {};
      for (const r of logsData.rows) {
        if (r.parsed_fabric) fabricCount[r.parsed_fabric] = (fabricCount[r.parsed_fabric] || 0) + 1;
      }
      const sorted = Object.entries(fabricCount).sort((a,b) => b[1]-a[1]).slice(0,6);
      if (!sorted.length) { topEl.innerHTML = '<div style="color:var(--t3);font-size:11px;">No queries yet</div>'; }
      else {
        const max = sorted[0][1];
        topEl.innerHTML = sorted.map(([f, c]) => `
          <div style="margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
              <span style="font-size:11px;color:var(--t2);">${f.replace(/_/g,' ')}</span>
              <span style="font-size:10px;color:var(--t3);">${c}</span>
            </div>
            <div style="height:3px;background:var(--bg4);border-radius:2px;">
              <div style="height:3px;background:var(--a1);border-radius:2px;width:${Math.round(c/max*100)}%;"></div>
            </div>
          </div>
        `).join('');
      }
    } catch (_) {}
  } catch (e) {
    console.error('Overview error:', e);
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
        <td class="tbl-td">${new Date(r.created_at).toLocaleString()}</td>
        <td class="tbl-td" title="${r.input_text||''}" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${(r.input_text||'').substring(0,45)}${(r.input_text||'').length>45?'…':''}</td>
        <td class="tbl-td">${r.parsed_fabric||'—'}</td>
        <td class="tbl-td">${r.parsed_gsm||'—'}</td>
        <td class="tbl-td">${r.response_ms||'—'}</td>
        <td class="tbl-td"><span class="badge ${hit?'badge-green':'badge-red'}">${hit?'HIT':'MISS'}</span></td>
        <td class="tbl-td">${r.ai_provider||'—'}</td>
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
    container.innerHTML = `<div style="color:var(--a3);font-size:11px;padding:20px 0;">Error: ${e.message}</div>`;
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
  const keyIsSet = !!p.key_is_set;
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
         <button class="btn btn-xs" style="border:none;background:transparent;color:var(--a2);cursor:pointer;padding:0;" onclick="clearCooldown(${p.id})">Clear</button>
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
              placeholder="Enter new ${p.api_key_env}…"
              autocomplete="new-password" spellcheck="false">
            <button class="key-toggle-btn prov-key-show" type="button">Show</button>
            <button class="btn btn-primary btn-sm prov-apikey-save">Save Key</button>
          </div>
          <div class="prov-key-feedback" style="margin-top:8px;font-size:10px;min-height:14px;color:var(--t3);">
            Env var: <code style="color:var(--t2);background:var(--bg3);padding:1px 5px;border-radius:3px;">${p.api_key_env}</code>
            — writes to .env + updates process.env immediately
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
    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    const feedback = card.querySelector('.prov-key-feedback');
    try {
      await api(`/admin/api/providers/${p.id}/apikey`, 'POST', { key });
      toast(`${p.provider_name.toUpperCase()} API key saved successfully`, 'success');
      keyInput.value = '';
      keyInput.type = 'password';
      showBtn.textContent = 'Show';
      // Update current key display
      const currentRow = card.querySelector('.key-current-row');
      currentRow.querySelector('.key-current-value').textContent = `${p.api_key_env} = ••••••••••••••••••••••••••••••`;
      const badge = currentRow.querySelector('.key-notset-badge');
      if (badge) { badge.className = 'key-set-badge'; badge.textContent = '● KEY SET'; }
      feedback.style.color = 'var(--a1)';
      feedback.innerHTML = '✓ Key saved — active immediately (no restart needed)';
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
      resultEl.className = 'prov-test-result ok';
      resultEl.textContent = `OK · ${r.response_ms}ms`;
      resultEl.style.display = 'block';
      // Show parsed result detail
      const parsed = r.result?.parsed || r.result || {};
      detailEl.style.display = 'block';
      detailEl.innerHTML = `<strong style="color:var(--a1);">Parse Result:</strong> ` +
        Object.entries(parsed).filter(([k]) => !['message'].includes(k)).map(([k,v]) =>
          `<span style="color:var(--t3);">${k}:</span> <span style="color:var(--t1);">${v}</span>`
        ).join(' &nbsp;·&nbsp; ');
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
        <td style="padding:9px 10px;color:var(--t2);font-family:var(--mono);font-size:10px;word-break:break-all;">${r.cache_key.substring(0,24)}…</td>
        <td style="padding:9px 10px;color:var(--t2);font-family:var(--mono);">${r.hit_count}</td>
        <td style="padding:9px 10px;color:var(--t2);font-family:var(--mono);">${new Date(r.created_at).toLocaleString()}</td>
        <td style="padding:9px 10px;color:var(--t2);font-family:var(--mono);">${new Date(r.expires_at).toLocaleString()}</td>
        <td style="padding:9px 10px;">
          <div style="display:flex;gap:6px;">
            <button class="btn btn-ghost btn-xs cache-view" data-key="${r.cache_key}">View</button>
            <button class="btn btn-danger btn-xs cache-del" data-key="${r.cache_key}">Delete</button>
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
        <td style="padding:9px 10px;color:var(--t3);font-family:var(--mono);">${r.id}</td>
        <td style="padding:9px 10px;color:var(--t2);font-family:var(--mono);">${new Date(r.created_at).toLocaleString()}</td>
        <td style="padding:9px 10px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--t2);" title="${r.input_text||''}">${(r.input_text||'').substring(0,40)}${(r.input_text||'').length>40?'…':''}</td>
        <td style="padding:9px 10px;color:var(--t2);">${r.parsed_fabric||'—'}</td>
        <td style="padding:9px 10px;color:var(--t2);">${r.parsed_gsm||'—'}</td>
        <td style="padding:9px 10px;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--t2);" title="${r.parsed_composition||''}">${(r.parsed_composition||'—').substring(0,20)}</td>
        <td style="padding:9px 10px;color:var(--t2);">${r.ai_provider||'—'}</td>
        <td style="padding:9px 10px;color:var(--t2);">${r.response_ms||'—'}</td>
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
  document.getElementById('cache-refresh-btn').addEventListener('click', () => { loadCacheStats(); loadCacheEntries(curCachePage); });
  document.getElementById('entry-viewer-close').addEventListener('click', () => document.getElementById('cache-entry-viewer').classList.add('hidden'));

  // Inquiries
  document.getElementById('inq-apply-btn').addEventListener('click', () => loadInquiries(1, getInqFilters()));
  document.getElementById('inq-download-btn').addEventListener('click', downloadInquiriesCSV);

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
