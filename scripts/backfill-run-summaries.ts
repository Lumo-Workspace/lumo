/**
 * LUM-576 — one-time backfill: regenerate per-session run-summaries for
 * historical completed (DONE/IN_REVIEW) tasks whose qualified sessions lost
 * their runSummary when generation ran fire-and-forget in the cramped
 * task-route waitUntil. The reliable foreground path (POST /api/internal/
 * run-summary) fixes this going forward; this backfills the backlog.
 *
 * Safe to re-run — idempotent. A session that already has a runSummary is
 * excluded by the selection, so a second pass finds nothing to do. Sessions
 * with no turn material are left null (nothing to summarize).
 *
 * Cost: one LLM call per qualified-missing session. Sequential, not parallel,
 * to avoid hammering the gateway.
 *
 * Dry-run (count candidates, no writes / no LLM):
 *   DOTENV_CONFIG_PATH="$(pwd)/.env.production" npx tsx -r dotenv/config \
 *     scripts/backfill-run-summaries.ts --dry-run
 *
 * Apply (against prod — needs the gateway key from .env.local too):
 *   DOTENV_CONFIG_PATH="$(pwd)/.env.production" npx tsx -r dotenv/config \
 *     scripts/backfill-run-summaries.ts
 */
import { prisma } from '@/lib/db/prisma'
import { runSummaryBackfillService } from '@/lib/services/run-summary-backfill'

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  console.log(`[backfill] run-summaries ${dryRun ? '(dry-run)' : '(apply)'}`)

  const result = await runSummaryBackfillService.backfillCompletedTasks({
    dryRun,
  })

  console.log(
    `[backfill] candidateTasks=${result.candidateTasks} ` +
      `generated=${result.generated} failed=${result.failed} ` +
      `degradedTasks=${result.degradedTasks}`
  )
}

main()
  .catch(err => {
    console.error('[backfill] fatal:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
