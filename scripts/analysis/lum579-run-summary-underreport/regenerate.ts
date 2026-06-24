/**
 * LUM-579 — regenerate run-summaries for the negative-claim DONE tasks so the
 * claim column stops under-reporting delivered work.
 *
 * DEFAULT = dry-run (READ-ONLY apart from LLM calls): for each negative-claim
 * task it rebuilds the anchor session's run-summary input from the stored event
 * stream, asks the LLM for the proposed summary, classifies it, and reports
 * which claims would flip — WITHOUT writing anything. Pass `--apply` to actually
 * regenerate (overwrites every session's runSummary on each task and re-freezes
 * the claim snapshot via runSummaryService.regenerateForTask).
 *
 * Requires prod DB creds AND gateway creds. dotenv does not override already-set
 * env, so export the gateway key first, then load .env.production for the DB:
 *   export AI_GATEWAY_API_KEY=$(grep '^AI_GATEWAY_API_KEY=' ../../.env.local | cut -d= -f2-)
 *   DOTENV_CONFIG_PATH="$(pwd)/.env.production" npx tsx -r dotenv/config \
 *     scripts/analysis/lum579-run-summary-underreport/regenerate.ts [--apply]
 */
import { prisma } from '@/lib/db/prisma'
import { enumerateNegativeClaims } from './enumerate'
import { isNegativeClaim } from './negative-claim'
import { buildRunSummaryInput } from '@/lib/services/run-summary/run-summary-input'
import { callRunSummaryLLM } from '@/lib/llm/run-summary-client'
import { runSummaryService } from '@/lib/services/run-summary.service'
import type { RawEvent } from '@/lib/services/session-summary/compact-events'

const APPLY = process.argv.includes('--apply')

function clip(s: string, n = 200): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, n)
}

async function loadEvents(sessionId: string): Promise<RawEvent[]> {
  const events = await prisma.hookEvent.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      type: true,
      toolName: true,
      payload: true,
      createdAt: true,
    },
  })
  return events as unknown as RawEvent[]
}

async function main() {
  const rows = await enumerateNegativeClaims()
  console.log(
    `mode: ${APPLY ? 'APPLY (writes to prod)' : 'DRY-RUN (no writes)'}`
  )
  console.log(`beforeNeg = ${rows.length}\n`)

  let flips = 0
  let stillNeg = 0
  let noMaterial = 0

  for (const r of rows) {
    if (APPLY) {
      const res = await runSummaryService.regenerateForTask(r.taskId)
      const t = await prisma.task.findUnique({
        where: { id: r.taskId },
        select: { claimSnapshot: true },
      })
      const neg = isNegativeClaim(t?.claimSnapshot)
      if (neg) stillNeg++
      else flips++
      console.log(
        `LUM-${r.number}  regenerated ${res.generated} session(s)  ${neg ? 'STILL NEG' : '→ flipped positive'}`
      )
      if (!neg)
        console.log(`   new claim: ${clip(t?.claimSnapshot ?? '', 220)}`)
    } else {
      const sid = r.claimSnapshotSessionId
      if (!sid) {
        noMaterial++
        console.log(`LUM-${r.number}  (no anchor session)`)
        continue
      }
      const input = buildRunSummaryInput(await loadEvents(sid))
      if (!input) {
        noMaterial++
        console.log(`LUM-${r.number}  (no material in anchor session)`)
        continue
      }
      const proposed = await callRunSummaryLLM({
        taskTitle: r.title,
        eventLog: input,
      })
      const neg = isNegativeClaim(proposed)
      if (neg) stillNeg++
      else flips++
      console.log(`LUM-${r.number}  ${neg ? 'STILL NEG' : '→ FLIPS positive'}`)
      console.log(`   old: ${clip(r.claim, 150)}`)
      console.log(`   new: ${clip(proposed, 220)}`)
    }
  }

  console.log(
    `\n${APPLY ? 'actual' : 'projected'}: ${flips} flipped positive, ${stillNeg} still negative, ${noMaterial} no-material`
  )
  console.log(`afterNeg ≈ ${stillNeg + noMaterial} (was ${rows.length})`)
  await prisma.$disconnect()
}

main().catch(async err => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
