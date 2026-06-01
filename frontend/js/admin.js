/**
 * KnitAdvisor Admin Panel
 * Query logs, AI provider settings, cache management
 */

// ============================================================
// AUTH LAYER
// ============================================================

const API_BASE = (() => {
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:3001';
  }
  return window.location.origin;
})();

function getToken() {
  return sessionStorage.getItem('adminToken');
}

function setToken(token) {
  sessionStorage.setItem('adminToken', token);
}

function clearToken() {
  sessionStorage.removeItem('adminToken');
}

async function adminFetch(path, method = 'GET', body = null) {
  const token = getToken();
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Token': token || ''
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(API_BASE + path, options);

  if (!response.ok) {
    if (response.status === 401) {
      clearToken();
      showLoginScreen();
      throw new Error('Unauthorized');
    }
    const data = await response.json();
    throw new Error(data.error || response.statusText);
  }

  return response.json();
}

async function checkAuth() {
  try {
    const token = getToken();
    if (!token) return false;

    await adminFetch('/admin/ping');
    return true;
  } catch (err) {
    return false;
  }
}

function showLoginScreen() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('admin-app').classList.add('hidden');
}

function showAdminApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('admin-app').classList.remove('hidden');
}

async function doLogin() {
  const password = document.getElementById('admin-password').value;
  const errorEl = document.getElementById('login-error');

  if (!password) {
    errorEl.classList.remove('hidden');
    errorEl.textContent = 'Password required';
    return;
  }

  try {
    const result = await fetch(API_BASE + '/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });

    if (!result.ok) {
      const data = await result.json();
      errorEl.classList.remove('hidden');
      errorEl.textContent = data.error || 'Login failed';
      return;
    }

    const data = await result.json();
    setToken(data.token);
    showAdminApp();
    await loadLogStats();
    await loadLogs(1, {});
  } catch (err) {
    errorEl.classList.remove('hidden');
    errorEl.textContent = err.message;
  }
}

async function doLogout() {
  try {
    await adminFetch('/admin/logout', 'POST');
  } catch (err) {
    console.error('Logout error:', err);
  }
  clearToken();
  showLoginScreen();
  document.getElementById('admin-password').value = '';
}

// ============================================================
// LOG VIEWER
// ============================================================

let currentLogPage = 1;

async function loadLogStats() {
  try {
    const data = await adminFetch('/admin/api/logs/stats');
    document.getElementById('stat-today').textContent = data.today_total;
    document.getElementById('stat-cache-pct').textContent = data.cache_hit_pct + '%';
    document.getElementById('stat-avg-ms').textContent = data.avg_response_ms;
    document.getElementById('stat-nl').textContent = data.nl_query_count;
  } catch (err) {
    console.error('Load log stats error:', err);
  }
}

async function loadLogs(page, filters) {
  try {
    const params = new URLSearchParams();
    params.append('page', page);
    if (filters.fabric) params.append('fabric', filters.fabric);
    if (filters.date_from) params.append('date_from', filters.date_from);
    if (filters.date_to) params.append('date_to', filters.date_to);
    if (filters.from_cache !== undefined) params.append('from_cache', filters.from_cache);
    if (filters.nl_only) params.append('nl_only', 'true');

    const data = await adminFetch('/admin/api/logs?' + params.toString());

    const tbody = document.getElementById('log-tbody');
    tbody.innerHTML = '';

    for (const row of data.rows) {
      const tr = document.createElement('tr');
      tr.className = 'log-tr';

      const time = new Date(row.created_at).toLocaleString();
      const cacheClass = row.from_cache ? 'badge-hit' : 'badge-miss';
      const cacheText = row.from_cache ? 'HIT' : 'MISS';
      const inputText = (row.input_text || '').substring(0, 50);

      tr.innerHTML = `
        <td class="log-td">${time}</td>
        <td class="log-td" title="${row.input_text || ''}">${inputText}${(row.input_text || '').length > 50 ? '…' : ''}</td>
        <td class="log-td">${row.parsed_fabric || '—'}</td>
        <td class="log-td">${row.parsed_gsm || '—'}</td>
        <td class="log-td">${row.response_ms || '—'}</td>
        <td class="log-td"><span class="badge-cache ${cacheClass}">${cacheText}</span></td>
        <td class="log-td">${row.ai_provider || '—'}</td>
      `;

      tbody.appendChild(tr);
    }

    renderLogPagination(data.page, data.pages);
    currentLogPage = page;
  } catch (err) {
    console.error('Load logs error:', err);
    showToast('Failed to load logs', 'error');
  }
}

function renderLogPagination(page, pages) {
  const container = document.getElementById('log-pagination');
  container.innerHTML = '';

  if (pages <= 1) return;

  const prevBtn = document.createElement('button');
  prevBtn.className = 'btn btn-ghost btn-small';
  prevBtn.textContent = '← Prev';
  prevBtn.disabled = page === 1;
  prevBtn.onclick = () => {
    const filters = getLogFilters();
    loadLogs(page - 1, filters);
  };
  container.appendChild(prevBtn);

  const info = document.createElement('span');
  info.className = 'text-sm text-muted';
  info.textContent = `Page ${page} of ${pages}`;
  container.appendChild(info);

  const nextBtn = document.createElement('button');
  nextBtn.className = 'btn btn-ghost btn-small';
  nextBtn.textContent = 'Next →';
  nextBtn.disabled = page === pages;
  nextBtn.onclick = () => {
    const filters = getLogFilters();
    loadLogs(page + 1, filters);
  };
  container.appendChild(nextBtn);
}

function getLogFilters() {
  return {
    fabric: document.getElementById('filter-fabric').value,
    date_from: document.getElementById('filter-date-from').value,
    date_to: document.getElementById('filter-date-to').value,
    from_cache: document.getElementById('filter-cache').value || undefined,
    nl_only: document.getElementById('filter-nl-only').checked
  };
}

// ============================================================
// AI PROVIDERS
// ============================================================

async function loadProviders() {
  try {
    const data = await adminFetch('/admin/api/providers');
    const container = document.getElementById('providers-list');
    container.innerHTML = '';

    for (const provider of data.providers) {
      container.appendChild(renderProviderCard(provider));
    }
  } catch (err) {
    console.error('Load providers error:', err);
    showToast('Failed to load providers', 'error');
  }
}

function renderProviderCard(provider) {
  const card = document.createElement('div');
  card.className = 'provider-card';
  card.dataset.id = provider.id;
  card.dataset.priority = provider.priority;

  if (provider.is_healthy) {
    card.classList.add('healthy');
  } else {
    card.classList.add('unhealthy');
  }

  if (!provider.is_enabled) {
    card.classList.add('disabled');
  }

  const healthDot = provider.is_healthy ? '<span class="health-dot ok"></span>' : '<span class="health-dot bad"></span>';

  card.innerHTML = `
    <div class="provider-buttons flex gap-6">
      <button class="btn-arrow btn btn-ghost btn-small provider-up" data-id="${provider.id}">↑</button>
      <button class="btn-arrow btn btn-ghost btn-small provider-down" data-id="${provider.id}">↓</button>
    </div>

    <div class="provider-info">
      <div class="priority-badge">#${provider.priority}</div>
      <div>
        <div style="font-weight:600;color:var(--t1);">${provider.provider_name.toUpperCase()}</div>
        <div class="text-xs text-dim">${provider.model_name}</div>
        <div class="provider-details">
          ${provider.daily_limit.toLocaleString()} daily · tokens: ${provider.tokens_today.toLocaleString()} · reqs: ${provider.requests_today} · fails: ${provider.failures_today}
        </div>
        <div class="provider-controls">
          <label class="toggle-switch">
            <input type="checkbox" class="provider-toggle" data-id="${provider.id}" ${provider.is_enabled ? 'checked' : ''}>
            <span class="toggle-track"></span>
          </label>
          <input type="text" class="form-input api-key-input provider-apikey" data-id="${provider.id}" placeholder="API key (${provider.api_key_env})" value="">
          <button class="btn btn-ghost btn-small provider-apikey-save" data-id="${provider.id}">Save</button>
          <button class="btn btn-ghost btn-small provider-test" data-id="${provider.id}">Test ▶</button>
        </div>
      </div>
      <div style="text-align:right;">${healthDot} <span class="text-xs text-dim">${provider.is_healthy ? 'healthy' : 'unhealthy'}</span></div>
    </div>
  `;

  // Event handlers
  card.querySelector('.provider-up').addEventListener('click', () => {
    moveProvider(provider.id, 'up');
  });

  card.querySelector('.provider-down').addEventListener('click', () => {
    moveProvider(provider.id, 'down');
  });

  card.querySelector('.provider-toggle').addEventListener('change', (e) => {
    toggleProvider(provider.id, e.target.checked);
  });

  card.querySelector('.provider-apikey-save').addEventListener('click', () => {
    const keyInput = card.querySelector('.provider-apikey');
    saveApiKey(provider.id, keyInput.value);
  });

  card.querySelector('.provider-test').addEventListener('click', () => {
    testProvider(provider.id);
  });

  return card;
}

async function moveProvider(id, direction) {
  try {
    const cards = [...document.querySelectorAll('.provider-card')];
    const idx = cards.findIndex(c => c.dataset.id == id);

    if (idx === -1) return;

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= cards.length) return;

    const otherId = cards[swapIdx].dataset.id;
    const myPriority = parseInt(cards[idx].dataset.priority);
    const otherPriority = parseInt(cards[swapIdx].dataset.priority);

    await adminFetch(`/admin/api/providers/${id}/priority`, 'PATCH', { priority: otherPriority });
    await adminFetch(`/admin/api/providers/${otherId}/priority`, 'PATCH', { priority: myPriority });

    await loadProviders();
  } catch (err) {
    console.error('Move provider error:', err);
    showToast('Failed to reorder', 'error');
  }
}

