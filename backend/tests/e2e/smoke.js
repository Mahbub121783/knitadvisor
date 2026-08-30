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

/**
 * The woven path, driven the way a user drives it: pick a woven quality out of
 * the same dropdown, press the same button, and read the answer off the page.
 *
 * It is a separate test from testFormPage because it takes a different branch
 * at every step — no target GSM, a different panel, a different endpoint, and
 * an answer rendered in place instead of on the results page. Sharing one test
 * would have meant sharing none of the code that actually runs.
 */
async function testWovenPath() {
  console.log('\nWOVEN PATH  ' + BASE + '/');
  const html = await (await fetch(BASE + '/')).text();
  const { dom, errors } = makeDom(html, BASE + '/');
  const { window } = dom;
  await sleep(6000);
  const doc = window.document;

  const sel = doc.getElementById('fabric-select');
  const wovenOpts = sel ? [...sel.options].filter(o => o.value.startsWith('woven_')) : [];
  check(wovenOpts.length >= 20, 'woven qualities are in the fabric dropdown',
        wovenOpts.length + ' options');

  const group = sel ? [...sel.querySelectorAll('optgroup')].find(g => /woven/i.test(g.label)) : null;
  check(!!group, 'they are grouped under their own heading', group ? group.label : 'no woven optgroup');

  // The label has to say what the cloth IS. A woven quality with no construction
  // in its label is indistinguishable from every other woven quality.
  const denim = wovenOpts.find(o => o.value === 'woven_denim');
  check(!!denim && /56×44/.test(denim.text) && /8s\/6s/.test(denim.text),
        'a woven option is labelled by its construction', denim ? denim.text : 'no denim option');

  if (!denim) { window.close(); return; }

  sel.value = 'woven_denim';
  sel.dispatchEvent(new window.Event('change'));
  await sleep(300);

  const panel = doc.getElementById('woven-panel');
  check(!!panel && !panel.classList.contains('hidden'), 'selecting it reveals the woven construction fields');
  check(doc.getElementById('epi-input').value === '56' && doc.getElementById('ppi-input').value === '44',
        'the sett is pre-filled from the selected quality',
        doc.getElementById('epi-input').value + ' x ' + doc.getElementById('ppi-input').value);
  check(doc.getElementById('warp-count-input').value === '8s',
        'so are the counts', doc.getElementById('warp-count-input').value);

  const warpPanel = doc.getElementById('warp-knit-panel');
  check(!!warpPanel && warpPanel.classList.contains('hidden'),
        'the warp-knit fields stay hidden — they do not apply to a woven cloth');

  doc.getElementById('cloth-width-input').value = '60';
  doc.getElementById('cloth-length-input').value = '1000';
  doc.getElementById('calc-btn').click();
  await sleep(9000);

  const wrap = doc.getElementById('woven-result-wrap');
  check(!!wrap && !wrap.classList.contains('hidden'), 'the woven answer appears in place');

  const out = doc.getElementById('woven-result');
  const text = out ? out.textContent : '';
  check(/DRAFTING PLAN/.test(out ? out.innerHTML : ''), 'the drafting plan is drawn');
  check(/PEG PLAN/.test(out ? out.innerHTML : ''), 'the peg plan is drawn');
  check(/DENTING/.test(out ? out.innerHTML : ''), 'the denting order is drawn');
  check(out ? out.querySelectorAll('svg').length === 2 : false,
        'both figures are present — loom plans and cloth appearance',
        out ? out.querySelectorAll('svg').length + ' svg' : 'no container');
  check(/348\.4 g\/m²/.test(text), 'the cloth weight is shown', (text.match(/[\d.]+ g\/m²/) || ['none'])[0]);
  check(/steep \/ high angle twill/.test(text), 'the twill is classified by the sett');
  // The form promises a kilogram figure for the width and length entered, so
  // the page has to actually produce one.
  check(/Yarn Requirement/.test(text) && /546\.733 kg/.test(text),
        'the yarn requirement for 1000 m x 60 in is shown',
        (text.match(/[\d.]+ kg/g) || ['none']).join(' '));
  check(!/undefined|NaN|\[object/.test(text), 'no undefined, NaN or [object Object] reached the page');

  // Switching back to a knit fabric must restore the knit form completely.
  sel.value = 'single_jersey';
  sel.dispatchEvent(new window.Event('change'));
  await sleep(300);
  check(doc.getElementById('woven-panel').classList.contains('hidden'),
        'switching back to a knit fabric hides the woven fields again');

  const errs = realErrors(errors);
  check(errs.length === 0, 'no script errors on the woven path', errs.slice(0, 3).join(' | '));
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

/**
 * Does the policy the server sends actually permit the page the server sends?
 *
 * This is the check that was missing when script-src-attr 'none' shipped
 * alongside pages built out of ~60 onclick attributes. jsdom does not enforce
 * CSP, so the DOM tests above ran the handlers happily while every real browser
 * refused to. Nothing that executes the page in jsdom can ever catch this class
 * of bug; it has to be read off the wire.
 *
 * Written as a comparison rather than an assertion about one directive: for
 * each page, work out how that page is actually constructed, then resolve the
 * directive that governs each construct through CSP's real fallback chain.
 */
function resolveDirective(csp, name) {
  // script-src-attr and script-src-elem fall back to script-src, which falls
  // back to default-src. An explicitly-set directive ends the chain.
  const chain = { 'script-src-attr': ['script-src-attr', 'script-src', 'default-src'],
                  'script-src-elem': ['script-src-elem', 'script-src', 'default-src'],
                  'script-src':      ['script-src', 'default-src'] }[name];
  for (const d of chain) if (csp[d]) return { directive: d, values: csp[d] };
  return null;
}

function parseCsp(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out[name.toLowerCase()] = values;
  }
  return out;
}

async function testCsp() {
  console.log('\nCSP  does the sent policy permit the sent page?');
  const pages = ['', 'result.html', 'converter.html', 'patterns.html', 'weft-calc.html',
                 'academy.html', 'diagnostics.html', 'admin.html', '404.html'];

  for (const page of pages) {
    const res = await fetch(`${BASE}/${page}`);
    const html = await res.text();
    const csp = parseCsp(res.headers.get('content-security-policy'));
    const label = '/' + (page || 'index');

    // What does this page actually do?
    const inlineHandlers = (html.match(/\son[a-z]+\s*=\s*["']/gi) || []).length;
    const inlineScripts = (html.match(/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?<\/script>/gi) || [])
      .filter(s => !/type=["'](importmap|application\/json)["']/i.test(s)).length;
    const importMaps = /<script[^>]*type=["']importmap["']/i.test(html) ? 1 : 0;

    const needs = [];
    if (inlineHandlers) needs.push(['script-src-attr', `${inlineHandlers} inline handler(s)`]);
    if (inlineScripts) needs.push(['script-src-elem', `${inlineScripts} inline <script> block(s)`]);
    if (importMaps) needs.push(['script-src-elem', 'an import map']);

    if (!needs.length) {
      // Only the admin surface is *required* to be strict. It is the page the
      // CSP was added for, it loads every line of its code from an external
      // file, and a policy with no 'unsafe-inline' is worth something there.
      // Other pages that happen to carry no inline code are served the public
      // policy by design, so holding them to admin's standard would be
      // asserting a decision nobody made.
      if (page !== 'admin.html') { check(true, `${label} carries no inline code`); continue; }
      const r = resolveDirective(csp, 'script-src');
      const lax = !r || r.values.includes("'unsafe-inline'");
      check(!lax, `${label} is held to a strict policy`,
            lax ? "but script-src still allows 'unsafe-inline'" : r.values.join(' '));
      continue;
    }

    for (const [directive, why] of needs) {
      const r = resolveDirective(csp, directive);
      const allowed = !r || r.values.includes("'unsafe-inline'") ||
                      r.values.some(v => /^'(nonce|sha\d+)-/.test(v));
      check(allowed, `${label} runs ${why}, and ${directive} permits it`,
            r ? `${r.directive} ${r.values.join(' ')}` : 'directive absent (allowed)');
    }
  }
}

(async () => {
  console.log('E2E smoke — ' + BASE);
  await testAssets();
  await testCsp();
  await testFormPage();
  await testResultPage();
  await testWovenPath();

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
