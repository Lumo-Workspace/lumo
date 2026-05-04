/**
 * One-shot backfill: for every STOP / STOP_FAILURE HookEvent with no
 * turnSummary, run the turn-summary service to populate it. Lets the
 * Agent Run timeline show LLM-generated turn headers for historical
 * sessions instead of the dumb first-sentence fallback.
 *
 * Safe to re-run — events that already have a non-null turnSummary are
 * skipped. Events with no sessionId are skipped (the service can't
 * reconstruct the turn without one).
 *
 * Cost: one Haiku call per row (~$0.0005). Sequential, not parallel,
 * to avoid hammering the gateway.
 *
 * Run with:
 *   npx tsx scripts/backfill-turn-summaries.ts
 */
import 'dotenv/config'
import { prisma } from '@/lib/db/prisma'
import { turnSummaryService } from '@/lib/services/turn-summary/turn-summary.service'

async function main() {
  const rows = await prisma.hookEvent.findMany({
    where: {
      type: { in: ['STOP', 'STOP_FAILURE'] },
      turnSummary: null,
      sessionId: { not: null },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, sessionId: true },
  })

  console.log(`[backfill] ${rows.length} STOP rows missing turnSummary`)

  let done = 0
  let failed = 0
  for (const row of rows) {
    if (!row.sessionId) continue
    try {
      await turnSummaryService.generateAndStore({
        stopEventId: row.id,
        sessionId: row.sessionId,
      })
      const after = await prisma.hookEvent.findUnique({
        where: { id: row.id },
        select: { turnSummary: true },
      })
      if (after?.turnSummary) {
        done++
        console.log(
          `[backfill] ${done}/${rows.length} ${row.id} → ${after.turnSummary.slice(0, 80)}`
        )
      } else {
        failed++
        console.log(`[backfill] ${row.id} no summary written`)
      }
    } catch (error) {
      failed++
      console.error(`[backfill] ${row.id} error:`, error)
    }
  }

  console.log(
    `[backfill] done — ${done} written, ${failed} failed/skipped, ${rows.length} total`
  )
}

main()
  .catch(err => {
    console.error('[backfill] fatal:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
