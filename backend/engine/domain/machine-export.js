/**
 * Machine files from a Studio answer — what the knitting floor takes away from the screen.
 *
 *   needle programme   a bitmap, one pixel per needle per feed (PNG or BMP, indexed colour), either the
 *                      repeat or one whole revolution (every feeder, every needle of the cylinder)
 *   cam chart / set-out  CSV: the cam on every track at every feeder, the set-out, the needle programme
 *   set-up sheet       one printable page: machine, yarn and stitch length per feed, the programme
 *                      drawn, the cam chart, what the cloth should come out at, and a first-roll box
 *                      to fill in and log back into the Studio
 *
 * Mill machines read their own proprietary formats; these are the open ones every pattern system
 * can import and a setter can read off the sheet. Everything is drawn from the SAME analyse() answer
 * the page shows — never a second calculation — and nothing here is money.
 */
'use strict';

const zlib = require('zlib');
const PDFDocument = require('pdfkit');

class ExportError extends Error {}
const MAX_W = 6000, MAX_H = 600;

// colour index → what the needle does. Index 0 is "no needle in this slot".
const SYMS = ['-', 'K', 'T', 'M', 'E', 'R'];
const PALETTE = {
  '-': { name: 'no needle', rgb: [255, 255, 255] },
  K: { name: 'knit', rgb: [24, 87, 196] },
  T: { name: 'tuck', rgb: [232, 163, 58] },
  M: { name: 'miss', rgb: [200, 204, 210] },
  E: { name: 'transfer to the next needle', rgb: [14, 116, 144] },
  R: { name: 'transfer to the other bed', rgb: [122, 79, 194] },
};
const idxOf = (s) => { const i = SYMS.indexOf(s); return i < 0 ? 0 : i; };

/** The programme of one bed as rows of colour indices. scope: 'repeat' | 'revolution'. */
function programme(out, bed, scope = 'repeat') {
  const st = out && out.structure;
  const rows = st && st.beds && st.beds[bed];
  if (!rows || !rows.length) throw new ExportError(bed === 'D' ? 'This design has no dial — it knits on the cylinder only.' : 'This design has no needle programme to export.');
  const nf = rows.length, nn = rows[0].length;
  let W = nn, H = nf;
  if (scope === 'revolution') {
    W = Math.round((out.machine && out.machine.needles) || 0);
    H = Math.round((out.machine && out.machine.feeders) || 0);
    if (!(W > 0 && H > 0)) throw new ExportError('The machine\'s needles and feeders are not known — give a gauge and diameter first.');
    if (W > MAX_W || H > MAX_H) throw new ExportError(`One revolution is ${W} × ${H} — too large for a bitmap here. Export the repeat.`);
  }
  const px = Array.from({ length: H }, (_, r) => Uint8Array.from({ length: W }, (__, c) => idxOf(rows[r % nf][c % nn])));
  return { px, W, H, nf, nn, scope };
}

// ── PNG / BMP, indexed colour, no dependency ─────────────────────────────────
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const scaled = (P, k) => {
  if (k === 1) return { W: P.W, H: P.H, rows: P.px };
  const rows = [];
  for (const row of P.px) { const wide = new Uint8Array(P.W * k); for (let c = 0; c < P.W; c++) wide.fill(row[c], c * k, c * k + k); for (let j = 0; j < k; j++) rows.push(wide); }
  return { W: P.W * k, H: P.H * k, rows };
};
const palette = () => SYMS.flatMap((s) => PALETTE[s].rgb);

