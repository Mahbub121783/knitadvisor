/**
 * Which request paths count as the admin surface.
 *
 * This decides which of the two content-security policies a response gets, and
 * it is the kind of rule that fails silently: a pattern that matches nothing
 * looks exactly like a pattern that matches everything it should, because
 * nothing errors and every page still loads. The previous version named
 * `/admin.html` and `/api/admin` — the second has never been a path in this
 * app — while the routes are mounted at `/admin` and `/admin/api/...`. It
 * therefore matched neither, and the strict policy that the whole two-policy
 * arrangement exists to deliver was applied to nothing for as long as it
 * existed. The admin panel, which renders log rows built out of request
 * bodies, was served the public policy with 'unsafe-inline' in it.
 *
 * `.html` stays in the pattern because express.static also serves the file at
 * `/admin.html`, so both spellings reach the same panel.
 *
 * The trailing `(\/|$)` is what keeps `/administrator` on the public side.
 */
const ADMIN_SURFACE = /^\/admin(\.html)?(\/|$)/;

module.exports = { ADMIN_SURFACE };
