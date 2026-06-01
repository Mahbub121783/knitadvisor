/**
 * KnitAdvisor — UI Utilities
 * Toast, loading overlay, tabs, collapsible panels
 */

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
(function initToastContainer() {
  if (document.getElementById('toast-container')) return;
  const el = document.createElement('div');
  el.id = 'toast-container';
  document.body.appendChild(el);
})();

/**
 * Show a toast notification
 * @param {string} message
 * @param {'success'|'error'|'info'} type
 * @param {number} durationMs
 */
function showToast(message, type = 'info', durationMs = 3000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('out');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, durationMs);
}

// ============================================================
// LOADING OVERLAY
// ============================================================
let loadingEl = null;

function showLoading(message = 'Calculating...') {
  if (!loadingEl) {
    loadingEl = document.createElement('div');
    loadingEl.id = 'loading-overlay';
    loadingEl.className = 'loading-overlay';
    loadingEl.innerHTML = `
      <div class="spinner"></div>
      <div class="loading-text" id="loading-msg">${message}</div>
    `;
    document.body.appendChild(loadingEl);
  } else {
    document.getElementById('loading-msg').textContent = message;
    loadingEl.classList.remove('hidden');
  }
}

function hideLoading() {
  if (loadingEl) loadingEl.classList.add('hidden');
}

// ============================================================
// BUTTON LOADING STATE
// ============================================================
function setButtonLoading(btn, loading, originalText) {
  if (loading) {
    btn._originalHTML = btn.innerHTML;
    btn.innerHTML = `<div class="spinner" style="width:16px;height:16px;border-width:2px;"></div><span>${originalText || 'Loading...'}</span>`;
    btn.disabled = true;
  } else {
    btn.innerHTML = btn._originalHTML || btn.innerHTML;
    btn.disabled = false;
  }
}

// ============================================================
// COLLAPSIBLE PANELS
// ============================================================
function initCollapsibles() {
  document.querySelectorAll('.collapsible-trigger').forEach(trigger => {
    trigger.addEventListener('click', () => {
      const body = trigger.nextElementSibling;
      if (!body || !body.classList.contains('collapsible-body')) return;
      const isOpen = body.classList.contains('open');
      body.classList.toggle('open', !isOpen);
      trigger.classList.toggle('open', !isOpen);
    });
  });
}

// ============================================================
// TAB SWITCHING
// ============================================================
/**
 * Initialize tab switching for a given container
 * @param {string} barSelector — CSS selector for .tab-bar
 * @param {string} contentSelector — CSS selector for tab content panels
 * @param {string} activeClass — class to add to active panel (default 'active')
 */
function initTabs(barSelector, contentSelector, activeClass = 'active') {
  const bar = document.querySelector(barSelector);
  if (!bar) return;

  bar.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      if (!target) return;

      // Update buttons
      bar.querySelectorAll('.tab-btn').forEach(b => b.classList.remove(activeClass));
      btn.classList.add(activeClass);

      // Update panels
      document.querySelectorAll(contentSelector).forEach(panel => {
        panel.classList.toggle(activeClass, panel.id === target || panel.dataset.tab === target);
      });
    });
  });
}

// ============================================================
// FORMAT NUMBERS
// ============================================================
function fmt(val, decimals = 2, fallback = '—') {
  if (val === null || val === undefined || isNaN(val)) return fallback;
  return parseFloat(val).toFixed(decimals);
}

function fmtRange(min, max, unit = '') {
  if (min === null || max === null) return '—';
  return `${min}–${max}${unit ? ' ' + unit : ''}`;
}

// ============================================================
// FABRIC CATEGORY DISPLAY NAME
// ============================================================
const CATEGORY_LABELS = {
  single_jersey: 'Single Bed',
  rib: 'Rib',
  interlock: 'Double Bed (Interlock)',
  warp_knit: 'Warp Knit',
};
function categoryLabel(cat) {
  return CATEGORY_LABELS[cat] || cat;
}

// ============================================================
// COPY TO CLIPBOARD
// ============================================================
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied!', 'success', 1500);
  } catch {
    showToast('Copy failed', 'error', 2000);
  }
}

// ============================================================
// RENDER ERROR STATE
// ============================================================
function renderError(containerEl, message, detail) {
  containerEl.innerHTML = `
    <div class="card accent-red anim-in" style="text-align:center;padding:32px 20px;">
      <div style="font-size:28px;margin-bottom:12px;">⚠️</div>
      <div class="h3 text-head" style="color:var(--a3);margin-bottom:8px;">${message}</div>
      ${detail ? `<div class="text-sm text-muted">${detail}</div>` : ''}
      <a href="/" class="btn btn-ghost mt-16" style="display:inline-flex;">← Back to Home</a>
    </div>
  `;
}

// ============================================================
// INIT ON DOM READY
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  initCollapsibles();
});
