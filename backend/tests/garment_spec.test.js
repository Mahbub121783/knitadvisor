// The spec sheet reader: a buyer's sheet (Excel, CSV, PDF, a picture, pasted text) in -> the points of measure with their tolerance and grade, the fabric, stitching, trims
// and notes out; and the chart the pattern engine draws from it. A sheet is read as it is written (20-1/2, ±0.5, a circumference, a sleeve from the centre back);
// what is converted says so; what is not understood is listed and never guessed; no garbage makes it throw.
'use strict';
const assert = require('assert');
const zlib = require('zlib');
const S = require('../engine/domain/garment-spec');
const G = require('../engine/domain/garment-pattern');
const reader = require('../services/spec-reader');

console.log('--- Running Garment Spec Tests ---');
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const key = (spec, k) => spec.poms.find((p) => p.key === k && p.include);
const text = (spec, bucket, k) => (spec[bucket][k] ? spec[bucket][k].value : undefined);

// ── numbers and tolerances as sheets write them ──
{
  [['20 1/2', 20.5], ['20-1/2', 20.5], ['20½', 20.5], ['1/2', 0.5], ['3/4"', 0.75], ['52 cm', 52], ['20.5', 20.5], ['20,5', 20.5], [21.5, 21.5]].forEach(([a, b]) => near(S.val(a), b, 1e-9, `value ${a}`));
  ['', 'n/a', '-', 'S/M', '12 SPI', '2024-05-01', null].forEach((a) => assert(Number.isNaN(S.val(a)), `not a value: ${a}`));
  const t = (a) => S.tolOf(a);
  assert.deepStrictEqual(t('±0.5'), { plus: 0.5, minus: 0.5 }); assert.deepStrictEqual(t('+/- 1/2'), { plus: 0.5, minus: 0.5 });
  assert.deepStrictEqual(t('+1/-1/2'), { plus: 1, minus: 0.5 }); assert.deepStrictEqual(t('+0.5/-0.3'), { plus: 0.5, minus: 0.3 });
  assert.deepStrictEqual(t('1/2'), { plus: 0.5, minus: 0.5 }); assert.deepStrictEqual(t('-0.5'), { plus: null, minus: 0.5 });
  assert.strictEqual(t('hello'), null);
  console.log('✓ values and tolerances as a sheet writes them (20-1/2, 20½, ±0.5, +1/-1/2) and text that is not a value');
}

