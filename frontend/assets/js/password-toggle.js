/**
 * Adds a show/hide eye icon to every password field on the page, including
 * ones that appear later (the auth modal's single #fPassword is reused
 * across signin/signup/reset — already in the DOM at load — and any admin
 * field created after a fetch). No per-field markup needed: this wraps
 * whatever <input type="password"> it finds.
 */
(function () {
  'use strict';

  function eyeSvg(crossedOut) {
    var slash = crossedOut ? '<path d="M3 3l18 18" stroke-linecap="round"/>' : '';
    return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8">' +
      '<path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="12" cy="12" r="3"/>' + slash + '</svg>';
  }

  function wire(input) {
    if (input.dataset.pwWired || !input.parentNode) return;
    input.dataset.pwWired = '1';

    var wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    var existingPad = window.getComputedStyle(input).paddingRight;
    input.style.paddingRight = 'max(' + (existingPad || '0px') + ', 38px)';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Show password');
    btn.style.cssText = 'position:absolute;right:6px;top:50%;transform:translateY(-50%);' +
      'background:none;border:none;padding:5px;margin:0;cursor:pointer;color:inherit;' +
      'opacity:.55;display:flex;align-items:center;line-height:0;';
    btn.innerHTML = eyeSvg(false);
    btn.addEventListener('mouseenter', function () { btn.style.opacity = '.9'; });
    btn.addEventListener('mouseleave', function () { btn.style.opacity = '.55'; });
    btn.addEventListener('click', function () {
      var showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.innerHTML = eyeSvg(!showing);
      btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    });
    wrap.appendChild(btn);
  }

  function wireAll(root) {
    (root || document).querySelectorAll('input[type="password"]').forEach(wire);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { wireAll(); });
  else wireAll();

  // Covers fields built after an async render (e.g. an admin modal populated post-fetch).
  new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var added = muts[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var n = added[j];
        if (n.nodeType !== 1) continue;
        if (n.matches && n.matches('input[type="password"]')) wire(n);
        if (n.querySelectorAll) wireAll(n);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
