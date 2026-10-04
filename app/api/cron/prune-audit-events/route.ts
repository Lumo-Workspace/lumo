import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/api/cron-auth'
import { auditService } from '@/lib/services/audit.service'

/**
 * GET /api/cron/prune-audit-events
 * Daily Vercel Cron (LUM-907). Deletes workspace audit events older than
 * AUDIT_RETENTION_DAYS (365), in batches; `done: false` means the next run
 * continues where this one stopped.
 */
export async function GET(req: NextRequest) {
  const unauthorized = requireCronAuth(req)
  if (unauthorized) return unauthorized
  const result = await auditService.pruneExpired()
  return NextResponse.json(result)
}
