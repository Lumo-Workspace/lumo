/**
 * LUM-707 item 4 — measure what `referenceClassRepository.criterionChanges`
 * actually transfers for a real reference class.
 *
 * LUM-497's review flagged that this read selects the whole `payload` JSON
 * (before/after carry full criterion snapshots: statement, judgeSteps,
 * checkpointer) while the consumer reads only `op` / `criterionId` / `round`,
 * and guessed it might move ~1MB per session start. Prisma cannot project INTO
 * a JSON column and CLAUDE.md forbids raw SQL, so the item was filed as
 * measure-then-decide rather than as a fix. This is the measurement.
 *
 * Replicates the production read exactly: pick the largest class the anchor
 * could select (delivered tasks = TaskCriteriaSnapshot rows, capped at
 * MAX_CLASS_SIZE, newest first), run the same CRITERION_CHANGED query, and
 * weigh the payloads. Read-only — findMany/groupBy, no writes.
 *
 *   DOTENV_CONFIG_PATH="$(pwd)/.env.production" npx tsx -r dotenv/config \
 *     scripts/analysis/lum707-payload-volume/measure.ts
 *
 * Result on 2026-07-27 (worst case: a full 50-task class):
 *
 *   316 rows · 221.0 KB transferred · 20.5 KB consumed (9.3%)
 *   query wall time: median 97ms — from a laptop over the public internet to
 *     us-east-1, so an UPPER BOUND; production runs in-region
 *   payload.round stored as a JSON number in 316/316 rows
 *   rows with round>0, the only ones independenceSignal can use: 49/316 (53.8 KB)
 *
 * Decision: leave the read as it is. The ~1MB fear is off by 4-5x; 221 KB is an
 * ordinary result set. The one lever Prisma does offer — filtering ON the JSON
 * column (`payload path ['round'] gt 0`), which the type census above shows
 * would be safe and would cut transfer 76% — is declined on layering grounds,
 * not on feasibility: "which rows count" is the consumer's policy, and both
 * `rejectionRows` and `crossingRows` deliberately keep exactly that decision out
 * of their where-clauses so the pure layer owns it. Encoding `round > 0` here
 * would put one rule in two places, which is the defect LUM-707 item 1 exists to
 * remove, and would silently diverge this trail from the one `fidelity show`
 * reads.
 *
 * Re-run this if the numbers move: a class whose transfer clears ~1MB, or a
 * query median past ~250ms in-region, is worth revisiting — the filter above is
 * pre-analysed and ready, and at that point the cost would outweigh the
 * layering objection.
 */
import { prisma } from '@/lib/db/prisma'

const MAX_CLASS_SIZE = 50

function bytes(v: unknown): number {
  return Buffer.byteLength(JSON.stringify(v ?? null), 'utf8')
}

function fmt(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${n} B`
}

async function main() {
  // Widest realistic class: the team with the most delivered tasks.
  const grouped = await prisma.taskCriteriaSnapshot.groupBy({
    by: ['taskId'],
    _max: { frozenAt: true },
  })
  console.log(`delivered tasks in DB (distinct): ${grouped.length}`)

  const classTaskIds = grouped
    .sort(
      (a, b) =>
        (b._max.frozenAt?.getTime() ?? 0) - (a._max.frozenAt?.getTime() ?? 0)
    )
    .slice(0, MAX_CLASS_SIZE)
    .map(g => g.taskId)

  console.log(`class size measured: ${classTaskIds.length}`)

  // The exact production query.
  const rows = await prisma.taskActivity.findMany({
    where: { taskId: { in: classTaskIds }, type: 'CRITERION_CHANGED' },
    select: { taskId: true, payload: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })

  const total = rows.reduce((sum, r) => sum + bytes(r.payload), 0)
  const sizes = rows.map(r => bytes(r.payload)).sort((a, b) => a - b)

  // What the three consumed fields alone would weigh.
  const minimal = rows.reduce((sum, r) => {
    const p = (r.payload ?? {}) as Record<string, unknown>
    return sum + bytes({ op: p.op, criterionId: p.criterionId, round: p.round })
  }, 0)

  console.log(`CRITERION_CHANGED rows: ${rows.length}`)
  console.log(`total payload transferred: ${fmt(total)}`)
  console.log(`  mean/row:   ${fmt(Math.round(total / (rows.length || 1)))}`)
  console.log(`  median/row: ${fmt(sizes[Math.floor(sizes.length / 2)] ?? 0)}`)
  console.log(`  max/row:    ${fmt(sizes[sizes.length - 1] ?? 0)}`)
  console.log(
    `consumed fields only (op/criterionId/round): ${fmt(minimal)} — ${((minimal / (total || 1)) * 100).toFixed(1)}% of transferred`
  )
  console.log(`waste if projection were possible: ${fmt(total - minimal)}`)

  // How many rows the round>0 filter alone would drop (the other lever:
  // Prisma cannot project INTO a JSON column, but it can filter ON one).
  const postStart = rows.filter(r => {
    const p = (r.payload ?? {}) as Record<string, unknown>
    return typeof p.round === 'number' && p.round > 0
  })
  const postStartBytes = postStart.reduce((s, r) => s + bytes(r.payload), 0)
  console.log(
    `rows with round>0 (the only ones the signal can use): ${postStart.length}/${rows.length} = ${fmt(postStartBytes)}`
  )

  // Would a DB-side round>0 filter silently drop real signal? Only if `round`
  // is ever stored as something other than a JSON number.
  const roundTypes = new Map<string, number>()
  for (const r of rows) {
    const p = (r.payload ?? {}) as Record<string, unknown>
    const t = p.round === undefined ? 'absent' : typeof p.round
    roundTypes.set(t, (roundTypes.get(t) ?? 0) + 1)
  }
  console.log(
    `stored types of payload.round: ${JSON.stringify(Object.fromEntries(roundTypes))}`
  )

  // The number the 600ms session-start budget actually cares about.
  const timings: number[] = []
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now()
    await prisma.taskActivity.findMany({
      where: { taskId: { in: classTaskIds }, type: 'CRITERION_CHANGED' },
      select: { taskId: true, payload: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })
    timings.push(performance.now() - t0)
  }
  timings.sort((a, b) => a - b)
  console.log(
    `query wall time over 5 runs (ms): min ${timings[0]!.toFixed(0)} · median ${timings[2]!.toFixed(0)} · max ${timings[4]!.toFixed(0)}`
  )
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
