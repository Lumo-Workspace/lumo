import { prisma } from '@/lib/db/prisma'
import type { ClaimVerdict } from '@/lib/claim-faithfulness/types'
import { resolveDelivery } from '@/lib/claim-faithfulness/diff-oracle'
import {
  mapTaskRowToInputs,
  TASK_INPUT_SELECT,
} from '@/lib/claim-faithfulness/task-inputs'
import { classifyClaimFaithfulness } from '@/lib/claim-faithfulness/classify'
import { GOLD_SET } from './fixture'

export interface EvalRow {
  identifier: string
  expected: ClaimVerdict
  actual: ClaimVerdict
}

const ANCHORS = ['LUM-539', 'LUM-565', 'LUM-567', 'LUM-540', 'LUM-522']

export function scoreEval(rows: EvalRow[], anchors: string[]) {
  let correct = 0
  const confusion: Record<string, number> = {}
  let anchorsPassed = true
  for (const r of rows) {
    if (r.expected === r.actual) correct++
    const key = `${r.expected}->${r.actual}`
    confusion[key] = (confusion[key] ?? 0) + 1
    if (anchors.includes(r.identifier) && r.expected !== r.actual) {
      anchorsPassed = false
    }
  }
  return { total: rows.length, correct, anchorsPassed, confusion }
}

async function main(): Promise<number> {
  // DB (DATABASE_URL) comes from `-r dotenv/config` (.env.production). The
  // gateway key lives only in .env.local — load it here (dotenv does NOT
  // override already-set vars, so prod DATABASE_URL is preserved). `../../`
  // reaches the main checkout when running from a worktree.
  const { config: loadEnv } = await import('dotenv')
  loadEnv({ path: '../../.env.local' })
  loadEnv({ path: '.env.local' })

  const rows: EvalRow[] = []
  const misses: Array<EvalRow & { reasoning: string }> = []
  for (const g of GOLD_SET) {
    const [team, num] = g.identifier.split('-')
    if (!team || !num) continue
    const t = await prisma.task.findFirst({
      where: { team: { identifier: team }, number: Number(num) },
      select: TASK_INPUT_SELECT,
    })
    if (!t) continue
    const inputs = mapTaskRowToInputs(t)
    const delivery = resolveDelivery(g.identifier)
    const res = await classifyClaimFaithfulness(
      { claim: inputs.claim, delivery },
      { timeoutMs: 90_000 }
    )
    const row = {
      identifier: g.identifier,
      expected: g.label,
      actual: res.verdict,
    }
    rows.push(row)
    if (row.expected !== row.actual)
      misses.push({ ...row, reasoning: res.reasoning })
  }
  const score = scoreEval(rows, ANCHORS)
  process.stdout.write(JSON.stringify({ score, misses, rows }, null, 2) + '\n')
  await prisma.$disconnect()
  return score.anchorsPassed ? 0 : 1
}

if (process.argv[1]?.endsWith('eval.ts')) {
  main()
    .then(c => process.exit(c))
    .catch(e => {
      process.stderr.write(`eval: ${(e as Error).message}\n`)
      process.exit(1)
    })
}
