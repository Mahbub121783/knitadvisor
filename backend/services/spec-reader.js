'use strict';
/**
 * A spec sheet file -> the rows of cells the spec engine reads (engine/domain/garment-spec.js).
 *
 *   .xlsx            read here (a zip of XML: no library, the file is opened with zlib and its sheets are parsed)
 *   .csv .tsv .txt   split by the delimiter the file uses
 *   .pdf             Mozilla's pdf.js: the text layer, each word with its place on the page; a scanned PDF has none (say so)
 *   .jpg .png .webp  a photograph or a scan: Tesseract OCR, each word with its place; digits that look like letters are put right
 *   .xls             the old binary Excel format is not read (save it as .xlsx or .csv)
 *
 * A cell is { t: text, x0, x1, c: how sure the OCR was (0..1, only for a picture) }. Nothing is stored: the file is read from memory and dropped.
 */
const path = require('path');
const zlib = require('zlib');

const TESSDATA = path.join(__dirname, '..', 'vendor', 'tessdata');
const OCR_ON = String(process.env.SPEC_OCR || 'on').toLowerCase() !== 'off';
const MAX_ROWS = 700, MAX_COLS = 60, MAX_UNZIP = 60 * 1024 * 1024, OCR_TIMEOUT_MS = 100000, IDLE_MS = 4 * 60000;

class SpecReadError extends Error { constructor(msg, code) { super(msg); this.code = code || 'BAD_FILE'; } }

const clean = (s) => String(s == null ? '' : s).replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();

function sniff(buf, name) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 3 || buf[2] === 5)) return 'xlsx';                       // PK: an .xlsx (or any zip: refused later if it has no workbook)
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) return 'xls';
  if (buf.toString('latin1', 0, 5) === '%PDF-') return 'pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpeg';
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  const head = buf.subarray(0, 4096);
  if (head.includes(0)) return null;                                                                              // binary of an unknown kind
  return 'csv';                                                                                                   // plain text: delimited rows
}

// ── .xlsx ──
function unzipper(buf) {
  let e = buf.length - 22; const min = Math.max(0, buf.length - 65557);
  while (e >= min && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < min) throw new SpecReadError('This is not a readable .xlsx file (no zip directory).');
  const total = buf.readUInt16LE(e + 10), cd = buf.readUInt32LE(e + 16), files = {};
  let p = cd;
  for (let i = 0; i < total && i < 4000; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    files[buf.toString('utf8', p + 46, p + 46 + nl)] = { method, csize, usize, lho };
    p += 46 + nl + el + cl;
  }
  let spent = 0;
  return {
    has: (n) => !!files[n], names: () => Object.keys(files),
    read(n) {
      const f = files[n]; if (!f) return null;
      spent += f.usize; if (f.usize > 30 * 1024 * 1024 || spent > MAX_UNZIP) throw new SpecReadError('This workbook is too large to read.');
      const start = f.lho + 30 + buf.readUInt16LE(f.lho + 26) + buf.readUInt16LE(f.lho + 28), data = buf.subarray(start, start + f.csize);
      if (f.method === 0) return data;
      if (f.method !== 8) throw new SpecReadError('This workbook uses a compression this reader does not know.');
      return zlib.inflateRawSync(data, { maxOutputLength: 30 * 1024 * 1024 });
    },
  };
}
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unxml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, g) => (g[0] === '#' ? String.fromCodePoint(g[1].toLowerCase() === 'x' ? parseInt(g.slice(2), 16) : +g.slice(1)) : ENT[g.toLowerCase()] || m));
const colIndex = (ref) => { const m = /^([A-Z]+)/.exec(ref); if (!m) return -1; let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
function textOf(xml) { return [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1])).join(''); }

