// Calibration measurements: validated, compared with what the Studio predicted at the time, and flattened for a fit.
const assert = require('assert');
console.log('--- Running Studio Calibration Tests ---');
const C = require('../engine/domain/calibration-intake');
const F = require('../engine/domain/fabric-studio');
const X = require('../engine/domain/machine-export');

const t = F.listTemplates().find((x) => x.id === 'single_jersey');
const out = F.analyse({ bed: t.bed, grid: t.grid, feeds: [{ role: 'ground' }], yarn: { count: 30, unit: 'ne', fibre: 'cotton' }, machine: { gauge: 24, dia: 30, sl_mm: 2.7 }, target: {} });
const snap = C.snapshot(out);
assert(snap.states.dry.wpc > 0 && snap.states.full.gsm > 0 && snap.group === 'single_jersey' && snap.residual.length_pct.length === 3, 'the snapshot keeps what the Studio said');

// validation
assert.throws(() => C.cleanMeasured({}), C.CalibrationError, 'nothing entered');
assert.throws(() => C.cleanMeasured({ states: { dry: { wpc: 400 } } }), C.CalibrationError, 'an absurd count');
assert.throws(() => C.cleanMeasured({ stress: { course: [{ e: 10, n: -3 }] } }), C.CalibrationError);
const m = C.cleanMeasured({
  states: { finished: { wpc: '14.4', cpc: 19.5, gsm: 147, width_in: '' }, full: { wpc: 15.2, cpc: 21.1, gsm: 171 }, wet: {} },
  stress: { course: [{ e: 20, n: 4.2 }, { e: 5, n: 0.9 }, { e: '', n: 3 }], wale: [{ e: 10, n: 1.4 }] },
  recovery: { course_1min_pct: 104, wale_1min_pct: null }, thickness_mm: 0.62, note: 'lot 7',
});
assert.deepStrictEqual(Object.keys(m.states).sort(), ['finished', 'full'], 'empty states are dropped');
assert.deepStrictEqual(m.stress.course.map((p) => p.e), [5, 20], 'strain-ordered, blanks dropped');
assert.strictEqual(m.recovery.course_1min_pct, 104); assert(!('wale_1min_pct' in m.recovery));

// comparison against the prediction made at the time
const cmp = C.compare(snap, m);
const fin = cmp.rows.find((r) => r.state === 'finished' && r.quantity === 'gsm');
assert.strictEqual(fin.predicted, snap.states.finished.gsm);
assert(Math.abs(fin.off_pct - Math.round((147 / snap.states.finished.gsm - 1) * 1000) / 10) < 0.11);
assert(cmp.shrinkage && Math.abs(cmp.shrinkage.length_pct - Math.round((1 - 19.5 / 21.1) * 1000) / 10) < 0.11, 'residual shrinkage implied by the measurements');
assert.deepStrictEqual(cmp.shrinkage.predicted.length_pct.length, 3);

// a tidy CSV a fit can read
const csv = C.csv([{ id: 3, created_at: new Date('2026-11-11T00:00:00Z'), design_name: 'Jersey, 30s', group_key: 'single_jersey', measured: m, predicted: snap }]);
assert(/record,saved,design,structure_group,kind,key,strain_pct,measured,studio_predicted/.test(csv));
assert(/"Jersey, 30s"/.test(csv) && /force_n_per_5cm,course,20,4.2/.test(csv) && /state,finished.gsm,,147,/.test(csv) && /thickness_mm/.test(csv));

// the calibration sheet is a PDF that carries what the Studio expects
const chunks = [], doc = X.calibrationSheet(out, { name: 'Jersey 30s' });
doc.on('data', (c) => chunks.push(c));
doc.on('end', () => {
  const pdf = Buffer.concat(chunks);
  assert.strictEqual(pdf.toString('latin1', 0, 5), '%PDF-'); assert(pdf.length > 3000);
  console.log('Studio calibration tests passed');
});
doc.end();
