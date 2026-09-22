/**
 * Daily usage gate for the engine's paid-value routes.
 *
 * Runs after requireUser (needs req.user, and req.user already carries
 * is_paid/student_status/student_expires_at — see user-repo.js's
 * findUserByTokenHash). An admin-flagged paid account is unlimited and never
 * touches the counter table at all — nothing to reset, nothing to race. Free
 * and student accounts get a per-Asia/Dhaka-day ceiling, enforced with one
 * atomic UPDATE (usage-repo.js) so two concurrent requests — possibly on
 * different Passenger workers — cannot both read "under the limit" and both
 * be let through.
 */
const usageRepo = require('../db/repositories/usage-repo');
const { resolvePlanLimits } = require('../engine/domain/student-eligibility');

async function enforceDailyLimit(req, res, next) {
  const { plan, dailyLimit } = resolvePlanLimits(req.user);
  req.plan = plan;
  if (dailyLimit == null) return next();

  try {
    const usedToday = await usageRepo.incrementAndGet(req.user.id);
    if (usedToday > dailyLimit) {
      return res.status(429).json({
        success: false,
        code: 'DAILY_LIMIT_REACHED',
        error: plan === 'student'
          ? `You've used today's ${dailyLimit} student requests. More open tomorrow at midnight (Dhaka time).`
          : `You've used today's ${dailyLimit} free requests. Verify as a student for ${require('../engine/domain/student-eligibility').STUDENT_DAILY_LIMIT}/day, or ask us about paid access for unlimited use.`,
        plan,
        daily_limit: dailyLimit,
        used_today: usedToday,
      });
    }
    return next();
  } catch (err) {
    console.error('[PlanLimit] usage check failed, letting the request through:', err.message);
    return next(); // a bookkeeping failure must never block the engine itself
  }
}

module.exports = { enforceDailyLimit };
