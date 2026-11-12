// KnitAdvisor admin · Open Access — one switch that lets anyone use the tools without an account
// (an exhibition, an open day), until a time set here. Uses admin.js's api() helper.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var data = null, timer = null, tick = null, untilChoice;   // undefined = leave as saved

  function toLocalInput(iso) {
    if (!iso) return '';
    var d = new Date(iso), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function endOfDhakaDay() {
    var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-');
    return new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2], 23 - 6, 59, 0)).toISOString();   // 23:59 in Dhaka (UTC+6)
  }
  function left(iso) {
    var ms = Date.parse(iso) - Date.now();
    if (!(ms > 0)) return 'ending now';
    var h = Math.floor(ms / 3600e3), m = Math.floor(ms % 3600e3 / 60e3), s = Math.floor(ms % 60e3 / 1e3);
    return (h ? h + ' h ' : '') + m + ' min' + (h ? '' : ' ' + s + ' s');
  }
  function say(t, bad) { var el = $('oa-msg'); if (el) { el.textContent = t || ''; el.style.color = bad ? '#B23B3B' : 'var(--t3)'; } }

  function form() {
    var until = untilChoice !== undefined ? untilChoice : ($('oa-until').value ? new Date($('oa-until').value).toISOString() : null);
    return {
      label: $('oa-label').value, message: $('oa-message').value, until: until,
      per_hour: +$('oa-per-hour').value || 300,
      scopes: Array.prototype.map.call(document.querySelectorAll('#oa-scopes input:checked'), function (i) { return i.value; }),
    };
  }

  function hero() {
    var s = data.state, on = s.active, el = $('oa-hero');
    el.className = 'oa-hero mb-20' + (on ? ' on' : '');
    el.innerHTML = '<div><div class="oa-state"><span class="oa-dot"></span>' + (on ? 'OPEN — anyone can use the tools, no sign-in' : 'Closed — normal sign-in') + '</div>' +
      '<div class="oa-sub">' + (on
        ? esc(s.label) + ' · ' + (s.until ? 'switches itself off in <b id="oa-left">' + esc(left(s.until)) + '</b> (' + new Date(s.until).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) + ')' : 'open until you turn it off') + ' · ' + s.scopes.length + ' tools open'
        : s.enabled && s.until ? 'The last open period ended ' + new Date(s.until).toLocaleString() + '.' : 'Turn it on for an event: visitors use the tools straight away, nothing is saved to any account.') + '</div></div>' +
      (on ? '<div><div class="oa-count">' + data.calls + '</div><div class="oa-sub">guest calls today</div></div><div><div class="oa-count">' + data.visitors + '</div><div class="oa-sub">visitors</div></div>' : '') +
      '<button type="button" class="oa-switch ' + (on ? 'turn-off' : 'turn-on') + '" id="oa-toggle">' + (on ? 'Turn off now' : 'Turn on open access') + '</button>';
    $('oa-toggle').onclick = function () { toggle(!on); };
    var live = $('sb-open-live'); if (live) live.hidden = !on;
  }

  function stats() {
    var k = [[data.calls, 'Guest calls today'], [data.visitors, 'Visitors today'], [data.active_now, 'Active in the last 10 min'], [data.devices.phone + ' / ' + data.devices.desktop, 'Phone / desktop calls']];
    $('oa-kpis').innerHTML = k.map(function (x) { return '<div class="stat-card"><div class="stat-val">' + esc(x[0]) + '</div><div class="stat-lbl">' + esc(x[1]) + '</div></div>'; }).join('');
    var max = Math.max.apply(null, data.by_tool.map(function (t) { return t.calls; }).concat([1]));
    $('oa-tools').innerHTML = data.by_tool.map(function (t) {
      return '<div class="oa-tool"><span>' + esc(t.label) + '</span><span class="b"><i style="width:' + (t.calls / max * 100).toFixed(0) + '%"></i></span><span style="text-align:right;font-weight:700">' + t.calls + '</span></div>';
    }).join('');
    var hmax = Math.max.apply(null, data.hours.concat([1])), nowH = new Date(Date.now() + 6 * 3600e3).getUTCHours();
    $('oa-hours').innerHTML = data.hours.map(function (n, h) { return '<div class="' + (h === nowH ? 'now' : '') + '" style="height:' + Math.max(3, n / hmax * 100) + '%" title="' + h + ':00 Dhaka — ' + n + ' calls"></div>'; }).join('');
    var label = {}; data.scopes.forEach(function (s) { label[s.id] = s.label; });
    $('oa-latest').innerHTML = data.latest.length ? data.latest.map(function (r) {
      return '<tr><td>' + esc(new Date(r.t).toLocaleTimeString()) + '</td><td>' + esc(label[r.tool] || r.tool) + '</td><td style="font-family:monospace">' + esc(r.visitor) + '</td><td>' + esc(r.device) + '</td></tr>';
    }).join('') : '<tr><td colspan="4" style="color:var(--t3)">No guest calls yet today.</td></tr>';
  }

  function fillForm(force) {
    var s = data.state;
    if (force || !$('oa-label').dataset.touched) {
      $('oa-label').value = s.label || ''; $('oa-message').value = s.message || ''; $('oa-per-hour').value = s.per_hour || 300;
      $('oa-until').value = toLocalInput(s.until);
      $('oa-scopes').innerHTML = data.scopes.map(function (sc) {
        return '<label><input type="checkbox" value="' + esc(sc.id) + '"' + (s.scopes.indexOf(sc.id) > -1 ? ' checked' : '') + '> ' + esc(sc.label) + '</label>';
      }).join('');
      untilChoice = undefined;
      Array.prototype.forEach.call(document.querySelectorAll('#oa-until-chips button'), function (b) { b.classList.remove('on'); });
    }
  }

  function render(d, force) {
    data = d;
    hero(); stats(); fillForm(force);
    clearInterval(tick);
    if (d.state.active && d.state.until) tick = setInterval(function () { var el = $('oa-left'); if (el) el.textContent = left(data.state.until); if (Date.parse(data.state.until) <= Date.now()) load(); }, 1000);
  }

  function load(force) {
    return window.api('/admin/api/open-access').then(function (d) { render(d, force); }).catch(function (e) { say(e.message, true); });
  }
  function post(body, okText) {
    say('Saving…');
    return window.api('/admin/api/open-access', 'POST', body).then(function (d) {
      $('oa-label').dataset.touched = '';
      render(d, true); say(okText || 'Saved.');
    }).catch(function (e) { say(e.message, true); });
  }
  function toggle(on) {
    var b = form();
    if (on && !b.until && untilChoice === undefined && !$('oa-until').value) b.until = endOfDhakaDay();   // a safe default: the end of today
    if (on && !confirm('Turn on open access? Anyone with the link can use the tools without an account' + (b.until ? ' until ' + new Date(b.until).toLocaleString() : ' until you turn it off') + '.')) return;
    if (!on && !confirm('Turn off open access now? Guests will need to sign in again.')) return;
    b.enabled = on;
    post(b, on ? 'Open access is ON.' : 'Open access is OFF.');
  }

  function wire() {
    if (!$('oa-save')) return;
    $('oa-save').onclick = function () { post(form(), 'Settings saved.'); };
    $('oa-reload').onclick = function () { load(true); };
    ['oa-label', 'oa-message', 'oa-per-hour', 'oa-until'].forEach(function (id) { $(id).addEventListener('input', function () { $('oa-label').dataset.touched = '1'; if (id === 'oa-until') untilChoice = undefined; }); });
    $('oa-scopes').addEventListener('change', function () { $('oa-label').dataset.touched = '1'; });
    $('oa-until-chips').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var h = b.getAttribute('data-h');
      untilChoice = h === 'none' ? null : h === 'eod' ? endOfDhakaDay() : new Date(Date.now() + (+h) * 3600e3).toISOString();
      $('oa-until').value = toLocalInput(untilChoice);
      $('oa-label').dataset.touched = '1';
      Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); });
    });
    $('oa-qr-btn').onclick = function () {
      var url = window.location.origin + '/';
      try { var q = window.qrcode(0, 'M'); q.addData(url); q.make(); $('oa-qr-code').innerHTML = q.createSvgTag({ cellSize: 8, margin: 2, scalable: true }); } catch (_) { $('oa-qr-code').textContent = url; }
      $('oa-qr-title').textContent = (data && data.state.label) || 'KnitAdvisor';
      $('oa-qr-url').textContent = url.replace(/^https?:\/\//, '');
      $('oa-qr').hidden = false;
    };
    $('oa-qr-close').onclick = function () { $('oa-qr').hidden = true; };
    $('oa-qr').addEventListener('click', function (e) { if (e.target === this) this.hidden = true; });
  }

  // admin.js calls this whenever a tab is shown
  window.kaOpenAccessTab = function (visible) {
    clearInterval(timer);
    if (visible) { load(true); timer = setInterval(function () { load(false); }, 15000); }
  };
  wire();
  // the LIVE badge in the sidebar, once signed in
  setTimeout(function () {
    if (!sessionStorage.getItem('adminToken')) return;
    window.api('/admin/api/open-access').then(function (d) { var live = $('sb-open-live'); if (live) live.hidden = !d.state.active; }).catch(function () {});
  }, 1500);
})();
