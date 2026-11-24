'use strict';
/**
 * KnitAdvisor — Garment pattern engine, shorts and trousers (jersey, drawcord waistband)
 * ===================================================================
 * A measurement chart in (a buyer's size specification: outside leg, front and back rise, waist relaxed and stretched, waistband depth, seat position and
 * width, thigh, leg opening, hem depth, pockets), the pattern pieces out, built the way a pattern maker drafts a basic jersey short:
 *
 *   front leg (x 0 = side seam, y 0 = the waistband seam, down)   centre-front seam bowing out to the seat, a crotch curve out to the thigh, the inseam in to the hem
 *   back leg   the same, the back rise longer (the back rises above the waistband seam by the difference), a slanted back pocket patch marked on it
 *   waistband  a strip as long as the RELAXED waist round, twice the depth (folded); it is stretched to the body's STRETCHED waist when it is sewn on
 *   pocket bag and back pocket  rectangles from the chart; the slanted front pocket opening cuts the corner of the front leg
 *
 * Every figure the chart gives is reproduced by the outline (the page and the test compare them), the cut is the finished size over (1 - shrinkage) across and
 * along, the seams carry an allowance each, the marker lays the pieces on the fabric. Pieces are anchors and Bézier handles like the tee's, so they are editable.
 *
 * What it does not do: a fly, a back yoke, a gusset, cargo or elastic-casing styles, the drape of the cloth. The rise is measured straight down (flat), the way a
 * flat garment is measured. Plain arithmetic, units cm (the chart may be inches).
 */
const G = require('./garment-pattern');
const { anchor, cutOutline, notchesOf, polyOf, applyEdit, cloneAnchors, edgeLen, bez, plen, area, bbox, lay, selfCrossing, STITCH, INCH, r1, r2, roleOf } = G;

const STYLE = 'shorts';
// key, label, required, default as a function of the others (null: no default, the piece is left out)
const POMS = [
  { key: 'outseam', label: 'Outside leg length, top of the waistband to the hem', req: true },
  { key: 'front_rise', label: 'Front rise (including the waistband)', req: true },
  { key: 'back_rise', label: 'Back rise (including the waistband)', req: false, def: (m) => m.front_rise + 4 },
  { key: 'waist', label: 'Waist, relaxed (flat)', req: false, def: (m) => m.waist_stretched * 0.68 },
  { key: 'waist_stretched', label: 'Waist, stretched (flat)', req: true, def: (m) => m.waist / 0.68 },
  { key: 'waistband_h', label: 'Waistband depth', req: false, def: () => 4 },
  { key: 'seat_pos', label: 'Seat position (down from the top of the waistband)', req: false, def: (m) => m.front_rise * 0.62 },
  { key: 'seat_w', label: 'Seat width (flat)', req: true },
  { key: 'thigh', label: 'Thigh width from the crotch seam (flat)', req: true },
  { key: 'leg_opening', label: 'Leg opening / hem width (flat)', req: true },
  { key: 'hem_h', label: 'Hem depth', req: false, def: () => 2.5 },
  { key: 'fpocket_l', label: 'Slanted front pocket, length at the side seam', req: false, def: null },
  { key: 'fpocket_w', label: 'Slanted front pocket, width across the waistband', req: false, def: null },
  { key: 'pbag_w', label: 'Pocket bag width', req: false, def: null },
  { key: 'pbag_l', label: 'Pocket bag length', req: false, def: null },
  { key: 'bpocket_l', label: 'Back pocket length', req: false, def: null },
  { key: 'bpocket_w', label: 'Back pocket width', req: false, def: null },
  { key: 'bpocket_pos', label: 'Back pocket position (below the waistband)', req: false, def: () => 3 },
  { key: 'drawcord_len', label: 'Visible drawcord length', req: false, def: null },
  { key: 'eyelet_dist', label: 'Distance between the drawcord eyelets', req: false, def: null },
];
const POM_KEYS = POMS.map((p) => p.key);

function template(sizes, unit) {
  const S = sizes && sizes.length ? sizes : ['S', 'M', 'L', 'XL'];
  const mid = Math.max(0, S.indexOf('M') >= 0 ? S.indexOf('M') : Math.floor((S.length - 1) / 2));
  const base = { outseam: 47, front_rise: 28, back_rise: 33, waist: 36, waist_stretched: 52, waistband_h: 5, seat_pos: 19, seat_w: 54, thigh: 33, leg_opening: 30, hem_h: 3, fpocket_l: 16, fpocket_w: 6, pbag_w: 18, pbag_l: 26, bpocket_l: 15, bpocket_w: 14, bpocket_pos: 4, drawcord_len: 10, eyelet_dist: 5 };
  const step = { outseam: 1.5, front_rise: 1, back_rise: 1, waist: 4, waist_stretched: 5, waistband_h: 0, seat_pos: 0.7, seat_w: 4, thigh: 2, leg_opening: 2, hem_h: 0, fpocket_l: 0.5, fpocket_w: 0, pbag_w: 0.5, pbag_l: 1, bpocket_l: 0.5, bpocket_w: 0.5, bpocket_pos: 0, drawcord_len: 0, eyelet_dist: 0 };
  const k = unit === 'in' ? 1 / INCH : 1, chart = {};
  POM_KEYS.forEach((key) => { chart[key] = {}; S.forEach((s, i) => { chart[key][s] = r2((base[key] + step[key] * (i - mid)) * k); }); });
  return { sizes: S, unit: unit === 'in' ? 'in' : 'cm', chart };
}

