/* KnitAdvisor — Costing Sheet page. The sheet lives in one state object that
 * mirrors the API input; every field carries data-k="path.to.value", one
 * delegated listener writes it back, and the sheet is re-costed 350 ms after
 * the last keystroke. Saved sheets live in the account (per name, with
 * versions); the picture is shrunk in the browser before it is stored. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : (d === undefined ? null : d); }
  function f2(v) { return v == null ? '—' : (+v).toFixed(2); }
  function f3(v) { return v == null ? '—' : (+v).toFixed(3); }
  function f4(v) { return v == null ? '—' : (+v).toFixed(4); }

  var OPTS = { yarns: [], fabrics: [], shades: [], bdt_rate: 123.1 };
  var last = null, timer = null, seq = 0, currentId = null;

  function blankShell(i) {
    return { name: ['1st Shell', '2nd Shell', '3rd Shell', '4th Shell', '5th Shell', '6th Shell', '7th Shell', '8th Shell'][i] || 'Shell',
      application: '', fabric: 'single_jersey', composition: '100% cotton', gsm: 160, shade: 'light_medium', two_part: false, stripe: '', brushed: false, aop: false,
      yarn_mode: 'auto',
      yarns: [{ type: 'combed_regular', count: '', share_pct: 100, price: '' }],
      yarn_dye_price: '', knit_price: '', dye_price: '', finish_price: '', aop_price: '', loss_pct: '',
      consumption_unit: 'pc', consumption: [] };
  }
  function blank() {
    return {
      header: { style: '', order_no: '', description: '', buyer: '', department: '', from: '', factory: '', date: new Date().toISOString().slice(0, 10) },
      sizes: ['S', 'M', 'L', 'XL'], pack_of: 1, exchange_rate: '', loss_method: 'sheet', picture: null,
      shells: [blankShell(0)],
      trims: [{ name: 'Sewing thread', values: [] }, { name: 'Main label', values: [] }, { name: 'Care label', values: [] }],
      embellishments: [{ name: 'Print', values: [] }, { name: 'Embroidery', values: [] }, { name: 'Other embellishment', values: [] }],
      washes: [],
      packaging: [{ name: 'Hang tag', values: [] }, { name: 'Poly bag', values: [] }, { name: 'Carton', values: [] }],
      testing: [], cm: { cpm: '', efficiency_pct: '', smv: [], override: [] },
      markups: [{ name: 'Buying commission', kind: 'commission', pct: '' }, { name: 'Profit', kind: 'profit', pct: '' }], markup_mode: 'on_cost',
      order: { quantity: '', ratio: [] }, target_fob: [],
    };
  }
  var S = blank();

  // the YEAW7759 sheet, with the factory's own prices typed in
  function example() {
    var s = blank();
    s.header = { style: 'YEAW7759', order_no: '', description: 'X3 col stripe baseball neck crew', buyer: 'Mr. Shailen', department: "Older Boy's", from: 'Taj/Mamun', factory: 'SM Knitwears Ltd', date: '2025-10-31' };
    s.sizes = ['3Y-6Y', '7Y-10Y', '11Y-14Y', '15Y-16Y'];
    s.shells = [
      { name: '1st Shell', application: 'FR+BK+SLV — engineering stripe', fabric: 'single_jersey', composition: '80% cotton 20% polyester', gsm: 280, shade: 'light_medium', two_part: false, stripe: 'engineering', brushed: false, aop: false,
        yarns: [{ type: 'us_combed_cotton', count: 30, share_pct: 100, price: 3.55 }], yarn_dye_price: '', knit_price: 2.25, dye_price: 1.9, finish_price: 1, aop_price: '', loss_pct: 20, consumption_unit: 'pc', consumption: [0.3, 0.4, 0.48, 0.6] },
      { name: '2nd Shell', application: 'Rib — cuff, collar, hem', fabric: 'lycra_rib_2x2', composition: '95% cotton 5% elastane', gsm: 350, shade: 'light_medium', two_part: false, stripe: '', brushed: false, aop: false,
        yarns: [{ type: 'us_combed_cotton', count: 30, share_pct: 95, price: 3.65 }, { type: 'spandex_70d', count: '', share_pct: 5, price: 6 }], yarn_dye_price: '', knit_price: 0.4, dye_price: 1.9, finish_price: 0.9, aop_price: '', loss_pct: 16, consumption_unit: 'pc', consumption: [0.15, 0.15, 0.15, 0.15] },
      { name: '3rd Shell', application: 'Neck tape', fabric: 'single_jersey', composition: '100% cotton', gsm: 150, shade: 'light_medium', two_part: false, stripe: '', brushed: false, aop: false,
        yarns: [{ type: 'combed_regular', count: 30, share_pct: 100, price: 3.75 }], yarn_dye_price: '', knit_price: 0.16, dye_price: 1.9, finish_price: 0.8, aop_price: '', loss_pct: 14, consumption_unit: 'pc', consumption: [0.006, 0.006, 0.006, 0.006] },
    ];
    var all = function (v) { return [v, v, v, v]; };
    s.trims = [['Sewing thread', 0.1], ['Brand label', 0.014], ['Care label [SWS]', 0.017], ['Hanger loop', 0.01], ['Interlining (OTB)', 0.05], ['Zipper — metal', 0.3]].map(function (t) { return { name: t[0], values: all(t[1]) }; });
    s.embellishments = [{ name: 'Print', values: all(0.12) }, { name: 'Embroidery', values: all(0.2) }];
    s.packaging = [['Hang tag', 0.018], ['Poly bag', 0.042], ['Carton', 0.06], ['Carton sticker', 0.002678], ['Tag pin + tapes', 0.001], ['Tissue + MD sticker', 0.001]].map(function (t) { return { name: t[0], values: all(t[1]) }; });
    s.testing = all(0.03);
    s.cm = { cpm: 0.06, efficiency_pct: '', smv: all(15.53), override: [] };
    s.markups = [{ name: 'CCL commission', kind: 'commission', pct: 3.3 }, { name: 'SM', kind: 'other', pct: 1.2 }, { name: 'Profit margin', kind: 'profit', pct: 1.5 }];
    s.order = { quantity: '', ratio: [] };
    return s;
  }

  // ── paths ──────────────────────────────────────────────────────────────
  function getPath(o, p) { return p.split('.').reduce(function (a, k) { return a == null ? undefined : a[k]; }, o); }
  function setPath(o, p, v) {
    var ks = p.split('.'), a = o;
    for (var i = 0; i < ks.length - 1; i++) { var k = ks[i]; if (a[k] == null) a[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; a = a[k]; }
    a[ks[ks.length - 1]] = v;
  }

  // ── rendering the form ─────────────────────────────────────────────────
  function n() { return S.sizes.length; }
  function sizeCells(path, arr, step) {
    var out = '';
    for (var k = 0; k < n(); k++) out += '<td><input class="num" type="number" step="' + (step || 'any') + '" min="0" data-k="' + path + '.' + k + '" value="' + esc(arr && arr[k] != null ? arr[k] : '') + '"></td>';
    return out + '<td><button class="cs-btn small cs-noprint" type="button" data-fill="' + path + '" title="Copy the first size to every size">→ all</button></td>';
  }
  function sizeHead(first) {
    return '<tr><th>' + (first || '') + '</th>' + S.sizes.map(function (s) { return '<th class="num">' + esc(s) + '</th>'; }).join('') + '<th></th></tr>';
  }

  function renderSizes() {
    $('cs-sizes').innerHTML = S.sizes.map(function (s, i) {
      return '<span class="cs-chip">' + esc(s) + (S.sizes.length > 1 ? '<button type="button" data-rmsize="' + i + '" aria-label="Remove ' + esc(s) + '">×</button>' : '') + '</span>';
    }).join('');
  }

  function yarnOptions(sel) {
    return OPTS.yarns.map(function (y) { return '<option value="' + y.key + '"' + (y.key === sel ? ' selected' : '') + '>' + esc(y.label) + '</option>'; }).join('');
  }
  function fabricOptions(sel) {
    return OPTS.fabrics.map(function (f) { return '<option value="' + f + '"' + (f === sel ? ' selected' : '') + '>' + esc(f.replace(/_/g, ' ')) + '</option>'; }).join('');
  }

  function renderShells() {
    $('cs-shells').innerHTML = S.shells.map(function (sh, i) {
      var p = 'shells.' + i;
      var auto = sh.yarn_mode === 'auto';
      var yarns = auto ? '' : sh.yarns.map(function (y, j) {
        var yp = p + '.yarns.' + j, row = OPTS.yarns.filter(function (x) { return x.key === y.type; })[0] || {};
        return '<tr><td style="width:96px"><input data-k="' + yp + '.role" value="' + esc(y.role || '') + '" placeholder="role"></td><td style="min-width:200px"><select data-k="' + yp + '.type">' + yarnOptions(y.type) + '</select></td>' +
          '<td>' + (row.denier ? '<span style="font-size:12px;color:var(--t3)">' + row.denier + 'D</span>' : '<input class="num" type="number" min="5" max="120" data-k="' + yp + '.count" data-auto="1" value="' + esc(y.count) + '" placeholder="auto"><small class="cs-asrc" data-asrc="' + yp + '.count"></small>') + '</td>' +
          '<td><input class="num" type="number" min="0" max="100" step="0.1" data-k="' + yp + '.share_pct" value="' + esc(y.share_pct) + '"></td>' +
          '<td><input class="num" type="number" min="0" step="0.01" data-k="' + yp + '.price" data-auto="1" value="' + esc(y.price) + '" placeholder="auto"><small class="cs-asrc" data-asrc="' + yp + '.price"></small></td>' +
          '<td>' + (sh.yarns.length > 1 ? '<button class="cs-btn small" type="button" data-rmyarn="' + i + '.' + j + '">×</button>' : '') + '</td></tr>';
      }).join('');
      var price = function (k, label, help) {
        var auto = k !== 'yarn_dye_price' && k !== 'aop_price';
        return '<label class="cs-f">' + label + '<input class="num" type="number" min="0" step="0.01" data-k="' + p + '.' + k + '"' + (auto ? ' data-auto="1"' : '') + ' value="' + esc(sh[k]) + '" placeholder="' + (auto ? 'auto' : '0') + '"><small class="cs-asrc" data-asrc="' + p + '.' + k + '">' + (help || '') + '</small></label>';
      };
      return '<div class="cs-shell">' +
        '<div class="cs-shell-h"><input data-k="' + p + '.name" value="' + esc(sh.name) + '" aria-label="Shell name">' +
        (S.shells.length > 1 ? '<button class="cs-btn small danger" type="button" data-rmshell="' + i + '">Remove</button>' : '') + '</div>' +
        '<div class="cs-row">' +
          '<label class="cs-f" style="grid-column:span 2">Application in garment<input data-k="' + p + '.application" value="' + esc(sh.application) + '" placeholder="Body / rib for cuff, collar, hem / neck tape"></label>' +
          '<label class="cs-f">Fabric<select data-k="' + p + '.fabric">' + fabricOptions(sh.fabric) + '</select></label>' +
          '<label class="cs-f">Composition<input data-k="' + p + '.composition" value="' + esc(sh.composition) + '" placeholder="95% cotton 5% elastane"></label>' +
          '<label class="cs-f">GSM<input class="num" type="number" min="60" max="800" data-k="' + p + '.gsm" value="' + esc(sh.gsm) + '"></label>' +
          '<label class="cs-f">Shade<select data-k="' + p + '.shade">' + [['white', 'White'], ['light_medium', 'Light / medium'], ['dark_navy', 'Dark / navy'], ['black', 'Black'], ['neon', 'Neon'], ['melange', 'Melange']].map(function (o) { return '<option value="' + o[0] + '"' + (sh.shade === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
          '<label class="cs-f">Stripe<select data-k="' + p + '.stripe"><option value="">None</option><option value="feeder"' + (sh.stripe === 'feeder' ? ' selected' : '') + '>Feeder stripe</option><option value="engineering"' + (sh.stripe === 'engineering' ? ' selected' : '') + '>Engineering stripe</option></select></label>' +
          '<label class="cs-f" style="flex-direction:row;align-items:center;gap:6px;"><input type="checkbox" data-k="' + p + '.two_part"' + (sh.two_part ? ' checked' : '') + ' style="width:auto"> Two-part dyeing</label>' +
          '<label class="cs-f" style="flex-direction:row;align-items:center;gap:6px;"><input type="checkbox" data-k="' + p + '.brushed"' + (sh.brushed ? ' checked' : '') + ' style="width:auto"> Brushed</label>' +
          '<label class="cs-f" style="flex-direction:row;align-items:center;gap:6px;"><input type="checkbox" data-k="' + p + '.aop"' + (sh.aop ? ' checked' : '') + ' style="width:auto"> All-over print</label>' +
        '</div>' +
        '<div class="cs-yhead"><b>Yarns</b>' +
          '<label><input type="radio" name="ym' + i + '" data-ymode="' + i + '" value="auto"' + (auto ? ' checked' : '') + '> Auto from fabric, GSM and composition</label>' +
          '<label><input type="radio" name="ym' + i + '" data-ymode="' + i + '" value="manual"' + (auto ? '' : ' checked') + '> My own yarns</label></div>' +
        (auto
          ? '<div class="cs-scroll"><table class="cs-t" data-autoyarns="' + i + '"><tr><td style="color:var(--t3)">Working out the yarns…</td></tr></table></div>' +
            '<button class="cs-btn small" type="button" data-edityarns="' + i + '" style="margin-top:4px">Edit these yarns</button>'
          : '<div class="cs-scroll" style="margin-top:4px"><table class="cs-t"><tr><th>Role</th><th>Yarn</th><th>Count</th><th class="num">Share %</th><th class="num">Price $/kg</th><th></th></tr>' + yarns + '</table></div>' +
            '<button class="cs-btn small" type="button" data-addyarn="' + i + '" style="margin-top:4px">+ Yarn (binder, loop, elastane…)</button>') +
        '<div class="cs-price">' +
          price('yarn_dye_price', 'Yarn dyeing $/kg', 'yarn-dyed stripes only') +
          price('knit_price', 'Knitting $/kg') + price('dye_price', 'Dyeing $/kg') + price('finish_price', 'Finishing $/kg') +
          (sh.aop ? price('aop_price', 'AOP $/kg', 'your printer\'s rate') : '') +
          price('loss_pct', 'Process loss %') +
        '</div>' +
        '<div class="cs-scroll"><table class="cs-t">' + sizeHead('Consumption ' + '<select data-k="' + p + '.consumption_unit" style="width:auto;padding:2px"><option value="pc"' + (sh.consumption_unit !== 'dozen' ? ' selected' : '') + '>kg / pc</option><option value="dozen"' + (sh.consumption_unit === 'dozen' ? ' selected' : '') + '>kg / dozen</option></select>') +
          '<tr><td>Consumption</td>' + sizeCells(p + '.consumption', sh.consumption, '0.001') + '</tr></table></div>' +
        '<div class="cs-kg" data-shellres="' + i + '"></div>' +
      '</div>';
    }).join('');
  }

  function renderLines(key, label) {
    var list = S[key];
    var rows = list.map(function (l, i) {
      return '<tr><td style="min-width:150px"><input data-k="' + key + '.' + i + '.name" value="' + esc(l.name) + '"></td>' + sizeCells(key + '.' + i + '.values', l.values, '0.001') +
        '<td><button class="cs-btn small" type="button" data-rmline="' + key + '.' + i + '">×</button></td></tr>';
    }).join('');
    $('cs-' + key).innerHTML = '<div class="cs-scroll"><table class="cs-t">' + sizeHead(label) + rows + '</table></div>' +
      '<button class="cs-btn small" type="button" data-addline="' + key + '" style="margin-top:4px">+ Add line</button>';
  }

  // CM shown as you type: SMV × CPM ÷ efficiency, unless a CM is typed for that size
  function cmFor(k) {
    var o = S.cm.override && S.cm.override[k];
    if (o !== '' && o != null && isFinite(+o)) return { v: +o, typed: true };
    var smv = num(S.cm.smv && S.cm.smv[k], 0), cpm = num(S.cm.cpm, 0), eff = num(S.cm.efficiency_pct, 100) || 100;
    return { v: cpm ? smv * cpm / (eff / 100) : 0, typed: false };
  }
  function paintCM() {
    for (var k = 0; k < n(); k++) {
      var c = cmFor(k), el = document.querySelector('[data-cmout="' + k + '"]');
      if (el) el.innerHTML = '$' + f3(c.v) + (c.typed ? ' <span class="cs-src yours">typed</span>' : '');
      // the override box shows what SMV × CPM ÷ efficiency would give
      var ov = document.querySelector('[data-k="cm.override.' + k + '"]');
      var smv = num(S.cm.smv && S.cm.smv[k], 0), cpm = num(S.cm.cpm, 0), eff = num(S.cm.efficiency_pct, 100) || 100;
      if (ov) ov.placeholder = cpm && smv ? f3(smv * cpm / (eff / 100)) : '';
    }
  }
  function renderCM() {
    var cmRow = ''; for (var k = 0; k < n(); k++) cmRow += '<td class="num" data-cmout="' + k + '"></td>';
    $('cs-cm').innerHTML = '<div class="cs-scroll"><table class="cs-t">' + sizeHead('') +
      '<tr><td>SMV (minutes)</td>' + sizeCells('cm.smv', S.cm.smv, '0.01') + '</tr>' +
      '<tr><td>Your CM $ <span style="font-weight:400;color:var(--t3)">(optional)</span></td>' + sizeCells('cm.override', S.cm.override, '0.001') + '</tr>' +
      '<tr class="total"><td>CM used</td>' + cmRow + '<td></td></tr></table></div>';
    $('cs-testing').innerHTML = '<div class="cs-scroll"><table class="cs-t">' + sizeHead('') + '<tr><td>Testing $</td>' + sizeCells('testing', S.testing, '0.001') + '</tr></table></div>';
    paintCM();
  }

  function renderMarkups() {
    var kinds = [['commission', 'Commission'], ['profit', 'Profit'], ['other', 'Other']];
    $('cs-markups').innerHTML = '<div class="cs-scroll"><table class="cs-t"><tr><th>Item</th><th>Type</th><th class="num">%</th><th></th></tr>' +
      S.markups.map(function (m, i) {
        var kind = m.kind || (/profit|margin/i.test(m.name || '') ? 'profit' : /comm|agent/i.test(m.name || '') ? 'commission' : 'other');
        return '<tr><td><input data-k="markups.' + i + '.name" value="' + esc(m.name) + '"></td>' +
          '<td style="width:130px"><select data-k="markups.' + i + '.kind">' + kinds.map(function (q) { return '<option value="' + q[0] + '"' + (kind === q[0] ? ' selected' : '') + '>' + q[1] + '</option>'; }).join('') + '</select></td>' +
          '<td style="width:100px"><input class="num" type="number" min="0" max="60" step="0.1" data-k="markups.' + i + '.pct" value="' + esc(m.pct) + '"></td>' +
          '<td><button class="cs-btn small" type="button" data-rmline="markups.' + i + '">×</button></td></tr>';
      }).join('') + '</table></div><button class="cs-btn small" type="button" data-addmarkup="1" style="margin-top:4px">+ Add</button>';
  }

  function renderOrder() {
    $('cs-order').innerHTML = '<div class="cs-scroll"><table class="cs-t">' + sizeHead('') +
      '<tr><td>Size ratio</td>' + sizeCells('order.ratio', S.order.ratio, '1') + '</tr>' +
      '<tr><td>Target FOB $</td>' + sizeCells('target_fob', S.target_fob, '0.01') + '</tr></table></div>';
  }

  function renderPicture() {
    var has = !!S.picture;
    $('cs-pic-img').hidden = !has; $('cs-pic-empty').hidden = has; $('cs-pic-clear').hidden = !has;
    if (has) $('cs-pic-img').src = S.picture;
  }

  function renderForm() {
    document.querySelectorAll('#cs-form [data-k]').forEach(function (el) {
      if (el.closest('#cs-shells, #cs-trims, #cs-embellishments, #cs-washes, #cs-packaging, #cs-cm, #cs-testing, #cs-markups, #cs-order')) return;
      var v = getPath(S, el.getAttribute('data-k'));
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v == null ? '' : v;
    });
    if (!S.exchange_rate) $('cs-form').querySelector('[data-k="exchange_rate"]').placeholder = String(OPTS.bdt_rate);
    renderSizes(); renderShells(); renderLines('trims', 'Trim'); renderLines('embellishments', 'Embellishment'); renderLines('washes', 'Wash');
    renderLines('packaging', 'Packaging'); renderCM(); renderMarkups(); renderOrder(); renderPicture();
    paintSources();
  }

  // ── payload and costing ────────────────────────────────────────────────
  function payload() {
    var p = JSON.parse(JSON.stringify(S));
    delete p.picture;
    // sheets saved before CM override: their CM-per-piece column becomes the override
    p.cm = { smv: S.cm.smv || [], cpm: S.cm.cpm, efficiency_pct: S.cm.efficiency_pct, override: S.cm.override || (S.cm.mode === 'direct' ? S.cm.direct : []) };
    p.shells.forEach(function (sh) { sh.yarns.forEach(function (y) { if (y.price === '') delete y.price; }); });
    return p;
  }
  function schedule() { clearTimeout(timer); $('cs-res').classList.add('cs-busy'); paintCM(); timer = setTimeout(cost, 160); }
  function cost() {
    var my = ++seq;
    apiFetch('/api/cost-sheet/analyse', { method: 'POST', body: payload() }).then(function (r) {
      if (my !== seq) return;
      $('cs-res').classList.remove('cs-busy');
      last = r; renderResult();
    }).catch(function (e) {
      if (my !== seq) return;
      $('cs-res').classList.remove('cs-busy');
      last = null;
      $('cs-status').className = 'cs-msg err';
      $('cs-status').textContent = (e.data && e.data.error) || e.message || 'Could not cost the sheet.';
    });
  }

  var MIX = [['fabric', 'Fabric', '#1857C4'], ['trims', 'Trims', '#0f9d76'], ['embellishment', 'Embellishment', '#b8860b'], ['wash', 'Wash', '#0e7490'], ['cm', 'CM', '#7a4fc2'], ['packaging', 'Packaging', '#c2410c'], ['testing', 'Testing', '#64748b'], ['markup', 'Commission & profit', '#be185d']];

  function srcBadge(s) { return s ? '<span class="cs-src ' + esc(s.kind) + '">' + esc(s.label) + '</span>' : ''; }

  // Every box marked data-auto shows the system's figure IN the box (blue) while
  // it is not typed over; typing makes it yours, the ↺ puts the system's back.
  function autoValues() {
    var out = {};
    if (!last || !last.success) return out;
    last.shells.forEach(function (sh, i) {
      var p = 'shells.' + i;
      // always the SYSTEM's figure — also when the box is typed over, so ↺ can offer it back
      var put = function (k, field, dec) { var pr = sh.system && sh.system[field]; if (pr) out[p + '.' + k] = { v: (+pr.value).toFixed(dec), src: pr.source }; };
      put('knit_price', 'knitting', 3); put('dye_price', 'dyeing', 3); put('finish_price', 'finishing', 3); put('loss_pct', 'loss_pct', 2);
      sh.yarns.forEach(function (y, j) {
        if (y.system_price != null) out[p + '.yarns.' + j + '.price'] = { v: (+y.system_price).toFixed(2), src: y.system_source };
        if (sh.auto_count && !y.denier) out[p + '.yarns.' + j + '.count'] = { v: String(sh.auto_count.count), src: { kind: 'system', label: sh.auto_count.label } };
      });
    });
    return out;
  }
  function paintSources() {
    if (!last || !last.success) return;
    var av = autoValues();
    document.querySelectorAll('#cs-form input[data-auto]').forEach(function (inp) {
      var path = inp.getAttribute('data-k'), own = getPath(S, path), a = av[path];
      var mine = own !== '' && own != null;
      var srcEl = document.querySelector('[data-asrc="' + path + '"]');
      if (!mine && a && document.activeElement !== inp) inp.value = a.v;
      inp.classList.toggle('cs-auto', !mine);
      if (srcEl) {
        var src = mine ? { kind: 'yours', label: 'yours' } : a ? a.src : null;
        srcEl.innerHTML = (src ? '<span class="cs-src ' + esc(src.kind) + '" title="' + esc(src.label) + '">' + esc(mine ? 'your figure' : shortSrc(src)) + '</span>' : '') +
          (mine && a ? ' <button type="button" class="cs-reauto" data-reauto="' + path + '" title="Back to the system figure (' + esc(a.v) + ')">↺ auto ' + esc(a.v) + '</button>' : '');
      }
    });
    last.shells.forEach(function (sh, i) {
      var at = document.querySelector('[data-autoyarns="' + i + '"]');
      if (at) at.innerHTML = '<tr><th>Role</th><th>Yarn</th><th class="num">Count</th><th class="num">Share %</th><th class="num">Price $/kg</th></tr>' +
        sh.yarns.map(function (y) {
          return '<tr><td><b>' + esc(y.role || '—') + '</b></td><td>' + esc(y.label) + '</td><td class="num">' + (y.count ? y.count + 's' : y.denier ? y.denier + 'D' : '—') + '</td><td class="num">' + y.share_pct + '%</td>' +
            '<td class="num">' + f2(y.price) + ' ' + srcBadge({ kind: y.source.kind, label: shortSrc(y.source) }) + '</td></tr>';
        }).join('') +
        '<tr class="total"><td colspan="3">Blend price</td><td class="num">100%</td><td class="num">$' + f3(sh.prices.yarn.value) + '</td></tr>' +
        (sh.yarn_plan_basis ? '<tr><td colspan="5" style="font-size:11px;color:var(--t3)">' + esc(sh.yarn_plan_basis) + '</td></tr>' : '');
      var box = document.querySelector('[data-shellres="' + i + '"]');
      if (box) box.innerHTML = (sh.auto_count ? '<div style="flex-basis:100%;font-size:11.5px;color:var(--t2)">Count chosen for the fabric: <b>' + esc(sh.auto_count.label.replace(/^auto: /, '')) + '</b>' + (sh.auto_count.reachable ? '' : ' — outside the factory\'s usual tightness: check it') + '</div>' : '') +
        'Fabric <b>$' + f3(sh.price_per_kg) + '</b>/kg ' + (last.loss_method === 'sheet' ? '(exact ÷(1−loss): $' + f3(sh.exact_per_kg) + ')' : '(sheet ×(1+loss): $' + f3(sh.sheet_per_kg) + ')') +
        ' · cost per piece: ' + sh.cost.map(function (c, k) { return esc(last.sizes[k]) + ' <b>$' + f3(c) + '</b>'; }).join(' · ') +
        (sh.notes.length ? '<div style="flex-basis:100%;font-size:11.5px;color:var(--t3)">' + sh.notes.map(esc).join(' ') + '</div>' : '');
    });
  }
  function shortSrc(src) {
    var l = String(src.label || '');
    if (/^auto: /.test(l)) return 'auto for fabric + GSM';
    if (/charge book/.test(l)) return 'auto · charge book';
    if (/finishing model/.test(l)) return 'auto · finishing model';
    if (/loss model/.test(l)) return 'auto · loss model';
    if (/market quote/.test(l)) return 'auto · market ' + (l.match(/\d{4}-\d{2}-\d{2}/) || [''])[0] + (/stale/.test(l) ? ' (old)' : '');
    if (/reference list/.test(l)) return 'auto · reference list';
    return src.kind === 'missing' ? 'not priced — type it' : 'auto';
  }

  function renderResult() {
    var r = last;
    if (!r || !r.success) return;
    var sizes = r.sizes, ps = r.per_size;
    var over = ps.filter(function (p) { return p.target_gap != null && p.target_gap < 0; });
    var warn = (r.warnings || []).filter(function (w) { return !/charge sheet|rate was used|priced on/.test(w); });
    $('cs-status').className = 'cs-msg ' + (over.length ? 'err' : warn.length ? 'note' : 'ok');
    $('cs-status').textContent = warn.length && !over.length ? warn.join(' ') : over.length
      ? 'Over the target price for ' + over.map(function (p) { return p.size; }).join(', ') + '.'
      : 'Costed for ' + sizes.length + ' size' + (sizes.length > 1 ? 's' : '') + (r.markup_pct ? ' with ' + r.markup_pct + '% commission and profit' : '') + '.';
    $('cs-big').innerHTML = ps.map(function (p) { return '<div><small>' + esc(p.size) + '</small><b>$' + f2(p.fob_pc) + '</b><small>৳' + Math.round(p.fob_pc * r.bdt.rate) + '</small></div>'; }).join('');
    // cost mix of the middle size
    var mid = ps[Math.floor((ps.length - 1) / 2)];
    $('cs-mixwrap').innerHTML = '<div style="font-size:11.5px;color:var(--t2)">Where the money goes (' + esc(mid.size) + ')</div><div class="cs-mix">' +
      MIX.map(function (m) { var v = mid[m[0]] || 0; return v > 0 ? '<span style="width:' + (v / mid.fob_pc * 100) + '%;background:' + m[2] + '" title="' + m[1] + ' $' + f3(v) + '"></span>' : ''; }).join('') + '</div><div class="cs-legend">' +
      MIX.map(function (m) { var v = mid[m[0]] || 0; return v > 0 ? '<span><i style="background:' + m[2] + '"></i>' + m[1] + ' ' + Math.round(v / mid.fob_pc * 100) + '%</span>' : ''; }).join('') + '</div>';
    var row = function (label, key, cls, fmt) { return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + label + '</td>' + ps.map(function (p) { return '<td class="num">' + (fmt || f3)(p[key]) + '</td>'; }).join('') + '</tr>'; };
    var html = '<tr><th></th>' + sizes.map(function (s) { return '<th class="num">' + esc(s) + '</th>'; }).join('') + '</tr>' +
      row('Fabric', 'fabric') + row('Trims', 'trims') + row('Embellishment', 'embellishment') + row('Wash', 'wash') + row('CM', 'cm') + row('Packaging', 'packaging') + row('Testing', 'testing') +
      row('Sub-total (cost)', 'subtotal', 'total') +
      r.markups.map(function (m, i) { return '<tr><td>' + esc(m.name) + ' <span style="color:var(--t3)">' + m.pct + '%</span></td>' + ps.map(function (p) { return '<td class="num">' + f3(p.markups[i].usd) + '</td>'; }).join('') + '</tr>'; }).join('') +
      row('FOB / pc', 'fob_pc', 'fob', f2) +
      (r.pack_of > 1 ? row('FOB / pack of ' + r.pack_of, 'fob_pack', '', f2) : '') + row('FOB / dozen', 'fob_dozen', '', f2) +
      '<tr><td>FOB / pc ৳</td>' + r.bdt.fob_pc.map(function (v) { return '<td class="num">' + Math.round(v) + '</td>'; }).join('') + '</tr>';
    if (ps.some(function (p) { return p.target; })) {
      html += '<tr><td>Target</td>' + ps.map(function (p) { return '<td class="num">' + (p.target ? f2(p.target) : '—') + '</td>'; }).join('') + '</tr>' +
        '<tr><td>Left at target</td>' + ps.map(function (p) { return '<td class="num ' + (p.target_gap == null ? '' : p.target_gap >= 0 ? 'cs-gap-ok' : 'cs-gap-bad') + '">' + (p.target_gap == null ? '—' : (p.target_gap >= 0 ? '+' : '') + f3(p.target_gap)) + '</td>'; }).join('') + '</tr>' +
        '<tr><td>Margin at target</td>' + ps.map(function (p) { return '<td class="num">' + (p.margin_at_target_pct == null ? '—' : p.margin_at_target_pct + '%') + '</td>'; }).join('') + '</tr>' +
        '<tr><td>Profit % to hit target</td>' + ps.map(function (p) { return '<td class="num">' + (p.profit_pct_at_target == null ? '—' : p.profit_pct_at_target + '%') + '</td>'; }).join('') + '</tr>';
    }
    $('cs-sum').innerHTML = html;
    var prow = function (label, f, cls) { return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + label + '</td>' + ps.map(function (p) { return '<td class="num">' + f(p) + '</td>'; }).join('') + '</tr>'; };
    $('cs-profit').innerHTML = '<tr><th></th>' + sizes.map(function (s) { return '<th class="num">' + esc(s) + '</th>'; }).join('') + '</tr>' +
      prow('Cost (sub-total)', function (p) { return f3(p.subtotal); }) +
      prow('Commission $', function (p) { return f3(p.commission); }) +
      prow('Profit $', function (p) { return f3(p.profit); }, 'total') +
      (ps.some(function (p) { return p.other_markup; }) ? prow('Other mark-up $', function (p) { return f3(p.other_markup); }) : '') +
      prow('Profit margin (on FOB)', function (p) { return p.profit_margin_pct + '%'; }) +
      prow('Profit on cost', function (p) { return p.profit_on_cost_pct + '%'; }) +
      prow('Gross margin (all mark-ups)', function (p) { return p.gross_margin_pct + '%'; }) +
      prow('Factory net after commission', function (p) { return f3(p.factory_net); }, 'fob') +
      prow('Profit / dozen', function (p) { return f2(p.profit * 12); });
    $('cs-sens').innerHTML = '<tr><th></th>' + sizes.map(function (s) { return '<th class="num">' + esc(s) + '</th>'; }).join('') + '</tr>' +
      r.sensitivity.map(function (s) { return '<tr><td>' + esc(s.label) + '</td>' + s.per_size.map(function (v) { return '<td class="num">+' + f3(v) + '</td>'; }).join('') + '</tr>'; }).join('');
    $('cs-ordercard').hidden = !r.order;
    if (r.order) {
      var o = r.order;
      $('cs-orderres').innerHTML = '<div class="cs-big"><div><small>Weighted FOB</small><b>$' + f2(o.weighted_fob_pc) + '</b></div><div><small>Order value</small><b>$' + Math.round(o.value).toLocaleString() + '</b></div>' +
        '<div><small>Order cost</small><b>$' + Math.round(o.cost).toLocaleString() + '</b></div><div><small>Commission</small><b>$' + Math.round(o.commission).toLocaleString() + '</b></div><div><small>Profit</small><b>$' + Math.round(o.profit).toLocaleString() + '</b></div></div>' +
        '<div style="font-size:12px;color:var(--t2);margin-bottom:6px">' + o.pieces_by_size.map(function (p) { return esc(p.size) + ' ' + p.pieces.toLocaleString(); }).join(' · ') + ' pcs</div>' +
        '<div class="cs-scroll"><table class="cs-t"><tr><th>Shell</th><th class="num">Finished kg</th><th class="num">Grey kg</th><th>Yarn to book</th></tr>' +
        o.fabric.map(function (f) { return '<tr><td>' + esc(f.shell) + '</td><td class="num">' + Math.round(f.finished_kg).toLocaleString() + '</td><td class="num">' + Math.round(f.grey_kg).toLocaleString() + '</td><td>' + f.yarn_kg.map(function (y) { return esc(y.yarn) + ': <b>' + Math.round(y.kg).toLocaleString() + ' kg</b>'; }).join('<br>') + '</td></tr>'; }).join('') + '</table></div>';
    }
    $('cs-shellres').innerHTML = '<div class="cs-scroll"><table class="cs-t"><tr><th>Shell</th><th class="num">Yarn</th><th class="num">Knit</th><th class="num">Dye</th><th class="num">Finish</th><th class="num">Loss</th><th class="num">$/kg</th></tr>' +
      r.shells.map(function (s) { return '<tr><td>' + esc(s.name) + '</td><td class="num">' + f3(s.prices.yarn.value) + '</td><td class="num">' + f3(s.prices.knitting.value) + '</td><td class="num">' + f3(s.prices.dyeing.value) + '</td><td class="num">' + f3(s.prices.finishing.value) + '</td><td class="num">' + s.prices.loss_pct.value + '%</td><td class="num"><b>' + f3(s.price_per_kg) + '</b></td></tr>'; }).join('') + '</table></div>';
    $('cs-method').textContent = r.method_note;
    paintSources();
  }

  // ── events ─────────────────────────────────────────────────────────────
  function onEdit(e) {
    var el = e.target, k = el.getAttribute && el.getAttribute('data-k');
    if (!k) return;
    var v = el.type === 'checkbox' ? el.checked : el.value;
    setPath(S, k, v);
    // a structural change redraws its part of the form
    if (/^shells\.\d+\.(yarns\.\d+\.type|aop|consumption_unit)$/.test(k)) renderShells();
    schedule();
  }
  document.addEventListener('input', function (e) { if (e.target.closest && e.target.closest('#cs-form, .cs-bar')) onEdit(e); });
  document.addEventListener('change', function (e) {
    if (!(e.target.closest && e.target.closest('#cs-form'))) return;
    var ym = e.target.getAttribute('data-ymode');
    if (ym != null) { setYarnMode(+ym, e.target.value); return; }
    if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox') onEdit(e);
  });
  // own yarns start from the plan on screen, so switching never loses the breakdown
  function setYarnMode(i, mode) {
    var sh = S.shells[i];
    if (mode === 'manual') {
      var ans = last && last.success && last.shells[i];
      if (ans && ans.yarn_mode === 'auto') sh.yarns = ans.yarns.map(function (y) { return { role: y.role || '', type: y.type, count: y.count || '', share_pct: y.share_pct, price: '' }; });
    }
    sh.yarn_mode = mode; renderShells(); schedule();
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || !b.closest('#cs-form')) return;
    var a;
    if ((a = b.getAttribute('data-reauto'))) {
      setPath(S, a, '');
      var inp = document.querySelector('[data-k="' + a + '"]'); if (inp) inp.value = '';
      schedule(); return;
    } else if ((a = b.getAttribute('data-edityarns'))) {
      setYarnMode(+a, 'manual'); return;
    } else if ((a = b.getAttribute('data-fill'))) {
      var arr = getPath(S, a) || [], v0 = arr[0];
      if (v0 === '' || v0 == null) return;
      for (var k = 0; k < n(); k++) arr[k] = v0;
      setPath(S, a, arr);
    } else if ((a = b.getAttribute('data-rmsize')) != null && b.hasAttribute('data-rmsize')) {
      var i = +a;
      S.sizes.splice(i, 1);
      dropSizeColumn(i);
    } else if ((a = b.getAttribute('data-rmshell'))) { S.shells.splice(+a, 1); }
    else if ((a = b.getAttribute('data-addyarn'))) { S.shells[+a].yarns.push({ role: '', type: 'spandex_40d', count: '', share_pct: 5, price: '' }); }
    else if ((a = b.getAttribute('data-rmyarn'))) { var q = a.split('.'); S.shells[+q[0]].yarns.splice(+q[1], 1); }
    else if ((a = b.getAttribute('data-addline'))) { S[a].push({ name: '', values: [] }); }
    else if ((a = b.getAttribute('data-rmline'))) { var r = a.split('.'); S[r[0]].splice(+r[1], 1); }
    else if (b.hasAttribute('data-addmarkup')) { S.markups.push({ name: '', kind: 'other', pct: '' }); }
    else return;
    renderForm(); schedule();
  });

  // removing a size removes its column everywhere
  function dropSizeColumn(i) {
    var cut = function (arr) { if (Array.isArray(arr) && arr.length > i) arr.splice(i, 1); };
    S.shells.forEach(function (sh) { cut(sh.consumption); });
    ['trims', 'embellishments', 'washes', 'packaging'].forEach(function (k) { S[k].forEach(function (l) { cut(l.values); }); });
    cut(S.testing); cut(S.cm.smv); cut(S.cm.direct); cut(S.order.ratio); cut(S.target_fob);
  }
  function addSizes(list) {
    list.forEach(function (s) {
      s = String(s || '').trim();
      if (s && S.sizes.length < 12 && !S.sizes.some(function (x) { return x.toLowerCase() === s.toLowerCase(); })) S.sizes.push(s);
    });
    renderForm(); schedule();
  }
  $('cs-size-add').addEventListener('click', function () { addSizes([$('cs-size-new').value]); $('cs-size-new').value = ''; });
  $('cs-size-new').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('cs-size-add').click(); } });
  $('cs-size-preset').addEventListener('change', function () {
    if (!this.value) return;
    if (!confirm('Replace the sizes with ' + this.value.split('|').join(', ') + '? Per-size figures are kept by position.')) { this.value = ''; return; }
    S.sizes = this.value.split('|'); this.value = ''; renderForm(); schedule();
  });
  // the extra fabrics a garment carries, each costed as its own shell
  var SHELL_KINDS = {
    body: {},
    rib: { application: 'Rib — cuff, collar, hem', fabric: 'lycra_rib_1x1', composition: '95% cotton 5% elastane', gsm: 260 },
    rib_plain: { application: 'Rib — cuff, collar, hem', fabric: 'rib_1x1', composition: '100% cotton', gsm: 240 },
    neck_tape: { application: 'Neck tape', fabric: 'single_jersey', composition: '100% cotton', gsm: 150, consumption: [] },
    hood: { application: 'Hood lining', fabric: 'single_jersey', composition: '100% cotton', gsm: 160 },
    pocket: { application: 'Pocket bag', fabric: 'single_jersey', composition: '100% cotton', gsm: 140 },
  };
  $('cs-shell-add').addEventListener('click', function () {
    if (S.shells.length >= 8) return;
    var sh = Object.assign(blankShell(S.shells.length), SHELL_KINDS[$('cs-shell-kind').value] || {});
    S.shells.push(sh); renderForm(); schedule();
  });

  // picture: shrunk to 640 px JPEG in the browser before it is kept
  function takePicture(file) {
    if (!file || !/^image\//.test(file.type)) return;
    var img = new Image(), url = URL.createObjectURL(file);
    img.onload = function () {
      var k = Math.min(1, 640 / Math.max(img.width, img.height));
      var c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      S.picture = c.toDataURL('image/jpeg', 0.8); URL.revokeObjectURL(url); renderPicture();
    };
    img.src = url;
  }
  $('cs-pic').addEventListener('click', function () { $('cs-pic-file').click(); });
  $('cs-pic').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('cs-pic-file').click(); } });
  $('cs-pic-file').addEventListener('change', function () { takePicture(this.files[0]); this.value = ''; });
  $('cs-pic').addEventListener('dragover', function (e) { e.preventDefault(); });
  $('cs-pic').addEventListener('drop', function (e) { e.preventDefault(); takePicture(e.dataTransfer.files[0]); });
  $('cs-pic-clear').addEventListener('click', function () { S.picture = null; renderPicture(); });

  // ── saving ─────────────────────────────────────────────────────────────
  var saved = [];
  function sheetName() { return (S.header.style || '').trim() || 'Untitled sheet'; }
  function refreshSaved() {
    return apiFetch('/api/cost-sheet/sheets').then(function (r) {
      saved = r.sheets || [];
      $('cs-saved').innerHTML = '<option value="">Saved sheets (' + saved.length + ')…</option>' + saved.map(function (s) {
        return '<option value="' + s.id + '">' + esc(s.name) + ' · ' + new Date(s.updated_at).toLocaleDateString() + (s.versions ? ' · ' + s.versions + ' earlier' : '') + '</option>';
      }).join('');
    }).catch(function () {});
  }
  function flash(t) { $('cs-savemsg').textContent = t; setTimeout(function () { $('cs-savemsg').textContent = ''; }, 3000); }
  $('cs-save').addEventListener('click', function () {
    apiFetch('/api/cost-sheet/sheets', { method: 'PUT', body: { name: sheetName(), sheet: S } }).then(function (r) {
      currentId = r.sheet.id; $('cs-del').hidden = false; flash('Saved as "' + r.sheet.name + '"' + (r.sheet.versions ? ' — earlier version kept' : '') + '.'); refreshSaved();
    }).catch(function (e) { flash((e.data && e.data.error) || 'Could not save.'); });
  });
  $('cs-saved').addEventListener('change', function () {
    var id = this.value; this.value = ''; if (!id) return;
    openSaved(id);
  });
  // a saved sheet opened by id — from the list above or a ?sheet= link (dashboard, search)
  function openSaved(id) {
    return apiFetch('/api/cost-sheet/sheets/' + encodeURIComponent(id)).then(function (r) {
      S = Object.assign(blank(), r.sheet.sheet); currentId = r.sheet.id; $('cs-del').hidden = false; renderForm(); cost();
      flash('Opened "' + r.sheet.name + '".');
    }).catch(function (e) { flash((e.data && e.data.error) || 'Could not open it.'); cost(); });
  }
  $('cs-del').addEventListener('click', function () {
    if (!currentId || !confirm('Delete "' + sheetName() + '" from your account?')) return;
    apiFetch('/api/cost-sheet/sheets/' + currentId, { method: 'DELETE' }).then(function () { currentId = null; $('cs-del').hidden = true; flash('Deleted.'); refreshSaved(); })
      .catch(function (e) { flash((e.data && e.data.error) || 'Could not delete.'); });
  });
  $('cs-new').addEventListener('click', function () { if (!confirm('Start a new, empty sheet? Unsaved changes are lost.')) return; S = blank(); currentId = null; $('cs-del').hidden = true; renderForm(); cost(); });
  $('cs-dup').addEventListener('click', function () { S.header.style = (S.header.style || 'Sheet') + ' (copy)'; currentId = null; $('cs-del').hidden = true; renderForm(); flash('Copy made — save it under its new name.'); });
  $('cs-example').addEventListener('click', function () { S = example(); currentId = null; $('cs-del').hidden = true; renderForm(); cost(); });
  $('cs-print').addEventListener('click', function () { window.print(); });
  $('cs-pdf').addEventListener('click', function () {
    var btn = this; btn.disabled = true; btn.textContent = 'Making PDF…';
    var body = payload(); if (S.picture) body.picture = S.picture;
    fetch(API_BASE + '/api/cost-sheet/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (res) {
        if (!res.ok) return res.json().then(function (d) { throw new Error(d.error || 'Could not make the PDF.'); });
        return res.blob();
      }).then(function (blob) {
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'Costing-' + (S.header.style || 'sheet').replace(/[^\w.-]+/g, '_') + '.pdf';
        document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
      }).catch(function (e) { flash(e.message); })
      .then(function () { btn.disabled = false; btn.textContent = 'Download PDF'; });
  });
  function cpmCalc() {
    var c = num($('cpm-cost').value), o = num($('cpm-ops').value), d = num($('cpm-days').value), hh = num($('cpm-hours').value);
    var v = c && o && d && hh ? c / (o * d * hh * 60) : null;
    $('cpm-out').textContent = v ? 'Cost per minute = ' + c + ' ÷ (' + o + ' × ' + d + ' × ' + hh + ' × 60) = $' + v.toFixed(4) : 'Cost per minute = monthly cost ÷ (operators × days × hours × 60).';
    return v;
  }
  ['cpm-cost', 'cpm-ops', 'cpm-days', 'cpm-hours'].forEach(function (id) { $(id).addEventListener('input', cpmCalc); });
  $('cpm-use').addEventListener('click', function () {
    var v = cpmCalc(); if (!v) return;
    S.cm.cpm = +v.toFixed(4); document.querySelector('[data-k="cm.cpm"]').value = S.cm.cpm; renderCM(); schedule();
  });

  // ── Excel: SpreadsheetML in the quotation layout (opens in Excel / LibreOffice) ──
  $('cs-xls').addEventListener('click', function () {
    if (!last || !last.success) { flash('Cost the sheet first.'); return; }
    var r = last, sz = r.sizes, h = S.header;
    var x = function (v) { return esc(v == null ? '' : v); };
    var cell = function (v, st) {
      if (v == null || v === '') return '<Cell' + (st ? ' ss:StyleID="' + st + '"' : '') + '/>';
      return typeof v === 'number' ? '<Cell ss:StyleID="' + (st || 'n') + '"><Data ss:Type="Number">' + v + '</Data></Cell>' : '<Cell' + (st ? ' ss:StyleID="' + st + '"' : '') + '><Data ss:Type="String">' + x(v) + '</Data></Cell>';
    };
    var rows = [];
    var R = function () { rows.push('<Row>' + Array.prototype.slice.call(arguments).join('') + '</Row>'); };
    R(cell('QUOTATION SHEET — ' + (h.style || ''), 'title'));
    [['Date', h.date], ['Buyer / to', h.buyer], ['Department', h.department], ['From', h.from], ['Factory', h.factory], ['Style / item ref', h.style], ['Order no.', h.order_no], ['Description', h.description], ['Pack of', r.pack_of]].forEach(function (p) { R(cell(p[0], 'b'), cell(p[1])); });
    R();
    R(cell('FABRIC COST BREAKDOWN PER KG', 'h'));
    R(cell('', 'b'), ...r.shells.map(function (s) { return cell(s.name, 'b'); }));
    var srow = function (label, f) { R(cell(label), ...r.shells.map(function (s) { return cell(f(s)); })); };
    srow('Application', function (s) { return s.application; });
    srow('Fabrication', function (s) { return s.composition + (s.gsm ? ' ' + s.gsm + ' GSM' : '') + ' — ' + s.fabric.replace(/_/g, ' '); });
    srow('Yarn', function (s) { return s.yarns.map(function (y) { return y.share_pct + '% ' + y.label + (y.count ? ' ' + y.count + 's' : ''); }).join(' + '); });
    srow('Yarn price /kg', function (s) { return s.prices.yarn.value; });
    srow('Yarn dyeing /kg', function (s) { return s.prices.yarn_dyeing.value; });
    srow('Knitting /kg', function (s) { return s.prices.knitting.value; });
    srow('Dyeing /kg', function (s) { return s.prices.dyeing.value; });
    srow('Finishing /kg', function (s) { return s.prices.finishing.value; });
    srow('AOP /kg', function (s) { return s.prices.aop.value; });
    srow('Process loss %', function (s) { return s.prices.loss_pct.value; });
    srow('Fabric price /kg', function (s) { return s.price_per_kg; });
    R();
    R(cell('PER SIZE', 'h'), ...sz.map(function (s) { return cell(s, 'b'); }));
    r.shells.forEach(function (s) { R(cell(s.name + ' consumption kg/pc'), ...s.consumption_kg_pc.map(function (v) { return cell(v); })); R(cell(s.name + ' cost'), ...s.cost.map(function (v) { return cell(v); })); });
    var lineRows = function (title, list) { if (!list.length) return; R(cell(title, 'b')); list.forEach(function (l) { R(cell(l.name), ...l.values.map(function (v) { return cell(v); })); }); };
    lineRows('Trims', r.trims); lineRows('Embellishment', r.embellishments); lineRows('Wash', r.washes); lineRows('Packaging', r.packaging);
    R(cell('Testing'), ...r.testing.map(function (v) { return cell(v); }));
    R(cell('CM' + (r.cm.direct ? '' : ' (SMV × ' + r.cm.cpm + ')')), ...r.cm.per_size.map(function (v) { return cell(v); }));
    R();
    R(cell('SUMMARY', 'h'), ...sz.map(function (s) { return cell(s, 'b'); }));
    [['Total fabric', 'fabric'], ['Total trims', 'trims'], ['Total embellishment', 'embellishment'], ['Total wash', 'wash'], ['Total CM', 'cm'], ['Total packaging', 'packaging'], ['Total testing', 'testing'], ['Sub-total', 'subtotal'], ['Commission & profit (' + r.markup_pct + '%)', 'markup'], ['TOTAL FOB / pc', 'fob_pc'], ['FOB / pack', 'fob_pack'], ['FOB / dozen', 'fob_dozen']]
      .forEach(function (q) { R(cell(q[0], q[1] === 'fob_pc' ? 'b' : null), ...r.per_size.map(function (p) { return cell(p[q[1]], q[1] === 'fob_pc' ? 'bn' : 'n'); })); });
    R(cell('Comments: ' + r.markups.map(function (m) { return m.name + ' ' + m.pct + '%'; }).join(', ')));
    var xml = '<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>' +
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
      '<Styles><Style ss:ID="title"><Font ss:Bold="1" ss:Size="14"/></Style><Style ss:ID="h"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1857C4" ss:Pattern="Solid"/></Style>' +
      '<Style ss:ID="b"><Font ss:Bold="1"/></Style><Style ss:ID="n"><NumberFormat ss:Format="0.000"/></Style><Style ss:ID="bn"><Font ss:Bold="1"/><NumberFormat ss:Format="0.00"/></Style></Styles>' +
      '<Worksheet ss:Name="' + x((h.style || 'Costing').slice(0, 30)) + '"><Table><Column ss:Width="230"/>' + rows.join('') + '</Table></Worksheet></Workbook>';
    var blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'Costing-' + (h.style || 'sheet').replace(/[^\w.-]+/g, '_') + '.xls';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  });

  // ── start ──────────────────────────────────────────────────────────────
  apiFetch('/api/cost-sheet/options').then(function (o) {
    OPTS = o; renderForm(); refreshSaved();
    var want = new URLSearchParams(window.location.search).get('sheet');
    if (want && /^\d+$/.test(want)) openSaved(want); else cost();
  })
    .catch(function () { $('cs-status').className = 'cs-msg err'; $('cs-status').textContent = 'Could not load the price lists. Sign in and reload.'; });
})();
