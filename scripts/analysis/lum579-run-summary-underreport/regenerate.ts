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
 * `--tasks 529,530,...` overrides the classifier-driven enumeration with an
 * explicit task-number list. Use this for the LUM-579 follow-up repair of the
 * leftover under-reports the keyword classifier missed (e.g. a claim that names
 * a merged PR yet asserts the core work is undone — the merged PR is the robust
 * oracle the regex heuristic can't safely encode). The same event-stream
 * regeneration applies; only target selection differs.
 *
 * Requires prod DB creds AND gateway creds. dotenv does not override already-set
 * env, so export the gateway key first, then load .env.production for the DB:
 *   export AI_GATEWAY_API_KEY=$(grep '^AI_GATEWAY_API_KEY=' ../../.env.local | cut -d= -f2-)
 *   DOTENV_CONFIG_PATH="$(pwd)/.env.production" npx tsx -r dotenv/config \
 *     scripts/analysis/lum579-run-summary-underreport/regenerate.ts [--apply] [--tasks 529,530]
 */
import { prisma } from '@/lib/db/prisma'
import { openHookPayloads } from '@/lib/hook-event/payload-cipher'
import { enumerateNegativeClaims, type NegativeClaimRow } from './enumerate'
import { isNegativeClaim } from './negative-claim'
import { buildRunSummaryInput } from '@/lib/services/run-summary/run-summary-input'
import { callRunSummaryLLM } from '@/lib/llm/run-summary-client'
import { runSummaryService } from '@/lib/services/run-summary.service'
import type { RawEvent } from '@/lib/services/session-summary/compact-events'

const APPLY = process.argv.includes('--apply')

/** `--tasks 529,530` → [529, 530]; empty when the flag is absent. */
function parseTaskNumbers(): number[] {
  const i = process.argv.indexOf('--tasks')
  if (i === -1) return []
  return (process.argv[i + 1] ?? '')
    .split(',')
    .map(s => parseInt(s.replace(/[^0-9]/g, ''), 10))
    .filter(n => Number.isFinite(n))
}

/**
 * Build rows for an explicit task-number list, bypassing the negative-claim
 * classifier. Same shape as enumerateNegativeClaims so the rest of the run is
 * identical — these are tasks a human verified (against merged PRs) as genuine
 * under-reports the regex heuristic didn't catch.
 */
async function rowsForTaskNumbers(
  numbers: number[]
): Promise<NegativeClaimRow[]> {
  const team = await prisma.team.findFirst({
    where: { identifier: 'LUM' },
    select: { id: true },
  })
  if (!team) throw new Error('team LUM not found')
  const tasks = await prisma.task.findMany({
    where: { teamId: team.id, number: { in: numbers } },
    select: {
      id: true,
      number: true,
      title: true,
      claimSnapshot: true,
      claimSnapshotSessionId: true,
    },
    orderBy: { number: 'asc' },
  })
  return tasks.map(t => ({
    taskId: t.id,
    number: t.number,
    title: t.title,
    claimSnapshotSessionId: t.claimSnapshotSessionId,
    claim: t.claimSnapshot ?? '',
  }))
}

function clip(s: string, n = 200): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, n)
}

async function loadEvents(sessionId: string): Promise<RawEvent[]> {
  // LUM-863: payloads may be stored encrypted.
  const events = await openHookPayloads(
    await prisma.hookEvent.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        type: true,
        toolName: true,
        payload: true,
        payloadEncrypted: true,
        createdAt: true,
      },
    })
  )
  return events as unknown as RawEvent[]
}

async function main() {
  const targets = parseTaskNumbers()
  const rows = targets.length
    ? await rowsForTaskNumbers(targets)
    : await enumerateNegativeClaims()
  console.log(
    `mode: ${APPLY ? 'APPLY (writes to prod)' : 'DRY-RUN (no writes)'}`
  )
  console.log(
    targets.length
      ? `targeted: ${rows.length} task(s) [${rows.map(r => `LUM-${r.number}`).join(', ')}]\n`
      : `beforeNeg = ${rows.length}\n`
  )

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
