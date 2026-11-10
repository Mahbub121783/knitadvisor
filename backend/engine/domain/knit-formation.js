/**
 * KnitAdvisor — stitch formation: knock-over depth ↔ loop length (Fabric Studio)
 * =============================================================================
 *
 * When the stitch cam draws a needle down, its hook passes below the
 * knock-over level (the sinker belly on a single bed, the trick verge on a
 * double bed) by the knock-over depth d, and the new yarn is drawn into a loop
 * round the needle hook and over the sinkers (or round the needles of the
 * other bed). The loop length is the length of that yarn path. GEOMETRY
 * (derived, after the loop-formation geometry in Spencer, Knitting
 * Technology, and the yarn-path models of Knapton and Munden):
 *
 * SINGLE BED — per needle, the yarn passes OVER the sinker on each side and
 * UNDER the needle hook: two circles, a crossed belt.
 *   needle circle   radius rn = (tn + δ)/2, centre d − rn below the belly
 *   sinker circle   radius rs = (ts + δ)/2, centre rs below the belly, p/2 aside
 *   v = (p/2, d − rn − rs), D = |v|, cos γ = (rn + rs)/D
 *   tangent  T = √(D² − (rn + rs)²)
 *   wrap     θ = angle(v) − γ + π/2  (the same on both circles: crossed belt)
 *   loop     ℓ = 2T + 2θ (rn + rs)
 * DOUBLE BED — per needle the yarn runs from its hook to the hook of the
 * nearest working needle on the other bed: a horizontal step h (half a pitch
 * on rib gating, a whole pitch between interlock's knitting needles) and a
 * separation s = √(dd² + (dc + gap)²) in the section (dial needles lie
 * flat, the dial set "gap" above the cylinder verge):
 *   ℓ = √(h² + s²) + (π − 2·atan(h/s)) r, r = (tn + δ)/2
 *   (the yarn turns round each hook by π less the angle between its two legs)
 *
 * p   needle pitch = 25.4 / gauge (mm)
 * δ   yarn diameter, scaled from the ground yarn's as √tex (Peirce)
 * tn  needle thickness ≈ 0.42 p, ts sinker thickness ≈ 0.22 p (MODELLED:
 *     the trick and sinker take the needle pitch in about these shares)
 *
 * FEED. On a positive (tape) feed the loop length IS the yarn fed per needle:
 * the cam only has to form a little more (about 5%, MODELLED) so the yarn
 * stays under light, even tension. On a storage feed the needles draw what the
 * cam depth forms and part of it is robbed back by the next needles as the
 * old loops knock over — about 10% (MODELLED) — so the cam forms ℓ / 0.9.
 *
 * TIMING (double bed). Synchronised: both beds knock over together and each
 * draws its own loop. Delayed (rib): the dial knocks over a few needles later
 * and takes part of its loop from the cylinder's — set the dial shallower
 * and the cylinder deeper; about 15% of the dial loop is robbed (MODELLED).
 *
 * The stitch-cam scale of a machine is not in millimetres. Two settings the
 * mill already runs (scale reading and the stitch length it gives) turn it
 * into readings: depth is worked out for each and the scale is a straight
 * line through them (one point: in proportion from zero).
 */
'use strict';

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const TN = 0.42, TS = 0.22, FORM_OVER = 0.05, ROB_STORAGE = 0.10, ROB_DELAYED = 0.15, GAP = 0.5;

/** Loop length formed at knock-over depth d (mm). */
function loopAt(d, g) {
  if (g.bed === 'single') {
    const rn = g.rn, rs = g.rs;
    const vx = g.p / 2, vy = d - rn - rs, D = Math.hypot(vx, vy);
    if (D <= rn + rs) return null;                         // the circles overlap: no knock-over
    const gam = Math.acos((rn + rs) / D);
    const T = Math.sqrt(D * D - (rn + rs) ** 2);
    const th = Math.atan2(vy, vx) - gam + Math.PI / 2;
    return th > 0 ? 2 * T + 2 * th * (rn + rs) : null;
  }
  // the yarn comes to the hook from the working needles on either side of the
  // other bed: it turns round the hook by π less the angle between the two
  const s = Math.hypot(d, d + g.gap);
  return Math.hypot(g.h, s) + (Math.PI - 2 * Math.atan(g.h / s)) * g.rn;
}

