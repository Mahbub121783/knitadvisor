// No outside source — no book, author, page reference or source site — reaches a visitor or an API customer.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
console.log('--- Running No-Sources Tests ---');
const S = require('../middleware/no-sources');
const BANNED = /Morton|Hearle|Munden|Postle|Gokarneshan|Spencer \(|Peirce|Knapton|Adderley|Beste and Hoffman|Understanding Textile|Marchandiser|textile ?learner|Heap\/Starfish|[Pp]age \d+ states|page \d+ of the textbook/;

// 1. citations go; things that only look like them stay
const o = S.scrub({
  source: 'Morton & Hearle, Table 13.1, p.290', sl_source: 'your setting', sett_source: 'BOOK_VERIFIED', page: 3, pages: 9,
  yarns: [{ id: 'F1', source: { feed: 1 } }], tensile: { tenacity: 0.32, page: 290, table: 'Table 13.1' },
  basis: 'Munden constants (dry and wet relaxed plain knit)', name: 'Chowdhury Knit Ltd', colour: 'Starfish',
  explanation: "Page 354 states: 'Vee-bed flat knitting machines employ latch needles.'", note: 'Cover from Peirce’s cotton-yarn diameter.',
  multiplier_source: 'Understanding Textile for Marchandiser p.512', link: 'https://textilelearner.net/x', own: 'https://www.onlinetextileschool.com',
  sources: ['Gokarneshan (2005)', 'Spencer (2001) p.289'], preface: 'Mellor, Greater Manchester\nJohn W. S. Hearle', when: new Date(0),
});
assert(!('source' in o) && !('multiplier_source' in o) && !('sources' in o), 'citation keys are dropped');
assert.strictEqual(o.sl_source, 'your setting'); assert.strictEqual(o.sett_source, 'BOOK_VERIFIED');
assert.strictEqual(o.page, 3); assert.strictEqual(o.pages, 9, 'pagination is not a citation');
assert.deepStrictEqual(o.yarns[0].source, { feed: 1 }, 'a structural source object stays');
assert.deepStrictEqual(o.tensile, { tenacity: 0.32 }, 'a book table and its page go');
assert.strictEqual(o.name, 'Chowdhury Knit Ltd'); assert.strictEqual(o.colour, 'Starfish');
assert.strictEqual(o.own, 'https://www.onlinetextileschool.com');
assert(!BANNED.test(JSON.stringify(o)), JSON.stringify(o));
assert(o.when instanceof Date);

// 2. the middleware wraps res.json
let sent = null;
const res = { json: (b) => { sent = b; return res; } };
S.middleware({}, res, () => {});
res.json({ source: 'Spencer (2001) eq. 14.2', ok: true });
assert.deepStrictEqual(sent, { ok: true });

// 3. no engine or route says it in its own words any more (the middleware is the net, not the fix)
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
const B = path.join(__dirname, '..');
const offenders = [];
for (const f of [...walk(path.join(B, 'engine')), ...walk(path.join(B, 'routes'))]) {
  fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return;            // comments may say where things came from
    const code = t.replace(/\/\/.*$/, '');
    if (/['"`]/.test(code) && BANNED.test(code)) offenders.push(`${path.relative(B, f)}:${i + 1}`);
  });
}
assert.deepStrictEqual(offenders, [], `outside sources in engine strings: ${offenders.join(', ')}`);

// 4. nor does any page: the HTML and the page scripts (comments aside)
const F = path.join(B, '..', 'frontend');
const pages = [...fs.readdirSync(F).filter((n) => n.endsWith('.html')).map((n) => path.join(F, n)), ...fs.readdirSync(path.join(F, 'assets/js')).filter((n) => n.endsWith('.js')).map((n) => path.join(F, 'assets/js', n))];
const pageOffenders = [];
for (const f of pages) fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => { const t = line.trim(); if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return; if (BANNED.test(t.replace(/\/\/ .*$/, ''))) pageOffenders.push(`${path.relative(F, f)}:${i + 1}`); });
assert.deepStrictEqual(pageOffenders, [], `outside sources on the pages: ${pageOffenders.join(', ')}`);
// a book's page, or "the book" as the authority, is a citation too (the woven construction label said "the book's own quality, p.130")
const BOOKISH = /the book[’']s own|quality the book|from the book|the book draws|p\.' *\+ *c\.sett_page|book_page:/;
const bookOffenders = [];
for (const f of pages) fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => { const t = line.trim(); if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return; if (BOOKISH.test(t)) bookOffenders.push(`${path.relative(F, f)}:${i + 1}`); });
assert.deepStrictEqual(bookOffenders, [], `book references on the pages: ${bookOffenders.join(', ')}`);
{
  const WE = require('../engine/domain/woven-engine');
  const wl = WE.listWovenFabrics();
  assert(!/"(book_)?page":|[Tt]he book|p\.\d+/.test(JSON.stringify(wl)), 'the woven list carries no book page');
  for (const f of wl) {
    const r = WE.calculateWoven({ fabric_id: f.id });
    assert(r.success, f.id);
    // (a fibre advisory's own `sources` list is provenance the net drops; everything else must be clean as it leaves)
    assert(!/sett_page|"(book_)?page":|"figure":|p\.\d+|[Tt]he book/.test(JSON.stringify(S.scrub(JSON.parse(JSON.stringify(r))))), `${f.id}: the woven answer carries no book page`);
  }
}

