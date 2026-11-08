/**
 * The cost sheet as a PDF quotation (pdfkit, A4 landscape) — drawn from the
 * SAME analyse() result the page shows, never a second calculation.
 *
 * Page 1: style header with the picture, the summary per size (cost lines,
 * sub-total, commission, profit, FOB per piece / pack / dozen, margins).
 * Then the fabric breakdown per shell (prices with where each came from) and
 * every per-size line (consumption, trims, embellishment, wash, packaging,
 * testing, CM from SMV), and the order booking when an order was given.
 */
'use strict';

const PDFDocument = require('pdfkit');

const M = 32;
const INK = '#1a1a1a', MUTED = '#6b6b6b', ACCENT = '#1857C4', LINE = '#d8dbe0', BAND = '#EEF3FC';
const f2 = (v) => (v == null || v === '' ? '' : (+v).toFixed(2));
const f3 = (v) => (v == null || v === '' ? '' : (+v).toFixed(3));
const f4 = (v) => (v == null || v === '' ? '' : (+v).toFixed(4));
// pdfkit's built-in Helvetica has no Bengali, no ৳, no arrows: keep the text Latin
const latin = (t) => String(t == null ? '' : t).replace(/৳/g, 'BDT ').replace(/[→]/g, '->').replace(/[−]/g, '-').replace(/[^\x20-\x7E -ÿ]/g, '');

