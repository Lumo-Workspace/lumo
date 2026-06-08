import { NextRequest, NextResponse } from 'next/server'
import { lineageOutcomeService } from '@/lib/services/lineage-outcome.service'
import { fragmentUsageAuditService } from '@/lib/services/lineage/fragment-usage-audit.service'

/**
 * GET /api/cron/backfill-lineage-outcomes
 * Hourly Vercel Cron (LUM-296). Stamps MERGED onto every DONE task's
 * still-open lineage edges — the reconciliation path for edges born *after*
 * their task's terminal event, which the event-forward triggers (PR webhook /
 * task→DONE) can never reach. The first post-deploy run backfills the existing
 * UNKNOWN backlog; subsequent runs catch stragglers. Idempotent.
 *
 * Also drains the dormant used=NULL backlog via the LUM-314 usage audit
 * backstop, bounded per run to keep the LLM burst manageable.
 */

/** Per-run cap on usage audits — bounds the LLM burst so the first sweeps drain
 *  the dormant backlog over a few hours, not all at once. */
const USAGE_AUDIT_BATCH = 25

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const outcomes = await lineageOutcomeService.sweepDoneTaskEdges()
  const usage =
    await fragmentUsageAuditService.auditDoneTaskSessions(USAGE_AUDIT_BATCH)
  return NextResponse.json({ outcomes, usage: { processed: usage.processed } })
}
