/**
 * LUM-576 read-only diagnostic: quantify run-summary coverage on completed
 * tasks, splitting "old task predates the feature" from "new task generation
 * failed". READ-ONLY — no writes.
 *
 * A "qualified session" = bound to a DONE/IN_REVIEW task AND has >=1
 * STOP/STOP_FAILURE event carrying a non-null turnSummary (i.e. generation has
 * material to summarize). For each such task we count how many qualified
 * sessions actually have a runSummary.
 *
 * Run against PROD (read-only):
 *   DOTENV_CONFIG_PATH="$(pwd)/.env.production" npx tsx -r dotenv/config \
 *     scripts/analysis/lum576-run-summary-coverage.ts
 */
import { prisma } from '@/lib/db/prisma'

// LUM-481 shipped 2026-06-13 (PR #577). Sessions active before this date could
// never have received a runSummary regardless of generation health.
const FEATURE_SHIP = new Date('2026-06-13T00:00:00Z')

async function main() {
  const tasks = await prisma.task.findMany({
    where: { status: { in: ['DONE', 'IN_REVIEW'] } },
    select: {
      id: true,
      status: true,
      sessions: {
        select: {
          id: true,
          runSummary: true,
          lastActivityAt: true,
          events: {
            where: {
              type: { in: ['STOP', 'STOP_FAILURE'] },
              turnSummary: { not: null },
            },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  })

  type Bucket = { all: number; partial: number; none: number }
  const mk = (): Bucket => ({ all: 0, partial: 0, none: 0 })

  const stats = {
    totalTasks: tasks.length,
    tasksWithQualified: 0,
    // post-feature = latest qualified session activity >= ship date
    postSingle: mk(),
    postMulti: mk(),
    preFeature: mk(), // all qualified sessions predate ship
    mixed: mk(),
    // session-level totals (post-feature only)
    postQualifiedSessions: 0,
    postQualifiedWithSummary: 0,
  }

  for (const t of tasks) {
    const qualified = t.sessions.filter(s => s.events.length > 0)
    if (qualified.length === 0) continue
    stats.tasksWithQualified++

    const withSummary = qualified.filter(s => s.runSummary != null).length
    const cat: keyof Bucket =
      withSummary === qualified.length
        ? 'all'
        : withSummary === 0
          ? 'none'
          : 'partial'

    const latest = Math.max(...qualified.map(s => s.lastActivityAt.getTime()))
    const earliest = Math.min(...qualified.map(s => s.lastActivityAt.getTime()))
    const ship = FEATURE_SHIP.getTime()

    if (latest < ship) {
      stats.preFeature[cat]++
    } else if (earliest < ship) {
      stats.mixed[cat]++
    } else {
      // fully post-feature
      stats.postQualifiedSessions += qualified.length
      stats.postQualifiedWithSummary += withSummary
      if (qualified.length === 1) stats.postSingle[cat]++
      else stats.postMulti[cat]++
    }
  }

  const pct = (n: number, d: number) =>
    d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(1)}%`
  const line = (label: string, b: Bucket) => {
    const tot = b.all + b.partial + b.none
    console.log(
      `  ${label.padEnd(34)} total=${String(tot).padStart(4)}  ` +
        `all=${String(b.all).padStart(4)} (${pct(b.all, tot)})  ` +
        `partial=${String(b.partial).padStart(3)}  none=${String(b.none).padStart(4)}`
    )
  }

  console.log('\n=== LUM-576 run-summary coverage (DONE/IN_REVIEW) ===')
  console.log(`feature ship date: ${FEATURE_SHIP.toISOString()}`)
  console.log(`tasks scanned (DONE/IN_REVIEW): ${stats.totalTasks}`)
  console.log(`tasks with >=1 qualified session: ${stats.tasksWithQualified}\n`)

  console.log('PRE-FEATURE (expected: none — predates feature, benign):')
  line('pre-feature', stats.preFeature)
  console.log('\nMIXED (some sessions predate ship):')
  line('mixed', stats.mixed)
  console.log('\nPOST-FEATURE (should be ALL if generation healthy):')
  line('post-feature single-session', stats.postSingle)
  line('post-feature multi-session', stats.postMulti)

  console.log('\nPOST-FEATURE session-level coverage:')
  console.log(
    `  qualified sessions=${stats.postQualifiedSessions}  ` +
      `with runSummary=${stats.postQualifiedWithSummary}  ` +
      `coverage=${pct(stats.postQualifiedWithSummary, stats.postQualifiedSessions)}`
  )
  console.log('')
}

main()
  .catch(err => {
    console.error('[lum576] fatal:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
