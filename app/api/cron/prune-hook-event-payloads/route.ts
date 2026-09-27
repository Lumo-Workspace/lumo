import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/api/cron-auth'
import { hookEventRetentionService } from '@/lib/services/hook-event-retention.service'

export const maxDuration = 300

/**
 * GET /api/cron/prune-hook-event-payloads
 * Daily Vercel Cron (LUM-859). Clears the raw payload of hook events older
 * than each workspace's opted-in retention window; see
 * `hookEventRetentionService.pruneExpiredPayloads` for what is kept and exempt.
 */
export async function GET(req: NextRequest) {
  const unauthorized = requireCronAuth(req)
  if (unauthorized) return unauthorized
  const result = await hookEventRetentionService.pruneExpiredPayloads()
  return NextResponse.json(result)
}
