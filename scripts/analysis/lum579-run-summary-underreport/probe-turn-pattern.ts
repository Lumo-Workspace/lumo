/**
 * LUM-579 probe #3 — the per-turn coverage pattern.
 *
 * For a session, dump every STOP/STOP_FAILURE in chronological order with:
 * index, type, createdAt, and whether a turnSummary was stored (+ its length).
 * Reveals whether the coverage gap is "first-N-then-none" (early generation
 * worked, later turns dropped), scattered, or type-correlated.
 *
 * READ-ONLY.
 *   DOTENV_CONFIG_PATH="$(pwd)/.env.production" npx tsx -r dotenv/config \
 *     scripts/analysis/lum579-run-summary-underreport/probe-turn-pattern.ts <sessionId>
 */
import { prisma } from '@/lib/db/prisma'

const DEFAULT_SESSIONS = [
  '7276e768-1bdb-4cf5-b83f-38b6045489d1', // LUM-471
  '2c7617e1-8149-4fe2-899d-960292e8fd57', // LUM-560
]

function hhmmss(d: Date): string {
  return d.toISOString().slice(11, 19)
}

async function main() {
  const ids = process.argv.slice(2).length
    ? process.argv.slice(2)
    : DEFAULT_SESSIONS

  for (const sessionId of ids) {
    const stops = await prisma.hookEvent.findMany({
      where: { sessionId, type: { in: ['STOP', 'STOP_FAILURE'] } },
      orderBy: { createdAt: 'asc' },
      select: { type: true, createdAt: true, turnSummary: true },
    })
    // Also count non-stop events between consecutive stops to gauge turn size.
    const all = await prisma.hookEvent.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      select: { type: true, createdAt: true },
    })

    console.log(
      `\n#### session ${sessionId.slice(0, 8)} — ${stops.length} stop(s), ${all.length} events`
    )
    let prevAt: Date | null = null
    stops.forEach((s, i) => {
      const between = prevAt
        ? all.filter(e => e.createdAt > prevAt! && e.createdAt <= s.createdAt)
            .length
        : all.filter(e => e.createdAt <= s.createdAt).length
      const sum = s.turnSummary ? `sum(${s.turnSummary.length})` : '   ·     '
      console.log(
        `  ${String(i + 1).padStart(2)} ${hhmmss(s.createdAt)} ${s.type.padEnd(12)} events_in_turn=${String(between).padStart(4)}  ${sum}`
      )
      prevAt = s.createdAt
    })
  }
  await prisma.$disconnect()
}

main().catch(async err => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
