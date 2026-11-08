/**
 * Issues a one-time code (activation, password_reset, student_email, login),
 * stores its hash, and mails it — the one path every flow uses, so there is
 * exactly one place that decides how a code is generated, stored and delivered.
 *
 * The code is stored before the response goes back; the mail is handed to
 * SMTP in the background. The person sees the code screen at once instead of
 * waiting on the mail server, and the code is valid the moment it lands.
 */
const userRepo = require('../db/repositories/user-repo');
const { issueCode } = require('../engine/domain/otp');
const mailClient = require('../mail/client');
const { activationEmail, passwordResetEmail, studentEmailCodeEmail, loginCodeEmail, emailChangeCodeEmail } = require('../mail/templates');

const BUILDERS = {
  activation: activationEmail,
  password_reset: passwordResetEmail,
  student_email: studentEmailCodeEmail,
  login: loginCodeEmail,
  email_change: emailChangeCodeEmail,
};

/**
 * @param {number} userId
 * @param {'activation'|'password_reset'|'student_email'|'login'} purpose
 * @param {{to: string, fullName?: string}} recipient
 * @param {{wait?: boolean}} [opts]  wait: true to await delivery (admin tools, tests)
 * @returns {Promise<{sent: boolean|null, reason?: string}>} never throws on mail
 *   failure; sent is null when delivery was left running in the background.
 */
async function issueAndSend(userId, purpose, { to, fullName }, opts = {}) {
  const { code, hash, expiresAt } = issueCode();
  await userRepo.codes.create(userId, purpose, hash, expiresAt);
  const build = BUILDERS[purpose] || passwordResetEmail;
  const { subject, html, text } = build({ fullName, code });
  const delivery = mailClient.sendMail({ to, subject, html, text }).then((result) => {
    if (!result.sent) console.error(`[Auth] Could not email ${purpose} code to ${to}: ${result.reason}`);
    return result;
  });
  if (opts.wait) return delivery;
  delivery.catch(() => {});
  return { sent: null };
}

module.exports = { issueAndSend };
