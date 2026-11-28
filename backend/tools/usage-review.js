/**
 * Reads a day's export from the admin panel (Usage & accuracy → Download for review) and sets out what to correct:
 * what failed, the verdicts against what the engines answer today, and which logged answers the current build
 * would now give differently.
 *
 *   node tools/usage-review.js knitadvisor-usage-2026-11-27.json [more.json …] [--out review.md]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const OUT = outAt >= 0 ? args.splice(outAt, 2)[1] : null;
if (!args.length) { console.error('usage: node tools/usage-review.js <export.json> [more.json …] [--out review.md]'); process.exit(1); }

console.warn = () => {};
const { calculate, ENGINE_INPUTS } = require('../engine');
const studio = require('../engine/domain/fabric-studio');
const C = require('../engine/domain/usage-capture');

const files = args.map((f) => JSON.parse(fs.readFileSync(path.resolve(f), 'utf8')));
const events = files.flatMap((f) => f.events || []), verdicts = files.flatMap((f) => f.feedback || []);
const lines = [];
const say = (s = '') => lines.push(s);
const count = (list, key) => { const m = new Map(); list.forEach((x) => { const k = key(x); if (k != null) m.set(k, (m.get(k) || 0) + 1); }); return [...m].sort((a, b) => b[1] - a[1]); };
const short = (v, n = 220) => { const s = JSON.stringify(v); return s && s.length > n ? s.slice(0, n) + '…' : s; };

/** The answer today's build gives to a logged request, in the same shape as the log's. */
function now(tool, input) {
  if (!input || input.too_large) return null;
  try {
    if (tool === 'calculate') {
      const p = {};
      for (const k of ENGINE_INPUTS) if (input[k] !== undefined && input[k] !== '(not kept)') p[k] = input[k];
      p.fabric = input.fabric; p.gsm = parseFloat(input.gsm); p.efficiency = input.efficiency || 85;
      return C.summarise(tool, calculate(p));
    }
    if (tool === 'studio/analyse') return C.summarise(tool, studio.analyse({ ...input, floor: undefined, floor_machine_id: undefined, core_engines: true }));
  } catch (err) { return { error: 'threw: ' + err.message }; }
  return null;
}
const neOf = (s) => { const m = String(s || '').match(/(?:\d+\s*\/\s*)?(\d+(?:\.\d+)?)\s*(?:\/\s*\d+|s\b)/i) || String(s || '').match(/(\d+(?:\.\d+)?)/); if (!m) return null; const two = String(s).match(/^\s*(\d+)\s*\/\s*(\d+)/); return two ? (+two[1] <= 4 && +two[2] > 4 ? +two[2] : +two[1]) : +m[1]; };
const pct = (a, b) => (a > 0 && b > 0 ? Math.round(1000 * (a / b - 1)) / 10 : null);
const answerLine = (a) => (!a ? '—' : a.error ? 'error: ' + a.error : [a.count, a.sl_mm && a.sl_mm + ' mm', a.gauge && a.gauge + ' GG', a.by].filter(Boolean).join(' · '));

say(`# Usage review — ${files.map((f) => `${f.meta.from || 'today'}${f.meta.to && f.meta.to !== f.meta.from ? '…' + f.meta.to : ''}`).join(', ')}`);
say();
say(`${events.length} distinct requests from ${new Set(events.map((e) => e.actor)).size} people; ${events.filter((e) => !e.ok).length} failed; ${verdicts.length} verdicts (${count(verdicts, (v) => v.verdict).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}).`);
say(`Logged on build(s): ${count(events, (e) => (e.build || '').slice(0, 10)).map(([k, n]) => `${k || '?'} (${n})`).join(', ') || '—'}.`);
say();
say('## Tools');
count(events, (e) => e.tool).forEach(([t, n]) => say(`- ${t}: ${n} (${events.filter((e) => e.tool === t && !e.ok).length} failed)`));

