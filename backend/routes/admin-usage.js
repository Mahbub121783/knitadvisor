/**
 * Admin: the usage log and the verdicts on answers (mounted inside /admin).
 *
 *   GET   /api/usage/overview?from=&to=            counts by tool, who used most, failures, who answered
 *   GET   /api/usage/events?from=&to=&tool=&…      requests, newest first
 *   GET   /api/usage/feedback?from=&to=&verdict=   verdicts people gave
 *   PATCH /api/usage/feedback/:id                  mark a verdict dealt with
 *   GET   /api/usage/export?from=&to=&format=      json (for review: inputs, answers, verdicts) or csv (for a spreadsheet)
 *
 * Without from/to everything means today (Dhaka). The export leaves names, e-mails and companies out unless asked
 * (identify=1): the account number is enough to follow one person's requests.
 */
const express = require('express');
const { adminAuth } = require('../middleware/admin-auth');
const repo = require('../db/repositories/usage-log-repo');
const usageLog = require('../services/usage-log');

const router = express.Router();
const BATCH = 500, MAX_ROWS = 100000;

const wrap = (what, fn) => async (req, res) => {
  try { const out = await fn(req, res); if (out !== undefined) res.json(out); } catch (err) {
    console.error(`[Admin usage] ${what}:`, err.message);
    if (res.headersSent) return res.destroy();
    res.status(500).json({ error: `Could not ${what}.` });
  }
};
const q = (req) => ({ from: req.query.from, to: req.query.to });

router.get('/api/usage/overview', adminAuth, wrap('load the usage', async (req) => ({
  recording: usageLog.enabled(), ...(await repo.events.overview(q(req))), feedback: await repo.feedback.counts(q(req)),
})));

router.get('/api/usage/events', adminAuth, wrap('load the requests', async (req) => repo.events.list({
  ...q(req), tool: req.query.tool || undefined, search: req.query.search || undefined, errors: req.query.errors === '1',
  userId: parseInt(req.query.user_id, 10) || undefined, page: req.query.page, limit: req.query.limit,
})));

router.get('/api/usage/feedback', adminAuth, wrap('load the verdicts', async (req) => ({
  rows: await repo.feedback.list({ ...q(req), verdict: ['right', 'close', 'wrong'].includes(req.query.verdict) ? req.query.verdict : undefined, open: req.query.open === '1' }),
})));

router.patch('/api/usage/feedback/:id', adminAuth, wrap('update the verdict', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = Number.isInteger(id) && id > 0 ? await repo.feedback.setHandled(id, (req.body || {}).handled === true) : null;
  if (!row) { res.status(404).json({ error: 'Not found.' }); return undefined; }
  return { ok: true, ...row };
}));

// a leading =, +, - or @ makes a spreadsheet read a cell as a formula
const cell = (v) => {
  const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return '"' + (/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replace(/"/g, '""') + '"';
};
const iso = (d) => (d ? new Date(d).toISOString() : '');
const dayOf = (d) => (d instanceof Date ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : String(d).slice(0, 10));
const identified = (r, on) => {
  const { email, full_name, company, ...rest } = r;
  return { ...rest, day: dayOf(r.day), ...(on ? { email, full_name, company } : {}) };
};

const CSV_HEAD = ['day', 'time_utc', 'who', 'plan', 'tool', 'ok', 'error', 'runs', 'steps', 'fabric', 'gsm_asked', 'composition_asked', 'answered_by', 'count', 'stitch_length_mm', 'gauge', 'dia', 'gsm_answer', 'warnings', 'input', 'answer'];
function csvLine(r, identify) {
  const i = r.input || {}, a = r.result || {}, t = i.target || {};
  return [dayOf(r.day), iso(r.last_at), identify && r.email ? r.email : r.actor, r.plan, r.tool, r.ok ? 'yes' : 'no', r.error, r.runs, r.steps,
    a.fabric || a.structure || i.fabric || i.template, t.gsm || i.gsm, t.composition || i.composition, a.by, a.count, a.sl_mm, a.gauge, a.dia, a.gsm,
    (a.warnings || []).join(' | '), i, a].map(cell).join(',');
}

router.get('/api/usage/export', adminAuth, wrap('export the usage', async (req, res) => {
  const format = ['json', 'csv', 'feedback_csv'].includes(req.query.format) ? req.query.format : 'json';
  const identify = req.query.identify === '1';
  const range = q(req);
  const stamp = `${/^\d{4}-\d{2}-\d{2}$/.test(range.from || '') ? range.from : 'today'}${range.to && range.to !== range.from && /^\d{4}-\d{2}-\d{2}$/.test(range.to) ? '_to_' + range.to : ''}`;
  const feedback = (await repo.feedback.list({ ...range, limit: 5000 })).map((r) => identified(r, identify));
  res.setHeader('Content-Disposition', `attachment; filename="knitadvisor-${format === 'feedback_csv' ? 'verdicts' : 'usage'}-${stamp}.${format === 'json' ? 'json' : 'csv'}"`);
  if (format === 'feedback_csv') {
    res.type('text/csv; charset=utf-8');
    const head = ['day', 'time_utc', 'who', 'tool', 'verdict', 'floor_count', 'floor_stitch_length', 'floor_gauge', 'floor_dia', 'floor_gsm', 'floor_yarn', 'note', 'handled', 'shown', 'input'];
    res.send('﻿' + [head.join(',')].concat(feedback.map((f) => [f.day, iso(f.created_at), identify && f.email ? f.email : f.actor, f.tool, f.verdict, f.actual.count, f.actual.sl, f.actual.gauge, f.actual.dia, f.actual.gsm, f.actual.yarn, f.note, f.handled ? 'yes' : 'no', f.shown, f.input].map(cell).join(','))).join('\r\n'));
    return undefined;
  }
  // written a page at a time: a long range never sits in memory at once
  let after = 0, n = 0;
  if (format === 'csv') { res.type('text/csv; charset=utf-8'); res.write('﻿' + CSV_HEAD.join(',') + '\r\n'); } else {
    res.type('application/json; charset=utf-8');
    res.write(`{"meta":${JSON.stringify({ app: 'knitadvisor', kind: 'usage-export', from: range.from || null, to: range.to || null, exported_at: new Date().toISOString(), build: usageLog.build(), identified: identify })},\n"feedback":${JSON.stringify(feedback)},\n"events":[\n`);
  }
  for (;;) {
    const rows = await repo.events.batch({ ...range, after, limit: BATCH });
    if (!rows.length) break;
    const text = format === 'csv' ? rows.map((r) => csvLine(r, identify)).join('\r\n') + '\r\n'
      : (n ? ',\n' : '') + rows.map((r) => JSON.stringify(identified(r, identify))).join(',\n');
    if (!res.write(text)) await new Promise((r) => res.once('drain', r));
    after = rows[rows.length - 1].id; n += rows.length;
    if (rows.length < BATCH || n >= MAX_ROWS) break;
  }
  res.end(format === 'csv' ? '' : `\n],\n"count":${n},"cut_at_limit":${n >= MAX_ROWS}}\n`);
  return undefined;
}));

module.exports = router;