// 5. the fibre engine's answers are clean before any net
const Y = require('../engine/domain/yarn-engine');
const blend = { cotton: 60, polyester: 40 };
for (const fn of ['blendMechanics', 'blendFriction', 'blendRecovery', 'blendDirectional', 'heatCeiling', 'blendThermal']) assert(!BANNED.test(JSON.stringify(Y[fn](blend))), fn);
// 6. the academy: no page reference, no pointing at a book, in what it sends
{
  const A = require('../engine/domain/academy-engine');
  const route = fs.readFileSync(path.join(B, 'routes/api.js'), 'utf8');
  assert(!/page: q(?:uestion)?\.page/.test(route), 'the quiz routes send no page');
  assert(/noPages\(GLOSSARY\)/.test(route), 'the academy content is sent without its pages');
  for (const q of A.QUIZ_QUESTIONS) assert(!/textbook|[Pp]age \d/.test(q.question + ' ' + q.explanation + ' ' + q.options.join(' ')), q.id);
  assert.strictEqual(S.scrub({ page: '326', term: 'x' }).page, undefined, 'a book page given as text');
  assert.strictEqual(S.scrub({ page: 3, items: [] }).page, 3, 'a pagination page stays');
  const ac = fs.readFileSync(path.join(B, '..', 'frontend', 'academy.html'), 'utf8');
  assert(!/Textbook Reference Page|term-page-badge">p\./.test(ac), 'the academy page shows no book page');
}
// 7. what a visitor reads on a calculation's result — the fibre and wet advice included — after the net: no book,
//    no table or page number, no researcher's name (the advice said "Table 13.7 lists no elastomer" and
//    "measured … by Berry and by Bohringer and Schieber")
(async () => {
  const E = require('../engine');
  const SEEN = /[Tt]he book\b|Tables? \d+\.\d+|\bp\.\s?\d+|\bet al\b|Berry|Bohringer|Schieber|\.pdf/;
  for (const [fabric, composition] of [['single_jersey', '100% Cotton'], ['rib_1x1', '95% Cotton 5% Elastane'], ['interlock', '65% Polyester 35% Cotton'],
    ['single_jersey', '100% Viscose'], ['single_jersey', '100% Wool'], ['single_jersey', '100% Nylon'], ['single_jersey', '100% Acrylic']]) {
    const r = await E.calculate({ fabric, gsm: 180, composition });
    const t = JSON.stringify(S.scrub(JSON.parse(JSON.stringify(r))));
    const m = t.match(new RegExp('.{0,60}(' + SEEN.source + ').{0,40}'));
    assert(!m, `${fabric} ${composition}: ${m && m[0]}`);
  }
  console.log('No-sources tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
