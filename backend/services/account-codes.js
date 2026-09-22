/**
 * Issues a one-time code (activation or password_reset), stores its hash,
 * and mails it — the one path both the self-service auth routes and the
 * admin-initiated email change use, so there is exactly one place that
 * decides how a code is generated, stored and delivered.
 */
const userRepo = require('../db/repositories/user-repo');
const { issueCode } = require('../engine/domain/otp');
const mailClient = require('../mail/client');
const { activationEmail, passwordResetEmail, studentEmailCodeEmail } = require('../mail/templates');

const BUILDERS = {
  activation: activationEmail,
  password_reset: passwordResetEmail,
  student_email: studentEmailCodeEmail,
};

/**
 * @param {number} userId
 * @param {'activation'|'password_reset'|'student_email'} purpose
 * @param {{to: string, fullName?: string}} recipient
 * @returns {Promise<{sent: boolean, reason?: string}>} never throws — mail
 *   delivery failing must not fail the request that triggered it.
 */
async function issueAndSend(userId, purpose, { to, fullName }) {
  const { code, hash, expiresAt } = issueCode();
  await userRepo.codes.create(userId, purpose, hash, expiresAt);
  const build = BUILDERS[purpose] || passwordResetEmail;
  const { subject, html } = build({ fullName, code });
  const result = await mailClient.sendMail({ to, subject, html });
  if (!result.sent) console.error(`[Auth] Could not email ${purpose} code to ${to}: ${result.reason}`);
  return result;
}

module.exports = { issueAndSend };
