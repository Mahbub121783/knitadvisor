// KnitAdvisor · Cost a Studio design — the Calculator side of the Fabric Studio.
// The Studio designs and saves the fabric; the cost is worked out here, on the saved design.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fmt = function (v) { return Number(v).toLocaleString('en', { maximumFractionDigits: 3 }); };
  var designs = [], meta = null;
  var want = new URLSearchParams(window.location.search).get('design');

  function load() {
    return window.apiFetch('/api/studio/designs').then(function (r) {
      designs = (r.designs || []).filter(function (d) { return d.design && d.design.tech === 'warp'; });
      $('sc-design').innerHTML = '<option value="">Choose a saved design…</option>' + designs.map(function (d) { return '<option value="' + d.id + '">' + esc(d.name) + '</option>'; }).join('');
      $('sc-empty').hidden = designs.length > 0;
      if (want && designs.some(function (d) { return String(d.id) === want; })) { $('sc-design').value = want; pick(); }
    }).catch(function () { $('sc-empty').hidden = false; $('sc-empty').textContent = 'Could not load your saved designs.'; });
  }

  // read the design once (no prices yet) to show what it is and ask for each bar's yarn price
  function pick() {
    var id = $('sc-design').value;
    $('sc-out-card').hidden = true;
    if (!id) { $('sc-meta').textContent = ''; $('sc-prices-card').hidden = true; return; }
    $('sc-meta').textContent = 'Reading the design…';
    window.apiFetch('/api/studio/warp/cost', { method: 'POST', body: { design_id: +id, prices: {} } }).then(show, function (e) { show(e.data || {}); });
  }
  function show(r) {
    if (!r.success && !r.bars) { $('sc-meta').innerHTML = '<div class="st-err">' + esc(r.error || 'Could not read the design.') + '</div>'; $('sc-prices-card').hidden = true; return; }
    meta = r;
    var f = r.fabric;
    $('sc-meta').innerHTML = '<b>' + esc(r.name) + '</b> — ' + esc(r.structure.name || 'warp knit') + ' · ' + esc(r.machine.label) + ' · E' + r.machine.gauge + '<br>' + f.gsm + ' GSM · ' + f.width_in + '" finished · ' + f.wpc + ' × ' + f.cpc + ' wales × courses /cm' + (r.ok_to_knit ? '' : ' · <b style="color:var(--danger)">this design does not knit as drawn — fix it in the Studio first</b>');
    var saved = {};
    Array.prototype.forEach.call($('sc-yarn').querySelectorAll('input'), function (i) { saved[i.dataset.bar] = i.value; });
    $('sc-yarn').innerHTML = r.bars.map(function (b) {
      return '<div class="st-f"><label>GB' + b.bar + ' · ' + esc(b.yarn) + ' ' + esc(b.fibre) + '</label><input type="number" min="0" step="0.01" data-bar="' + b.bar + '" value="' + esc(saved[b.bar] || '') + '" placeholder="price per kg"></div>';
    }).join('');
    $('sc-prices-card').hidden = false;
  }
  function calc() {
    var yarn = Array.prototype.map.call($('sc-yarn').querySelectorAll('input'), function (i) { return parseFloat(i.value) || null; });
    var n = function (id) { return parseFloat($(id).value) || 0; };
    $('sc-out-card').hidden = false; $('sc-out').innerHTML = '<span style="color:var(--t3)">Calculating…</span>';
    window.apiFetch('/api/studio/warp/cost', { method: 'POST', body: { design_id: +$('sc-design').value, prices: { yarn: yarn, dyeing_per_kg: n('sc-dye'), finishing_per_kg: n('sc-fin'), other_per_m: n('sc-oth') } } }).then(function (r) {
      var c = r.cost;
      if (!c || !c.success) { $('sc-out').innerHTML = '<div class="st-err">' + esc((c && c.error) || r.error || 'Could not cost this design.') + '</div>'; return; }
      $('sc-out').innerHTML = '<div class="st-kpis">' +
        '<div class="st-kpi"><div class="l">Per finished metre</div><div class="v">' + fmt(c.cost_per_m) + '</div><div class="s">yarn ' + fmt(c.yarn_cost_per_m) + ' + processing ' + fmt(c.process_cost_per_m) + '</div></div>' +
        '<div class="st-kpi"><div class="l">Per m²</div><div class="v">' + fmt(c.cost_per_m2) + '</div><div class="s">' + c.gsm + ' GSM, ' + fmt(c.width_m * 39.37) + '" wide</div></div>' +
        '<div class="st-kpi"><div class="l">Per kg of fabric</div><div class="v">' + fmt(c.cost_per_kg_fabric) + '</div><div class="s">' + fmt(c.fabric_kg_per_m) + ' kg per metre</div></div>' +
        '<div class="st-kpi"><div class="l">Yarn share</div><div class="v">' + c.yarn_share_pct + '%</div><div class="s">' + fmt(c.yarn_kg_per_m) + ' kg of yarn per metre</div></div></div>' +
        '<div class="st-scroll"><table class="st-t"><tr><th>Bar</th><th>Yarn</th><th>Price / kg</th><th>Yarn / m</th><th>Cost / m</th></tr>' +
        c.per_bar.map(function (x) { return '<tr><td>GB' + x.bar + '</td><td>' + esc(x.yarn) + '</td><td>' + fmt(x.price) + '</td><td>' + fmt(x.kg_per_m) + ' kg</td><td>' + fmt(x.cost_per_m) + '</td></tr>'; }).join('') + '</table></div>' +
        '<p class="st-hint">In the currency of your prices. ' + esc(c.basis.charAt(0).toUpperCase() + c.basis.slice(1)) + '.</p>';
    }, function (e) { $('sc-out').innerHTML = '<div class="st-err">' + esc((e.data && (e.data.error || (e.data.cost && e.data.cost.error))) || e.message) + '</div>'; });
  }
  $('sc-design').addEventListener('change', pick);
  $('sc-go').addEventListener('click', calc);
  load();
})();