async function toggleProvider(id, enabled) {
  try {
    await adminFetch(`/admin/api/providers/${id}/enabled`, 'PATCH', { enabled });
    await loadProviders();
  } catch (err) {
    console.error('Toggle provider error:', err);
    showToast('Failed to toggle', 'error');
  }
}

async function saveApiKey(id, key) {
  try {
    if (!key) {
      showToast('API key is required', 'error');
      return;
    }
    await adminFetch(`/admin/api/providers/${id}/apikey`, 'POST', { key });
    showToast('API key saved', 'success');
  } catch (err) {
    console.error('Save API key error:', err);
    showToast('Failed to save API key', 'error');
  }
}

async function testProvider(id) {
  try {
    const result = await adminFetch(`/admin/api/providers/${id}/test`, 'POST');
    showToast(`Test OK (${result.response_ms}ms): ${result.provider}`, 'success');
  } catch (err) {
    console.error('Test provider error:', err);
    showToast('Provider test failed: ' + err.message, 'error');
  }
}

async function resetDailyStats() {
  if (!confirm('Reset all daily stats? This will clear token counts, request counts, and failure counts.')) {
    return;
  }

  try {
    await adminFetch('/admin/api/providers/reset-stats', 'POST');
    await loadProviders();
    showToast('Daily stats reset', 'success');
  } catch (err) {
    console.error('Reset stats error:', err);
    showToast('Failed to reset stats', 'error');
  }
}

