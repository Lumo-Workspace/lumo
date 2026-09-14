import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/api/cron-auth'
import { lineageOutcomeService } from '@/lib/services/lineage-outcome.service'
import { fragmentUsageAuditService } from '@/lib/services/lineage/fragment-usage-audit.service'
import { memoryCompactionService } from '@/lib/services/memory/compaction.service'
import { dependencyDetectionService } from '@/lib/services/dependency-detection.service'
import { claimFaithfulnessService } from '@/lib/services/claim-faithfulness.service'

/**
 * GET /api/cron/backfill-lineage-outcomes
 * Hourly Vercel Cron (LUM-296). Stamps MERGED onto every DONE task's
 * still-open lineage edges — the reconciliation path for edges born *after*
 * their task's terminal event, which the event-forward triggers (PR webhook /
 * task→DONE) can never reach. The first post-deploy run backfills the existing
 * UNKNOWN backlog; subsequent runs catch stragglers. Idempotent.
 *
 * Also runs the LUM-328 cold-eviction compaction (archives the lowest
 * usage-strength PROJECT memories of any project over the ACTIVE threshold,
 * capped per sweep) and drains the dormant used=NULL backlog via the LUM-314
 * usage audit backstop, bounded per run to keep the LLM burst manageable.
 *
 * Segment order matters: the two cheap pure-DB segments (outcomes, compaction)
 * run BEFORE the LLM-bound usage audit — its latency is unbounded and has been
 * observed eating the entire function budget, which would otherwise starve
 * compaction on every invocation.
 */

/** Per-run cap on usage audits — bounds the LLM burst so the first sweeps drain
 *  the dormant backlog over a few hours, not all at once. */
const USAGE_AUDIT_BATCH = 25

/** Per-run cap on claim-faithfulness judging (LUM-612) — LLM-bound, so bound
 *  the burst; first post-deploy sweeps drain the backlog over a few hours. */
const FAITHFULNESS_BATCH = 20

/** Fluid-compute default (300s) is not enough for a backlogged usage-audit
 *  batch; 800s is the Pro-plan ceiling. */
export const maxDuration = 800

export async function GET(req: NextRequest) {
  const unauthorized = requireCronAuth(req)
  if (unauthorized) return unauthorized
  const outcomes = await lineageOutcomeService.sweepDoneTaskEdges()
  const compaction = await memoryCompactionService.sweepColdProjectMemories()
  // ── LUM-172: shared-file dependency candidates (pure-DB, before LLM segment) ──
  const dependencySweep = await dependencyDetectionService
    .sweepSharedFileCandidates(new Date())
    .catch(err => {
      console.error('[cron] dependency sweep failed:', err)
      return { suggested: 0 }
    })
  const faithfulness = await claimFaithfulnessService
    .sweepUnjudged(FAITHFULNESS_BATCH)
    .catch(err => {
      console.error('[cron] faithfulness sweep failed:', err)
      return { processed: 0 }
    })
  const usage =
    await fragmentUsageAuditService.auditDoneTaskSessions(USAGE_AUDIT_BATCH)
  return NextResponse.json({
    outcomes,
    compaction,
    dependencySweep,
    faithfulness,
    usage: { processed: usage.processed },
  })
}
