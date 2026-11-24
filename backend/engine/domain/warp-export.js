/**
 * Warp-knit machine files from a warp Studio answer — what the knitting floor takes away from the screen.
 *
 *   set-up sheet (PDF)   one printable A4: machine and quality, every guide bar (lapping, threading, yarn, runner), the lapping drawn on point paper,
 *                        the pattern-chain links and shog of every course, the beams and let-off, the wet route, the cloth in every state, the gates
 *   lapping chart (CSV)  the same, as rows: per bar and course the guide positions, overlap, underlap, shog in mm and the chain links; the threading; the beams
 *
 * Drawn from the SAME analyse() answer the page shows; nothing here is a second calculation and nothing here is money.
 */
'use strict';
const PDFDocument = require('pdfkit');

class WarpExportError extends Error {}
const INK = '#1a1f2b', MUTED = '#5b6473', LINE = '#c9ced8', BAND = '#eef1f6', ACCENT = '#1857C4';
const BAR_COL = ['#1857C4', '#c2410c', '#0f9d76', '#7a4fc2', '#b8860b', '#0e7490', '#be185d', '#4d7c0f'];
const latin = (t) => String(t == null ? '' : t).replace(/[^\x20-\x7e]/g, (c) => ({ '×': 'x', '÷': '/', '°': ' deg', '≈': '~', '–': '-', '—': '-', '−': '-', '√': 'sqrt', 'π': 'pi', '≤': '<=', '≥': '>=', '→': '->', '±': '+/-', '’': "'", 'µ': 'u', '²': '2', '³': '3', '½': '1/2' }[c] || ''));
const cell = (v) => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const line = (a) => a.map(cell).join(',');
const slug = (s) => String(s || 'warp').replace(/[^\w\-]+/g, '_').slice(0, 40) || 'warp';

function need(out) {
  if (!out || out.tech !== 'warp' || !out.success) throw new WarpExportError('Analyse a warp design first.');
  if (out.gates && out.gates.export_locked) {
    const f = out.gates.rules.filter((r) => r.status === 'fatal');
    throw new WarpExportError('This design does not knit as drawn, so the machine files are locked until it is fixed: ' + (f[0] ? f[0].text : (out.checks.find((c) => c.level === 'error') || {}).text));
  }
}

