// What is kept of a request for judging accuracy: which routes, what is removed, the headline of each answer,
// the verdicts, and that recording never touches the answer or fails it.
'use strict';
const assert = require('assert');
const C = require('../engine/domain/usage-capture');

console.log('--- Running Usage Capture Tests ---');
{
  for (const [m, p, tool] of [['POST', '/calculate', 'calculate'], ['POST', '/studio/analyse', 'studio/analyse'], ['POST', '/studio/dev-sheet', 'studio/dev-sheet'], ['POST', '/cost-sheet/analyse', 'cost-sheet/analyse'], ['POST', '/garment/build', 'garment/build'], ['POST', '/studio/floor/rolls', 'studio/floor/rolls']]) {
    assert.strictEqual(C.toolFor(m, p), tool, p);
  }
  for (const [m, p] of [['GET', '/calculate'], ['POST', '/auth/signin'], ['POST', '/account/password'], ['PUT', '/studio/designs'], ['POST', '/studio/designs'], ['POST', '/garment/spec/read'], ['POST', '/scan/debug'], ['POST', '/rfq'], ['POST', '/feedback'], ['POST', '/cost-sheet/sheets'], ['POST', '/studio/jacquard/from-image'], ['POST', '/calculateX']]) {
    assert.strictEqual(C.toolFor(m, p), null, m + ' ' + p);
  }
  assert(C.isLive('studio/analyse') && C.isLive('garment/build') && !C.isLive('calculate'));
  console.log('✓ engine requests are recorded; accounts, saved work and pictures never are');
}
{
  const i = C.cleanInput('calculate', { fabric: 'single_jersey', gsm: 180, password: 'x', api_key: 'k', contact_email: 'a@b.c', phone: '017', picture: 'data:image/png;base64,AAAA', long: 'y'.repeat(900), list: Array.from({ length: 500 }, (_, k) => k), nest: { a: { b: { c: { d: { e: { f: { g: { h: { i: { j: 1 } } } } } } } } } } });
  assert(i.fabric === 'single_jersey' && i.gsm === 180);
  assert(i.password === '(not kept)' && i.api_key === '(not kept)' && i.contact_email === '(not kept)' && i.phone === '(not kept)');
  assert(/^\(data, \d+ characters\)$/.test(i.picture) && i.long.length < 340 && i.list.length === 61 && JSON.stringify(i).includes('(deeper)'));
  const cost = C.cleanInput('cost-sheet/analyse', { buyer: 'ACME', style_no: 'S-1', fob: 4.2, margin_pct: 12, shell: { fabric: 'rib_1x1', gsm: 220, price_per_kg: 5 } });
  assert(cost.buyer === '(not kept)' && cost.style_no === '(not kept)' && cost.fob === '(not kept)' && cost.margin_pct === '(not kept)' && cost.shell.price_per_kg === '(not kept)' && cost.shell.gsm === 220, JSON.stringify(cost));
  const huge = C.cleanInput('studio/analyse', Object.fromEntries(Array.from({ length: 70 }, (_, k) => ['k' + k, 'z'.repeat(280)])));
  assert(JSON.stringify(huge).length <= C.MAX_BYTES, 'kept small');
  assert.deepStrictEqual(C.cleanInput('calculate', undefined), {});
  assert.strictEqual(({}).polluted, undefined);
  C.cleanInput('calculate', JSON.parse('{"__proto__":{"polluted":1}}'));
  assert.strictEqual(({}).polluted, undefined);
  console.log('✓ secrets, contacts, pictures and a buyer\'s money are left out; large requests are trimmed');
}
{
  const E = require('../engine');
  const o = E.calculate({ fabric: 'fleece_3_thread', gsm: 280, composition: '85% cotton 15% polyester' });
  const s = C.summarise('calculate', o);
  assert(s.fabric === 'fleece_3_thread' && s.gsm === 280 && s.count && s.sl_mm > 0 && s.gauge > 0 && s.yarns.length === 3 && ['engine', 'loop model'].includes(s.by), JSON.stringify(s).slice(0, 400));
  assert(JSON.stringify(s).length < 3000);
  const S = require('../engine/domain/fabric-studio');
  const t = S.listTemplates().find((x) => x.id === 'single_jersey');
  const a = C.summarise('studio/analyse', S.analyse({ template: t.id, bed: 'single', grid: t.grid, target: { gsm: 180, composition: '95% cotton 5% elastane' }, yarn: { fibre: 'cotton' } }));
  assert(a.structure && a.count && a.sl_mm > 0 && a.gsm === 180 && a.yarns.length >= 1 && JSON.stringify(a).length < 3000, JSON.stringify(a).slice(0, 300));
  assert.deepStrictEqual(C.summarise('calculate', { success: false, error: 'GSM out of range', code: 'BAD' }), { error: 'GSM out of range', code: 'BAD' });
  const plain = C.summarise('quality', { success: true, grade: 'A', score: 91, token: 'x', formula_trace: ['a'], deep: { kg: 2, inner: { x: 1 } } });
  assert(plain.grade === 'A' && plain.score === 91 && plain['deep.kg'] === 2 && !('token' in plain) && !('formula_trace' in plain), JSON.stringify(plain));
  assert.deepStrictEqual(C.summarise('calculate', null), {});
  console.log('✓ the headline of each answer: counts, stitch lengths, gauge, weight and who answered');
}
{
  const f = C.validateFeedback({ tool: 'calculate', verdict: 'wrong', input: { fabric: 'single_jersey', gsm: 180, password: 'p' }, shown: { count: '24/1' }, actual: { count: ' 26/1 ', sl: 2.8, nonsense: 'x', gauge: '' }, note: '' });
  assert.deepStrictEqual(f.actual, { count: '26/1', sl: '2.8' });
  assert(f.input.password === '(not kept)');
  assert.strictEqual(C.validateFeedback({ tool: 'studio/analyse', verdict: 'right' }).verdict, 'right');
  for (const bad of [{ tool: 'x', verdict: 'right' }, { tool: 'calculate', verdict: 'great' }, { tool: 'calculate', verdict: 'wrong' }, null]) assert.throws(() => C.validateFeedback(bad), C.FeedbackError, JSON.stringify(bad));
  console.log('✓ verdicts: right, close or wrong; a "wrong" says what is wrong');
}
// the middleware: records after the answer is gone, never changes it, survives a broken database
(async () => {
  const repo = require('../db/repositories/usage-log-repo');
  const seen = [];
  repo.events.record = async (e, live) => { seen.push({ ...e, live }); return 1; };
  repo.events.prune = async () => 0;
  const log = require('../services/usage-log');
  const express = require('express');
  const app = express(); app.use(express.json());
  app.use('/api', log.middleware);
  app.post('/api/calculate', (req, res) => { req.user = { id: 7 }; req.plan = 'mill'; res.json({ success: true, yarn: { count_display: '26/1', count_ne: 26 }, input: { gsm: 160 }, fabric: { id: 'single_jersey' } }); });
  app.post('/api/studio/analyse', (req, res) => { req.user = { id: 7 }; req.plan = 'free'; res.locals.usageSummary = { count: '30s', sl_mm: 2.7 }; res.type('application/json').send('{"success":true}'); });
  app.post('/api/quality', (req, res) => res.status(400).json({ error: 'gsm is required' }));
  app.post('/api/cost', (req, res) => res.status(401).json({ error: 'sign in' }));
  app.post('/api/auth/signin', (req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  const url = `http://127.0.0.1:${server.address().port}/api/`;
  const post = (p, body) => fetch(url + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.text());
  const answer = await post('calculate', { fabric: 'single_jersey', gsm: 160 });
  assert(JSON.parse(answer).yarn.count_display === '26/1');
  await post('studio/analyse', { target: { gsm: 180 } });
  await post('quality', {});
  await post('cost', {});
  await post('auth/signin', { password: 'x' });
  await new Promise((r) => setTimeout(r, 150));
  assert.deepStrictEqual(seen.map((e) => e.tool), ['calculate', 'studio/analyse', 'quality'], 'a refused sign-in and the account routes are not recorded');
  const [a, b, c] = seen;
  assert(a.actor === 'u:7' && a.user_id === 7 && a.ok && a.plan === 'mill' && a.result.count === '26/1' && a.input.gsm === 160 && !a.live && /^[0-9a-f]{40}$/.test(a.input_hash));
  assert(b.live && b.result.count === '30s');
  assert(!c.ok && c.status === 400 && c.error === 'gsm is required' && /^g:[0-9a-f]{24}$/.test(c.actor) && c.user_id === null);
  repo.events.record = async () => { throw new Error('database gone'); };
  const errs = console.error; console.error = () => {};
  assert(JSON.parse(await post('calculate', { fabric: 'single_jersey', gsm: 170 })).success, 'the answer goes out all the same');
  await new Promise((r) => setTimeout(r, 100));
  console.error = errs;
  process.env.USAGE_LOG = 'off';
  seen.length = 0; repo.events.record = async (e) => { seen.push(e); };
  await post('calculate', { fabric: 'single_jersey', gsm: 170 });
  await new Promise((r) => setTimeout(r, 80));
  assert.strictEqual(seen.length, 0, 'switched off');
  server.close();
  console.log('✓ recording happens after the answer, never changes or fails it, and can be switched off');
  console.log('Usage capture tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
