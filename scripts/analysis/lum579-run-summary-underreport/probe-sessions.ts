/**
 * LUM-579 probe #2 — where does the delivery work live, and is the gap a
 * turnSummary-coverage gap?
 *
 * For each task, list ALL its sessions with: total event count, STOP/STOP_FAILURE
 * count, how many of those carry a turnSummary, whether the session has a MERGED
 * lineage edge (delivery signal), and whether it is the frozen claim anchor.
 *
 * This separates two root causes:
 *   (a) anchored session IS the delivery run, but only its EARLY turns got a
 *       turnSummary (coverage gap) — STOP count >> STOP-with-turnSummary count.
 *   (b) the real code work lived in a DIFFERENT session (claim still mis-anchored).
 *
 * READ-ONLY.
 *   DOTENV_CONFIG_PATH="$(pwd)/.env.production" npx tsx -r dotenv/config \
 *     scripts/analysis/lum579-run-summary-underreport/probe-sessions.ts [471 487 ...]
 */
import { prisma } from '@/lib/db/prisma'

const TEAM_IDENTIFIER = 'LUM'
const DEFAULT_NUMBERS = [471, 487, 522, 566, 560, 563]

function fmt(d: Date | null): string {
  return d ? d.toISOString().replace('T', ' ').slice(0, 19) : 'null'
}

async function main() {
  const numbers = process.argv.slice(2).length
    ? process.argv.slice(2).map(a => parseInt(a.replace(/[^0-9]/g, ''), 10))
    : DEFAULT_NUMBERS

  const team = await prisma.team.findFirst({
    where: { identifier: TEAM_IDENTIFIER },
    select: { id: true },
  })
  if (!team) throw new Error('team not found')

  for (const number of numbers) {
    const task = await prisma.task.findFirst({
      where: { teamId: team.id, number },
      select: {
        id: true,
        number: true,
        status: true,
        claimSnapshotSessionId: true,
      },
    })
    if (!task) {
      console.log(`\n#### LUM-${number}: NOT FOUND`)
      continue
    }

    const sessions = await prisma.session.findMany({
      where: { taskId: task.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        createdAt: true,
        lastActivityAt: true,
        runSummary: true,
        _count: { select: { events: true } },
      },
    })

    // MERGED lineage edges → which sessions are delivery-stamped.
    const merged = await prisma.lineageEdge.findMany({
      where: { session: { taskId: task.id }, outcome: 'MERGED' },
      select: { sessionId: true },
    })
    const mergedIds = new Set(merged.map(m => m.sessionId))

    console.log(
      `\n#### LUM-${task.number} [${task.status}]  ${sessions.length} session(s)`
    )
    for (const s of sessions) {
      const stopCount = await prisma.hookEvent.count({
        where: { sessionId: s.id, type: { in: ['STOP', 'STOP_FAILURE'] } },
      })
      const stopWithSummary = await prisma.hookEvent.count({
        where: {
          sessionId: s.id,
          type: { in: ['STOP', 'STOP_FAILURE'] },
          turnSummary: { not: null },
        },
      })
      const flags = [
        mergedIds.has(s.id) ? 'MERGED' : '------',
        s.id === task.claimSnapshotSessionId ? 'ANCHOR' : '      ',
        s.runSummary ? 'sum✓' : 'sum✗',
      ].join(' ')
      console.log(
        `  ${s.id.slice(0, 8)} ${flags} | ${fmt(s.createdAt)}→${fmt(s.lastActivityAt)} | ` +
          `events=${String(s._count.events).padStart(4)} STOP=${String(stopCount).padStart(3)} ` +
          `STOP+sum=${String(stopWithSummary).padStart(3)}`
      )
    }
  }
  await prisma.$disconnect()
}

main().catch(async err => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