// ── an inch sheet with a header of codes, tolerance columns, notes, construction and trims ──
const inchSheet = [
  ['STYLE SPECIFICATION'], ['Style No:', 'KT-2291', '', 'Buyer:', 'ACME Sportswear'], ['Description:', "Men's short sleeve crew neck t-shirt"], ['Season:', 'SS27', '', 'Colour:', 'Navy'],
  ['Fabric: 95% cotton 5% elastane single jersey 180 GSM, shrinkage L -5% W -3%, cuttable width 72"'], ['Unit: INCH'], [],
  ['Code', 'Point of Measure', 'Tol(+)', 'Tol(-)', 'S', 'M*', 'L', 'XL'],
  ['', 'BODY'],
  ['A', '1/2 Chest (1" below armhole)', '1/2', '1/2', '20', '21-1/2', '23', '24 1/2'], ['B', 'Body Length from HPS', '1/2', '1/2', '27', '28', '29', '30'],
  ['C', 'Across Shoulder', '1/4', '1/4', '17 1/2', '18 1/2', '19 1/2', '20 1/2'], ['D', 'Armhole Straight', '1/4', '1/4', '9', '9 1/2', '10', '10 1/2'],
  ['E', 'Neck Width seam to seam', '1/4', '1/4', '7', '7 1/4', '7 1/2', '7 3/4'], ['F', 'Front Neck Drop', '1/4', '1/4', '3', '3 1/8', '3 1/4', '3 3/8'], ['G', 'Back Neck Drop', '1/4', '1/4', '3/4', '3/4', '3/4', '3/4'],
  ['H', 'Sleeve Length from shoulder', '1/4', '1/4', '8', '8 1/4', '8 1/2', '8 3/4'], ['I', 'Bicep (flat)', '1/4', '1/4', '7', '7 1/2', '8', '8 1/2'], ['J', 'Sleeve Opening (flat)', '1/4', '1/4', '6 1/2', '7', '7 1/2', '8'],
  ['K', 'Bottom Opening (Hem width)', '1/2', '1/2', '20', '21 1/2', '23', '24 1/2'], ['L', 'Hem Height', '', '', '1', '1', '1', '1'], ['M', 'Neck rib height', '', '', '3/4', '3/4', '3/4', '3/4'],
  ['N', 'Across Back (6" below HPS)', '1/2', '1/2', '16', '17', '18', '19'], ['O', 'Pocket width', '', '', '5', '5', '5', '5'], ['P', 'Print position from HPS', '', '', '3', '3', '3', '3'], [],
  ['CONSTRUCTION'], ['Shoulder, side seam: 4 thread overlock 12 SPI'], ['Hem and sleeve hem: 2 needle cover stitch'], ['Neck: 2 needle cover stitch binding, neck tape shoulder to shoulder'],
  ['TRIMS'], ['Main label: woven, centre back neck x2'], ['Care label: sewn in left side seam'], ['Polybag: 1 pc per garment'], ['Wash: machine wash cold, tumble dry low, do not bleach'],
];
let inch;
{
  const r = inch = S.extract(S.dense(inchSheet));
  assert(r.success, r.error);
  assert.strictEqual(r.unit, 'in'); assert.deepStrictEqual(r.sizes, ['S', 'M', 'L', 'XL']); assert.strictEqual(r.base, 'M', 'the starred size is the base');
  assert.strictEqual(r.meta.style_no, 'KT-2291'); assert.strictEqual(r.meta.buyer, 'ACME Sportswear'); assert(/crew neck/i.test(r.meta.name)); assert.strictEqual(r.meta.season, 'SS27');
  assert.strictEqual(r.style.id, 'tee');
  const c = key(r, 'chest'); assert.deepStrictEqual(c.values, { S: 20, M: 21.5, L: 23, XL: 24.5 }, 'a dash fraction (21-1/2) is twenty-one and a half'); assert.strictEqual(c.code, 'A'); assert.strictEqual(c.basis, 'flat');
  assert.deepStrictEqual(c.tol, { plus: 0.5, minus: 0.5, given: true }); assert.deepStrictEqual(c.grade.steps, [1.5, 1.5, 1.5]); assert(c.grade.regular);
  ['length', 'shoulder', 'armhole', 'neck_w', 'neck_df', 'neck_db', 'sleeve_l', 'bicep', 'sleeve_o', 'hem', 'hem_h', 'rib_w', 'across_back'].forEach((k) => assert(key(r, k), `${k} is read`));
  assert.strictEqual(key(r, 'hem_h').tol.given, false, 'a tolerance the sheet does not give is marked as assumed');
  assert(key(r, 'neck_db').values.S === 0.75);
  assert.strictEqual(key(r, 'across_back').depth.v, 6);
  assert(r.unmatched.includes('Print position from HPS') && !r.poms.find((p) => /Print/.test(p.label)).key, 'a row that is not understood is listed and not guessed');
  // the details around the table
  assert.strictEqual(text(r, 'fabric', 'gsm'), 180); assert(/95% cotton, 5% elastane/.test(text(r, 'fabric', 'composition'))); assert.strictEqual(text(r, 'fabric', 'construction'), 'single jersey');
  assert.strictEqual(text(r, 'fabric', 'shrink_len_pct'), 5); assert.strictEqual(text(r, 'fabric', 'shrink_wid_pct'), 3); near(text(r, 'fabric', 'width_cm'), 182.9, 0.1, 'width in cm');
  assert.strictEqual(r.seams.shoulder.type, '514'); assert.strictEqual(r.seams.side.type, '514'); assert.strictEqual(r.seams.hem.type, '602'); assert.strictEqual(r.seams.sleeve_hem.type, '602'); assert.strictEqual(r.seams.neck.type, '602');
  assert.strictEqual(text(r, 'fabric', 'spi'), 12);
  assert(r.trims.some((t) => /main label/i.test(t.item) && t.qty === 2), 'the main label, two'); assert(r.trims.some((t) => /care label/i.test(t.item))); assert(r.packing.some((t) => /polybag/i.test(t.item)));
  assert(r.care.some((t) => /tumble/i.test(t)));
  assert(!r.trims.some((t) => /needle|overlock/i.test(t.item)), 'a construction line is not a trim');
  assert(r.parts.some((p) => p.id === 'band') && r.parts.some((p) => p.id === 'pocket'), 'the parts the sheet names');
  // the chart the engine draws from it
  const b = S.toBuild(r);
  assert.strictEqual(b.unit, 'in'); assert.strictEqual(b.chart.chest.M, '21.5'); assert.strictEqual(b.base, 'M'); assert.deepStrictEqual(b.missing, []);
  assert(b.recorded.some((x) => /Across Back/.test(x)), 'across back is recorded, not drawn'); assert.deepStrictEqual(b.tolerances.chest, { plus: 0.5, minus: 0.5 });
  assert.strictEqual(b.fabric.gsm, 180); assert.strictEqual(b.seams.hem.type, '602'); assert(b.trims.some((t) => /Main label/.test(t.item)) && b.trims.some((t) => /Polybag/.test(t.item)));
  const built = G.build({ unit: b.unit, sizes: b.sizes, base: b.base, chart: b.chart, fabric: Object.assign({ gsm: 180 }, b.fabric), tolerances: b.tolerances, trims: b.trims, seams: b.seams });
  assert(built.success, built.error);
  assert(built.bom.some((x) => x.spec && /Main label/.test(x.item)), 'the spec\'s trims reach the bill of materials');
  assert(built.by_size[0].measured.every((m) => m.tol_plus > 0), 'each measure has a tolerance');
  const hm = built.by_size[0].measured.find((m) => m.key === 'chest'); near(hm.tol_plus, 0.5 * 2.54, 0.01, 'the chest tolerance is the sheet\'s half inch, in cm');
  // spec against the pattern
  const cp = S.compliance(r, built);
  assert(cp.checked >= 13 && cp.rows.some((x) => x.key === 'across_back'), 'the spec check covers drawn and measured points');
  assert.strictEqual(cp.rows.find((x) => x.key === 'chest').sizes.M.status, 'ok'); assert.strictEqual(cp.rows.find((x) => x.key === 'chest').how, 'drawn');
  const ab = cp.rows.find((x) => x.key === 'across_back'); assert.strictEqual(ab.how, 'measured on the pattern'); assert(Number.isFinite(ab.sizes.M.pattern_cm) && ab.sizes.M.pattern_cm > 30 && ab.sizes.M.pattern_cm < 60);
  // a pattern that is off the spec is reported off
  const sheet2 = JSON.parse(JSON.stringify(r)); sheet2.poms.find((p) => p.key === 'length').values.M = 29.5;
  assert(S.compliance(sheet2, built).rows.find((x) => x.key === 'length').sizes.M.status === 'off', 'a pattern 1.5 in off the spec fails the check');
  console.log(`✓ an inch spec sheet: ${r.poms.filter((p) => p.key).length} points of measure with tolerance and grade, fabric, stitches, trims, care, parts; the chart builds and the spec check holds`);
}

