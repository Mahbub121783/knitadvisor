/**
 * Admin: Subscriptions (plans set by hand) and Usage (what people ask the engines, what they are told, their verdicts).
 * Loaded after admin.js and uses its api(), esc(), toast(), getToken() and renderPagination(). No inline handlers:
 * the admin page runs without 'unsafe-inline' scripts.
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var TZ = 'Asia/Dhaka';
  var fmtDay = function (v) { return v ? new Date(v).toLocaleDateString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }) : '—'; };
  var fmtTime = function (v) { return v ? new Date(v).toLocaleString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; };
  var today = function (back) { return new Date(Date.now() - (back || 0) * 86400000).toLocaleDateString('en-CA', { timeZone: TZ }); };
  var n = function (v) { return v == null ? '—' : Number(v).toLocaleString(); };
  var badge = function (cls, text) { return '<span class="badge badge-' + cls + '">' + esc(text) + '</span>'; };
  var empty = function (cols, text) { return '<tr><td colspan="' + cols + '" style="text-align:center;padding:18px;color:var(--t3);">' + esc(text) + '</td></tr>'; };
  var who = function (r) { return r.full_name || r.email ? esc(r.full_name || r.email) + (r.email && r.full_name ? '<div style="font-size:10px;color:var(--t3);">' + esc(r.email) + (r.company ? ' · ' + esc(r.company) : '') + '</div>' : '') : '<span style="color:var(--t3);">' + (String(r.actor || '').charAt(0) === 'g' ? 'guest ' : '') + esc(String(r.actor || '—').slice(0, 14)) + '</span>'; };

  /* ── one dialog for everything on these two tabs ───────────────────────── */
  function dialog(title, html, buttons) {
    closeDialog();
    var o = document.createElement('div');
    o.className = 'modal-overlay'; o.id = 'ki-modal';
    o.innerHTML = '<div class="modal-box" role="dialog" aria-modal="true" style="width:min(760px,96vw);"><div class="modal-title">' + esc(title) + '</div><div id="ki-body">' + html + '</div><div class="modal-footer"></div></div>';
    var foot = o.querySelector('.modal-footer');
    (buttons || []).concat([{ label: 'Close', cls: 'btn-ghost', run: closeDialog }]).forEach(function (b) {
      var el = document.createElement('button');
      el.type = 'button'; el.className = 'btn ' + (b.cls || 'btn-primary'); el.textContent = b.label;
      el.addEventListener('click', function () { b.run(el); });
      foot.appendChild(el);
    });
    o.addEventListener('click', function (e) { if (e.target === o) closeDialog(); });
    document.body.appendChild(o);
    return o;
  }
  function closeDialog() { var m = $('ki-modal'); if (m) m.remove(); }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDialog(); });

  /* ═══════════════════════ SUBSCRIPTIONS ═══════════════════════ */
  var plans = [], subsPage = 1;
  var planName = function (code) { var p = plans.filter(function (x) { return x.code === code; })[0]; return p ? p.name : code || '—'; };
  var perDay = function (v) { return v == null ? 'unlimited' : n(v) + ' a day'; };
  var length = function (v) { return v == null ? 'no end date' : v + ' days'; };

  async function loadOverview() {
    var d = await api('/admin/api/subs/overview');
    plans = d.plans;
    var s = d.summary || {};
    $('sub-kpis').innerHTML = [['On a plan', s.subscribed, n(s.accounts) + ' accounts in all'], ['Ending within 7 days', s.expiring_7d, 'renew or let end'],
      ['Ended in 30 days', s.expired_30d, 'back on free or student'], ['Verified students', s.students, 'by their own application'], ['Factory work orders', s.factory, 'accounts allowed']]
      .map(function (k) { return '<div class="kpi-card"><div class="kpi-lbl">' + esc(k[0]) + '</div><div class="kpi-val">' + n(k[1]) + '</div><div class="kpi-sub">' + esc(k[2]) + '</div></div>'; }).join('');
    var filterSel = $('sub-filter-plan'), keep = filterSel.value;
    filterSel.innerHTML = '<option value="">Any plan</option>' + plans.map(function (p) { return '<option value="' + esc(p.code) + '">' + esc(p.name) + '</option>'; }).join('');
    filterSel.value = keep;
    var sel = $('sub-plan'), had = sel.value;
    sel.innerHTML = plans.filter(function (p) { return p.active; }).map(function (p) { return '<option value="' + esc(p.code) + '">' + esc(p.name) + ' — ' + esc(perDay(p.daily_limit)) + ', ' + esc(length(p.default_days)) + '</option>'; }).join('');
    sel.value = had && plans.some(function (p) { return p.code === had && p.active; }) ? had : 'mill';
    $('sub-plans').innerHTML = plans.map(planRow).join('') + planRow(null);
    $('sub-recent').innerHTML = d.recent.length ? d.recent.map(function (e) {
      return '<tr><td style="font-family:var(--mono);font-size:10px;">' + esc(fmtTime(e.at)) + '</td><td>' + who(e) + '</td><td>' + esc(describe(e)) + '</td><td style="color:var(--t3);">' + esc(e.note || '') + '</td></tr>';
    }).join('') : empty(4, 'No change yet.');
  }
  function describe(e) {
    if (e.action === 'factory_on') return 'factory work orders switched on';
    if (e.action === 'factory_off') return 'factory work orders switched off';
    if (e.action === 'end') return 'ended ' + planName(e.from_plan);
    var until = e.expires_at ? ' until ' + fmtDay(e.expires_at) : ', no end date';
    if (e.action === 'extend') return 'extended ' + planName(e.to_plan) + until;
    return (e.from_plan ? planName(e.from_plan) + ' → ' : 'set ') + planName(e.to_plan) + until;
  }
  function planRow(p) {
    var v = p || { code: '', name: '', daily_limit: '', default_days: '', rank: '', active: true };
    var inp = function (f, val, w, ph, type) { return '<input class="form-input" data-f="' + f + '" value="' + esc(val == null ? '' : val) + '" placeholder="' + esc(ph || '') + '" type="' + (type || 'text') + '" style="width:' + w + 'px;">'; };
    return '<tr data-plan="' + esc(v.code) + '"><td>' + (p ? '<code>' + esc(v.code) + '</code>' : inp('code', '', 110, 'new_code')) + '</td><td>' + inp('name', v.name, 160, 'Name') + '</td><td>' +
      inp('daily_limit', v.daily_limit, 90, 'unlimited', 'number') + '</td><td>' + inp('default_days', v.default_days, 90, 'no end', 'number') + '</td><td>' + inp('rank', v.rank, 60, '0', 'number') +
      '</td><td><input type="checkbox" data-f="active"' + (v.active ? ' checked' : '') + (v.code === 'free' ? ' disabled' : '') + '></td><td>' + (p ? n(v.users) : '') +
      '</td><td><button type="button" class="btn btn-ghost btn-sm" data-plan-save>' + (p ? 'Save' : 'Add plan') + '</button></td></tr>';
  }
  async function savePlan(tr) {
    var val = function (f) { var e = tr.querySelector('[data-f="' + f + '"]'); return e ? (e.type === 'checkbox' ? e.checked : e.value.trim()) : ''; };
    var code = tr.dataset.plan || val('code');
    if (!code) { toast('Give the new plan a code, e.g. mill_pro', 'error'); return; }
    try {
      await api('/admin/api/plans/' + encodeURIComponent(code), 'PUT', { name: val('name'), daily_limit: val('daily_limit'), default_days: val('default_days'), rank: val('rank'), active: val('active') });
      toast('Plan saved', 'success'); loadOverview(); loadSubs(subsPage);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function loadSubs(page) {
    subsPage = page || 1;
    var p = new URLSearchParams({ page: subsPage, filter: $('sub-filter').value });
    if ($('sub-filter-plan').value) p.set('plan', $('sub-filter-plan').value);
    if ($('sub-search').value.trim()) p.set('search', $('sub-search').value.trim());
    var d = await api('/admin/api/subs?' + p);
    $('sub-tbody').innerHTML = d.rows.length ? d.rows.map(function (u) {
      var now = u.now, left = now.days_left;
      var cls = now.source === 'subscription' ? 'purple' : now.source === 'student' ? 'blue' : now.source === 'paid' ? 'purple' : 'gray';
      var ends = now.ends_at ? esc(fmtDay(now.ends_at)) + '<div style="font-size:10px;color:' + (left <= 7 ? 'var(--a4)' : 'var(--t3)') + ';">' + left + ' day' + (left === 1 ? '' : 's') + ' left</div>'
        : u.set_plan && u.set_until && new Date(u.set_until) <= new Date() ? '<span style="color:var(--a3);">' + esc(planName(u.set_plan)) + ' ended ' + esc(fmtDay(u.set_until)) + '</span>' : now.source === 'subscription' || now.source === 'paid' ? 'no end date' : '—';
      return '<tr><td><input type="checkbox" data-pick="' + u.id + '" data-email="' + esc(u.email) + '" aria-label="Select ' + esc(u.email) + '"></td><td>' + who(u) + (u.email_verified ? '' : ' ' + badge('yellow', 'unverified')) + (u.disabled ? ' ' + badge('red', 'disabled') : '') + '</td><td>' +
        badge(cls, now.name) + (u.plan_interest && now.source === 'free' ? '<div style="font-size:10px;color:var(--t3);">asked about ' + esc(planName(u.plan_interest)) + '</div>' : '') + '</td><td>' + ends + '</td><td>' + esc(perDay(now.daily_limit)) + (u.own_daily_limit != null ? ' <span title="This account\'s own limit" style="color:var(--a2);">*</span>' : '') +
        '</td><td>' + (u.factory_access ? badge('green', 'on') : '<span style="color:var(--t3);">off</span>') + '</td><td style="white-space:nowrap;"><button type="button" class="btn btn-primary btn-sm" data-act="change" data-id="' + u.id + '" data-email="' + esc(u.email) + '">Set plan</button> ' +
        (u.set_plan && u.set_until ? '<button type="button" class="btn btn-ghost btn-sm" data-act="extend" data-id="' + u.id + '" data-email="' + esc(u.email) + '">+ Days</button> ' : '') +
        (u.set_plan || now.source === 'paid' ? '<button type="button" class="btn btn-ghost btn-sm" data-act="end" data-id="' + u.id + '" data-email="' + esc(u.email) + '">End</button> ' : '') +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="more" data-id="' + u.id + '">History</button></td></tr>';
    }).join('') : empty(7, 'No account matches.');
    $('sub-all').checked = false;
    renderPagination('sub-pagination', d.page, d.pages, loadSubs, d.total);
  }

  function assignBody() {
    var mode = $('sub-mode').value;
    var b = { plan: $('sub-plan').value, mode: mode, from: $('sub-from').value, daily_limit: $('sub-own-limit').value.trim(), note: $('sub-note').value.trim(), notify: $('sub-notify').checked };
    if (mode === 'days') b.days = Number($('sub-days').value);
    if (mode === 'until') b.until = $('sub-until').value;
    if ($('sub-factory').value) b.factory_access = $('sub-factory').value === 'on';
    return b;
  }
  async function assign(btn) {
    var b = assignBody();
    b.emails = $('sub-emails').value;
    if (!b.emails.trim()) { toast('Write at least one e-mail, or pick accounts in the table', 'error'); return; }
    var count = b.emails.split(/[\s,;]+/).filter(Boolean).length;
    var p = plans.filter(function (x) { return x.code === b.plan; })[0];
    if (!confirm('Set ' + (p ? p.name : b.plan) + ' on ' + count + ' account' + (count === 1 ? '' : 's') + '?')) return;
    btn.disabled = true;
    try {
      var d = await api('/admin/api/subs/assign', 'POST', b);
      var bad = d.results.filter(function (r) { return !r.ok; });
      $('sub-result').innerHTML = '<b>' + d.changed + ' changed</b>' + d.results.filter(function (r) { return r.ok; }).map(function (r) { return '<div>' + esc(r.email) + ' — ' + esc(r.change) + (r.ends_at ? ', until ' + esc(fmtDay(r.ends_at)) : ', no end date') + (r.mailed === false ? ' (e-mail not sent)' : '') + '</div>'; }).join('') +
        bad.map(function (r) { return '<div style="color:var(--a3);">' + esc(r.email || '#' + r.id) + ' — ' + esc(r.error) + '</div>'; }).join('');
      if (d.changed) { toast(d.changed + ' account(s) updated', 'success'); if (!bad.length) $('sub-emails').value = ''; }
      loadOverview(); loadSubs(subsPage);
    } catch (e) { toast(e.message, 'error'); } finally { btn.disabled = false; }
  }
  function pickInto() {
    var picked = [].slice.call(document.querySelectorAll('#sub-tbody [data-pick]:checked')).map(function (c) { return c.dataset.email; });
    $('sub-emails').value = picked.join('\n');
  }
  function fillFor(email) {
    $('sub-emails').value = email; $('sub-result').innerHTML = '';
    $('sub-give').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('sub-plan').focus();
  }
  function extendDialog(id, email) {
    var o = dialog('Add days — ' + email, '<div class="row" style="margin-bottom:10px;">' + [7, 15, 30, 90, 180, 365].map(function (d) { return '<button type="button" class="btn btn-ghost btn-sm" data-quick="' + d + '">+' + d + '</button>'; }).join('') + '</div>' +
      '<div class="form-row"><div class="form-group"><label class="form-label">Days to add</label><input type="number" min="1" max="3660" class="form-input" id="ki-days" value="30"></div><div class="form-group" style="flex:1;"><label class="form-label">Note (kept in the history)</label><input class="form-input" id="ki-note" maxlength="500"></div></div>' +
      '<label style="display:block;margin-top:10px;font-size:12px;"><input type="checkbox" id="ki-notify"> E-mail the person</label>',
    [{ label: 'Add days', run: async function (btn) {
      btn.disabled = true;
      try { var d = await api('/admin/api/subs/' + id + '/extend', 'POST', { days: Number($('ki-days').value), note: $('ki-note').value.trim(), notify: $('ki-notify').checked }); toast('Now runs until ' + fmtDay(d.user.set_until), 'success'); closeDialog(); loadOverview(); loadSubs(subsPage); }
      catch (e) { toast(e.message, 'error'); btn.disabled = false; }
    } }]);
    o.addEventListener('click', function (e) { var q = e.target.closest('[data-quick]'); if (q) $('ki-days').value = q.dataset.quick; });
  }
  function endDialog(id, email) {
    dialog('End the subscription — ' + email, '<p style="font-size:12px;color:var(--t2);">The account goes back to the free plan at once (or the student plan, if verified). Its saved work stays.</p>' +
      '<div class="form-group"><label class="form-label">Note (kept in the history)</label><input class="form-input" id="ki-note" maxlength="500"></div><label style="display:block;margin-top:10px;font-size:12px;"><input type="checkbox" id="ki-notify"> E-mail the person</label>',
    [{ label: 'End it now', cls: 'btn-danger', run: async function (btn) {
      btn.disabled = true;
      try { await api('/admin/api/subs/' + id + '/end', 'POST', { note: $('ki-note').value.trim(), notify: $('ki-notify').checked }); toast('Subscription ended', 'success'); closeDialog(); loadOverview(); loadSubs(subsPage); }
      catch (e) { toast(e.message, 'error'); btn.disabled = false; }
    } }]);
  }
  async function accountDialog(id) {
    try {
      var d = await api('/admin/api/subs/' + id), u = d.user;
      dialog(u.full_name || u.email, '<p style="font-size:12px;color:var(--t2);line-height:1.8;">' + esc(u.email) + (u.company ? ' · ' + esc(u.company) : '') + '<br>Today: <b>' + esc(u.now.name) + '</b>, ' + esc(perDay(u.now.daily_limit)) + ', ' + n(d.used_today) + ' used today' +
        (u.now.ends_at ? ', until ' + esc(fmtDay(u.now.ends_at)) : '') + (u.note ? '<br>Note: ' + esc(u.note) : '') + '</p>' +
        '<div class="row" style="justify-content:space-between;border-top:1px solid var(--line);padding:10px 0;"><span style="font-size:12px;color:var(--t2);">Answers from the <b>factory work orders</b> (the mill\'s private recipes). Only for you and people you trust; needs a verified e-mail.</span><button type="button" class="btn btn-ghost btn-sm" id="ki-factory">' + (u.factory_access ? 'Switch off' : 'Switch on') + '</button></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>Change</th><th>Note</th></tr></thead><tbody>' + (d.history.length ? d.history.map(function (e) { return '<tr><td style="font-family:var(--mono);font-size:10px;">' + esc(fmtTime(e.at)) + '</td><td>' + esc(describe(e)) + '</td><td style="color:var(--t3);">' + esc(e.note || '') + '</td></tr>'; }).join('') : empty(3, 'No change yet.')) + '</tbody></table></div>',
      [{ label: 'Set plan', run: function () { closeDialog(); switchTab('tab-subs'); fillFor(u.email); } }, { label: 'See activity', cls: 'btn-ghost', run: function () { closeDialog(); showActivity(u.email); } }]);
      $('ki-factory').addEventListener('click', async function () {
        var on = !u.factory_access;
        if (on && !confirm('Let ' + u.email + ' receive answers from the factory work orders?')) return;
        try { await api('/admin/api/subs/' + id + '/factory', 'POST', { on: on }); toast(on ? 'Factory work orders switched on' : 'Switched off', 'success'); accountDialog(id); loadOverview(); loadSubs(subsPage); }
        catch (e) { toast(e.message, 'error'); }
      });
    } catch (e) { toast(e.message, 'error'); }
  }

  function wireSubs() {
    $('sub-apply').addEventListener('click', function () { assign(this); });
    $('sub-mode').addEventListener('change', function () { $('sub-days-wrap').hidden = this.value !== 'days'; $('sub-until-wrap').hidden = this.value !== 'until'; $('sub-from-wrap').hidden = this.value === 'until' || this.value === 'lifetime'; });
    $('sub-until').min = today(-1);
    ['sub-filter', 'sub-filter-plan'].forEach(function (id) { $(id).addEventListener('change', function () { loadSubs(1).catch(fail); }); });
    $('sub-find').addEventListener('click', function () { loadSubs(1).catch(fail); });
    $('sub-search').addEventListener('keydown', function (e) { if (e.key === 'Enter') loadSubs(1).catch(fail); });
    $('sub-all').addEventListener('change', function () { var on = this.checked; document.querySelectorAll('#sub-tbody [data-pick]').forEach(function (c) { c.checked = on; }); pickInto(); });
    $('sub-tbody').addEventListener('change', function (e) { if (e.target.closest('[data-pick]')) pickInto(); });
    $('sub-tbody').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'change') fillFor(b.dataset.email); else if (b.dataset.act === 'extend') extendDialog(b.dataset.id, b.dataset.email);
      else if (b.dataset.act === 'end') endDialog(b.dataset.id, b.dataset.email); else accountDialog(b.dataset.id);
    });
    $('sub-plans').addEventListener('click', function (e) { var b = e.target.closest('[data-plan-save]'); if (b) savePlan(b.closest('tr')); });
  }

  /* ═══════════════════════ USAGE ═══════════════════════ */
  var events = [], verdicts = [];
  var range = function () { return new URLSearchParams({ from: $('use-from').value, to: $('use-to').value }); };
  var VERDICT = { right: 'green', close: 'yellow', wrong: 'red' };
  var asked = function (r) { var i = r.input || {}, t = i.target || {}, a = r.result || {}; return [a.structure || a.fabric || i.fabric || i.template, (t.gsm || i.gsm) ? (t.gsm || i.gsm) + ' GSM' : null, t.composition || i.composition].filter(Boolean).join(' · ') || '—'; };
  var answered = function (a) { a = a || {}; var bits = [a.count, a.sl_mm ? a.sl_mm + ' mm' : null, a.gauge ? a.gauge + ' GG' : null, a.gsm && !a.fabric ? a.gsm + ' GSM' : null]; var s = bits.filter(Boolean).join(' · '); return s ? s + (a.by ? ' (' + a.by + ')' : '') : a.error || (Object.keys(a).slice(0, 3).map(function (k) { return k + ': ' + String(a[k]).slice(0, 20); }).join(', ')) || '—'; };

  async function loadUsage(page) {
    var p = range();
    var o = await api('/admin/api/usage/overview?' + p);
    $('use-off').hidden = o.recording !== false;
    var t = o.totals || {}, f = o.feedback || {};
    var by = (o.answered || []).map(function (a) { return a.by + ' ' + n(a.requests); }).join(' · ');
    $('use-kpis').innerHTML = [['Requests', t.requests, n(t.calls) + ' calls with repeats'], ['People', t.people, n(t.accounts) + ' signed in'], ['Failed', t.failed, t.requests ? Math.round(100 * t.failed / t.requests) + '% of requests' : ''],
      ['Verdicts', f.total, 'right ' + n(f.right) + ' · close ' + n(f.close) + ' · wrong ' + n(f.wrong)], ['Answered by', (o.answered || []).reduce(function (s, a) { return s + a.requests; }, 0), by || 'calculator and Studio']]
      .map(function (k) { return '<div class="kpi-card"><div class="kpi-lbl">' + esc(k[0]) + '</div><div class="kpi-val">' + n(k[1]) + '</div><div class="kpi-sub">' + esc(k[2]) + '</div></div>'; }).join('');
    var tool = $('use-tool'), keep = tool.value;
    tool.innerHTML = '<option value="">All tools</option>' + o.tools.map(function (x) { return '<option>' + esc(x.tool) + '</option>'; }).join('');
    tool.value = keep;
    $('use-tools').innerHTML = o.tools.length ? o.tools.map(function (x) { return '<tr><td>' + esc(x.tool) + '</td><td>' + n(x.requests) + '</td><td>' + n(x.people) + '</td><td>' + (x.failed ? '<span style="color:var(--a3);">' + n(x.failed) + '</span>' : '0') + '</td></tr>'; }).join('') : empty(4, 'Nothing in these days.');
    $('use-fails').innerHTML = o.failures.length ? o.failures.map(function (x) { return '<tr><td>' + esc(x.tool) + '</td><td>' + esc(x.error || 'HTTP ' + x.status) + '</td><td>' + n(x.times) + '</td><td>' + n(x.people) + '</td></tr>'; }).join('') : empty(4, 'No failure.');
    $('use-people').innerHTML = o.people.length ? o.people.map(function (x) { return '<tr><td>' + who(x) + '</td><td>' + n(x.requests) + '</td><td>' + n(x.tools) + '</td><td style="font-size:10px;">' + esc(fmtTime(x.last_at)) + '</td></tr>'; }).join('') : empty(4, 'No signed-in use.');
    await Promise.all([loadVerdicts(), loadEvents(page || 1)]);
  }
  async function loadVerdicts() {
    var p = range();
    if ($('use-verdict').value) p.set('verdict', $('use-verdict').value);
    verdicts = (await api('/admin/api/usage/feedback?' + p)).rows;
    $('use-feedback').innerHTML = verdicts.length ? verdicts.map(function (r, i) {
      var a = r.actual || {};
      var floor = [a.count, a.yarn, a.sl ? a.sl + ' mm' : null, a.gauge ? a.gauge + ' GG' : null, a.dia ? a.dia + '"' : null, a.gsm ? a.gsm + ' GSM' : null].filter(Boolean).join(' · ');
      return '<tr><td style="font-size:10px;">' + esc(fmtTime(r.created_at)) + '</td><td>' + who(r) + '</td><td>' + badge(VERDICT[r.verdict], r.verdict) + '</td><td>' + esc(asked({ input: r.input, result: r.shown })) + '</td><td>' + esc(answered(r.shown)) + '</td><td>' + esc(floor || '—') + (r.note ? '<div style="color:var(--t3);font-size:10px;">' + esc(r.note) + '</div>' : '') +
        '</td><td style="white-space:nowrap;"><button type="button" class="btn btn-ghost btn-sm" data-fb="' + i + '">View</button> <label style="font-size:10px;"><input type="checkbox" data-handled="' + r.id + '"' + (r.handled ? ' checked' : '') + '> dealt with</label></td></tr>';
    }).join('') : empty(7, 'No verdict yet. People give them under an answer in the calculator and the Studio.');
  }
  async function loadEvents(page) {
    var p = range(); p.set('page', page);
    if ($('use-tool').value) p.set('tool', $('use-tool').value);
    if ($('use-search').value.trim()) p.set('search', $('use-search').value.trim());
    if ($('use-errors').checked) p.set('errors', '1');
    var d = await api('/admin/api/usage/events?' + p);
    events = d.rows;
    $('use-events').innerHTML = d.rows.length ? d.rows.map(function (r, i) {
      return '<tr><td style="font-size:10px;white-space:nowrap;">' + esc(fmtTime(r.last_at)) + '</td><td>' + who(r) + (r.plan ? '<div style="font-size:10px;color:var(--t3);">' + esc(r.plan) + '</div>' : '') + '</td><td>' + esc(r.tool) + (r.runs + r.steps > 2 ? '<div style="font-size:10px;color:var(--t3);">' + (r.steps > 1 ? r.steps + ' changes' : '') + (r.runs > 1 ? ' ' + r.runs + ' times' : '') + '</div>' : '') +
        '</td><td>' + esc(asked(r)) + '</td><td>' + (r.ok ? esc(answered(r.result)) : '<span style="color:var(--a3);">' + esc(r.error || 'failed') + '</span>') + '</td><td><button type="button" class="btn btn-ghost btn-sm" data-ev="' + i + '">View</button></td></tr>';
    }).join('') : empty(6, 'No request matches.');
    renderPagination('use-pagination', d.page, d.pages, function (pg) { loadEvents(pg).catch(fail); }, d.total);
  }
  var pre = function (title, v) { return '<div class="form-label" style="margin-top:10px;">' + esc(title) + '</div><pre style="background:var(--bg3);border:1px solid var(--line);border-radius:6px;padding:10px;font-size:11px;overflow:auto;max-height:34vh;white-space:pre-wrap;">' + esc(JSON.stringify(v, null, 2)) + '</pre>'; };
  async function download(format, btn) {
    var p = range(); p.set('format', format);
    if ($('use-identify').checked) p.set('identify', '1');
    btn.disabled = true;
    try {
      var res = await fetch('/admin/api/usage/export?' + p, { headers: { 'X-Admin-Token': getToken() || '' } });
      if (!res.ok) throw new Error('The export failed (' + res.status + ').');
      var name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
      var a = document.createElement('a');
      a.href = URL.createObjectURL(await res.blob());
      a.download = name ? name[1] : 'knitadvisor-usage';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      toast('Downloaded ' + a.download, 'success');
    } catch (e) { toast(e.message, 'error'); } finally { btn.disabled = false; }
  }
  function setRange(from, to) { $('use-from').value = from; $('use-to').value = to; loadUsage(1).catch(fail); }
  function showActivity(email) { switchTab('tab-usage'); $('use-from').value = today(29); $('use-to').value = today(); $('use-search').value = email; loadUsage(1).catch(fail); }
  function wireUsage() {
    $('use-from').value = today(); $('use-to').value = today();
    $('use-today').addEventListener('click', function () { setRange(today(), today()); });
    $('use-yesterday').addEventListener('click', function () { setRange(today(1), today(1)); });
    $('use-week').addEventListener('click', function () { setRange(today(6), today()); });
    $('use-reload').addEventListener('click', function () { loadUsage(1).catch(fail); });
    ['use-from', 'use-to'].forEach(function (id) { $(id).addEventListener('change', function () { loadUsage(1).catch(fail); }); });
    ['use-tool', 'use-errors'].forEach(function (id) { $(id).addEventListener('change', function () { loadEvents(1).catch(fail); }); });
    $('use-search').addEventListener('keydown', function (e) { if (e.key === 'Enter') loadEvents(1).catch(fail); });
    $('use-verdict').addEventListener('change', function () { loadVerdicts().catch(fail); });
    document.querySelectorAll('[data-export]').forEach(function (b) { b.addEventListener('click', function () { download(b.dataset.export, b); }); });
    $('use-events').addEventListener('click', function (e) { var b = e.target.closest('[data-ev]'); if (!b) return; var r = events[+b.dataset.ev]; dialog(r.tool + ' — ' + fmtTime(r.last_at), '<div style="font-size:12px;color:var(--t2);">' + who(r) + (r.ms != null ? ' · ' + r.ms + ' ms' : '') + '</div>' + pre('Asked', r.input) + pre('Answered', r.result)); });
    $('use-feedback').addEventListener('click', function (e) { var b = e.target.closest('[data-fb]'); if (!b) return; var r = verdicts[+b.dataset.fb]; dialog('Verdict: ' + r.verdict, '<div style="font-size:12px;color:var(--t2);">' + who(r) + '</div>' + pre('What their floor runs', r.actual) + (r.note ? pre('Their note', r.note) : '') + pre('Shown to them', r.shown) + pre('Asked', r.input)); });
    $('use-feedback').addEventListener('change', async function (e) { var c = e.target.closest('[data-handled]'); if (!c) return; try { await api('/admin/api/usage/feedback/' + c.dataset.handled, 'PATCH', { handled: c.checked }); } catch (x) { toast(x.message, 'error'); c.checked = !c.checked; } });
  }

  function fail(e) { toast(e.message, 'error'); }
  var wired = false;
  window.kaInsightsTab = function (tab) {
    if (tab !== 'tab-subs' && tab !== 'tab-usage') return;
    if (!wired) { wired = true; wireSubs(); wireUsage(); }
    if (tab === 'tab-subs') loadOverview().then(function () { return loadSubs(subsPage); }).catch(fail);
    else loadUsage(1).catch(fail);
  };
  /** From the Users tab: the account's subscription. */
  window.kaSubscriptionFor = function (id) { switchTab('tab-subs'); closeDialog(); accountDialog(id); };
})();