/** The knock-over depth that forms loop ℓ (bisection: ℓ grows with d; the hook must be at or below the knock-over level). */
function depthFor(l, g) {
  const ok = (d) => loopAt(d, g) != null;
  // the old loop (one yarn thick) must at least clear the hook: knock-over is a yarn diameter deep or more
  let lo = g.delta, hi = 12;
  if (!ok(hi) || loopAt(hi, g) < l) return { d: null };
  if (!ok(lo)) { let a = lo, b = hi; for (let k = 0; k < 60; k++) { const m = (a + b) / 2; if (ok(m)) b = m; else a = m; } lo = b; }
  const lmin = loopAt(lo, g);
  if (lmin > l) return { d: lo, short: true, lmin };
  for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (loopAt(m, g) < l) lo = m; else hi = m; }
  return { d: (lo + hi) / 2 };
}

function geometry(bed, gating, gauge, delta, gapMm) {
  const p = 25.4 / gauge;
  return {
    bed: bed ? 'double' : 'single', p, delta, tn: TN * p, ts: TS * p,
    rn: (TN * p + delta) / 2, rs: (TS * p + delta) / 2,
    h: gating === 'interlock' ? p : p / 2, gap: gapMm > 0 ? gapMm : GAP,
  };
}

/**
 * The stitch-formation plan for a solved design.
 * @param a { st, gating, S (solve result), feedSystem: 'positive'|'storage', timing, machine }
 */