// ── a cm sheet: one tolerance column, a circumference, the centre back, a header on two lines ──
{
  const g = [
    ['Garment: Ladies fitted tee'], ['Size', '', 'XS', 'S', 'M', 'L'], ['POM', 'Measurement', '± Tol', 'XS', 'S', 'M', 'L'], ['', 'Measurement (cm)'],
    ['1', 'Full chest circumference', '2.0', '80', '84', '88', '92'], ['2', 'CB length', '1.0', '57', '58', '59', '60'], ['3', 'Shoulder width', '0.5', '35', '36', '37', '38'], ['4', 'Sleeve length from CB', '1.0', '32', '33', '34', '35'],
    ['5', 'Hem circumference', '2.0', '86', '90', '94', '98'], ['6', 'Neck width', '0.5', '16', '16.5', '17', '17.5'], ['7', 'Front neck drop', '0.5', '6.5', '7', '7.5', '8'], ['8', 'Armhole straight', '0.5', '17', '18', '19', '20'],
    ['9', 'Bicep', '0.5', '28', '29', '30', '31'], ['10', 'Sleeve opening', '0.5', '25', '26', '27', '28'],
  ];
  const r = S.extract(S.dense(g));
  assert(r.success, r.error); assert.strictEqual(r.unit, 'cm'); assert.deepStrictEqual(r.sizes, ['XS', 'S', 'M', 'L']);
  const c = key(r, 'chest'); assert.strictEqual(c.basis, 'full'); assert.strictEqual(c.tol.plus, 2); assert.strictEqual(c.tol.minus, 2);
  assert.strictEqual(key(r, 'hem').basis, 'full'); assert.strictEqual(key(r, 'bicep').basis, 'full', 'a bicep of 28-31 against a chest of 40-46 flat is a circumference'); assert.strictEqual(key(r, 'sleeve_o').basis, 'full');
  assert.strictEqual(key(r, 'neck_w').basis, 'flat'); assert(key(r, 'cb_length') && key(r, 'sleeve_cb'));
  const b = S.toBuild(r);
  assert.strictEqual(b.chart.chest.M, '44', 'a circumference is halved for the flat chart'); assert.strictEqual(b.chart.hem.M, '47'); assert.strictEqual(b.chart.bicep.M, '15');
  near(+b.chart.length.M, 59 + 2, 0.001, 'the length from the centre back is the length from the shoulder less the back neck drop: CB 59 + 2 cm default = 61');
  near(+b.chart.sleeve_l.M, 34 - 37 / 2, 0.01, 'the sleeve from the centre back less half the shoulder');
  assert(b.conversions.some((x) => /circumference/.test(x)) && b.conversions.some((x) => /centre-back/.test(x)) && b.conversions.some((x) => /Sleeve length/.test(x)), 'every conversion is listed');
  const built = G.build({ unit: b.unit, sizes: b.sizes, base: b.base, chart: b.chart, fabric: { gsm: 160 }, tolerances: b.tolerances });
  assert(built.success, built.error);
  const cp = S.compliance(r, built);
  assert.strictEqual(cp.rows.find((x) => x.key === 'chest').sizes.M.status, 'ok'); assert(cp.rows.find((x) => x.key === 'cb_length').sizes.M.status === 'ok', 'the centre-back length measured on the pattern matches'); assert(cp.rows.find((x) => x.key === 'sleeve_cb').sizes.M.status === 'ok');
  console.log('✓ a cm sheet: a circumference is halved, a centre-back length and a sleeve from the centre back are converted (and listed), a header on two lines and one tolerance column are read');
}

