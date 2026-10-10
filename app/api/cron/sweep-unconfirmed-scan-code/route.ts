import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/api/cron-auth'
import { sweepUnconfirmedScanCode } from '@/ee/security/services/scan-code-retention.service'

export const runtime = 'nodejs'

/**
 * GET /api/cron/sweep-unconfirmed-scan-code — daily (vercel.json), after the
 * access recheck. LUM-902: the backstop that scrubs scan code for any
 * repository no longer on its workspace's confirmed list, whatever path
 * (a lost race, a crashed worker, a failed best-effort scrub) left it.
 *
 * Cron only: gated by the shared CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const unauthorized = requireCronAuth(req)
  if (unauthorized) return unauthorized
  return NextResponse.json(await sweepUnconfirmedScanCode())
}
