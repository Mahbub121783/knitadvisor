/**
 * Student verification v2 — reading the document and deciding.
 *
 * Reading happens on this server, with no outside service:
 *   * a PDF: its text layer (pdf-parse); a scan with no text says so
 *   * a photo (JPEG / PNG): rotated upright from its EXIF, re-saved without
 *     its metadata (a phone photo carries GPS), fingerprinted (SHA-256 of the
 *     file, a 64-bit difference hash of the picture), scanned for a QR code,
 *     then read by Tesseract OCR in English and Bengali — tried sideways too
 *     when the first pass reads little
 *   * WebP: OCR only (the image library cannot decode it)
 *
 * One document is read at a time (a queue), so a burst of uploads cannot eat
 * the server's memory; the OCR engine is started on first use and shut after
 * a few idle minutes. STUDENT_OCR=off turns OCR off: the application then
 * goes to an admin, never through on a document nobody read.
 *
 * evaluate() is the single place a pending application is decided — after a
 * code, after a document is read, after details change — from the rules in
 * engine/domain/student-verify.js.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sv = require('../engine/domain/student-verify');
const studentRepo = require('../db/repositories/student-repo');
const universityRepo = require('../db/repositories/university-repo');
const userRepo = require('../db/repositories/user-repo');
const mailClient = require('../mail/client');
const { absolutePath } = require('../middleware/upload');

const TESSDATA = path.join(__dirname, '..', 'vendor', 'tessdata');
const OCR_ON = String(process.env.STUDENT_OCR || 'on').toLowerCase() !== 'off';
const READ_TIMEOUT_MS = 120000;
const IDLE_MS = 4 * 60000;

// ── OCR engine, started on demand ─────────────────────────────────────
let worker = null, workerP = null, idle = null;
function ocrWorker() {
  if (worker) return Promise.resolve(worker);
  if (!workerP) {
    const { createWorker } = require('tesseract.js');
    workerP = createWorker(['eng', 'ben'], 1, { langPath: TESSDATA, gzip: false, cacheMethod: 'none', logger: () => {}, errorHandler: () => {} })
      .then((w) => { worker = w; workerP = null; return w; })
      .catch((e) => { workerP = null; throw e; });
  }
  return workerP;
}
function touchIdle() {
  clearTimeout(idle);
  idle = setTimeout(() => { if (worker) { worker.terminate().catch(() => {}); worker = null; } }, IDLE_MS);
  if (idle.unref) idle.unref();
}
async function stopOcr() { clearTimeout(idle); if (worker) { await worker.terminate().catch(() => {}); worker = null; } }

async function ocr(buf) {
  const w = await ocrWorker();
  touchIdle();
  const r = await w.recognize(buf, {}, { text: true, blocks: true });
  // characters in words read with confidence: tells an upright page from a sideways one
  const good = (r.data.words || []).filter((x) => x.confidence >= 75 && /[A-Za-z0-9ঀ-৿]{2,}/.test(x.text)).reduce((t, x) => t + x.text.length, 0);
  return { text: r.data.text || '', confidence: r.data.confidence || 0, good };
}

// 64-bit difference hash: survives re-compression and resizing, changes with content
function dHash(img) {
  const g = img.clone().greyscale().resize(9, 8);
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += g.getPixelColor(x, y) > g.getPixelColor(x + 1, y) ? '1' : '0';
  return bits.match(/.{4}/g).map((b) => parseInt(b, 2).toString(16)).join('');
}

/**
 * Reads one stored document.
 * @returns {Promise<{mime, sha256, phash, text, method, confidence, qr, pages, ms, cleaned}>}
 */
