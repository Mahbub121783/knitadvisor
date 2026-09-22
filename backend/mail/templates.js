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

function studentEmailCodeEmail({ fullName, code }) {
  const html = shell('Verify your university email', `
    <p style="font-size:14px;line-height:1.6;">Hi ${esc(fullName || 'there')},</p>
    <p style="font-size:14px;line-height:1.6;">Enter this code to confirm this university email is yours, as part of applying for KnitAdvisor's free student plan:</p>
    ${codeBlock(code)}
    <p style="font-size:13px;color:#565C64;">This code expires in ${CODE_TTL_MINUTES} minutes.</p>
  `);
  return { subject: 'Your KnitAdvisor student verification code', html };
}

function studentApprovedEmail({ fullName, expiresAt }) {
  const until = expiresAt ? new Date(expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const html = shell('You are verified as a student', `
    <p style="font-size:14px;line-height:1.6;">Hi ${esc(fullName || 'there')},</p>
    <p style="font-size:14px;line-height:1.6;">Your KnitAdvisor student plan is active — ${require('../engine/domain/student-eligibility').STUDENT_DAILY_LIMIT} requests a day, free${until ? `, through <b>${esc(until)}</b>` : ''}.</p>
    <p style="font-size:13px;color:#565C64;">You can re-verify any time before it ends to keep it going.</p>
  `);
  return { subject: 'Your KnitAdvisor student plan is active', html };
}

function studentPendingReviewEmail({ fullName }) {
  const html = shell('Your student application was received', `
    <p style="font-size:14px;line-height:1.6;">Hi ${esc(fullName || 'there')},</p>
    <p style="font-size:14px;line-height:1.6;">We received your student verification and the document you uploaded. Someone on our team will review it shortly — we'll email you the result.</p>
  `);
  return { subject: 'Your KnitAdvisor student application was received', html };
}

function studentRejectedEmail({ fullName, reason }) {
  const html = shell('Your student application was not approved', `
    <p style="font-size:14px;line-height:1.6;">Hi ${esc(fullName || 'there')},</p>
    <p style="font-size:14px;line-height:1.6;">We could not verify your student status${reason ? `: <b>${esc(reason)}</b>` : '.'}</p>
    <p style="font-size:13px;color:#565C64;">You can apply again from your account page with a clearer document or a different university email.</p>
  `);
  return { subject: 'Your KnitAdvisor student application was not approved', html };
}

function studentRevokedEmail({ fullName, reason }) {
  const html = shell('Your student plan was ended', `
    <p style="font-size:14px;line-height:1.6;">Hi ${esc(fullName || 'there')},</p>
    <p style="font-size:14px;line-height:1.6;">A KnitAdvisor administrator ended your student plan${reason ? `: <b>${esc(reason)}</b>` : '.'} Your account is back on the free plan.</p>
    <p style="font-size:13px;color:#565C64;">If you think this is a mistake, reply to this email.</p>
  `);
  return { subject: 'Your KnitAdvisor student plan was ended', html };
}

function studentExpiredEmail({ fullName }) {
  const html = shell('Your student year has ended', `
    <p style="font-size:14px;line-height:1.6;">Hi ${esc(fullName || 'there')},</p>
    <p style="font-size:14px;line-height:1.6;">Your one year of free KnitAdvisor student access has ended, so your account is back on the free plan.</p>
    <p style="font-size:13px;color:#565C64;">Still a student? You can re-verify any time from your account page.</p>
  `);
  return { subject: 'Your KnitAdvisor student year has ended', html };
}

module.exports = {
  activationEmail, passwordResetEmail, passwordChangedByAdminEmail, emailChangedNoticeEmail,
  studentEmailCodeEmail, studentApprovedEmail, studentPendingReviewEmail, studentRejectedEmail,
  studentRevokedEmail, studentExpiredEmail,
};
