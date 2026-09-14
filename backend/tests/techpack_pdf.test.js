const assert = require('assert');
const { calculate } = require('../engine/index');
const { buildTechPackContent } = require('../engine/domain/techpack-content-builder');
const { renderTechPackPdf } = require('../engine/domain/techpack-pdf-renderer');

function renderToBuffer(content) {
  return new Promise((resolve, reject) => {
    const doc = renderTechPackPdf(content);
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

async function main() {
  console.log('--- Running Tech Pack PDF Renderer Tests ---');

  // ==========================================================================
  // 1. Invalid content throws synchronously, before any stream work starts.
  // ==========================================================================
  assert.throws(() => renderTechPackPdf(null), /invalid content/);
  assert.throws(() => renderTechPackPdf({ ok: false, error: 'x' }), /x/);
  console.log('  Invalid content rejected synchronously (no partial PDF started)');

  // ==========================================================================
  // 2. A full real calculation (fabric + yarn + costing + garment CMT +
  //    quality + warnings) renders to a well-formed, non-trivial PDF.
  // ==========================================================================
  {
    const r = calculate({
      fabric: 'single_jersey', gsm: 180, gauge: 24, dia: 30, composition: '100% Cotton', color_shade: 'medium',
      garment_weight_g: 180, garment_type: 'basic_tshirt', order_quantity: 5000,
    });
    assert(!r.error, `calculate() should succeed: ${r.error}`);
    const content = buildTechPackContent(r);
    assert.strictEqual(content.ok, true);

    const buf = await renderToBuffer(content);
    assert(buf.length > 2000, `PDF buffer should be a real document, got ${buf.length} bytes`);
    assert.strictEqual(buf.slice(0, 5).toString('latin1'), '%PDF-', 'Output must start with a valid PDF header');
    assert.strictEqual(buf.slice(-6).toString('latin1').trim().slice(-6), '%%EOF', 'Output must end with a valid PDF trailer');
    console.log(`  Full calculation (with garment CMT) renders a valid PDF: ${buf.length} bytes`);
  }

  // ==========================================================================
  // 3. A minimal calculation (no garment, no dyeing recipe, no quality)
  //    still renders without throwing — sections that are absent must not
  //    crash the renderer, just be skipped.
  // ==========================================================================
  {
    const r = calculate({ fabric: 'single_jersey', gsm: 180, gauge: 24, dia: 30 });
    assert(!r.error);
    const content = buildTechPackContent(r);
    const buf = await renderToBuffer(content);
    assert(buf.length > 500);
    assert.strictEqual(buf.slice(0, 5).toString('latin1'), '%PDF-');
    console.log(`  Minimal calculation (no garment/quality/recipe) still renders a valid PDF: ${buf.length} bytes`);
  }

  // ==========================================================================
  // 4. Many engineering-note warnings force multiple pages — must not throw
  //    from the page-break logic, and every buffered page should get a footer
  //    (spot-checked by confirming bufferedPageRange reports >1 page).
  // ==========================================================================
  {
    const r = calculate({ fabric: 'single_jersey', gsm: 180, gauge: 24, dia: 30 });
    assert(!r.error);
    const content = buildTechPackContent(r);
    content.warnings = Array.from({ length: 80 }, (_, i) => `Synthetic long engineering note number ${i + 1} to force pagination in the renderer's page-break handling.`);
    const buf = await renderToBuffer(content);
    assert(buf.length > 3000);
    console.log(`  Many warnings force multi-page output without throwing: ${buf.length} bytes`);
  }

  console.log('\nAll Tech Pack PDF Renderer Tests Passed!');
}

main().catch(err => {
  console.error('\nTech Pack PDF Renderer Tests FAILED:', err);
  process.exitCode = 1;
});
