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
 * Env: reads prod via `.env.production`, the gateway key (AI_GATEWAY_API_KEY,
 * only in `.env.local`) via `.env.local`. Loaded here in that order — dotenv
 * does NOT override already-set vars, so DATABASE_URL stays prod (from
 * .env.production) while AI_GATEWAY_API_KEY is filled from .env.local. Same
 * pattern as scripts/fold-backfill.ts.
 *
 *   npx tsx scripts/backfill-run-summaries.ts --dry-run   # count, no writes/LLM
 *   npx tsx scripts/backfill-run-summaries.ts             # apply against prod
 */
import { config } from 'dotenv'
config({ path: '.env.production' })
config({ path: '.env.local' })

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  console.log(`[backfill] run-summaries ${dryRun ? '(dry-run)' : '(apply)'}`)

  // Dynamic imports AFTER dotenv load so the Prisma client + gateway init see
  // the prod DATABASE_URL and the gateway key (same ordering as fold-backfill).
  const { prisma } = await import('@/lib/db/prisma')
  const { runSummaryBackfillService } =
    await import('@/lib/services/run-summary-backfill')

  try {
    const result = await runSummaryBackfillService.backfillCompletedTasks({
      dryRun,
    })

    console.log(
      `[backfill] candidateTasks=${result.candidateTasks} ` +
        `generated=${result.generated} failed=${result.failed} ` +
        `degradedTasks=${result.degradedTasks}`
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(err => {
  console.error('[backfill] fatal:', err)
  process.exit(1)
})
