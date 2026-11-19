/**
 * Fabric Studio — the feasibility gates on the page, and the Fabric DNA file.
 *
 * Every analysis carries `feasibility` (backend feasibility-engine.js): three gates — the cloth holds together, the yarn fits, a machine
 * knits it and every fibre survives the wet route — each PASS, WARN or FATAL, and the 20 rules behind them with a repair for each failure.
 * This module draws the strip of gates above the checks, the rule list under it, and an "Apply" button for the repairs the Studio can
 * make itself (a needle, the stitch length, the gauge, the speed).
 *
 * Plain script. window.KAStudioGates:
 *   render(result, { onApply(changes) })       draw the gates for this answer (null clears)
 *   dnaToDesign(input, notes)                   a Studio API input (from /api/studio/dna/import) → a design object loadDesign() reads
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var WORD = { pass: 'PASS', warn: 'WARN', fatal: 'FATAL', na: '—', not_checked: 'not checked' };
  var APPLIES = /^(grid\.[CD]\[\d+\]\[\d+\]|sl_mm|machine\.gauge|machine\.rpm|chemistry\.process\.[a-z_]+|vbed\.gauge|elastane\.draft)$/;
  var open = false;

  function chip(label, g) {
    return '<span class="gt-chip ' + g.status + '" title="' + esc(g.name) + '">' + esc(label) + ' · ' + esc(g.name) + ' <b>' + WORD[g.status] + '</b></span>';
  }
  function ruleRow(r, i) {
    var fix = r.repair && (r.status === 'fatal' || r.status === 'warn') ? r.repair : null;
    var can = fix && fix.changes && fix.changes.length && fix.changes.every(function (c) { return APPLIES.test(c.field); });
    return '<li class="gt-rule ' + r.status + '"><span class="gt-id">' + esc(r.id) + '</span> <b>' + esc(r.name) + '</b> <span class="gt-st">' + WORD[r.status] + '</span>' +
      (r.basis ? ' <span class="gt-basis">' + esc(r.basis) + '</span>' : '') +
      '<div class="gt-text">' + esc(r.text) + '</div>' +
      (fix ? '<div class="gt-fix">Fix: ' + esc(fix.text) + (can ? ' <button type="button" class="st-btn" data-gt-apply="' + i + '">Apply</button>' : '') + '</div>' : '') + '</li>';
  }

  function effectsBlock(P) {
    var T = P.totals;
    var sg = function (v, d) { return (v > 0 ? '+' : '') + (+v).toFixed(d == null ? 1 : d); };
    return '<details class="gt-idle"><summary>What the chemicals of the route do to the cloth (' + P.chemicals.length + ' chemicals, estimate)</summary>' +
      '<p class="st-hint" style="margin:4px 0">Bending × ' + T.bending + ' · friction × ' + T.friction + ' · hairiness × ' + T.hairiness + ' · weight ' + sg(T.gsm_pct) + ' % · colour Δb* ' + sg(T.delta_b) + ', ΔL* ' + sg(T.delta_L) + ' · wet rubbing ' + sg(T.wet_rub_grades) + ' grade. ' + esc(P.colour.note) + '. The Hand card works with these (softener as its own finish, every other chemical on top).</p>' +
      '<ul class="gt-list">' + P.chemicals.map(function (c) { return '<li class="gt-rule"><span class="gt-id">' + c.id + '</span> <b>' + esc(c.name) + '</b> <span class="gt-basis">' + esc(c.stage) + '</span><div class="gt-text">' + esc(c.effect) + '</div></li>'; }).join('') + '</ul>' +
      '<p class="st-hint" style="margin:4px 0">' + esc(P.note) + '</p></details>';
  }

  function render(r, opt) {
    var box = $('st-gates'); if (!box) return;
    var F = r && r.feasibility;
    if (!F) { box.innerHTML = ''; box.hidden = true; return; }
    box.hidden = false;
    var P = F.packing;
    var act = F.rules.filter(function (x) { return x.status === 'fatal' || x.status === 'warn'; });
    var ok = F.rules.filter(function (x) { return x.status === 'pass'; });
    var idle = F.rules.filter(function (x) { return x.status === 'na' || x.status === 'not_checked'; });
    var others = [];
    ['gate1', 'gate2', 'gate3'].forEach(function (g) { (F.gates[g].other || []).forEach(function (t, i) { others.push({ text: t, status: (F.gates[g].other_status || [])[i] || 'fatal' }); }); });
    var order = { fatal: 0, warn: 1 };
    act.sort(function (a, b) { return order[a.status] - order[b.status]; });
    var all = F.rules;
    box.innerHTML =
      '<div class="gt-strip">' + chip('Gate 1', F.gates.gate1) + chip('Gate 2', F.gates.gate2) + chip('Gate 3', F.gates.gate3) + chip('Quality', F.gates.quality) +
      (P ? '<span class="gt-phi" title="' + esc(P.formula + ' = ' + P.working + ' (' + P.basis + ')') + '">Φ ' + P.phi + ' · porosity ' + P.porosity_pct + ' %</span>' : '') + '</div>' +
      (F.export_locked ? '<div class="gt-lock">A gate is FATAL: the machine files are locked until it is fixed.</div>' : '') +
      '<details class="gt-det"' + (open || act.length ? ' open' : '') + '><summary>Feasibility: ' + F.counts.fatal + ' fatal, ' + F.counts.warn + ' warning' + (F.counts.warn === 1 ? '' : 's') + ', ' + F.counts.pass + ' passed' + (idle.length ? ', ' + idle.length + ' not applicable or not checked' : '') + '</summary>' +
      (others.length ? '<ul class="gt-list">' + others.map(function (t) { return '<li class="gt-rule ' + t.status + '"><b>Studio check</b> <span class="gt-st">' + (t.status === 'fatal' ? 'FATAL' : 'WARN') + '</span><div class="gt-text">' + esc(t.text) + '</div></li>'; }).join('') + '</ul>' : '') +
      '<ul class="gt-list">' + act.map(function (x) { return ruleRow(x, all.indexOf(x)); }).join('') + ok.map(function (x) { return ruleRow(x, all.indexOf(x)); }).join('') + '</ul>' +
      (idle.length ? '<details class="gt-idle"><summary>' + idle.length + ' rules not applicable or not checked</summary><ul class="gt-list">' + idle.map(function (x) { return ruleRow(x, all.indexOf(x)); }).join('') + '</ul></details>' : '') +
      (r.process_effects ? effectsBlock(r.process_effects) : '') +
      (F.route && F.route.length ? '<div class="gt-route">Wet route of the whole cloth (' + esc(Object.keys(F.fibres || {}).map(function (k) { return k + ' ' + F.fibres[k] + ' %'; }).join(', ')) + '): ' + F.route.map(function (s) { return esc(s.label) + (s.t_c ? ' ' + s.t_c + ' °C' : ''); }).join(' → ') + '</div>' : '') +
      '<p class="st-hint" style="margin:6px 0 0">' + esc(F.note) + '</p></details>';
    var det = box.querySelector('.gt-det'); if (det) det.addEventListener('toggle', function () { open = det.open; });
    box.querySelectorAll('[data-gt-apply]').forEach(function (b) {
      b.addEventListener('click', function () { var x = all[+b.getAttribute('data-gt-apply')]; if (x && x.repair && opt && opt.onApply) opt.onApply(x.repair.changes, x); });
    });
  }

  // a Studio API input → the design object the page loads (the yarn rows, the machine, the target)
  function dnaToDesign(input, name) {
    var g = input.grid || {};
    var rows = function (a) { return a ? a.map(function (r) { return String(r).split(''); }) : null; };
    var C = rows(g.C), D = rows(g.D);
    var bed = input.bed === 'double' ? (input.gating === 'interlock' ? 'interlock' : 'rib') : 'single';
    var f = {}, y = input.yarn || {}, ys = input.yarns || {}, m = input.machine || {}, t = input.target || {}, el = input.elastane || null;
    var put = function (id, v) { if (v != null && v !== '') f[id] = String(v); };
    put('st-ne', y.count); put('st-unit', y.unit); put('st-fibre', y.fibre); put('st-ytype', y.type); put('st-ply', y.ply);
    if (ys.binder) { put('yb-count', ys.binder.count); put('yb-unit', ys.binder.unit); put('yb-fibre', ys.binder.fibre); put('yb-type', ys.binder.type); }
    if (ys.loop) { put('yl-count', ys.loop.count); put('yl-unit', ys.loop.unit); put('yl-fibre', ys.loop.fibre); put('yl-type', ys.loop.type); }
    put('st-gauge', m.gauge); put('st-dia', m.dia); put('st-rpm', m.rpm); put('st-feeders', m.feeders); put('st-sl', m.sl_mm);
    put('st-gsm', t.gsm); put('st-width', t.width_in);
    if (el) { put('st-lyd', el.denier); put('st-lydraft', el.draft); put('st-lyevery', el.every === 'alternate' ? 'alternate' : 'all'); }
    if (input.finish && input.finish.brush) put('st-brush', input.finish.brush);
    return { v: 2, name: name || input.name || 'Imported DNA', bed: bed, C: C, D: D, feeds: (input.feeds || []).map(function (x) { return { role: x.role || 'ground' }; }), lycra: !!el, fields: f };
  }

  window.KAStudioGates = { render: render, dnaToDesign: dnaToDesign };
})();