function lappingCsv(out, name) {
  need(out);
  const L = [], M = out.machine, F = out.fabric;
  L.push(line(['KnitAdvisor - warp lapping chart', name || '']));
  L.push(line(['Machine', M.label, 'gauge', 'E' + M.gauge, 'needles', M.needles, 'width on the machine (in)', M.width_in, 'speed (courses/min)', M.speed_cpm, 'quality (courses/cm)', M.cpc_machine]));
  L.push(line(['Finished', F.gsm + ' GSM', F.width_in + ' in', F.wpc + ' wales/cm', F.cpc + ' courses/cm']));
  L.push('');
  L.push(line(['Guide bar', 'Lapping', 'Threading', 'Yarn', 'Runner (mm/rack)', 'Run-in (mm/rack)', 'Ends', 'Chain links']));
  out.bars.forEach((b, i) => L.push(line([b.bar, b.notation, b.threading, b.yarn + ' ' + b.fibre, b.runner_mm_per_rack, b.fed_mm_per_rack, b.ends, out.drive ? out.drive.bars[i].chain_links : ''])));
  L.push('');
  L.push(line(['Pattern chain and shog, course by course (needle spaces; shog = underlap x needle pitch)']));
  L.push(line(['Bar', 'Course', 'From', 'To', 'Overlap', 'Underlap', 'Shog (mm)', 'Chain link 1', 'Chain link 2']));
  if (out.drive) out.drive.bars.forEach((b) => b.courses.forEach((c) => L.push(line([b.bar, c.course, c.from, c.to, c.overlap, c.underlap, c.shog_mm, c.chain[0], c.chain[1]]))));
  if (out.drive) { L.push(''); L.push(line(['Longest shog', out.drive.longest_shog_needles + ' needles', out.drive.longest_shog_mm + ' mm', 'bar ' + out.drive.longest_shog_bar, 'speed allowed (courses/min, modelled)', out.drive.speed_allowed_cpm])); }
  if (out.beams) {
    L.push(''); L.push(line(['Beams: ' + out.beams.beams_per_bar + ' section beams per bar', out.beams.flange_in + ' in flange', out.beams.barrel_in + ' in barrel', out.beams.width_in + ' in wide', 'a full set runs ' + out.beams.set_hours + ' h']));
    L.push(line(['Bar', 'Ends per beam', 'kg per beam', 'Warp length (m)', 'Let-off (m/min)', 'Full beam lasts (h)']));
    out.beams.per_bar.forEach((x) => L.push(line([x.bar, x.ends_per_beam, x.kg_per_beam, x.warp_length_m != null ? x.warp_length_m : '', x.let_off_m_per_min != null ? x.let_off_m_per_min : '', x.hours != null ? x.hours : ''])));
  }
  if (out.chemistry && out.chemistry.success) {
    L.push(''); L.push(line(['Wet route (' + out.chemistry.shade + ' shade)']));
    out.chemistry.route.forEach((s, i) => L.push(line([i + 1, s.label, s.t_c ? s.t_c + ' C' : '', s.time_min ? s.time_min + ' min' : '', s.ph ? 'pH ' + s.ph : '', (s.chemicals || []).join('; ')])));
    out.chemistry.dyes.forEach((d) => L.push(line(['Dye', d.class, d.owf_pct + ' % owf', 'fixation ' + d.fixation_pct + ' %'])));
  }
  if (out.states) { L.push(''); L.push(line(['State', 'Wales/cm', 'Courses/cm', 'GSM', 'Width (in)'])); out.states.states.forEach((s) => L.push(line([s.label, s.wpc, s.cpc, s.gsm, s.width_in]))); }
  L.push(''); L.push(line(['The runner, run-in and shog are arithmetic on the lapping; the greige and washed states are typical figures for the class of cloth.']));
  return '﻿' + L.join('\r\n') + '\r\n';
}

/** the lapping on point paper: needles across, courses up, one colour per bar; the repeat drawn twice so the underlap that closes it is seen */
function drawLapping(doc, out, x0, y0, w, h) {
  const bars = out.lapping, maxN = Math.max(6, ...bars.flatMap((b) => b.pairs.flat())) + 2, reps = 2;
  const rows = Math.max(...bars.map((b) => b.pairs.length)) * reps, dx = Math.min(16, w / (maxN + 1)), dy = Math.min(12, h / (rows + 1));
  doc.save();
  doc.lineWidth(0.3).strokeColor(LINE);
  for (let k = 0; k <= rows; k++) for (let n = 0; n <= maxN; n++) doc.circle(x0 + n * dx, y0 + h - k * dy, 0.7).fillColor(MUTED).fill();
  bars.forEach((b, bi) => {
    const P = b.pairs, n = P.length, col = BAR_COL[bi % 8];
    doc.lineWidth(1.1).strokeColor(col);
    for (let k = 0; k < n * reps; k++) {
      const [a, z] = P[k % n], [na] = P[(k + 1) % n], X = (v) => x0 + v * dx, Y = (r) => y0 + h - r * dy;
      doc.moveTo(X(a), Y(k)).lineTo(X(z), Y(k)).stroke();
      doc.moveTo(X(z), Y(k)).lineTo(X(na), Y(k + 1)).stroke();
    }
  });
  doc.restore();
  return { dx, dy, rows, maxN };
}