function plan(a) {
  const { st, S } = a;
  const m = a.machine || {};
  const dbl = !!st.beds.D;
  const timing = dbl ? (m.timing === 'synchronised' || m.timing === 'delayed' ? m.timing : a.defaultTiming || 'delayed') : null;
  const positive = a.feedSystem !== 'storage';
  const form = positive ? 1 + FORM_OVER : 1 / (1 - ROB_STORAGE);
  const d0 = S.gfit.yarn_d_mm, t0 = S.ground.tex;
  const checks = [];
  const add = (level, text) => checks.push({ level, text });
  const feeds = [];
  for (let i = 0; i < st.feeds; i++) {
    const f = S.feeds[i];
    if (!f) continue;
    const beds = [['C', st.beds.C], ['D', st.beds.D]].filter(([, g]) => g && g[i].includes('K'));
    if (!beds.length) continue;
    const delta = Math.abs((f.tex || t0) / t0 - 1) < 0.01 ? d0 : d0 * Math.sqrt(f.tex / t0);
    const g = geometry(dbl, a.gating, S.gauge, delta, +m.dial_gap_mm);
    const row = { feed: i + 1, sl_mm: f.sl_mm, formed_mm: r2(f.sl_mm * form), yarn_d_mm: r3(delta) };
    for (const [b] of beds) {
      // delayed timing: the dial takes part of its loop from the cylinder's
      const share = timing === 'delayed' && beds.length === 2 ? (b === 'D' ? 1 - ROB_DELAYED : 1 + ROB_DELAYED) : 1;
      const want = f.sl_mm * form * share;
      const res = depthFor(want, g);
      const key = b === 'C' ? 'cyl' : 'dial';
      row[key + '_depth_mm'] = res.d == null ? null : r2(res.d);
      if (b === 'C') Object.defineProperty(row, '_d', { value: res.d, enumerable: false });
      if (res.short) add('error', `Feed ${i + 1}: a ${r2(f.sl_mm)} mm loop is shorter than the yarn that wraps the ${b === 'C' ? 'cylinder' : 'dial'} needle${dbl ? '' : ' and the sinker'} at ${S.gauge} GG (${r2(res.lmin / form)} mm at the shallowest knock-over) — the needle cannot knock over: knit a longer loop, a finer yarn or a finer gauge.`);
      else if (res.d == null) add('error', `Feed ${i + 1}: a ${r2(f.sl_mm)} mm loop needs more needle travel than a stitch cam gives at ${S.gauge} GG.`);
      else if (res.d > 2.4 * g.p + 1) add('warn', `Feed ${i + 1}: knock-over depth ${r2(res.d)} mm on the ${b === 'C' ? 'cylinder' : 'dial'} — deep for ${S.gauge} GG (needle pitch ${r2(g.p)} mm): a loose loop, high yarn tension in the draw and stitch distortion. A coarser gauge suits this loop.`);
    }
    if (!dbl) {
      // where the loop's yarn lies: needle loop (head and legs) and sinker loop
      const sinkerPart = (() => { const d = row.cyl_depth_mm; if (d == null) return null; const rs = g.rs; return Math.PI * rs; })();
      if (sinkerPart != null) { row.sinker_loop_mm = r2(sinkerPart); row.needle_loop_mm = r2(f.sl_mm - sinkerPart); }
    }
    feeds.push(row);
  }
  // stitch-cam scale: the mill's own settings → readings
  const pts = ((m.stitch_cam || {}).points || []).filter((q) => +q.reading > 0 && +q.sl_mm > 0);
  let scale = null;
  if (pts.length && feeds.length) {
    const g = geometry(dbl, a.gating, S.gauge, d0, +m.dial_gap_mm);
    const dOf = (sl) => { const r = depthFor(sl * form, g); return r.d; };
    const P = pts.slice(0, 2).map((q) => ({ reading: +q.reading, d: dOf(+q.sl_mm) })).filter((q) => q.d != null);
    if (P.length === 2 && Math.abs(P[1].d - P[0].d) > 1e-3) {
      const k = (P[1].reading - P[0].reading) / (P[1].d - P[0].d);
      scale = { method: 'straight line through your two settings', at: (d) => P[0].reading + k * (d - P[0].d) };
    } else if (P.length) {
      const k = P[0].reading / P[0].d;
      scale = { method: 'in proportion to your one setting (assumes the scale reads zero at the knock-over level — a second point removes that)', at: (d) => k * d };
    }
    if (scale) feeds.forEach((f) => { if (f._d != null) f.cyl_reading = r2(scale.at(f._d)); });
  }
  const gN = geometry(dbl, a.gating, S.gauge, d0, +m.dial_gap_mm);
  return {
    feeds, timing, feed_system: positive ? 'positive' : 'storage',
    geometry: { pitch_mm: r3(gN.p), needle_mm: r3(gN.tn), sinker_mm: dbl ? null : r3(gN.ts), yarn_d_mm: r3(d0), dial_gap_mm: dbl ? gN.gap : null },
    scale_method: scale ? scale.method : null,
    formula: dbl
      ? 'ℓ = √(h² + d² + (d + gap)²) + (π − 2·atan(h/s))·(tn + δ)/2 — yarn from each hook to the nearest working hook of the other bed (h = ½ pitch on rib gating, 1 pitch on interlock)'
      : 'ℓ = 2T + 2θ(rn + rs): the yarn passes over the sinkers and under the hook — a crossed belt round two circles, rn = (tn + δ)/2, rs = (ts + δ)/2, T the tangent, θ the wrap',
    basis: `geometry derived; needle ≈ ${TN} × pitch and sinker ≈ ${TS} × pitch thick, ${positive ? `positive feed: the cam forms ${Math.round(FORM_OVER * 100)}% over the fed length` : `storage feed: ${Math.round(ROB_STORAGE * 100)}% robbed back`}${timing === 'delayed' ? `, delayed timing: ${Math.round(ROB_DELAYED * 100)}% of the dial loop taken from the cylinder` : ''} — modelled`,
    checks,
  };
}

/** Forward: the loop a given knock-over depth forms (cam depth set, loop length asked). */
function loopFromDepth(depth, a) {
  const { st, S } = a;
  const dbl = !!st.beds.D;
  const g = geometry(dbl, a.gating, S.gauge, S.gfit.yarn_d_mm, +((a.machine || {}).dial_gap_mm));
  const l = loopAt(depth, g);
  if (l == null) return null;
  const positive = a.feedSystem !== 'storage';
  return l / (positive ? 1 + FORM_OVER : 1 / (1 - ROB_STORAGE));
}

module.exports = { plan, loopAt, depthFor, geometry, loopFromDepth, CONST: { TN, TS, FORM_OVER, ROB_STORAGE, ROB_DELAYED, GAP } };
