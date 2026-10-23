/**
 * LUM-1303 — one-time backfill: give each decision that was moved over from a
 * task description (no author, no agent session) its task's assignee as
 * author, when the assignee is a workspace member. Others stay "Author
 * unknown".
 *
 * - `--dry-run` first: counts, writes nothing. Run without the flag only after
 *   a human authorizes the apply run in that session.
 * - Safe to re-run: an attributed decision no longer matches.
 *
 *   npx tsx scripts/backfill-task-decision-authors.ts --dry-run
 *   npx tsx scripts/backfill-task-decision-authors.ts
 *
 * The database is whatever DATABASE_URL the environment gives (dev `.env` by
 * default).
 */
import 'dotenv/config'

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  console.log(
    `[backfill] task-decision-authors ${dryRun ? '(dry-run)' : '(apply)'}`
  )
  const { prisma } = await import('@/lib/db/prisma')
  const { backfillDecisionAuthors } =
    await import('@/lib/services/task-decision-author-backfill.service')
  try {
    const r = await backfillDecisionAuthors({ dryRun })
    console.log(
      `[backfill] candidates=${r.candidates} ` +
        `${dryRun ? 'wouldAttribute' : 'attributed'}=${r.attributed} ` +
        `noMemberAssignee=${r.noMemberAssignee}`
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(err => {
  console.error('[backfill] fatal:', err)
  process.exit(1)
})
