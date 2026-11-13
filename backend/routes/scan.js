/**
 * Fabric scan — /api/scan/*
 *
 *   GET    /card.pdf          the printable scan card (public)
 *   GET    /validation        how accurate the parts are, measured (public)
 *   POST   /pair              a signed-in screen asks for a pairing code
 *   GET    /pair/:code        the screen reads the newest scan sent to its code
 *   POST   /analyse           a phone sends what it measured; the knitting spec comes back
 *                             (signed in, or with a live pairing code from a signed-in screen)
 *   GET    /history           this account's scans;  DELETE /history/:id
 *
 * The photo never leaves the phone: the loops are counted there
 * (frontend/assets/js/scan/fabric-scan-core.js). Only the numbers and a small
 * flattened thumbnail come here.
 */
const express = require('express');
const router = express.Router();
const { requireUser, loadUser } = require('../middleware/user-auth');
const { createRateLimiter } = require('../middleware/rate-limiter');
const { scans, pairs } = require('../db/repositories/scan-repo');
const reverse = require('../engine/domain/fabric-reverse');
const wovenReverse = require('../engine/domain/woven-reverse');

const analyseLimiter = createRateLimiter({ name: 'scan-analyse', max: 60, windowMs: 10 * 60 * 1000, message: 'Too many scans. Wait a few minutes.' });
const pairLimiter = createRateLimiter({ name: 'scan-pair', max: 20, windowMs: 10 * 60 * 1000, message: 'Too many pairing codes. Wait a few minutes.' });

const fail = (res, label, err, msg) => { console.error(`[scan] ${label} failed:`, err.message); res.status(500).json({ success: false, error: msg }); };
const num = (v, lo, hi) => { const n = +v; return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };

// ── the card ───────────────────────────────────────────────────────────
// Millimetres must print as millimetres: PDF points, 72 to the inch.
router.get('/card.pdf', (req, res) => {
  const PDFDocument = require('pdfkit');
  const mm = (v) => v * 72 / 25.4;
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: 'KnitAdvisor fabric scan card' } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="KnitAdvisor-scan-card.pdf"');
  doc.pipe(res);
  const card = (ox, oy) => {
    // cutting line 5 mm outside the frame — the white border keeps the squares readable
    doc.save().dash(mm(1.5), { space: mm(1.5) }).lineWidth(0.6).strokeColor('#9aa0a6').rect(mm(ox - 6), mm(oy - 6), mm(82), mm(82)).stroke().restore();
    doc.fillColor('#000000');
    [[0, 0], [60, 0], [60, 60], [0, 60]].forEach(([x, y]) => doc.rect(mm(ox + x), mm(oy + y), mm(10), mm(10)).fill());
    // the window to cut out
    doc.save().dash(mm(1), { space: mm(1) }).lineWidth(0.8).strokeColor('#1857C4').rect(mm(ox + 15), mm(oy + 15), mm(40), mm(40)).stroke().restore();
    doc.fillColor('#1857C4').fontSize(7).text('CUT OUT', mm(ox + 15), mm(oy + 33), { width: mm(40), align: 'center' });
    doc.fillColor('#6f7680').fontSize(6).text('wales run top to bottom', mm(ox + 15), mm(oy + 38), { width: mm(40), align: 'center' });
  };
  doc.fillColor('#191C1F').fontSize(16).text('KnitAdvisor fabric scan card', mm(15), mm(14));
  doc.fontSize(9).fillColor('#565C64').text('Print at 100 % ("Actual size" — never "Fit to page"). Check the 50 mm bar with a ruler before use. Cut along the grey line. Then EITHER cut out the blue window and lay the card on the fabric, OR (no scissors) lay the card right next to the fabric, touching it, on a flat swatch — the scanner finds the fabric on any side. Keep the white paper clean: it is the colour reference.', mm(15), mm(22), { width: mm(180) });
  card(25, 48); card(115, 48);
  // the check bar
  doc.fillColor('#000').rect(mm(25), mm(140), mm(50), mm(3)).fill();
  [0, 10, 20, 30, 40, 50].forEach((t) => doc.rect(mm(25 + t) - 0.3, mm(136), 0.6, mm(4)).fill());
  doc.fontSize(8).fillColor('#191C1F').text('50 mm — measure this with a ruler. If it is not 50 mm, the printer scaled the page.', mm(80), mm(139));
  doc.fontSize(10).fillColor('#191C1F').text('How to scan', mm(15), mm(158));
  doc.fontSize(9).fillColor('#565C64').list([
    'Lay the fabric flat, face up, without stretching it. Smooth it by hand.',
    'Put the card on it (window cut) or touching its edge (window not cut), with the wales running top to bottom.',
    'Hold the phone straight above, 8–12 cm away, so the four black squares fill most of the picture. Even light, no shadow of the phone.',
    'Take 2–3 photos at different places on the fabric, then one of the back.',
    'For fine jersey (above 20 wales per cm), a clip-on macro lens makes the count more certain.',
  ], mm(15), mm(165), { width: mm(180), bulletRadius: 1.5, paragraphGap: 3 });
  doc.end();
});

