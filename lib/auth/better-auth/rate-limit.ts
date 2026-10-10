/**
 * LUM-1070 — Better Auth rate limiting, stored in the database.
 *
 * Better Auth keeps its counters in process memory by default, so on a
 * multi-instance deployment (Vercel) each instance counts on its own and the
 * limit barely applies. With `storage: 'database'` every instance shares the
 * `auth_rate_limits` table (Prisma model `AuthRateLimit`). Better Auth deletes
 * expired rows itself whenever a bucket's window rolls over. The rules stay
 * Better Auth's defaults: 100 requests / 10 s per IP and path, 3 / 10 s for
 * sign-in, sign-up and change-password, 3 / 60 s for password-reset and
 * verification emails, plus plugin rules (MCP client registration).
 *
 * `enabled` is left to Better Auth: on in production, off in development and
 * tests. No captcha for now (RFC LUM-1069 Q10).
 */
export const RATE_LIMIT_OPTIONS = {
  storage: 'database',
  modelName: 'authRateLimit',
} as const