// ============================================================
// CACHE MANAGER
// ============================================================

let currentCachePage = 1;

async function loadCacheStats() {
  try {
    const data = await adminFetch('/admin/api/cache/stats');
    document.getElementById('cache-stat-entries').textContent = data.db_entries.toLocaleString();
    document.getElementById('cache-stat-hits').textContent = data.db_hits.toLocaleString();
    document.getElementById('cache-stat-mem').textContent = data.mem_size;
    document.getElementById('cache-stat-oldest').textContent = data.oldest_entry ? new Date(data.oldest_entry).toLocaleDateString() : '—';
  } catch (err) {
    console.error('Load cache stats error:', err);
  }
}

async function loadCacheEntries(page) {
  try {
    const data = await adminFetch(`/admin/api/cache/entries?page=${page}`);
    const tbody = document.getElementById('cache-tbody');
    tbody.innerHTML = '';

    for (const row of data.rows) {
      const tr = document.createElement('tr');
      tr.className = 'cache-tr';

      const created = new Date(row.created_at).toLocaleString();
      const expires = new Date(row.expires_at).toLocaleString();

      tr.innerHTML = `
        <td class="cache-td" title="${row.cache_key}">${row.cache_key.substring(0, 16)}…</td>
        <td class="cache-td">${row.hit_count}</td>
        <td class="cache-td">${created}</td>
        <td class="cache-td">${expires}</td>
        <td class="cache-td">
          <button class="btn btn-ghost btn-small cache-view" data-key="${row.cache_key}">View</button>
          <button class="btn btn-ghost btn-small cache-delete" data-key="${row.cache_key}">Delete</button>
        </td>
      `;

      tr.querySelector('.cache-view').addEventListener('click', () => viewCacheEntry(row.cache_key));
      tr.querySelector('.cache-delete').addEventListener('click', () => deleteCacheEntry(row.cache_key));

      tbody.appendChild(tr);
    }

    renderCachePagination(data.page, data.pages);
    currentCachePage = page;
  } catch (err) {
    console.error('Load cache entries error:', err);
    showToast('Failed to load cache entries', 'error');
  }
}

function renderCachePagination(page, pages) {
  const container = document.getElementById('cache-pagination');
  container.innerHTML = '';

  if (pages <= 1) return;

  const prevBtn = document.createElement('button');
  prevBtn.className = 'btn btn-ghost btn-small';
  prevBtn.textContent = '← Prev';
  prevBtn.disabled = page === 1;
  prevBtn.onclick = () => loadCacheEntries(page - 1);
  container.appendChild(prevBtn);

  const info = document.createElement('span');
  info.className = 'text-sm text-muted';
  info.textContent = `Page ${page} of ${pages}`;
  container.appendChild(info);

  const nextBtn = document.createElement('button');
  nextBtn.className = 'btn btn-ghost btn-small';
  nextBtn.textContent = 'Next →';
  nextBtn.disabled = page === pages;
  nextBtn.onclick = () => loadCacheEntries(page + 1);
  container.appendChild(nextBtn);
}