router.get('/validation', (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({ success: true, reverse: reverse.selfCheck(), structures: Object.keys(reverse.STRUCTURES) });
});

// ── pairing a phone to a screen ────────────────────────────────────────
router.post('/pair', requireUser, pairLimiter, async (req, res) => {
  try {
    const p = await pairs.create(req.user.id);
    pairs.prune().catch(() => {});
    res.json({ success: true, code: p.code, expires_at: p.expires_at });
  } catch (err) { fail(res, 'pair', err, 'Could not make a pairing code.'); }
});

router.get('/pair/:code', requireUser, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const v = await pairs.view(req.user.id, req.params.code);
    if (!v) return res.status(404).json({ success: false, error: 'Unknown pairing code.' });
    res.json({ success: true, ...v });
  } catch (err) { fail(res, 'pair view', err, 'Could not read the screen.'); }
});

// ── the scan ───────────────────────────────────────────────────────────
router.post('/analyse', analyseLimiter, async (req, res) => {
  try {
    const b = req.body || {};
    // whose scan: the signed-in user, or the owner of a live pairing code
    let userId = null, pair = null;
    const user = await loadUser(req).catch(() => null);
    if (user) userId = user.id;
    if (b.pair) {
      pair = await pairs.live(b.pair);
      if (!pair) return res.status(400).json({ success: false, error: 'This pairing code has expired. Scan the QR code on the screen again.' });
      userId = pair.user_id;
    }
    // an open-access guest: worked out and shown, not saved to anyone's history
    let guest = false;
    if (!userId) {
      const openAccess = require('../services/open-access');
      const oa = openAccess.read();
      if (openAccess.active(oa) && openAccess.toolFor('POST', '/api/scan/analyse', oa)) {
        if (!openAccess.rateOk(req.ip, oa.per_hour)) return res.status(429).json({ success: false, code: 'GUEST_RATE', error: 'Too many scans from one place in an hour. Wait a little.' });
        openAccess.log(req, 'scan', '/api/scan/analyse');
        guest = true;
      }
    }
    if (!userId && !guest) return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: 'Sign in, or scan the QR code on a signed-in screen.' });

    // a woven cloth: the weave and the threads the phone read, worked back to a construction
    if (b.family === 'woven') {
      const w = b.weave && typeof b.weave === 'object' ? b.weave : {};
      const cls = ['plain', 'twill', 'satin', 'basket', 'half_basket_warp', 'half_basket_weft', 'threads'].includes(w.cls) ? w.cls : null;
      if (!cls) return res.status(400).json({ success: false, error: 'No weave was read.' });
      const matrix = Array.isArray(b.matrix) && b.matrix.length <= 12 && b.matrix.every((r) => Array.isArray(r) && r.length <= 12)
        ? b.matrix.map((r) => r.map((v) => (v ? 1 : 0))) : null;
      const count = (v) => (typeof v === 'string' && /^[0-9./\sNesS]{1,12}$/.test(v.trim()) && v.trim() ? v.trim() : null);
      const winput = {
        weave: { cls, repeat: num(w.repeat, 1, 12), notation: /^\d\/\d$/.test(w.notation || '') ? w.notation : null, hand: ['RH', 'LH'].includes(w.hand) ? w.hand : null,
          face: ['warp', 'weft', 'balanced'].includes(w.face) ? w.face : null, name: String(w.name || '').slice(0, 80), angle_deg: num(w.angle_deg, 0, 90) },
        ends_per_cm: num(b.ends_per_cm, 4, 120), picks_per_cm: num(b.picks_per_cm, 4, 120),
        gsm: b.gsm === '' || b.gsm == null ? null : num(b.gsm, 20, 1200), composition: String(b.composition || '100% cotton').slice(0, 120),
        warp_count: count(b.warp_count), weft_count: count(b.weft_count), denim: !!b.denim, matrix,
        confidence: ['high', 'medium', 'low'].includes(b.confidence) ? b.confidence : null,
      };
      let wout;
      try { wout = wovenReverse.reverse(winput); } catch (e) {
        if (e instanceof wovenReverse.WovenReverseError) return res.status(400).json({ success: false, error: e.message });
        throw e;
      }
      const m = b.measure && typeof b.measure === 'object' ? b.measure : {};
      const wmeasure = {
        confidence: winput.confidence, px_per_mm: num(m.px_per_mm, 0, 500), photos: num(m.photos, 0, 10), scale: ['card', 'focus', 'assumed', 'reference'].includes(m.scale) ? m.scale : null,
        colour: m.colour && /^#[0-9a-f]{6}$/i.test(m.colour.hex || '') ? { hex: m.colour.hex, lab: Array.isArray(m.colour.lab) ? m.colour.lab.slice(0, 3).map((v) => num(v, -200, 200)) : null } : null,
        p_woven: num(m.p_woven, 0, 1),
      };
      const thumbW = typeof b.thumb === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(b.thumb) && b.thumb.length < 200000 ? b.thumb : null;
      const wresult = { ...wout, scan: wmeasure, composition: winput.composition };
      if (guest) return res.json({ success: true, id: null, guest: true, result: wresult });
      const wsaved = await scans.save(userId, { structure: wout.structure, result: wresult, thumb: thumbW, viaPair: !!pair });
      if (pair) await pairs.touch(pair.code, wsaved.id);
      return res.json({ success: true, id: wsaved.id, result: wresult });
    }

    const input = {
      structure: String(b.structure || ''), wpc: num(b.wpc, 4, 40), cpc: num(b.cpc, 4, 60),
      gsm: b.gsm === '' || b.gsm == null ? null : num(b.gsm, 60, 700), composition: String(b.composition || '100% cotton').slice(0, 120),
      colour_hex: /^#[0-9a-f]{6}$/i.test(b.colour_hex || '') ? b.colour_hex : null, confidence: ['high', 'medium', 'low'].includes(b.confidence) ? b.confidence : null,
    };
    if (input.wpc == null) return res.status(400).json({ success: false, error: 'No wales per cm were measured.' });
    let out;
    try { out = reverse.reverse(input); } catch (e) {
      if (e instanceof reverse.ReverseError) return res.status(400).json({ success: false, error: e.message });
      throw e;
    }
    // what the phone measured, kept with the result (numbers only)
    const m = b.measure && typeof b.measure === 'object' ? b.measure : {};
    const measure = {
      confidence: input.confidence, spread: num(m.spread, 0, 1), regularity: num(m.regularity, -1, 1), skew_deg: num(m.skew_deg, -45, 45),
      px_per_mm: num(m.px_per_mm, 0, 500), photos: num(m.photos, 0, 10), faults: Array.isArray(m.faults) ? m.faults.slice(0, 12).map((f) => ({ type: String(f.type).slice(0, 20), x_mm: num(f.x_mm, 0, 100), y_mm: num(f.y_mm, 0, 100) })) : [],
      suggest: Array.isArray(m.suggest) ? m.suggest.slice(0, 5).map((s) => ({ structure: String(s.structure).slice(0, 30), p: num(s.p, 0, 1) })) : [],
      colour: m.colour && /^#[0-9a-f]{6}$/i.test(m.colour.hex || '') ? { hex: m.colour.hex, lab: Array.isArray(m.colour.lab) ? m.colour.lab.slice(0, 3).map((v) => num(v, -200, 200)) : null } : null,
    };
    const thumb = typeof b.thumb === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(b.thumb) && b.thumb.length < 200000 ? b.thumb : null;
    const result = { ...out, scan: measure, composition: input.composition };
    if (guest) return res.json({ success: true, id: null, guest: true, result });
    const saved = await scans.save(userId, { structure: input.structure, result, thumb, viaPair: !!pair });
    if (pair) await pairs.touch(pair.code, saved.id);
    res.json({ success: true, id: saved.id, result });
  } catch (err) { fail(res, 'analyse', err, 'The scan could not be worked out.'); }
});

