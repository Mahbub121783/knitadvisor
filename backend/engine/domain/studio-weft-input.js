/**
 * A weft design saved from the Fabric Studio, read back as the input the Studio's own engine
 * (fabric-studio.analyse) takes — the same fields the page sends (studio.js payload()), taken
 * from what the design saved: its needle programme, feeds and the yarn, machine and target boxes.
 * Used to bring a saved design into the costing sheet. A custom machine ("My machine") and the
 * trial rolls are not part of this: the design is read on the machine its settings name, or the
 * simplest one that knits it.
 */
'use strict';

const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) && x > 0 ? x : null; };
const isFil = (f) => /filament/.test(String(f || ''));

function weftPayload(d) {
  const f = d.fields || {};
  const n = (id) => num(f[id]);
  const yarnOf = (c, u, fi, t, p, fil) => {
    const y = { fibre: f[fi] || 'cotton', type: f[t] || '', ply: +f[p] || 1 };
    if (n(c)) { y.count = n(c); y.unit = f[u] || 'ne'; }
    if (isFil(y.fibre) && n(fil)) y.filaments = n(fil);
    return y;
  };
  const pts = (a, b, ka, kb) => (n(a) && n(b) ? [{ reading: n(a), [kb]: n(b) }] : []);
  const C = Array.isArray(d.C) ? d.C : [], D = Array.isArray(d.D) ? d.D : null;
  const feeds = (Array.isArray(d.feeds) && d.feeds.length ? d.feeds : C.map(() => ({ role: 'ground' })));
  const vdq = [...pts('st-v1r', 'st-v1l', 'reading', 'course_length_m'), ...pts('st-v2r', 'st-v2l', 'reading', 'course_length_m')];
  const cam = [...pts('st-c1r', 'st-c1l', 'reading', 'sl_mm'), ...pts('st-c2r', 'st-c2l', 'reading', 'sl_mm')];
  return {
    bed: D ? 'double' : 'single',
    gating: d.bed === 'interlock' ? 'interlock' : 'rib',
    grid: { C: C.map((r) => r.join('')), D: D ? D.map((r) => r.join('')) : null },
    feeds: feeds.map((fd) => {
      const c = +fd.count > 0 ? +fd.count : +fd.ne > 0 ? +fd.ne : 0;
      return { role: fd.role || 'ground', colour: fd.colour || null, plate: !!fd.plate, yarn: c ? { count: c, unit: fd.count ? (fd.unit || 'ne') : 'ne' } : null, sl_ratio: +fd.sl_ratio > 0 ? +fd.sl_ratio : null };
    }),
    yarn: yarnOf('st-ne', 'st-unit', 'st-fibre', 'st-ytype', 'st-ply', 'st-fil'),
    yarns: { binder: n('yb-count') ? yarnOf('yb-count', 'yb-unit', 'yb-fibre', 'yb-type', 'yb-ply', 'yb-fil') : null, loop: n('yl-count') ? yarnOf('yl-count', 'yl-unit', 'yl-fibre', 'yl-type', 'yl-ply', 'yl-fil') : null, plate: n('yp-count') ? yarnOf('yp-count', 'yp-unit', 'yp-fibre', 'yp-type', 'yp-ply', 'yp-fil') : null },
    plush: { cut: !!d.cut, sinker_mm: n('st-sinker'), arrangement: f['st-parr'] },
    pile: f['st-pile'],
    stripes: String(f['st-stripe'] || '').trim() ? { sequence: f['st-stripe'] } : null,
    finish: { brush: f['st-brush'], passes: n('st-passes'), sheared: false },
    elastane: d.lycra ? { denier: +f['st-lyd'], draft: n('st-lydraft') || 2.6, every: f['st-lyevery'] } : null,
    target: { gsm: n('st-gsm'), width_in: n('st-width'), shrinkage_pct: n('st-shr') },
    calibration: null,
    machine: {
      gauge: n('st-gauge'), dia: n('st-dia'), feeders: n('st-feeders'), rpm: n('st-rpm'), sl_mm: n('st-sl'), efficiency: n('st-eff'),
      tracks_cyl: +f['st-tc'] || null, tracks_dial: +f['st-td'] || null, profile: f['st-mprof'] && f['st-mprof'] !== 'custom' ? f['st-mprof'] : null, transfer_dir: f['st-tdir'],
      vdq: { points: vdq }, cam_depth_mm: n('st-camd'), timing: f['st-timing'] || null, dial_gap_mm: n('st-dgap'), stitch_cam: { points: cam },
    },
  };
}

module.exports = { weftPayload };
