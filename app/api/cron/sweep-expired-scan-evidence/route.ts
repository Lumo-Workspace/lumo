import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/api/cron-auth'
import { sweepExpiredScanEvidence } from '@/ee/security/services/scan-evidence-retention.service'

export const runtime = 'nodejs'

/**
 * GET /api/cron/sweep-expired-scan-evidence — hourly (vercel.json). LUM-911:
 * scrubs the code of every scan that is used up (PR merged or closed and past
 * the workspace's retention, past the open-PR hard cap, or final in a
 * zero-retention workspace). Rows, counts and dispositions stay.
 *
 * Cron only: gated by the shared CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const unauthorized = requireCronAuth(req)
  if (unauthorized) return unauthorized
  return NextResponse.json(await sweepExpiredScanEvidence())
}
