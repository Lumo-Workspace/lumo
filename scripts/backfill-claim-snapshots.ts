/**
 * LUM-573 — one-time backfill: (re)synthesize the frozen task-level claim
 * snapshot for every completed (DONE/IN_REVIEW) task. This is what flips the
 * historical contradiction surface: it recomputes the claim from the
 * AUTHORITATIVE (MERGED-lineage) session instead of the trailing exploration
 * session the old latest-session rule echoed, and freezes it to the Task.
 *
 * Distinct from the LUM-576 run-summary backfill: that one only touches tasks
 * with a session MISSING its runSummary. The tasks the structural 573 bug
 * surfaces are exactly those the 576 backfill ALREADY summarized — so this pass
 * is gated on task completion, NOT on a missing summary.
 *
 * No LLM calls — it reads existing run-summaries + lineage edges and selects;
 * only the prod DB URL is needed. Safe to re-run — idempotent (overwrites with
 * the same resolved claim).
 *
 *   npx tsx scripts/backfill-claim-snapshots.ts --dry-run   # count, no writes
 *   npx tsx scripts/backfill-claim-snapshots.ts             # apply against prod
 */
import { config } from 'dotenv'
config({ path: '.env.production' })

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  console.log(`[backfill] claim-snapshots ${dryRun ? '(dry-run)' : '(apply)'}`)

  // Dynamic import AFTER dotenv load so the Prisma client sees the prod
  // DATABASE_URL (same ordering as scripts/backfill-run-summaries.ts).
  const { prisma } = await import('@/lib/db/prisma')
  const { taskClaimSnapshotService } =
    await import('@/lib/services/task-claim-snapshot.service')

  try {
    const result = await taskClaimSnapshotService.backfillAll({ dryRun })
    console.log(
      `[backfill] candidateTasks=${result.candidateTasks} ` +
        `synthesized=${result.synthesized}`
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(err => {
  console.error('[backfill] fatal:', err)
  process.exit(1)
})
