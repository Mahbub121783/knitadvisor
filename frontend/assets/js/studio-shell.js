/**
 * Fabric Studio — the workspace.
 *
 * The Studio used to be one long page: twenty cards and nineteen tabs in the order they were built. This script lays the SAME cards out as a guided
 * workspace, in the order a design is made:
 *
 *   1 Brief  ·  2 Yarn & colour  ·  3 Design  ·  4 Machine  ·  5 Check  ·  6 Finish & feel  ·  7 Make & prove        (warp: Structure · Machine & target · Dyeing & rolls · Results · Save)
 *
 * Each step shows only its own cards (left), grouped under sub-tabs; the cloth stays in view on the right, with the tabs that belong to that step, and a
 * verdict strip that says at once whether the design knits. Nothing is rebuilt: the cards are MOVED, so every id, listener and engine call is the one it was.
 *
 * Plain script. window.KAStudioShell: go(tech, step), step(tech). window.KAStudioMode keeps the old name (the Simple / Expert switch is gone: every card is
 * in its step, the research cards sit under "More" sub-tabs).
 */
(function () {
  'use strict';
  var STORE = 'ka_studio_step';

  var CFG = {
    weft: {
      root: 'st-weft',
      steps: [
        { id: 'brief', title: 'Brief', ask: 'What are you making?', lead: 'Choose the cloth family and how heavy it must be. Start from a known structure, or let the Studio design one from your goal.', gets: 'a starting structure and a target weight',
          subs: [['Structure', ['#ws-c-fab']], ['Targets', ['#ws-c-target']], ['Design from a goal', ['#inv-card']]], viewer: ['3d'], primary: '3d' },
        { id: 'yarn', title: 'Yarn & colour', ask: 'What is it knitted from?', lead: 'Name the yarn of every feeder, then the colours. Blends, fancy yarns and melanges are under “Special yarns”.', gets: 'yarn counts, fibres and the colour plan',
          subs: [['Yarn', ['#ws-c-yarn']], ['Colours & stripes', ['#cw-card']], ['Special yarns', ['#bl-card', '#fy-card', '#ml-card', '#rc-card']]], viewer: ['3d', 'colours', 'blend', 'fancy', 'melange', 'recovery'], primary: '3d' },
        { id: 'design', title: 'Design', ask: 'How is it knitted?', lead: 'Draw the knit, tuck and miss programme needle by needle, or bring one in from the floor or from a picture.', gets: 'the needle programme and the notation',
          subs: [['Draw the programme', ['#ws-c-draw']], ['Load a cam sheet', ['#cs-card']], ['Jacquard picture', ['#jq-card']]], viewer: ['3d', 'notation', 'needle', 'colours'], primary: '3d' },
        { id: 'machine', title: 'Machine', ask: 'Which machine knits it?', lead: 'Leave it empty to take the recommended machine, or give your own: gauge, diameter, feeders, speed, stitch cam.', gets: 'the cam and needle set-out and the VDQ settings',
          subs: [['Machine', ['#ws-c-machine', '#vb-card']]], viewer: ['3d', 'setup', 'machine', 'vbed'], primary: 'setup' },
        { id: 'check', title: 'Check', ask: 'Does it knit?', lead: 'The verdict, the three gates and every check. Put your tester’s numbers in to replace the model’s estimates.', gets: 'a yes or no, and what to fix',
          subs: [['Verdict', ['#ws-c-status']], ['Your tester’s numbers', ['#ws-c-readings']]], viewer: ['3d', 'results'], primary: 'results' },
        { id: 'finish', title: 'Finish & feel', ask: 'How does it dye, feel and behave?', lead: 'The wet route and the dye, the hand, the drape, how it looks in light, and the inspection room.', gets: 'dyeing, hand, drape, look and lab figures',
          subs: [['Dyeing & colour match', ['#ch-card', '#cl-card']], ['Hand & drape', ['#hd-card', '#dp-card']], ['Lab & inspection', ['#lb-card', '#in-card']]], viewer: ['3d', 'chem', 'colour', 'look', 'hand', 'drape', 'lab', 'inspect'], primary: '3d' },
        { id: 'make', title: 'Make & prove', ask: 'Take it to the floor', lead: 'The development sheet, the machine files, your own trial rolls to put the numbers right, and save.', gets: 'a development sheet, machine files and a saved design',
          subs: [['Development sheet', ['#sh-card']], ['Machine files', ['#st-xcard']], ['Trial rolls', ['#ws-c-rolls', '#st-ccard']], ['Save', ['#ws-c-save']]], viewer: ['3d', 'sheet', 'results'], primary: 'sheet' }
      ],
      tabs: { '3d': '3D fabric', notation: 'Notation', setup: 'Cam & needle set-out', needle: 'Needle action', sheet: 'Development sheet', colours: 'Colours', results: 'Fabric & yarn', machine: 'Machine & VDQ',
        blend: 'Blend yarn', fancy: 'Fancy yarn', chem: 'Dyeing & chemistry', recovery: 'Yarn recovery', look: 'Look', hand: 'Hand', colour: 'Colour match', lab: 'Lab', inspect: 'Inspection', drape: 'Drape', vbed: 'Flat V-bed', melange: 'Melange' }
    },
    warp: {
      root: 'st-warp',
      steps: [
        { id: 'structure', title: 'Structure', ask: 'How is it knitted?', lead: 'Choose a lapping to start from, then edit each guide bar: its lapping, threading and yarn.', gets: 'the guide-bar lapping and the yarns', subs: [['Guide bars', ['#ws-w-struct']]] },
        { id: 'machine', title: 'Machine & target', ask: 'On which machine, how heavy?', lead: 'The machine class and gauge, and the finished weight or quality you want.', gets: 'quality, speed and the finished width', subs: [['Machine', ['#ws-w-machine']], ['Target', ['#ws-w-target']]] },
        { id: 'dye', title: 'Dyeing & rolls', ask: 'Shade, and your own rolls', lead: 'The depth of shade for the wet route, and your trial rolls to replace the published constants.', gets: 'the wet route and a calibrated model', subs: [['Dyeing and trial rolls', ['#wp-proc-card']]] },
        { id: 'results', title: 'Results', ask: 'Does it knit?', lead: 'The verdict, the gates, the runners, the beams, the wet route, the cloth in every state and the guide-bar drive.', gets: 'a yes or no, and every number', subs: [['Results', ['#ws-w-result']]] },
        { id: 'make', title: 'Save & files', ask: 'Take it to the floor', lead: 'Save the design, print the job card, or take the set-up sheet and the lapping chart.', gets: 'a saved design and machine files', subs: [['Save and export', ['#ws-w-save']]] }
      ],
      dock: [['3D fabric', '#ws-w-3d'], ['Lapping diagram', '#ws-w-lap']]
    }
  };

  var state = { weft: { step: 0, sub: {}, seen: {} }, warp: { step: 0, sub: {}, seen: {} } };
  var els = { weft: null, warp: null };
  function $(id) { return document.getElementById(id); }
  function q(s) { return document.querySelector(s); }
  function mk(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function load() { try { var o = JSON.parse(sessionStorage.getItem(STORE) || '{}'); ['weft', 'warp'].forEach(function (k) { if (typeof o[k] === 'number') state[k].step = o[k]; }); } catch (_) { /* private window */ } }
  function save() { try { sessionStorage.setItem(STORE, JSON.stringify({ weft: state.weft.step, warp: state.warp.step })); } catch (_) { /* private window */ } }
  function hdrH() { var h = q('.hdr'); return h ? h.offsetHeight : 56; }

  // ── the technology switch: a slim bar above the workspace ──
  function techBar() {
    var t = $('st-tech'); if (!t) return;
    var card = t.closest('.st-card'); if (!card) return;
    card.classList.add('ws-techcard');
    var st = card.querySelector(':scope > .st-step'); if (st) st.style.display = 'none';
    var lab = mk('div', 'ws-techlabel', 'Knitting technology'); card.insertBefore(lab, card.firstChild);
    var main = q('.st-main'), head = q('.st-head');
    if (main && head) head.parentNode.insertBefore(card, head.nextSibling);
  }

  // ── building one workspace ──
  function build(key) {
    var cfg = CFG[key], root = $(cfg.root); if (!root || root.getAttribute('data-ws')) return;
    root.setAttribute('data-ws', '1'); root.classList.remove('st-layout'); root.classList.add('ws', 'ws-' + key);
    var old = Array.prototype.slice.call(root.children);
    var steps = mk('nav', 'ws-steps'); steps.setAttribute('role', 'tablist'); steps.setAttribute('aria-label', 'Design steps');
    var body = mk('div', 'ws-body'), left = mk('div', 'ws-left'), right = mk('div', 'ws-right');
    body.appendChild(left); body.appendChild(right);
    var banner = mk('div', 'ws-banner'); banner.hidden = true;
    root.insertBefore(banner, root.firstChild); root.insertBefore(steps, banner.nextSibling); root.insertBefore(body, steps.nextSibling);
    var E = { root: root, steps: steps, left: left, right: right, banner: banner, stages: [], chips: [], verdict: null };
    els[key] = E;

    cfg.steps.forEach(function (st, i) {
      var chip = mk('button', 'ws-chip', '<span class="ws-n">' + (i + 1) + '</span><span class="ws-t"><b>' + esc(st.title) + '</b><small>' + esc(st.ask) + '</small></span>');
      chip.type = 'button'; chip.setAttribute('role', 'tab'); chip.setAttribute('data-i', i);
      chip.addEventListener('click', function () { go(key, i); });
      chip.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { var j = Math.max(0, Math.min(cfg.steps.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1))); go(key, j); E.chips[j].focus(); } });
      steps.appendChild(chip); E.chips.push(chip);

      var sec = mk('section', 'ws-stage'); sec.hidden = true; sec.id = 'ws-' + key + '-' + st.id;
      var head = mk('header', 'ws-stagehead', '<div class="ws-kick">Step ' + (i + 1) + ' of ' + cfg.steps.length + '</div><h2>' + esc(st.title) + ' <span>' + esc(st.ask) + '</span></h2><p>' + esc(st.lead) + '</p><div class="ws-gets">You get: ' + esc(st.gets) + '</div>');
      sec.appendChild(head);
      var subs = mk('div', 'ws-subs'); subs.setAttribute('role', 'tablist');
      var panes = [];
      st.subs.forEach(function (sb, j) {
        var b = mk('button', 'ws-sub', esc(sb[0])); b.type = 'button'; b.setAttribute('data-j', j);
        b.addEventListener('click', function () { sub(key, i, j); });
        subs.appendChild(b);
        var pane = mk('div', 'ws-subpane'); pane.hidden = true; panes.push(pane); sec.appendChild(pane);
      });
      if (st.subs.length > 1) sec.insertBefore(subs, panes[0]);
      var nav = mk('footer', 'ws-nav');
      var back = mk('button', 'st-btn', i ? '← ' + esc(cfg.steps[i - 1].title) : ''); back.type = 'button'; back.hidden = !i;
      var next = mk('button', 'st-btn primary', i < cfg.steps.length - 1 ? 'Next: ' + esc(cfg.steps[i + 1].title) + ' →' : 'Back to the start'); next.type = 'button';
      back.addEventListener('click', function () { go(key, i - 1); });
      next.addEventListener('click', function () { go(key, i < cfg.steps.length - 1 ? i + 1 : 0); });
      nav.appendChild(back); nav.appendChild(next); sec.appendChild(nav);
      left.appendChild(sec);
      E.stages.push({ el: sec, subs: subs, panes: panes });
    });

    // move the cards in; a card the map does not know follows the last step (nothing is lost)
    cfg.steps.forEach(function (st, i) {
      st.subs.forEach(function (sb, j) { sb[1].forEach(function (sel) { var n = q(sel); if (n) E.stages[i].panes[j].appendChild(n); }); });
    });
    var strays = [];
    old.forEach(function (c) { Array.prototype.forEach.call(c.querySelectorAll ? c.querySelectorAll(':scope > .st-card, :scope > section > .st-card') : [], function (n) { strays.push(n); }); });
    strays.forEach(function (n) { var last = E.stages[E.stages.length - 1]; last.panes[last.panes.length - 1].appendChild(n); });

    // the right side: the verdict, then the cloth
    var verdict = mk('div', 'ws-verdict', '<span class="ws-vtext">Draw a structure to begin.</span>'); verdict.addEventListener('click', function () { go(key, cfg.steps.length > 5 && key === 'weft' ? 4 : 3); });
    verdict.title = 'Open the checks'; E.verdict = verdict; right.appendChild(verdict);
    if (key === 'weft') {
      var view = $('ws-view'); if (view) right.appendChild(view);
      relabelTabs(cfg);
      // the picture and material exports sit in one closed drawer, so the cloth is what the eye meets
      var sb = $('st-savebar'), pb = $('st-pbrbar');
      if (sb && pb) { var dt = mk('details', 'ws-tools', '<summary>Save the picture · export the material</summary>'); sb.parentNode.insertBefore(dt, sb); dt.appendChild(sb); dt.appendChild(pb); }
    } else {
      var dock = mk('div', 'ws-dockbar'); right.appendChild(dock);
      cfg.dock.forEach(function (d, k) {
        var b = mk('button', 'ws-sub' + (k ? '' : ' on'), esc(d[0])); b.type = 'button';
        b.addEventListener('click', function () { cfg.dock.forEach(function (x, m) { var n = q(x[0] === d[0] ? d[1] : x[1]); if (n) n.hidden = m !== k; }); Array.prototype.forEach.call(dock.children, function (c) { c.classList.toggle('on', c === b); }); window.dispatchEvent(new Event('resize')); });
        dock.appendChild(b);
        var n = q(d[1]); if (n) { right.appendChild(n); n.hidden = !!k; n.classList.add('ws-dockcard'); }
      });
    }
    // the old, now empty, containers
    old.forEach(function (c) { if (c.tagName === 'ASIDE' || c.tagName === 'SECTION') c.hidden = true; });
    banner_(key);
  }

  function relabelTabs(cfg) {
    document.querySelectorAll('.st-tabs [data-tab]').forEach(function (b) { var t = cfg.tabs[b.getAttribute('data-tab')]; if (t) b.textContent = t; });
  }
  // a short welcome, once
  function banner_(key) {
    var E = els[key], seen = false;
    try { seen = localStorage.getItem('ka_studio_welcome') === '1'; } catch (_) { /* private window */ }
    if (seen) return;
    E.banner.hidden = false;
    E.banner.innerHTML = '<div><b>New here?</b> Follow the numbered steps above, left to right. Each step has only what it needs; the cloth on the right changes as you go, and the strip above it says at once whether the design knits. You can jump to any step at any time.</div><button type="button" class="st-btn">Got it</button>';
    E.banner.querySelector('button').addEventListener('click', function () { E.banner.hidden = true; try { localStorage.setItem('ka_studio_welcome', '1'); } catch (_) { /* private window */ } });
  }

  // ── going to a step, and a sub-tab ──
  function sub(key, i, j) {
    var E = els[key]; if (!E) return;
    var s = E.stages[i]; state[key].sub[i] = j;
    s.panes.forEach(function (p, k) { p.hidden = k !== j; });
    Array.prototype.forEach.call(s.subs.children, function (b, k) { b.classList.toggle('on', k === j); b.setAttribute('aria-selected', k === j ? 'true' : 'false'); });
  }
  function viewerTabs(key, i, entering) {
    if (key !== 'weft') return;
    var list = CFG.weft.steps[i].viewer, on = q('.st-tabs .on');
    document.querySelectorAll('.st-tabs [data-tab]').forEach(function (b) {
      var t = b.getAttribute('data-tab'), idx = list.indexOf(t);
      b.style.display = idx < 0 ? 'none' : ''; b.style.order = idx < 0 ? 99 : idx;
    });
    var bar = q('.st-tabs'); if (bar) bar.style.display = 'flex';
    var want = CFG.weft.steps[i].primary, cur = on && on.getAttribute('data-tab');
    // entering a step opens the tab that answers it (the set-out for Machine, the numbers for Check, the sheet for Make); a tab already open stays if the step has it
    if (!on || list.indexOf(cur) < 0 || (entering && want && cur !== want && CFG.weft.steps[i].primary !== '3d')) { var first = q('.st-tabs [data-tab="' + (want || list[0]) + '"]'); if (first) first.click(); }
  }
  function go(key, i, quiet) {
    var E = els[key], cfg = CFG[key]; if (!E) return;
    i = Math.max(0, Math.min(cfg.steps.length - 1, i)); state[key].step = i; state[key].seen[i] = true; save();
    E.stages.forEach(function (s, k) { s.el.hidden = k !== i; });
    E.chips.forEach(function (c, k) { c.classList.toggle('on', k === i); c.classList.toggle('seen', !!state[key].seen[k] && k !== i); c.setAttribute('aria-selected', k === i ? 'true' : 'false'); c.tabIndex = k === i ? 0 : -1; });
    sub(key, i, state[key].sub[i] || 0);
    viewerTabs(key, i, !quiet);
    if (key === 'weft' && cfg.steps[i].id === 'make') pullSheetFields();
    if (!quiet) { var top = E.root.getBoundingClientRect().top + window.pageYOffset - hdrH() - 4; if (Math.abs(window.pageYOffset - top) > 40 && E.root.getBoundingClientRect().top < 0) window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' }); }
    requestAnimationFrame(function () { window.dispatchEvent(new Event('resize')); });
  }
  // the development sheet's own form shows what the rest of the Studio holds
  function pullSheetFields() {
    var M = { 'st-comp': 'sh-comp', 'st-gsm': 'sh-gsm', 'st-dia': 'sh-dia', 'st-brush': 'sh-brush', 'st-width': 'sh-width', 'st-shr': 'sh-shr' };
    Object.keys(M).forEach(function (a) { var f = $(a), t = $(M[a]); if (!f || !t) return; var v = f.value; if (a === 'st-comp' && !v) v = '100% CO'; if (a === 'st-brush' && !v) v = 'none'; if (v !== '' && t.value !== v) t.value = v; });
  }

  // ── the verdict strip ──
  function verdictWeft(r) {
    var E = els.weft; if (!E || !E.verdict) return;
    if (!r || r.success === false) { E.verdict.className = 'ws-verdict bad'; E.verdict.innerHTML = '<span class="ws-vtext">' + esc((r && r.error) || 'Could not analyse this design.') + '</span>'; chipState('weft', 4, 'bad'); return; }
    var errs = (r.checks || []).filter(function (c) { return c.level === 'error'; }).length, warns = (r.checks || []).filter(function (c) { return c.level === 'warn'; }).length;
    var f = r.fabric || {}, m = r.machine || {}, g = r.feasibility && r.feasibility.verdict;
    var cls = errs || g === 'fatal' ? 'bad' : warns || g === 'warn' ? 'warn' : 'ok';
    var kp = function (l, v) { return v == null || v === '' ? '' : '<span class="ws-k"><small>' + esc(l) + '</small><b>' + esc(v) + '</b></span>'; };
    E.verdict.className = 'ws-verdict ' + cls;
    E.verdict.innerHTML = '<span class="ws-badge">' + (errs ? 'Will not knit as drawn · ' + errs + ' error' + (errs > 1 ? 's' : '') : warns ? 'Knittable · ' + warns + ' to check' : 'Knittable') + '</span>' +
      kp('Weight', f.gsm ? f.gsm + ' GSM' : '') + kp('Open width', f.width_open_in ? f.width_open_in + ' in' : '') + kp('Stitch length', f.sl_mm ? f.sl_mm + ' mm' : '') + kp('Output', m.kg_per_hour ? m.kg_per_hour + ' kg/h' : '') + '<span class="ws-more">Checks →</span>';
    chipState('weft', 4, cls);
  }
  function verdictWarp(r) {
    var E = els.warp; if (!E || !E.verdict) return;
    var errs = (r.checks || []).filter(function (c) { return c.level === 'error'; }).length, warns = (r.checks || []).filter(function (c) { return c.level === 'warn'; }).length;
    var g = r.gates && r.gates.verdict, cls = errs || g === 'fatal' ? 'bad' : warns || g === 'warn' ? 'warn' : 'ok';
    var f = r.fabric || {}, m = r.machine || {};
    var kp = function (l, v) { return v == null || v === '' ? '' : '<span class="ws-k"><small>' + esc(l) + '</small><b>' + esc(v) + '</b></span>'; };
    E.verdict.className = 'ws-verdict ' + cls;
    E.verdict.innerHTML = '<span class="ws-badge">' + (errs ? 'Will not knit as drawn · ' + errs + ' error' + (errs > 1 ? 's' : '') : warns ? 'Knittable · ' + warns + ' to check' : 'Knittable') + '</span>' +
      kp('Weight', f.gsm ? f.gsm + ' GSM' : '') + kp('Width', f.width_in ? f.width_in + ' in' : '') + kp('Quality', m.cpc_machine ? m.cpc_machine + ' c/cm' : '') + kp('Output', m.kg_per_hour ? m.kg_per_hour + ' kg/h' : '') + '<span class="ws-more">Results →</span>';
    chipState('warp', 3, cls);
  }
  function chipState(key, i, cls) { var E = els[key]; if (!E || !E.chips[i]) return; E.chips[i].classList.remove('ok', 'warn', 'bad'); E.chips[i].classList.add(cls); }

  function init() {
    if (!$('st-weft') || !$('st-warp')) return;
    load(); techBar();
    build('weft'); build('warp');
    go('weft', state.weft.step, true); go('warp', state.warp.step, true);
    var h = hdrH(); document.documentElement.style.setProperty('--ws-top', h + 'px');
    var sh = els.weft && els.weft.steps ? els.weft.steps.offsetHeight : 64; document.documentElement.style.setProperty('--ws-steps', sh + 'px');
    document.addEventListener('ka-studio-result', function (e) { verdictWeft(e.detail); });
    document.addEventListener('ka-warp-result', function (e) { verdictWarp(e.detail); });
    window.addEventListener('resize', function () { var s = els.weft && els.weft.steps; if (s && s.offsetHeight) document.documentElement.style.setProperty('--ws-steps', s.offsetHeight + 'px'); });
    // a design opened from the goal search is looked at in the designer
    document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-inv-use]')) setTimeout(function () { go('weft', 2); }, 80); });
    // the flat V-bed has its card in the Machine step; a saved design opened from a link is looked at in the designer
    var tb = $('st-tech'); if (tb) tb.addEventListener('click', function (e) { var b = e.target.closest('[data-tech]'); if (b && b.getAttribute('data-tech') === 'vbed') go('weft', 3, true); });
    if (/[?&]design=/.test(location.search)) { go('weft', 2, true); go('warp', 3, true); }
    // a link to a step: #weft-3 or #warp-4
    var m = /^#(weft|warp)-(\d)$/.exec(location.hash || ''); if (m) go(m[1], +m[2] - 1, true);
    // other scripts that open a tab on a card in another step
    document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('.st-tabs [data-tab]'); if (b && b.style.display === 'none') b.style.display = ''; });
  }
  window.KAStudioShell = { go: go, step: function (k) { return state[k] ? state[k].step : 0; } };
  window.KAStudioMode = { apply: function () {}, mode: function () { return 'expert'; } };
  // the script sits at the end of the page: the cards are there, so the workspace is built before the first paint of the old layout; the header height is read once the page has loaded
  try { init(); } catch (e) { if (window.console) console.error('studio-shell', e); }
  window.addEventListener('load', function () { var h = hdrH(); document.documentElement.style.setProperty('--ws-top', h + 'px'); var s = els.weft && els.weft.steps; if (s) document.documentElement.style.setProperty('--ws-steps', s.offsetHeight + 'px'); });
})();
