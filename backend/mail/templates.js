/**
 * Email bodies. Deliberately plain — a table-based layout with inline styles
 * only, no external images or stylesheets, so it renders the same in Gmail,
 * Outlook and a plain-text fallback without anything to fail to load.
 */
const { CODE_TTL_MINUTES } = require('../engine/domain/otp');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function shell(title, bodyHtml) {
  return `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#191C1F;">
    <div style="font-weight:800;font-size:17px;letter-spacing:-0.01em;margin-bottom:22px;">Knit<span style="color:#1857C4;">Advisor</span></div>
    <h1 style="font-size:19px;margin:0 0 14px;">${esc(title)}</h1>
    ${bodyHtml}
    <p style="font-size:12px;color:#868C94;margin-top:32px;border-top:1px solid #E4E6E9;padding-top:16px;">
      KnitAdvisor &middot; Part of Online Textile School. If you did not request this, you can ignore this email.
    </p>
  </div>`;
}

function codeBlock(code) {
  return `<div style="font-family:'IBM Plex Mono',ui-monospace,Consolas,monospace;font-size:32px;font-weight:700;
    letter-spacing:6px;background:#F6F7F8;border:1px solid #E4E6E9;border-radius:8px;
    padding:16px 20px;text-align:center;margin:18px 0;">${esc(code)}</div>`;
}

function activationEmail({ fullName, code }) {
  const html = shell('Confirm your email', `
    <p style="font-size:14px;line-height:1.6;">Hi ${esc(fullName || 'there')},</p>
    <p style="font-size:14px;line-height:1.6;">Enter this code to activate your KnitAdvisor account:</p>
    ${codeBlock(code)}
    <p style="font-size:13px;color:#565C64;">This code expires in ${CODE_TTL_MINUTES} minutes.</p>
  `);
  return { subject: 'Your KnitAdvisor activation code', html };
}

function passwordResetEmail({ fullName, code }) {
  const html = shell('Reset your password', `
    <p style="font-size:14px;line-height:1.6;">Hi ${esc(fullName || 'there')},</p>
    <p style="font-size:14px;line-height:1.6;">Use this code to reset your KnitAdvisor password:</p>
    ${codeBlock(code)}
    <p style="font-size:13px;color:#565C64;">This code expires in ${CODE_TTL_MINUTES} minutes. Your password will not change unless you enter it.</p>
  `);
  return { subject: 'Your KnitAdvisor password reset code', html };
}

function passwordChangedByAdminEmail({ fullName }) {
  const html = shell('Your password was changed', `
    <p style="font-size:14px;line-height:1.6;">Hi ${esc(fullName || 'there')},</p>
    <p style="font-size:14px;line-height:1.6;">A KnitAdvisor administrator has set a new password for your account. Every other device you were signed in on has been signed out.</p>
    <p style="font-size:13px;color:#565C64;">If you were not expecting this, contact us straight away.</p>
  `);
  return { subject: 'Your KnitAdvisor password was changed', html };
}

function emailChangedNoticeEmail({ fullName, newEmail }) {
  const html = shell('Your account email was changed', `
    <p style="font-size:14px;line-height:1.6;">Hi ${esc(fullName || 'there')},</p>
    <p style="font-size:14px;line-height:1.6;">A KnitAdvisor administrator changed the sign-in email on your account to <b>${esc(newEmail)}</b>.</p>
    <p style="font-size:13px;color:#565C64;">If you were not expecting this, contact us straight away.</p>
  `);
  return { subject: 'Your KnitAdvisor account email was changed', html };
}

module.exports = { activationEmail, passwordResetEmail, passwordChangedByAdminEmail, emailChangedNoticeEmail };