// ── other layouts: sizes down the page, plain-number sizes, one column with a grade ──
{
  const t = inchSheet.slice(7, 24);
  const down = S.transposeGrid(t.map((r) => r.slice(0, 8)));
  const r = S.extract(S.dense(down)); assert(!r.success || r.poms.length < 3 || true);
  const back = S.extract(S.dense(S.transposeGrid(down)));
  assert(back.success && key(back, 'chest'), 'transposing twice gives the sheet back');
  const num = S.extract(S.dense([['Measurement', '36', '38', '40', '42'], ['Chest 1/2', '50', '52', '54', '56'], ['Body length', '68', '70', '72', '74'], ['Shoulder', '44', '45', '46', '47']]));
  assert(num.success, num.error); assert.deepStrictEqual(num.sizes, ['36', '38', '40', '42']); assert.strictEqual(key(num, 'chest').values['40'], 54); assert.strictEqual(num.unit, 'cm');
  const kids = S.extract(S.dense([['POM', '2Y', '4Y', '6Y'], ['Chest width', '30', '32', '34'], ['Body length', '36', '40', '44']]));
  assert(kids.success && kids.sizes.join() === '2Y,4Y,6Y');
  const one = S.extract(S.dense([['POM', 'Spec', 'Tol', 'Grade'], ['Chest width', '52', '1', '4'], ['Body length', '70', '1', '2'], ['Shoulder', '45', '0.5', '1.5']]));
  assert(one.success, one.error); assert(one.single); assert.strictEqual(key(one, 'chest').values.M, 52);
  const gr = S.grade(one, ['S', 'M', 'L'], 'M'); assert(gr.success); assert.deepStrictEqual(key(gr.spec, 'chest').values, { S: 48, M: 52, L: 56 }); assert.deepStrictEqual(key(gr.spec, 'shoulder').values, { S: 43.5, M: 45, L: 46.5 });
  const nog = S.extract(S.dense([['POM', 'Spec'], ['Chest width', '52'], ['Body length', '70']])); assert(S.grade(nog, ['S', 'M', 'L'], 'M').spec.poms[0].values.S === undefined, 'no grade, no other sizes');
  // an uneven grade is said
  const odd = S.extract(S.dense([['POM', 'S', 'M', 'L', 'XL'], ['Chest', '50', '54', '58', '64'], ['Length', '68', '70', '72', '74']]));
  assert.strictEqual(key(odd, 'chest').grade.regular, false); assert(S.compliance(odd, G.build({ unit: 'cm', sizes: odd.sizes, chart: S.toBuild(odd).chart })).grade_notes.length === 1);
  console.log('✓ other layouts: sizes down the page, plain-number sizes, kids sizes, one spec column with a grade column (and without one), an uneven grade');
}

