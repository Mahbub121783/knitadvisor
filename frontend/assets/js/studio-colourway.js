/**
 * Fabric Studio — colours: stripes, a colour per feeder, and the plan for dyeing the yarn (backend/engine/domain/colourway.js).
 *
 * The card holds the stripe (typed as A12 B4 C2, or built row by row), the six yarn colours with their names, and what an order asks (kilograms,
 * the loss in dyeing and winding, the dyer's minimum lot). The Colours tab shows what the engine makes of them: horizontal stripe, wale stripe or
 * a jacquard motif; each colour's yarn kilograms, depth, dye route and fastness; which colours touch and which pairs stain or fade into each other.
 *
 * Plain script. window.KAStudioColourway: payload(), state(), setState(), studioResult(r)
 */
(function () {
  'use strict';
  var LET = ['A', 'B', 'C', 'D', 'E', 'F'], last = null, S = blank(), moved = false;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function blank() { return { names: {}, codes: {}, kg: '', loss: '', lot: '' }; }
  function hex(l) { var e = $('st-sc-' + l); return e && /^#[0-9a-f]{6}$/i.test(e.value) ? e.value : '#808080'; }
  function ensureCss() {
    if ($('cw-css')) return;
    var s = document.createElement('style'); s.id = 'cw-css';
    s.textContent = '.cw-bar{display:flex;height:26px;border:1px solid var(--line);border-radius:6px;overflow:hidden;margin:6px 0}.cw-bar i{display:block;min-width:2px}' +
      '.cw-run{display:flex;gap:6px;align-items:center;margin:3px 0}.cw-run select,.cw-run input{width:auto}.cw-run input[type=number]{width:70px}' +
      '.cw-names{display:grid;grid-template-columns:repeat(3,1fr);gap:4px 8px;margin:4px 0}.cw-names label{font-size:11px;color:var(--t2)}.cw-names input{width:100%}' +
      '.cw-t{width:100%;border-collapse:collapse;font-size:12px}.cw-t th,.cw-t td{border-bottom:1px solid var(--line);padding:4px 6px;text-align:left;vertical-align:top}.cw-t th{font:600 11px var(--head);color:var(--t2)}' +
      '.cw-dot{display:inline-block;width:14px;height:14px;border-radius:50%;border:1px solid var(--line);vertical-align:-2px;margin-right:6px}' +
      '.cw-chip{display:inline-block;padding:2px 8px;border-radius:99px;font:600 11px var(--head);margin:2px 4px 2px 0}.cw-chip.ok{background:rgba(30,122,84,.12);color:var(--good)}.cw-chip.warn{background:rgba(154,91,0,.12);color:var(--warn)}.cw-chip.note{background:rgba(24,87,196,.1);color:var(--accent)}' +
      '.cw-note{border-left:3px solid var(--line);padding:4px 8px;margin:4px 0;font-size:12px}.cw-note.warn{border-color:var(--warn)}.cw-note.ok{border-color:var(--good)}';
    document.head.appendChild(s);
  }

  // ── the stripe builder ──
  function parseStripe(t) {
    var out = [], m = String(t || '').toUpperCase().match(/[A-F]\s*\d+/g);
    if (m) m.forEach(function (x) { out.push({ c: x[0], n: Math.max(1, Math.min(500, parseInt(x.slice(1), 10) || 1)) }); });
    return out;
  }
  function stripeText(rows) { return rows.map(function (r) { return r.c + r.n; }).join(' '); }
  function drawBuilder() {
    var host = $('cw-builder'), inp = $('st-stripe'); if (!host || !inp) return;
    var rows = parseStripe(inp.value), tot = rows.reduce(function (t, r) { return t + r.n; }, 0) || 1;
    host.innerHTML = '<div class="st-hint" style="margin:6px 0 2px">Build the stripe course by course (feeds, as the machine counts them). On an interlock, count two feeds for one course: a one-course stripe is 2.</div>' +
      '<div class="cw-bar" id="cw-bar">' + rows.map(function (r) { return '<i style="flex:' + r.n + ' 0 0;background:' + hex(r.c) + '" title="' + r.c + ' ' + r.n + '"></i>'; }).join('') + '</div>' +
      rows.map(function (r, i) {
        return '<div class="cw-run" data-i="' + i + '"><select class="cw-c">' + LET.map(function (l) { return '<option' + (l === r.c ? ' selected' : '') + '>' + l + '</option>'; }).join('') + '</select>' +
          '<input class="cw-n" type="number" min="1" max="500" step="1" value="' + r.n + '"><span class="st-hint" style="margin:0">feeds</span><button type="button" class="st-btn cw-del" style="padding:1px 8px">×</button></div>';
      }).join('') + '<button type="button" class="st-btn" id="cw-add" style="margin-top:4px">Add a colour</button> <span class="st-hint" style="margin:0">' + (rows.length ? tot + ' feeds in the repeat' : 'or leave empty and give each feeder its colour in the drawing') + '</span>';
  }
  function writeRows(rows) {
    var inp = $('st-stripe'); if (!inp) return;
    inp.value = stripeText(rows);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    drawBuilder();
  }
  function rowsFromDom() {
    return Array.prototype.map.call(document.querySelectorAll('#cw-builder .cw-run'), function (el) {
      return { c: el.querySelector('.cw-c').value, n: Math.max(1, Math.min(500, parseInt(el.querySelector('.cw-n').value, 10) || 1)) };
    });
  }

  function build() {
    var card = $('cw-card'); if (!card || card.getAttribute('data-ready')) return;
    ensureCss();
    var slot = $('cw-slot'), sw = $('st-swatches'), stf = $('st-stripe') && $('st-stripe').closest('.st-f');
    // the stripe text and the six colour pickers live here (they stay the Studio's own fields: their ids and listeners move with them)
    if (slot && stf && sw && !moved) { slot.appendChild(stf); slot.appendChild(sw); moved = true; }
    var names = $('cw-names');
    if (names) names.innerHTML = '<div class="st-hint" style="grid-column:1/-1;margin:0">Give a colour as a Pantone TCX code or name, a hex, an RGB or a Lab reading: the swatch is set from it (a physical swatch still rules).</div>' + LET.map(function (l) { return '<div><label for="cw-cd-' + l + '">' + l + ' colour code</label><input id="cw-cd-' + l + '" class="cw-cd" data-l="' + l + '" type="text" maxlength="60" placeholder="19-4052 · classic blue · #0f4c81" value="' + esc(S.codes[l] || '') + '"><input id="cw-nm-' + l + '" class="cw-nm" data-l="' + l + '" type="text" maxlength="24" placeholder="name, e.g. Navy" value="' + esc(S.names[l] || '') + '" style="margin-top:2px"><div class="st-hint cw-cdo" id="cw-cdo-' + l + '" style="margin:1px 0 0"></div></div>'; }).join('');
    ['kg', 'loss', 'lot'].forEach(function (k) { var e = $('cw-' + k); if (e) e.value = S[k] || ''; });
    card.setAttribute('data-ready', '1');
    drawBuilder();
    card.addEventListener('click', function (e) {
      var t = e.target;
      if (t.id === 'cw-add') { var r = rowsFromDom(); r.push({ c: LET[Math.min(5, r.length)] || 'A', n: 2 }); writeRows(r); }
      else if (t.classList && t.classList.contains('cw-del')) { var rr = rowsFromDom(); rr.splice(+t.parentNode.getAttribute('data-i'), 1); writeRows(rr); }
    });
    card.addEventListener('change', function (e) {
      var t = e.target;
      if (t.classList && (t.classList.contains('cw-c') || t.classList.contains('cw-n'))) writeRows(rowsFromDom());
      else if (t.classList && t.classList.contains('cw-nm')) { S.names[t.getAttribute('data-l')] = t.value.trim(); poke(); }
      else if (t.classList && t.classList.contains('cw-cd')) setFromCode(t.getAttribute('data-l'), t.value.trim());
      else if (/^cw-(kg|loss|lot)$/.test(t.id)) { S[t.id.slice(3)] = t.value; poke(); }
    });
    // the colours changed: the depth, route and fastness follow
    if (sw) sw.addEventListener('change', poke);
    var inp = $('st-stripe');
    if (inp) inp.addEventListener('change', drawBuilder);
  }
  // a colour given as a code: the engine resolves it (Pantone TCX, hex, RGB, Lab) and the swatch takes it
  function setFromCode(l, text) {
    var H = window.KAStudioHost, out = $('cw-cdo-' + l); S.codes[l] = text;
    if (!text) { if (out) out.textContent = ''; return; }
    if (!H) return;
    if (out) { out.textContent = 'Looking it up…'; out.style.color = ''; }
    H.fetch('/api/studio/colour-target', { method: 'POST', body: { target: text } }).then(function (r) {
      var sw = $('st-sc-' + l); if (!sw) return;
      sw.value = r.colour.hex; sw.dispatchEvent(new Event('input', { bubbles: true })); sw.dispatchEvent(new Event('change', { bubbles: true }));
      var nm = $('cw-nm-' + l), cat = r.colour.catalogue;
      if (nm && !nm.value.trim() && cat && cat.name) { nm.value = cat.name; S.names[l] = cat.name; }
      if (out) { out.textContent = r.colour.hex + ' · ' + r.colour.words + (cat && cat.name ? ' · ' + cat.name : ''); out.style.color = ''; }
      poke();
    }).catch(function (e) { if (out) { out.textContent = (e && e.data && e.data.error) || 'That colour could not be read.'; out.style.color = 'var(--danger, #b3261e)'; } });
  }
  function poke() { var H = window.KAStudioHost; if (H && H.schedule) H.schedule(); }

  // ── what goes to the engine ──
  function payload() {
    var colours = {}; LET.forEach(function (l) { colours[l] = hex(l); });
    var names = {}; LET.forEach(function (l) { if (S.names[l]) names[l] = S.names[l]; });
    var num = function (v) { var n = parseFloat(v); return n >= 0 && v !== '' ? n : undefined; };
    return { colours: colours, names: names, order: { kg: num(S.kg), loss_pct: num(S.loss), lot_min_kg: num(S.lot) } };
  }
  function state() { return JSON.parse(JSON.stringify(S)); }
  function setState(o) {
    S = Object.assign(blank(), o || {}); S.names = Object.assign({}, S.names); S.codes = Object.assign({}, S.codes);
    var card = $('cw-card');
    if (card && card.getAttribute('data-ready')) {
      LET.forEach(function (l) { var e = $('cw-nm-' + l), c = $('cw-cd-' + l); if (e) e.value = S.names[l] || ''; if (c) c.value = S.codes[l] || ''; });
      ['kg', 'loss', 'lot'].forEach(function (k) { var e = $('cw-' + k); if (e) e.value = S[k] || ''; });
      drawBuilder();
    }
    last = null; render();
  }

  // ── what comes back ──
  function fast(f) { return f ? f[0] === f[1] ? String(f[0]) : f[0] + '–' + f[1] : '—'; }
  function render() {
    var pane = $('pane-colours'), sum = $('cw-sum'); if (!pane) return;
    ensureCss();
    var cw = last;
    if (sum) sum.textContent = cw && cw.colours ? '· ' + cw.kind + ', ' + cw.colours_n + ' colours' + (cw.checks.some(function (c) { return c.level === 'warn'; }) ? ', ' + cw.checks.filter(function (c) { return c.level === 'warn'; }).length + ' to check' : '') : '';
    if (!cw) { pane.innerHTML = '<p class="st-p">No colours yet. Give two or more feeders a colour in the drawing, type a stripe (A12 B4 C2) in the Colours card, or paint a motif in the jacquard card. This tab then shows the yarn each colour needs, how it is dyed, and which colours touch.</p>'; return; }
    if (cw.success === false) { pane.innerHTML = '<div class="cw-note warn">' + esc(cw.error) + '</div>'; return; }
    var h = '<div class="st-p"><b>' + esc(cw.kind.charAt(0).toUpperCase() + cw.kind.slice(1)) + '</b> · ' + cw.colours_n + ' colours · ' + cw.rows + ' pixel row' + (cw.rows === 1 ? '' : 's') + ' in the repeat · a row takes ' + cw.feeds_per_row + ' feed' + (cw.feeds_per_row === 1 ? '' : 's') + ' and ' + cw.colours_per_row + ' yarn' + (cw.colours_per_row === 1 ? '' : 's') + '</div>';
    h += '<div style="display:flex;height:22px;border:1px solid var(--line);border-radius:6px;overflow:hidden;margin:6px 0">' + cw.colours.map(function (c) { return '<i style="flex:' + Math.max(1, c.yarn_pct) + ' 0 0;background:' + esc(c.hex) + '" title="' + esc(c.name || c.letter) + ' ' + c.yarn_pct + ' % of the yarn"></i>'; }).join('') + '</div>';
    var ord = cw.order;
    h += '<div class="bl-scroll"><table class="cw-t"><tr><th>Colour</th><th>Yarn share</th><th>On the face</th>' + (ord ? '<th>Yarn to dye</th>' : '') + '<th>Depth</th><th>Dye on the weight of yarn</th><th>Route</th><th>Fastness (typical grades)</th></tr>' +
      cw.colours.map(function (c) {
        var f = c.fastness && c.fastness.overall;
        return '<tr><td><span class="cw-dot" style="background:' + esc(c.hex) + '"></span><b>' + esc(c.name || c.letter) + '</b>' + (c.name ? ' (' + c.letter + ')' : '') + (c.feeders != null ? '<div class="st-hint" style="margin:0">' + c.feeders + ' feeders</div>' : '') + '</td>' +
          '<td>' + c.yarn_pct + ' %</td><td>' + c.face_pct + ' %' + (c.back_pct != null ? ' · back ' + c.back_pct + ' %' : '') + '</td>' +
          (ord ? '<td>' + (c.kg_yarn != null ? '<b>' + c.kg_yarn + ' kg</b>' : '—') + (c.below_min_lot ? '<div class="cw-chip warn">under the ' + c.lot_min_kg + ' kg minimum</div>' : '') + '</td>' : '') +
          '<td>' + esc(c.depth_label) + '</td><td>' + (c.dye.length ? c.dye.map(function (d) { return d.owf_pct + ' % ' + esc(d.class) + (d.kg_for_order != null ? ' · ' + d.kg_for_order + ' kg dye' : ''); }).join('<br>') : 'no dye: bleached and brightened') + '</td>' +
          '<td>' + c.route.map(esc).join(' → ') + '</td>' +
          '<td>' + (f ? 'wash ' + fast(f.wash) + ' · staining ' + fast(f.stain) + ' · wet rub ' + fast(f.rub_wet) + ' · light ' + fast(f.light) : '—') + '</td></tr>';
      }).join('') + '</table></div>';
    if (ord) h += '<div class="st-hint">An order of ' + ord.fabric_kg + ' kg of fabric needs ' + ord.yarn_kg_total + ' kg of yarn to dye in all, with ' + ord.loss_pct + ' % lost in dyeing and winding.</div>';
    h += '<div class="ml-h" style="margin-top:10px;font:600 12px var(--head)">Which colours touch</div>';
    h += cw.pairs.length ? '<div class="bl-scroll"><table class="cw-t"><tr><th>Pair</th><th>Share of the edges</th><th>ΔE00</th><th>What it means</th></tr>' + cw.pairs.map(function (p) {
      var a = cw.colours.filter(function (c) { return c.letter === p.a; })[0], b = cw.colours.filter(function (c) { return c.letter === p.b; })[0];
      return '<tr><td><span class="cw-dot" style="background:' + esc(a.hex) + '"></span><span class="cw-dot" style="background:' + esc(b.hex) + '"></span>' + p.a + ' – ' + p.b + '</td><td>' + p.edge_pct + ' %</td><td>' + (p.delta_e00 != null ? p.delta_e00 : '—') + '</td><td><span class="cw-chip ' + (p.risk === 'ok' ? 'ok' : p.risk === 'stain' ? 'warn' : 'note') + '">' + (p.risk === 'ok' ? 'clear edge' : p.risk === 'stain' ? 'staining risk' : 'tone on tone') + '</span> ' + esc(p.words) + '</td></tr>';
    }).join('') + '</table></div>' : '<div class="st-hint">Only one colour touches the next in a way the drawing shows.</div>';
    h += '<div class="ml-h" style="margin-top:10px;font:600 12px var(--head)">On the machine</div><div class="st-p">' + esc(cw.machine.note) + ' ' + cw.machine.cones_to_hang + ' cones to hang' + (cw.machine.fingers_needed > 1 ? ', ' + cw.machine.fingers_needed + ' yarns at one feeder (' + (cw.machine.fingers_available || 0) + ' finger(s) on this machine)' : '') + '.</div>';
    h += '<div class="ml-h" style="margin-top:10px;font:600 12px var(--head)">Check before you order</div>' + cw.checks.map(function (c) { return '<div class="cw-note ' + (c.level === 'warn' ? 'warn' : c.level === 'ok' ? 'ok' : '') + '">' + esc(c.text) + '</div>'; }).join('');
    h += '<div class="st-hint" style="margin-top:8px">Law: ' + esc(cw.basis.law.join('; ')) + '. Typical: ' + esc(cw.basis.typical.join('; ')) + '. Estimated: ' + esc(cw.basis.estimate.join('; ')) + '. Replaced by ' + esc(cw.basis.replaced_by) + '.</div>';
    pane.innerHTML = h;
  }
  function studioResult(r) {
    last = r && r.colourway ? r.colourway : null; render();
    // a design that was loaded brings its own stripe: draw it, unless the person is typing in the builder
    var host = $('cw-builder'), inp = $('st-stripe');
    if (host && inp && !host.contains(document.activeElement) && stripeText(parseStripe(inp.value)) !== stripeText(rowsFromDom())) drawBuilder();
  }

  // yarn colours given by another tool (a picture's palette): the swatch, the code and the name of each letter
  function setColours(list) {
    (list || []).forEach(function (c) {
      var l = c.letter, sw = $('st-sc-' + l); if (!sw || !/^#[0-9a-f]{6}$/i.test(c.hex || '')) return;
      sw.value = c.hex; sw.dispatchEvent(new Event('input', { bubbles: true })); sw.dispatchEvent(new Event('change', { bubbles: true }));
      if (c.pantone) {
        S.codes[l] = c.pantone.code; S.names[l] = c.pantone.name;
        var cd = $('cw-cd-' + l), nm = $('cw-nm-' + l), out = $('cw-cdo-' + l);
        if (cd) cd.value = c.pantone.code; if (nm) nm.value = c.pantone.name;
        if (out) { out.textContent = c.hex + ' · nearest Pantone TCX, ΔE00 ' + c.pantone.delta_e00; out.style.color = ''; }
      }
    });
  }

  window.KAStudioColourway = { setColours: setColours, payload: payload, state: state, setState: setState, studioResult: studioResult };
  function init() { build(); render(); }
  if (document.readyState === 'complete') setTimeout(init, 200); else window.addEventListener('load', function () { setTimeout(init, 200); });
})();
