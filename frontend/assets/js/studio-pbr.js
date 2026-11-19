/**
 * Fabric Studio — the material package: the cloth as a 3D material for a garment tool or a renderer.
 *
 * One button makes a ZIP of open formats: the maps of one tile of the real structure (albedo with opacity, normal, roughness, ambient occlusion,
 * displacement, opacity, ORM packed), a glTF 2.0 binary of a swatch (or of the draped sample, when the drape has been run) with the maps embedded,
 * the physics of the cloth as numbers, and a README. The maps are read back from the real view's own bake, so the relief, occlusion and holes are the
 * loops the Studio drew; the numbers come from backend/engine/domain/material-package.js. (Browzwear's .u3ma and CLO's .zfab are closed formats with no
 * public specification and are not written: the README says so.)
 *
 * Needs window.KAPbr (pbr-package.js) and window.KAStudioHost (set by studio.js: cloth(), design(), fetch, colour(), name(), openCloth()).
 */
(function () {
  'use strict';
  var busy = false;
  function $(id) { return document.getElementById(id); }
  function note(t, bad) { var n = $('st-pbrnote'); if (n) { n.textContent = t || ''; n.style.color = bad ? 'var(--danger, #b3261e)' : ''; } }
  function slug(s) { return String(s || 'fabric').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'fabric'; }

  // the real view must be built: open it if it is not, and wait for it
  function whenCloth(cb) {
    var H = window.KAStudioHost, tries = 0;
    function look() {
      var c = H.cloth();
      if (c && c.exportMaps && c._macro) { cb(c); return; }
      if (++tries > 60) { cb(null); return; }
      if (tries === 1) { var b = document.querySelector('[data-mode="cloth"]'); if (b) b.click(); }
      setTimeout(look, 400);
    }
    look();
  }

  function make() {
    if (busy) return;
    var H = window.KAStudioHost, P = window.KAPbr;
    if (!H || !P || !P.encodePng) { note('The material package is not available here.', true); return; }
    busy = true; $('st-pbr').disabled = true; note('Opening the real view…');
    whenCloth(function (cloth) {
      if (!cloth) { busy = false; $('st-pbr').disabled = false; note('The real view could not be built: open Fabric (real view) first, then try again.', true); return; }
      var m = cloth.exportMaps();
      if (!m) { busy = false; $('st-pbr').disabled = false; note('This structure has no fixed repeat to tile (eyelets, a plush pile): no tile to export.', true); return; }
      note('Making the maps…');
      var w = m.size.w, h = m.size.h, A = m.maps, hex = H.colour();
      var albedo = P.pack.albedo(A.cover, hex), rough = P.pack.roughness(A.ao, m.roughness), orm = P.pack.orm(A.ao, rough);
      var normal = new Uint8ClampedArray(A.normal); for (var i = 3; i < normal.length; i += 4) normal[i] = 255;
      var maps = [['albedo', albedo], ['normal', normal], ['roughness', rough], ['ao', P.pack.gray(A.ao, 0)], ['displacement', P.pack.stretch(A.height, 0)], ['opacity', P.pack.gray(A.cover, 0)], ['orm', orm]];
      var run = window.KAStudioDrape && window.KAStudioDrape.lastRun ? window.KAStudioDrape.lastRun() : null;
      var wantDrape = $('st-pbrgeo') && $('st-pbrgeo').value === 'draped' && run && run.mesh;
      Promise.all(maps.map(function (x) { return P.encodePng(w, h, x[1]); })).then(function (pngs) {
        var files = ['albedo.png', 'normal.png', 'roughness.png', 'ao.png', 'displacement.png', 'opacity.png', 'orm.png', 'swatch.glb', 'physics.json', 'material.json', 'README.txt'];
        note('Writing the physics and the glTF…');
        return H.fetch('/api/studio/material', { method: 'POST', body: { design: H.design(), name: H.name(), roughness: m.roughness, tile_cm: m.tile_cm, files: files, drape: run && run.success !== false ? { success: true, test: run.test, drape_coefficient: run.drape_coefficient, folds: run.folds, skirt: run.skirt } : null } }).then(function (r) {
          var mat = r.material, byName = {}; maps.forEach(function (x, k) { byName[x[0]] = pngs[k]; });
          var sheenBase = [1, 3, 5].map(function (j) { return parseInt(hex.slice(j, j + 2), 16) / 255; });
          var sheenColour = sheenBase.map(function (v) { return +(v * mat.sheen.colour_mix_with_base + 1 * (1 - mat.sheen.colour_mix_with_base)).toFixed(3) * mat.sheen.strength; });
          var geo = wantDrape ? P.draped(run.mesh, m.tile_cm) : P.plane({ width_m: 0.3, height_m: 0.3, tile_cm: m.tile_cm });
          var glb = P.glb(geo, [{ name: 'albedo', bytes: byName.albedo }, { name: 'normal', bytes: byName.normal }, { name: 'orm', bytes: byName.orm }],
            { name: H.name() || 'knit', alpha_mode: mat.alpha_mode, alpha_cutoff: mat.alpha_cutoff, double_sided: true, sheen: mat.sheen, sheen_colour: sheenColour }, { knitadvisor: { physics: r.physics, material: mat, tile_cm: m.tile_cm, geometry: wantDrape ? 'draped sample' : 'flat swatch, 30 cm' } });
          var enc = new TextEncoder();
          var z = P.zip([
            { name: 'albedo.png', bytes: byName.albedo }, { name: 'normal.png', bytes: byName.normal }, { name: 'roughness.png', bytes: byName.roughness }, { name: 'ao.png', bytes: byName.ao },
            { name: 'displacement.png', bytes: byName.displacement }, { name: 'opacity.png', bytes: byName.opacity }, { name: 'orm.png', bytes: byName.orm },
            { name: 'swatch.glb', bytes: glb }, { name: 'physics.json', bytes: enc.encode(JSON.stringify(r.physics, null, 2)) }, { name: 'material.json', bytes: enc.encode(JSON.stringify({ material: mat, tile_cm: m.tile_cm, tile_pixels: m.size, formats: r.formats }, null, 2)) },
            { name: 'README.txt', bytes: enc.encode(r.readme) },
          ]);
          var blob = new Blob([z], { type: 'application/zip' }), a = document.createElement('a');
          a.href = URL.createObjectURL(blob); a.download = slug(H.name()) + '-material.zip'; document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
          note('Saved ' + slug(H.name()) + '-material.zip: ' + w + ' × ' + h + ' px maps, one tile = ' + (+m.tile_cm.w).toFixed(2) + ' × ' + (+m.tile_cm.h).toFixed(2) + ' cm, ' + (wantDrape ? 'the draped sample' : 'a 30 cm swatch') + ' as glTF, ' + (blob.size / 1048576).toFixed(1) + ' MB.');
        });
      }).catch(function (e) { note((e && e.data && e.data.error) || (e && e.message) || 'The material package could not be made.', true); })
        .then(function () { busy = false; $('st-pbr').disabled = false; });
    });
  }

  function init() { var b = $('st-pbr'); if (b) b.addEventListener('click', make); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.KAStudioPbr = { make: make };
})();
