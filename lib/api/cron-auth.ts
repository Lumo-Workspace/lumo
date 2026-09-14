import { NextRequest, NextResponse } from 'next/server'

/**
 * The shared gate on cron and internal self-call routes.
 *
 * Every one of these routes used to inline the same comparison:
 *
 *     if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) return 401
 *
 * which **fails OPEN when `CRON_SECRET` is unset**: the template interpolates
 * `undefined`, so the literal header `Authorization: Bearer undefined` matches
 * and the route runs. The risk is not the production deployment, where the
 * variable is set — it is every environment where it is not. A preview
 * deployment with an incomplete env exposes sprint rolls, revision pruning,
 * SARIF blob deletion and the internal write endpoints to anyone holding the
 * URL, with a header any scanner sends by accident.
 *
 * `sweep-security-scans` already guarded this with an explicit `!secret ||`
 * (LUM-745). One route having the check and eight not having it is exactly the
 * shape a shared helper exists to remove — so the check lives here now, and a
 * new route gets it by calling this rather than by remembering.
 *
 * Returns a 401 response to return, or `null` when the caller may proceed.
 */
export function requireCronAuth(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET
  // Fail closed on an absent or empty secret BEFORE any comparison: there is
  // no value of the header that should authorise a deployment with no secret.
  if (!secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