function measures(chart, size, unit, notes) {
  const k = unit === 'in' ? INCH : 1, m = {}, given = {};
  POMS.forEach((p) => { const v = G.num(chart && chart[p.key] ? chart[p.key][size] : NaN) * k; if (v > 0) { m[p.key] = v; given[p.key] = true; } });
  POMS.forEach((p) => {
    if (m[p.key] > 0 || !p.def) return;
    const v = p.def(m); if (v > 0 && isFinite(v)) { m[p.key] = v; if (notes) notes.add(`${size}\u0001${p.label}: not in the chart, taken as ${r1(v)} cm`); }
  });
  m._given = given; return m;
}

// ── the seams ──
const SEAM_OF = { waist: 'waistband', wband: 'waistband', centre: 'rise', crotch: 'rise', inseam: 'inseam', inseamhem: 'inseam', side: 'side', sidehem: 'side', hem: 'hem', pocketopen: 'pocket', pocketbag: 'pocket', bpocket: 'pocket', bandend: 'band_end' };
const SEAM_DEFAULTS = {
  waistband: { name: 'Waistband attach', type: '514', allowance: 1.0 }, rise: { name: 'Front and back rise (crotch)', type: '514', allowance: 1.0 }, inseam: { name: 'Inseam', type: '514', allowance: 1.0 },
  side: { name: 'Side seam', type: '514', allowance: 1.0 }, hem: { name: 'Leg hem', type: '605', allowance: 0 }, pocket: { name: 'Pockets (topstitch)', type: '301', allowance: 0.7 }, band_end: { name: 'Waistband closing', type: '301', allowance: 1.0 },
};
function seamConfig(user, legacy) {
  const out = {};
  Object.keys(SEAM_DEFAULTS).forEach((k) => {
    const d = SEAM_DEFAULTS[k], u = (user && user[k]) || {};
    let allowance = Number.isFinite(+u.allowance) && u.allowance !== '' && u.allowance !== null ? +u.allowance : d.allowance;
    if (!(user && user[k] && 'allowance' in user[k]) && legacy && Number.isFinite(legacy.seam) && ['waistband', 'rise', 'inseam', 'side', 'band_end'].includes(k)) allowance = legacy.seam;
    out[k] = { id: k, name: d.name, type: STITCH[u.type] ? u.type : d.type, allowance: k === 'hem' ? 0 : Math.max(0, Math.min(5, allowance)) };
  });
  return out;
}
const labelLen = (pc, ...ls) => { let l = 0; const P = pc.pts.pts, Lb = pc.pts.labels, n = P.length; for (let i = 0; i < n; i++) if (ls.includes(Lb[i])) l += Math.hypot(P[(i + 1) % n][0] - P[i][0], P[(i + 1) % n][1] - P[i][1]); return l; };

