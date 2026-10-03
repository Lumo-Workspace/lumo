import { prisma } from '@/lib/db/prisma'
import type {
  ClaimVerdict,
  PrefilterSignal,
} from '@/lib/claim-faithfulness/types'
import { resolveDelivery } from '@/lib/claim-faithfulness/diff-oracle'
import {
  mapTaskRowToInputs,
  TASK_INPUT_SELECT,
} from '@/lib/claim-faithfulness/task-inputs'
import { classifyClaimFaithfulness } from '@/lib/claim-faithfulness/classify'
import {
  buildVerdictRow,
  claimFaithfulnessVerdictRepository,
  isFreshVerdict,
} from '@/lib/repositories/claim-faithfulness-verdict.repository'

const MODEL = 'anthropic/claude-sonnet-4.5'
const JUDGE_TIMEOUT = 90_000

export function parseAuditArgs(argv: string[]) {
  const get = (f: string) => {
    const i = argv.indexOf(f)
    return i >= 0 ? (argv[i + 1] ?? null) : null
  }
  const limit = get('--limit')
  return {
    dryRun: argv.includes('--dry-run'),
    resume: argv.includes('--resume'),
    task: get('--task'),
    since: get('--since'),
    limit: limit ? Number(limit) : null,
  }
}

export function summarizeVerdicts(
  rows: {
    identifier: string
    verdict: ClaimVerdict
    prefilterSignal: PrefilterSignal
  }[]
) {
  const counts: Record<string, number> = {}
  const underreportCandidatesMissed: string[] = []
  for (const r of rows) {
    counts[r.verdict] = (counts[r.verdict] ?? 0) + 1
    if (
      r.prefilterSignal === 'UNDERREPORT_CANDIDATE' &&
      r.verdict !== 'UNDERREPORT'
    ) {
      underreportCandidatesMissed.push(r.identifier)
    }
  }
  return { counts, underreportCandidatesMissed }
}

async function main(argv: string[]): Promise<number> {
  // Gateway key from .env.local (DB DATABASE_URL comes from `-r dotenv/config`
  // / .env.production). dotenv does not override already-set vars.
  const { config: loadEnv } = await import('dotenv')
  loadEnv({ path: '../../.env.local' })
  loadEnv({ path: '.env.local' })

  const args = parseAuditArgs(argv)
  const where: Record<string, unknown> = {
    status: { in: ['DONE', 'IN_REVIEW'] },
  }
  if (args.task) {
    const [team, num] = args.task.split('-')
    if (team && num) {
      Object.assign(where, { team: { identifier: team }, number: Number(num) })
    }
  }
  if (args.since) {
    Object.assign(where, { claimSnapshotAt: { gte: new Date(args.since) } })
  }

  const tasks = await prisma.task.findMany({
    where,
    select: { id: true, ...TASK_INPUT_SELECT },
    orderBy: { claimSnapshotAt: 'desc' },
    ...(args.limit ? { take: args.limit } : {}),
  })

  const report: {
    identifier: string
    verdict: ClaimVerdict
    prefilterSignal: PrefilterSignal
    diffScope: number
    evidence: string[]
    reasoning: string
  }[] = []

  // --resume: skip tasks that already carry a non-stale verdict, so an
  // interrupted full run can be re-launched without re-spending the judge on
  // work already persisted (and converges even under repeated interruption).
  const watermarks = args.resume
    ? await claimFaithfulnessVerdictRepository.listWatermarks()
    : new Map<string, { judgedClaimAt: Date | null; prNumbers: number[] }>()
  let skipped = 0

  for (const t of tasks) {
    // Resume skips by the claim axis only — this operational re-audit re-derives
    // the delivery from local git each run, so the live sweep's delivery-growth
    // axis (LUM-618) doesn't apply here.
    if (
      args.resume &&
      watermarks.has(t.id) &&
      isFreshVerdict(
        watermarks.get(t.id)?.judgedClaimAt ?? null,
        t.claimSnapshotAt
      )
    ) {
      skipped++
      continue
    }
    const inputs = mapTaskRowToInputs(t)
    const delivery = resolveDelivery(inputs.identifier)
    const result = await classifyClaimFaithfulness(
      { claim: inputs.claim, delivery },
      { timeoutMs: JUDGE_TIMEOUT }
    )
    if (!args.dryRun) {
      await claimFaithfulnessVerdictRepository.upsert(
        buildVerdictRow(
          t.id,
          inputs.identifier,
          delivery,
          result,
          inputs.claimSnapshotAt,
          MODEL
        )
      )
    }
    report.push({
      identifier: inputs.identifier,
      verdict: result.verdict,
      prefilterSignal: result.prefilterSignal,
      diffScope: result.diffScope,
      evidence: result.evidence,
      reasoning: result.reasoning,
    })
  }

  const summary = summarizeVerdicts(report)
  process.stdout.write(
    JSON.stringify(
      { dryRun: args.dryRun, resumeSkipped: skipped, summary, report },
      null,
      2
    ) + '\n'
  )
  await prisma.$disconnect()
  return 0
}

if (process.argv[1]?.endsWith('audit-claim-faithfulness.ts')) {
  main(process.argv.slice(2))
    .then(c => process.exit(c))
    .catch(e => {
      process.stderr.write(`audit: ${(e as Error).message}\n`)
      process.exit(1)
    })
}
