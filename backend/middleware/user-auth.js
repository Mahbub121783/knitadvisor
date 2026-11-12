/**
 * Customer session gate.
 *
 * The token lives in an HttpOnly cookie rather than localStorage, so a script
 * injected into any page cannot read it, and every existing same-origin fetch
 * carries it without touching each call site. SameSite=Lax plus JSON-only
 * bodies (express.json ignores form posts, and a cross-site JSON POST needs a
 * CORS preflight that this app refuses) covers CSRF for the state-changing
 * routes.
 *
 * No cookie-parser dependency: FTP deploys never run `npm install` on the
 * host, so a new package means a production outage unless installed by hand
 * first, and reading one cookie needs eight lines.
 */
const crypto = require('crypto');
const userRepo = require('../db/repositories/user-repo');

const COOKIE_NAME = 'ka_session';

function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function newToken() {
  const rawToken = crypto.randomBytes(32).toString('hex');
  return { rawToken, tokenHash: hashToken(rawToken) };
}

function setSessionCookie(req, res, rawToken, maxAgeSeconds) {
  res.cookie(COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure, // trust proxy is on, so this is true behind the host's TLS terminator
    path: '/',
    maxAge: maxAgeSeconds * 1000,
  });
}

function clearSessionCookie(req, res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/' });
}

/** Resolves req.user from the cookie, or null. Never sends a response. */
async function loadUser(req) {
  const token = readCookie(req.headers.cookie, COOKIE_NAME);
  if (!token || token.length !== 64) return null;
  return userRepo.sessions.findUserByTokenHash(hashToken(token));
}

async function requireUser(req, res, next) {
  // a customer's own system calling the engines with an API key (never a browser session)
  if (req.apiKey && req.user) return next();           // /api/v1 already checked and counted this key
  const rawKey = require('../db/repositories/api-key-repo').keyFromRequest(req);
  if (rawKey) return require('./api-key-auth').gate(req, res, next, rawKey);
  try {
    const user = await loadUser(req);
    if (user) {
      req.user = user;
      req.sessionTokenHash = hashToken(readCookie(req.headers.cookie, COOKIE_NAME));
      // "last active" for the account's device list; at most one write per 10 min
      userRepo.sessions.touch(req.sessionTokenHash).catch(() => {});
      return next();
    }
  } catch (err) {
    console.error('[UserAuth] Session lookup failed:', err.message);
    return res.status(500).json({ success: false, error: 'Could not verify your session. Please try again.' });
  }
  // No session. On an open-access day (switched on in the admin panel) the
  // tools that compute are open to everyone as a guest; anything that saves or
  // reads an account stays closed, with its own code so the page explains
  // rather than sending the visitor to a sign-in form. See services/open-access.js.
  const openAccess = require('../services/open-access');
  const oa = openAccess.read();
  if (openAccess.active(oa)) {
    const route = (req.baseUrl || '') + req.path;
    const tool = openAccess.toolFor(req.method, route, oa);
    if (tool) {
      if (!openAccess.rateOk(req.ip, oa.per_hour)) {
        return res.status(429).json({ success: false, code: 'GUEST_RATE', error: 'That is a lot of calculations from one place in an hour. Wait a little, or create a free account.' });
      }
      req.user = openAccess.guestUser();
      req.guest = true;
      openAccess.log(req, tool, route);
      return next();
    }
    return res.status(401).json({
      success: false,
      code: 'GUEST_LOCKED',
      error: `${oa.label || 'Open access'}: the tools are open to everyone today, but saving and your own account need a free sign-in.`,
    });
  }
  return res.status(401).json({
    success: false,
    code: 'AUTH_REQUIRED',
    error: 'Please sign in to use the calculator.',
  });
}

module.exports = {
  COOKIE_NAME, readCookie, hashToken, newToken,
  setSessionCookie, clearSessionCookie, loadUser, requireUser,
};
