/**
 * LUM-584 — closed-loop check (acceptance ④): re-run the LUM-582 claim-
 * faithfulness judge over the original UNDERREPORT population AFTER the stale
 * run-summaries were regenerated, and report the verdict transition per task.
 *
 * Reuses the LUM-582 verifier as-is (no change to the judge) — same
 * resolveDelivery + classifyClaimFaithfulness path as scripts/audit-claim-
 * faithfulness.ts — and upserts the fresh verdict so the persisted audit
 * reflects the repaired claims. The expectation: the stale-bad subset (real
 * delivery, pre-579 summary) flips UNDERREPORT → FAITHFUL; any task still
 * UNDERREPORT is a genuine non-delivery or a deeper defect (e.g. anchor
 * mis-selection), not a stale summary.
 *
 * Requires prod DB + gateway creds (calls the judge LLM):
 *   export AI_GATEWAY_API_KEY=$(grep '^AI_GATEWAY_API_KEY=' .env.local | cut -d= -f2- | tr -d '"')
 *   DOTENV_CONFIG_PATH="$(pwd)/.env.production" npx tsx -r dotenv/config \
 *     scripts/analysis/lum584-stale-runsummary-regen/reaudit.ts 90,116,...,561
 */
import { prisma } from '@/lib/db/prisma'
import { resolveDelivery } from '@/lib/claim-faithfulness/diff-oracle'
import {
  mapTaskRowToInputs,
  TASK_INPUT_SELECT,
} from '@/lib/claim-faithfulness/task-inputs'
import { classifyClaimFaithfulness } from '@/lib/claim-faithfulness/classify'
import {
  buildVerdictRow,
  claimFaithfulnessVerdictRepository,
} from '@/lib/repositories/claim-faithfulness-verdict.repository'

const MODEL = 'anthropic/claude-sonnet-4.5'
const JUDGE_TIMEOUT = 90_000

function parseNumbers(arg: string | undefined): number[] {
  return (arg ?? '')
    .split(',')
    .map(s => parseInt(s.replace(/[^0-9]/g, ''), 10))
    .filter(n => Number.isFinite(n))
}

async function main() {
  const { config: loadEnv } = await import('dotenv')
  loadEnv({ path: '../../.env.local' })
  loadEnv({ path: '.env.local' })

  const dryRun = process.argv.includes('--dry-run')
  const numbers = parseNumbers(process.argv.find(a => /^[0-9,]+$/.test(a)))
  if (numbers.length === 0)
    throw new Error('pass a comma-separated task-number list')

  const team = await prisma.team.findFirst({
    where: { identifier: 'LUM' },
    select: { id: true },
  })
  if (!team) throw new Error('team LUM not found')

  const tasks = await prisma.task.findMany({
    where: { teamId: team.id, number: { in: numbers } },
    select: { id: true, ...TASK_INPUT_SELECT },
    orderBy: { number: 'asc' },
  })

  const counts: Record<string, number> = {}
  const rows: { id: string; verdict: string; reasoning: string }[] = []
  for (const t of tasks) {
    const inputs = mapTaskRowToInputs(t)
    const prior = await claimFaithfulnessVerdictRepository.findByTaskId(t.id)
    const delivery = resolveDelivery(inputs.identifier)
    const res = await classifyClaimFaithfulness(
      { claim: inputs.claim, delivery },
      { timeoutMs: JUDGE_TIMEOUT }
    )
    if (!dryRun) {
      await claimFaithfulnessVerdictRepository.upsert(
        buildVerdictRow(
          t.id,
          inputs.identifier,
          delivery,
          res,
          inputs.claimSnapshotAt,
          MODEL
        )
      )
    }
    counts[res.verdict] = (counts[res.verdict] ?? 0) + 1
    const transition = `${prior?.verdict ?? '—'} → ${res.verdict}`
    rows.push({
      id: inputs.identifier,
      verdict: res.verdict,
      reasoning: res.reasoning,
    })
    console.log(`${inputs.identifier.padEnd(9)} ${transition}`)
    if (res.verdict !== 'FAITHFUL')
      console.log(`   ↳ ${res.reasoning.replace(/\s+/g, ' ').slice(0, 240)}`)
  }

  console.log(`\nverdict counts: ${JSON.stringify(counts)}`)
  await prisma.$disconnect()
}

main().catch(async err => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
