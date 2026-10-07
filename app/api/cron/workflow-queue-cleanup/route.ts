import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/api/cron-auth'
import { logger } from '@/lib/logger'
import { redactConnectionUrl } from '@/lib/runtime/workflow-world'
import { workflowQueueMaintenanceService } from '@/lib/services/workflow-queue-maintenance.service'

/**
 * GET /api/cron/workflow-queue-cleanup
 * Self-hosted only (LUM-1030): scheduled by `deploy/self-host/crontab`, NOT by
 * vercel.json — the Vercel World has no graphile-worker queue. Deletes the
 * Postgres World's permanently failed queue jobs (e.g. what a killed process
 * leaves once graphile releases its lock) and empty queue bookkeeping rows.
 * Elsewhere it answers `{ skipped: true }`.
 */
export async function GET(req: NextRequest) {
  const unauthorized = requireCronAuth(req)
  if (unauthorized) return unauthorized
  try {
    const result = await workflowQueueMaintenanceService.cleanup()
    return NextResponse.json(result)
  } catch (error) {
    // A driver error may echo the connection string; never log its password.
    const detail = redactConnectionUrl(
      error instanceof Error ? error.message : String(error)
    )
    logger.error(`[workflow-queue] cleanup failed: ${detail}`)
    const status = (error as { status?: number }).status ?? 500
    return NextResponse.json(
      { error: 'workflow queue cleanup failed' },
      { status }
    )
  }
}
