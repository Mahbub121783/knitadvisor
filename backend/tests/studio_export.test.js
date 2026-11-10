// Machine files: the bitmap is a real PNG / BMP of the programme, the CSV carries the cam chart,
// the sheet is a PDF — all from the same answer the page shows.
const assert = require('assert');
const zlib = require('zlib');
console.log('--- Running Studio Machine-Export Tests ---');

const F = require('../engine/domain/fabric-studio');
const X = require('../engine/domain/machine-export');

const tpl = (id) => F.listTemplates().find((t) => t.id === id);
const run = (id, machine) => {
  const t = tpl(id);
  const o = F.analyse({ bed: t.bed, grid: t.grid, feeds: t.roles.map((r) => ({ role: r })), yarn: { count: 30, unit: 'ne', fibre: 'cotton' }, machine, target: {} });
  assert(o.success, `${id}: ${o.error}`);
  return o;
};
const pique = run('pique_single', { gauge: 24, dia: 30, sl_mm: 2.7 });
const inter = run('interlock', { gauge: 18, dia: 30, sl_mm: 2.7 });

// 1. the programme: one cell per needle per feed, in the colour of what the needle does
const P = X.programme(pique, 'C', 'repeat');
assert.deepStrictEqual([P.W, P.H], [2, 4]);
assert.deepStrictEqual(Array.from(P.px[0]), [X.SYMS.indexOf('K'), X.SYMS.indexOf('T')]);
assert.deepStrictEqual(Array.from(P.px[2]), [X.SYMS.indexOf('T'), X.SYMS.indexOf('K')]);
const R = X.programme(pique, 'C', 'revolution');
assert.strictEqual(R.W, pique.machine.needles); assert.strictEqual(R.H, pique.machine.feeders);
assert.deepStrictEqual(Array.from(R.px[5].slice(0, 4)), Array.from(P.px[1]).concat(Array.from(P.px[1])), 'a revolution is the repeat tiled — feed 6 is repeat row 2');
assert.throws(() => X.programme(pique, 'D'), X.ExportError, 'a single-bed design has no dial');
assert.strictEqual(X.programme(inter, 'D').H, 2);

// 2. PNG: signature, chunks with valid CRC, pixels come back as drawn
const png = X.png(P, 3);
assert.deepStrictEqual(Array.from(png.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
let off = 8, idat = [], w, h, seen = [];
while (off < png.length) {
  const len = png.readUInt32BE(off), type = png.toString('latin1', off + 4, off + 8), data = png.slice(off + 8, off + 8 + len);
  const crc = png.readUInt32BE(off + 8 + len);
  const want = zlib.crc32 ? zlib.crc32(png.slice(off + 4, off + 8 + len)) : crc;
  assert.strictEqual(crc, want >>> 0, `${type} CRC`);
  seen.push(type); if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); assert.strictEqual(data[8], 8); assert.strictEqual(data[9], 3); }
  if (type === 'IDAT') idat.push(data);
  off += 12 + len;
}
assert.deepStrictEqual(seen, ['IHDR', 'PLTE', 'IDAT', 'IEND']);
assert.deepStrictEqual([w, h], [6, 12]);
const raw = zlib.inflateSync(Buffer.concat(idat));
assert.strictEqual(raw.length, (w + 1) * h);
assert.strictEqual(raw[1], X.SYMS.indexOf('K')); assert.strictEqual(raw[1 + 3], X.SYMS.indexOf('T'));
assert.strictEqual(raw[(w + 1) * 6 + 1], X.SYMS.indexOf('T'), 'row 3 starts with a tuck, scaled 3×');

// 3. BMP: 8-bit, bottom-up, rows padded to four bytes
const bmp = X.bmp(P, 1);
assert.strictEqual(bmp.toString('latin1', 0, 2), 'BM'); assert.strictEqual(bmp.readInt32LE(18), 2); assert.strictEqual(bmp.readInt32LE(22), 4); assert.strictEqual(bmp.readUInt16LE(28), 8);
assert.strictEqual(bmp.length, 54 + 1024 + 4 * 4);
assert.strictEqual(bmp[54 + 1024 + 3 * 4], X.SYMS.indexOf('K'), 'the first feed is the last row in a BMP');

// 4. CSV: set-out, cam chart and programme, quoted properly
const csv = X.csv(inter, 'Interlock, 18G');
assert(csv.includes('"Interlock, 18G"'));
assert(/Cylinder,A B/.test(csv) && /Dial,A B/.test(csv));
assert(/Feed,Yarn,Role,Cylinder track A,Cylinder track B,Dial track A,Dial track B/.test(csv));
assert(/^1,.*,ground,K,M,M,K/m.test(csv) && /^2,.*,ground,M,K,K,M/m.test(csv));
assert(/Feed 1,K,M/.test(csv));

// 5. the sheet is a PDF, and carries no money and no outside source
const chunks = [];
const doc = X.sheet(inter, { name: 'Interlock test', floor: 'M-07' });
doc.on('data', (c) => chunks.push(c));
doc.on('end', () => {
  const pdf = Buffer.concat(chunks);
  assert.strictEqual(pdf.toString('latin1', 0, 5), '%PDF-');
  assert(pdf.length > 3000);
  const T = JSON.stringify(inter);
  assert(!/munden|postle|textile ?learner|http/i.test(X.csv(inter, '')), 'no outside source in the machine files');
  assert(!/price|cost|usd|bdt|\$/i.test(X.csv(inter, '').replace(/cost-/g, '')), 'nothing about money');
  console.log('Studio machine-export tests passed');
});
doc.end();
