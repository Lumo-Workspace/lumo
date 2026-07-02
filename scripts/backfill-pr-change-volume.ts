/**
 * LUM-634 — one-time backfill: fetch additions/deletions/changed_files for
 * historical TASK-BOUND MERGED PRs from the GitHub pulls API and write them to
 * the pull_requests change-volume columns.
 *
 * Operational posture (same as the claim-audit scripts):
 * - `--dry-run` REQUIRED first: counts candidates and API reachability, writes
 *   nothing. Run without the flag only after a human authorizes the apply run
 *   in that session — never as part of an implementation session.
 * - Scope: only merged PRs with a task binding (audit reading has no use for
 *   ownerless PRs). Already-filled PRs are excluded — safe to re-run.
 * - Fail-closed: a PR the API can't produce stats for is SKIPPED and counted
 *   (`skippedApiError`), left null — a fabricated 0 is never written.
 *
 *   npx tsx scripts/backfill-pr-change-volume.ts --dry-run   # count, no writes
 *   npx tsx scripts/backfill-pr-change-volume.ts             # apply (authorized runs only)
 */
import { config } from 'dotenv'
config({ path: '.env.production' })

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  console.log(`[backfill] pr-change-volume ${dryRun ? '(dry-run)' : '(apply)'}`)

  // Dynamic import AFTER dotenv load so the Prisma client sees the prod
  // DATABASE_URL (same ordering as scripts/backfill-claim-snapshots.ts).
  const { prisma } = await import('@/lib/db/prisma')
  const { backfillPrChangeVolume } =
    await import('@/lib/services/pr-change-volume-backfill.service')

  try {
    const r = await backfillPrChangeVolume({ dryRun })
    console.log(
      `[backfill] candidates=${r.candidates} ` +
        `${dryRun ? 'wouldWrite' : 'written'}=${r.written} ` +
        `skippedApiError=${r.skippedApiError} filteredOut=${r.filteredOut}`
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(err => {
  console.error('[backfill] fatal:', err)
  process.exit(1)
})
