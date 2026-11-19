/**
 * Fabric Studio — save the 3D view as a high-resolution picture.
 *
 * The view draws to a canvas the size of its panel. A picture for a tech pack, a buyer or a print needs far more pixels, so the same scene,
 * camera and lights are drawn once more into a bigger drawing buffer (the panel's own proportions kept), saved as a PNG, and the live
 * view is put back as it was. The size asked for is cut down to what the graphics card can hold, and the size really saved is said.
 *
 * Plain script, no dependencies. window.KAStudioCapture:
 *   limit(view)                     the largest width this card can draw at this panel's proportions
 *   save(view, width, name, {aspect, format})  → Promise of { width, height, asked, clipped, bytes }; the PNG is downloaded
 * `view` is any of the Studio's three-dimensional views: it has .renderer, .scene and .camera and a resize method.
 */
(function () {
  'use strict';

  function maxSide(r) {
    var gl = r.getContext(), a = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), b = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    var v = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    return Math.min(a, b, v && v.length ? Math.min(v[0], v[1]) : 16384, 16384);
  }
  function sizeFor(view, asked, shape) {
    var el = view.renderer.domElement, cw = el.clientWidth || 800, ch = el.clientHeight || 600, aspect = shape > 0 ? shape : cw / ch, max = maxSide(view.renderer);
    var w = Math.min(asked, max), h = Math.round(w / aspect);
    if (h > max) { h = max; w = Math.round(h * aspect); }
    return { w: w, h: h, cw: cw, ch: ch, max: max, aspect: aspect };
  }
  function limit(view) { var s = sizeFor(view, 16384); return s.w; }

  function restore(view, pr, cw, ch) {
    var r = view.renderer;
    r.setPixelRatio(pr); r.setSize(cw, ch);
    if (typeof view.resize === 'function') view.resize(); else if (typeof view._resize === 'function') view._resize();
    if (typeof view.redraw === 'function') view.redraw();
  }

  function save(view, asked, name, opt) {
    opt = opt || {};
    return new Promise(function (resolve, reject) {
      if (!view || !view.renderer || !view.scene || !view.camera) { reject(new Error('Open a 3D view first.')); return; }
      var r = view.renderer, s = sizeFor(view, asked, opt.aspect), pr = r.getPixelRatio(), cam = view.camera, cAsp = cam.aspect, jpeg = opt.format === 'jpeg';
      try {
        r.setPixelRatio(1); r.setSize(s.w, s.h, false);
        if (opt.aspect > 0) { cam.aspect = s.aspect; cam.updateProjectionMatrix(); }
        r.render(view.scene, cam);
        r.domElement.toBlob(function (blob) {
          if (opt.aspect > 0) { cam.aspect = cAsp; cam.updateProjectionMatrix(); }
          restore(view, pr, s.cw, s.ch);
          if (!blob) { reject(new Error('The picture could not be made at ' + s.w + ' px: try a smaller size.')); return; }
          var a = document.createElement('a'), url = URL.createObjectURL(blob);
          a.href = url; a.download = (name || 'knitadvisor') + '-' + s.w + 'x' + s.h + (jpeg ? '.jpg' : '.png');
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
          resolve({ width: s.w, height: s.h, asked: asked, clipped: s.w < asked && Math.abs(s.w - asked) > 1, bytes: blob.size });
        }, jpeg ? 'image/jpeg' : 'image/png', 0.93);
      } catch (e) { if (opt.aspect > 0) { cam.aspect = cAsp; cam.updateProjectionMatrix(); } restore(view, pr, s.cw, s.ch); reject(e); }
    });
  }

  window.KAStudioCapture = { limit: limit, save: save };
})();
