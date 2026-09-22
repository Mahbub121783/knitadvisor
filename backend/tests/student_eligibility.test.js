const assert = require('assert');
const {
  normalizeDomain, matchUniversityDomain, resolveOutcome, resolvePlanLimits,
  FREE_DAILY_LIMIT, STUDENT_DAILY_LIMIT,
} = require('../engine/domain/student-eligibility');

console.log('--- Running Student Plan Eligibility Tests ---');

// ── normalizeDomain ──────────────────────────────────────────────────────
{
  assert.strictEqual(normalizeDomain('Student@G.BRACU.AC.BD'), 'g.bracu.ac.bd');
  assert.strictEqual(normalizeDomain('nobody-here'), '');
  assert.strictEqual(normalizeDomain(''), '');
  assert.strictEqual(normalizeDomain(null), '');
  console.log('  normalizeDomain lower-cases and strips the local part');
}

// ── matchUniversityDomain: exact match only, never a suffix ─────────────────
{
  const list = [
    { domain: 'g.bracu.ac.bd', active: true },
    { domain: 'student.buet.ac.bd', active: true },
    { domain: 'old.disabled.edu', active: false },
  ];
  assert.strictEqual(matchUniversityDomain('me@g.bracu.ac.bd', list).domain, 'g.bracu.ac.bd');
  assert.strictEqual(matchUniversityDomain('ME@G.BRACU.AC.BD', list).domain, 'g.bracu.ac.bd', 'case-insensitive');
  assert.strictEqual(matchUniversityDomain('me@old.disabled.edu', list), null, 'an inactive row never matches');
  assert.strictEqual(matchUniversityDomain('me@evil-g.bracu.ac.bd', list), null,
    'a domain that merely ends with a listed domain must NOT match — this is the fraud control');
  assert.strictEqual(matchUniversityDomain('me@fake-edu.tk', list), null, 'an unlisted domain never matches, no matter how it looks');
  assert.strictEqual(matchUniversityDomain('not-an-email', list), null);
  assert.strictEqual(matchUniversityDomain('me@g.bracu.ac.bd', []), null);
  console.log('  matchUniversityDomain matches only an exact, active, allow-listed domain');
}

// ── resolveOutcome ────────────────────────────────────────────────────────
{
  assert.strictEqual(resolveOutcome({ universityMatched: true, emailVerified: true, hasDocument: true }), 'active');
  assert.strictEqual(resolveOutcome({ universityMatched: true, emailVerified: false, hasDocument: true }), 'pending',
    'a matched university with an unverified email still needs a human');
  assert.strictEqual(resolveOutcome({ universityMatched: false, emailVerified: false, hasDocument: true }), 'pending',
    'the "Other" path: document only, always reviewed');
  assert.strictEqual(resolveOutcome({ universityMatched: true, emailVerified: true, hasDocument: false }), null,
    'no document yet means no decision yet, regardless of the rest');
  console.log('  resolveOutcome only auto-approves when all three are proven');
}

// ── resolvePlanLimits ─────────────────────────────────────────────────────
{
  assert.deepStrictEqual(resolvePlanLimits({ is_paid: true, student_status: 'active', student_expires_at: null }),
    { plan: 'paid', dailyLimit: null }, 'paid wins even over an active student record');
  assert.deepStrictEqual(
    resolvePlanLimits({ is_paid: false, student_status: 'active', student_expires_at: new Date(Date.now() + 86400000) }),
    { plan: 'student', dailyLimit: STUDENT_DAILY_LIMIT }
  );
  assert.deepStrictEqual(
    resolvePlanLimits({ is_paid: false, student_status: 'active', student_expires_at: new Date(Date.now() - 1000) }),
    { plan: 'free', dailyLimit: FREE_DAILY_LIMIT },
    'an "active" row past its own expiry must not still grant the student ceiling'
  );
  assert.deepStrictEqual(resolvePlanLimits({ is_paid: false, student_status: 'none', student_expires_at: null }),
    { plan: 'free', dailyLimit: FREE_DAILY_LIMIT });
  assert.deepStrictEqual(resolvePlanLimits({}), { plan: 'free', dailyLimit: FREE_DAILY_LIMIT }, 'a bare/missing user object still resolves to free, not a crash');
  console.log('  resolvePlanLimits: paid > unexpired active student > free');
}

console.log('--- All Student Plan Eligibility Tests Passed ---');
