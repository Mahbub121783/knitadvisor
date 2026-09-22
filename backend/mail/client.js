/**
 * Outbound mail — cPanel SMTP (mail.onlinetextileschool.com), not a third-party
 * provider. This is the same mailbox already shown to customers in cPanel's
 * own "Mail Client Manual Settings" page, reused here as the sender rather
 * than adding a new transactional-email vendor and its own account/billing.
 *
 * One transport, created once and reused — nodemailer pools SMTP connections
 * internally, so a fresh transport per request would open a new connection
 * per email instead.
 */
const nodemailer = require('nodemailer');

const REQUIRED = ['MAIL_HOST', 'MAIL_USER', 'MAIL_PASSWORD'];

let transporter = null;
let configWarned = false;

function isConfigured() {
  return REQUIRED.every(k => !!process.env[k]);
}

function getTransporter() {
  if (transporter) return transporter;
  if (!isConfigured()) return null;
  transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: parseInt(process.env.MAIL_SMTP_PORT, 10) || 465,
    secure: true, // port 465 is implicit TLS, not STARTTLS
    auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASSWORD },
    connectionTimeout: 10_000,
  });
  return transporter;
}

/**
 * @returns {Promise<{sent: boolean, reason?: string}>} never throws — a mail
 *   failure must not break the signup/reset request it was triggered from.
 *   Callers decide what "not sent" means for their flow (usually: log it,
 *   still let the codeless parts of the response succeed).
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
  try {
    await t.sendMail({
      from: `"KnitAdvisor" <${process.env.MAIL_USER}>`,
      to, subject, html, text: text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    });
    return { sent: true };
  } catch (err) {
    console.error('[Mail] Send failed:', err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendMail, isConfigured };
