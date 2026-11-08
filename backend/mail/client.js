/**
 * Outbound mail over SMTP. Defaults to the cPanel mailbox
 * (mail.onlinetextileschool.com:465); any SMTP relay works by changing .env
 * alone — a transactional sender (Brevo, Amazon SES, Mailgun, Postmark) on
 * port 587 lands in the inbox far more reliably than a shared hosting IP:
 *
 *   MAIL_HOST, MAIL_USER, MAIL_PASSWORD   required
 *   MAIL_SMTP_PORT                        465 (implicit TLS) or 587 (STARTTLS)
 *   MAIL_FROM                             sender address if MAIL_USER is a
 *                                         login rather than an address (relays)
 *   MAIL_FROM_NAME                        default "KnitAdvisor"
 *   MAIL_REPLY_TO                         where a reply should go
 *
 * One pooled transport, verified once at boot, so a code mail does not pay
 * for a fresh TLS handshake each time.
 */
const nodemailer = require('nodemailer');

const REQUIRED = ['MAIL_HOST', 'MAIL_USER', 'MAIL_PASSWORD'];

let transporter = null;
let configWarned = false;

function isConfigured() {
  return REQUIRED.every(k => !!process.env[k]);
}

function fromAddress() {
  return process.env.MAIL_FROM || process.env.MAIL_USER;
}

function getTransporter() {
  if (transporter) return transporter;
  if (!isConfigured()) return null;
  const port = parseInt(process.env.MAIL_SMTP_PORT, 10) || 465;
  const domain = String(fromAddress()).split('@')[1] || undefined;
  transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port,
    secure: port === 465,          // 465 is implicit TLS; 587/25 upgrade with STARTTLS
    requireTLS: port !== 465,
    auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASSWORD },
    pool: true, maxConnections: 2, maxMessages: 100,
    // greet the server with our own domain rather than the shared host's name
    name: domain,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
  });
  return transporter;
}

/** Opens the pool and checks the login once at boot; logs, never throws. */
async function warmUp() {
  const t = getTransporter();
  if (!t) return false;
  try { await t.verify(); console.log(`[Mail] SMTP ready (${process.env.MAIL_HOST})`); return true; }
  catch (err) { console.error('[Mail] SMTP check failed:', err.message); return false; }
}

/**
 * @returns {Promise<{sent: boolean, reason?: string}>} never throws — a mail
 *   failure must not break the signup/reset request it was triggered from.
 */
async function sendMail({ to, subject, html, text }) {
  const t = getTransporter();
  if (!t) {
    if (!configWarned) {
      configWarned = true;
      console.warn('[Mail] Not configured — set MAIL_HOST/MAIL_USER/MAIL_PASSWORD in .env. Emails will not be sent.');
    }
    return { sent: false, reason: 'not_configured' };
  }
  const started = Date.now();
  try {
    await t.sendMail({
      from: { name: process.env.MAIL_FROM_NAME || 'KnitAdvisor', address: fromAddress() },
      replyTo: process.env.MAIL_REPLY_TO || undefined,
      to, subject, html,
      text: text || html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(),
      // transactional, not marketing: tells mail systems not to auto-reply
      headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
    });
    const ms = Date.now() - started;
    if (ms > 4000) console.warn(`[Mail] Slow SMTP hand-off: ${ms} ms to ${process.env.MAIL_HOST}`);
    return { sent: true };
  } catch (err) {
    console.error('[Mail] Send failed:', err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendMail, isConfigured, warmUp };
