const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ADMIN_SURFACE } = require('../middleware/admin-surface');

console.log('--- Running Admin Surface Tests ---');

// ============================================================================
// A rule that matches nothing looks exactly like a rule that works.
//
// The admin panel and the public pages get different content-security
// policies, because they are built differently: admin.html loads all its code
// from one external file and can run with no 'unsafe-inline' at all, while the
// public pages are inline scripts and ~60 onclick attributes. ADMIN_SURFACE
// decides which response gets which.
//
// It used to name `/admin.html` and `/api/admin`. The routes are mounted at
// `/admin` and `/admin/api/...`, and `/api/admin` has never been a path in
// this app — so the pattern matched NEITHER, every response got the public
// policy, and nothing failed, errored or looked wrong. The one page that
// renders log rows built out of request bodies was the one page running with
// 'unsafe-inline' script-src.
//
// Same class as the costing breakdown that stopped adding up and the "ideal
// 7-33" tightness band: the code was there, the shipped behaviour was wrong,
// and no test looked at what was actually shipped.
// ============================================================================

// ── Every real admin path takes the strict policy ─────────────────────────
for (const p of ['/admin', '/admin/', '/admin.html', '/admin/login', '/admin/logout',
                 '/admin/ping', '/admin/api/logs', '/admin/api/providers',
                 '/admin/api/yarn-prices', '/admin/api/yarn-prices/refresh',
                 '/admin/api/settings/credentials']) {
  assert(ADMIN_SURFACE.test(p),
    `${p} is part of the admin panel and must get the strict CSP`);
}

// ── Nothing else does ─────────────────────────────────────────────────────
// The public pages need 'unsafe-inline' to work at all. Handing them the
// strict policy is the mirror-image failure: every onclick stops firing and
// Calculate silently does nothing, which has happened here before.
for (const p of ['/', '/index.html', '/result.html', '/converter.html',
                 '/api/calculate', '/api/woven/calculate', '/health',
                 '/assets/js/admin.js', '/assets/css/style.css',
                 '/administrator', '/adminx', '/admin-panel']) {
  assert(!ADMIN_SURFACE.test(p),
    `${p} is public and must keep the policy that allows its inline handlers`);
}

// ── The routes the server actually mounts are all covered ─────────────────
// Derived from routes/admin.js rather than from a list typed here, so a new
// admin endpoint cannot be added outside the policy without this failing.
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
  const paths = [...src.matchAll(/router\.(get|post|put|delete|patch)\(\s*'([^']+)'/g)]
    .map(m => '/admin' + (m[2] === '/' ? '' : m[2]));
  assert(paths.length >= 10, `only found ${paths.length} admin routes — did the parse break?`);
  for (const p of paths) {
    // Strip express params so '/admin/api/providers/:id/test' is tested as a
    // real request path would arrive.
    const concrete = p.replace(/:[A-Za-z_]+/g, '123');
    assert(ADMIN_SURFACE.test(concrete),
      `${concrete} is mounted in routes/admin.js but falls outside ADMIN_SURFACE`);
  }
  console.log(`  ${paths.length} mounted admin routes, all inside the strict policy`);
}

// ── The panel must be able to LIVE under that policy ──────────────────────
// script-src-attr 'none' kills inline handlers silently — the button still
// renders, it just does nothing. admin.js injected exactly one `onclick` into
// its provider cards, which is why this policy could not be switched on.
{
  const front = path.join(__dirname, '..', '..', 'frontend');
  const html = fs.readFileSync(path.join(front, 'admin.html'), 'utf8');
  const js = fs.readFileSync(path.join(front, 'assets', 'js', 'admin.js'), 'utf8');

  const inlineScript = /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/.exec(html);
  assert(!inlineScript,
    'admin.html has an inline <script>, which script-src \'self\' will block');

  // Only HTML ATTRIBUTE handlers. `el.onclick = fn` is a DOM property
  // assignment and script-src-attr does not touch it — the directive governs
  // handlers written into markup. Hence the leading [^.\w]: it is what tells
  // `<button onclick="...">` apart from `prev.onclick = () => ...`, and the
  // first version of this test failed on the second.
  const ATTR_HANDLER = /[^.\w]on(click|change|submit|input|keyup|keydown|load|focus|blur)=["']/;
  for (const [name, text] of [['admin.html', html], ['assets/js/admin.js', js]]) {
    const m = ATTR_HANDLER.exec(text);
    assert(!m,
      `${name} writes an inline ${m && m[0].trim()} handler into its markup. Under ` +
      "script-src-attr 'none' it will not fire and nothing will say so — wire it with " +
      'addEventListener instead.');
  }
}

console.log('\nAll admin surface tests passed.');
