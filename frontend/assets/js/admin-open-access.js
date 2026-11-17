// KnitAdvisor admin · Open Access — let anyone use the tools without an account: right now or
// from a time the admin picks, for as long as they like (an hour, a week, or no end at all).
// Talks to /admin/api/open-access through admin.js's api() and toast() helpers.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var HOUR = 36e5, DAY = 864e5, MIN = 6e4, DUR_KEY = 'ka-oa-duration';
  var data = null, poll = null, tick = null, ticks = 0, shown = null, heroKey = '';
  var dlg = null, busy = false, lastFocus = null, downOnBackdrop = false;

  var ICON = {
    open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.6-1.7"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/></svg>',
    power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };

  /* ---------- time, on the admin's own clock ---------- */
  var p2 = function (n) { return String(n).padStart(2, '0'); };
  function toInput(ms) {
    if (!Number.isFinite(ms)) return '';
    var d = new Date(ms);
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }
  function fromInput(v) {   // "YYYY-MM-DDTHH:mm" as local time, on every browser
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : NaN;
  }
  function endOfDay(ms, plus) { var d = new Date(ms); d.setDate(d.getDate() + (plus || 0)); d.setHours(23, 59, 0, 0); return d.getTime(); }
  function midnight(ms) { var d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function dayOffset(ms) { return Math.round((midnight(ms) - midnight(Date.now())) / DAY); }
  function clockOf(ms) { return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  function dayOf(ms) {
    var o = dayOffset(ms);
    if (o === 0) return 'today';
    if (o === 1) return 'tomorrow';
    if (o === -1) return 'yesterday';
    return new Date(ms).toLocaleDateString([], o > 1 && o < 7 ? { weekday: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function when(ms) { return dayOf(ms) + ', ' + clockOf(ms); }                 // "today, 6:00 PM"
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function range(a, b) { return cap(when(a)) + ' – ' + (midnight(a) === midnight(b) ? clockOf(b) : when(b)); }
  function shortWhen(ms) {                                                     // for the small print on a tile
    var o = dayOffset(ms);
    if (o === 0) return clockOf(ms);
    if (o > 0 && o < 7) return new Date(ms).toLocaleDateString([], { weekday: 'short' }) + ' ' + clockOf(ms);
    return new Date(ms).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function absWhen(ms) {                                                       // for a printed sign: no "today"
    return new Date(ms).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + clockOf(ms);
  }
  function span(ms) {                                                          // "3 h 15 min", "2 days 4 h"
    ms = Math.max(0, ms);
    var d = Math.floor(ms / DAY), h = Math.floor(ms % DAY / HOUR), m = Math.round(ms % HOUR / MIN);
    if (m === 60) { h++; m = 0; }
    if (h === 24) { d++; h = 0; }
    if (d) return d + (d === 1 ? ' day' : ' days') + (h ? ' ' + h + ' h' : '');
    if (h) return h + ' h' + (m ? ' ' + m + ' min' : '');
    return Math.max(1, m) + ' min';
  }
  function countdown(ms) {                                                     // "2d 4h 05m", "3h 12m", "12m 05s"
    ms = Math.max(0, ms);
    if (ms >= HOUR) {
      var d = Math.floor(ms / DAY), h = Math.floor(ms % DAY / HOUR), m = Math.floor(ms % HOUR / MIN);
      return (d ? d + 'd ' : '') + h + 'h ' + p2(m) + 'm';
    }
    return Math.floor(ms / MIN) + 'm ' + p2(Math.floor(ms % MIN / 1e3)) + 's';
  }

  /** off · scheduled · open · ended — worked out here too, so the panel flips the second it happens. */
  function status(s) {
    var now = Date.now();
    if (!s || !s.enabled) return 'off';
    if (s.until && Date.parse(s.until) <= now) return 'ended';
    if (s.from && Date.parse(s.from) > now) return 'scheduled';
    return 'open';
  }

  function say(t, bad) { var el = $('oa-msg'); if (el) { el.textContent = t || ''; el.style.color = bad ? 'var(--a3)' : 'var(--t3)'; } }
  function note(msg, type) { if (typeof window.toast === 'function') window.toast(msg, type); }

  function settings() {
    return {
      label: $('oa-label').value, message: $('oa-message').value,
      per_hour: +$('oa-per-hour').value || 300,
      scopes: Array.prototype.map.call(document.querySelectorAll('#oa-scopes input:checked'), function (i) { return i.value; }),
    };
  }
  function toolNames(ids) {
    var label = {};
    (data.scopes || []).forEach(function (s) { label[s.id] = s.label; });
    return ids.map(function (id) { return label[id] || id; });
  }

  /* ---------- the status card ---------- */
  function ext(ms, label) { return '<button type="button" class="oa-btn line sm" data-act="ext" data-ms="' + ms + '">' + label + '</button>'; }
  function callsText() { return data.calls + ' guest call' + (data.calls === 1 ? '' : 's') + ' today'; }

  function hero() {
    var s = data.state, st = status(s), el = $('oa-hero'), n = (s.scopes || []).length;
    var tools = n + (n === 1 ? ' tool' : ' tools'), now = Date.now(), h;
    shown = st;
    el.className = 'oa-hero mb-20' + (st === 'open' ? ' is-open' : st === 'scheduled' ? ' is-soon' : '');
    if (st === 'open') {
      var opened = s.opened_at ? Date.parse(s.opened_at) : null, u = s.until ? Date.parse(s.until) : null;
      h = '<div><div class="oa-head"><span class="oa-dot"></span>Open — anyone can use the tools</div>' +
        '<div class="oa-meta"><b>' + esc(s.label) + '</b>' + (opened ? ' · open since ' + esc(when(opened)) : '') + ' · ' + tools + ' · <span id="oa-calls">' + callsText() + '</span></div></div>' +
        '<div class="oa-clock">' + (u
          ? '<div class="k">Closes in</div><div class="v" id="oa-left">' + countdown(u - now) + '</div><div class="s">' + esc(cap(when(u))) + '</div>'
          : '<div class="k">No end time</div><div class="v">Open</div><div class="s">until you turn it off</div>') + '</div>' +
        '<div class="oa-acts">' +
          (u ? '<span class="lbl">Extend</span>' + ext(HOUR, '+1 hour') + ext(4 * HOUR, '+4 hours') + ext(DAY, '+1 day') : '') +
          '<button type="button" class="oa-btn line sm" data-act="edit">' + (u ? 'Change end time' : 'Set an end time') + '</button>' +
          '<span class="sep"></span><button type="button" class="oa-btn stop sm" data-act="off">' + ICON.power + 'Turn off now</button></div>';
    } else if (st === 'scheduled') {
      var f = Date.parse(s.from), u2 = s.until ? Date.parse(s.until) : null;
      h = '<div><div class="oa-head"><span class="oa-dot"></span>Scheduled — it opens by itself</div>' +
        '<div class="oa-meta"><b>' + esc(s.label) + '</b> · ' + esc(u2 ? range(f, u2) : cap(when(f)) + ', with no end time') + ' · ' + tools + '</div></div>' +
        '<div class="oa-clock"><div class="k">Opens in</div><div class="v" id="oa-left">' + countdown(f - now) + '</div><div class="s">' + esc(cap(when(f))) + '</div></div>' +
        '<div class="oa-acts"><button type="button" class="oa-btn go sm" data-act="now">Open now instead</button>' +
          '<button type="button" class="oa-btn line sm" data-act="edit">Change times</button>' +
          '<span class="sep"></span><button type="button" class="oa-btn stop sm" data-act="cancel">Cancel the schedule</button></div>';
    } else {
      var lp = s.last_period, a = lp && Date.parse(lp.from), b = lp && Date.parse(lp.to);
      h = '<div><div class="oa-head"><span class="oa-dot"></span>Closed — everyone signs in as usual</div>' +
        '<div class="oa-meta">' + (lp && a && b
          ? 'Last open: <b>' + esc(lp.label) + '</b> · ' + esc(range(a, b)) + ' (' + span(b - a) + ')'
          : 'Open the tools to everyone whenever you like — right now or at a set time, for an hour, a week, or until you turn it off.') + '</div></div>' +
        '<div class="oa-cta"><button type="button" class="oa-btn go big" data-act="start">' + ICON.open + 'Open access…</button></div>';
    }
    el.innerHTML = h;
    badge(st);
  }

  function badge(st) {
    var b = $('sb-open-live');
    if (!b) return;
    b.hidden = !(st === 'open' || st === 'scheduled');
    b.textContent = st === 'open' ? 'LIVE' : 'SOON';
    b.style.background = st === 'open' ? '#1E7A54' : '#B7791F';
    b.title = st === 'open' ? 'Open access is on' : 'Open access is scheduled';
  }

  /* ---------- the live numbers ---------- */
  function stats() {
    var k = [[data.calls, 'Guest calls today'], [data.visitors, 'Visitors today'], [data.active_now, 'Active in the last 10 min'], [data.devices.phone + ' / ' + data.devices.desktop, 'Phone / desktop calls']];
    $('oa-kpis').innerHTML = k.map(function (x) { return '<div class="stat-card"><div class="stat-val">' + esc(x[0]) + '</div><div class="stat-lbl">' + esc(x[1]) + '</div></div>'; }).join('');
    var max = Math.max.apply(null, data.by_tool.map(function (t) { return t.calls; }).concat([1]));
    $('oa-tools').innerHTML = data.by_tool.map(function (t) {
      return '<div class="oa-tool"><span>' + esc(t.label) + '</span><span class="b"><i style="width:' + (t.calls / max * 100).toFixed(0) + '%"></i></span><span style="text-align:right;font-weight:700">' + t.calls + '</span></div>';
    }).join('');
    var hmax = Math.max.apply(null, data.hours.concat([1])), nowH = new Date(Date.now() + 6 * HOUR).getUTCHours();
    $('oa-hours').innerHTML = data.hours.map(function (n, h) { return '<div class="' + (h === nowH ? 'now' : '') + '" style="height:' + Math.max(3, n / hmax * 100) + '%" title="' + h + ':00 Dhaka — ' + n + ' calls"></div>'; }).join('');
    var label = {}; data.scopes.forEach(function (s) { label[s.id] = s.label; });
    $('oa-latest').innerHTML = data.latest.length ? data.latest.map(function (r) {
      return '<tr><td data-label="Time">' + esc(new Date(r.t).toLocaleTimeString()) + '</td><td data-label="Tool">' + esc(label[r.tool] || r.tool) + '</td><td data-label="Visitor" style="font-family:var(--mono)">' + esc(r.visitor) + '</td><td data-label="Device">' + esc(r.device) + '</td></tr>';
    }).join('') : '<tr><td colspan="4" data-wide style="color:var(--t3)">No guest calls yet today.</td></tr>';
  }

  function fillForm(force) {
    var s = data.state, lbl = $('oa-label');
    if (!force && lbl.dataset.touched) return;   // never overwrite what the admin is typing
    lbl.value = s.label || ''; $('oa-message').value = s.message || ''; $('oa-per-hour').value = s.per_hour || 300;
    $('oa-scopes').innerHTML = data.scopes.map(function (sc) {
      return '<label><input type="checkbox" value="' + esc(sc.id) + '"' + (s.scopes.indexOf(sc.id) > -1 ? ' checked' : '') + '> ' + esc(sc.label) + '</label>';
    }).join('');
    lbl.dataset.touched = '';
  }

  function render(d, force) {
    data = d;
    var s = d.state, key = JSON.stringify([status(s), s.label, s.from, s.until, s.opened_at, (s.scopes || []).length, s.last_period]);
    if (key !== heroKey) { heroKey = key; hero(); }   // redraw only on a real change, so focus is not thrown away every 15 s
    var c = $('oa-calls'); if (c) c.textContent = callsText();
    stats(); fillForm(force);
  }

  function load(force) {
    return window.api('/admin/api/open-access').then(function (d) { render(d, force); }).catch(function (e) { say(e.message, true); });
  }
  function save(body, force) {
    return window.api('/admin/api/open-access', 'POST', body).then(function (d) {
      if (force) $('oa-label').dataset.touched = '';
      render(d, force);
      return d;
    });
  }

  function onTick() {
    if (!data) return;
    var s = data.state, st = status(s);
    if (st !== shown) { heroKey = ''; hero(); load(false); return; }   // it just opened or closed by itself
    var el = $('oa-left');
    if (el && st === 'open' && s.until) el.textContent = countdown(Date.parse(s.until) - Date.now());
    if (el && st === 'scheduled') el.textContent = countdown(Date.parse(s.from) - Date.now());
    if (dlg && dlg.kind === 'period' && ++ticks % 10 === 0) refresh();   // keep "in 3 h" honest while the dialog sits open
  }

  /* ---------- the dialog shell ---------- */
  function showDlg(html, narrow, opener, focusSel) {
    var wrap = $('oa-dlg'), box = wrap.querySelector('.oa-box');
    box.className = 'oa-box' + (narrow ? ' narrow' : '');
    box.innerHTML = html;
    busy = false;
    if (wrap.hidden) {
      lastFocus = opener || document.activeElement;
      wrap.hidden = false;
      document.documentElement.style.overflow = 'hidden';
    }
    box.scrollTop = 0;
    setTimeout(function () { var f = box.querySelector(focusSel || '#oa-d-ok'); if (f) f.focus({ preventScroll: true }); }, 30);
  }
  function closeDlg(force) {
    var wrap = $('oa-dlg');
    if (wrap.hidden || (busy && !force)) return;
    wrap.hidden = true;
    wrap.querySelector('.oa-box').innerHTML = '';
    dlg = null; busy = false;
    document.documentElement.style.overflow = '';
    var back = lastFocus && document.body.contains(lastFocus) ? lastFocus : $('oa-hero').querySelector('button');
    if (back) back.focus();
  }
  function trap(e, root) {
    var f = Array.prototype.filter.call(root.querySelectorAll('button, input, select, textarea, a[href]'), function (x) { return !x.disabled && x.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1], at = document.activeElement;
    if (!root.contains(at)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && at === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  }
  function head(icon, tone, title, sub) {
    return '<div class="oa-box-h"><div class="oa-ico' + (tone ? ' ' + tone : '') + '">' + icon + '</div>' +
      '<div><h3 id="oa-dlg-title">' + esc(title) + '</h3>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>' +
      '<button type="button" class="oa-x" data-close aria-label="Close">' + ICON.x + '</button></div>';
  }

  /* ---------- open / change times ---------- */
  var DUR_IDS = ['1h', '2h', '4h', '8h', 'eod', 'eod1', '3d', '7d', 'custom', 'none'];
  function options(b) {
    var today = dayOffset(b) === 0;
    return [
      { id: '1h', label: '1 hour', end: b + HOUR },
      { id: '2h', label: '2 hours', end: b + 2 * HOUR },
      { id: '4h', label: '4 hours', end: b + 4 * HOUR },
      { id: '8h', label: '8 hours', end: b + 8 * HOUR },
      { id: 'eod', label: today ? 'Rest of today' : 'Rest of day', end: endOfDay(b, 0) },
      { id: 'eod1', label: today ? 'Till tomorrow' : 'Till next day', end: endOfDay(b, 1) },
      { id: '3d', label: '3 days', end: endOfDay(b, 2) },
      { id: '7d', label: '1 week', end: endOfDay(b, 6) },
      { id: 'custom', label: 'Pick a time', end: null },
      { id: 'none', label: 'No end', end: null },
    ];
  }
  function base() { return !dlg.editOpen && dlg.from === 'later' ? dlg.fromAt : Date.now(); }
  function endFor(id, b) {
    if (id === 'none') return null;
    if (id === 'custom') return dlg.toAt;
    for (var o = options(b), i = 0; i < o.length; i++) if (o[i].id === id) return o[i].end;
    return null;
  }
  var SHORT = 10 * MIN;
  function tooShort(o, b) { return o.end != null && Number.isFinite(b) && o.end - Math.max(b, Date.now()) < SHORT; }
  function remembered() { try { var v = localStorage.getItem(DUR_KEY); if (v && v !== 'custom' && DUR_IDS.indexOf(v) > -1) return v; } catch (_) {} return 'eod'; }
  function remember(v) { try { localStorage.setItem(DUR_KEY, v); } catch (_) {} }
  function nextNine() { var d = new Date(); d.setHours(9, 0, 0, 0); if (d.getTime() < Date.now() + 30 * MIN) d.setDate(d.getDate() + 1); return d.getTime(); }
  function roundUp(ms, step) { return Math.ceil(ms / step) * step; }

  function openPeriod(mode, opener) {
    var s = data.state, st = status(s), editOpen = mode === 'edit' && st === 'open';
    dlg = { kind: 'period', mode: mode, editOpen: editOpen, from: 'now', fromAt: nextNine(), dur: remembered(), toAt: NaN, serverErr: '' };
    if (mode === 'edit') {
      if (st === 'scheduled') { dlg.from = 'later'; dlg.fromAt = Date.parse(s.from); }
      if (s.until) { dlg.dur = 'custom'; dlg.toAt = Date.parse(s.until); }
      else if (!editOpen) dlg.dur = 'none';
    }
    if (!Number.isFinite(dlg.toAt)) dlg.toAt = roundUp(base() + 2 * HOUR, 30 * MIN);
    var pick = options(base()).filter(function (o) { return o.id === dlg.dur; })[0];
    if (pick && tooShort(pick, base())) dlg.dur = 'eod1';   // late in the evening, "rest of today" is nothing

    var opened = s.opened_at ? Date.parse(s.opened_at) : null;
    var title = mode === 'start' ? 'Open the tools to everyone' : editOpen ? 'Change when it closes' : 'Change the scheduled times';
    var sub = mode === 'start' ? 'Anyone with the link uses the tools you have ticked, without an account. Nothing they do is saved, and it closes by itself at the end time.'
      : editOpen ? 'Open since ' + esc(opened ? when(opened) : 'earlier') + '. Guests keep their access until the new end time.'
      : 'It opens by itself at the start time and closes by itself at the end time.';
    var h = head(mode === 'start' ? ICON.open : ICON.clock, mode === 'start' ? '' : 'blue', title, sub) +
      '<div class="oa-box-b">' +
      (editOpen ? '' :
        '<div class="oa-sec"><div class="oa-sec-t" id="oa-d-start-t">Starts</div>' +
        '<div class="oa-seg" role="group" aria-labelledby="oa-d-start-t"><button type="button" data-from="now">Right now</button><button type="button" data-from="later">At a set time</button></div>' +
        '<div class="oa-dt" id="oa-d-later"><input type="datetime-local" class="oa-in" id="oa-d-from" aria-label="Opens at"><small id="oa-d-from-hint"></small></div></div>') +
      '<div class="oa-sec"><div class="oa-sec-t" id="oa-d-dur-t">' + (editOpen ? 'Keep it open for' : 'For how long') + '</div>' +
      '<div class="oa-tiles" role="group" aria-labelledby="oa-d-dur-t">' + DUR_IDS.map(function (id) { return '<button type="button" class="oa-tile" data-dur="' + id + '"><b></b><span></span></button>'; }).join('') + '</div>' +
      '<div class="oa-dt" id="oa-d-custom"><input type="datetime-local" class="oa-in" id="oa-d-to" aria-label="Closes at"><small id="oa-d-to-hint"></small></div></div>' +
      '<div class="oa-sum" id="oa-d-sum"></div>' +
      '<div class="oa-note" id="oa-d-note" hidden>With no end time it stays open — overnight, over the weekend — until you come back here and turn it off.</div>' +
      '<div class="oa-err" id="oa-d-err" role="alert" hidden></div>' +
      '</div>' +
      '<div class="oa-box-f"><button type="button" class="oa-btn line" data-close>Cancel</button><button type="button" class="oa-btn go" id="oa-d-ok"></button></div>';
    showDlg(h, false, opener);
    if ($('oa-d-from')) { $('oa-d-from').value = toInput(dlg.fromAt); $('oa-d-from').min = toInput(Date.now()); }
    $('oa-d-to').value = toInput(dlg.toAt);
    refresh();
  }

  function problem(b, end, s) {
    var now = Date.now();
    if (!dlg.editOpen && dlg.from === 'later') {
      if (!Number.isFinite(b)) return 'Pick the date and time it should open.';
      if (b <= now + 30e3) return 'That start time has already passed. Pick a later time, or choose “Right now”.';
    }
    var start = Math.max(Number.isFinite(b) ? b : now, now);
    if (dlg.dur === 'custom') {
      if (!Number.isFinite(end)) return 'Pick the date and time it should close.';
      if (end <= now) return 'That end time has already passed.';
      if (end <= start) return 'The end time must come after the start.';
    } else if (dlg.dur !== 'none' && Number.isFinite(end) && end - start < SHORT) {
      return 'That leaves less than 10 minutes — pick a longer time.';
    }
    if (!s.scopes.length) return 'No tools are ticked in Settings. Tick at least one tool first.';
    return '';
  }

  function sumRow(k, v) { return '<div class="oa-sum-r"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>'; }

  function refresh() {
    if (!dlg || dlg.kind !== 'period') return;
    var now = Date.now(), b = base(), end = endFor(dlg.dur, b), s = settings(), start = Math.max(Number.isFinite(b) ? b : now, now);
    if (!dlg.editOpen) {
      Array.prototype.forEach.call(document.querySelectorAll('#oa-dlg [data-from]'), function (x) { x.setAttribute('aria-pressed', String(x.getAttribute('data-from') === dlg.from)); });
      $('oa-d-later').hidden = dlg.from !== 'later';
      $('oa-d-from-hint').textContent = Number.isFinite(dlg.fromAt) && dlg.fromAt > now ? 'in ' + span(dlg.fromAt - now) : '';
    }
    options(Number.isFinite(b) ? b : now).forEach(function (o) {
      var t = document.querySelector('#oa-dlg [data-dur="' + o.id + '"]');
      if (!t) return;
      t.querySelector('b').textContent = o.label;
      t.querySelector('span').textContent = o.id === 'none' ? 'until turned off'
        : o.id === 'custom' ? (dlg.dur === 'custom' && Number.isFinite(dlg.toAt) ? shortWhen(dlg.toAt) : 'date and time')
        : shortWhen(o.end);
      t.setAttribute('aria-pressed', String(dlg.dur === o.id));
      t.disabled = dlg.dur !== o.id && tooShort(o, b);
    });
    $('oa-d-custom').hidden = dlg.dur !== 'custom';
    $('oa-d-to').min = toInput(start);
    $('oa-d-to-hint').textContent = dlg.dur === 'custom' && Number.isFinite(dlg.toAt) && dlg.toAt > start ? span(dlg.toAt - start) + (dlg.editOpen ? ' from now' : ' open') : '';

    var opened = data.state.opened_at ? Date.parse(data.state.opened_at) : null;
    var opens = dlg.editOpen ? '<b>Already open</b>' + (opened ? '<small>since ' + esc(when(opened)) + '</small>' : '')
      : dlg.from === 'now' ? '<b>Now</b><small>the moment you press the button</small>'
      : Number.isFinite(b) ? '<b>' + esc(cap(when(b))) + '</b>' + (b > now ? '<small>in ' + esc(span(b - now)) + '</small>' : '') : '—';
    var closes = dlg.dur === 'none' ? '<b>Only when you turn it off</b>'
      : Number.isFinite(end) ? '<b>' + esc(cap(when(end))) + '</b>' + (end > start ? '<small>' + esc(span(end - start)) + (dlg.editOpen ? ' from now' : ' open') + '</small>' : '') : '—';
    var names = toolNames(s.scopes);
    $('oa-d-sum').innerHTML = sumRow('Opens', opens) + sumRow('Closes', closes) +
      sumRow('Banner', '<b>' + esc(s.label.trim() || 'Open Innovation') + '</b>' + (s.message.trim() ? ' — ' + esc(s.message.trim()) : '')) +
      sumRow('Tools', names.length ? esc(names.join(' · ')) : '<span style="color:var(--a3);font-weight:600">None ticked</span>');
    $('oa-d-note').hidden = dlg.dur !== 'none';

    var err = problem(b, end, s) || dlg.serverErr, errEl = $('oa-d-err');
    errEl.textContent = err; errEl.hidden = !err;
    var ok = $('oa-d-ok'), now0 = dlg.editOpen || dlg.from === 'now';
    ok.textContent = busy ? 'Saving…' : dlg.editOpen ? 'Save new end time' : dlg.from === 'later' ? (dlg.mode === 'edit' ? 'Save times' : 'Schedule it') : (dlg.mode === 'edit' ? 'Open it now' : 'Open access now');
    ok.className = 'oa-btn ' + (now0 && !dlg.editOpen ? 'go' : 'blue');
    ok.disabled = busy || !!problem(b, end, s);
  }

  function submitPeriod() {
    if (busy || !dlg || dlg.kind !== 'period') return;
    var b = base(), end = endFor(dlg.dur, b), s = settings();
    if (problem(b, end, s)) { refresh(); return; }
    var body = s, d = dlg;
    body.enabled = true;
    if (!d.editOpen) body.from = d.from === 'later' ? new Date(b).toISOString() : null;
    body.until = end != null ? new Date(end).toISOString() : null;
    if (d.mode === 'start' && d.dur !== 'custom') remember(d.dur);
    busy = true; d.serverErr = ''; refresh();
    save(body, true).then(function () {
      closeDlg(true);
      say('');
      note(d.editOpen ? (end ? 'Saved — it now closes ' + when(end) + '.' : 'Saved — it stays open until you turn it off.')
        : d.from === 'later' ? 'Scheduled — it opens ' + when(b) + '.'
        : end ? 'Open access is on until ' + when(end) + '.' : 'Open access is on, with no end time.', 'success');
    }).catch(function (e) {
      busy = false;
      if (dlg === d) { d.serverErr = e.message; refresh(); }
    });
  }

  /* ---------- turn off / cancel / open early ---------- */
  function confirmBox(o, opener) {
    dlg = { kind: 'confirm', run: o.run };
    var danger = o.tone === 'danger';
    showDlg(head(o.icon, danger ? 'red' : '', o.title, o.text) +
      '<div class="oa-box-b"><div class="oa-err" id="oa-d-err" role="alert" hidden></div></div>' +
      '<div class="oa-box-f"><button type="button" class="oa-btn line" data-close>' + esc(o.cancel) + '</button>' +
      '<button type="button" class="oa-btn ' + (danger ? 'danger' : 'go') + '" id="oa-d-ok">' + esc(o.ok) + '</button></div>',
      true, opener, danger ? '[data-close].oa-btn' : '#oa-d-ok');
  }
  function runConfirm() {
    if (busy || !dlg || dlg.kind !== 'confirm') return;
    var ok = $('oa-d-ok'), label = ok.textContent, d = dlg;
    busy = true; ok.disabled = true; ok.textContent = 'Working…';
    d.run().then(function (msg) { closeDlg(true); if (msg) note(msg, 'success'); })
      .catch(function (e) {
        busy = false;
        if (dlg !== d) return;
        ok.disabled = false; ok.textContent = label;
        var el = $('oa-d-err'); el.textContent = e.message; el.hidden = false;
      });
  }

  function extend(ms, btn) {
    var u = Date.parse(data.state.until), next = Math.max(u, Date.now()) + ms;
    btn.disabled = true;
    save({ until: new Date(next).toISOString() }, false)
      .then(function () { note('Extended — it now closes ' + when(next) + '.', 'success'); })
      .catch(function (e) { btn.disabled = false; note(e.message, 'error'); });
  }

  function heroAction(e) {
    var b = e.target.closest('button[data-act]');
    if (!b || !data) return;
    var act = b.getAttribute('data-act'), s = data.state;
    if (act === 'start') return openPeriod('start', b);
    if (act === 'edit') return openPeriod('edit', b);
    if (act === 'ext') return extend(+b.getAttribute('data-ms'), b);
    if (act === 'off') return confirmBox({
      tone: 'danger', icon: ICON.power, title: 'Turn off open access?',
      text: 'Guests lose access straight away — anyone in the middle of a calculation will be asked to sign in. Today’s usage stays in the log.',
      cancel: 'Keep it open', ok: 'Turn off now',
      run: function () { return save({ enabled: false }, false).then(function () { return 'Open access is off. Everyone signs in as usual.'; }); },
    }, b);
    if (act === 'cancel') return confirmBox({
      tone: 'danger', icon: ICON.clock, title: 'Cancel the scheduled opening?',
      text: 'It will not open ' + esc(when(Date.parse(s.from))) + '. Your settings stay as they are, ready for next time.',
      cancel: 'Keep the schedule', ok: 'Cancel the schedule',
      run: function () { return save({ enabled: false }, false).then(function () { return 'Schedule cancelled.'; }); },
    }, b);
    if (act === 'now') return confirmBox({
      tone: 'go', icon: ICON.open, title: 'Open it now?',
      text: 'Anyone can use the tools from this moment, instead of ' + esc(when(Date.parse(s.from))) + '. ' + (s.until ? 'It still closes ' + esc(when(Date.parse(s.until))) + '.' : 'It has no end time.'),
      cancel: 'Not yet', ok: 'Open now',
      run: function () { return save({ enabled: true, from: null }, false).then(function () { return 'Open access is on.'; }); },
    }, b);
  }

  /* ---------- the stand QR code ---------- */
  function openQr() {
    var url = window.location.origin + '/';
    try { var q = window.qrcode(0, 'M'); q.addData(url); q.make(); $('oa-qr-code').innerHTML = q.createSvgTag({ cellSize: 8, margin: 2, scalable: true }); } catch (_) { $('oa-qr-code').textContent = url; }
    var s = data && data.state, st = status(s), f = s && s.from ? Date.parse(s.from) : null, u = s && s.until ? Date.parse(s.until) : null;
    $('oa-qr-title').textContent = (s && s.label) || 'KnitAdvisor';
    $('oa-qr-url').textContent = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    $('oa-qr-when').textContent = st === 'open' ? (u ? 'Open until ' + absWhen(u) : 'Open now')
      : st === 'scheduled' ? (u ? absWhen(f) + ' – ' + (midnight(f) === midnight(u) ? clockOf(u) : absWhen(u)) : 'From ' + absWhen(f)) : '';
    $('oa-qr-warn').hidden = st === 'open' || st === 'scheduled';
    lastFocus = document.activeElement;
    $('oa-qr').hidden = false;
    document.documentElement.style.overflow = 'hidden';
    setTimeout(function () { $('oa-qr-close').focus(); }, 30);
  }
  function closeQr() {
    if ($('oa-qr').hidden) return;
    $('oa-qr').hidden = true;
    document.documentElement.style.overflow = '';
    if (lastFocus && document.body.contains(lastFocus)) lastFocus.focus();
  }

  /* ---------- wiring ---------- */
  function wire() {
    if (!$('oa-save')) return;
    $('oa-hero').addEventListener('click', heroAction);
    $('oa-save').onclick = function () {
      var btn = this;
      btn.disabled = true; say('Saving…');
      save(settings(), true)
        .then(function () { say('Saved.'); note('Open access settings saved.', 'success'); })
        .catch(function (e) { say(e.message, true); })
        .then(function () { btn.disabled = false; });
    };
    $('oa-reload').onclick = function () { load(true); };
    ['oa-label', 'oa-message', 'oa-per-hour'].forEach(function (id) { $(id).addEventListener('input', function () { $('oa-label').dataset.touched = '1'; }); });
    $('oa-scopes').addEventListener('change', function () { $('oa-label').dataset.touched = '1'; });

    var wrap = $('oa-dlg');
    wrap.addEventListener('mousedown', function (e) { downOnBackdrop = e.target === wrap; });
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap) { if (downOnBackdrop) closeDlg(); return; }
      var t = e.target.closest('button');
      if (!t || !dlg) return;
      if (t.hasAttribute('data-close')) return closeDlg();
      if (t.id === 'oa-d-ok') return dlg.kind === 'confirm' ? runConfirm() : submitPeriod();
      if (busy) return;
      if (t.hasAttribute('data-from')) {
        dlg.from = t.getAttribute('data-from'); dlg.serverErr = '';
        if (dlg.from === 'later' && !(dlg.fromAt > Date.now())) { dlg.fromAt = nextNine(); $('oa-d-from').value = toInput(dlg.fromAt); }
        refresh();
        if (dlg.from === 'later') $('oa-d-from').focus();
        return;
      }
      if (t.hasAttribute('data-dur')) {
        dlg.dur = t.getAttribute('data-dur'); dlg.serverErr = '';
        if (dlg.dur === 'custom' && !(dlg.toAt > Math.max(base(), Date.now()))) { dlg.toAt = roundUp(Math.max(base(), Date.now()) + 2 * HOUR, 30 * MIN); $('oa-d-to').value = toInput(dlg.toAt); }
        refresh();
      }
    });
    wrap.addEventListener('input', function (e) {
      if (!dlg || dlg.kind !== 'period') return;
      if (e.target.id === 'oa-d-from') dlg.fromAt = fromInput(e.target.value);
      else if (e.target.id === 'oa-d-to') dlg.toAt = fromInput(e.target.value);
      else return;
      dlg.serverErr = ''; refresh();
    });

    var qr = $('oa-qr');
    $('oa-qr-btn').onclick = openQr;
    $('oa-qr-close').onclick = closeQr;
    $('oa-qr-x').onclick = closeQr;
    $('oa-qr-print').onclick = function () { document.body.classList.add('oa-printing'); window.print(); setTimeout(function () { document.body.classList.remove('oa-printing'); }, 1000); };
    window.addEventListener('afterprint', function () { document.body.classList.remove('oa-printing'); });
    qr.addEventListener('mousedown', function (e) { downOnBackdrop = e.target === qr; });
    qr.addEventListener('click', function (e) { if (e.target === qr && downOnBackdrop) closeQr(); });

    document.addEventListener('keydown', function (e) {
      if (!wrap.hidden) {
        if (e.key === 'Escape') { e.preventDefault(); closeDlg(); }
        else if (e.key === 'Tab') trap(e, wrap);
        else if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); var ok = $('oa-d-ok'); if (ok && !ok.disabled) ok.click(); }
      } else if (!qr.hidden) {
        if (e.key === 'Escape') { e.preventDefault(); closeQr(); }
        else if (e.key === 'Tab') trap(e, qr);
      }
    });
  }

  // admin.js calls this whenever a tab is shown
  window.kaOpenAccessTab = function (visible) {
    clearInterval(poll); clearInterval(tick);
    if (visible) {
      load(true);
      poll = setInterval(function () { load(false); }, 15000);
      tick = setInterval(onTick, 1000);
    }
  };
  wire();
  // the LIVE / SOON badge in the sidebar, once signed in
  setTimeout(function () {
    if (!sessionStorage.getItem('adminToken')) return;
    window.api('/admin/api/open-access').then(function (d) { badge(status(d.state)); }).catch(function () {});
  }, 1500);
})();
