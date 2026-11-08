/**
 * Email bodies. Deliberately plain — a table-based layout with inline styles
 * only, no external images or stylesheets, so it renders the same in Gmail,
 * Outlook and a plain-text fallback without anything to fail to load.
 */
const { CODE_TTL_MINUTES } = require('../engine/domain/otp');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// A complete HTML document (doctype, charset, a hidden preheader that shows as
// the inbox preview line). A bare <div> fragment renders, but some filters
// score a document-less HTML body as suspicious.
function shell(title, bodyHtml, preheader = '') {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#F3F4F6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#F3F4F6;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border:1px solid #E4E6E9;border-radius:10px;">
<tr><td style="padding:28px 28px 8px;font-family:-apple-system,'Segoe UI',Arial,sans-serif;color:#191C1F;">
  <div style="font-weight:800;font-size:17px;letter-spacing:-0.01em;margin-bottom:20px;">Knit<span style="color:#1857C4;">Advisor</span></div>
  <h1 style="font-size:19px;line-height:1.3;margin:0 0 14px;">${esc(title)}</h1>
  ${bodyHtml}
</td></tr>
<tr><td style="padding:0 28px 24px;font-family:-apple-system,'Segoe UI',Arial,sans-serif;">
  <p style="font-size:12px;line-height:1.5;color:#868C94;margin:24px 0 0;border-top:1px solid #E4E6E9;padding-top:14px;">
    KnitAdvisor &middot; knitadvisor.onlinetextileschool.com<br>You received this because of an action on your KnitAdvisor account. If it was not you, ignore this email — nothing changes without the code.
  </p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function codeBlock(code) {
  return `<div style="font-family:Consolas,'Courier New',monospace;font-size:32px;font-weight:700;color:#191C1F;
    letter-spacing:8px;background:#F6F7F8;border:1px solid #E4E6E9;border-radius:8px;
    padding:16px 20px;text-align:center;margin:18px 0;">${esc(code)}</div>`;
}

// One shape for every code mail: the code in the subject (readable from the
// notification without opening the mail), a matching plain-text part written
// out rather than stripped from the HTML.
function codeMail({ fullName, code, title, lead, after, subjectWhat }) {
  const name = fullName || 'there';
  const html = shell(title, `
    <p style="font-size:14px;line-height:1.6;margin:0 0 8px;">Hi ${esc(name)},</p>
    <p style="font-size:14px;line-height:1.6;margin:0;">${esc(lead)}</p>
    ${codeBlock(code)}
    <p style="font-size:13px;line-height:1.5;color:#565C64;margin:0;">${esc(after)}</p>
  `, `${code} — ${lead}`);
  const text = `Hi ${name},\n\n${lead}\n\n    ${code}\n\n${after}\n\nIf this was not you, ignore this email — nothing changes without the code.\n\nKnitAdvisor — knitadvisor.onlinetextileschool.com`;
  return { subject: `${code} is your KnitAdvisor ${subjectWhat}`, html, text };
}

function activationEmail({ fullName, code }) {
  return codeMail({ fullName, code, title: 'Confirm your email', subjectWhat: 'activation code',
    lead: 'Enter this code to activate your KnitAdvisor account:',
    after: `The code expires in ${CODE_TTL_MINUTES} minutes.` });
}

function passwordResetEmail({ fullName, code }) {
  return codeMail({ fullName, code, title: 'Reset your password', subjectWhat: 'password reset code',
    lead: 'Use this code to set a new KnitAdvisor password:',
    after: `The code expires in ${CODE_TTL_MINUTES} minutes. Your password does not change unless you enter it.` });
}

function loginCodeEmail({ fullName, code }) {
  return codeMail({ fullName, code, title: 'Your sign-in code', subjectWhat: 'sign-in code',
    lead: 'You turned on two-step sign-in. Enter this code to finish signing in:',
    after: `The code expires in ${CODE_TTL_MINUTES} minutes. If you did not just sign in, change your password.` });
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
  return codeMail({ fullName, code, title: 'Verify your university email', subjectWhat: 'student verification code',
    lead: "Enter this code to confirm this university email is yours, as part of applying for KnitAdvisor's free student plan:",
    after: `The code expires in ${CODE_TTL_MINUTES} minutes.` });
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
  studentRevokedEmail, studentExpiredEmail, loginCodeEmail,
};