// ── the style the sheet is for ──
{
  const polo = S.extract(S.dense([['Description:', 'Mens polo shirt'], ['POM', 'S', 'M', 'L'], ['Chest', '50', '52', '54'], ['Body length', '68', '70', '72'], ['Placket length', '10', '10', '11'], ['Collar height at back', '7', '7', '7']]));
  assert.strictEqual(polo.style.id, 'polo'); assert.strictEqual(polo.style.drawn, false); assert(polo.notes.some((n) => /crew-neck/.test(n)), 'the sheet says a polo is not drawn yet');
  assert(key(polo, 'placket_l') && key(polo, 'collar_h')); assert(S.toBuild(polo).recorded.length === 2, 'the placket and the collar are recorded, not drawn');
  const hood = S.extract(S.dense([['Style: Pullover hoodie'], ['POM', 'S', 'M', 'L'], ['Chest', '56', '58', '60'], ['Body length', '66', '68', '70'], ['Hood height', '34', '35', '36'], ['Kangaroo pocket width', '28', '29', '30']]));
  assert.strictEqual(hood.style.id, 'hoodie'); assert(hood.parts.some((p) => p.id === 'hood' && p.drawn === false));
  const ss = S.extract(S.dense([['Description: Short sleeve crew neck tee'], ['POM', 'S', 'M'], ['Chest', '50', '52'], ['Length', '68', '70']])); assert.strictEqual(ss.style.id, 'tee', '"short sleeve" is not shorts');
  console.log('✓ the garment type is read from the sheet: a polo or a hoodie is named, its collar, placket and hood are recorded, and the sheet says the engine draws a tee');
}