async function readDocument(absPath) {
  const t0 = Date.now();
  const buf = fs.readFileSync(absPath);
  const mime = sv.sniffMime(buf);
  if (!mime) throw Object.assign(new Error('not a JPEG, PNG, WebP or PDF file'), { code: 'BAD_TYPE' });
  const out = { mime, sha256: crypto.createHash('sha256').update(buf).digest('hex'), phash: null, text: '', method: 'none', confidence: null, qr: null, pages: null, ms: 0, cleaned: false };

  if (mime === 'application/pdf') {
    // Mozilla's PDF reader: the text layer only — no scripts, no fonts fetched
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const fonts = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true,
      useSystemFonts: false, standardFontDataUrl: fonts, verbosity: 0 }).promise;
    try {
      const parts = [];
      for (let n = 1; n <= Math.min(doc.numPages, 5); n++) {
        const tc = await (await doc.getPage(n)).getTextContent();
        parts.push(tc.items.map((i) => (i.str || '') + (i.hasEOL ? '\n' : ' ')).join(''));
      }
      out.text = parts.join('\n').replace(/[ \t]+\n/g, '\n').slice(0, 20000);
      out.pages = doc.numPages;
    } finally { doc.destroy(); }
    out.method = 'pdf-text';
  } else if (mime === 'image/webp') {
    if (OCR_ON) { const r = await ocr(buf); out.text = r.text; out.confidence = r.confidence; out.method = 'ocr'; }
  } else {
    const Jimp = require('jimp');
    const img = await Jimp.read(buf); // EXIF orientation applied here
    if (img.bitmap.width > 2400 || img.bitmap.height > 2400) img.scaleToFit(2400, 2400);
    // the stored copy loses its metadata (location, device) and keeps the picture
    const clean = await img.clone().quality(88).getBufferAsync(mime === 'image/png' ? Jimp.MIME_PNG : Jimp.MIME_JPEG);
    fs.writeFileSync(absPath, clean);
    out.cleaned = true;
    out.phash = dHash(img);
    try {
      const jsQR = require('jsqr');
      const q = img.clone();
      if (q.bitmap.width > 1200) q.scaleToFit(1200, 1200);
      const code = jsQR(new Uint8ClampedArray(q.bitmap.data), q.bitmap.width, q.bitmap.height);
      if (code && code.data) out.qr = String(code.data).slice(0, 500);
    } catch (_) { /* no QR is the usual case */ }
    if (OCR_ON) {
      const prep = img.clone().greyscale().normalize().contrast(0.2);
      if (prep.bitmap.width < 1400) prep.scale(1400 / prep.bitmap.width);
      let best = await ocr(await prep.getBufferAsync(Jimp.MIME_PNG));
      // a card photographed sideways reads as noise; try it turned
      if (best.good < 40) {
        for (const deg of [270, 90, 180]) {
          const r = await ocr(await prep.clone().rotate(deg).getBufferAsync(Jimp.MIME_PNG));
          if (r.good > best.good) best = r;
          if (best.good >= 60) break;
        }
      }
      out.text = best.text; out.confidence = best.confidence; out.method = 'ocr';
    }
  }
  out.ms = Date.now() - t0;
  return out;
}

// ── deciding ──────────────────────────────────────────────────────────
function mailUser(user, build, args) {
  if (!user || !user.email) return;
  const t = require('../mail/templates')[build]({ fullName: user.full_name, ...args });
  mailClient.sendMail({ to: user.email, subject: t.subject, html: t.html, text: t.text }).catch(() => {});
}

/** The document's findings, measured again against what the application says now. */
async function analysisFor(row, user) {
  const read = row.doc_check && row.doc_check.read;
  if (!read) return null;
  const uni = await universityRepo.namesFor(row.university_id, row.university_name);
  return sv.analyseDocument({ text: row.doc_text || '', method: read.method, confidence: read.confidence, qr: read.qr },
    { fullName: user.full_name, universityNames: uni.names.length ? uni.names : [row.university_name], domains: uni.domains, studentId: row.student_id });
}

/**
 * Re-scores an application and, while it is pending, decides it.
 * @returns {Promise<{status: string, decision?: object}>}
 */
