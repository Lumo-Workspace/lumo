/**
 * One-time LUM-437 backfill: stamp Task.workStartedAt for tasks already past
 * TODO so they count as "started" (the editable-until-DONE gate). Dry-run by
 * default; pass --apply to mutate. The stamped value is best-effort (only
 * non-null matters). Production: run only with explicit authorization against
 * the prod DB URL (CLAUDE.md prod-migration rules apply — the DB URL must
 * point at prod and explicit per-session authorization is required).
 *
 * Usage:
 *   npx tsx scripts/backfill-work-started-at.ts           # dry-run
 *   npx tsx scripts/backfill-work-started-at.ts --apply   # mutate
 */
import 'dotenv/config'
import { prisma } from '@/lib/db/prisma'

async function main() {
  const apply = process.argv.includes('--apply')
  const where = { status: { not: 'TODO' as const }, workStartedAt: null }

  if (!apply) {
    const n = await prisma.task.count({ where })
    console.log(
      `[dry-run] ${n} tasks would get workStartedAt stamped. Re-run with --apply to mutate.`
    )
  } else {
    const res = await prisma.task.updateMany({
      where,
      data: { workStartedAt: new Date() },
    })
    console.log(`backfilled workStartedAt for ${res.count} tasks`)
  }

  await prisma.$disconnect()
}

main().catch(async e => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
