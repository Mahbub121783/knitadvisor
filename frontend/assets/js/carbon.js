// KnitAdvisor · Carbon footprint — one fabric, its footprint stage by stage, and the levers that cut it.
// Every number comes from POST /api/carbon; this page only lays it out. A lever switched on is sent
// back to the engine, which re-runs the whole model with it (nothing here adds percentages).
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fmt = function (v, d) { return v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('en', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }); };
  var COUNTRY = { bangladesh: 'Bangladesh', india: 'India', china: 'China', vietnam: 'Vietnam', turkiye: 'Türkiye', pakistan: 'Pakistan' };
  var STAGE_COL = { fibre: '#4ade80', spinning: '#60a5fa', formation: '#a78bfa', wet: '#fbbf24', finishing: '#fb923c', transport: '#f472b6' };
  var CAPEX = { none: 'no spend', low: 'low spend', medium: 'medium spend', high: 'high spend' };
  var on = new Set(), shade = 'medium', finishing = null, last = null, timer = null, seq = 0;

  function inputs() {
    return {
      composition: $('cb-comp').value.trim() || '100% Cotton', gsm: +$('cb-gsm').value || 180, fabric_family: $('cb-fam').value,
      shade: shade, dyeing_method: $('cb-dye').value || null, spinning_system: $('cb-spin').value || null, process_loss_pct: $('cb-loss').value,
      country: $('cb-country').value, boiler_fuel: $('cb-fuel').value, garment_weight_g: $('cb-garment').value || null,
      finishing: finishing, apply_levers: Array.from(on),
    };
  }
  function go(delay) {
    clearTimeout(timer);
    timer = setTimeout(function () {
      var my = ++seq;
      $('cb-out').classList.add('cb-wait');
      window.apiFetch('/api/carbon', { method: 'POST', body: inputs() }).then(function (r) {
        if (my !== seq) return;
        last = r; render(r);
      }).catch(function (e) {
        if (my !== seq) return;
        $('cb-out').innerHTML = '<div class="cb-card"><div class="cb-err">' + esc(e.message || 'The footprint could not be worked out.') + '</div></div>';
      }).then(function () { if (my === seq) $('cb-out').classList.remove('cb-wait'); });
    }, delay == null ? 250 : delay);
  }

  function tag(t) { return t ? '<span class="tag ' + esc(t) + '">' + esc(t) + '</span>' : ''; }

  function hero(r) {
    var g = r.grade, rg = r.range, eq = r.equivalents, pg = r.per_garment;
    return '<div class="cb-card"><div class="cb-hero">' +
      '<div class="cb-grade g-' + g.letter + '" title="' + esc(g.scale) + '">' + g.letter + '<small>grade</small></div>' +
      '<div><div class="cb-big">' + fmt(r.total_co2e_per_kg_fabric) + ' <span>kg CO2e per kg of fabric</span></div>' +
      '<div class="cb-sub">Lower than <b>' + fmt(g.lower_than_pct, 0) + '%</b> of ' + g.cohort_n + ' typical ' + esc(r.inputs_used.family) + ' fabrics made in ' + esc(COUNTRY[r.inputs_used.country] || r.inputs_used.country) + ' with the same boiler fuel (their median ' + fmt(g.cohort_median) + '). ' +
      'Likely range <b>' + fmt(rg.p5, 1) + '–' + fmt(rg.p95, 1) + '</b> (P5–P95 of ' + rg.monte_carlo_runs.toLocaleString('en') + ' runs).</div></div></div>' +
      '<div class="cb-eq">' +
        '<div><b>' + fmt(eq.per_tshirt.co2e_kg, 2) + ' kg</b><small>per basic T-shirt (' + eq.per_tshirt.fabric_kg * 1000 + ' g of fabric)</small></div>' +
        (pg ? '<div><b>' + fmt(pg.total_co2e_kg, 2) + ' kg</b><small>per your ' + esc(pg.garment_weight_g) + ' g garment, with ' + fmt(pg.cut_waste_pct, 1) + '% cutting waste</small></div>' : '') +
        '<div><b>' + fmt(eq.order_10000_tshirts_t, 1) + ' t</b><small>for an order of 10,000 T-shirts</small></div>' +
        '<div><b>' + fmt(eq.per_tshirt.car_km, 1) + ' km</b><small>a petrol car drives on one T-shirt\'s CO2e</small></div>' +
        '<div><b>' + eq.per_tshirt.tree_days + ' days</b><small>for a grown tree to take it back up</small></div>' +
        '<div><b>' + fmt(r.total_co2e_per_m2_fabric, 3) + '</b><small>kg CO2e per m² at ' + esc(r.inputs_used.gsm) + ' GSM</small></div>' +
      '</div><p class="cb-small" style="margin:8px 0 0">' + esc(eq.note) + '</p></div>';
  }

  function stages(r) {
    var rows = r.stages.map(function (s) {
      var c = STAGE_COL[s.id] || '#999';
      return '<div class="cb-st"><span class="dot" style="background:' + c + '"></span><span>' + esc(s.name) + tag(s.data_tier) + '<small>' + esc(s.scope) + (s.kwh_electricity != null ? ' · ' + fmt(s.kwh_electricity, 2) + ' kWh electricity' : '') + (s.kwh_fuel != null ? ' · ' + fmt(s.kwh_fuel, 2) + ' kWh fuel' : '') + '</small></span><span class="v">' + fmt(s.co2e_per_kg_fabric) + ' <span style="color:var(--t3)">' + fmt(s.share_pct, 0) + '%</span></span></div>';
    }).join('');
    var mb = r.mass_balance, fb = r.fiber_breakdown.map(function (f) {
      return f.modeled ? esc(f.pct) + '% ' + esc(f.fiber) + (f.variant ? ' (' + esc(f.variant) + ')' : '') + ' ' + fmt(f.co2e_per_kg_fiber) + ' kg CO2e/kg' + tag(f.confidence) : esc(f.pct) + '% ' + esc(f.fiber) + ' <b style="color:#C76A00">not modelled</b>';
    }).join(' · ');
    return '<div class="cb-card"><h2>Where it comes from <small>— stage by stage, per kg of finished fabric</small></h2>' +
      '<div class="cb-bar">' + r.stages.map(function (s) { return '<i title="' + esc(s.name) + '" style="width:' + s.share_pct + '%;background:' + (STAGE_COL[s.id] || '#999') + '"></i>'; }).join('') + '</div>' + rows +
      '<p class="cb-small" style="margin:10px 0 0"><b>Fibre:</b> ' + fb + '<br><b>Mass balance:</b> 1 kg finished ← ' + fmt(mb.per_kg_finished.grey_fabric_kg, 3) + ' kg grey (' + fmt(mb.wet_processing_loss_pct, 1) + '% lost in processing) ← ' + fmt(mb.per_kg_finished.yarn_kg, 3) + ' kg yarn ← ' + fmt(mb.per_kg_finished.fibre_kg, 3) + ' kg fibre (' + fmt(mb.spinning_waste_pct, 1) + '% spinning waste). Every stage is charged on the mass that really passes through it.</p></div>';
  }

  function levers(r) {
    var R = r.reduction, L = R.levers, w = r.what_if, base = r.total_co2e_per_kg_fabric, p = R.pathway;
    var max = Math.max.apply(null, L.map(function (l) { return l.saving_kg_per_kg; }).concat([0.01]));
    var now = w ? w.total : base, cutPct = w ? w.cut_pct : 0;
    var what = '<div class="cb-what"><div class="row"><span class="from">' + fmt(base) + '</span><span style="color:var(--t3)">→</span><span class="to">' + fmt(now) + '</span><span class="cb-small">kg CO2e per kg</span>' +
      (w ? '<span class="cut">−' + fmt(cutPct, 1) + '%</span><span class="cut" style="color:var(--t1)">grade ' + esc(r.grade.letter) + ' → ' + esc(w.grade) + '</span>' : '') + '</div>' +
      '<div class="track"><i style="width:' + Math.max(2, 100 - cutPct) + '%"></i></div>' +
      '<div class="note">' + (w ? 'With the ' + w.levers.length + ' lever' + (w.levers.length > 1 ? 's' : '') + ' switched on, run together: <b>' + fmt(w.per_tshirt_kg, 2) + ' kg</b> per T-shirt, <b>' + fmt(w.order_10000_tshirts_t, 1) + ' t</b> for 10,000 — a saving of <b>' + fmt(r.equivalents.order_10000_tshirts_t - w.order_10000_tshirts_t, 1) + ' t CO2e</b> on that order. Water to fill the baths ' + fmt(r.water.bath_fill_l_per_kg, 0) + ' → ' + fmt(w.water_l_per_kg, 0) + ' L/kg; energy ' + fmt(r.energy_intensity.total_mj_per_kg, 0) + ' → ' + fmt(w.energy_mj_per_kg, 0) + ' MJ/kg.'
        : 'Switch levers on below and the whole model is re-run with them together, so savings that overlap are not counted twice.') + '</div>' +
      '<div class="cb-btns"><button type="button" class="cb-btn primary" data-path="mill">Best-practice mill: −' + fmt(p.best_practice_mill.cut_pct, 0) + '%</button>' +
      '<button type="button" class="cb-btn primary" data-path="all">+ preferred fibres: −' + fmt(p.plus_preferred_fibre.cut_pct, 0) + '%</button>' +
      (w ? '<button type="button" class="cb-btn" data-path="none">Clear</button>' : '') + '</div></div>';
    var rows = L.map(function (l) {
      var pressed = on.has(l.id);
      return '<div class="cb-lv"><button type="button" class="cb-sw" data-lever="' + esc(l.id) + '" aria-pressed="' + pressed + '" aria-label="' + esc(l.name) + '"></button>' +
        '<div><b>' + esc(l.name) + '</b><span class="capex">' + esc(CAPEX[l.capex] || l.capex) + '</span><div class="how">' + esc(l.how) + '</div>' +
        '<div class="meta">' + esc(l.change) + (l.fuel_kwh_saved_per_kg > 0.01 ? ' · saves ' + fmt(l.fuel_kwh_saved_per_kg, 2) + ' kWh fuel/kg' : '') + (l.elec_kwh_saved_per_kg > 0.01 ? ' · ' + fmt(l.elec_kwh_saved_per_kg, 2) + ' kWh grid power/kg' : '') + (l.water_l_saved_per_kg > 0 ? ' · ' + fmt(l.water_l_saved_per_kg, 0) + ' L water/kg' : '') + (l.note ? '<br>' + esc(l.note) : '') + '</div></div>' +
        '<div class="sv"><b>−' + fmt(l.saving_pct, 1) + '%</b><small>' + fmt(l.saving_kg_per_kg) + ' kg/kg · ' + l.saving_kg_per_tonne.toLocaleString('en') + ' kg per tonne</small><div class="sbar"><i style="width:' + (l.saving_kg_per_kg / max * 100).toFixed(0) + '%"></i></div></div></div>';
    }).join('');
    return '<div class="cb-card"><h2>The strongest ways to cut it <small>— ranked for this fabric, each one the whole model re-run</small></h2>' + what + rows +
      '<p class="cb-small" style="margin:10px 0 0">' + esc(p.note) + ' The settings of each lever are typical best practice (modelled); the spend class is a rough guide.</p></div>';
  }

  function countries(r) {
    var max = Math.max.apply(null, r.by_country.map(function (c) { return c.total; }));
    return '<div class="cb-card"><h2>The same fabric made elsewhere <small>— only the grid electricity changes</small></h2>' +
      r.by_country.map(function (c) {
        return '<div class="cb-cty' + (c.this ? ' me' : '') + '"><span>' + esc(COUNTRY[c.country] || c.country) + '</span><span class="b"><i style="width:' + (c.total / max * 100).toFixed(0) + '%"></i></span><span class="mono" style="text-align:right">' + fmt(c.total) + '</span></div>';
      }).join('') + '<p class="cb-small" style="margin:8px 0 0">Grid factors in kg CO2 per kWh: ' + r.by_country.map(function (c) { return esc(COUNTRY[c.country] || c.country) + ' ' + c.grid; }).join(' · ') + '.</p></div>';
  }

  function resources(r) {
    var e = r.energy_intensity, w = r.water, wp = r.wet_processing;
    return '<div class="cb-card"><h2>Energy and water <small>— per kg of finished fabric</small></h2><div class="cb-tiles">' +
      '<div><b>' + fmt(e.total_mj_per_kg, 0) + ' MJ</b><small>all energy</small></div>' +
      '<div><b>' + fmt(e.electricity_kwh_per_kg, 1) + ' kWh</b><small>electricity, spinning to stenter</small></div>' +
      '<div><b>' + fmt(e.fuel_kwh_per_kg, 1) + ' kWh</b><small>boiler fuel for baths and drying</small></div>' +
      '<div><b>' + fmt(w.bath_fill_l_per_kg, 0) + ' L</b><small>water to fill ' + w.baths + ' baths at 1:' + fmt(w.liquor_ratio, 0) + '</small></div>' +
      '<div><b>' + fmt(wp.water_evaporated_kg_per_kg, 2) + ' kg</b><small>water boiled off in drying</small></div>' +
      (r.biogenic_co2_kg_per_kg_fabric > 0 ? '<div><b>' + fmt(r.biogenic_co2_kg_per_kg_fabric, 2) + ' kg</b><small>biogenic CO2 from biomass, reported apart</small></div>' : '') +
      '</div><p class="cb-small" style="margin:8px 0 0">' + esc(wp.dyeing_class) + ' dyeing, ' + esc(wp.shade_class) + ' shade: ' + wp.baths.map(function (b) { return esc(b.bath) + ' ' + b.temp_c + ' °C'; }).join(' · ') + '. ' + esc(w.note) + '</p></div>';
  }

  function steps(r) {
    return '<div class="cb-card"><h2>How this number was worked out <small>— the model, step by step, with the numbers in</small></h2><ol class="cb-steps">' +
      r.calc_steps.map(function (s) {
        return '<li><span class="n">' + s.n + '</span><span><span class="t">' + esc(s.title) + '</span><code>' + esc(s.formula) + '</code></span><span class="r">' + (s.result == null ? '' : fmt(s.result, 3)) + '</span></li>';
      }).join('') + '</ol><p class="cb-small" style="margin:8px 0 0">No sensor is needed: each step is a mass balance or a law of physics (the heat to warm water, the heat to evaporate it) applied to the process this fabric goes through, with published factors for fibre, grid and fuel. A mill\'s own meter readings, where it has them, replace the modelled figure for that stage and are labelled PRIMARY.</p></div>';
  }

  function trust(r) {
    var s = r.sensitivity.drivers, max = Math.max.apply(null, s.map(function (d) { return d.swing; }).concat([0.01]));
    var q = r.data_quality.share_of_total_by_tier_pct;
    return '<div class="cb-card"><h2>What the answer hangs on <small>— each driver moved alone, low to high</small></h2>' +
      s.map(function (d) { return '<div class="cb-tor"><span>' + esc(d.driver) + '</span><span class="b"><i style="width:' + (d.swing / max * 100).toFixed(0) + '%"></i></span><span class="mono" style="text-align:right">±' + fmt(d.swing / 2, 2) + '</span></div>'; }).join('') +
      '<p class="cb-small" style="margin:10px 0 0">Every input at its extreme: ' + fmt(r.range.low, 1) + '–' + fmt(r.range.high, 1) + '. On a second, independent set of fibre factors: ' + fmt(r.alternative_dataset.total_co2e_per_kg_fabric, 2) + '.<br>' +
      'Data quality: ' + Object.keys(q).map(function (k) { return tag(k) + ' ' + fmt(q[k], 0) + '%'; }).join(' ') + ' of the total.<br>' +
      '<b>Scope:</b> ' + esc(r.scope) + '<br><b>Not modelled:</b> ' + r.not_modelled.map(esc).join('; ') + '.' +
      (r.warnings && r.warnings.length ? '<br>' + r.warnings.map(function (x) { return '⚠ ' + esc(x); }).join('<br>') : '') +
      '<br>A screening estimate with its range shown, not a certified life-cycle assessment. Factor set ' + esc(r.engine.factor_set) + '.</p></div>';
  }

  function render(r) {
    if (r.composition_read) $('cb-comp-read').textContent = 'Read as ' + r.composition_read + '.';
    // keep only the levers the engine says apply to this fabric
    var ids = new Set(r.reduction.levers.map(function (l) { return l.id; }));
    Array.from(on).forEach(function (id) { if (!ids.has(id)) on.delete(id); });
    $('cb-out').innerHTML = hero(r) + levers(r) + stages(r) + '<div class="cb-two">' + countries(r) + resources(r) + '</div>' + steps(r) + trust(r);
  }

  // ── events ──
  $('cb-out').addEventListener('click', function (e) {
    var sw = e.target.closest('[data-lever]'), pb = e.target.closest('[data-path]');
    if (sw) {
      var id = sw.getAttribute('data-lever');
      if (on.has(id)) on.delete(id); else { on.add(id); if (id === 'fuel_gas') on.delete('fuel_biomass'); if (id === 'fuel_biomass') on.delete('fuel_gas'); }
      sw.setAttribute('aria-pressed', on.has(id));
      go(120);
    } else if (pb && last) {
      var p = pb.getAttribute('data-path'), P = last.reduction.pathway;
      on = new Set(p === 'mill' ? P.best_practice_mill.levers : p === 'all' ? P.plus_preferred_fibre.levers : []);
      go(0);
    }
  });
  ['cb-comp', 'cb-gsm', 'cb-loss', 'cb-garment'].forEach(function (id) { $(id).addEventListener('input', function () { go(450); }); });
  ['cb-fam', 'cb-dye', 'cb-spin', 'cb-country', 'cb-fuel'].forEach(function (id) { $(id).addEventListener('change', function () { go(0); }); });
  document.querySelector('[data-for="cb-comp"]').addEventListener('click', function (e) {
    var b = e.target.closest('[data-v]'); if (!b) return;
    $('cb-comp').value = b.getAttribute('data-v'); go(0);
  });
  $('cb-shade').addEventListener('click', function (e) {
    var b = e.target.closest('[data-v]'); if (!b) return;
    shade = b.getAttribute('data-v');
    Array.prototype.forEach.call($('cb-shade').children, function (x) { x.classList.toggle('on', x === b); });
    go(0);
  });
  // a link from a calculation can carry the fabric: /carbon.html?composition=…&gsm=…&shade=…
  var q = new URLSearchParams(window.location.search);
  if (q.get('composition')) $('cb-comp').value = q.get('composition');
  if (q.get('gsm')) $('cb-gsm').value = q.get('gsm');
  if (q.get('country') && COUNTRY[q.get('country')]) $('cb-country').value = q.get('country');
  var setSel = function (id, v) { if (v && Array.prototype.some.call($(id).options, function (o) { return o.value === v; })) $(id).value = v; };
  setSel('cb-fuel', q.get('fuel')); setSel('cb-spin', q.get('spin')); setSel('cb-dye', q.get('dye')); setSel('cb-fam', q.get('family'));
  if (q.get('loss') && isFinite(+q.get('loss'))) $('cb-loss').value = q.get('loss');
  if (q.get('finish')) finishing = String(q.get('finish')).slice(0, 40);
  if (q.get('shade')) {
    var s0 = String(q.get('shade')).toLowerCase(), m = /white|ecru|bleach/.test(s0) ? 'white' : /black/.test(s0) ? 'black' : /dark|navy|deep/.test(s0) ? 'dark' : /light|pastel/.test(s0) ? 'light' : 'medium';
    shade = m; Array.prototype.forEach.call($('cb-shade').children, function (x) { x.classList.toggle('on', x.getAttribute('data-v') === m); });
  }
  go(0);
})();