function png(P, k = 1) {
  const { W, H, rows } = scaled(P, k);
  const raw = Buffer.alloc((W + 1) * H);
  rows.forEach((row, r) => { raw[r * (W + 1)] = 0; Buffer.from(row.buffer, row.byteOffset, W).copy(raw, r * (W + 1) + 1); });
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 3;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('PLTE', Buffer.from(palette())), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function bmp(P, k = 1) {
  const { W, H, rows } = scaled(P, k);
  const stride = (W + 3) & ~3, size = 54 + 1024 + stride * H;
  const b = Buffer.alloc(size);
  b.write('BM', 0, 'latin1'); b.writeUInt32LE(size, 2); b.writeUInt32LE(54 + 1024, 10);
  b.writeUInt32LE(40, 14); b.writeInt32LE(W, 18); b.writeInt32LE(H, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(8, 28);
  b.writeUInt32LE(stride * H, 34); b.writeUInt32LE(2835, 38); b.writeUInt32LE(2835, 42); b.writeUInt32LE(SYMS.length, 46);
  SYMS.forEach((s, i) => { const [r, g, bl] = PALETTE[s].rgb; b[54 + i * 4] = bl; b[55 + i * 4] = g; b[56 + i * 4] = r; });
  for (let r = 0; r < H; r++) Buffer.from(rows[H - 1 - r].buffer, rows[H - 1 - r].byteOffset, W).copy(b, 54 + 1024 + r * stride);
  return b;
}

// ── CSV ──────────────────────────────────────────────────────────────────────
const cell = (v) => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const line = (a) => a.map(cell).join(',');

function csv(out, name) {
  const su = out.setup || {}, st = out.structure, L = [];
  L.push(line(['KnitAdvisor — needle programme and cam chart', name || '']));
  L.push(line(['Machine', (out.machine || {}).machine_label || '', 'gauge', (out.machine || {}).gauge, 'diameter in', (out.machine || {}).dia, 'cylinder needles', (out.machine || {}).needles, 'feeders', (out.machine || {}).feeders]));
  L.push(line(['K = knit, T = tuck, M = miss, E = transfer to the next needle, R = transfer to the other bed, - = no needle']));
  L.push('');
  const beds = ['C', 'D'].filter((b) => su.tracks && su.tracks[b]);
  L.push(line(['Needle set-out (one repeat of the cylinder / dial, each needle takes the track named)']));
  for (const b of beds) L.push(line([b === 'C' ? 'Cylinder' : 'Dial', su.tracks[b].setout]));
  L.push('');
  L.push(line(['Cam chart — the cam each track carries at each feeder']));
  const head = ['Feed', 'Yarn', 'Role'];
  for (const b of beds) for (const s of su.tracks[b].sequences) head.push(`${b === 'C' ? 'Cylinder' : 'Dial'} track ${s.track}`);
  L.push(line(head));
  for (const r of su.cam_chart || []) {
    const row = [r.feed, r.yarn || '', r.role || ''];
    for (const b of beds) for (const s of su.tracks[b].sequences) row.push((r[b] || {})[s.track] || '');
    L.push(line(row));
  }
  L.push('');
  for (const b of beds) {
    L.push(line([`Needle programme — ${b === 'C' ? 'cylinder' : 'dial'} (rows are feeds, columns are needles of one repeat)`]));
    st.beds[b].forEach((row, i) => L.push(line([`Feed ${i + 1}`, ...row])));
    L.push('');
  }
  return '﻿' + L.join('\r\n') + '\r\n';
}

// ── the set-up sheet (PDF) ───────────────────────────────────────────────────
const M = 36, INK = '#1a1a1a', MUTED = '#666', ACCENT = '#1857C4', LINE = '#d8dbe0', BAND = '#EEF3FC';
const latin = (t) => String(t == null ? '' : t).replace(/[→⇒]/g, '->').replace(/[−–—]/g, '-').replace(/[″”“]/g, '"').replace(/[’‘]/g, "'").replace(/×/g, 'x').replace(/[^\x20-\x7E]/g, '');
const hex = (s) => '#' + PALETTE[s].rgb.map((n) => n.toString(16).padStart(2, '0')).join('');

function sheet(out, o = {}) {
  const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true, info: { Title: `Machine set-up sheet ${latin(o.name || '')}`.trim(), Creator: 'KnitAdvisor' } });
  const W = doc.page.width - M * 2, bottom = () => doc.page.height - M - 14;
  const need = (h) => { if (doc.y + h > bottom()) doc.addPage(); };
  const mc = out.machine || {}, f = out.fabric || {}, st = out.structure, su = out.setup || {}, ms = out.machine_setup || {};
  const feeds = (out.yarn && out.yarn.feeds) || [];

  const title = (t, h = 40) => { need(h); doc.moveDown(0.6); doc.font('Helvetica-Bold').fontSize(10.5).fillColor(ACCENT).text(latin(t), M, doc.y); doc.moveTo(M, doc.y + 1).lineTo(M + W, doc.y + 1).strokeColor(LINE).lineWidth(0.7).stroke(); doc.moveDown(0.35); };
  const kv = (pairs, cols = 3) => {
    const cw = W / cols; const y0 = doc.y; let rows = 0;
    pairs.forEach(([k, v], i) => {
      const x = M + (i % cols) * cw, y = y0 + Math.floor(i / cols) * 24; rows = Math.floor(i / cols) + 1;
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(latin(k), x, y, { width: cw - 6, lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(latin(v == null || v === '' ? '-' : v), x, y + 9, { width: cw - 6, lineBreak: false, ellipsis: true });
    });
    doc.y = y0 + rows * 24 + 2;
  };
  const table = (cols, rows) => {
    const rh = 14.5, draw = (cells, head) => {
      need(rh + 2);
      const y = doc.y;
      if (head) doc.rect(M, y, W, rh).fill(BAND);
      let x = M;
      cells.forEach((t, i) => { doc.font(head ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor(head ? MUTED : INK).text(latin(t), x + 3, y + 3.5, { width: cols[i].w - 6, align: cols[i].a || 'left', lineBreak: false, ellipsis: true }); x += cols[i].w; });
      doc.moveTo(M, y + rh).lineTo(M + W, y + rh).strokeColor(LINE).lineWidth(0.4).stroke();
      doc.y = y + rh;
    };
    draw(cols.map((c) => c.h), true);
    rows.forEach((r) => draw(r, false));
    doc.moveDown(0.2);
  };
  const para = (t, c = MUTED, size = 8.5) => { need(14); doc.font('Helvetica').fontSize(size).fillColor(c).text(latin(t), M, doc.y, { width: W }); };

  // header
  doc.font('Helvetica-Bold').fontSize(17).fillColor(ACCENT).text('MACHINE SET-UP SHEET', M, M);
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(`KnitAdvisor  -  printed ${new Date().toISOString().slice(0, 10)}${o.floor ? `  -  floor machine ${latin(o.floor)}` : ''}`, M, M + 21);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(latin(o.name || (st.match && st.match.name) || 'Untitled design'), M, M + 36, { width: W });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(latin(`${st.family_label}${st.match ? ' - same as ' + st.match.name : ''}  |  ${out.ok_to_knit ? 'knits as drawn' : 'WILL NOT KNIT AS DRAWN - see the checks below'}`), M, M + 53, { width: W });
  doc.y = M + 72;

  title('Machine');
  kv([
    ['Type', String((ms.profile ? ms.profile.label : mc.machine_label) || '').replace(/\s*\(.*\)\s*$/, '')], ['Gauge', mc.gauge ? `${mc.gauge} GG` : null], ['Diameter', mc.dia ? `${mc.dia} in` : null],
    ['Needles (per bed)', mc.needles], ['Feeders', mc.feeders], ['Speed', mc.rpm ? `${mc.rpm} rpm` : null],
    ['Efficiency', mc.efficiency_pct ? `${mc.efficiency_pct}%` : null], ['Output', mc.kg_per_hour ? `${mc.kg_per_hour} kg/h` : null], ['Dial timing', su.timing ? String(su.timing).split(' timing')[0] : null],
  ]);

  title('Yarn and stitch length, feed by feed');
  const colsY = [{ h: 'Feed', w: 34 }, { h: 'Role', w: 58 }, { h: 'Yarn', w: 96 }, { h: 'Stitch length mm', w: 86, a: 'right' }, { h: 'Course length m', w: 86, a: 'right' }, { h: 'Yarn speed m/min', w: 86, a: 'right' }, { h: 'Tension cN', w: W - 446, a: 'right' }];
  table(colsY, feeds.map((x) => [x.feed, x.role, x.yarn, x.sl_mm, x.course_length_m, x.yarn_speed_m_min, x.tension_cN ? x.tension_cN.join(' - ') : '']));
  para('Course length is what a yarn-length meter reads at one feeder over one revolution; the quality pulley is set to it. ' + (out.vdq && out.vdq.method ? '' : 'Your own VDQ scale readings turn it into pulley settings - give one or two in the Studio.'));

  // the programme, drawn
  title('Needle programme (one repeat)');
  const beds = ['C', 'D'].filter((b) => st.beds && st.beds[b]);
  for (const b of beds) {
    const rows = st.beds[b], nn = rows[0].length, nf = rows.length;
    const cs = Math.max(4, Math.min(22, (W - 40) / nn)), lab = cs >= 8;
    need(nf * cs + 24);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text(b === 'C' ? 'Cylinder' : 'Dial', M, doc.y);
    const y0 = doc.y + 2, x0 = M + 30;
    for (let j = 0; j < nn; j++) if (cs >= 8 || j % 5 === 0) doc.font('Helvetica').fontSize(6).fillColor(MUTED).text(String(j + 1), x0 + j * cs, y0, { width: cs, align: 'center', lineBreak: false });
    rows.forEach((row, i) => {
      doc.font('Helvetica').fontSize(6.5).fillColor(MUTED).text(`F${i + 1}`, M, y0 + 8 + i * cs + cs / 2 - 3, { width: 26, align: 'right', lineBreak: false });
      row.forEach((s, j) => {
        doc.rect(x0 + j * cs, y0 + 8 + i * cs, cs, cs).fillAndStroke(s === '-' || !PALETTE[s] ? '#f4f5f6' : hex(s), s === '-' || !PALETTE[s] ? '#c9ccd1' : '#ffffff');
        if (lab && s === '-') doc.font('Helvetica').fontSize(8).fillColor('#999').text('-', x0 + j * cs, y0 + 8 + i * cs + cs / 2 - 4, { width: cs, align: 'center', lineBreak: false });
        if (lab && s !== '-') doc.font('Helvetica-Bold').fontSize(Math.min(9, cs - 3)).fillColor(s === 'M' ? '#555' : '#fff').text(s, x0 + j * cs, y0 + 8 + i * cs + (cs - Math.min(9, cs - 3)) / 2 - 0.5, { width: cs, align: 'center', lineBreak: false });
      });
    });
    doc.y = y0 + 8 + nf * cs + 6;
  }
  need(14);
  let lx = M; const ly = doc.y;
  Object.keys(PALETTE).filter((s) => JSON.stringify(st.beds).includes(`"${s}"`)).forEach((s) => {
    if (s === '-') doc.rect(lx, ly + 1, 8, 8).fillAndStroke('#f4f5f6', '#c9ccd1'); else doc.rect(lx, ly + 1, 8, 8).fill(hex(s)); doc.font('Helvetica').fontSize(7.5).fillColor(INK).text(`${s} ${PALETTE[s].name}`, lx + 11, ly + 1.5, { lineBreak: false }); lx += 14 + 5.2 * (PALETTE[s].name.length + 2) + 6;
  });
  doc.y = ly + 14;

  // cam chart
  title('Cam chart and needle set-out');
  const cols = [];
  for (const b of ['C', 'D']) if (su.tracks && su.tracks[b]) for (const s of su.tracks[b].sequences) cols.push({ b, t: s.track });
  const cw = Math.min(46, (W - 120) / Math.max(1, cols.length));
  table([{ h: 'Feed', w: 34 }, { h: 'Yarn', w: 86 }, ...cols.map((c) => ({ h: `${c.b === 'C' ? 'Cyl' : 'Dial'} ${c.t}`, w: cw, a: 'center' }))],
    (su.cam_chart || []).map((r) => [r.feed, r.yarn || r.role || '', ...cols.map((c) => (r[c.b] || {})[c.t] || '')]));
  for (const b of ['C', 'D']) if (su.tracks && su.tracks[b]) para(`${b === 'C' ? 'Cylinder' : 'Dial'} set-out, needle by needle across one repeat: ${su.tracks[b].setout}`, INK, 9);
  if (su.timing) para(su.timing);
  for (const b of ['C', 'D']) { const bb = ms.beds && ms.beds[b]; if (bb && bb.selection_note) para(`${b === 'C' ? 'Cylinder' : 'Dial'}: ${bb.selection_note}`); }

  // what it should come out at
  title('What the cloth should come out at');
  const A = f.accuracy || {};
  kv([
    ['Finished GSM', f.gsm ? `${f.gsm}${f.gsm_range ? `  (${f.gsm_range[0]} - ${f.gsm_range[1]})` : ''}` : null], ['Open width', f.width_open_in ? `${f.width_open_in} in${f.width_range_in ? `  (${f.width_range_in[0]} - ${f.width_range_in[1]})` : ''}` : null], ['Tube', f.tube_in ? `${f.tube_in} in` : null],
    ['Wales / cm', f.wpc], ['Courses / cm', f.cpc], ['Tightness factor', f.tf],
  ]);
  if (f.stenter) para(`Stenter: set at ${f.stenter.set_width_in} in against ${f.stenter.natural_width_in} in natural -> about ${f.stenter.gsm_at_set} GSM (${f.stenter.basis.split(':')[0]}).`, INK, 8.5);
  const fin = out.finish;
  if (fin && fin.brushed && fin.brushed !== 'none') para(`Finish: brushed ${fin.brushed}, ${fin.passes} pass${fin.passes === 1 ? '' : 'es'}${fin.sheared ? ', sheared' : ''} - GSM before brushing ${fin.gsm_before_brushing}.`, INK, 8.5);
  if (A.gsm) para(`Expected accuracy (${A.interval_pct}% range): GSM typically ${A.gsm.typical_error_pct}% off, width ${A.width ? A.width.typical_error_pct : '-'}% off. ${A.supported_by_rolls ? `Corrected on ${A.supported_by_rolls} of this machine's own rolls.` : 'No rolls of your own behind it yet - knit one and log it.'}`);

  // checks
  const bad = (out.checks || []).filter((c) => c.level !== 'ok');
  if (bad.length) {
    title('Checks to read before knitting');
    bad.forEach((c) => { need(24); doc.font('Helvetica-Bold').fontSize(8).fillColor(c.level === 'error' ? '#b3261e' : '#9a6a00').text(c.level === 'error' ? 'ERROR' : 'WARN', M, doc.y, { continued: true, width: W }).font('Helvetica').fillColor(INK).text('  ' + latin(c.text)); });
  }

  // first roll
  title('First roll — fill in, then log it in the Studio', 112);
  const fields = ['Stitch length set (mm)', 'Course length read (m)', 'Roll GSM (finished)', 'Open width (in)', 'Shade', 'Knitted by / date'];
  const fw = W / 3; let y = doc.y + 2;
  fields.forEach((t, i) => { const x = M + (i % 3) * fw, yy = y + Math.floor(i / 3) * 34; doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(t, x, yy, { width: fw - 10, lineBreak: false }); doc.moveTo(x, yy + 24).lineTo(x + fw - 12, yy + 24).strokeColor('#999').lineWidth(0.6).stroke(); });
  doc.y = y + 70;

  // footer on every page
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(`Predictions from the Studio's model and the factory records, not measurements - the first roll decides.   Page ${i + 1} of ${range.count}`, M, doc.page.height - M + 4, { width: W, align: 'center', lineBreak: false });
  }
  return doc;
}

const slug = (s) => String(s || 'design').replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'design';

module.exports = { programme, png, bmp, csv, sheet, slug, ExportError, SYMS, PALETTE };
