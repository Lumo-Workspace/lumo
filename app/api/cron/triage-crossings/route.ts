import { NextRequest, NextResponse } from 'next/server'
import { boundaryCrossingTriageService } from '@/ee/security/services/boundary-crossing-triage.service'
import { requireCronAuth } from '@/lib/api/cron-auth'

export const runtime = 'nodejs'
/** ≤ 100 rows × one ~0.3 s evaluation call each, sequential; well inside. */
export const maxDuration = 300

/**
 * GET /api/cron/triage-crossings — every 5 minutes (vercel.json).
 * LUM-945: OPEN boundary crossings the rule detectors recorded are triaged by
 * a model reading the task context; P(legit) at or above the threshold stamps
 * the system disposition AUTO_LEGIT, anything below stays OPEN for a human.
 * Workspaces with AI review off are skipped. Cron only (CRON_SECRET).
 */
export async function GET(req: NextRequest) {
  const unauthorized = requireCronAuth(req)
  if (unauthorized) return unauthorized
  const summary = await boundaryCrossingTriageService.sweep()
  return NextResponse.json(summary)
}
