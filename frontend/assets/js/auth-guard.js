/**
 * KnitAdvisor — sign-in guard for the calculator pages (app.html, result.html).
 *
 * Load in <head>, synchronously, before anything renders. It hides the page
 * until /api/auth/me answers, so a signed-out visitor is sent to the landing
 * page's sign-in instead of seeing a form that cannot work. This is a
 * convenience, not the lock: the lock is requireUser on the engine endpoints,
 * which refuse a signed-out caller no matter what the browser does.
 */
(function () {
  'use strict';

  var host = window.location.hostname;
  var base = (host === '127.0.0.1' || host === 'localhost')
    ? window.location.protocol + '//' + host + ':3001' : '';

  var root = document.documentElement;
  var hide = document.createElement('style');
  hide.id = 'ka-auth-hide';
  hide.textContent = 'html.ka-auth-pending body{visibility:hidden}';
  document.head.appendChild(hide);
  root.classList.add('ka-auth-pending');

  function toSignIn() {
    var here = window.location.pathname + window.location.search;
    window.location.replace('/?login=1&next=' + encodeURIComponent(here));
  }
  window.kaSignInRedirect = toSignIn;

  function initials(user) {
    var src = (user.full_name || user.email || '?').trim().split(/\s+/);
    var s = (src[0][0] || '') + (src.length > 1 ? src[src.length - 1][0] : '');
    return s.toUpperCase();
  }

  function mountUserChip(user) {
    var bar = document.querySelector('.hdr-right');
    if (!bar || document.getElementById('ka-user-chip')) return;
    var chip = document.createElement('div');
    chip.id = 'ka-user-chip';
    chip.style.cssText = 'display:inline-flex;align-items:center;gap:8px;margin-left:6px;';
    var avatar = document.createElement('span');
    avatar.textContent = initials(user);
    avatar.title = user.email;
    avatar.style.cssText = 'width:28px;height:28px;border-radius:50%;background:#1857C4;color:#fff;' +
      'display:inline-flex;align-items:center;justify-content:center;font:700 11px/1 system-ui,sans-serif;';
    var out = document.createElement('button');
    out.type = 'button';
    out.className = 'btn btn-ghost';
    out.textContent = 'Sign out';
    out.addEventListener('click', function () {
      out.disabled = true;
      fetch(base + '/api/auth/logout', { method: 'POST' })
        .catch(function () {})
        .then(function () { window.location.href = '/'; });
    });
    chip.appendChild(avatar);
    chip.appendChild(out);
    bar.appendChild(chip);
  }

  var redirecting = false;
  fetch(base + '/api/auth/me', { headers: { Accept: 'application/json' }, cache: 'no-store' })
    .then(function (res) {
      if (res.status === 401) { redirecting = true; toSignIn(); return null; }
      return res.ok ? res.json() : null;
    })
    .then(function (data) {
      if (data && data.user) {
        window.KA_USER = data.user;
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', function () { mountUserChip(data.user); });
        } else {
          mountUserChip(data.user);
        }
      }
      // Only a definite 401 redirects (the page stays hidden until it lands).
      // Anything else — a network blip, a 500 — shows the page, whose own calls
      // will surface the real problem instead of leaving a blank screen.
      if (!redirecting) root.classList.remove('ka-auth-pending');
    })
    .catch(function () { root.classList.remove('ka-auth-pending'); });
})();
