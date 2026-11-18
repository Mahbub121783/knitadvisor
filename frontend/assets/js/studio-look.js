/**
 * Fabric Studio — the "Look" tab: the real lustre and texture of the cloth, from the yarn to the dyed and finished fabric.
 *
 * There is no card: the Studio always asks the look engine (backend/engine/domain/fabric-look-engine.js) for the cloth it is
 * showing — the face yarn's real fibres, the real loop length and densities, the colour on screen, the brushing chosen and
 * (if the Yarn chemistry card is on) its mercerising, bio-polish and heat-set. This tab shows the cloth's life stage by stage —
 * yarn, knitted, scoured, dyed, finished — with the sheen, the perceived gloss, the hairiness, the stitch definition, the
 * roughness and the hand at each. The 3D Realistic view takes the last stage as its material, hair and finish settings, so what
 * is drawn is the engines', not a guess.
 *
 * Plain script, no dependencies. window.KAStudioLook:
 *   payload(opts)        the `look` input for /api/studio/analyse
 *   studioResult(r)      the Studio's last answer
 *   apply(clothOpts)     the 3D view's options, with the engine's physics, yarn look, dye method and fibre type put in
 */
(function () {
  'use strict';
  var last = null, side = 'face';

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function ensureCss() {
    if (!$('ml-css') && window.KAStudioMelange && window.KAStudioMelange.css) { var m = document.createElement('style'); m.id = 'ml-css'; m.textContent = window.KAStudioMelange.css; document.head.appendChild(m); }
    if (!$('bl-css') && window.KAStudioBlend && window.KAStudioBlend.css) { var b = document.createElement('style'); b.id = 'bl-css'; b.textContent = window.KAStudioBlend.css; document.head.appendChild(b); }
    if (!$('lk-css')) { var s = document.createElement('style'); s.id = 'lk-css'; s.textContent = '.lk-row{display:grid;grid-template-columns:150px 1fr 56px;gap:8px;align-items:center;font-size:12px;margin:0 0 5px}.lk-row .lk-bar{height:8px;border-radius:4px;background:var(--bg2,#eef1f5);overflow:hidden}.lk-row .lk-bar u{display:block;height:100%;background:var(--accent);text-decoration:none}.lk-row b{text-align:right;font-variant-numeric:tabular-nums}.lk-stage{border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin:0 0 8px;background:var(--bg)}.lk-stage h4{margin:0 0 4px;font:700 13px var(--head)}.lk-stage .ml-note{margin:2px 0 6px}'; document.head.appendChild(s); }
  }
  function tag(t) { return t ? '<span class="ml-b ml-b-' + esc(t) + '">' + esc(t) + '</span>' : ''; }
  function val(o) { return o && o.value != null ? o.value + (o.unit ? ' ' + esc(o.unit) : '') : '—'; }

  function payload(extra) {
    var ch = window.KAStudioChem ? window.KAStudioChem.payload() : null;
    var o = { colour: $('st-col') ? $('st-col').value : undefined, brushed: $('st-brush') ? $('st-brush').value : 'none',
      mercerise: ch ? !!ch.mercerise : false, biopolish: ch && ch.biopolish === false ? false : true, heatset: ch && ch.heatset === 'none' ? false : true };
    if (extra) for (var k in extra) o[k] = extra[k];
    return o;
  }

  // a row of stage values as bars: each metric against its own scale
  function bars(stages, key, label, max, fmt) {
    return '<div class="ml-h">' + esc(label) + '</div>' + stages.map(function (s) {
      var v = s[key].value; var w = Math.max(0, Math.min(100, (v / max) * 100));
      return '<div class="lk-row"><span>' + esc(s.label) + '</span><span class="lk-bar"><u style="width:' + w + '%"></u></span><b>' + (fmt ? fmt(v) : v) + '</b></div>';
    }).join('');
  }

  function render(r) {
    var pane = $('pane-look'); if (!pane) return;
    ensureCss();
    if (!r) { pane.innerHTML = '<p class="st-p">The look of the cloth appears here once the Studio has an answer: its lustre and texture at every stage of its life.</p>'; return; }
    var F = side === 'back' && r.back ? r.back : r.face;
    var h = '';
    if (r.back) h += '<div class="ml-seg" role="group"><button type="button" data-lk-side="face" class="' + (side === 'face' ? 'on' : '') + '">Face</button><button type="button" data-lk-side="back" class="' + (side === 'back' ? 'on' : '') + '">Back</button></div>';
    var fl = F.final;
    h += '<div style="font:700 17px var(--head)">' + esc(F.yarn) + ' — the ' + side + ' of the cloth</div><div class="ml-note">Dyed ' + esc(r.cloth.shade) + ' (body luminance ' + r.cloth.shade_body + '), ' + esc(r.cloth.dye_method) + ' dyeing' + (r.cloth.finish.mercerise ? ', mercerised' : '') + (r.cloth.finish.biopolish ? ', bio-polished' : '') + (r.cloth.finish.heatset ? ', heat-set' : '') + (r.cloth.finish.softener ? ', softened' : '') + (r.cloth.finish.brushed !== 'none' ? ', raised (' + esc(r.cloth.finish.brushed) + ')' : '') + '. Cover ' + F.geometry.cover + ' (the loops cover ' + Math.round((1 - Math.exp(-F.geometry.cover)) * 100) + ' % of the face), alignment ' + F.geometry.alignment + '.</div>';
    r.warnings.forEach(function (w) { h += '<div class="ml-note warn">' + esc(w.text) + '</div>'; });
    h += '<div class="bl-kpis"><div class="bl-kpi"><b>' + fl.lustre_class + '</b><span>Lustre (' + fl.lustre + ')</span></div><div class="bl-kpi"><b>' + fl.perceived_gloss.value + ' %</b><span>Perceived gloss' + tag('law') + '</span></div><div class="bl-kpi"><b>' + fl.hairiness.value + '×</b><span>Hairiness vs combed cotton</span></div><div class="bl-kpi"><b>' + fl.stitch_definition.value + '</b><span>Stitch definition</span></div><div class="bl-kpi"><b>' + fl.roughness.value + '</b><span>Roughness</span></div><div class="bl-kpi"><b>' + fl.softness.value + '</b><span>Softness (cotton yarn = 100)</span></div></div>';
    h += '<div class="ml-h">Its life, stage by stage</div>' + F.stages.map(function (s) {
      return '<div class="lk-stage"><h4>' + esc(s.label) + '</h4><div class="ml-note">' + esc(s.note || '') + '</div><div class="ml-note">Sheen ' + val(s.sheen_index) + tag(s.sheen_index.basis) + ' · ' + esc(s.lustre_class) + ' · perceived gloss ' + val(s.perceived_gloss) + ' · hair ' + s.hairiness.value + '× · definition ' + s.stitch_definition.value + ' · roughness ' + s.roughness.value + ' · softness ' + s.softness.value + '</div></div>';
    }).join('');
    h += bars(F.stages, 'sheen_index', 'Sheen index (raw cotton yarn = 100)', Math.max.apply(null, F.stages.map(function (s) { return s.sheen_index.value; })) * 1.1);
    h += bars(F.stages, 'perceived_gloss', 'Perceived gloss (% of the light that is specular)', 100);
    h += bars(F.stages, 'hairiness', 'Hairiness (× combed cotton)', Math.max.apply(null, F.stages.map(function (s) { return s.hairiness.value; })) * 1.2 || 1, function (v) { return v.toFixed(2); });
    h += bars(F.stages, 'stitch_definition', 'Stitch definition', 100);
    h += bars(F.stages, 'roughness', 'Roughness', 100);
    h += bars(F.stages, 'softness', 'Softness', 160);
    var rd = side === 'back' && r.render_back ? r.render_back : r.render;
    h += '<div class="ml-h">What the 3D view is given</div><dl class="ml-kv"><dt>Fibre</dt><dd>' + esc(rd.fibre_type) + '</dd><dt>Material</dt><dd>roughness ' + rd.physics.roughness + ' · specular sheen ' + rd.physics.specular_sheen + ' · shadow depth ' + rd.physics.shadow_depth + '</dd><dt>Finish</dt><dd>' + esc(rd.physics.finish_id) + ' · ' + esc(rd.dye_method) + ' dye</dd><dt>Yarn</dt><dd>hairiness ' + rd.yarn_look.hairAbs + ' · gloss ' + rd.yarn_look.gloss + ' · bulk ' + rd.yarn_look.bulk + ' · ' + esc(rd.yarn_look.lustre_class) + (rd.yarn_look.filament ? ' · filament' : '') + '</dd></dl><div class="ml-rm">The Realistic cloth view draws the yarn from these: the lustre and the hairs are the engines\', carried through knitting, dyeing and finishing, not a preset.</div>';
    h += '<div class="ml-h">Derivations</div><details><summary class="ml-note" style="cursor:pointer">Show the working (' + r.derivations.length + ')</summary>' + r.derivations.map(function (d) { return '<div class="bl-der"><b>' + esc(d.quantity) + ' = ' + esc(d.result) + (d.unit ? ' ' + esc(d.unit) : '') + tag(d.basis) + '</b><code>' + esc(d.formula) + '\n' + esc(d.working) + '</code></div>'; }).join('') + '</details>';
    h += '<div class="ml-rm">Sheen, geometry and finishing multipliers are estimates: a glossmeter reading on the finished cloth fits them. The yarn stage is the blend yarn engine\'s own measured-and-blended sheen and hairiness.</div>';
    pane.innerHTML = h;
  }

  /** The 3D view's options, with the engine's look put in. A mercerising, polish or brush the engine chose shows as the finish. */
  function apply(o) {
    var r = last; if (!r || !r.render) return o;
    var rd = r.render;
    var yl = Object.assign({}, o.yarnLook || {});
    yl.hairAbs = rd.yarn_look.hairAbs; yl.hairLen = rd.yarn_look.hairLen; yl.gloss = rd.yarn_look.gloss; yl.bulk = o.yarnLook && o.yarnLook.bulk ? o.yarnLook.bulk : rd.yarn_look.bulk;
    yl.lustre = rd.yarn_look.lustre; yl.lustre_class = rd.yarn_look.lustre_class; yl.filament = rd.yarn_look.filament; yl.dty = rd.yarn_look.dty;
    if (o.yarnLook) { yl.ply = o.yarnLook.ply; yl.slub = o.yarnLook.slub; }
    o.yarnLook = yl;
    o.physics = Object.assign({}, rd.physics);
    o.dyeMethod = rd.dye_method;
    o.fiberType = rd.fibre_type;
    return o;
  }
  /** The yarn view's material roughness for a role, relative to a cotton yarn: the engine's sheen, not a preset. */
  function yarnRoughnessScale(role) {
    var y = last && last.yarns && last.yarns[role]; if (!y || !y.sheen_index) return 1;
    var rough = function (s) { return Math.max(0.22, Math.min(0.92, 1.0 - 0.55 * Math.log10(Math.max(s, 40) / 50))); };
    return +(rough(y.sheen_index.value) / rough(100)).toFixed(3);
  }
  function key() { return last && last.render ? JSON.stringify([last.render.physics, last.render.yarn_look, last.render.dye_method, last.render.fibre_type]) : ''; }

  function bind() {
    var pane = $('pane-look'); if (pane) pane.addEventListener('click', function (e) { var b = e.target.closest('[data-lk-side]'); if (b) { side = b.getAttribute('data-lk-side'); render(last); } });
  }
  function studioResult(r) {
    var was = key();
    last = r && r.look ? r.look : null;
    render(last);
    if (key() !== was) document.dispatchEvent(new Event('ka-look'));
  }

  window.KAStudioLook = { payload: payload, studioResult: studioResult, apply: apply, key: key, yarnRoughnessScale: yarnRoughnessScale };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { bind(); render(null); }); else { bind(); render(null); }
})();
