/**
 * Small shared pieces of account security: who is asking (IP, browser), a
 * readable device name for the account page and alert mails, the record of
 * security events, and the alerts that go to the owner's inbox.
 */
const userRepo = require('../db/repositories/user-repo');
const mailClient = require('../mail/client');
const { newSignInEmail, accountLockedEmail } = require('../mail/templates');

function clientOf(req) {
  return { ip: req.ip || null, userAgent: String(req.headers['user-agent'] || '').slice(0, 300) };
}

/** "Chrome on Windows" — enough for a person to recognise their own device. */
function deviceLabel(ua) {
  const s = String(ua || '');
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /SamsungBrowser/.test(s) ? 'Samsung Internet'
    : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'A browser';
  const os = /Windows/.test(s) ? 'Windows' : /Android/.test(s) ? 'Android' : /iPhone|iPad|iPod/.test(s) ? 'iPhone / iPad'
    : /Mac OS X|Macintosh/.test(s) ? 'macOS' : /Linux/.test(s) ? 'Linux' : 'an unknown system';
  return `${browser} on ${os}`;
}

/** Never throws — a logging hiccup must not break the request it records. */
function record(userId, kind, req, detail = null) {
  const c = req ? clientOf(req) : {};
  return userRepo.events.add(userId, kind, { ip: c.ip, userAgent: c.userAgent, detail })
    .catch((err) => console.error(`[Security] could not record ${kind}:`, err.message));
}

function stamp() {
  return new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', dateStyle: 'medium', timeStyle: 'short' }) + ' (Dhaka)';
}

/** A sign-in from a browser + network this account has not used in 90 days. */
async function alertIfNewDevice(user, req) {
  try {
    const c = clientOf(req);
    const known = await userRepo.sessions.knownDevice(user.id, c.ip, c.userAgent);
    if (known) return false;
    const { subject, html, text } = newSignInEmail({ fullName: user.full_name, device: deviceLabel(c.userAgent), ip: c.ip, when: stamp() });
    mailClient.sendMail({ to: user.email, subject, html, text }).catch(() => {});
    return true;
  } catch (err) {
    console.error('[Security] new-device check failed:', err.message);
    return false;
  }
}

function alertLocked(user, req, minutes) {
  const c = clientOf(req);
  const { subject, html, text } = accountLockedEmail({ fullName: user.full_name, minutes, ip: c.ip, when: stamp() });
  mailClient.sendMail({ to: user.email, subject, html, text }).catch(() => {});
}

module.exports = { clientOf, deviceLabel, record, alertIfNewDevice, alertLocked };
