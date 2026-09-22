/**
 * Student plan rules — pure, no I/O.
 *
 * Two independent decisions live here:
 *
 *   1. matchUniversityDomain() — does a submitted email belong to one of the
 *      admin's allow-listed universities? Matched by EXACT equality of the
 *      part after '@', never a suffix/wildcard. A disposable "edu-like"
 *      domain someone registers themselves can never match unless an admin
 *      adds it to the allow-list by hand — that is the actual fraud control,
 *      not the matching logic.
 *
 *   2. resolveOutcome() — given what a verification attempt has proven so
 *      far, what should its status become? The "auto" path (real university,
 *      code-verified email, document on file) skips the review queue
 *      entirely; anything else — including a document-only submission for a
 *      university not on the allow-list — lands in the queue for a human.
 *
 *   3. resolvePlanLimits() — a signed-in user's daily request ceiling. Admin-
 *      flagged paid accounts are unlimited; a currently-active, unexpired
 *      student gets the student ceiling; everyone else gets the free
 *      ceiling.
 */

const FREE_DAILY_LIMIT = 5;
const STUDENT_DAILY_LIMIT = 30;
const STUDENT_DURATION_DAYS = 365;

/** @returns {string} lower-cased text after the last '@', or '' if there is none. */
function normalizeDomain(email) {
  const s = String(email || '').trim();
  const at = s.lastIndexOf('@');
  return at === -1 ? '' : s.slice(at + 1).toLowerCase();
}

/**
 * @param {string} email
 * @param {Array<{domain: string, active: boolean}>} universities
 * @returns {object|null} the matching allow-list row, or null
 */
function matchUniversityDomain(email, universities) {
  const domain = normalizeDomain(email);
  if (!domain || !Array.isArray(universities)) return null;
  return universities.find(u => u && u.active && String(u.domain || '').toLowerCase() === domain) || null;
}

/**
 * @param {{universityMatched: boolean, emailVerified: boolean, hasDocument: boolean}} state
 * @returns {'active'|'pending'|null} null means "not enough submitted yet to decide"
 */
function resolveOutcome({ universityMatched, emailVerified, hasDocument }) {
  if (!hasDocument) return null;
  if (universityMatched && emailVerified) return 'active';
  return 'pending';
}

/**
 * @param {{is_paid?: boolean, student_status?: string, student_expires_at?: string|Date|null}} user
 * @returns {{plan: 'paid'|'student'|'free', dailyLimit: number|null}} dailyLimit
 *   null means unlimited.
 */
function resolvePlanLimits(user) {
  if (user && user.is_paid) return { plan: 'paid', dailyLimit: null };
  if (user && user.student_status === 'active' && user.student_expires_at
      && new Date(user.student_expires_at).getTime() > Date.now()) {
    return { plan: 'student', dailyLimit: STUDENT_DAILY_LIMIT };
  }
  return { plan: 'free', dailyLimit: FREE_DAILY_LIMIT };
}

module.exports = {
  normalizeDomain, matchUniversityDomain, resolveOutcome, resolvePlanLimits,
  FREE_DAILY_LIMIT, STUDENT_DAILY_LIMIT, STUDENT_DURATION_DAYS,
};