function render(r, input) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: M, bufferPages: true, info: { Title: `Costing ${latin((r.header || {}).style || '')}`, Creator: 'KnitAdvisor' } });
  const W = doc.page.width - M * 2;
  const bottom = () => doc.page.height - M - 18;
  const need = (h) => { if (doc.y + h > bottom()) doc.addPage(); };
  const h = r.header || {};
  const n = r.sizes.length;

  // ── header ──
  doc.font('Helvetica-Bold').fontSize(16).fillColor(ACCENT).text('QUOTATION / COSTING SHEET', M, M);
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(`KnitAdvisor  -  printed ${new Date().toISOString().slice(0, 10)}`, M, M + 20);
  const picW = 150, picH = 150;
  const hx = M, hy = M + 40, hw = W - (input.picture ? picW + 14 : 0);
  const pairs = [['Style / item ref', h.style], ['Order no.', h.order_no], ['Description', h.description], ['Buyer / to', h.buyer], ['Department', h.department],
    ['From', h.from], ['Factory', h.factory], ['Date', h.date], ['Pack of', `${r.pack_of} pc`], ['Sizes', r.sizes.join(', ')]];
  const colW = hw / 2;
  pairs.forEach(([k, v], i) => {
    const x = hx + (i % 2) * colW, y = hy + Math.floor(i / 2) * 17;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text(latin(k), x, y, { width: 95 });
    doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(latin(v || '-'), x + 98, y, { width: colW - 104, ellipsis: true, lineBreak: false });
  });
  if (input.picture) {
    try {
      const buf = Buffer.from(String(input.picture).split(',')[1] || '', 'base64');
      doc.rect(M + W - picW, hy - 4, picW, picH).strokeColor(LINE).stroke();
      doc.image(buf, M + W - picW + 4, hy, { fit: [picW - 8, picH - 8], align: 'center', valign: 'center' });
    } catch (_) { /* an unreadable picture is left out, the sheet still prints */ }
  }
  doc.y = Math.max(hy + 5 * 17 + 8, input.picture ? hy + picH + 6 : 0);

  // ── a table: first column a label, then one column per size ──
  const labelW = 210, cw = Math.min(110, (W - labelW) / n);
  function table(title, rows, opts = {}) {
    need(30 + rows.length * 14);
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(ACCENT).text(latin(title).toUpperCase(), M, doc.y, { characterSpacing: 0.5 });
    let y = doc.y + 3;
    doc.moveTo(M, y).lineTo(M + labelW + cw * n, y).strokeColor(LINE).lineWidth(1).stroke();
    y += 3;
    if (!opts.noHead) {
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED);
      r.sizes.forEach((s, k) => doc.text(latin(s), M + labelW + k * cw, y, { width: cw - 6, align: 'right' }));
      y += 13;
    }
    rows.forEach((row) => {
      if (y + 14 > bottom()) { doc.addPage(); y = M; }
      if (row.band) doc.rect(M, y - 2, labelW + cw * n, 14).fill(BAND);
      doc.font(row.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(row.big ? 10 : 8.8).fillColor(row.color || INK);
      doc.text(latin(row.label), M + 2, y, { width: labelW - 6, ellipsis: true, lineBreak: false });
      row.values.forEach((v, k) => doc.text(latin(v), M + labelW + k * cw, y, { width: cw - 6, align: 'right', lineBreak: false }));
      y += row.big ? 15 : 13;
    });
    doc.y = y + 2;
  }
  const P = r.per_size;
  const col = (fn) => P.map(fn);

  // ── summary ──
  const sumRows = [
    { label: 'Fabric', values: col((p) => f3(p.fabric)) },
    { label: 'Trims', values: col((p) => f3(p.trims)) },
    { label: 'Embellishment (print, embroidery, other)', values: col((p) => f3(p.embellishment)) },
    { label: 'Wash', values: col((p) => f3(p.wash)) },
    { label: `CM (SMV x ${r.cm.cpm || '-'} / ${r.cm.efficiency_pct}% eff.)`, values: col((p) => f3(p.cm) + (p.cm_basis === 'typed' ? '*' : '')) },
    { label: 'Packaging', values: col((p) => f3(p.packaging)) },
    { label: 'Testing', values: col((p) => f3(p.testing)) },
    { label: 'Sub-total (cost)', values: col((p) => f3(p.subtotal)), bold: true },
    ...r.markups.map((m, i) => ({ label: `${m.name} (${m.pct}%, ${m.kind})`, values: col((p) => f3(p.markups[i].usd)) })),
    { label: 'TOTAL FOB / pc (USD)', values: col((p) => f2(p.fob_pc)), bold: true, big: true, band: true, color: '#12408f' },
  ];
  if (r.pack_of > 1) sumRows.push({ label: `FOB / pack of ${r.pack_of}`, values: col((p) => f2(p.fob_pack)), bold: true });
  sumRows.push({ label: 'FOB / dozen', values: col((p) => f2(p.fob_dozen)) });
  sumRows.push({ label: `FOB / pc (BDT at ${r.bdt.rate})`, values: r.bdt.fob_pc.map((v) => String(Math.round(v))) });
  sumRows.push({ label: 'Profit margin on FOB', values: col((p) => `${p.profit_margin_pct}%`) });
  sumRows.push({ label: 'Profit on cost', values: col((p) => `${p.profit_on_cost_pct}%`) });
  sumRows.push({ label: 'Factory net after commission', values: col((p) => f3(p.factory_net)) });
  if (P.some((p) => p.target)) {
    sumRows.push({ label: 'Target FOB', values: col((p) => (p.target ? f2(p.target) : '-')) });
    sumRows.push({ label: 'Left at target (+) / over (-)', values: col((p) => (p.target_gap == null ? '-' : (p.target_gap >= 0 ? '+' : '') + f3(p.target_gap))), bold: true });
    sumRows.push({ label: 'Profit % that meets the target', values: col((p) => (p.profit_pct_at_target == null ? '-' : `${p.profit_pct_at_target}%`)) });
  }
  table('Summary per size (USD)', sumRows);
  if (P.some((p) => p.cm_basis === 'typed')) doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text('* CM typed for this size instead of SMV x CPM.', M, doc.y);

  // ── fabric breakdown per shell ──
  doc.addPage();
  const sw = Math.min(170, (W - 150) / Math.max(1, r.shells.length));
  doc.font('Helvetica-Bold').fontSize(10).fillColor(ACCENT).text('FABRIC COST BREAKDOWN PER KG', M, M, { characterSpacing: 0.5 });
  let y = doc.y + 4;
  const shellRow = (label, fn, bold) => {
    const hgt = Math.max(13, ...r.shells.map((s) => doc.font('Helvetica').fontSize(8.3).heightOfString(latin(fn(s)), { width: sw - 8 }) + 3));
    if (y + hgt > bottom()) { doc.addPage(); y = M; }
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text(latin(label), M, y, { width: 145 });
    r.shells.forEach((s, i) => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.3).fillColor(INK).text(latin(fn(s)), M + 150 + i * sw, y, { width: sw - 8 }));
    y += hgt;
    doc.moveTo(M, y - 1).lineTo(M + 150 + sw * r.shells.length, y - 1).strokeColor('#eef0f2').lineWidth(0.5).stroke();
  };
  shellRow('Shell', (s) => s.name, true);
  shellRow('Application in garment', (s) => s.application || '-');
  shellRow('Fabrication', (s) => `${s.composition}${s.gsm ? ' ' + s.gsm + ' GSM' : ''} - ${s.fabric.replace(/_/g, ' ')}`);
  shellRow('Yarn', (s) => s.yarns.map((y2) => `${y2.share_pct}% ${y2.label.replace(/^100% /, '')}${y2.count ? ' ' + y2.count + 's' : ''} @ $${y2.price} (${y2.source.label})`).join('; '));
  const pr = (field, label) => shellRow(label, (s) => `${f3(s.prices[field].value)}  (${s.prices[field].source.label})`);
  pr('yarn', 'Yarn price /kg');
  pr('yarn_dyeing', 'Yarn dyeing /kg'); pr('knitting', 'Knitting /kg'); pr('dyeing', 'Dyeing /kg'); pr('finishing', 'Finishing /kg'); pr('aop', 'AOP /kg');
  shellRow('Process loss', (s) => `${s.prices.loss_pct.value}%  (${s.prices.loss_pct.source.label})`);
  shellRow(`Fabric price /kg (${r.loss_method === 'exact' ? 'exact' : 'sheet'} method)`, (s) => `$${f3(s.price_per_kg)}`, true);
  shellRow('Other method, for reference', (s) => `$${f3(r.loss_method === 'exact' ? s.sheet_per_kg : s.exact_per_kg)}`);
  doc.y = y + 4;

  // ── per-size lines ──
  const lineRows = (list) => list.map((l) => ({ label: l.name, values: l.values.map(f3) }));
  table('Fabric consumption (kg / pc) and cost', r.shells.flatMap((s) => [
    { label: `${s.name} consumption`, values: s.consumption_kg_pc.map(f4) },
    { label: `${s.name} cost @ $${f3(s.price_per_kg)}`, values: s.cost.map(f3), bold: true },
  ]));
  if (r.trims.length) table('Trims', lineRows(r.trims));
  if (r.embellishments.length) table('Embellishment', lineRows(r.embellishments));
  if (r.washes.length) table('Wash', lineRows(r.washes));
  if (r.packaging.length) table('Packaging', lineRows(r.packaging));
  table('CM and testing', [
    { label: 'SMV (minutes)', values: r.cm.smv.map((v) => (v ? String(v) : '-')) },
    { label: `CM from SMV (x ${r.cm.cpm || '-'} / ${r.cm.efficiency_pct}%)`, values: r.cm.from_smv.map(f3) },
    { label: 'CM used', values: r.cm.per_size.map(f3), bold: true },
    { label: 'Testing', values: r.testing.map(f3) },
  ]);

  if (r.order) {
    const o = r.order;
    need(90);
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(ACCENT).text('ORDER AND FABRIC BOOKING', M, doc.y, { characterSpacing: 0.5 });
    doc.font('Helvetica').fontSize(9).fillColor(INK)
      .text(`${o.quantity.toLocaleString('en-US')} pcs (${o.pieces_by_size.map((p) => `${p.size} ${p.pieces}`).join(', ')}).  Weighted FOB $${f2(o.weighted_fob_pc)}  -  order value $${Math.round(o.value).toLocaleString('en-US')}  -  cost $${Math.round(o.cost).toLocaleString('en-US')}  -  commission $${Math.round(o.commission).toLocaleString('en-US')}  -  profit $${Math.round(o.profit).toLocaleString('en-US')}`, M, doc.y + 4, { width: W });
    o.fabric.forEach((f) => {
      need(14);
      doc.text(latin(`${f.shell}: finished ${Math.round(f.finished_kg)} kg, grey ${Math.round(f.grey_kg)} kg - yarn: ${f.yarn_kg.map((y2) => `${y2.yarn} ${Math.round(y2.kg)} kg`).join(', ')}`), M, doc.y + 2, { width: W });
    });
  }

  need(40);
  doc.moveDown(0.8);
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(latin(r.method_note) + ` Mark-ups applied ${r.markup_mode === 'on_price' ? 'as a margin of the price: cost / (1 - total %)' : 'on cost: cost x (1 + total %)'}.`, M, doc.y, { width: W });

  // page numbers
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(`${latin(h.style || 'Costing sheet')}  -  page ${i + 1} of ${range.count}`, M, doc.page.height - M + 4, { width: W, align: 'right', lineBreak: false });
  }
  return doc;
}

module.exports = { render };