// A frame the scanner could not read, sent by the person for KnitAdvisor to
// study. Kept privately on the server (never served), with what the camera saw.
const debugLimiter = createRateLimiter({ name: 'scan-debug', max: 20, windowMs: 60 * 60 * 1000, message: 'Too many frames sent. Try again later.' });
router.post('/debug', debugLimiter, async (req, res) => {
  try {
    const b = req.body || {};
    let userId = null;
    const user = await loadUser(req).catch(() => null);
    if (user) userId = user.id;
    if (!userId && b.pair) { const p = await pairs.live(b.pair); if (p) userId = p.user_id; }
    if (!userId) return res.status(401).json({ success: false, error: 'Sign in, or scan the QR code on a signed-in screen.' });
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.image || ''));
    if (!m || m[1].length > 5.5e6) return res.status(400).json({ success: false, error: 'Send one JPEG frame (under 4 MB).' });
    const buf = Buffer.from(m[1], 'base64');
    if (!(buf[0] === 0xff && buf[1] === 0xd8)) return res.status(400).json({ success: false, error: 'Not a JPEG.' });
    const fs = require('fs'), path = require('path');
    const dir = path.join(__dirname, '..', 'uploads', 'scan-debug');
    fs.mkdirSync(dir, { recursive: true });
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-u${userId}`;
    fs.writeFileSync(path.join(dir, name + '.jpg'), buf);
    fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify({ user_id: userId, at: new Date().toISOString(), info: b.info && typeof b.info === 'object' ? JSON.stringify(b.info).slice(0, 4000) : null }, null, 1));
    res.json({ success: true, id: name });
  } catch (err) { fail(res, 'debug', err, 'Could not keep the frame.'); }
});

// Teaching the scanner: a small crop of the cloth (never the whole photo) and what it really is, as the person
// confirmed or corrected it. Kept privately on the server (never served) as training data for the recogniser —
// the photos of real cloth, taken in real light by real phones, that no download can supply.
const teachLimiter = createRateLimiter({ name: 'scan-teach', max: 120, windowMs: 60 * 60 * 1000, message: 'Too many corrections sent. Try again later.' });
const TEACH = {
  family: ['knit', 'woven'],
  structure: ['single_jersey', 'pique', 'rib', 'interlock', 'fleece', 'terry', 'purl', 'plain', 'twill', 'satin', 'basket', 'oxford', 'rib_weave', 'denim', 'other'],
  side: ['face', 'back'],
};
router.post('/teach', teachLimiter, async (req, res) => {
  try {
    const b = req.body || {};
    let userId = null;
    const user = await loadUser(req).catch(() => null);
    if (user) userId = user.id;
    if (!userId && b.pair) { const p = await pairs.live(b.pair); if (p) userId = p.user_id; }
    if (!userId) return res.status(401).json({ success: false, error: 'Sign in to teach the scanner.' });
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.image || ''));
    if (!m || m[1].length > 400000) return res.status(400).json({ success: false, error: 'Send one small JPEG crop.' });
    const buf = Buffer.from(m[1], 'base64');
    if (!(buf[0] === 0xff && buf[1] === 0xd8)) return res.status(400).json({ success: false, error: 'Not a JPEG.' });
    const l = b.label && typeof b.label === 'object' ? b.label : {};
    const label = {
      family: TEACH.family.includes(l.family) ? l.family : null,
      structure: TEACH.structure.includes(l.structure) ? l.structure : null,
      side: TEACH.side.includes(l.side) ? l.side : null,
    };
    if (!label.family) return res.status(400).json({ success: false, error: 'Say whether the cloth is knitted or woven.' });
    const a = b.auto && typeof b.auto === 'object' ? b.auto : {};
    const auto = { family: TEACH.family.includes(a.family) ? a.family : null, p_woven: num(a.p_woven, 0, 1), structure: String(a.structure || '').slice(0, 40) || null };
    const fs = require('fs'), path = require('path');
    const day = new Date().toISOString().slice(0, 10);
    const dir = path.join(__dirname, '..', 'uploads', 'scan-teach', day);
    fs.mkdirSync(dir, { recursive: true });
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-u${userId}-${Math.random().toString(36).slice(2, 7)}`;
    fs.writeFileSync(path.join(dir, name + '.jpg'), buf);
    fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify({ user_id: userId, at: new Date().toISOString(), label, auto,
      confirmed: !!b.confirmed, corrected: !!(auto.family && auto.family !== label.family), scale: ['card', 'id-card', 'lens', 'focus', 'assumed'].includes(b.scale) ? b.scale : null }, null, 1));
    res.json({ success: true });
  } catch (err) { fail(res, 'teach', err, 'Could not keep the correction.'); }
});

router.get('/history', requireUser, async (req, res) => {
  try { res.json({ success: true, scans: await scans.list(req.user.id, 30) }); }
  catch (err) { fail(res, 'history', err, 'Could not load your scans.'); }
});
router.get('/history/:id', requireUser, async (req, res) => {
  try {
    const s = await scans.get(req.user.id, parseInt(req.params.id, 10) || 0);
    if (!s) return res.status(404).json({ success: false, error: 'Scan not found.' });
    res.json({ success: true, scan: s });
  } catch (err) { fail(res, 'history get', err, 'Could not load that scan.'); }
});
router.delete('/history/:id', requireUser, async (req, res) => {
  try { res.json({ success: await scans.remove(req.user.id, parseInt(req.params.id, 10) || 0) }); }
  catch (err) { fail(res, 'history delete', err, 'Could not delete that scan.'); }
});

module.exports = router;