async function viewCacheEntry(key) {
  try {
    const data = await adminFetch(`/admin/api/cache/entry/${key}`);
    document.getElementById('entry-key-display').textContent = data.cache_key;
    document.getElementById('entry-json-display').textContent = JSON.stringify(data.result_json, null, 2);
    document.getElementById('cache-entry-viewer').classList.remove('hidden');
  } catch (err) {
    console.error('View cache entry error:', err);
    showToast('Failed to view entry', 'error');
  }
}

async function deleteCacheEntry(key) {
  if (!confirm(`Delete cache entry ${key.substring(0, 16)}…?`)) {
    return;
  }

  try {
    await adminFetch(`/admin/api/cache/entry/${key}`, 'DELETE');
    await loadCacheEntries(currentCachePage);
    showToast('Entry deleted', 'success');
  } catch (err) {
    console.error('Delete cache entry error:', err);
    showToast('Failed to delete entry', 'error');
  }
}

async function flushCache() {
  if (!confirm('Flush ALL cache entries? This cannot be undone.')) {
    return;
  }

  try {
    const result = await adminFetch('/admin/api/cache/flush', 'DELETE');
    await loadCacheStats();
    await loadCacheEntries(1);
    showToast(`Deleted ${result.deleted} entries`, 'success');
  } catch (err) {
    console.error('Flush cache error:', err);
    showToast('Failed to flush cache', 'error');
  }
}

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container') || (() => {
    const c = document.createElement('div');
    c.id = 'toast-container';
    c.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:10000;max-width:400px;';
    document.body.appendChild(c);
    return c;
  })();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.style.cssText = `
    padding: 10px 16px;
    border-radius: 4px;
    font-size: 12px;
    margin-bottom: 8px;
    animation: slideIn 0.2s ease;
  `;

  if (type === 'success') {
    toast.style.cssText += 'background: rgba(0,255,178,.15); border: 1px solid rgba(0,255,178,.3); color: #00ffb2;';
  } else if (type === 'error') {
    toast.style.cssText += 'background: rgba(255,68,68,.15); border: 1px solid rgba(255,68,68,.3); color: var(--a3);';
  } else {
    toast.style.cssText += 'background: rgba(108,142,255,.15); border: 1px solid rgba(108,142,255,.3); color: var(--a2);';
  }

  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideOut 0.2s ease forwards';
    setTimeout(() => toast.remove(), 200);
  }, 3000);
}

// ============================================================
// INIT
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  // Styles for toast animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn { from { transform: translateX(-50%) translateY(20px); opacity: 0; } to { transform: translateX(-50%) translateY(0); opacity: 1; } }
    @keyframes slideOut { from { transform: translateX(-50%) translateY(0); opacity: 1; } to { transform: translateX(-50%) translateY(20px); opacity: 0; } }
  `;
  document.head.appendChild(style);

  // Tab initialization
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const tabId = btn.dataset.tab;
      document.getElementById(tabId).classList.add('active');

      // Lazy-load tab data
      if (tabId === 'tab-providers' && !document.getElementById('providers-list').innerHTML) {
        loadProviders();
      } else if (tabId === 'tab-cache' && !document.getElementById('cache-tbody').innerHTML) {
        loadCacheStats();
        loadCacheEntries(1);
      }
    });
  });

  // Button handlers
  document.getElementById('login-btn').addEventListener('click', doLogin);
  document.getElementById('admin-password').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') doLogin();
  });

  document.getElementById('logout-btn').addEventListener('click', doLogout);

  document.getElementById('logs-apply-btn').addEventListener('click', () => {
    const filters = getLogFilters();
    loadLogs(1, filters);
  });

  document.getElementById('reset-stats-btn').addEventListener('click', resetDailyStats);

  document.getElementById('cache-flush-btn').addEventListener('click', flushCache);
  document.getElementById('cache-refresh-btn').addEventListener('click', () => {
    loadCacheStats();
    loadCacheEntries(currentCachePage);
  });

  document.getElementById('entry-viewer-close').addEventListener('click', () => {
    document.getElementById('cache-entry-viewer').classList.add('hidden');
  });

  // Check auth
  const authed = await checkAuth();
  if (authed) {
    showAdminApp();
    await loadLogStats();
    await loadLogs(1, {});
  } else {
    showLoginScreen();
  }
});
