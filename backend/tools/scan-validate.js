#!/usr/bin/env node
/**
 * Scores the fabric scanner on synthetic swatches with known answers and
 * writes frontend/assets/js/scan/validation.json (shown on the scan board).
 *
 *   node tools/scan-validate.js [count]
 *
 * Each swatch is drawn at a random wales/cm and courses/cm, then
 * "photographed" under the card with random rotation, perspective tilt, blur,
 * sensor noise, uneven light, colour, wrinkles and hairiness, a third with the
 * card lying beside the fabric (window not cut) — the counting must survive all of it.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const FE = path.join(__dirname, '..', '..', 'frontend', 'assets', 'js', 'scan');
const KS = require(path.join(FE, 'fabric-scan-core.js'));
const SY = require(path.join(FE, 'fabric-scan-synth.js'));

const N = parseInt(process.argv[2], 10) || 60;
const RANGES = {
  single_jersey: { wpc: [11, 22], ratio: [1.25, 1.45] },
  rib: { wpc: [8, 14], ratio: [1.45, 1.8] },
  interlock: { wpc: [12, 18], ratio: [0.9, 1.1] },
  pique: { wpc: [9, 13], ratio: [2.2, 2.6] },
};
const R = SY.rng(20261108);
const pick = (a) => a[0] + R() * (a[1] - a[0]);
const by = {};
let ok = 0, fails = 0;
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const structure = Object.keys(RANGES)[i % 4];
  const rg = RANGES[structure];
  const wpc = Math.round(pick(rg.wpc) * 10) / 10, cpc = Math.round(wpc * pick(rg.ratio) * 10) / 10;
  const o = {
    structure, wpc, cpc, KAScan: KS, seed: 1000 + i, pxPerMm: 11 + R() * 6, width: 2000, height: 1600,
    rotate: (R() - 0.5) * 12, angle: (R() - 0.5) * 6, tilt: R() * 0.1, blur: Math.floor(R() * 3), noise: 0.01 + R() * 0.04, light: R() * 0.5,
    colour: [40 + R() * 200, 40 + R() * 200, 40 + R() * 200].map(Math.round),
    wrinkle: R() * 0.35, fuzz: R() * 0.35,                  // real cloth: wrinkles, hairiness
  };
  if (R() < 0.33) Object.assign(o, { uncut: true, cardY: 0.64, pxPerMm: 9.5 + R() * 3 });   // card beside the fabric, window not cut
  const ph = SY.photo(o, KS.CARD);
  const r = KS.analysePhoto(ph.rgba, ph.w, ph.h);
  const b = (by[structure] = by[structure] || { n: 0, failed: 0, w: [], c: [] });
  b.n++;
  if (r.error) { b.failed++; fails++; if (process.env.WHY) console.log(structure, JSON.stringify({ px: +o.pxPerMm.toFixed(1), blur: o.blur, noise: +o.noise.toFixed(3), light: +o.light.toFixed(2), tilt: +o.tilt.toFixed(2), col: o.colour }), r.error); continue; }
  ok++;
  b.w.push(Math.abs(r.wpc / wpc - 1));
  b.c.push(Math.abs(r.cpc / cpc - 1));
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const p90 = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(0.9 * (s.length - 1))] : null; };
const pct = (v) => (v == null ? null : Math.round(v * 1000) / 10);
const out = { generated: new Date().toISOString().slice(0, 10), n: N, measured: ok, failed: fails, by: {} };
for (const [k, b] of Object.entries(by)) {
  out.by[k] = { n: b.n, failed: b.failed, wpc_median_err_pct: pct(med(b.w)), wpc_p90_err_pct: pct(p90(b.w)),
    // a tuck structure's course count is ambiguous to any counter: shown, not hidden
    cpc_median_err_pct: pct(med(b.c)), cpc_p90_err_pct: pct(p90(b.c)) };
}
fs.writeFileSync(path.join(FE, 'validation.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
console.log(`${N} swatches in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
