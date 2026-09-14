/**
 * KnitAdvisor — Tech Pack PDF renderer
 * =======================================
 *
 * Draws the flat "sections" structure from techpack-content-builder.js as an
 * actual PDF, using pdfkit (pure JS, no Chromium/native binary — the right
 * choice on shared cPanel hosting where a headless-browser PDF pipeline
 * would not be realistic to run).
 *
 * Deliberately dumb about the DATA (it draws whatever rows it is given) and
 * only smart about LAYOUT (page breaks, column widths, section spacing) —
 * every number/label originates in techpack-content-builder.js, which is
 * unit-tested; this file is verified by smoke-testing that it produces a
 * well-formed, non-trivial PDF buffer without throwing (see
 * tests/techpack_pdf.test.js) rather than asserting on drawn pixels.
 */

const PDFDocument = require('pdfkit');

const PAGE_MARGIN = 46;
const CONTENT_WIDTH = 595.28 - PAGE_MARGIN * 2; // A4 width in points, minus margins
const INK = '#1a1a1a';
const MUTED = '#6b6b6b';
const ACCENT = '#00875f';
const LINE = '#d8d8d3';

function checkPageBreak(doc, needed) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) doc.addPage();
}

function sectionTitle(doc, text) {
  checkPageBreak(doc, 34);
  doc.moveDown(0.6);
  // Explicit x/width rather than the implicit flowing cursor — a preceding
  // manually-positioned block (e.g. marginTable's per-column .text() calls)
  // can leave doc.x offset partway across the page, which silently narrows
  // and mis-positions any title drawn right after it.
  doc.font('Helvetica-Bold').fontSize(11).fillColor(ACCENT)
    .text(text.toUpperCase(), PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH, characterSpacing: 0.6 });
  const y = doc.y + 2;
  doc.moveTo(PAGE_MARGIN, y).lineTo(PAGE_MARGIN + CONTENT_WIDTH, y).strokeColor(LINE).lineWidth(1).stroke();
  doc.x = PAGE_MARGIN;
  doc.moveDown(0.5);
}

function keyValueRows(doc, rows, labelWidth = 190) {
  const valueX = PAGE_MARGIN + labelWidth + 12;
  const valueWidth = CONTENT_WIDTH - labelWidth - 12;

  for (const r of rows) {
    const labelHeight = doc.font('Helvetica-Bold').fontSize(9).heightOfString(r.label, { width: labelWidth });
    const valueHeight = doc.font('Helvetica').fontSize(9).heightOfString(r.value, { width: valueWidth });
    const rowHeight = Math.max(labelHeight, valueHeight) + 7;
    checkPageBreak(doc, rowHeight);

    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text(r.label, PAGE_MARGIN, y, { width: labelWidth });
    doc.font('Helvetica').fontSize(9).fillColor(INK).text(r.value, valueX, y, { width: valueWidth });
    doc.y = y + rowHeight;
  }
}

function marginTable(doc, margins) {
  if (!margins || !margins.length) return;
  checkPageBreak(doc, 20 + margins.length * 16);
  const colWidth = CONTENT_WIDTH / margins.length;

  const headerY = doc.y;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED);
  margins.forEach((m, i) => doc.text(`+${m.margin_pct}%`, PAGE_MARGIN + i * colWidth, headerY, { width: colWidth, align: 'center' }));
  doc.y = headerY + 14;

  const rowY = doc.y;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK);
  margins.forEach((m, i) => doc.text(`$${m.selling_price_usd}`, PAGE_MARGIN + i * colWidth, rowY, { width: colWidth, align: 'center' }));
  doc.y = rowY + 18;
}

function drawFooter(doc, pageNumber) {
  // Drawing this close to the bottom edge, inside the reserved footer strip,
  // trips pdfkit's own auto-pagination (it silently starts a NEW page rather
  // than letting text sit in what it thinks is unusable margin space) unless
  // the bottom margin is relaxed for the duration of this call.
  const savedBottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;

  const bottomY = doc.page.height - PAGE_MARGIN - 16;
  doc.font('Helvetica').fontSize(7).fillColor(MUTED)
    .text(
      'KnitAdvisor — engineering estimates for planning purposes, not a binding quotation. Every figure carries its own source tag internally.',
      PAGE_MARGIN, bottomY, { width: CONTENT_WIDTH - 40, lineBreak: false }
    );
  doc.font('Helvetica').fontSize(7).fillColor(MUTED)
    .text(String(pageNumber), PAGE_MARGIN, bottomY, { width: CONTENT_WIDTH, align: 'right', lineBreak: false });

  doc.page.margins.bottom = savedBottom;
}

/**
 * @param {object} content — the output of buildTechPackContent() (must have ok: true)
 * @returns {PDFDocument} — caller pipes this to a writable stream and calls .end()
 */
