import { NextRequest, NextResponse } from 'next/server'
import { lineageOutcomeService } from '@/lib/services/lineage-outcome.service'

/**
 * GET /api/cron/backfill-lineage-outcomes
 * Hourly Vercel Cron (LUM-296). Stamps MERGED onto every DONE task's
 * still-open lineage edges — the reconciliation path for edges born *after*
 * their task's terminal event, which the event-forward triggers (PR webhook /
 * task→DONE) can never reach. The first post-deploy run backfills the existing
 * UNKNOWN backlog; subsequent runs catch stragglers. Idempotent.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await lineageOutcomeService.sweepDoneTaskEdges()
  return NextResponse.json(result)
}