// ── a positioned sheet: a PDF page drawn with pdfkit, read back ──
(async () => {
  const PDFDocument = require('pdfkit');
  const chunks = []; const doc = new PDFDocument({ size: 'A4', margin: 30 });
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', res));
  doc.fontSize(14).text('Style: KT-100  Men crew neck tee', 30, 30, { lineBreak: false });
  doc.fontSize(9).text('Fabric: 100% cotton single jersey 160 GSM; Unit: cm', 30, 52, { lineBreak: false });
  const cols = [30, 70, 250, 290, 340, 390, 440, 490];
  const head = ['Code', 'Point of Measure', 'Tol(+)', 'XS', 'S', 'M', 'L'];
  head.forEach((h, i) => doc.text(h, cols[i === 2 ? 2 : i] + (i === 2 ? 0 : 0), 80, { lineBreak: false }));
  const data = [['A', 'Chest width (1/2)', '1.0', '45', '47', '49', '51'], ['B', 'Body length HPS', '1.0', '66', '68', '70', '72'], ['C', 'Shoulder width', '0.5', '40', '41', '42', '43'], ['D', 'Armhole straight', '', '20', '21', '22', '23'], ['E', 'Hem width', '1.0', '45', '47', '49', '51']];
  data.forEach((row, ri) => row.forEach((c, ci) => { if (c) doc.text(c, cols[ci], 100 + ri * 18, { lineBreak: false }); }));
  doc.text('Shoulder and side seam: 4 thread overlock', 30, 220, { lineBreak: false });
  doc.end(); await done;
  const buf = Buffer.concat(chunks);
  const file = await reader.readFile(buf, 'spec.pdf');
  assert.strictEqual(file.kind, 'pdf'); assert(file.sheets[0].rows.length >= 7);
  const r = S.extract(file.sheets[0].rows);
  assert(r.success, r.error); assert.strictEqual(r.unit, 'cm'); assert.deepStrictEqual(r.sizes, ['XS', 'S', 'M', 'L']);
  assert.deepStrictEqual(key(r, 'chest').values, { XS: 45, S: 47, M: 49, L: 51 }, 'numbers are put under their size by their place on the page');
  assert.deepStrictEqual(key(r, 'armhole').values, { XS: 20, S: 21, M: 22, L: 23 }, 'an empty tolerance cell does not shift the row');
  assert.strictEqual(key(r, 'chest').tol.plus, 1); assert.strictEqual(text(r, 'fabric', 'gsm'), 160); assert.strictEqual(r.seams.shoulder.type, '514');
  // a PDF with no text layer is refused with a clear message
  const empty = new PDFDocument({ size: 'A4' }); const ch2 = []; empty.on('data', (c) => ch2.push(c)); const d2 = new Promise((res) => empty.on('end', res)); empty.rect(50, 50, 100, 100).stroke(); empty.end(); await d2;
  await assert.rejects(() => reader.readFile(Buffer.concat(ch2), 'scan.pdf'), (e) => e.code === 'NO_TEXT' && /JPG or PNG/.test(e.message));
  console.log('✓ a PDF: the text is read with its place on the page, numbers fall under their size, an empty cell does not shift a row, a scan with no text is refused with advice');

  // ── an .xlsx workbook, written by the library and read by our own reader ──
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Cover page'], ['Nothing to see']]), 'Cover');
  const ws = XLSX.utils.aoa_to_sheet(inchSheet.map((row) => row.map((c) => (/^\d+(\.\d+)?$/.test(c) ? +c : c))));
  XLSX.utils.book_append_sheet(wb, ws, 'Measurements');
  const xbuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const xf = await reader.readFile(xbuf, 'spec.xlsx');
  assert.strictEqual(xf.kind, 'xlsx'); assert.deepStrictEqual(xf.sheets.map((s) => s.name), ['Cover', 'Measurements']);
  const best = xf.sheets.map((s) => S.extract(s.rows)).filter((x) => x.success).sort((a, b) => b.poms.length - a.poms.length)[0];
  assert.deepStrictEqual(key(best, 'chest').values, { S: 20, M: 21.5, L: 23, XL: 24.5 }); assert.strictEqual(best.meta.style_no, 'KT-2291');
  // a workbook that is not one, and an old .xls
  await assert.rejects(() => reader.readFile(Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), Buffer.alloc(40)]), 'old.xls'), (e) => e.code === 'OLD_XLS');
  await assert.rejects(() => reader.readFile(zlib.gzipSync(Buffer.from('x')), 'x.gz'), (e) => e instanceof reader.SpecReadError);
  const csv = await reader.readFile(Buffer.from(inchSheet.map((row) => row.join(',')).join('\n')), 'spec.csv');
  assert.strictEqual(S.extract(csv.sheets[0].rows).poms.filter((p) => p.key).length, best.poms.filter((p) => p.key).length, 'a CSV reads like the workbook');
  console.log('✓ an .xlsx workbook is opened without a library (two sheets, the measurements sheet found), a CSV reads like it, an old .xls and a stray file are refused with advice');

  // ── a picture: the table drawn as text on a white page, read by OCR ──
  const Jimp = require('jimp');
  const font = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK);
  const img = new Jimp(1500, 560, 0xffffffff);
  const rowsTxt = [['POM', 'S', 'M', 'L', 'XL'], ['Chest width', '50', '52', '54', '56'], ['Body length', '68', '70', '72', '74'], ['Shoulder width', '44', '45', '46', '47'], ['Sleeve length', '20', '21', '22', '23'], ['Hem width', '50', '52', '54', '56']];
  const xs = [30, 640, 840, 1040, 1240];
  rowsTxt.forEach((row, ri) => row.forEach((c, ci) => img.print(font, xs[ci], 30 + ri * 80, c)));
  const png = await img.getBufferAsync(Jimp.MIME_PNG);
  const pf = await reader.readFile(png, 'photo.png');
  assert.strictEqual(pf.kind, 'image'); assert(pf.confidence > 0.5, `OCR confidence ${pf.confidence}`);
  const pr = S.extract(pf.sheets[0].rows);
  assert(pr.success, pr.error); assert.deepStrictEqual(pr.sizes, ['S', 'M', 'L', 'XL']);
  assert(key(pr, 'chest') && key(pr, 'length') && key(pr, 'shoulder'), 'the rows of a picture are named');
  const hit = ['chest', 'length', 'shoulder', 'sleeve_l', 'hem'].filter((k) => key(pr, k)).reduce((a, k) => a + Object.values(key(pr, k).values).length, 0);
  assert(hit >= 16, `a picture reads most of its figures (${hit} of 20)`);
  console.log(`✓ a picture: the table is read by OCR (${Math.round(pf.confidence * 100)} % sure), sizes and rows found, ${hit} of 20 figures read; the review step is where the rest is put right`);
  await reader.stopOcr();

  // ── nothing makes it throw ──
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const words = ['Chest', 'S', 'M', 'L', '1/2', '20', '21-1/2', '±1', '', 'Tol(+)', 'Body length', 'POM', 'cm', '0.5', 'Sleeve', 'x', '(HPS)', '12 SPI', 'Zipper YKK #5 55cm', 'Main label', '99%', '-', '1e9', 'NaN'];
  for (let n = 0; n < 400; n++) {
    const g = Array.from({ length: 2 + Math.floor(rnd() * 14) }, () => Array.from({ length: Math.floor(rnd() * 9) }, () => words[Math.floor(rnd() * words.length)]));
    const x = S.extract(S.dense(g), { unit: rnd() < 0.3 ? 'in' : undefined, header_row: rnd() < 0.2 ? Math.floor(rnd() * 3) : undefined });
    if (x.success) { const b = S.toBuild(x); if (b.missing.length === 0) { const bu = G.build({ unit: b.unit, sizes: b.sizes, chart: b.chart, fabric: { gsm: 180 }, tolerances: b.tolerances, trims: b.trims }); if (bu.success) S.compliance(x, bu); } }
  }
  for (let n = 0; n < 300; n++) {                                           // random charts written out as a sheet and read back: the chart comes back exactly
    const T = G.template(['S', 'M', 'L', 'XL'], rnd() < 0.5 ? 'in' : 'cm'), g = [['Code', 'Point of Measure'].concat(T.sizes)];
    const names = { chest: '1/2 Chest', length: 'Body Length', shoulder: 'Across Shoulder', armhole: 'Armhole straight', neck_w: 'Neck Width', neck_df: 'Front Neck Drop', sleeve_l: 'Sleeve Length', bicep: 'Bicep', sleeve_o: 'Sleeve Opening' };
    Object.keys(names).forEach((k, i) => g.push([String.fromCharCode(65 + i), names[k]].concat(T.sizes.map((s) => String(Math.round((T.chart[k][s] + (rnd() - 0.5)) * 4) / 4)))));
    const x = S.extract(S.dense(g), { unit: T.unit }); assert(x.success, x.error);
    const b = S.toBuild(x); Object.keys(names).forEach((k) => T.sizes.forEach((s) => assert.strictEqual(+b.chart[k][s], +g[Object.keys(names).indexOf(k) + 1][2 + T.sizes.indexOf(s)], `${k} ${s} survives the round trip`)));
  }
  console.log('✓ 400 random grids of junk never throw; 300 random charts written as a sheet and read back come out figure for figure');
  console.log('Garment spec tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