function renderTechPackPdf(content) {
  if (!content || !content.ok) {
    throw new Error(content?.error || 'Cannot render a tech pack from invalid content.');
  }

  const doc = new PDFDocument({ size: 'A4', margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN + 28, left: PAGE_MARGIN, right: PAGE_MARGIN }, bufferPages: true });

  // ---- Header ----
  doc.font('Helvetica-Bold').fontSize(20).fillColor(INK).text('KnitAdvisor', PAGE_MARGIN, PAGE_MARGIN);
  doc.font('Helvetica').fontSize(10).fillColor(MUTED).text('Fabric Technical Data Sheet', PAGE_MARGIN, doc.y);
  const afterSubtitleY = doc.y;

  // Absolute-positioned (top-right) — must NOT move the flowing cursor, or
  // everything drawn after it silently jumps back up the page.
  const genDate = new Date(content.meta.generated_at).toISOString().slice(0, 10);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED)
    .text(`Generated ${genDate}`, PAGE_MARGIN, PAGE_MARGIN, { width: CONTENT_WIDTH, align: 'right', lineBreak: false });
  doc.y = afterSubtitleY;

  doc.moveDown(1);
  doc.font('Helvetica-Bold').fontSize(15).fillColor(INK).text(content.meta.fabric_name);
  if (content.meta.gsm != null) {
    doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(`Target GSM: ${content.meta.gsm} g/m²${content.meta.machine_type ? '  ·  ' + content.meta.machine_type.replace(/_/g, ' ') : ''}`);
  }

  const headerLineY = doc.y + 8;
  doc.moveTo(PAGE_MARGIN, headerLineY).lineTo(PAGE_MARGIN + CONTENT_WIDTH, headerLineY).strokeColor(INK).lineWidth(1.4).stroke();
  doc.y = headerLineY + 14;

  // ---- Sections ----
  if (content.fabric_spec.length) { sectionTitle(doc, 'Fabric Specification'); keyValueRows(doc, content.fabric_spec); }
  if (content.yarn_spec.length) { sectionTitle(doc, 'Yarn & Pricing'); keyValueRows(doc, content.yarn_spec); }
  if (content.machine_spec.length) { sectionTitle(doc, 'Machine & Production'); keyValueRows(doc, content.machine_spec); }
  if (content.quality.length) { sectionTitle(doc, 'Quality Prediction'); keyValueRows(doc, content.quality); }

  if (content.costing) {
    sectionTitle(doc, 'Fabric Costing (per kg, USD)');
    keyValueRows(doc, content.costing.breakdown);
    checkPageBreak(doc, 20);
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(`Total: $${content.costing.total_per_kg} / kg`);
    doc.moveDown(0.4);
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Selling price at margin:');
    doc.moveDown(0.2);
    marginTable(doc, content.costing.margins);
  }

  if (content.dyeing_recipe) {
    sectionTitle(doc, 'Dyeing Recipe (verified factory recipe)');
    keyValueRows(doc, [
      { label: 'Recipe', value: content.dyeing_recipe.recipe_name || '—' },
      { label: 'Colour', value: content.dyeing_recipe.color_label || '—' },
      { label: 'Match quality', value: content.dyeing_recipe.match_quality || '—' },
    ]);
    if (content.dyeing_recipe.chemicals.length) {
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('Chemicals');
      doc.moveDown(0.2);
      keyValueRows(doc, content.dyeing_recipe.chemicals);
    }
  }

  if (content.garment) {
    sectionTitle(doc, `Garment CMT & FOB — ${content.garment.garment_name}`);
    keyValueRows(doc, [
      { label: 'Net fabric weight', value: `${content.garment.net_weight_g} g` },
      { label: 'Gross fabric weight (with allowances)', value: `${content.garment.gross_weight_g} g (+${content.garment.total_wastage_pct}%)` },
      { label: 'Sewing SAM', value: `${content.garment.sam_minutes} min` },
      ...content.garment.breakdown,
    ]);
    checkPageBreak(doc, 40);
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(`FOB Total: $${content.garment.fob_total_usd} per garment`);
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(`Fabric is ${content.garment.fabric_share_pct}% of FOB.`);
  }

  if (content.warnings && content.warnings.length) {
    sectionTitle(doc, 'Engineering Notes');
    doc.font('Helvetica').fontSize(8).fillColor(MUTED);
    for (const w of content.warnings) {
      checkPageBreak(doc, 14);
      doc.text(`•  ${w}`, { width: CONTENT_WIDTH });
      doc.moveDown(0.15);
    }
  }

  // ---- Footers on every page ----
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    drawFooter(doc, i + 1);
  }

  return doc;
}

module.exports = { renderTechPackPdf, PAGE_MARGIN, CONTENT_WIDTH };
