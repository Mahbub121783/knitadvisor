/**
 * KnitAdvisor — localStorage Storage Helper
 * Saves recent calculations + pending result state
 */

const STORAGE_KEYS = {
  RECENTS: 'kna_recents',
  PENDING: 'kna_pending',   // params waiting for result.html
};
const MAX_RECENTS = 6;

// ============================================================
// PENDING CALCULATION (pass data from index → result page)
// ============================================================
function savePending(params) {
  try {
    sessionStorage.setItem(STORAGE_KEYS.PENDING, JSON.stringify({
      params,
      ts: Date.now(),
    }));
  } catch (e) {
    console.warn('[Storage] savePending failed:', e);
  }
}

function loadPending() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEYS.PENDING);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Expire after 10 minutes
    if (Date.now() - parsed.ts > 10 * 60 * 1000) {
      sessionStorage.removeItem(STORAGE_KEYS.PENDING);
      return null;
    }
    return parsed.params;
  } catch {
    return null;
  }
}

function clearPending() {
  sessionStorage.removeItem(STORAGE_KEYS.PENDING);
}

// ============================================================
// RECENT CALCULATIONS
// ============================================================
function saveRecent(params, result) {
  try {
    const existing = getRecents();
    // Remove duplicate (same fabric + gsm)
    const filtered = existing.filter(r =>
      !(r.params.fabric === params.fabric && r.params.gsm === params.gsm)
    );
    // Prepend new entry
    filtered.unshift({
      params,
      summary: buildSummary(result),
      ts: Date.now(),
    });
    // Keep only MAX_RECENTS
    const trimmed = filtered.slice(0, MAX_RECENTS);
    localStorage.setItem(STORAGE_KEYS.RECENTS, JSON.stringify(trimmed));
  } catch (e) {
    console.warn('[Storage] saveRecent failed:', e);
  }
}

function getRecents() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.RECENTS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function clearRecents() {
  localStorage.removeItem(STORAGE_KEYS.RECENTS);
}

// Build a compact summary string for display
function buildSummary(result) {
  if (!result) return '';
  const yarn = result.yarn?.count_display || '';
  const ll = result.loop_length?.value_mm ? `LL ${result.loop_length.value_mm}mm` : '';
  return [yarn, ll].filter(Boolean).join(' · ');
}

// ============================================================
// TIME AGO
// ============================================================
function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
