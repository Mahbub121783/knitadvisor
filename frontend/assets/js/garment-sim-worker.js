/**
 * The cloth simulation on a thread of its own, so the page stays smooth while the cloth settles.
 * It runs in the visitor's browser (nothing here touches the server) and is gentle: it works in short slices with a pause between them, stops as soon as the cloth is still,
 * and does nothing at all while there is no job.
 *
 *   in:  { type: 'run', token, doc, drape, target, min, tol, every }   the garment document, the stiffness settings, how many steps at most
 *        { type: 'stop' }
 *   out: { type: 'x', token, step, total, X }                          the points, now (transferred, not copied)
 *        { type: 'done', token, step, X, stats, fit }                  the cloth is still, or the steps are used
 *        { type: 'error', token, message }
 */
/* global importScripts, KASim */
'use strict';
importScripts('garment-sim.js');

let cloth = null, job = null, timer = 0;
const chan = new MessageChannel(); let queued = false; chan.port1.onmessage = () => { queued = false; slice(); }; const next = () => { if (!queued) { queued = true; chan.port2.postMessage(0); } };
// how the seams closed: the mean gap and the 95th percentile (the single worst pair is often where a seam crosses the top of a shoulder)
function gaps() { const g = [], X = cloth.X, S = cloth.ss; for (let e = 0; e < S.length; e += 2) { const a = 3 * S[e], b = 3 * S[e + 1]; g.push(Math.hypot(X[a] - X[b], X[a + 1] - X[b + 1], X[a + 2] - X[b + 2])); } g.sort((x, y) => x - y); return g.length ? { mean: g.reduce((t, v) => t + v, 0) / g.length, p95: g[Math.floor(g.length * 0.95)], max: g[g.length - 1] } : { mean: 0, p95: 0, max: 0 }; }

function slice() {
  if (!job || !cloth) return;
  const t0 = performance.now(), j = job;
  try {
    while (performance.now() - t0 < 22 && j.step < j.target) {
      cloth.step(); j.step++;
      if (j.step >= j.min && j.step % 10 === 0) { const X = cloth.X, Q = cloth.Q; let mv = 0; for (let i = 0; i < cloth.N; i++) mv += Math.abs(X[3 * i] - Q[3 * i]) + Math.abs(X[3 * i + 1] - Q[3 * i + 1]) + Math.abs(X[3 * i + 2] - Q[3 * i + 2]); j.calm = mv / cloth.N < j.tol ? j.calm + 1 : 0; if (j.calm >= 2) { j.target = j.step; break; } }
    }
    const X = new Float32Array(cloth.X);
    if (j.step >= j.target) { job = null; postMessage({ type: 'done', token: j.token, step: j.step, X, stats: cloth.stats(), fit: cloth.fitReport(), gaps: gaps() }, [X.buffer]); return; }
    if (j.step - j.sent >= j.every) { j.sent = j.step; postMessage({ type: 'x', token: j.token, step: j.step, total: j.target, X }, [X.buffer]); }
    next();                                                       // the next slice (a message to ourselves: a timer would be slowed to once a second while the tab is in the background)
  } catch (err) { job = null; postMessage({ type: 'error', token: j.token, message: String(err && err.message || err) }); }
}

onmessage = (e) => {
  const m = e.data || {};
  if (m.type === 'stop') { job = null; return; }
  if (m.type !== 'run') return;
  try {
    const b = KASim.fromDoc(m.doc); cloth = new KASim.Cloth(b.insts, b.body, Object.assign({}, m.drape || KASim.DRAPE.medium, b.opt));
    job = { token: m.token, step: 0, target: m.target || 300, min: m.min || 60, tol: m.tol || 0.004, calm: 0, every: m.every || 3, sent: 0 };
    postMessage({ type: 'ready', token: m.token }); next();
  } catch (err) { job = null; postMessage({ type: 'error', token: m.token, message: String(err && err.message || err) }); }
};
