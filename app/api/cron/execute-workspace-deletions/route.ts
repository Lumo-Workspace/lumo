import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/api/cron-auth'
import { workspaceDeletionService } from '@/lib/services'

/**
 * GET /api/cron/execute-workspace-deletions
 * Hourly Vercel Cron (LUM-918). Runs the full purge for every workspace whose
 * 48-hour deletion window has passed without an owner cancelling it.
 */
export async function GET(req: NextRequest) {
  const unauthorized = requireCronAuth(req)
  if (unauthorized) return unauthorized
  const result = await workspaceDeletionService.runDueDeletions()
  return NextResponse.json(result)
}
