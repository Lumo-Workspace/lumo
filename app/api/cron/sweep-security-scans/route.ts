import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { securityManagedScanOpsService } from '@/ee/security/services/security-managed-scan-ops.service'
import { securityHuntOpsService } from '@/ee/security/services/security-hunt-ops.service'
import { reviewVerifierOpsService } from '@/ee/security/services/review-verifier-ops.service'
import { requireCronAuth } from '@/lib/api/cron-auth'

export const runtime = 'nodejs'
/** Up to 50 + 25 rows × one GitHub sync or run start each; well inside this budget. */
export const maxDuration = 300

/**
 * GET /api/cron/sweep-security-scans — every 15 minutes (vercel.json).
 * LUM-745: a scan whose external layer has sat PENDING for more than 45 min
 * is dead (managed run silently gone, or a BYO CI that never pushed). The
 * sweep marks it FAILED with a reason, cancels + stops a managed run's
 * workflow and sandbox, and refreshes the PR summary — so the panel never
 * reads "scanning" forever and no VM idles unbilled-for.
 * LUM-822: the same for the hunt layer, except a first stale attempt is
 * retried once before it is failed. LUM-988: and the agentic verifier's
 * comment hold — a lost run's held inline comments are released. LUM-1234:
 * and a reward-hack layer whose runner died is stamped FAILED. The sweeps
 * are independent: one throwing must not skip the others.
 *
 * Cron only: gated by the shared CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  // This route already had the fail-closed check inline (LUM-745); the helper
  // is that same check, moved where the other eight can reach it.
  const unauthorized = requireCronAuth(req)
  if (unauthorized) return unauthorized
  const [external, hunt, verifier, rewardHack] = await Promise.allSettled([
    securityManagedScanOpsService.sweepStalePending(),
    securityHuntOpsService.sweepStaleHunts(),
    reviewVerifierOpsService.sweepStaleHolds(),
    securityHuntOpsService.sweepStaleRewardHacks(),
  ])
  for (const [name, result] of [
    ['external', external],
    ['hunt', hunt],
    ['verifier', verifier],
    ['rewardHack', rewardHack],
  ] as const) {
    if (result.status === 'rejected')
      logger.error(
        `[sweep-security-scans] ${name} sweep failed: ${
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason)
        }`
      )
  }
  const failed =
    external.status === 'rejected' ||
    hunt.status === 'rejected' ||
    verifier.status === 'rejected' ||
    rewardHack.status === 'rejected'
  return NextResponse.json(
    {
      ...(external.status === 'fulfilled' ? external.value : {}),
      hunt: hunt.status === 'fulfilled' ? hunt.value : null,
      verifier: verifier.status === 'fulfilled' ? verifier.value : null,
      rewardHack: rewardHack.status === 'fulfilled' ? rewardHack.value : null,
    },
    { status: failed ? 500 : 200 }
  )
}
