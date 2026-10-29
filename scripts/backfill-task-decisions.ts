/**
 * LUM-1303 — one-time backfill: move each task's `## Decisions` description
 * section (LUM-970) into the task_decisions table and strip it from the
 * description.
 *
 * - `--dry-run` first: counts tasks and decisions, writes nothing. Run without
 *   the flag only after a human authorizes the apply run in that session.
 * - Safe to re-run: a moved task no longer has the section. A task whose
 *   description changes mid-run is skipped and counted.
 * - Needs the `20261203090000_lum1303_task_decisions` migration applied.
 *
 *   npx tsx scripts/backfill-task-decisions.ts --dry-run   # count, no writes
 *   npx tsx scripts/backfill-task-decisions.ts             # apply (authorized runs only)
 *
 * The database is whatever DATABASE_URL the environment gives (dev `.env` by
 * default); for production prefix it inline, as with `migrate deploy`.
 */
import 'dotenv/config'

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  console.log(`[backfill] task-decisions ${dryRun ? '(dry-run)' : '(apply)'}`)
  const { prisma } = await import('@/lib/db/prisma')
  const { backfillTaskDecisions } =
    await import('@/lib/services/task-decision-backfill.service')
  try {
    const r = await backfillTaskDecisions({ dryRun })
    console.log(
      `[backfill] tasks=${r.tasks} ` +
        `${dryRun ? 'wouldMove' : 'moved'}=${r.decisions} ` +
        `skippedConcurrentEdit=${r.skippedConcurrentEdit}`
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(err => {
  console.error('[backfill] fatal:', err)
  process.exit(1)
})