function readXlsx(buf) {
  const z = unzipper(buf);
  if (!z.has('xl/workbook.xml')) throw new SpecReadError('This zip file is not an Excel workbook.');
  const wb = z.read('xl/workbook.xml').toString('utf8');
  const rels = {}; (z.read('xl/_rels/workbook.xml.rels') || Buffer.alloc(0)).toString('utf8').replace(/<Relationship\b([^>]*)>/g, (m, a) => { const id = /\bId="([^"]*)"/.exec(a), t = /\bTarget="([^"]*)"/.exec(a); if (id && t) rels[id[1]] = t[1]; return m; });
  const shared = z.has('xl/sharedStrings.xml') ? [...z.read('xl/sharedStrings.xml').toString('utf8').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1])) : [];
  const sheets = [];
  [...wb.matchAll(/<sheet\b([^>]*)\/?>/g)].slice(0, 12).forEach((m, idx) => {
    const a = m[1], name = unxml((/\bname="([^"]*)"/.exec(a) || [, `Sheet${idx + 1}`])[1]), rid = (/\br:id="([^"]*)"/.exec(a) || /\bid="([^"]*)"/.exec(a) || [])[1];
    if (/\bstate="(hidden|veryHidden)"/.test(a)) return;
    let target = rels[rid] || `worksheets/sheet${idx + 1}.xml`; target = target.replace(/^\//, ''); if (!target.startsWith('xl/')) target = 'xl/' + target;
    const xml = z.has(target) ? z.read(target).toString('utf8') : null; if (!xml) return;
    const rows = [];
    for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      if (!rm[2]) continue;
      const ri = (/\br="(\d+)"/.exec(rm[1]) || [])[1]; const r = ri ? +ri - 1 : rows.length; if (r >= MAX_ROWS) break;
      const line = [];
      for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const at = cm[1], ref = (/\br="([A-Z]+\d+)"/.exec(at) || [])[1], t = (/\bt="(\w+)"/.exec(at) || [])[1], body = cm[2] || '';
        const ci = ref ? colIndex(ref) : line.length; if (ci < 0 || ci >= MAX_COLS) continue;
        let v = '';
        if (t === 'inlineStr') v = textOf(body);
        else { const vm = /<v>([\s\S]*?)<\/v>/.exec(body); if (vm) { const raw = unxml(vm[1]); v = t === 's' ? (shared[+raw] || '') : t === 'b' ? (raw === '1' ? 'TRUE' : 'FALSE') : t === 'e' ? '' : t === 'str' ? raw : (Number.isFinite(+raw) ? String(+(+raw).toFixed(6)) : raw); } }
        line[ci] = clean(v);
      }
      rows[r] = Array.from(line, (x) => x || '');
    }
    const grid = Array.from(rows, (r) => r || []);
    if (grid.some((r) => r.some((c) => c))) sheets.push({ name, grid });
  });
  if (!sheets.length) throw new SpecReadError('The workbook has no sheet with anything in it.');
  return sheets;
}

// ── .csv / pasted text ──
function parseDelimited(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).slice(0, MAX_ROWS);
  const probe = lines.filter((l) => l.trim()).slice(0, 12), count = (re) => probe.reduce((a, l) => a + (l.match(re) || []).length, 0);
  const cands = [['\t', count(/\t/g)], [';', count(/;/g)], [',', count(/,/g)], ['|', count(/\|/g)]].sort((a, b) => b[1] - a[1]);
  const sep = cands[0][1] > 0 ? cands[0][0] : null;
  return lines.map((l) => {
    if (!sep) return /\S/.test(l) ? l.trim().split(/ {2,}/).map(clean) : [];
    const out = []; let cur = '', q = false;
    for (let i = 0; i < l.length; i++) { const c = l[i]; if (c === '"' && !q && cur === '') q = true; else if (c === '"' && q) q = false; else if (c === sep && !q) { out.push(clean(cur)); cur = ''; } else cur += c; }
    out.push(clean(cur)); return out.slice(0, MAX_COLS);
  });
}

