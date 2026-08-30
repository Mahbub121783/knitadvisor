#!/usr/bin/env node
/**
 * End-to-end smoke test: load the real pages in a real DOM and use them.
 *
 *   node tests/e2e/smoke.js                        # against production
 *   node tests/e2e/smoke.js http://localhost:3001  # against a local server
 *
 * WHY THIS EXISTS
 * ---------------
 * Moving frontend/js and frontend/css under assets/ broke the results page for
 * every user, and the check run afterwards reported all nine pages green. That
 * check followed src="" and href="" attributes. Three.js is declared in an
 * import map — JSON inside a <script type="importmap"> — so it kept pointing at
 * /js/vendor/three.module.js, which had become a 404.
 *
 * The lesson is not "also check import maps". It is that a check written in
 * terms of how assets are *referenced* can only ever find the reference styles
 * its author thought of. This one is written in terms of what a user does:
 * open the page, choose a fabric, press Calculate, read the answer. If any link
 * in that chain breaks, however it was written, this fails.
 *
 * Requires jsdom, which is intentionally not a dependency of the app:
 *   npm i --no-save jsdom
 */
'use strict';

const BASE = (process.argv[2] || 'https://knitadvisor.onlinetextileschool.com').replace(/\/$/, '');

let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require('jsdom'));
} catch {
  console.error('jsdom is not installed. Run:  npm i --no-save jsdom');
  process.exit(2);
}

const CASE = { fabric: 'french_terry', gsm: 280, color_input: '11-1306 TCX', efficiency: 85 };

const failures = [];
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures.push(label + (detail ? ': ' + detail : ''));
};

/** A jsdom window that can actually reach the network and log honestly. */
function makeDom(html, url, extra = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e.message || e)));
  vc.on('error', (...a) => errors.push(a.join(' ')));

  const dom = new JSDOM(html, {
    url, runScripts: 'dangerously', resources: 'usable',
    pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      // jsdom ships no fetch. Without it the pages take their own
      // "API not available" fallback paths and the test measures the harness.
      window.fetch = (input, init) =>
        fetch(typeof input === 'string' && input.startsWith('/') ? BASE + input : input, init);
      window.Request = Request; window.Response = Response; window.Headers = Headers;
      if (extra.beforeParse) extra.beforeParse(window);
    },
  });
  return { dom, errors };
}

// jsdom has no canvas and cannot navigate. Both are limitations of the harness,
// not defects in the page, and must not be reported as failures.
const HARNESS_NOISE = /getContext|Not implemented: navigation|canvas npm package/i;
const realErrors = errs => [...new Set(errs)].filter(e => !HARNESS_NOISE.test(e));

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function testFormPage() {
  console.log('\nFORM PAGE  ' + BASE + '/');
  const html = await (await fetch(BASE + '/')).text();
  const { dom, errors } = makeDom(html, BASE + '/');
  const { window } = dom;
  await sleep(6000);
  const doc = window.document;

  check(typeof window.doCalculate === 'function', 'doCalculate is defined');
  const sel = doc.getElementById('fabric-select');
  check(!!sel && sel.options.length > 50, 'fabric list loaded from the API',
        sel ? sel.options.length + ' options' : 'no select');

  doc.getElementById('gsm-input').value = String(CASE.gsm);
  if (sel) sel.value = CASE.fabric;
  doc.getElementById('color-engine-input').value = CASE.color_input;

  doc.getElementById('calc-btn').click();
  await sleep(9000);

  const pending = window.sessionStorage.getItem('kna_pending');
  check(!!pending, 'Calculate stored params for the results page');
  if (pending) {
    const p = JSON.parse(pending).params;
    check(p.fabric === CASE.fabric && Number(p.gsm) === CASE.gsm,
          'stored params match what was entered', JSON.stringify({ fabric: p.fabric, gsm: p.gsm }));
  }
  const errs = realErrors(errors);
  check(errs.length === 0, 'no script errors on the form page', errs.slice(0, 3).join(' | '));
  window.close();
}

async function testResultPage() {
  console.log('\nRESULTS PAGE  ' + BASE + '/result.html');
  const html = await (await fetch(BASE + '/result.html')).text();
  const { dom, errors } = makeDom(html, BASE + '/result.html', {
    beforeParse(window) {
      window.sessionStorage.setItem('kna_pending',
        JSON.stringify({ params: CASE, ts: Date.now() }));
    },
  });
  await sleep(12000);
  const doc = dom.window.document;

  const main = doc.getElementById('result-main');
  check(!!main && !main.classList.contains('hidden'), 'results section is shown');

  const loading = doc.getElementById('page-loading');
  check(!loading || loading.classList.contains('hidden'), 'loading state cleared');

  // The numbers a knitter actually reads off the page.
  const values = {
    'res-fabric-name': /\w{3,}/,
    'res-gsm': /\d/,
    'll-mm': /\d/,
    'll-cm': /\d/,
  };
  for (const [id, shape] of Object.entries(values)) {
    const el = doc.getElementById(id);
    const text = el ? el.textContent.trim() : '';
    check(!!el && shape.test(text), `${id} rendered`, text || '(empty)');
  }

  const errs = realErrors(errors);
  check(errs.length === 0, 'no script errors on the results page', errs.slice(0, 3).join(' | '));
  dom.window.close();
}

/**
 * Every locally-hosted asset the page names, in ANY position — attribute,
 * import map, dynamic import(), or a quoted path in inline script — must
 * resolve. This is the check that the attribute-only version missed.
 */
async function testAssets() {
  console.log('\nASSETS  every reference style, every page');
  const pages = ['', 'result.html', 'converter.html', 'patterns.html', 'weft-calc.html',
                 'academy.html', 'diagnostics.html', 'admin.html', '404.html'];
  const seen = new Map();

  for (const page of pages) {
    const html = await (await fetch(`${BASE}/${page}`)).text();
    const refs = new Set();
    for (const m of html.matchAll(/["'`](\/?(?:assets\/)?(?:js|css)\/[A-Za-z0-9._/-]+\.(?:js|css|mjs))/g)) {
      refs.add(m[1]);
    }
    for (const ref of refs) {
      const url = `${BASE}/${ref.replace(/^\//, '')}`;
      if (!seen.has(url)) {
        const res = await fetch(url, { method: 'HEAD' });
        seen.set(url, res.status);
      }
      if (seen.get(url) !== 200) {
        check(false, `/${page || 'index'} references ${ref}`, 'HTTP ' + seen.get(url));
      }
    }
  }
  const broken = [...seen.values()].filter(s => s !== 200).length;
  check(broken === 0, `all ${seen.size} distinct asset references resolve`);
}

(async () => {
  console.log('E2E smoke — ' + BASE);
  await testAssets();
  await testFormPage();
  await testResultPage();

  console.log('\n' + '='.repeat(56));
  if (failures.length) {
    console.log(`  ${failures.length} FAILURE(S)`);
    failures.forEach(f => console.log('   - ' + f));
    console.log('='.repeat(56));
    process.exit(1);
  }
  console.log('  all checks passed — a user can calculate end to end');
  console.log('='.repeat(56));
  process.exit(0);
})().catch(e => { console.error('\nharness failed:', e.message); process.exit(2); });
