import { NextRequest, NextResponse } from 'next/server'
import { securityManagedScanOpsService } from '@/lib/services/security-managed-scan-ops.service'
import { requireCronAuth } from '@/lib/api/cron-auth'

export const runtime = 'nodejs'
/** Up to 50 rows × one GitHub summary sync each; well inside this budget. */
export const maxDuration = 300

/**
 * GET /api/cron/sweep-security-scans — every 15 minutes (vercel.json).
 * LUM-745: a scan whose external layer has sat PENDING for more than 45 min
 * is dead (managed run silently gone, or a BYO CI that never pushed). The
 * sweep marks it FAILED with a reason, cancels + stops a managed run's
 * workflow and sandbox, and refreshes the PR summary — so the panel never
 * reads "scanning" forever and no VM idles unbilled-for.
 *
 * Cron only: gated by the shared CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  // This route already had the fail-closed check inline (LUM-745); the helper
  // is that same check, moved where the other eight can reach it.
  const unauthorized = requireCronAuth(req)
  if (unauthorized) return unauthorized
  const result = await securityManagedScanOpsService.sweepStalePending()
  return NextResponse.json(result)
}