// ── a PDF ──
async function readPdf(buf) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const fonts = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, standardFontDataUrl: fonts, verbosity: 0 }).promise;
  try {
    const rows = []; let chars = 0, yBase = 0;
    for (let n = 1; n <= Math.min(doc.numPages, 8); n++) {
      const page = await doc.getPage(n), vp = page.getViewport({ scale: 1 }), tc = await page.getTextContent();
      const items = tc.items.filter((i) => i.str && i.str.trim()).map((i) => ({ t: i.str, x: i.transform[4], y: i.transform[5], h: Math.abs(i.height) || Math.abs(i.transform[3]) || 8, w: i.width || i.str.length * (Math.abs(i.transform[0]) || 8) * 0.5 }));
      chars += items.reduce((a, i) => a + i.t.length, 0);
      rows.push(...cluster(items.map((i) => ({ t: i.t, x0: i.x, x1: i.x + i.w, yc: yBase - i.y, h: i.h }))));
      yBase += vp.height + 50;
    }
    if (chars < 20) throw new SpecReadError('This PDF has no text in it (it is a scan or a picture). Save the page as a JPG or PNG and upload that: the picture is read by OCR.', 'NO_TEXT');
    return { rows, pages: doc.numPages };
  } finally { doc.destroy(); }
}
// words with a place -> rows of cells: the same line when the middles are within half a line's height; the same cell when the gap is a space
function cluster(words) {
  if (!words.length) return [];
  const hs = words.map((w) => w.h).sort((a, b) => a - b), med = hs[Math.floor(hs.length / 2)] || 8;
  const sorted = words.slice().sort((a, b) => a.yc - b.yc);
  const lines = []; let cur = [sorted[0]], ref = sorted[0].yc;
  for (let i = 1; i < sorted.length; i++) { const w = sorted[i]; if (Math.abs(w.yc - ref) <= med * 0.55) { cur.push(w); ref = cur.reduce((a, q) => a + q.yc, 0) / cur.length; } else { lines.push(cur); cur = [w]; ref = w.yc; } }
  lines.push(cur);
  return lines.slice(0, MAX_ROWS).map((ln) => {
    ln.sort((a, b) => a.x0 - b.x0);
    const cells = []; let c = null;
    ln.forEach((w) => {
      const gap = c ? w.x0 - c.x1 : Infinity, hh = Math.max(med, w.h);
      if (c && gap < hh * 0.55) { c.t += (gap > hh * 0.08 ? ' ' : '') + w.t; c.x1 = Math.max(c.x1, w.x1); c.c = c.c == null || w.c == null ? c.c : Math.min(c.c, w.c); }
      else { c = { t: w.t, x0: w.x0, x1: w.x1, c: w.c }; cells.push(c); }
    });
    return cells.map((q) => ({ t: clean(q.t), x0: Math.round(q.x0 * 10) / 10, x1: Math.round(q.x1 * 10) / 10, c: q.c })).filter((q) => q.t);
  }).filter((r) => r.length);
}

