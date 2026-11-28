/**
 * Records what is asked of the engines and what they answer (engine/domain/usage-capture.js decides what is kept),
 * and the verdicts people give on answers. Writing happens after the answer has gone out; a failure here never
 * reaches the person using the tool. USAGE_LOG=off switches it off; USAGE_LOG_RETENTION_DAYS (default 90) sets
 * how long rows are kept.
 */
const crypto = require('crypto');
const capture = require('../engine/domain/usage-capture');
const repo = require('../db/repositories/usage-log-repo');
const { ENGINE_VERSION } = require('../engine/version');

const SALT = process.env.IP_HASH_SALT || crypto.randomBytes(16).toString('hex');
const MAX_PENDING = 25;                       // a slow database drops log rows rather than queueing them up
let pending = 0, prunedOn = null, lastWarned = 0;

const enabled = () => !/^(false|0|off)$/i.test(String(process.env.USAGE_LOG || ''));
const build = () => String(ENGINE_VERSION || '').slice(0, 40);
const hashIp = (ip) => crypto.createHash('sha256').update(SALT + String(ip || '')).digest('hex').slice(0, 24);

function actorOf(req) {
  if (req.apiKey) return { actor: `k:${req.apiKey.id}`, userId: req.user ? req.user.id : null };
  if (req.user && req.user.id && !req.guest) return { actor: `u:${req.user.id}`, userId: req.user.id };
  return { actor: `g:${hashIp(req.ip)}`, userId: null };
}

function warn(message) {
  if (Date.now() - lastWarned < 60000) return;
  lastWarned = Date.now();
  console.error('[Usage] could not record:', message);
}

async function planName(req) {
  if (req.apiKey) return 'api';
  if (req.guest) return 'guest';
  if (!req.user) return null;
  if (req.plan) return req.plan;
  return (await require('./plans').planOf(req.user)).plan;
}

async function note(req, res, tool, body, ms) {
  const status = res.statusCode;
  // refused before any engine looked at it (no sign-in, no such route): nothing to judge
  if (status === 401 || status === 403 || status === 404) return;
  const answer = res.locals.usageSummary || capture.summarise(tool, res.locals.usageAnswer);
  const failed = status >= 400 || !!answer.error;
  const input = capture.cleanInput(tool, body);
  const who = actorOf(req);
  await repo.events.record({
    user_id: who.userId, actor: who.actor, plan: await planName(req), tool,
    input_hash: crypto.createHash('sha1').update(JSON.stringify(input)).digest('hex'),
    input, result: answer, ok: !failed, status, error: failed ? String(answer.error || (res.locals.usageAnswer && res.locals.usageAnswer.error) || `HTTP ${status}`).slice(0, 300) : null,
    ms: Math.max(0, Math.round(ms)), build: build(),
  }, capture.isLive(tool));
  const today = new Date().toISOString().slice(0, 10);
  if (prunedOn !== today) { prunedOn = today; await repo.events.prune(parseInt(process.env.USAGE_LOG_RETENTION_DAYS, 10) || 90); }
}

/** Mounted on /api, ahead of the routes. */
function middleware(req, res, next) {
  const tool = enabled() ? capture.toolFor(req.method, req.path) : null;
  if (!tool) return next();
  const started = Date.now(), body = req.body;
  const json = res.json.bind(res);
  res.json = (data) => { res.locals.usageAnswer = data; return json(data); };
  res.on('finish', () => {
    if (pending >= MAX_PENDING) return;
    pending += 1;
    setImmediate(() => note(req, res, tool, body, Date.now() - started).catch((e) => warn(e.message)).finally(() => { pending -= 1; }));
  });
  return next();
}

/** Stores a verdict (already signed in, or an open-access guest). */
async function addFeedback(req, body) {
  const f = capture.validateFeedback(body);
  const who = actorOf(req);
  return repo.feedback.add({ ...f, user_id: who.userId, actor: who.actor, build: build() });
}

module.exports = { middleware, addFeedback, enabled, actorOf, build };
