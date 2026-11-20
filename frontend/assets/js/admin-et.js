/**
 * Admin — the Emerging Textiles dashboard.
 *
 * The admin pastes the API key once. The dashboard then lays the subscription out the way the publisher's own menu does
 * (Cotton, Polyester, Viscose & Lyocell, Nylon & Spandex, Wool & Other Fibers, Apparel & Trade; each a price database and price
 * reports, fibres and yarns, a sustainable list under each), shows the latest value, the change and a trend for every table,
 * opens any table in full, and lets a table whose columns are yarn counts feed costing.
 *
 * Uses the page's api() and esc(). The key is never read back: the server returns only its last four characters.
 */
(function () {
  'use strict';
  var D = null, cat = 'cotton', busy = false;
  (function () { if (document.getElementById('et-css')) return; var st = document.createElement('style'); st.id = 'et-css'; st.textContent = '#et-root .input,#et-modal .input{box-sizing:border-box;padding:7px 10px;border:1px solid var(--line,#d8dce3);border-radius:7px;background:var(--bg1,#fff);color:var(--t1,#111);font:12px/1.3 var(--sans,inherit);min-width:0}#et-root .input:focus,#et-modal .input:focus{outline:2px solid var(--a1,#1857c4);outline-offset:-1px}#et-root .et-row:hover{background:var(--bg3,#f3f4f6)}'; document.head.appendChild(st); })();
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (v) { return v == null ? '—' : (Math.abs(v) >= 100 ? v.toFixed(1) : Math.abs(v) >= 10 ? v.toFixed(2) : v.toFixed(3)).replace(/\.?0+$/, ''); };
  var ago = function (iso) {
    if (!iso) return 'never';
    var m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    return m < 2 ? 'just now' : m < 90 ? m + ' min ago' : m < 2880 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago';
  };
  var chip = function (text, tone) {
    var c = { good: '#1E7A54', bad: '#B23B3B', warn: '#9A5B00', mute: 'var(--t3)' }[tone || 'mute'];
    return '<span style="display:inline-block;border:1px solid ' + c + '55;background:' + c + '14;color:' + c + ';border-radius:999px;padding:1px 8px;font-size:10px;font-weight:600;">' + esc(text) + '</span>';
  };
  var spark = function (pts, w, h, colour) {
    if (!pts || pts.length < 2) return '';
    var lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts), rg = hi - lo || 1;
    var d = pts.map(function (v, i) { return (i ? 'L' : 'M') + (i * (w - 2) / (pts.length - 1) + 1).toFixed(1) + ' ' + (h - 2 - (v - lo) / rg * (h - 4)).toFixed(1); }).join(' ');
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" style="vertical-align:middle"><path d="' + d + '" fill="none" stroke="' + (colour || '#1E7A54') + '" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  };
  var delta = function (p) {
    if (p == null) return '<span style="color:var(--t3)">—</span>';
    var c = p > 0 ? '#1E7A54' : p < 0 ? '#B23B3B' : 'var(--t3)';
    return '<span style="color:' + c + ';font-variant-numeric:tabular-nums">' + (p > 0 ? '▲ +' : p < 0 ? '▼ ' : '') + p + '%</span>';
  };
  function note(html, tone) {
    var el = $('et-note'); if (!el) return;
    if (!html) { el.innerHTML = ''; return; }
    var c = { good: '#1E7A54', bad: '#B23B3B', warn: '#9A5B00' }[tone || 'good'];
    el.innerHTML = '<div style="border:1px solid ' + c + '55;background:' + c + '12;border-radius:8px;padding:9px 12px;font-size:11px;line-height:1.6;margin-bottom:12px">' + html + '</div>';
  }
  async function act(btn, label, fn) {
    if (busy) return; busy = true;
    var was = btn && btn.textContent; if (btn) { btn.disabled = true; btn.textContent = label; }
    try { await fn(); } catch (e) { note(esc(e.message), 'bad'); }
    finally { busy = false; if (btn) { btn.disabled = false; btn.textContent = was; } }
  }

  // ── connection ────────────────────────────────────────────────────────────────────────────────────────────
  function connectionHtml(st) {
    if (!st.has_key) {
      return '<div style="font-size:12px;font-weight:700;margin-bottom:4px">Connect your Emerging Textiles subscription</div>' +
        '<div style="font-size:11px;color:var(--t2);line-height:1.6;margin-bottom:10px">Paste the API key from your Emerging Textiles account (Corporate plan). It is kept sealed on the server and is never shown again, only its last four characters. Once it is saved, press <b>Find my tables</b>: the dashboard lays your subscription out like the Emerging Textiles menu and starts keeping every price.</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap"><input id="et-key" type="password" autocomplete="off" spellcheck="false" class="input" placeholder="API key" style="flex:1;min-width:260px">' +
        '<button id="et-save" class="btn btn-sm" style="background:var(--a1);color:#fff;font-weight:700">Save key</button></div>';
    }
    var tone = st.test_ok === true ? 'good' : st.test_ok === false ? 'bad' : 'mute';
    return '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
      '<span style="font-size:12px;font-weight:700">Emerging Textiles</span>' + chip(st.test_ok === true ? 'connected' : st.test_ok === false ? 'refused' : 'key saved, not tested', tone) +
      '<span style="font-size:11px;color:var(--t3)">key ····' + esc(st.key_last4 || '') + ' · ' + esc(st.key_from || '') + (st.saved_at ? ' · saved ' + ago(st.saved_at) : '') + '</span>' +
      '<span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">' +
      '<button id="et-test" class="btn btn-ghost btn-sm">Test key</button>' +
      '<button id="et-discover" class="btn btn-ghost btn-sm">Find my tables</button>' +
      '<button id="et-paste" class="btn btn-ghost btn-sm">Paste endpoints</button>' +
      '<button id="et-refresh" class="btn btn-sm" style="background:var(--a1);color:#fff;font-weight:700">Refresh everything</button>' +
      '<button id="et-replace" class="btn btn-ghost btn-sm">Replace key</button></span></div>' +
      (st.test_note ? '<div style="font-size:10px;color:var(--t3);margin-top:6px">' + esc(st.test_note) + (st.tested_at ? ' (' + ago(st.tested_at) + ')' : '') + '</div>' : '') +
      '<div id="et-replace-box" style="margin-top:10px;display:none;gap:8px;flex-wrap:wrap"><input id="et-key" type="password" autocomplete="off" spellcheck="false" class="input" placeholder="New API key" style="flex:1;min-width:260px"><button id="et-save" class="btn btn-sm" style="background:var(--a1);color:#fff">Save</button><button id="et-remove" class="btn btn-ghost btn-sm" style="color:#B23B3B">Remove key</button></div>';
  }

  // ── a slot or a table of the menu ─────────────────────────────────────────────────────────────────────────
  function rowHtml(item, isSlot) {
    var t = isSlot ? item.table : item;
    var title = esc(item.title || (t && t.title) || '');
    var country = (item.country || (t && t.country)) ? '<span style="font-size:9px;border:1px solid var(--line);border-radius:4px;padding:0 5px;margin-left:6px;color:var(--t3)">' + esc(item.country || t.country) + '</span>' : '';
    if (!t) {
      return '<div class="et-row" style="display:flex;align-items:center;gap:8px;padding:7px 2px;border-bottom:1px solid var(--line);opacity:.62"><div style="flex:1;font-size:11px">' + title + country + '</div>' +
        '<span style="font-size:10px;color:var(--t3)">not found in your subscription</span>' +
        '<button class="btn btn-ghost btn-sm et-map" data-slot="' + esc(item.id) + '" data-title="' + esc(item.title) + '" data-cat="' + esc(item.category) + '" data-country="' + esc(item.country || '') + '" style="font-size:10px;padding:1px 8px">Add</button></div>';
    }
    var h = t.headline;
    var state = t.last_ok === false ? chip('failed', 'bad') : t.mapping ? chip('feeds costing', 'good') : '';
    return '<div class="et-row et-open" data-id="' + t.id + '" style="display:flex;align-items:center;gap:8px;padding:7px 2px;border-bottom:1px solid var(--line);cursor:pointer' + (t.enabled ? '' : ';opacity:.55') + '">' +
      '<div style="flex:1;min-width:0"><div style="font-size:11px;font-weight:600;color:var(--t1)">' + title + country + '</div>' +
      '<div style="font-size:9px;color:var(--t3)">' + (t.fetched_at ? 'updated ' + ago(t.fetched_at) + ' · ' + t.row_count + ' rows' : 'not fetched yet') + (t.last_ok === false ? ' · ' + esc((t.last_error || '').slice(0, 70)) : '') + '</div></div>' +
      (h ? '<div style="text-align:right"><div style="font-size:12px;font-weight:700;font-variant-numeric:tabular-nums">' + fmt(h.latest) + '</div><div style="font-size:9px">' + delta(h.change_pct) + '</div></div><div>' + spark(h.spark, 70, 22, h.change_pct < 0 ? '#B23B3B' : '#1E7A54') + '</div>' : '') +
      '<div>' + state + '</div></div>';
  }

  function menuHtml(c) {
    var groups = {};
    ['database', 'report'].forEach(function (kind) {
      c.slots.filter(function (s) { return s.kind === kind; }).forEach(function (s) {
        var key = kind + '|' + s.group + '|' + (s.sustainable ? 1 : 0);
        (groups[key] = groups[key] || { kind: kind, group: s.group, sust: s.sustainable, items: [] }).items.push(s);
      });
    });
    var col = function (kind, label) {
      var gs = Object.keys(groups).map(function (k) { return groups[k]; }).filter(function (g) { return g.kind === kind; });
      gs.sort(function (a, b) { return (a.sust - b.sust) || (a.group < b.group ? -1 : 1); });
      return '<div style="flex:1;min-width:300px"><div style="font-size:10px;letter-spacing:.8px;font-weight:700;color:var(--t2);margin-bottom:6px">' + label + '</div>' +
        gs.map(function (g) {
          return '<div style="margin-bottom:12px"><div style="font-size:10px;font-weight:700;color:' + (g.sust ? '#1E7A54' : 'var(--t2)') + ';border-bottom:' + (g.sust ? '2px solid #1E7A5455' : '1px solid var(--line)') + ';padding-bottom:3px;margin-bottom:2px">' + (g.sust ? 'Sustainable · ' : '') + esc(g.group) + '</div>' +
            g.items.map(function (s) { return rowHtml(s, true); }).join('') + '</div>';
        }).join('') + '</div>';
    };
    var extra = c.extra && c.extra.length ? '<div style="margin-top:6px"><div style="font-size:10px;letter-spacing:.8px;font-weight:700;color:var(--t2);margin-bottom:6px">OTHER TABLES IN YOUR SUBSCRIPTION</div>' + c.extra.map(function (t) { return rowHtml(t, false); }).join('') + '</div>' : '';
    return '<div style="display:flex;gap:24px;flex-wrap:wrap">' + (c.slots.length ? col('database', 'PRICE DATABASE') + col('report', 'PRICE REPORTS') : '') + '</div>' + extra;
  }

  function render() {
    var el = $('et-root'); if (!el || !D) return;
    var st = D.status, tt = D.totals;
    var tabs = D.categories.filter(function (c) { return c.id !== 'other' || c.extra.length; }).map(function (c) {
      var n = c.slots.filter(function (s) { return s.table; }).length + c.extra.length;
      return '<button class="et-cat" data-cat="' + c.id + '" style="border:0;background:' + (c.id === cat ? 'var(--a1)' : 'transparent') + ';color:' + (c.id === cat ? '#fff' : 'var(--t1)') + ';padding:8px 14px;font-size:12px;font-weight:600;cursor:pointer;border-radius:6px 6px 0 0">' + esc(c.label) + (n ? ' <span style="opacity:.7;font-size:10px">' + n + '</span>' : '') + '</button>';
    }).join('');
    var cur = D.categories.filter(function (c) { return c.id === cat; })[0] || D.categories[0];
    el.innerHTML =
      '<div id="et-note"></div>' +
      '<div class="card" style="padding:14px 16px;margin-bottom:14px">' + connectionHtml(st) + '</div>' +
      (st.has_key ? '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">' +
        [['Tables', tt.tables], ['Enabled', tt.enabled], ['Fetched', tt.fetched], ['Feeding costing', tt.costing], ['Failing', tt.failing]].map(function (k) {
          return '<div class="stat-card" style="flex:1;min-width:110px"><div class="stat-val" style="' + (k[0] === 'Failing' && k[1] ? 'color:#B23B3B' : '') + '">' + k[1] + '</div><div class="stat-lbl">' + k[0] + '</div></div>';
        }).join('') + '</div>' +
        (tt.tables ? '' : '<div class="card" style="padding:14px 16px;margin-bottom:14px;border-color:#9A5B0055"><div style="font-size:12px;font-weight:700;margin-bottom:4px">Next: tell the dashboard which tables you have</div><div style="font-size:11px;color:var(--t2);line-height:1.7">Emerging Textiles has no public list of tables: it gives each subscriber their own API endpoints (in the activation email, and as the <b>API / Excel</b> link on each table of your account). Press <b>Paste endpoints</b> and paste them, one per line, in any of these forms:<br><code>https://api.emergingtextiles.com/api/sheets/Bangladesh-Yarn-Prices_Weekly/cotton-yarn-indicator</code><br><code>https://api.emergingtextiles.com/api/csv/…/…?api_key=…</code> (the key inside is dropped, never stored)<br><code>dataset/sheet</code><br>The dashboard files each one on the right shelf of the menu and fetches it. If the email did not come, ask Emerging Textiles support for "the API endpoint list for my Corporate subscription".</div></div>') +
        '<div style="display:flex;gap:8px;margin-bottom:10px"><input id="et-find" class="input" placeholder="Find a price: e.g. bangladesh combed, polyester india, viscose…" style="flex:1"><button id="et-add" class="btn btn-ghost btn-sm">Add a table by hand</button></div><div id="et-found"></div>' +
        '<div class="card" style="padding:0 16px 14px"><div style="display:flex;gap:2px;flex-wrap:wrap;border-bottom:2px solid var(--a1);margin:0 -16px 14px;padding:0 10px;background:var(--bg3)">' + tabs + '</div>' + menuHtml(cur) + '</div>' : '');
    bind();
  }

  // ── a table in full ───────────────────────────────────────────────────────────────────────────────────────
  function modal(html) {
    var m = $('et-modal');
    if (!m) { m = document.createElement('div'); m.id = 'et-modal'; m.style.cssText = 'position:fixed;inset:0;background:#0007;z-index:1000;display:flex;align-items:flex-start;justify-content:center;padding:4vh 16px;overflow:auto'; document.body.appendChild(m); m.addEventListener('click', function (e) { if (e.target === m) m.remove(); }); }
    m.innerHTML = '<div style="background:var(--bg1,#fff);color:var(--t1);border-radius:12px;max-width:980px;width:100%;padding:18px 20px;box-shadow:0 20px 60px #0005">' + html + '</div>';
    return m;
  }
  function csvOf(header, rows) {
    var q = function (c) { c = String(c == null ? '' : c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; };
    return [header].concat(rows).map(function (r) { return r.map(q).join(','); }).join('\n');
  }
  async function openTable(id) {
    modal('<div style="color:var(--t3);font-size:12px">Loading…</div>');
    var r = await api('/admin/api/et/tables/' + id);
    var t = r.table, s = r.snapshot, sm = r.summary;
    var cards = sm ? sm.series.slice(0, 12).map(function (x) {
      return '<div style="border:1px solid var(--line);border-radius:8px;padding:8px 10px;min-width:150px;flex:1"><div style="font-size:10px;color:var(--t3)">' + esc(x.column) + '</div><div style="font-size:16px;font-weight:700;font-variant-numeric:tabular-nums">' + fmt(x.latest) + '</div>' +
        '<div style="font-size:10px">' + delta(x.change_pct) + ' <span style="color:var(--t3)">vs previous · 52 pts ' + (x.change_52_pct == null ? '—' : x.change_52_pct + '%') + '</span></div><div>' + spark(x.spark, 150, 28, x.change_pct < 0 ? '#B23B3B' : '#1E7A54') + '</div></div>';
    }).join('') : '';
    var rows = s ? s.rows.slice(-120).reverse() : [];
    var grid = s ? '<div style="overflow:auto;max-height:300px;border:1px solid var(--line);border-radius:8px;margin-top:12px"><table class="data-table" style="width:100%;font-size:11px"><thead><tr>' + s.header.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r2) { return '<tr>' + r2.map(function (c) { return '<td style="font-variant-numeric:tabular-nums">' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' : '<div style="color:var(--t3);font-size:12px;margin-top:10px">This table has not been fetched yet. Press Refresh.</div>';
    var mapped = t.mapping;
    var numCols = sm ? sm.series.map(function (x) { return x.column; }) : [];
    var sug = (r.suggestions && r.suggestions[0]) || null;
    var cur = mapped && mapped.columns ? mapped.columns : mapped && mapped.item_key ? [{ column: numCols[0] || '', item_key: mapped.item_key, count_ne: mapped.count_ne }] : [];
    var keys = D.costing_keys;
    var mapRows = (cur.length ? cur : (sug ? sug.columns : [])).concat([{}]).map(function (m, i) {
      return '<div class="et-maprow" style="display:flex;gap:6px;margin-bottom:5px"><select class="input et-m-col" style="flex:2"><option value="">column…</option>' + numCols.map(function (c) { return '<option' + (m.column === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
        '<select class="input et-m-key" style="flex:2"><option value="">product…</option>' + keys.map(function (k) { return '<option' + (m.item_key === k ? ' selected' : '') + '>' + k + '</option>'; }).join('') + '</select>' +
        '<input class="input et-m-ne" type="number" min="4" max="120" placeholder="Ne" value="' + (m.count_ne || '') + '" style="width:80px"></div>';
    }).join('');
    modal(
      '<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><div style="font-size:15px;font-weight:700">' + esc(t.title) + '</div>' + (t.country ? chip(t.country) : '') + (mapped ? chip('feeds costing', 'good') : '') +
      '<span style="margin-left:auto;font-size:10px;color:var(--t3)">' + esc(t.dataset) + ' / ' + esc(t.sheet) + '</span></div>' +
      '<div style="font-size:10px;color:var(--t3);margin:2px 0 12px">' + (s ? 'updated ' + ago(s.fetched_at) + ' · ' + s.row_count + ' rows' : 'not fetched') + (t.last_ok === false ? ' · <span style="color:#B23B3B">' + esc(t.last_error || 'failed') + '</span>' : '') + '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' + cards + '</div>' + grid +
      '<div style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px"><div style="font-size:12px;font-weight:700;margin-bottom:4px">Use in costing (yarn prices)</div>' +
      '<div style="font-size:10px;color:var(--t3);margin-bottom:8px;line-height:1.5">Only for a table priced in <b>USD per kg</b> with one column per yarn count. Each column becomes a quote for the product and count you choose; the newest price per count goes into the same list as every other source (fresher wins, a same-day tie goes to Emerging Textiles).' + (sug ? ' <b style="color:#1E7A54">Suggestion: ' + sug.columns.length + ' columns read as yarn counts.</b>' : '') + '</div>' + mapRows +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button class="btn btn-sm et-m-save" style="background:var(--a1);color:#fff">Save costing mapping</button>' + (mapped ? '<button class="btn btn-ghost btn-sm et-m-clear">Stop feeding costing</button>' : '') + '</div></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:14px;border-top:1px solid var(--line);padding-top:12px">' +
      '<button class="btn btn-sm et-t-refresh" style="background:var(--a1);color:#fff">Refresh this table</button>' +
      (s ? '<button class="btn btn-ghost btn-sm et-t-csv">Download CSV</button>' : '') +
      '<button class="btn btn-ghost btn-sm et-t-toggle">' + (t.enabled ? 'Pause daily updates' : 'Resume daily updates') + '</button>' +
      '<button class="btn btn-ghost btn-sm et-t-del" style="color:#B23B3B">Remove</button><button class="btn btn-ghost btn-sm et-t-close" style="margin-left:auto">Close</button></div>');
    var m = $('et-modal');
    var q = function (sel) { return m.querySelector(sel); };
    q('.et-t-close').onclick = function () { m.remove(); };
    q('.et-t-refresh').onclick = function (e) { act(e.target, 'Fetching…', async function () { await api('/admin/api/et/tables/' + id + '/refresh', 'POST'); await load(); await openTable(id); }); };
    if (q('.et-t-csv')) q('.et-t-csv').onclick = function () { var b = new Blob([csvOf(s.header, s.rows)], { type: 'text/csv' }), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = (t.sheet || 'table') + '.csv'; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000); };
    q('.et-t-toggle').onclick = function () { act(null, '', async function () { await api('/admin/api/et/tables/' + id, 'PATCH', { enabled: !t.enabled }); await load(); await openTable(id); }); };
    q('.et-t-del').onclick = function () { if (!confirm('Remove this table and its stored copy? (Quotes already stored for costing stay.)')) return; act(null, '', async function () { await api('/admin/api/et/tables/' + id, 'DELETE'); m.remove(); await load(); }); };
    if (q('.et-m-clear')) q('.et-m-clear').onclick = function () { act(null, '', async function () { await api('/admin/api/et/tables/' + id, 'PATCH', { mapping: null }); await load(); await openTable(id); }); };
    q('.et-m-save').onclick = function () {
      var cols = Array.prototype.map.call(m.querySelectorAll('.et-maprow'), function (r2) { return { column: r2.querySelector('.et-m-col').value, item_key: r2.querySelector('.et-m-key').value, count_ne: +r2.querySelector('.et-m-ne').value }; }).filter(function (x) { return x.column && x.item_key && x.count_ne; });
      if (!cols.length) { alert('Choose a column, a product and a count.'); return; }
      act(null, '', async function () { await api('/admin/api/et/tables/' + id, 'PATCH', { mapping: { columns: cols } }); await load(); await openTable(id); note('Saved. The next daily update (or Refresh everything) puts these prices into costing.'); });
    };
  }

  function addModal(pre) {
    pre = pre || {};
    modal('<div style="font-size:14px;font-weight:700;margin-bottom:8px">Add a table</div>' +
      '<div style="font-size:11px;color:var(--t2);line-height:1.6;margin-bottom:10px">The dataset and the sheet are the two names in the table\'s API address: <code>…/api/sheets/<b>{dataset}</b>/<b>{sheet}</b></code> (they are shown in the API / Excel link of the table on the Emerging Textiles site).</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><input id="am-ds" class="input" placeholder="dataset" style="flex:1;min-width:220px"><input id="am-sh" class="input" placeholder="sheet" style="flex:1;min-width:200px"></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><input id="am-title" class="input" placeholder="title" value="' + esc(pre.title || '') + '" style="flex:2;min-width:200px"><select id="am-cat" class="input" style="flex:1">' + D.categories.map(function (c) { return '<option value="' + c.id + '"' + (c.id === (pre.cat || cat) ? ' selected' : '') + '>' + esc(c.label) + '</option>'; }).join('') + '</select><input id="am-country" class="input" placeholder="country" maxlength="2" value="' + esc(pre.country || '') + '" style="width:80px"></div>' +
      '<div id="am-out" style="font-size:11px;margin-top:10px"></div>' +
      '<div style="display:flex;gap:6px;margin-top:12px"><button id="am-test" class="btn btn-ghost btn-sm">Test first</button><button id="am-go" class="btn btn-sm" style="background:var(--a1);color:#fff">Add and fetch</button><button class="btn btn-ghost btn-sm" id="am-x" style="margin-left:auto">Cancel</button></div>');
    var m = $('et-modal');
    var val = function () { return { dataset: $('am-ds').value.trim(), sheet: $('am-sh').value.trim(), title: $('am-title').value.trim(), category: $('am-cat').value, country: $('am-country').value.trim(), catalogue_id: pre.slot || null }; };
    $('am-x').onclick = function () { m.remove(); };
    $('am-test').onclick = function (e) { var v = val(); if (!v.dataset || !v.sheet) { $('am-out').textContent = 'Give the dataset and the sheet.'; return; } act(e.target, 'Asking…', async function () { var r = await api('/admin/api/yarn-prices/et-probe', 'POST', { dataset: v.dataset, sheet: v.sheet }); $('am-out').innerHTML = r.ok ? '<span style="color:#1E7A54">Works: ' + r.table.row_count + ' rows · columns: ' + r.table.columns.map(esc).join(' | ') + '</span>' : '<span style="color:#B23B3B">' + esc(r.error) + '</span>'; }); };
    $('am-go').onclick = function (e) { var v = val(); if (!v.dataset || !v.sheet) { $('am-out').textContent = 'Give the dataset and the sheet.'; return; }
      act(e.target, 'Adding…', async function () { var r = await api('/admin/api/et/tables', 'POST', v); try { await api('/admin/api/et/tables/' + r.table.id + '/refresh', 'POST'); } catch (er) { /* shown on the table */ } m.remove(); await load(); }); };
  }

  function pasteModal() {
    modal('<div style="font-size:14px;font-weight:700;margin-bottom:6px">Paste your Emerging Textiles endpoints</div>' +
      '<div style="font-size:11px;color:var(--t2);line-height:1.7;margin-bottom:8px">One per line: the API link of a table (the <code>/api/sheets/…</code> JSON form or the <code>/api/csv/…</code> CSV form) or <code>dataset/sheet</code>. They come from the activation email, or from the <b>API / Excel</b> link of each table in your account. An <code>api_key=…</code> inside a link is dropped: the key you saved is the only one used.</div>' +
      '<textarea id="pe-text" class="input" rows="9" spellcheck="false" placeholder="https://api.emergingtextiles.com/api/sheets/Bangladesh-Yarn-Prices_Weekly/cotton-yarn-indicator\nIndia-Yarn-Prices_Weekly/cotton-yarn-indicator" style="width:100%;font-family:var(--mono,monospace);font-size:11px"></textarea>' +
      '<div id="pe-out" style="font-size:11px;margin-top:8px"></div>' +
      '<div style="display:flex;gap:6px;margin-top:12px"><button id="pe-go" class="btn btn-sm" style="background:var(--a1);color:#fff">Add and fetch</button><button id="pe-x" class="btn btn-ghost btn-sm" style="margin-left:auto">Cancel</button></div>');
    var m = $('et-modal');
    $('pe-x').onclick = function () { m.remove(); };
    $('pe-go').onclick = function (e) {
      var text = $('pe-text').value;
      act(e.target, 'Adding…', async function () {
        var r = await api('/admin/api/et/import', 'POST', { text: text });
        var res = r.result;
        $('pe-out').innerHTML = esc(res.note) + (res.skipped.length ? '<div style="color:#9A5B00;margin-top:4px">Not understood: ' + res.skipped.map(function (x) { return esc(x.line); }).join(' | ') + '</div>' : '');
        if (res.added.length) {
          $('pe-out').innerHTML += '<div style="margin-top:4px;color:var(--t3)">Fetching…</div>';
          var ok = 0, bad = [];
          for (var i = 0; i < res.added.length; i++) {
            try { await api('/admin/api/et/tables/' + res.added[i].id + '/refresh', 'POST'); ok++; }
            catch (er) { bad.push(res.added[i].dataset + '/' + res.added[i].sheet + ': ' + er.message); }
          }
          await load();
          var m2 = $('et-modal'); if (m2) m2.remove();
          note(ok + ' of ' + res.added.length + ' tables fetched and filed on the menu.' + (bad.length ? '<br><span style="color:#9A5B00">' + bad.slice(0, 6).map(esc).join('<br>') + '</span>' : ''), bad.length ? 'warn' : 'good');
        }
      });
    };
  }

  // ── wiring ────────────────────────────────────────────────────────────────────────────────────────────────
  function bind() {
    var el = $('et-root');
    el.querySelectorAll('.et-cat').forEach(function (b) { b.onclick = function () { cat = b.getAttribute('data-cat'); render(); }; });
    el.querySelectorAll('.et-open').forEach(function (r) { r.onclick = function () { openTable(+r.getAttribute('data-id')); }; });
    el.querySelectorAll('.et-map').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); addModal({ title: b.getAttribute('data-title'), cat: b.getAttribute('data-cat'), country: b.getAttribute('data-country'), slot: b.getAttribute('data-slot') }); }; });
    var save = $('et-save'); if (save) save.onclick = function () { act(save, 'Saving…', async function () { var v = $('et-key').value; await api('/admin/api/et/key', 'POST', { key: v }); $('et-key').value = ''; await load(); var r = await api('/admin/api/et/test', 'POST'); note(esc(r.result.note), r.result.ok ? 'good' : 'warn'); await load(); }); };
    var rep = $('et-replace'); if (rep) rep.onclick = function () { var b = $('et-replace-box'); b.style.display = b.style.display === 'none' ? 'flex' : 'none'; };
    var rm = $('et-remove'); if (rm) rm.onclick = function () { if (!confirm('Remove the API key? Stored tables stay; nothing will update until a key is saved again.')) return; act(rm, '…', async function () { await api('/admin/api/et/key', 'DELETE'); await load(); }); };
    var test = $('et-test'); if (test) test.onclick = function () { act(test, 'Testing…', async function () { var r = await api('/admin/api/et/test', 'POST'); await load(); note(esc(r.result.note), r.result.ok ? 'good' : 'bad'); }); };
    var dis = $('et-discover'); if (dis) dis.onclick = function () { act(dis, 'Looking…', async function () { var r = await api('/admin/api/et/discover', 'POST'); await load(); note(esc(r.result.note) + '<div style="font-size:9px;color:var(--t3);margin-top:4px">tried: ' + r.result.tried.map(function (t) { return esc(t.url) + ' → ' + esc(t.status || t.error); }).join(' · ') + '</div>', r.result.ok ? 'good' : 'warn'); }); };
    var ref = $('et-refresh'); if (ref) ref.onclick = function () { act(ref, 'Fetching every table…', async function () { var r = await api('/admin/api/et/refresh', 'POST'); D = r.overview; render(); var s = r.sync.source; note('Done. ' + (s ? (s.rows ? s.rows.length : (s.stored != null ? s.stored : 0)) + ' prices read for costing' + (s.rejected && s.rejected.length ? '; ' + s.rejected.length + ' refused: ' + s.rejected.slice(0, 3).map(function (x) { return esc(x.why); }).join(' | ') : '') : '') + (r.sync.ok ? '' : ' <b>' + esc(r.sync.error || 'the price sync reported a problem') + '</b>'), r.sync.ok ? 'good' : 'warn'); }); };
    var add = $('et-add'); if (add) add.onclick = function () { addModal(); };
    var paste = $('et-paste'); if (paste) paste.onclick = pasteModal;
    var find = $('et-find'); if (find) { var tm; find.oninput = function () { clearTimeout(tm); tm = setTimeout(async function () { var q = find.value.trim(); if (!q) { $('et-found').innerHTML = ''; return; } var r = await api('/admin/api/et/search?q=' + encodeURIComponent(q)); $('et-found').innerHTML = '<div class="card" style="padding:6px 14px;margin-bottom:12px">' + ((r.tables || []).length ? r.tables.map(function (t) { return rowHtml(t, false); }).join('') : '<div style="font-size:11px;color:var(--t3);padding:6px 0">Nothing stored matches. A table appears here once it has been found and fetched.</div>') + '</div>'; $('et-found').querySelectorAll('.et-open').forEach(function (rr) { rr.onclick = function () { openTable(+rr.getAttribute('data-id')); }; }); }, 250); }; }
  }

  async function load() { D = await api('/admin/api/et'); render(); }
  // the link on the Yarn Prices tab (no inline handler: the page's CSP forbids them)
  document.addEventListener('click', function (e) { var l = e.target.closest && e.target.closest('#et-open-link'); if (l) { e.preventDefault(); if (typeof switchTab === 'function') switchTab('tab-et'); } });
  window.loadEmergingTextiles = function () { return load().catch(function (e) { var el = $('et-root'); if (el) el.innerHTML = '<div style="color:#B23B3B;font-size:12px">' + esc(e.message) + '</div>'; }); };
})();
