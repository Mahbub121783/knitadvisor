// Student verification v2: the rules, and the document reader on real files
// (a photographed card read by OCR, a PDF read from its text layer).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sv = require('../engine/domain/student-verify');
console.log('--- Running Student Verification Tests ---');

const NOW = new Date('2026-11-08T10:00:00Z');
const CARD = 'BANGLADESH UNIVERSITY OF TEXTILES\nSTUDENT IDENTITY CARD\nName: Md. Rakibul Hasan\nStudent ID: 2021-1-60-045\nDepartment: Fabric Engineering\nSession: 2021-22\nValid Till: 30/06/2027';
const WANT = { fullName: 'Mohammad Rakibul Hasan', universityNames: ['Bangladesh University of Textiles', 'BUTEX'], domains: ['butex.edu.bd'], studentId: '2021160045', now: NOW };

// email: one inbox, one form
assert.strictEqual(sv.normalizeStudentEmail(' Rakib+second@G.BRACU.ac.bd '), 'rakib@g.bracu.ac.bd');
assert.strictEqual(sv.normalizeStudentEmail('a.b@du.ac.bd'), 'a.b@du.ac.bd');
assert(!sv.validEmail('x@'), 'half an address is refused');

// file type from the bytes
assert.strictEqual(sv.sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/jpeg');
assert.strictEqual(sv.sniffMime(Buffer.from('%PDF-1.7 aaaaaaa')), 'application/pdf');
assert.strictEqual(sv.sniffMime(Buffer.from('<script>alert(1)</script>')), null, 'a script renamed .jpg is refused');

// names: Md = Mohammad, an OCR slip is forgiven, another person is not
assert.strictEqual(sv.nameScore('Mohammad Rakibul Hasan', 'Name: Md. Rakibul Hasan').score, 1);
assert(sv.nameScore('Rakibul Hasan', 'Name: Rakibu1 Hasan').score >= 0.6, 'one misread letter still matches');
assert(sv.nameScore('Karim Uddin', CARD).score < 0.3, 'a different person does not match');

// university: full name or a standalone acronym, not an acronym inside a word
assert.strictEqual(sv.universityScore(['Bangladesh University of Textiles'], CARD).score, 1);
assert.strictEqual(sv.universityScore(['NSU'], 'NSUBSIDISED fees').score, 0);
assert(sv.universityScore(['NSU'], 'NSU Student Card').score > 0.8);

// IDs, dates (Bengali digits too), session
assert.deepStrictEqual(sv.findStudentIds(CARD), ['2021-1-60-045']);
assert.strictEqual(sv.findDates('মেয়াদ: ৩০/০৬/২০২৭').valid_until.toISOString().slice(0, 10), '2027-06-30');
assert.strictEqual(sv.findDates('Valid upto June 2027').valid_until.toISOString().slice(0, 10), '2027-06-30');
assert.deepStrictEqual(sv.findDates(CARD).session, { from: 2021, to: 2022 });

// the whole card, measured against the application
{
  const a = sv.analyseDocument({ text: CARD, method: 'ocr', confidence: 92 }, WANT);
  assert.strictEqual(a.verdict, 'strong');
  assert(a.score >= 85 && a.id_match === true && a.expired === false, JSON.stringify(a));
  const risk = sv.assessRisk({ analysis: a, sameNetworkApplications: 1, accountAgeHours: 48 });
  assert.strictEqual(risk.level, 'low');
  const d = sv.decide({ path: 'listed', emailVerified: true, hasDocument: true, docState: 'done', analysis: a, risk });
  assert.deepStrictEqual([d.status, d.review], ['active', 'none'], 'inbox + matching card: approved, nothing to look at');
  const e = sv.expiryFor({ now: NOW, validUntil: a.valid_until, gradYear: 2028 });
  assert.strictEqual(e.basis, 'document validity', 'never past the card\'s own validity');
}

// someone else's card on a verified inbox is held, not approved
{
  const a = sv.analyseDocument({ text: CARD, method: 'ocr' }, { ...WANT, fullName: 'Karim Uddin', studentId: '999-111-222' });
  const risk = sv.assessRisk({ analysis: a });
  const d = sv.decide({ path: 'listed', emailVerified: true, hasDocument: true, docState: 'done', analysis: a, risk });
  assert.strictEqual(d.status, 'pending', `held: ${d.why}`);
  assert(risk.reasons.some((r) => /name/.test(r)) && risk.reasons.some((r) => /student ID/.test(r)));
}

// expired card, the same card on another account, staff domain, still reading
{
  const old = sv.analyseDocument({ text: CARD.replace('30/06/2027', '30/06/2025'), method: 'ocr' }, WANT);
  assert.strictEqual(old.verdict, 'expired');
  assert.strictEqual(sv.decide({ path: 'listed', emailVerified: true, hasDocument: true, docState: 'done', analysis: old, risk: sv.assessRisk({ analysis: old }) }).status, 'pending');
  const good = sv.analyseDocument({ text: CARD, method: 'ocr' }, WANT);
  const dup = sv.assessRisk({ analysis: good, dupDocOtherAccount: true });
  assert(dup.score >= 60 && sv.decide({ path: 'listed', emailVerified: true, hasDocument: true, docState: 'done', analysis: good, risk: dup }).status === 'pending', 'a card already used elsewhere is held');
  assert.strictEqual(sv.decide({ path: 'listed', emailVerified: true, hasDocument: true, docState: 'done', domainKind: 'staff', analysis: good, risk: sv.assessRisk({ analysis: good, domainKind: 'staff' }) }).status, 'pending');
  assert.strictEqual(sv.decide({ path: 'listed', emailVerified: true, hasDocument: true, docState: 'checking', risk: { score: 0 } }).status, null);
  assert.strictEqual(sv.decide({ path: 'other', emailVerified: false, hasDocument: true, docState: 'done', analysis: good, risk: { score: 0 } }).recommend, 'approve');
  // an unreadable photo on a verified inbox: approved, but queued for a person
  const blank = sv.analyseDocument({ text: '', method: 'ocr' }, WANT);
  const d = sv.decide({ path: 'listed', emailVerified: true, hasDocument: true, docState: 'done', analysis: blank, risk: sv.assessRisk({ analysis: blank }) });
  assert.deepStrictEqual([d.status, d.review], ['active', 'post_review']);
  assert.strictEqual(sv.decide({ path: 'renewal', emailVerified: true, hasDocument: false, docState: 'none', risk: { score: 0 } }).status, 'active');
}

// details
assert.throws(() => sv.cleanDetails({ grad_year: 1999 }, NOW), /Graduation year/);
assert.throws(() => sv.cleanDetails({ student_id: '<b>' }, NOW), /letters, numbers/);
assert.strictEqual(sv.hamming('ffff0000ffff0000', 'ffff0000ffff0001'), 1);

// the migration: one live application per inbox and per student ID
{
  const sql = fs.readFileSync(path.join(__dirname, '../db/migrations/039_student_verification_v2.sql'), 'utf8');
  assert(/UNIQUE INDEX uq_student_email_live ON app_student_verifications \(student_email_norm\)\s+WHERE status IN \('pending', 'active'\)/.test(sql));
  assert(/UNIQUE INDEX uq_student_id_live/.test(sql));
  assert(/ON CONFLICT \(lower\(domain\)\) DO NOTHING/.test(sql), 'seeding never overwrites an admin row');
}

// the reader on real files: a photographed card (OCR) and a text PDF
(async () => {
  let docs;
  try { docs = require('../services/student-docs'); require.resolve('tesseract.js'); } catch (e) { console.log('  (reader not installed — skipped)'); console.log('Student verification tests passed'); return; }
  const Jimp = require('jimp');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ka-stu-'));
  const img = new Jimp(1000, 600, 0xffffffff);
  const font = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK);
  CARD.split('\n').forEach((l, i) => img.print(font, 40, 30 + i * 75, l));
  const jpg = path.join(dir, 'card.jpg');
  fs.writeFileSync(jpg, await img.rotate(90).getBufferAsync(Jimp.MIME_JPEG)); // photographed sideways
  const r = await docs.readDocument(jpg);
  assert.strictEqual(r.mime, 'image/jpeg');
  assert(/^[0-9a-f]{64}$/.test(r.sha256) && /^[0-9a-f]{16}$/.test(r.phash) && r.cleaned);
  const a = sv.analyseDocument(r, WANT);
  assert(a.verdict === 'strong', `OCR of a sideways card reads strong: ${a.score} ${JSON.stringify(a.notes)} — ${r.text.slice(0, 120)}`);
  console.log(`  OCR: ${r.ms} ms, confidence ${Math.round(r.confidence)}, score ${a.score}`);

  const PDFDocument = require('pdfkit');
  const pdfPath = path.join(dir, 'admission.pdf');
  await new Promise((done) => {
    const doc = new PDFDocument(); const out = fs.createWriteStream(pdfPath); doc.pipe(out);
    doc.fontSize(14).text('Bangladesh University of Textiles\nAdmission Letter\nName: Rakibul Hasan\nRoll No: 2021-1-60-045\nThis admission is valid till 30/06/2027');
    doc.end(); out.on('finish', done);
  });
  const p = await docs.readDocument(pdfPath);
  assert.strictEqual(p.method, 'pdf-text');
  assert(sv.analyseDocument(p, WANT).score >= 70, 'a text PDF is read without OCR');

  fs.writeFileSync(path.join(dir, 'fake.jpg'), '<html>not a picture</html>');
  await assert.rejects(docs.readDocument(path.join(dir, 'fake.jpg')), /not a JPEG/);
  await docs.stopOcr();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('Student verification tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
