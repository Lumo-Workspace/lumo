/**
 * LUM-579 read-only reproduction probe.
 *
 * LUM-577 disproved the claim-anchoring hypothesis: the 27 negative-claim DONE
 * tasks DO have their claim snapshot frozen to the correct MERGED delivery
 * session — but that session's own `runSummary` text says "only explored / no
 * code changes". This probe inspects, for a handful of the example tasks, the
 * GENERATION INPUT (the ordered STOP/STOP_FAILURE turnSummaries) against the
 * generated `runSummary`, plus generation timing, to distinguish:
 *
 *   H1 (LLM under-report)  — the turnSummaries DO describe code work, but the
 *                            one-paragraph runSummary dropped it.
 *   H2 (input is empty/early) — the turnSummaries themselves are exploration-only
 *                            (the per-turn STOP digest layer is the problem).
 *   H3 (stale early gen)   — runSummaryGeneratedAt precedes the last code turns
 *                            (summary frozen before the work, never regenerated).
 *
 * READ-ONLY — no writes.
 *
 * Run against PROD (read-only):
 *   DOTENV_CONFIG_PATH="$(pwd)/.env.production" npx tsx -r dotenv/config \
 *     scripts/analysis/lum579-run-summary-underreport/probe.ts [LUM-471 LUM-487 ...]
 */
import { prisma } from '@/lib/db/prisma'

const TEAM_IDENTIFIER = 'LUM'
const DEFAULT_NUMBERS = [471, 487, 522, 531, 566, 560, 563]

function fmt(d: Date | null): string {
  return d ? d.toISOString() : 'null'
}

function clip(s: string | null, n = 240): string {
  if (!s) return '(null)'
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n) + '…' : one
}

async function main() {
  const numbers = process.argv.slice(2).length
    ? process.argv
        .slice(2)
        .map(a => parseInt(a.replace(/[^0-9]/g, ''), 10))
        .filter(n => Number.isFinite(n))
    : DEFAULT_NUMBERS

  const team = await prisma.team.findFirst({
    where: { identifier: TEAM_IDENTIFIER },
    select: { id: true },
  })
  if (!team) throw new Error(`team ${TEAM_IDENTIFIER} not found`)

  for (const number of numbers) {
    const task = await prisma.task.findFirst({
      where: { teamId: team.id, number },
      select: {
        id: true,
        number: true,
        status: true,
        title: true,
        claimSnapshot: true,
        claimSnapshotSource: true,
        claimSnapshotSessionId: true,
        claimSnapshotAt: true,
      },
    })
    if (!task) {
      console.log(`\n==== LUM-${number}: NOT FOUND ====`)
      continue
    }

    console.log(`\n==== LUM-${task.number}  [${task.status}]  ${task.title}`)
    console.log(`  claim.source : ${task.claimSnapshotSource}`)
    console.log(`  claim.session: ${task.claimSnapshotSessionId}`)
    console.log(`  claim.at     : ${fmt(task.claimSnapshotAt)}`)
    console.log(`  claim.text   : ${clip(task.claimSnapshot, 400)}`)

    // The frozen anchor session (the delivery session the claim points at).
    const anchorId = task.claimSnapshotSessionId
    if (!anchorId) {
      console.log('  (no anchor session)')
      continue
    }

    const session = await prisma.session.findUnique({
      where: { id: anchorId },
      select: {
        id: true,
        runSummary: true,
        runSummaryGeneratedAt: true,
        lastActivityAt: true,
        createdAt: true,
      },
    })
    if (!session) {
      console.log('  (anchor session row missing)')
      continue
    }

    // The actual generation input: STOP/STOP_FAILURE turnSummaries, ASC, no limit.
    const events = await prisma.hookEvent.findMany({
      where: {
        sessionId: anchorId,
        type: { in: ['STOP', 'STOP_FAILURE'] },
        turnSummary: { not: null },
      },
      orderBy: { createdAt: 'asc' },
      select: { turnSummary: true, createdAt: true, type: true },
    })

    const lastTurnAt = events.length
      ? events[events.length - 1]!.createdAt
      : null
    const genAt = session.runSummaryGeneratedAt
    const turnsAfterGen =
      genAt != null ? events.filter(e => e.createdAt > genAt).length : null

    console.log(`  session.id          : ${session.id}`)
    console.log(`  session.created     : ${fmt(session.createdAt)}`)
    console.log(`  session.lastActivity: ${fmt(session.lastActivityAt)}`)
    console.log(`  runSummaryGeneratedAt: ${fmt(genAt)}`)
    console.log(`  STOP turn notes (n) : ${events.length}`)
    console.log(`  last turn note at   : ${fmt(lastTurnAt)}`)
    console.log(
      `  turns AFTER gen     : ${turnsAfterGen} ${
        turnsAfterGen && turnsAfterGen > 0
          ? '  <-- H3: gen ran before later turns'
          : ''
      }`
    )
    console.log(`  runSummary text     : ${clip(session.runSummary, 400)}`)
    console.log('  --- turn notes (first 3 / last 6) ---')
    const head = events.slice(0, 3)
    const tail = events.slice(-6)
    const show = events.length <= 9 ? events : [...head, null, ...tail]
    for (const e of show) {
      if (e === null) {
        console.log(`     … (${events.length - 9} more) …`)
        continue
      }
      console.log(`     [${fmt(e.createdAt)}] ${clip(e.turnSummary, 200)}`)
    }
  }

  await prisma.$disconnect()
}

main().catch(async err => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