function sheet(out, o = {}) {
  need(out);
  const M = 36, doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true, info: { Title: latin(`Warp set-up sheet ${o.name || ''}`).trim(), Creator: 'KnitAdvisor' } });
  const W = doc.page.width - M * 2, bottom = () => doc.page.height - M - 14;
  const needH = (h) => { if (doc.y + h > bottom()) doc.addPage(); };
  const title = (t, h = 40) => { needH(h); doc.moveDown(0.6); doc.font('Helvetica-Bold').fontSize(10.5).fillColor(ACCENT).text(latin(t), M, doc.y); doc.moveTo(M, doc.y + 1).lineTo(M + W, doc.y + 1).strokeColor(ACCENT).lineWidth(0.6).stroke(); doc.moveDown(0.4); };
  const para = (t, c = MUTED, size = 8.5) => { needH(14); doc.font('Helvetica').fontSize(size).fillColor(c).text(latin(t), M, doc.y, { width: W }); };
  const table = (cols, rows) => {
    const rh = 14.5, draw = (cells, head) => {
      needH(rh + 2);
      const y = doc.y;
      if (head) doc.rect(M, y, W, rh).fill(BAND);
      let x = M;
      cells.forEach((t, i) => { doc.font(head ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor(head ? MUTED : INK).text(latin(t), x + 3, y + 3.5, { width: cols[i].w - 6, lineBreak: false, ellipsis: true }); x += cols[i].w; });
      doc.moveTo(M, y + rh).lineTo(M + W, y + rh).strokeColor(LINE).lineWidth(0.4).stroke();
      doc.y = y + rh;
    };
    draw(cols.map((c) => c.h), true);
    rows.forEach((r) => draw(r, false));
    doc.moveDown(0.2);
  };
  const mc = out.machine, f = out.fabric;
  doc.font('Helvetica-Bold').fontSize(17).fillColor(ACCENT).text('WARP KNIT SET-UP SHEET', M, M);
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(`KnitAdvisor  -  printed ${new Date().toISOString().slice(0, 10)}`, M, M + 22);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(latin(o.name || out.structure.name || 'Warp design'), M, M + 36, { width: W });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(latin(`${out.structure.bars} guide bar${out.structure.bars > 1 ? 's' : ''}, ${out.structure.repeat_courses}-course repeat  |  ${mc.label}  |  E${mc.gauge}, ${mc.needles} needles, ${mc.width_in} in on the machine`), M, M + 54, { width: W });
  doc.y = M + 72;

  title('Quality and output');
  table([{ h: 'Quality (courses/cm, machine)', w: W * 0.25 }, { h: 'Speed (courses/min)', w: W * 0.2 }, { h: 'Output (m/h, finished)', w: W * 0.2 }, { h: 'kg/h', w: W * 0.15 }, { h: 'Finished', w: W * 0.2 }],
    [[mc.cpc_machine + ' (' + mc.cpc_source + ')', mc.speed_cpm, mc.finished_m_per_hour, mc.kg_per_hour, `${f.gsm} GSM, ${f.width_in} in`]]);
  title('Guide bars');
  table([{ h: 'Bar', w: 30 }, { h: 'Lapping', w: W * 0.26 }, { h: 'Threading', w: 52 }, { h: 'Yarn', w: W * 0.2 }, { h: 'Runner mm/rack', w: 70 }, { h: 'Run-in', w: 52 }, { h: 'Ends', w: 42 }, { h: 'Links', w: W - 30 - W * 0.26 - 52 - W * 0.2 - 70 - 52 - 42 }],
    out.bars.map((b, i) => ['GB' + b.bar, b.notation, b.threading, `${b.yarn} ${b.fibre}`, b.runner_mm_per_rack, b.fed_mm_per_rack, b.ends, out.drive ? out.drive.bars[i].chain_links : '']));
  title('Lapping on point paper (the repeat drawn twice)', 150);
  const y0 = doc.y + 4, d = drawLapping(doc, out, M + 8, y0, W - 16, 120);
  doc.y = y0 + 126;
  if (out.drive) {
    title('Pattern chain and shog');
    para(`Two chain links per course per bar; the longest shog is ${out.drive.longest_shog_needles} needle${out.drive.longest_shog_needles === 1 ? '' : 's'} (${out.drive.longest_shog_mm} mm, bar ${out.drive.longest_shog_bar}); this class allows about ${out.drive.speed_allowed_cpm} courses/min for it (modelled), the machine is set at ${out.drive.speed_cpm}.`);
    table([{ h: 'Bar', w: 36 }, { h: 'Chain (links in order)', w: W - 36 - 90 }, { h: 'Chain links', w: 54 }, { h: 'Longest shog', w: 36 }], out.drive.bars.map((b) => ['GB' + b.bar, b.chain, b.chain_links, b.max_underlap + ' n']));
  }
  if (out.beams) {
    title('Beams and let-off');
    para(`${out.beams.beams_per_bar} section beams per bar, ${out.beams.flange_in} in flange x ${out.beams.barrel_in} in barrel x ${out.beams.width_in} in wide. A full set runs ${out.beams.set_hours} h.`);
    table([{ h: 'Bar', w: 36 }, { h: 'Ends / beam', w: 70 }, { h: 'kg / beam (full)', w: 90 }, { h: 'Let-off m/min', w: 80 }, { h: 'Run-in mm/rack', w: W - 276 }], out.beams.per_bar.map((x) => ['GB' + x.bar, x.ends_per_beam, x.kg_per_beam, x.let_off_m_per_min != null ? x.let_off_m_per_min : '', x.runin_mm_per_rack != null ? x.runin_mm_per_rack : '']));
  }
  if (out.chemistry && out.chemistry.success) {
    title('Wet route (' + out.chemistry.shade + ' shade)');
    table([{ h: '#', w: 20 }, { h: 'Step', w: W * 0.34 }, { h: 'Temp', w: 50 }, { h: 'Time', w: 50 }, { h: 'pH', w: 36 }, { h: 'Chemicals', w: W - 20 - W * 0.34 - 136 }], out.chemistry.route.map((s, i) => [i + 1, s.label, s.t_c ? s.t_c + ' C' : '', s.time_min ? s.time_min + ' min' : '', s.ph || '', (s.chemicals || []).join('; ')]));
    out.chemistry.dyes.forEach((dy) => para(`Dye: ${dy.class}, ${dy.owf_pct} % on the weight of yarn, fixation ${dy.fixation_pct} %.`));
  }
  if (out.states) {
    title('The cloth in every state');
    table([{ h: 'State', w: W * 0.46 }, { h: 'Wales/cm', w: 60 }, { h: 'Courses/cm', w: 66 }, { h: 'GSM', w: 50 }, { h: 'Width (in)', w: W - W * 0.46 - 176 }], out.states.states.map((s) => [s.label, s.wpc, s.cpc, s.gsm, s.width_in]));
  }
  if (out.gates) {
    title('Gates');
    table([{ h: 'Rule', w: 54 }, { h: 'Status', w: 46 }, { h: 'What it says', w: W - 100 }], out.gates.rules.map((r) => [r.id, r.status, r.text]));
  }
  title('First roll (fill in and log back into the Studio)');
  table([{ h: 'Quality set (courses/cm)', w: W / 4 }, { h: 'Finished GSM', w: W / 4 }, { h: 'Finished width (in)', w: W / 4 }, { h: 'Runner measured (mm/rack, per bar)', w: W / 4 }], [['', '', '', ''], ['', '', '', '']]);
  para('The runner, run-in and shog are arithmetic on the lapping; greige and washed states are typical figures for the class of cloth. A finished roll measured on your machine replaces them (Trial rolls).');
  const n = doc.bufferedPageRange().count;
  for (let i = 0; i < n; i++) { doc.switchToPage(i); doc.page.margins.bottom = 0; doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(`KnitAdvisor - ${latin(o.name || out.structure.name || '')} - page ${i + 1} of ${n}`, M, doc.page.height - M + 4, { width: W, align: 'center', lineBreak: false }); }
  return doc;
}

module.exports = { lappingCsv, sheet, slug, WarpExportError };