// ── a picture ──
let worker = null, workerP = null, idle = null;
function ocrWorker() {
  if (worker) return Promise.resolve(worker);
  if (!workerP) {
    const { createWorker } = require('tesseract.js');
    workerP = createWorker('eng', 1, { langPath: TESSDATA, gzip: false, cacheMethod: 'none', logger: () => {}, errorHandler: () => {} })
      .then(async (w) => { await w.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' }); worker = w; workerP = null; return w; })
      .catch((e) => { workerP = null; throw e; });
  }
  return workerP;
}
function touchIdle() { clearTimeout(idle); idle = setTimeout(() => { if (worker) { worker.terminate().catch(() => {}); worker = null; } }, IDLE_MS); if (idle.unref) idle.unref(); }
async function stopOcr() { clearTimeout(idle); if (worker) { await worker.terminate().catch(() => {}); worker = null; } }

// a digit read as a letter: 2O -> 20, l7 -> 17, S2 -> 52, B -> 8 (only in a token that is mostly digits)
function fixDigits(t) {
  const s = t.trim(); if (s.length > 9 || !/\d/.test(s)) return t;
  const keep = (s.match(/[0-9/.,"\-+ ]/g) || []).length; if (keep / s.length < 0.5) return t;
  return s.replace(/[Oo°]/g, '0').replace(/[lI|!]/g, '1').replace(/S(?=[\d/.])|(?<=[\d/.])S/g, '5').replace(/(?<=[\d/.])B|B(?=[\d/.])/g, '8').replace(/Z(?=[\d/.])|(?<=[\d/.])Z/g, '2');
}
// the size of a PNG or a JPEG from its header, before anything is decoded (a small file can hold a picture that is gigabytes in memory)
function pixels(buf) {
  if (buf[0] === 0x89) return buf.length > 24 ? [buf.readUInt32BE(16), buf.readUInt32BE(20)] : null;
  let p = 2;
  while (p + 9 < buf.length) {
    if (buf[p] !== 0xff) { p++; continue; }
    const m = buf[p + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [buf.readUInt16BE(p + 7), buf.readUInt16BE(p + 5)];
    p += 2 + buf.readUInt16BE(p + 2);
  }
  return null;
}
async function readImage(buf, kind) {
  if (!OCR_ON) throw new SpecReadError('Reading pictures is switched off on this server. Upload the Excel or PDF file instead.', 'OCR_OFF');
  let png = buf;
  if (kind !== 'webp') {                                                                    // a WebP goes to the OCR as it is (the image library does not read it)
    const dim = pixels(buf);
    if (dim && dim[0] * dim[1] > 40e6) throw new SpecReadError('This picture is too large (over 40 megapixels). Save a smaller copy and upload that.', 'TOO_LARGE');
    const Jimp = require('jimp');
    let img; try { img = await Jimp.read(buf); } catch (e) { throw new SpecReadError('This picture could not be opened.'); }
    const w0 = img.bitmap.width;
    if (w0 < 1400) img.scale(Math.min(3, 2000 / w0)); else if (w0 > 3000) img.resize(3000, Jimp.AUTO);
    img.greyscale().normalize().contrast(0.25);
    png = await img.getBufferAsync(Jimp.MIME_PNG);
  }
  const w = await ocrWorker(); touchIdle();
  const r = await Promise.race([w.recognize(png, { rotateAuto: true }, { text: true, blocks: true }), new Promise((_, rej) => { const t = setTimeout(() => rej(new SpecReadError('Reading the picture took too long: try a sharper, straighter photo, or a smaller one.', 'TIMEOUT')), OCR_TIMEOUT_MS); if (t.unref) t.unref(); })]);
  const flat = [];
  const take = (ws) => (ws || []).forEach((q) => { if (q && q.text && q.bbox) flat.push(q); });
  if (r.data.words && r.data.words.length) take(r.data.words);
  else (r.data.blocks || []).forEach((b) => (b.paragraphs || []).forEach((p) => (p.lines || []).forEach((l) => take(l.words))));
  const words = flat.filter((q) => clean(q.text)).map((q) => ({ t: fixDigits(clean(q.text)), x0: q.bbox.x0, x1: q.bbox.x1, yc: (q.bbox.y0 + q.bbox.y1) / 2, h: Math.max(4, q.bbox.y1 - q.bbox.y0), c: Math.max(0, Math.min(1, (q.confidence || 0) / 100)) }));
  if (words.length < 6) throw new SpecReadError('Almost no text could be read from this picture. Try a sharper photo taken straight on, in good light.', 'NO_TEXT');
  return { rows: cluster(words), confidence: Math.round(words.reduce((a, q) => a + q.c, 0) / words.length * 100) / 100 };
}

/**
 * @returns {Promise<{kind, sheets:[{name, grid?:string[][], rows:[[{t,x0,x1,c}]]}], method, confidence, pages}>}
 */
async function readFile(buf, name) {
  const t0 = Date.now(), kind = sniff(buf, name);
  if (!kind) throw new SpecReadError('This file type is not one this reader knows. Upload an Excel (.xlsx), CSV, PDF, or a JPG / PNG picture.', 'BAD_TYPE');
  if (kind === 'xls') throw new SpecReadError('This is an old Excel file (.xls). Open it in Excel and save it as .xlsx (or .csv), then upload that.', 'OLD_XLS');
  const denseRows = (grid) => grid.map((r) => r.map((t, ci) => ({ t, x0: ci * 100, x1: ci * 100 + 90, c: 1 })).filter((c) => c.t !== ''));
  if (kind === 'xlsx') {
    let sheets; try { sheets = readXlsx(buf); } catch (e) { throw e instanceof SpecReadError ? e : new SpecReadError('This workbook could not be opened: it is damaged or not an .xlsx file.'); }
    return { kind, method: 'workbook', confidence: 1, pages: null, sheets: sheets.map((s) => ({ name: s.name, grid: s.grid, rows: denseRows(s.grid) })), ms: Date.now() - t0 };
  }
  if (kind === 'csv') { const grid = parseDelimited(buf.toString('utf8').includes('�') ? buf.toString('latin1') : buf.toString('utf8')); return { kind, method: 'text', confidence: 1, pages: null, sheets: [{ name: 'text', grid, rows: denseRows(grid) }], ms: Date.now() - t0 }; }
  if (kind === 'pdf') { let r; try { r = await readPdf(buf); } catch (e) { throw e instanceof SpecReadError ? e : new SpecReadError('This PDF could not be opened: it is damaged or protected with a password.'); } return { kind, method: 'pdf-text', confidence: 1, pages: r.pages, sheets: [{ name: 'pdf', rows: r.rows }], ms: Date.now() - t0 }; }
  const r = await readImage(buf, kind);
  return { kind: 'image', method: 'ocr', confidence: r.confidence, pages: 1, sheets: [{ name: 'picture', rows: r.rows }], ms: Date.now() - t0 };
}

module.exports = { readFile, readXlsx, parseDelimited, cluster, sniff, fixDigits, stopOcr, SpecReadError, MAX_ROWS };
