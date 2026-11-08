/**
 * Student verification v2 — the rules, pure (no I/O).
 *
 * Proof comes from three independent places, and none of them alone opens the
 * plan:
 *
 *   1. the university email: an allow-listed domain (matched exactly, never a
 *      suffix) whose inbox answered a code;
 *   2. the document: read on our own server (PDF text layer, or OCR of the
 *      photo), then checked against the account — the name, the university,
 *      the student ID typed, a validity date not in the past, words a student
 *      card or admission letter carries, a QR code pointing at the university;
 *   3. the circumstances: the same email, ID or card on another account, many
 *      applications from one network, a brand-new account, failed codes.
 *
 * analyseDocument() turns the text into findings with a 0-100 score,
 * assessRisk() turns the circumstances into a 0-100 risk with its reasons, and
 * decide() combines them: approve now, approve and queue for an admin's look,
 * or hold for an admin. Every reason is a sentence an admin can act on.
 */

const DAY = 86400000;

// ── email ──────────────────────────────────────────────────────────────
/** lower-case, trimmed, "+tag" removed: name+1@uni.edu and name@uni.edu are one inbox */
function normalizeStudentEmail(email) {
  const s = String(email || '').trim().toLowerCase();
  const at = s.lastIndexOf('@');
  if (at < 1) return '';
  return s.slice(0, at).replace(/\+.*$/, '') + s.slice(at);
}
const EMAIL_RE = /^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
function validEmail(e) { return EMAIL_RE.test(String(e || '').trim()) && String(e).length <= 254; }

