/**
 * KnitAdvisor · view guard — keeps the page usable around the 2D and 3D fabric views.
 *
 * 1. The mouse wheel scrolls the PAGE past a view. It zooms the view only with Ctrl / ⌘ held (a trackpad pinch
 *    sends the same), or once the view has been clicked — until the pointer leaves it. A wheel that does not
 *    zoom shows a short hint over the view. Before this, a wheel over a view always zoomed it, so on a desktop
 *    the page stopped scrolling whenever the cursor crossed a swatch.
 * 2. onScreen(el, cb) tells a renderer when its view is near the screen, so it can stop drawing when it is not.
 * 3. whenNear(el, fn) runs fn once a view comes near the screen: heavy 3D builds wait until someone will see them.
 *
 * A plain script that sets window.KAViewGuard: loaded by a <script> tag on a page, or imported for its side
 * effect by an ES module. Loading it twice keeps the first copy.
 */
(function () {
  if (typeof window === 'undefined' || window.KAViewGuard) return;

  var MAC = /Mac|iPhone|iPad/.test((navigator.platform || '') + ' ' + (navigator.userAgent || ''));
  var KEY = MAC ? '⌘' : 'Ctrl';
  var state = typeof WeakMap === 'function' ? new WeakMap() : null;

  function watch(el) {
    if (!el || !state) return null;
    var st = state.get(el);
    if (st) return st;
    st = { armed: false };
    state.set(el, st);
    // a press on the view arms the plain wheel; leaving the view disarms it. Listened for on the parent, in the
    // capture phase, so a handler on the view that stops the event cannot hide the press.
    var host = el.parentNode || el;
    host.addEventListener('pointerdown', function (e) { if (e.target === el || el.contains(e.target)) st.armed = true; }, true);
    el.addEventListener('pointerleave', function () { st.armed = false; });
    return st;
  }

  var tip = null, tipTimer = 0;
  function hint(el) {
    if (!el || !el.getBoundingClientRect) return;
    var r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) return;
    if (!tip) {
      tip = document.createElement('div');
      tip.setAttribute('role', 'status');
      tip.style.cssText = 'position:absolute;z-index:9000;transform:translate(-50%,-50%);padding:8px 14px;border-radius:999px;' +
        'background:rgba(17,20,26,.82);color:#fff;font:600 12px/1.3 system-ui,-apple-system,Segoe UI,sans-serif;' +
        'pointer-events:none;opacity:0;transition:opacity .18s ease;white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,.25)';
      tip.textContent = KEY + ' + scroll to zoom — or click the view, then scroll';
      document.body.appendChild(tip);
    }
    // over the middle of the part of the view that is on screen, in page coordinates: it moves with the view
    // as the page scrolls on
    var vh = window.innerHeight || document.documentElement.clientHeight || 800;
    var top = Math.max(r.top, 0), bottom = Math.min(r.bottom, vh);
    if (bottom - top < 30) { top = r.top; bottom = r.bottom; }
    tip.style.left = Math.round(r.left + r.width / 2 + (window.pageXOffset || 0)) + 'px';
    tip.style.top = Math.round((top + bottom) / 2 + (window.pageYOffset || 0)) + 'px';
    tip.style.opacity = '1';
    clearTimeout(tipTimer);
    tipTimer = setTimeout(function () { if (tip) tip.style.opacity = '0'; }, 1300);
  }

  /** May this wheel event zoom the view? If not, the caller leaves it alone and the page scrolls. */
  function allow(el, e) {
    var st = watch(el);
    var ok = !!(e && (e.ctrlKey || e.metaKey)) || !!(st && st.armed);
    if (!ok) hint(el);
    return ok;
  }

  /**
   * Gate the wheel of a three.js OrbitControls on `el` (its canvas). OrbitControls skips a wheel event without
   * preventing it when enableZoom is false, so the page scrolls on; the gate sets enableZoom per event, before
   * the controls see it.
   */
  function wheel(el, controls) {
    if (!el || !controls) return function () {};
    watch(el);
    var host = el.parentNode || el;
    var onWheel = function (e) {
      if (e.target !== el && !el.contains(e.target)) return;
      controls.enableZoom = allow(el, e);
    };
    // a touch pinch must still zoom: any press puts zoom back on
    var onDown = function () { controls.enableZoom = true; };
    host.addEventListener('wheel', onWheel, { capture: true, passive: true });
    el.addEventListener('pointerdown', onDown, true);
    return function () { host.removeEventListener('wheel', onWheel, { capture: true }); el.removeEventListener('pointerdown', onDown, true); };
  }

  /** cb(true|false) as the view comes within `margin` of the screen or leaves it. Returns a stop function. */
  function onScreen(el, cb, margin) {
    if (!el || typeof IntersectionObserver !== 'function') { cb(true); return function () {}; }
    var io = new IntersectionObserver(function (entries) {
      var e = entries[entries.length - 1];
      cb(!!(e && e.isIntersecting));
    }, { rootMargin: margin || '160px 0px' });
    io.observe(el);
    return function () { io.disconnect(); };
  }

  /** Run fn once, when el first comes within `margin` of the screen (at once where that cannot be told). */
  function whenNear(el, fn, margin) {
    if (!el || typeof IntersectionObserver !== 'function') { fn(); return function () {}; }
    var done = false;
    var io = new IntersectionObserver(function (entries) {
      if (done || !entries.some(function (x) { return x.isIntersecting; })) return;
      done = true; io.disconnect(); fn();
    }, { rootMargin: margin || '900px 0px' });
    io.observe(el);
    return function () { done = true; io.disconnect(); };
  }

  window.KAViewGuard = { watch: watch, allow: allow, wheel: wheel, hint: hint, onScreen: onScreen, whenNear: whenNear };
})();
