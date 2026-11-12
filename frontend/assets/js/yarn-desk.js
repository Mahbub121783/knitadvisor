// KnitAdvisor · Yarn price desk — the system's own state: sources, the chain, today's table.
// Every number comes from GET /api/yarn-prices/desk; the landed calculator mirrors the
// engine's landedYarnPrice() so what is typed here is what a costing would add.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fmt = function (v, d) { return v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('en', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }); };
  var day = function (iso) { if (!iso) return '—'; var d = new Date(String(iso).length === 7 ? iso + '-01' : iso); return isNaN(d) ? esc(iso) : (String(iso).length === 7 ? d.toLocaleDateString('en', { month: 'short', year: 'numeric' }) : d.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })); };
  var ago = function (iso) { if (!iso) return ''; var h = (Date.now() - Date.parse(iso)) / 3600000; return h < 1 ? 'just now' : h < 48 ? Math.round(h) + ' h ago' : Math.round(h / 24) + ' days ago'; };
  var STATUS = { ok: ['ok', 'answering'], old: ['old', 'last value kept'], kept: ['kept', 'kept'], offline: ['offline', 'not answering'], none: ['none', 'no data yet'], 'built in': ['built', 'built in'] };
  var KIND = { market: 'market quote', market_interpolated: 'read between quotes', reference_list: 'reference list' };
  var signed = function (v, d) { return (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v), d == null ? 2 : d); };

  function sources(d) {
    return '<div class="yd-card"><h2>Where the prices come from <small>— each source, its job, and whether it answered</small></h2><div class="yd-src">' +
      d.sources.map(function (s) {
        var st = STATUS[s.status] || ['none', s.status];
        return '<div class="yd-s"><div class="top"><div><div class="kind">' + esc(s.kind) + ' · ' + esc(s.country) + '</div><b>' + esc(s.name) + '</b></div><span class="st ' + st[0] + '">' + esc(st[1]) + '</span></div>' +
          '<p>' + esc(s.role) + '</p><div class="meta">' + esc(s.unit) + ' · ' + esc(s.cadence) +
          (s.last_quote ? '<br>Newest quote: <b>' + day(s.last_quote) + '</b>' : '') + (s.latest ? '<br>Newest reading: <b>' + day(s.latest) + '</b>' : '') +
          (s.last_attempt ? ' · checked ' + esc(ago(s.last_attempt)) : '') + (s.status_note ? '<br>' + esc(s.status_note) : '') + '</div></div>';
      }).join('') + '</div><p class="yd-small" style="margin:10px 0 0">The feeds refresh themselves while the system runs: the benchmarks every six hours, the dealer list once a day. Every quote is stored with the date the market printed and is never overwritten, so a costing made last month can still be explained today.</p></div>';
  }

  function moves(d) {
    var m = d.moves, a = m.since_last_quote || m.since_reference_list;
    if (!a) return '';
    var cls = function (v) { return v > 0 ? 'up' : v < 0 ? 'down' : ''; };
    var tile = function (v, label) { return '<div><b class="' + cls(v) + '">' + (v == null ? '—' : signed(v, 1) + '%') + '</b><small>' + label + '</small></div>'; };
    return '<div class="yd-card"><h2>What the fibre has done since ' + (m.since_last_quote ? 'the last market quote' : 'the reference list') + ' <small>— ' + day(a.from) + ' to ' + day(m.to) + '</small></h2><div class="yd-moves">' +
      tile(a.cotton_pct, 'cotton, international benchmark') + tile(a.oil_pct, 'crude oil') + tile(a.polyester_pct, 'polyester fibre, modelled from crude (× ' + d.rules.polyester_oil_elasticity + ')') +
      (m.since_last_quote && m.since_reference_list ? tile(m.since_reference_list.cotton_pct, 'cotton since the reference list (' + day(m.since_reference_list.from) + ')') : '') +
      '</div><p class="yd-small" style="margin:10px 0 0">These moves are what step 3 passes through. Cotton reaches the yarn through the kilograms of lint in a kilogram of yarn (1.08 carded, 1.25 combed — the comber takes the short fibre out); a blend moves by its cotton and polyester shares only. Viscose, modal, lyocell, nylon and elastane have no free benchmark and stay at their quoted price.</p></div>';
  }

  function table(d) {
    var head = '<tr><th>Yarn</th>' + d.counts.map(function (n) { return '<th>' + n + 's</th>'; }).join('') + '</tr>';
    var rows = d.table.map(function (r) {
      return '<tr><td>' + esc(r.label) + '<small>' + (r.moved_by.length ? 'moved by ' + esc(r.moved_by.join(' + ')) : 'no free benchmark: carried as quoted') + '</small></td>' +
        r.prices.map(function (p) {
          if (p.price == null) return '<td>—</td>';
          var tip = (KIND[p.kind] || p.kind) + (p.quoted_on ? ' of ' + p.quoted_on : '') + (p.quoted_price != null ? ', $' + fmt(p.quoted_price) : '') + (p.moved ? ', moved ' + signed(p.moved, 3) + ' to today' : '');
          return '<td class="k-' + esc(p.kind) + '" title="' + esc(tip) + '">' + fmt(p.price) + (p.moved ? '<small>' + signed(p.moved, 3) + '</small>' : '') + '</td>';
        }).join('') + '</tr>';
    }).join('');
    return '<div class="yd-card"><h2>Today\'s prices, Bangladesh, USD per kg <small>— exactly as a costing resolves them right now</small></h2><div class="yd-scroll"><table class="yd-t">' + head + rows + '</table></div>' +
      '<div class="yd-legend"><span><i style="background:#17633f"></i>market quote</span><span><i style="background:#1857C4"></i>read between two quotes</span><span><i style="background:#8a5300"></i>reference list</span><span>small figure = the move added to bring it to today</span></div></div>';
  }

  function example(d) {
    var e = d.example, ps = e.price_source || {}, nc = ps.nowcast, steps = [], n = 1;
    var start = ps.quoted_price != null ? ps.quoted_price : ps.listed_price != null ? ps.listed_price : e.price - (nc ? nc.delta : 0);
    if ((ps.kind || '').indexOf('market') === 0) {
      steps.push(['Market quote', 'Combed cotton 30s on the Bangladesh LC list, dated ' + day(ps.last_updated) + (ps.kind === 'market_interpolated' ? ', read between the ' + ps.interpolated_between[0] + 's and ' + ps.interpolated_between[1] + 's quotes' : ''), '$' + fmt(start, 4)]);
    } else {
      steps.push(['Reference list', 'No market quote for this yarn: the reference list of ' + day(ps.last_updated), '$' + fmt(start, 4)]);
    }
    if (nc) {
      nc.parts.forEach(function (p) {
        var f = p.fibre === 'cotton'
          ? 'cotton benchmark ' + signed(p.fibre_change_pct, 1) + '% from ' + day(p.from.on) + ' to ' + day(p.to.on) + ' = ' + signed(p.fibre_change_usd_kg, 4) + ' $/kg of lint; × ' + fmt(p.kg_per_kg_yarn, 3) + ' kg lint per kg of ' + esc(p.spin) + ' yarn × ' + Math.round(p.share * 100) + '% share'
          : 'crude oil ' + signed(p.oil_change_pct, 1) + '% → ' + esc(p.fibre) + ' ' + signed(p.fibre_change_usd_kg, 4) + ' $/kg (' + esc(p.model) + '); × ' + fmt(p.kg_per_kg_yarn, 3) + ' kg × ' + Math.round(p.share * 100) + '% share';
        steps.push(['Brought to today: ' + p.fibre, f, signed(p.contribution_usd_kg, 4)]);
      });
    } else steps.push(['Brought to today', 'Not needed or not available: the quote is fresh, or no benchmark covers this fibre', '±0']);
    steps.push(['Country', 'Bangladesh is the anchor: ×1. Other countries below.', '×1']);
    var L = d.landed.default;
    steps.push(['Buying basis', esc(L.note), signed(L.added_usd_kg, 4)]);
    steps.push(['Price used in the costing', 'before the yarn\'s own surcharges (white, slub, organic, compact…), which are added as separate lines', '$' + fmt(e.price, 4)]);
    return '<div class="yd-card"><h2>One price, worked through <small>— 100% combed cotton 30s</small></h2><ol class="yd-ex">' +
      steps.map(function (s) { return '<li><span class="n">' + (n++) + '</span><span><span class="t">' + esc(s[0]) + '</span><code>' + s[1] + '</code></span><span class="v">' + esc(s[2]) + '</span></li>'; }).join('') + '</ol></div>';
  }

  function countries(d) {
    var max = Math.max.apply(null, d.countries.map(function (c) { return c.price; }));
    return '<div class="yd-card"><h2>The same yarn in six countries <small>— combed 30s, modelled from Bangladesh by power tariff</small></h2>' +
      d.countries.slice().sort(function (a, b) { return a.price - b.price; }).map(function (c) {
        return '<div class="yd-cty' + (c.anchor ? ' me' : '') + '"><span>' + esc(c.name) + '</span><span class="b"><i style="width:' + (c.price / max * 100).toFixed(0) + '%"></i></span><span class="mono" style="text-align:right">$' + fmt(c.price) + '</span></div>';
      }).join('') +
      '<p class="yd-small" style="margin:8px 0 0">Tariffs in US cents per kWh: ' + d.countries.map(function (c) { return esc(c.name) + ' ' + fmt(c.tariff_us_cents_kwh, 1); }).join(' · ') + '. The fibre is a world commodity and costs the same everywhere; only the spinning conversion moves with energy. Where a country\'s own dated market quote exists, it replaces this model.</p></div>';
  }

  function landing(d) {
    return '<div class="yd-card"><h2>Duty, VAT and the cost of buying <small>— what the costing adds on top of the quote</small></h2>' +
      '<p class="yd-small" style="margin:0 0 10px;color:var(--t2)">The quotes are the import-against-LC list. An export-oriented mill buys on a back-to-back LC through a bonded warehouse, so the yarn carries no import duty and no VAT, and the costing uses the quote as the cost unless told otherwise. For a domestic-market purchase, or to put freight and LC charges inside the yarn price, enter the rates; each becomes its own line. VAT that can be claimed back as input credit is not a cost.</p>' +
      '<div class="yd-land">' +
        '<div><label for="ld-basis">Buying basis</label><select id="ld-basis"><option value="bonded_export">Export, bonded (LC)</option><option value="domestic">Domestic market</option></select></div>' +
        '<div><label for="ld-f">Freight + insurance %</label><input id="ld-f" type="number" min="0" max="60" step="0.1" value="0"></div>' +
        '<div><label for="ld-d">Import duty %</label><input id="ld-d" type="number" min="0" max="60" step="0.1" value="0"></div>' +
        '<div><label for="ld-b">LC + bank charges %</label><input id="ld-b" type="number" min="0" max="60" step="0.05" value="0"></div>' +
        '<div><label for="ld-v">VAT %</label><input id="ld-v" type="number" min="0" max="60" step="0.1" value="0"></div>' +
      '</div><div class="yd-lines" id="ld-lines"></div>' +
      '<p class="yd-small" style="margin:8px 0 0">Order of the arithmetic: freight on the quote; duty on quote + freight; LC charges on the quote; VAT, where it is a cost, on all of that. The same rates can be sent with any calculation through the API (yarn_buy_basis, yarn_freight_pct, yarn_duty_pct, yarn_lc_bank_pct, yarn_vat_pct).</p></div>';
  }
  function landedCalc(price) {
    var g = function (id) { var v = parseFloat($(id).value); return isFinite(v) ? Math.min(60, Math.max(0, v)) : 0; };
    var dom = $('ld-basis').value === 'domestic', f = g('ld-f'), du = g('ld-d'), b = g('ld-b'), v = g('ld-v');
    var fr = price * f / 100, cif = price + fr, duty = cif * du / 100, bank = price * b / 100, vat = dom ? (cif + duty + bank) * v / 100 : 0;
    var rows = [['Quote (combed 30s)', price], ['Freight and insurance (' + f + '%)', fr], ['Import duty (' + du + '%)', duty], ['LC and bank charges (' + b + '%)', bank], [dom ? 'VAT, not recoverable (' + v + '%)' : 'VAT (recovered as input credit, not a cost)', vat]];
    $('ld-lines').innerHTML = rows.map(function (r, i) { return '<div><span>' + esc(r[0]) + '</span><b>' + (i ? '+ ' : '') + '$' + fmt(r[1], 4) + '</b></div>'; }).join('') +
      '<div class="tot"><span>Yarn cost per kg</span><b>$' + fmt(price + fr + duty + bank + vat, 4) + '</b></div>';
  }

  function rules(d) {
    var r = d.rules;
    return '<div class="yd-card"><h2>The rules the chain keeps <small>— so no figure pretends to be more than it is</small></h2><ul class="yd-small" style="margin:0;padding-left:18px;color:var(--t2);line-height:1.8">' +
      '<li>A quote up to ' + r.quote_used_as_printed_days + ' days old is used exactly as printed.</li>' +
      '<li>An older quote is brought forward by its fibre benchmark, for up to ' + r.brought_forward_up_to_days + ' days; past that, the reference list answers, brought forward the same way.</li>' +
      '<li>A count is read between two quotes only if they are the same day and at most ' + r.interpolation_max_span_ne + ' Ne apart; it is never extrapolated past the ends of the list.</li>' +
      '<li>Polyester has no free daily fibre price: its move is modelled as ' + r.polyester_oil_elasticity + ' × crude oil\'s move on a $' + fmt(r.polyester_staple_usd_kg) + '/kg staple fibre, and labelled modelled.</li>' +
      '<li>A source that stops answering keeps its last good quotes; it is never replaced by an empty list, and the page says it is not answering.</li>' +
      '<li>Two lists of the same market are never merged: the LC list (USD/kg) costs, the local cash list (Tk/lb) is shown beside it.</li>' +
      '</ul></div>';
  }

  window.apiFetch('/api/yarn-prices/desk').then(function (d) {
    $('yd-out').innerHTML = sources(d) + moves(d) + table(d) + '<div class="yd-two">' + example(d) + countries(d) + '</div>' + landing(d) + rules(d);
    var price = d.example.price;
    ['ld-basis', 'ld-f', 'ld-d', 'ld-b', 'ld-v'].forEach(function (id) { $(id).addEventListener('input', function () { landedCalc(price); }); $(id).addEventListener('change', function () { landedCalc(price); }); });
    landedCalc(price);
  }).catch(function (e) {
    $('yd-out').innerHTML = '<div class="yd-card"><div class="yd-err">' + esc(e.message || 'The prices could not be read.') + '</div></div>';
  });
})();