// ── file type from its bytes, not from what the browser said ───────────
function sniffMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.slice(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

// ── text normalisation ─────────────────────────────────────────────────
const BN_DIGITS = { '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9' };
function normText(s) {
  return String(s || '')
    .replace(/[০-৯]/g, (d) => BN_DIGITS[d])
    .replace(/[|¦]/g, 'I')
    .replace(/[“”"‘’`]/g, "'")
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ');
}
// spellings of the same given name that differ on cards
const NAME_ALIAS = { md: 'mohammad', mohd: 'mohammad', mohammed: 'mohammad', muhammad: 'mohammad', muhammed: 'mohammad', mohammod: 'mohammad', mst: 'mosammat', mosammat: 'mosammat', mosamat: 'mosammat', most: 'mosammat' };
const NAME_SKIP = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'engr', 'sk', 'sheikh', 'name', 'student']);
function nameTokens(s) {
  return String(s || '').toLowerCase().replace(/[^a-zঀ-৿\s.]/g, ' ').replace(/\./g, ' ')
    .split(/\s+/).filter((t) => t.length >= 2 && !NAME_SKIP.has(t)).map((t) => NAME_ALIAS[t] || t);
}

// Jaro-Winkler: forgiving of an OCR slip in one or two letters of a name
function jaroWinkler(a, b) {
  if (a === b) return 1;
  const la = a.length, lb = b.length;
  if (!la || !lb) return 0;
  const win = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const ma = new Array(la).fill(false), mb = new Array(lb).fill(false);
  let m = 0;
  for (let i = 0; i < la; i++) {
    for (let j = Math.max(0, i - win); j < Math.min(lb, i + win + 1); j++) {
      if (mb[j] || a[i] !== b[j]) continue;
      ma[i] = mb[j] = true; m++; break;
    }
  }
  if (!m) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < la; i++) {
    if (!ma[i]) continue;
    while (!mb[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const j = (m / la + m / lb + (m - t / 2) / m) / 3;
  let p = 0;
  while (p < 4 && a[p] && a[p] === b[p]) p++;
  return j + p * 0.1 * (1 - j);
}

/**
 * How much of the account's name is on the document, 0..1, weighted by token
 * length (a surname counts more than "Md"), plus the line it was found on.
 */
function nameScore(accountName, text) {
  const want = nameTokens(accountName);
  if (!want.length) return { score: null, matched: [], missing: [], line: null };
  const lines = normText(text).split('\n');
  const have = nameTokens(lines.join(' '));
  const matched = [], missing = [];
  let got = 0, total = 0;
  for (const w of want) {
    const weight = w === 'mohammad' || w === 'mosammat' ? 0.4 : Math.min(1.5, 0.6 + w.length / 8);
    total += weight;
    let best = 0;
    for (const h of have) { const s = jaroWinkler(w, h); if (s > best) best = s; if (best === 1) break; }
    if (best >= 0.9) { got += weight; matched.push(w); }
    else if (best >= 0.84) { got += weight * 0.6; matched.push(w + '~'); }
    else missing.push(w);
  }
  // the line holding most of the name, for the admin to see
  let line = null, lineHits = 0;
  for (const l of lines) {
    const toks = nameTokens(l);
    const hits = want.filter((w) => toks.some((t) => jaroWinkler(w, t) >= 0.88)).length;
    if (hits > lineHits) { lineHits = hits; line = l.trim().slice(0, 120); }
  }
  return { score: Math.round(got / total * 100) / 100, matched, missing, line };
}

const UNI_STOP = new Set(['of', 'and', 'the', '&', 'for', 'in', 'at']);
/** Is this university named on the document? An acronym must stand as a word; a full name may lose a word to OCR. */
function universityScore(names, text) {
  const T = normText(text);
  const upper = T.toUpperCase();
  const lowerToks = T.toLowerCase().replace(/[^a-zঀ-৿\s]/g, ' ').split(/\s+/).filter(Boolean);
  let best = { score: 0, matched: null };
  for (const raw of names || []) {
    const n = String(raw || '').trim();
    if (!n) continue;
    let s = 0;
    if (/^[A-Z]{2,7}$/.test(n)) {
      s = new RegExp('(^|[^A-Z])' + n + '([^A-Z]|$)').test(upper) ? 0.85 : 0;
    } else {
      const toks = n.toLowerCase().replace(/[^a-zঀ-৿\s]/g, ' ').split(/\s+/).filter((t) => t && !UNI_STOP.has(t));
      if (!toks.length) continue;
      const hit = toks.filter((t) => lowerToks.some((h) => (t.length < 4 ? h === t : jaroWinkler(t, h) >= 0.9))).length;
      s = hit / toks.length;
      if (s === 1) s = 1;
      else if (s < 0.6) s = 0;
    }
    if (s > best.score) best = { score: Math.round(s * 100) / 100, matched: n };
  }
  return best;
}

// ── IDs, dates, words ──────────────────────────────────────────────────
const ID_KEY = /(student\s*id|id\s*(no|number|#)?|roll(\s*no)?|reg(istration)?\.?\s*(no|number)?|matric|আইডি|রোল|রেজি)/i;
function cleanId(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function findStudentIds(text) {
  const T = normText(text);
  const out = new Set();
  const near = new RegExp(ID_KEY.source + '\\s*[:.#\\-]?\\s*([A-Z0-9][A-Z0-9\\-/]{3,24})', 'gi');
  let m;
  while ((m = near.exec(T))) {
    const v = m[m.length - 1].replace(/[\-/]+$/, '');
    if ((v.match(/\d/g) || []).length >= 3) out.add(v.toUpperCase());
  }
  // the dashed forms Bangladeshi universities print: 2021-1-60-045, 191-15-2468, 18-37455-1
  const dashed = /\b\d{2,4}(?:-\d{1,5}){2,3}\b/g;
  while ((m = dashed.exec(T))) { if (!/^\d{1,2}-\d{1,2}-\d{2,4}$/.test(m[0])) out.add(m[0]); }
  return [...out].slice(0, 8);
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function mkDate(y, mo, d) {
  y = +y; mo = +mo; d = +d;
  if (y < 100) y += 2000;
  if (!(y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  const t = new Date(Date.UTC(y, mo - 1, d, 23, 59, 59));
  return t.getUTCMonth() === mo - 1 ? t : null;
}
/** Every date on the document, and the one printed as its validity / expiry. */
function findDates(text) {
  const T = normText(text);
  const lines = T.split('\n');
  const all = [];
  let validUntil = null;
  const VALID = /(valid|expir|validity|till|until|upto|up to|মেয়াদ|পর্যন্ত)/i;
  lines.forEach((l, i) => {
    const found = [];
    let m;
    const dmy = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/g;
    while ((m = dmy.exec(l))) { const d = mkDate(m[3], m[2], m[1]); if (d) found.push(d); }
    const ymd = /\b(20\d{2})[\/.\-](\d{1,2})[\/.\-](\d{1,2})\b/g;
    while ((m = ymd.exec(l))) { const d = mkDate(m[1], m[2], m[3]); if (d) found.push(d); }
    const wordy = /\b(\d{1,2})?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s*(\d{1,2},?\s*)?(20\d{2})\b/gi;
    while ((m = wordy.exec(l))) {
      const mo = MONTHS[m[2].toLowerCase().slice(0, 3)];
      const day = m[1] || (m[3] && parseInt(m[3], 10)) || (new Date(Date.UTC(+m[4], mo, 0)).getUTCDate());
      const d = mkDate(m[4], mo, day); if (d) found.push(d);
    }
    all.push(...found);
    const ctx = VALID.test(l) || (i > 0 && VALID.test(lines[i - 1]) && !/\d/.test(lines[i - 1]));
    if (ctx && found.length) {
      const last = found[found.length - 1];
      if (!validUntil || last > validUntil) validUntil = last;
    }
  });
  // "Session 2021-22" / "2021-2022": the intake year, which bounds graduation
  const sm = /session\s*[:\-]?\s*(20\d{2})\s*[-–/]\s*(\d{2,4})/i.exec(T) || /\b(20\d{2})\s*[-–]\s*(20\d{2}|\d{2})\b(?=[^\n]*(session|batch))/i.exec(T);
  const session = sm ? { from: +sm[1], to: +(sm[2].length === 2 ? '20' + sm[2] : sm[2]) } : null;
  return { dates: all, valid_until: validUntil, session };
}

const STUDENT_WORDS = [
  ['student', /\bstudent\b/i], ['identity card', /identity\s*card|\bid\s*card/i], ['admission', /admission|admit\s*card/i],
  ['enrolment', /enrol+ment|enrolled/i], ['registration', /registration/i], ['semester', /semester|trimester/i],
  ['batch', /\bbatch\b/i], ['department', /department|dept\.?/i], ['session', /\bsession\b/i],
  ['শিক্ষার্থী', /শিক্ষার্থী|ছাত্র|ছাত্রী/], ['পরিচয়পত্র', /পরিচয়\s*পত্র|পরিচয়পত্র/], ['ভর্তি', /ভর্তি/],
];

/**
 * What the document shows, measured against the application.
 * @param {{text: string, method: string, confidence?: number, qr?: string|null}} read
 * @param {{fullName: string, universityNames: string[], domains: string[], studentId?: string, gradYear?: number, now?: Date}} want
 */
function analyseDocument(read, want) {
  const now = want.now || new Date();
  const text = String((read && read.text) || '');
  const chars = text.replace(/\s/g, '').length;
  const out = {
    method: read ? read.method : 'none', confidence: read && read.confidence != null ? Math.round(read.confidence) : null,
    readable: chars >= 25, chars,
    name: null, university: null, ids: [], id_match: null, valid_until: null, expired: null, session: null,
    keywords: [], qr: null, score: 0, verdict: 'unreadable', notes: [],
  };
  if (read && read.qr) {
    const q = String(read.qr).slice(0, 300);
    const host = (/https?:\/\/([^/\s?#]+)/i.exec(q) || [])[1];
    const dm = host ? (want.domains || []).some((d) => { const h = host.toLowerCase(); const base = d.split('.').slice(-3).join('.'); return h === d || h.endsWith('.' + base) || h === base; }) : false;
    out.qr = { text: q, host: host || null, domain_match: dm };
  }
  if (!out.readable) {
    out.notes.push(read && read.method === 'pdf-text' ? 'The PDF has no text layer (a scan) — nothing could be read from it.' : 'Too little text could be read from the document.');
    if (out.qr && out.qr.domain_match) { out.score = 35; out.verdict = 'partial'; }
    return out;
  }
  out.name = nameScore(want.fullName, text);
  out.university = universityScore(want.universityNames, text);
  out.ids = findStudentIds(text);
  if (want.studentId) {
    const w = cleanId(want.studentId);
    out.id_match = w.length >= 3 ? out.ids.some((x) => cleanId(x) === w) || cleanId(text).includes(w) : null;
  }
  const d = findDates(text);
  out.valid_until = d.valid_until ? d.valid_until.toISOString().slice(0, 10) : null;
  out.expired = d.valid_until ? d.valid_until.getTime() < now.getTime() : null;
  out.session = d.session;
  out.keywords = STUDENT_WORDS.filter(([, re]) => re.test(text)).map(([k]) => k);

  // score: name 35, university 25, ID 15, student words 10, validity 10, QR 5
  let s = 0;
  const ns = out.name.score;
  if (ns != null) s += 35 * Math.max(0, Math.min(1, (ns - 0.3) / 0.6));
  s += 25 * out.university.score;
  if (out.id_match === true) s += 15; else if (out.id_match == null && out.ids.length) s += 7;
  s += Math.min(10, out.keywords.length * 4);
  if (out.expired === false) s += 10; else if (out.expired == null) s += 4;
  if (out.qr && out.qr.domain_match) s += 5;
  if (out.expired === true) s -= 30;
  out.score = Math.max(0, Math.min(100, Math.round(s)));
  out.verdict = out.expired === true ? 'expired' : out.score >= 70 ? 'strong' : out.score >= 40 ? 'partial' : 'weak';

  if (ns != null && ns < 0.5) out.notes.push('The account name was not found on the document.');
  if (!out.university.score) out.notes.push('The university\'s name was not found on the document.');
  if (out.id_match === false) out.notes.push('The student ID typed is not on the document.');
  if (out.expired) out.notes.push('The document\'s validity date has passed.');
  if (!out.keywords.length) out.notes.push('Nothing on it reads like a student card or admission letter.');
  return out;
}

// ── risk ───────────────────────────────────────────────────────────────
/**
 * @param {object} s signals gathered by the caller
 * @returns {{score: number, level: 'low'|'medium'|'high', reasons: string[]}}
 */
function assessRisk(s) {
  const reasons = [];
  let r = 0;
  const add = (pts, why) => { r += pts; reasons.push(why); };
  if (s.dupDocOtherAccount) add(60, 'The exact same document file is on another account.');
  else if (s.nearDupDocOtherAccount) add(40, 'A near-identical image of this document is on another account.');
  if (s.emailUsedByOtherAccount) add(20, 'This university email was used by another account before.');
  if (s.studentIdUsedByOtherAccount) add(30, 'This student ID was used by another account.');
  if (s.sameNetworkApplications >= 3) add(25, `${s.sameNetworkApplications} applications from the same network in 7 days.`);
  else if (s.sameNetworkApplications === 2) add(10, 'Another application came from the same network this week.');
  if (s.accountAgeHours != null && s.accountAgeHours < 1) add(10, 'The account is less than an hour old.');
  if (s.failedCodes >= 3) add(10, `${s.failedCodes} wrong codes were entered.`);
  if (s.domainKind === 'staff') add(40, 'The email is on a staff domain, not a student one.');
  if (s.emailChanges >= 3) add(10, 'The university email was changed several times.');
  const a = s.analysis;
  if (a) {
    if (!a.readable) add(15, 'The document could not be read.');
    else {
      if (a.name && a.name.score != null && a.name.score < 0.5) add(30, 'The name on the account is not on the document.');
      else if (a.name && a.name.score != null && a.name.score < 0.75) add(10, 'Only part of the account name is on the document.');
      if (a.university && !a.university.score) add(15, 'The university is not named on the document.');
      if (a.expired) add(35, 'The document has expired.');
      if (a.id_match === false) add(25, 'The student ID typed does not match the document.');
      if (!a.keywords.length) add(10, 'The document does not read like a student document.');
    }
  }
  const score = Math.max(0, Math.min(100, r));
  return { score, level: score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low', reasons };
}

// ── decision ───────────────────────────────────────────────────────────
/**
 * @param {{path: 'listed'|'other'|'renewal', emailVerified: boolean, hasDocument: boolean,
 *          docState: string, domainKind?: string, analysis?: object|null, risk: {score:number}}} x
 * @returns {{status: 'active'|'pending'|null, review: 'none'|'post_review', recommend?: string, why: string}}
 *   status null: not everything needed has arrived yet
 */
function decide(x) {
  const risk = x.risk ? x.risk.score : 0;
  if (x.path === 'renewal') {
    if (!x.emailVerified) return { status: null, review: 'none', why: 'waiting for the code' };
    if (risk >= 60) return { status: 'pending', review: 'none', why: 'renewal held: high risk' };
    return { status: 'active', review: risk >= 30 ? 'post_review' : 'none', why: 'renewed by the university inbox' };
  }
  if (!x.hasDocument) return { status: null, review: 'none', why: 'waiting for the document' };
  if (x.docState === 'queued' || x.docState === 'checking') return { status: null, review: 'none', why: 'reading the document' };
  const a = x.analysis;
  const rec = a && a.verdict === 'strong' && risk < 30 ? 'approve' : risk >= 60 || (a && (a.verdict === 'expired' || a.verdict === 'weak')) ? 'reject' : 'look';
  if (x.path === 'other') return { status: 'pending', review: 'none', recommend: rec, why: 'no university inbox to prove it — an admin decides' };
  if (!x.emailVerified) return { status: null, review: 'none', why: 'waiting for the code' };
  if (x.domainKind === 'staff') return { status: 'pending', review: 'none', recommend: rec, why: 'staff domain' };
  if (risk >= 60) return { status: 'pending', review: 'none', recommend: rec, why: 'high risk — held for an admin' };
  if (a && a.verdict === 'expired') return { status: 'pending', review: 'none', recommend: 'reject', why: 'the document has expired' };
  if (a && a.readable && a.name && a.name.score != null && a.name.score < 0.5) return { status: 'pending', review: 'none', recommend: 'look', why: 'the name on the document is not the account\'s — held for an admin' };
  if (a && a.readable && a.id_match === false) return { status: 'pending', review: 'none', recommend: 'look', why: 'the student ID is not on the document — held for an admin' };
  if (a && a.readable && a.verdict === 'weak') return { status: 'pending', review: 'none', recommend: rec, why: 'the document does not match the account — held for an admin' };
  if (a && a.verdict === 'strong' && risk < 30) return { status: 'active', review: 'none', why: 'inbox, document and account agree' };
  return { status: 'active', review: 'post_review', recommend: rec, why: 'approved on the university inbox; the document needs a look' };
}

/** A year, but never past the document's validity or the declared graduation year. */
function expiryFor({ now = new Date(), gradYear = null, validUntil = null } = {}) {
  let end = now.getTime() + 365 * DAY;
  const why = ['one year'];
  if (validUntil) {
    const v = new Date(validUntil).getTime();
    if (v > now.getTime() + 7 * DAY && v < end) { end = v; why.push('document validity'); }
  }
  if (gradYear) {
    const g = Date.UTC(+gradYear, 11, 31, 23, 59, 59);
    if (g > now.getTime() + 7 * DAY && g < end) { end = g; why.push('graduation year'); }
  }
  return { expiresAt: new Date(end), basis: why[why.length - 1] };
}

// ── perceptual hash helpers ────────────────────────────────────────────
function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i += 1) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

function cleanDetails(b = {}, now = new Date()) {
  const out = {};
  if (b.student_id != null) {
    const v = String(b.student_id).trim().slice(0, 40);
    if (v && !/^[A-Za-z0-9][A-Za-z0-9\-/ .]{2,39}$/.test(v)) throw new Error('A student ID uses letters, numbers, dashes and slashes only.');
    out.student_id = v || null;
  }
  if (b.department != null) out.department = String(b.department).trim().slice(0, 120) || null;
  if (b.grad_year != null && b.grad_year !== '') {
    const y = parseInt(b.grad_year, 10), cy = now.getUTCFullYear();
    if (!(y >= cy && y <= cy + 8)) throw new Error(`Graduation year must be between ${cy} and ${cy + 8}.`);
    out.grad_year = y;
  } else if (b.grad_year === '') out.grad_year = null;
  return out;
}

module.exports = {
  normalizeStudentEmail, validEmail, sniffMime, normText, nameTokens, jaroWinkler, nameScore, universityScore,
  findStudentIds, findDates, analyseDocument, assessRisk, decide, expiryFor, hamming, cleanId, cleanDetails,
};
