/**
 * How much of the scatter in the factory records could ANY model explain? (a ceiling for the twin)
 *
 * For each family, the finished width constant Kw (wales ÷ stitch length) and the weight constant Ks
 * are predicted three ways by 5-fold cross-validation, and the median |error| compared:
 *   none   the family's median constant (what the Studio does)
 *   tf     + the tightness factor (yarn size against stitch length)
 *   big    + gauge, diameter, count
 * If the continuous variables a physics model would respond to (yarn thickness against loop length)
 * do not beat the plain median, the remaining scatter is yarn lot, finishing and weighing — and no
 * model can remove it. Run: node tools/yarn-twin-accuracy-diagnostic.js
 */
'use strict';
const { FACTORY_RECORDS } = require('../engine/catalog/factory-dataset');
const isL = (r) => /lycra/.test(String(r.spin || ''));
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };

function ridge(X, y, lam) {
  const n = X.length, p = X[0].length, mu = Array(p).fill(0), sd = Array(p).fill(0);
  X.forEach((r) => r.forEach((v, j) => { mu[j] += v / n; }));
  X.forEach((r) => r.forEach((v, j) => { sd[j] += (v - mu[j]) ** 2 / n; }));
  sd.forEach((s, j) => { sd[j] = Math.sqrt(s) || 1; });
  const Z = X.map((r) => r.map((v, j) => (v - mu[j]) / sd[j])), ym = y.reduce((a, b) => a + b, 0) / n;
  const A = Array.from({ length: p }, () => Array(p).fill(0)), b = Array(p).fill(0);
  Z.forEach((r, i) => { for (let a = 0; a < p; a++) { b[a] += r[a] * (y[i] - ym); for (let c = 0; c < p; c++) A[a][c] += r[a] * r[c]; } });
  for (let a = 0; a < p; a++) A[a][a] += lam;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < p; i++) { let m = i; for (let k = i + 1; k < p; k++) if (Math.abs(M[k][i]) > Math.abs(M[m][i])) m = k; [M[i], M[m]] = [M[m], M[i]]; for (let k = i + 1; k < p; k++) { const f = M[k][i] / M[i][i]; for (let c = i; c <= p; c++) M[k][c] -= f * M[i][c]; } }
  const w = Array(p).fill(0);
  for (let i = p - 1; i >= 0; i--) { let s = M[i][p]; for (let c = i + 1; c < p; c++) s -= M[i][c] * w[c]; w[i] = s / M[i][i]; }
  return (x) => ym + x.reduce((t, v, j) => t + w[j] * (v - mu[j]) / sd[j], 0);
}

function run() {
  const tex = (r) => 590.5 / r.ne;
  const rows = FACTORY_RECORDS.filter((r) => r.sl > 0 && r.ne > 0 && r.fgsm > 0 && r.fdia > 0 && r.dia > 0 && r.g > 0).map((r) => ({
    fam: r.fab + (isL(r) ? '+L' : ''),
    lkw: Math.log((Math.PI * r.dia * r.g * (r.sl / 10)) / (r.fdia * 2.54)), lks: Math.log((10 * r.fgsm * (r.sl / 10)) / tex(r)),
    f: { tf: [Math.log(Math.sqrt(tex(r)) / (r.sl / 10))], big: [Math.log(Math.sqrt(tex(r)) / (r.sl / 10)), Math.log(r.g), Math.log(r.dia), Math.log(r.ne)] },
  }));
  const out = [];
  for (const fam of [...new Set(rows.map((r) => r.fam))]) {
    const S = rows.filter((r) => r.fam === fam); if (S.length < 30) continue;
    const row = { family: fam, n: S.length };
    for (const t of ['lkw', 'lks']) {
      const res = {};
      for (const m of ['none', 'tf', 'big']) {
        const errs = [];
        for (let f = 0; f < 5; f++) {
          const tr = S.filter((_, i) => i % 5 !== f), te = S.filter((_, i) => i % 5 === f);
          if (m === 'none') { const c = med(tr.map((x) => x[t])); te.forEach((x) => errs.push(Math.abs(Math.exp(c - x[t]) - 1))); }
          else { const g = ridge(tr.map((x) => x.f[m]), tr.map((x) => x[t]), 3); te.forEach((x) => errs.push(Math.abs(Math.exp(g(x.f[m]) - x[t]) - 1))); }
        }
        res[m] = Math.round(med(errs) * 1000) / 10;
      }
      row[t === 'lkw' ? 'width_const_err_pct' : 'weight_const_err_pct'] = res;
    }
    out.push(row);
  }
  return out;
}
module.exports = { run };
if (require.main === module) for (const r of run()) console.log(JSON.stringify(r));