const answers = events.filter((e) => e.ok && (e.tool === 'calculate' || e.tool === 'studio/analyse'));
say();
say('## What was asked (calculator and Studio)');
count(answers, (e) => `${(e.result.fabric || e.result.structure || e.input.fabric || '?')} — ${e.result.by || '?'}`).slice(0, 25).forEach(([k, n]) => say(`- ${k}: ${n}`));

say();
say('## Failures');
const fails = events.filter((e) => !e.ok);
if (!fails.length) say('None.');
count(fails, (e) => `${e.tool} | ${e.status} | ${e.error}`).slice(0, 30).forEach(([k, n]) => {
  const ex = fails.find((e) => `${e.tool} | ${e.status} | ${e.error}` === k);
  const today = now(ex.tool, ex.input);
  say(`- ×${n} ${k}`);
  say(`  - example: \`${short(ex.input)}\``);
  if (today) say(`  - today: ${answerLine(today)}`);
});

say();
say('## Verdicts that say wrong or close');
const bad = verdicts.filter((v) => v.verdict !== 'right');
if (!bad.length) say('None.');
bad.forEach((v, i) => {
  const today = now(v.tool, v.input);
  const floor = v.actual || {};
  say(`### ${i + 1}. ${v.verdict.toUpperCase()} — ${v.tool} — ${(v.shown && (v.shown.structure || '')) || v.input.fabric || v.input.template || ''} ${(v.input.gsm || (v.input.target || {}).gsm || '')} GSM ${v.input.composition || (v.input.target || {}).composition || ''}`);
  say(`- shown: ${answerLine(v.shown)}`);
  say(`- their floor: ${Object.entries(floor).map(([k, x]) => `${k} ${x}`).join(', ') || '—'}${v.note ? ` — “${v.note}”` : ''}`);
  say(`- today: ${answerLine(today)}`);
  const slF = parseFloat(floor.sl), neF = neOf(floor.count), gF = parseFloat(floor.gauge);
  const gap = (a) => [neF && a && neOf(a.count) ? `count ${neOf(a.count)} vs ${neF}` : null, slF && a && a.sl_mm ? `stitch length ${pct(a.sl_mm, slF) > 0 ? '+' : ''}${pct(a.sl_mm, slF)} %` : null, gF && a && a.gauge ? `gauge ${a.gauge} vs ${gF}` : null].filter(Boolean).join('; ');
  if (slF || neF || gF) say(`- difference from their floor: shown ${gap(v.shown) || '—'} | today ${gap(today) || '—'}`);
  say(`- request: \`${short(v.input, 600)}\``);
});

say();
say('## Verdicts that say right');
count(verdicts.filter((v) => v.verdict === 'right'), (v) => `${v.input.fabric || v.input.template || (v.shown || {}).structure} @ ${v.input.gsm || (v.input.target || {}).gsm} — ${answerLine(v.shown)}`).forEach(([k, n]) => say(`- ${k}${n > 1 ? ` ×${n}` : ''}`));

say();
say('## Re-run today: answers that differ from what was shown');
let same = 0; const changed = [];
for (const e of answers) {
  if (e.result.by === 'work orders') continue;           // only the accounts allowed see those: not re-run here
  const a = now(e.tool, e.input);
  if (!a) continue;
  const diff = a.error || a.count !== e.result.count || a.gauge !== e.result.gauge || (a.sl_mm && e.result.sl_mm && Math.abs(pct(a.sl_mm, e.result.sl_mm)) > 0.5);
  if (diff) changed.push({ e, a }); else same += 1;
}
say(`${same} unchanged, ${changed.length} different.`);
changed.slice(0, 40).forEach(({ e, a }) => say(`- ${e.tool} \`${short(e.input, 160)}\`: shown ${answerLine(e.result)} → today ${answerLine(a)}`));

say();
say('## Warnings people saw most');
count(answers.flatMap((e) => (e.result.warnings || []).map((w) => String(w).replace(/[\d.]+/g, 'N').slice(0, 140))), (w) => w).slice(0, 15).forEach(([w, n]) => say(`- ×${n} ${w}`));

const text = lines.join('\n') + '\n';
if (OUT) { fs.writeFileSync(OUT, text); console.log('written', OUT); } else process.stdout.write(text);