async function evaluate(id, { notify = false } = {}) {
  let row = await studentRepo.findById(id);
  if (!row) return { status: 'missing' };
  const user = await userRepo.users.findById(row.user_id);
  if (!user) return { status: row.status };
  const uni = row.university_id ? await universityRepo.findById(row.university_id) : null;
  const pathKind = row.renewal_of ? 'renewal' : row.university_id ? 'listed' : 'other';

  const analysis = await analysisFor(row, user);
  if (analysis) {
    await studentRepo.saveReading(id, { state: row.doc_state, sha256: row.doc_sha256, phash: row.doc_phash, text: row.doc_text,
      check: { ...row.doc_check, analysis, score: analysis.score, verdict: analysis.verdict } });
  }
  const sig = await studentRepo.signals(row);
  const codeStats = await userRepo.codes.recentStats(row.user_id, 'student_email', 24 * 60);
  const risk = sv.assessRisk({
    dupDocOtherAccount: sig.shaOther > 0,
    nearDupDocOtherAccount: !!row.doc_phash && sig.phashes.some((p) => sv.hamming(p, row.doc_phash) <= 6),
    emailUsedByOtherAccount: sig.emailOther > 0,
    studentIdUsedByOtherAccount: sig.studentIdOther > 0,
    sameNetworkApplications: sig.sameNetwork,
    accountAgeHours: user.created_at ? (Date.now() - new Date(user.created_at).getTime()) / 3600000 : null,
    failedCodes: codeStats ? codeStats.wrong : 0,
    domainKind: uni ? uni.kind : null,
    emailChanges: row.email_changes,
    analysis: row.document_path && row.doc_state === 'done' ? analysis : null,
  });
  const d = sv.decide({
    path: pathKind, emailVerified: !!row.student_email_verified_at, hasDocument: !!row.document_path,
    docState: row.doc_state === 'failed' ? 'done' : row.doc_state, domainKind: uni ? uni.kind : null,
    analysis: row.doc_state === 'done' ? analysis : null, risk,
  });
  await studentRepo.saveRisk(id, { ...risk, decision: d.why, recommend: d.recommend || null }, null);
  if (row.status !== 'pending') return { status: row.status, decision: d };

  if (d.status === 'active') {
    const { expiresAt, basis } = sv.expiryFor({ gradYear: row.grad_year, validUntil: analysis && analysis.valid_until });
    if (pathKind === 'renewal') {
      const prev = row.renewal_of ? await studentRepo.findById(row.renewal_of) : null;
      if (prev && prev.status === 'active') await studentRepo.decide(prev.id, 'expired', { decidedBy: 'renewed', reason: 'renewed', expiresAt: prev.expires_at });
      await require('../db/client').query('UPDATE app_student_verifications SET student_email_norm = $2 WHERE id = $1', [id, sv.normalizeStudentEmail(row.student_email)]);
    }
    await studentRepo.decide(id, 'active', { decidedBy: 'auto', expiresAt, reason: basis === 'one year' ? null : 'until ' + basis });
    await studentRepo.saveRisk(id, { ...risk, decision: d.why, recommend: d.recommend || null }, d.review);
    await userRepo.users.setStudentStatus(user.id, 'active', expiresAt);
    mailUser(user, 'studentApprovedEmail', { expiresAt });
    return { status: 'active', decision: d, expires_at: expiresAt };
  }
  if (d.status === 'pending' && notify) {
    await userRepo.users.setStudentStatus(user.id, 'pending', null);
    mailUser(user, 'studentPendingReviewEmail', {});
  }
  return { status: 'pending', decision: d };
}

// ── the reading queue ─────────────────────────────────────────────────
const queue = [];
const waiters = new Map();
let busy = false;

function withTimeout(p, ms) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error('reading took too long'), { code: 'TIMEOUT' })), ms); })])
    .finally(() => clearTimeout(t));
}

async function processOne(id) {
  const row = await studentRepo.findById(id);
  if (!row || !row.document_path || row.status !== 'pending') return;
  await studentRepo.setDocState(id, 'checking');
  let state = 'done', r = null, err = null;
  try {
    r = await withTimeout(readDocument(absolutePath(row.document_path)), READ_TIMEOUT_MS);
  } catch (e) {
    err = e; state = 'failed';
    if (e.code === 'TIMEOUT') await stopOcr();
    console.error('[student-docs] reading', id, 'failed:', e.message);
  }
  await studentRepo.saveReading(id, {
    state, sha256: r && r.sha256, phash: r && r.phash, text: r ? r.text : null,
    check: { read: r ? { method: r.method, confidence: r.confidence, qr: r.qr, pages: r.pages, ms: r.ms, mime: r.mime, cleaned: r.cleaned, ocr: OCR_ON } : { method: 'none', error: err && err.message } },
  });
  if (r && r.mime) await require('../db/client').query('UPDATE app_student_verifications SET doc_mime = $2 WHERE id = $1', [id, r.mime]);
  return evaluate(id, { notify: true });
}

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const id = queue.shift();
    let res = null;
    try { res = await processOne(id); } catch (e) { console.error('[student-docs] queue', id, e.message); }
    const ws = waiters.get(id) || [];
    waiters.delete(id);
    ws.forEach((w) => w(res));
  }
  busy = false;
}

/** Puts a document in the reading queue; resolves with the outcome, or after `waitMs` with null. */
function enqueue(id, waitMs = 0) {
  if (!queue.includes(id)) queue.push(id);
  const p = new Promise((resolve) => {
    const ws = waiters.get(id) || [];
    ws.push(resolve);
    waiters.set(id, ws);
    if (waitMs) setTimeout(() => resolve(null), waitMs).unref?.();
  });
  setImmediate(pump);
  return p;
}

/** After a restart: documents left mid-read go back in the queue. */
async function resume() {
  try {
    const rows = await studentRepo.unread();
    rows.forEach((r) => enqueue(r.id));
    return rows.length;
  } catch (e) { console.error('[student-docs] resume failed:', e.message); return 0; }
}

module.exports = { readDocument, evaluate, enqueue, resume, stopOcr, dHash, OCR_ON, queueLength: () => queue.length + (busy ? 1 : 0) };