// ── the finished pieces of one size ──
function geometry(m) {
  const F = m.waistband_h, Ll = m.outseam - F, yc = m.front_rise - F, dB = Math.max(0, m.back_rise - m.front_rise), hw = m.waist_stretched / 2, sh = m.seat_w / 2, ys = m.seat_pos - F;
  return { F, Ll, yc, dB, hw, sh, ys, e: m.thigh - sh, slope: (m.thigh - m.leg_opening) / Math.max(1e-6, Ll - yc) };
}
function legAnchors(m, g, back) {
  const { Ll, yc, dB, hw, sh, ys, e, slope } = g, hh = m.hem_h, Th = m.thigh, Lo = m.leg_opening;
  const dc0 = Math.max(2.5, Math.min(0.9 * e + 1.5, yc - ys - 0.5)), dc = back ? Math.min(dc0 * 1.15, yc - ys - 0.4) : dc0;
  const pocket = !back && m.fpocket_l > 0 && m.fpocket_w > 0;
  const top = back ? -dB : 0;
  const an = [];
  if (pocket) an.push(anchor(m.fpocket_w, 0, 'waist', { corner: true, role: 'pocket_top' })); else an.push(anchor(0, 0, 'waist', { corner: true, role: 'side_top' }));
  an.push(anchor(hw, top, 'centre', { hout: [(sh - hw) * 0.12, (ys - top) * 0.45], corner: true, role: 'cf_top' }));
  an.push(anchor(sh, ys, 'centre', { hin: [0, -(ys - top) * 0.35], role: 'seat' }));
  an.push(anchor(sh, yc - dc, 'crotch', { hout: [0, dc * 0.6], role: 'crotch_start' }));
  an.push(anchor(Th, yc, 'inseam', { hin: [-(Th - sh) * 0.55, 0], corner: true, role: 'crotch' }));
  an.push(anchor(Lo, Ll, 'inseamhem', { corner: true, role: 'hem_inner' }));
  an.push(anchor(Lo - slope * hh, Ll + hh, 'hem', { corner: true, role: 'hem_inner_b' }));
  an.push(anchor(0, Ll + hh, 'sidehem', { corner: true, role: 'hem_outer_b' }));
  an.push(anchor(0, Ll, 'side', { corner: true, role: 'hem_outer' }));
  if (pocket) an.push(anchor(0, m.fpocket_l, 'pocketopen', { corner: true, role: 'pocket_side' }));
  return an;
}
function finishedPieces(m, o, edits) {
  edits = edits || {};
  const g = geometry(m);
  const make = (id, name, qty, base, grain, extra) => {
    const ed = edits[id] || null, manual = !!(ed && ed.manual && Array.isArray(ed.manual.anchors) && ed.manual.anchors.length >= 3);
    const an = manual ? ed.manual.anchors.map((a) => anchor(+a.x, +a.y, a.label, { hin: a.hin || null, hout: a.hout || null, corner: !!a.corner, role: a.role || null })) : applyEdit(base, ed, false);
    return Object.assign({ id, name, qty, sym: false, grain, anchors: an, base: manual ? cloneAnchors(an) : base, manual, pts: polyOf(an, false) }, extra || {});
  };
  const rect = (w, h, labels) => [anchor(0, 0, labels[0], { corner: true }), anchor(w, 0, labels[1], { corner: true }), anchor(w, h, labels[2], { corner: true }), anchor(0, h, labels[3], { corner: true })];
  const front = make('front', 'Front leg', 2, legAnchors(m, g, false), 'y');
  const back = make('back', 'Back leg', 2, legAnchors(m, g, true), 'y');
  const band = make('waistband', 'Waistband', 1, rect(2 * m.waist, 2 * m.waistband_h, ['wband', 'bandend', 'wband', 'bandend']), 'x', { rib: true });
  const out = { front, back, band, extra: [] };
  if (m.pbag_w > 0 && m.pbag_l > 0 && m.fpocket_l > 0) out.extra.push(make('pbag', 'Pocket bag', 4, rect(m.pbag_w, m.pbag_l, ['pocketbag', 'pocketbag', 'pocketbag', 'pocketbag']), 'y'));
  if (m.bpocket_w > 0 && m.bpocket_l > 0) out.extra.push(make('bpocket', 'Back pocket', 2, rect(m.bpocket_w, m.bpocket_l, ['bpocket', 'bpocket', 'bpocket', 'bpocket']), 'y'));
  out.g = g;
  return out;
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function measuredOf(fp, m) {
  const r = (pc, role) => roleOf(pc, role), v = (x) => (x == null || !isFinite(x) ? null : r2(x)), F = m.waistband_h;
  const fCr = r(fp.front, 'crotch'), bCr = r(fp.back, 'crotch'), fTop = r(fp.front, 'cf_top'), bTop = r(fp.back, 'cf_top'), fSeat = r(fp.front, 'seat'), hOut = r(fp.front, 'hem_outer'), hIn = r(fp.front, 'hem_inner'), hInB = r(fp.front, 'hem_inner_b');
  const out = {
    outseam: hOut ? v(hOut.y + F) : null, front_rise: fCr ? v(fCr.y - (fTop ? fTop.y : 0) + F) : null, back_rise: bCr && bTop ? v(bCr.y - bTop.y + F) : null, waist_stretched: fTop ? v(2 * fTop.x) : null,
    waist: v(fp.band.anchors.length >= 3 ? fp.band.anchors[1].x / 2 : null), waistband_h: v(fp.band.anchors.length >= 3 ? fp.band.anchors[2].y / 2 : null), seat_pos: fSeat ? v(fSeat.y + F) : null, seat_w: fSeat ? v(2 * fSeat.x) : null,
    thigh: fCr ? v(fCr.x) : null, leg_opening: hIn && hOut ? v(hIn.x - hOut.x) : null, hem_h: hIn && hInB ? v(hInB.y - hIn.y) : null,
  };
  const pt = r(fp.front, 'pocket_top'), ps = r(fp.front, 'pocket_side');
  if (pt && ps) { out.fpocket_w = v(pt.x); out.fpocket_l = v(ps.y); }
  fp.extra.forEach((p) => { const b = bbox(p.pts.pts); if (p.id === 'pbag') { out.pbag_w = v(b.w); out.pbag_l = v(b.h); } if (p.id === 'bpocket') { out.bpocket_w = v(b.w); out.bpocket_l = v(b.h); } });
  return out;
}

function build(input) {
  const inp = input || {}, unit = inp.unit === 'in' ? 'in' : 'cm';
  const sizes = (Array.isArray(inp.sizes) && inp.sizes.length ? inp.sizes : ['M']).map(String).slice(0, 8);
  const chart = inp.chart || {}, f = inp.fabric || {}, al = inp.allowance || {};
  const fabric = {
    gsm: +f.gsm > 0 ? +f.gsm : 220, width_cm: +f.width_cm > 0 ? +f.width_cm : (+f.width_in > 0 ? +f.width_in * INCH : 170),
    shrink_len_pct: Number.isFinite(+f.shrink_len_pct) ? +f.shrink_len_pct : 5, shrink_wid_pct: Number.isFinite(+f.shrink_wid_pct) ? +f.shrink_wid_pct : 5, rib_stretch_pct: Number.isFinite(+f.rib_stretch_pct) ? +f.rib_stretch_pct : 25,
    rib_gsm: +f.rib_gsm > 0 ? +f.rib_gsm : 260, wpc: +f.wpc > 0 ? +f.wpc : null, cpc: +f.cpc > 0 ? +f.cpc : null, colour: /^#[0-9a-f]{6}$/i.test(f.colour || '') ? f.colour : '#6b6a55', name: String(f.name || '').slice(0, 80),
  };
  if (fabric.shrink_len_pct < -15 || fabric.shrink_len_pct > 30 || fabric.shrink_wid_pct < -15 || fabric.shrink_wid_pct > 30) return { success: false, error: 'Shrinkage must be between -15 % and 30 % (negative = the cloth grows).' };
  const allow = { seam: Number.isFinite(+al.seam) ? +al.seam : 1.0, neck: Number.isFinite(+al.neck) ? +al.neck : 0.7 };
  const opt = { gap_cm: Number.isFinite(+inp.gap_cm) ? +inp.gap_cm : 1, end_loss_cm: Number.isFinite(+inp.end_loss_cm) ? +inp.end_loss_cm : 2, one_way: inp.orient === 'one_way', trials: Number.isFinite(+inp.marker_trials) ? +inp.marker_trials : 16 };
  const base = sizes.includes(inp.base) ? inp.base : sizes[Math.floor((sizes.length - 1) / 2)];
  const ratio = {}; sizes.forEach((s) => { const r = inp.ratio && +inp.ratio[s]; ratio[s] = Number.isFinite(r) && r >= 0 ? Math.round(r) : 1; });
  if (!sizes.some((s) => ratio[s] > 0)) return { success: false, error: 'The size ratio has no garment in it.' };
  const notes = new Set(), checks = [], per = [], bad = [];
  const sx = 1 / (1 - fabric.shrink_wid_pct / 100), sy = 1 / (1 - fabric.shrink_len_pct / 100);
  sizes.forEach((s) => {
    const m = measures(chart, s, unit, notes);
    ['outseam', 'front_rise', 'seat_w', 'thigh', 'leg_opening'].forEach((k) => { if (!(m[k] > 0)) bad.push(`size ${s}: ${POMS.find((p) => p.key === k).label.toLowerCase()} is missing`); });
    if (!(m.waist_stretched > 0)) bad.push(`size ${s}: the waist (relaxed or stretched) is missing`);
    per.push({ size: s, m });
  });
  if (bad.length) return { success: false, error: `The chart is not complete: ${bad.join('; ')}.` };
  const add = (level, text, size) => checks.push({ level, text, size: size || null });
  const edits = inp.edits && typeof inp.edits === 'object' ? inp.edits : {};
  const seamCfg = seamConfig(inp.seams, allow), tol = Number.isFinite(+inp.tolerance_cm) ? Math.max(0.05, +inp.tolerance_cm) : 0.5, tols = inp.tolerances && typeof inp.tolerances === 'object' ? inp.tolerances : {};
  const allowOf = (l) => { const s = SEAM_OF[l]; return s && seamCfg[s] ? seamCfg[s].allowance : allow.seam; };
  const NOTCH = { front: [{ label: 'inseam', at: [0.5] }, { label: 'side', at: [0.5] }, { label: 'crotch', at: [0.5] }], back: [{ label: 'inseam', at: [0.5] }, { label: 'side', at: [0.5] }, { label: 'crotch', at: [0.5] }] };
  const rnd3 = (v) => Math.round(v * 1000) / 1000;
  const anchorOut = (a) => ({ x: rnd3(a.x), y: rnd3(a.y), label: a.label, hin: a.hin ? [rnd3(a.hin[0]), rnd3(a.hin[1])] : null, hout: a.hout ? [rnd3(a.hout[0]), rnd3(a.hout[1])] : null, corner: !!a.corner, role: a.role || null });
  const out = [];
  for (const { size, m } of per) {
    let broken = false;
    const need = (ok, text) => { if (!ok) { add('error', `Size ${size}: ${text}`, size); broken = true; } };
    const g = geometry(m);
    need(g.Ll > g.yc + 3, `the leg below the crotch is only ${r1(g.Ll - g.yc)} cm: the outside leg (${r1(m.outseam)} cm) is too short for a front rise of ${r1(m.front_rise)} cm.`);
    need(g.ys > 1 && g.yc - g.ys > 3, `the seat (${r1(m.seat_pos)} cm down) and the crotch (${r1(m.front_rise)} cm rise) are too close together: the crotch curve has no room.`);
    need(m.thigh > g.sh + 0.3, `the thigh (${r1(m.thigh)} cm) must be wider than half the seat (${r1(g.sh)} cm): that difference is the crotch extension.`);
    need(m.leg_opening > 5 && m.leg_opening < m.thigh + 12, `the leg opening (${r1(m.leg_opening)} cm) is outside what the thigh (${r1(m.thigh)} cm) allows.`);
    need(m.waist_stretched > 15 && m.waist_stretched < 120 && m.seat_w > 20 && m.seat_w < 140, `the waist (${r1(m.waist_stretched)}) or the seat (${r1(m.seat_w)}) is outside 15 to 140 cm.`);
    need(m.waist > 0 && m.waist <= m.waist_stretched, `the relaxed waist (${r1(m.waist)} cm) must not be wider than the stretched waist (${r1(m.waist_stretched)} cm).`);
    need(m.waistband_h >= 1 && m.waistband_h < g.yc - 1, `the waistband (${r1(m.waistband_h)} cm) is deeper than the rise allows.`);
    if (broken) continue;
    const fp = finishedPieces(m, opt, edits[size]);
    const src = [fp.front, fp.back].concat(fp.extra, [fp.band]);
    const pieces = src.map((p) => {
      const rib = !!p.rib, cut = cutOutline(p, rib ? 1 : sx, rib ? 1 : sy, allowOf), fin = p.pts.pts, bb = bbox(cut.pts), bf = bbox(fin);
      const mk = { id: p.id, name: p.name, qty: p.qty, rib, grain: p.grain, source: p.id };
      if (p.id === 'back' && m.bpocket_w > 0 && m.bpocket_l > 0) {                       // the back pocket patch, marked where it is sewn
        const x0 = g.hw * 0.5 - m.bpocket_w / 2, x1 = x0 + m.bpocket_w, y0 = m.bpocket_pos, y1 = y0 + m.bpocket_l;
        mk.marks = [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]].map((q, i) => ({ kind: 'pocket', x1: q[0] / sx, y1: q[1] / sy, x2: q[2] / sx, y2: q[3] / sy, label: i === 0 ? 'back pocket' : ' ' }));
      }
      return Object.assign(mk, {
        finished: fin.map(([x, y]) => [r2(x), r2(y)]), cut: cut.pts.map(([x, y]) => [r2(x), r2(y)]), nominal: cut.nominal.map(([x, y]) => [r2(x), r2(y)]), labels: cut.labels, finished_labels: p.pts.labels,
        notches: NOTCH[p.id] ? notchesOf(cut.nominal, p.pts.labels, NOTCH[p.id]) : [],
        finished_w: r1(bf.w), finished_h: r1(bf.h), cut_w: r1(bb.w), cut_h: r1(bb.h), cut_area_cm2: r1(Math.abs(area(cut.pts))), finished_area_cm2: r1(Math.abs(area(fin))),
        simple: !selfCrossing(cut.pts) && !selfCrossing(fin),
      });
    });
    pieces.forEach((p) => { if (!p.simple) add('error', `Size ${size}: the ${p.name.toLowerCase()} outline crosses itself: the shape cannot be cut. Move an anchor back, or reset the piece.`, size); });
    // what the drawing measures against what the chart asks
    const measured = measuredOf(fp, m), md = [];
    POMS.forEach((p) => {
      const pv = measured[p.key], cv = m[p.key]; if (pv == null || !(cv >= 0) || !m._given[p.key]) return;
      const diff = r2(pv - cv), tl = tols[p.key], kk = unit === 'in' ? INCH : 1;
      const tp = tl && +tl.plus > 0 ? +tl.plus * kk : tol, tm = tl && +tl.minus > 0 ? +tl.minus * kk : tol;
      md.push({ key: p.key, label: p.label, chart: r2(cv), pattern: pv, diff, tol_plus: r2(tp), tol_minus: r2(tm), ok: diff <= tp + 1e-9 && diff >= -tm - 1e-9 });
    });
    const off = md.filter((x) => !x.ok);
    if (off.length) add('warn', `Size ${size}: the drawing is off the chart, outside the tolerance (${tol} cm unless the spec sheet gives another), on ${off.map((x) => `${x.label.split(',')[0].toLowerCase()} (${x.diff > 0 ? '+' : ''}${x.diff})`).join(', ')}. Set the chart from the pattern, or reset the piece.`, size);
    // the seams
    const FR = fp.front, BK = fp.back, BD = fp.band, rows = [];
    const row = (id, a, b, sewn, expect) => rows.push({ id, a, b, sewn, expect: expect || 0 });
    const side = [labelLen(FR, 'side', 'sidehem'), labelLen(BK, 'side', 'sidehem')], inseam = [labelLen(FR, 'inseam', 'inseamhem'), labelLen(BK, 'inseam', 'inseamhem')];
    const rise = labelLen(FR, 'centre', 'crotch') + labelLen(BK, 'centre', 'crotch'), pk = labelLen(FR, 'pocketopen');
    row('side', side[0], side[1], side[0] * 2, side[1] - side[0]);
    row('inseam', inseam[0], inseam[1], inseam[0] * 2);
    row('rise', rise, rise, rise);
    const waistBody = (labelLen(FR, 'waist') + labelLen(BK, 'waist')) * 2 + (m.fpocket_w > 0 ? 2 * m.fpocket_w : 0), waistBand = labelLen(BD, 'wband') / 2;
    row('waistband', waistBody, waistBand, waistBody, waistBand - waistBody);
    row('band_end', labelLen(BD, 'bandend') / 2, labelLen(BD, 'bandend') / 2, labelLen(BD, 'bandend') / 2);
    row('hem', labelLen(FR, 'hem') * 2, labelLen(BK, 'hem') * 2, (labelLen(FR, 'hem') + labelLen(BK, 'hem')) * 2);
    if (pk > 0 || fp.extra.length) row('pocket', pk * 2, pk * 2, pk * 2 * 2 + fp.extra.filter((p) => p.id === 'bpocket').reduce((a, p) => a + labelLen(p, 'bpocket') * p.qty, 0));
    const seams = rows.map((r) => {
      const c = seamCfg[r.id], st = STITCH[c.type], diff = r.b - r.a, offm = Math.abs(diff - r.expect) > 0.4 && r.id !== 'hem';
      if (offm) add('warn', `Size ${size}: the ${c.name.toLowerCase()} joins edges of ${r1(r.a)} and ${r1(r.b)} cm (${diff > 0 ? '+' : ''}${r1(diff)}; ${r.expect ? `${r1(r.expect)} intended` : 'they should be equal'}).`, size);
      return { id: r.id, name: c.name, type: c.type, type_name: st.name, machine: st.machine, allowance: c.allowance, a_len: r1(r.a), b_len: r1(r.b), diff_cm: r1(diff), expected_diff_cm: r1(r.expect), match: !offm, sewn_cm: r1(r.sewn), ratio: st.ratio, thread_m: r2((r.sewn * st.ratio) / 100) };
    });
    const byId = Object.fromEntries(seams.map((s) => [s.id, s]));
    const order = ['pocket', 'rise', 'side', 'inseam', 'band_end', 'waistband', 'hem'].filter((id) => byId[id]);
    const ops = order.map((id, i) => ({ n: i + 1, seam: id, name: byId[id].name, machine: byId[id].machine, type: byId[id].type, length_cm: byId[id].sewn_cm, thread_m: byId[id].thread_m }));
    const thread = seams.reduce((a, s) => a + s.thread_m, 0);
    let sam = null;
    try {
      const cat = require('../catalog/garment-operations'), s0 = cat.buildGarmentSam('basic_jogger', []);
      if (s0) sam = { minutes: r2(s0.basic_minutes_total * s0.allowance_factor), benchmark_minutes: s0.benchmark_sam, base_minutes: r2(s0.basic_minutes_total * s0.allowance_factor), addons: [], note: 'The catalogue\'s basic jogger operation bulletin (a benchmark for a long jersey bottom, not a measured one); a pair of shorts has fewer operations, so this is on the high side.' };
    } catch (_) { sam = null; }
    // checks
    const stretch = (m.waist_stretched / m.waist - 1) * 100;
    if (stretch > 80) add('warn', `Size ${size}: the waistband stretches ${Math.round(stretch)} % from relaxed (${r1(m.waist)} cm) to stretched (${r1(m.waist_stretched)} cm): that is more than a rib or an elastic band gives.`, size);
    else add('note', `Size ${size}: the waistband (${r1(2 * m.waist)} cm round relaxed) is stretched ${Math.round(stretch)} % to the body's ${r1(2 * m.waist_stretched)} cm waist.`, size);
    if (m.seat_w < m.waist_stretched) add('warn', `Size ${size}: the seat (${r1(m.seat_w)}) is narrower than the stretched waist (${r1(m.waist_stretched)}).`, size);
    if (m.back_rise < m.front_rise) add('warn', `Size ${size}: the back rise (${r1(m.back_rise)}) is shorter than the front rise (${r1(m.front_rise)}); a back is usually longer.`, size);
    if (m.fpocket_l > 0 && m.pbag_l > 0 && m.pbag_l < m.fpocket_l) add('warn', `Size ${size}: the pocket bag (${r1(m.pbag_l)} cm long) is shorter than the pocket opening (${r1(m.fpocket_l)} cm).`, size);
    if (m.bpocket_w > 0 && m.bpocket_w > g.hw) add('warn', `Size ${size}: the back pocket (${r1(m.bpocket_w)} cm wide) is wider than the back leg's waist (${r1(g.hw)} cm).`, size);
    add('ok', `Size ${size}: front crotch extension ${r1(g.e)} cm, inseam ${r1(g.Ll - g.yc)} cm below the crotch, leg opening ${r1(m.leg_opening)} cm.`, size);
    const sh = (pc) => pc.pts.pts.map(([x, y]) => [r2(x), r2(y)]);
    out.push({
      size, m: Object.fromEntries(Object.entries(m).filter(([k]) => k[0] !== '_').map(([k, v]) => [k, r2(v)])), derived: { crotch_y: r2(g.yc), crotch_ext: r2(g.e), inseam: r2(g.Ll - g.yc), leg_len: r2(g.Ll), waist_stretch_pct: r1(stretch), back_raise: r2(g.dB), band_len: r2(2 * m.waist) }, pieces,
      shape: { front: sh(FR), back: sh(BK) }, zipper: { on: false }, measured: md,
      edit: Object.fromEntries([FR, BK, BD].concat(fp.extra).map((p) => [p.id, { id: p.id, name: p.name, sym: false, manual: p.manual, anchors: p.anchors.map(anchorOut), base: p.base.map(anchorOut), edited: !!(edits[size] && edits[size][p.id]) }])),
      sewing: { seams, operations: ops, thread_m: r2(thread), thread_per_dozen_m: r1(thread * 12), sam },
    });
  }
  if (!out.length) return { success: false, error: checks.filter((c) => c.level === 'error').map((c) => c.text).join(' ') || 'No size could be drawn.', checks };
  POM_KEYS.forEach((k) => { const vs = out.map((o) => o.m[k]).filter((v) => v != null); for (let i = 1; i < vs.length; i++) if (vs[i] + 1e-9 < vs[i - 1] && !['hem_h', 'waistband_h'].includes(k)) { add('warn', `Grading: ${POMS.find((p) => p.key === k).label.toLowerCase()} gets smaller from one size to the next (${r1(vs[i - 1])} to ${r1(vs[i])}).`); break; } });
  const widest = Math.max.apply(null, out.map((o) => Math.max.apply(null, o.pieces.filter((p) => !p.rib).map((p) => p.cut_w))));
  if (widest > fabric.width_cm) add('error', `The widest piece is ${r1(widest)} cm; the fabric cuts ${r1(fabric.width_cm)} cm wide.`);
  else if (widest > fabric.width_cm * 0.97) add('warn', `The widest piece (${r1(widest)} cm) leaves under 3 % of the ${r1(fabric.width_cm)} cm cutting width.`);
  if (fabric.shrink_len_pct > 8 || fabric.shrink_wid_pct > 8) add('warn', `Shrinkage of ${fabric.shrink_len_pct} % / ${fabric.shrink_wid_pct} % is high: the cut is ${r1((sy - 1) * 100)} % longer and ${r1((sx - 1) * 100)} % wider than the finished garment.`);
  add('note', `Pieces are cut ${r1((sx - 1) * 100)} % wider and ${r1((sy - 1) * 100)} % longer than the finished measures, then the allowance of each seam is added (side ${seamCfg.side.allowance} cm, inseam ${seamCfg.inseam.allowance} cm, rise ${seamCfg.rise.allowance} cm, waistband ${seamCfg.waistband.allowance} cm).`);
  const items = [];
  out.forEach((o) => o.pieces.filter((p) => !p.rib).forEach((p) => { const poly = p.cut.map((q) => q.slice()); for (let i = 0; i < p.qty * (ratio[o.size] || 0); i++) items.push({ size: o.size, id: p.id, name: `${o.size} ${p.name}`, n: i + 1, poly, area: p.cut_area_cm2 }); }));
  const mk = lay(items, fabric.width_cm, opt);
  if (!mk.ok) return { success: false, error: mk.error, checks };
  const garments = out.reduce((a, o) => a + (ratio[o.size] || 0), 0), net = items.reduce((a, it) => a + it.area, 0), grossArea = mk.length * fabric.width_cm, eff = net / grossArea;
  const kg = (a, gsm) => (a / 10000) * gsm / 1000;
  const ribPer = out.reduce((a, o) => a + (ratio[o.size] || 0) * o.pieces.filter((p) => p.rib).reduce((b, p) => b + p.cut_area_cm2, 0), 0) / garments;
  const consumption = {
    garments_in_marker: garments, marker_length_cm: r1(mk.length), marker_width_cm: r1(fabric.width_cm), efficiency_pct: r1(eff * 100), net_area_per_garment_cm2: r1(net / garments), gross_area_per_garment_cm2: r1(grossArea / garments),
    fabric_per_garment_m: r2(mk.length / 100 / garments), net_kg_per_garment: Math.round(kg(net / garments, fabric.gsm) * 1000) / 1000, gross_kg_per_garment: Math.round(kg(grossArea / garments, fabric.gsm) * 1000) / 1000,
    gross_kg_per_dozen: r2(kg(grossArea / garments, fabric.gsm) * 12), wastage_pct: r1((1 - eff) * 100), rib_area_per_garment_cm2: r1(ribPer), rib_kg_per_garment: Math.round(kg(ribPer, fabric.rib_gsm) * 10000) / 10000, gsm: fabric.gsm,
  };
  if (eff < 0.7) add('warn', `Marker efficiency is ${consumption.efficiency_pct} %: bottoms usually reach 78 % or more. Try another size ratio, or another cutting width.`);
  else add('ok', `Marker: ${garments} garment${garments > 1 ? 's' : ''} in ${r1(mk.length)} cm of ${r1(fabric.width_cm)} cm cloth, efficiency ${consumption.efficiency_pct} %.`);
  notes.forEach((t) => { const [sz, tx] = t.split('\u0001'); add('note', tx, sz); });
  const bs = out.find((o) => o.size === base) || out[0], mb = bs.m, cord = Math.round(2 * mb.waist_stretched + 2 * (mb.drawcord_len || 10) + 12);
  const bom = [
    { item: 'Main fabric', qty: consumption.fabric_per_garment_m, unit: 'm', note: `${fabric.gsm} GSM, ${r1(fabric.width_cm)} cm wide: ${consumption.gross_kg_per_garment} kg a garment` },
    { item: 'Waistband rib / elastic jersey', qty: consumption.rib_area_per_garment_cm2, unit: 'cm²', note: `${consumption.rib_kg_per_garment} kg at ${fabric.rib_gsm} GSM` },
    { item: 'Sewing thread', qty: r1(bs.sewing.thread_m), unit: 'm', note: `${r1(bs.sewing.thread_m * 12)} m a dozen; a rule of thumb for the stitch types chosen: confirm with the thread supplier` },
    { item: 'Drawcord', qty: cord, unit: 'cm', note: `round the stretched waist plus the visible ends and the knots (an estimate: confirm with the spec)` },
    { item: 'Eyelets', qty: 2, unit: 'pc', note: mb.eyelet_dist ? `${r1(mb.eyelet_dist)} cm apart, centre to centre` : 'for the drawcord' },
  ];
  (Array.isArray(inp.trims) ? inp.trims : []).slice(0, 40).forEach((t) => {
    const item = String((t && t.item) || '').replace(/\s+/g, ' ').trim().slice(0, 80); if (!item) return;
    bom.push({ item, qty: Number.isFinite(+t.qty) && +t.qty > 0 ? +t.qty : 1, unit: String(t.unit || 'pc').slice(0, 8), note: String(t.note || 'from the spec sheet').slice(0, 160), spec: true });
  });
  return {
    success: true, style: STYLE, unit_in: unit, sizes, base, ratio, fabric, allowance: allow, ease_cm: 0, tolerance_cm: tol, cut_factor: { across: r2(sx), along: r2(sy) }, by_size: out, seams: seamCfg, zipper: { on: false },
    sewing: bs.sewing, bom, catalogue: { stitch: STITCH, zip_types: {}, zip_standard: [], seam_defaults: SEAM_DEFAULTS },
    marker: { width_cm: r1(fabric.width_cm), length_cm: r1(mk.length), efficiency_pct: consumption.efficiency_pct, pieces: mk.placed.map((p) => ({ size: p.size, piece: p.piece, name: p.name, n: p.n, rot: p.rot, poly: p.poly.map(([x, y]) => [r2(x), r2(y)]) })) },
    consumption, checks,
    basis: [
      'A pattern maker\'s basic jersey short drafted from the chart: the centre seam bows from the waist to the seat, a crotch curve runs out to the thigh, the inseam runs in to the leg opening; the back rises above the waistband seam by the difference of the rises.',
      'The waistband is a strip as long as the RELAXED waist round and twice the depth (folded); it is stretched to the body\'s STRETCHED waist when sewn on, which is why the chart gives both.',
      'Every piece is a closed outline of anchors and Bézier handles; a move of an anchor or a handle is an edit kept on top of the chart. Every chart measure is a FINISHED, flat, after-wash measure; the cut is the finished size over (1 − shrinkage), then each seam\'s allowance is added.',
      'Rises are measured straight down from the top of the waistband, as a flat garment is measured. A fly, a back yoke, cargo pockets and elastic casings are not drawn; the pocket bag and back pocket are rectangles of the chart\'s size.',
      'Thread is seam length × a ratio per stitch type (rules of thumb); the sewing time is the catalogue benchmark for a jogger, not a measured operation bulletin; the drawcord length is an estimate.',
    ],
  };
}

module.exports = { STYLE, POMS, POM_KEYS, SEAM_OF, SEAM_DEFAULTS, build, template, measures, geometry, finishedPieces, measuredOf };
