/**
 * LUM-601 — automatic git-topology referent sweep for the post-hoc outcome well.
 *
 * Scans delivered tasks (DONE, with a merged PR that reports a mergeCommitSha)
 * and records any git-topology rejection — a formal revert or a downstream
 * content reversal — into the well as a source=GIT OutcomeSignal. Idempotent:
 * re-running never double-inserts (keyed by revertingSha).
 *
 * WHY A SCRIPT, NOT THE CRON: the detector reads git, so it can only run where a
 * checkout exists (CI / a maintainer's machine / a checkout-backed cron) — never
 * the serverless server cron, which has no repo. Run it from the repo root with
 * origin/main fetched.
 *
 * KNOWN-UNCOVERED (registered honestly — the well is NOT "full"):
 *   - CI / deploy rollback signals (OutcomeSignalSource.CI) — needs a webhook.
 *   - Partial reversals — only exact full reversals match a patch-id.
 *
 * The agent is NOT in the write loop: inputs are git commit topology and the
 * task's delivery shas only. No self-report field exists.
 *
 *   npx tsx -r dotenv/config scripts/detect-git-outcome-rejections.ts [--dry-run] [--task LUM-N] [--since 2026-06-01] [--limit N]
 */
import { prisma } from '@/lib/db/prisma'
import { gitOutcomeRecorder } from '@/lib/services/outcome/git-outcome-recorder'
import {
  detectGitRejections,
  type GitRejectionSignal,
} from '@/lib/services/outcome/git-referent-detector'

export function parseArgs(argv: string[]) {
  const get = (f: string) => {
    const i = argv.indexOf(f)
    return i >= 0 ? (argv[i + 1] ?? null) : null
  }
  const limit = get('--limit')
  return {
    dryRun: argv.includes('--dry-run'),
    task: get('--task'),
    since: get('--since'),
    limit: limit ? Number(limit) : null,
  }
}

interface DeliveredTask {
  taskId: string
  workspaceId: string
  identifier: string
  shas: string[]
}

/** Group merged PRs with a mergeCommitSha by their delivered (DONE) task. */
export function groupDeliveries(
  prs: Array<{
    taskId: string | null
    workspaceId: string
    mergeCommitSha: string | null
    task: { number: number; team: { identifier: string } } | null
  }>
): DeliveredTask[] {
  const byTask = new Map<string, DeliveredTask>()
  for (const pr of prs) {
    if (!pr.taskId || !pr.mergeCommitSha || !pr.task) continue
    const existing = byTask.get(pr.taskId)
    if (existing) {
      if (!existing.shas.includes(pr.mergeCommitSha))
        existing.shas.push(pr.mergeCommitSha)
      continue
    }
    byTask.set(pr.taskId, {
      taskId: pr.taskId,
      workspaceId: pr.workspaceId,
      identifier: `${pr.task.team.identifier}-${pr.task.number}`,
      shas: [pr.mergeCommitSha],
    })
  }
  return [...byTask.values()]
}

async function main(argv: string[]): Promise<number> {
  const { config: loadEnv } = await import('dotenv')
  loadEnv({ path: '.env.local' })

  const args = parseArgs(argv)

  const where: Record<string, unknown> = {
    state: 'merged',
    mergeCommitSha: { not: null },
    taskId: { not: null },
    task: { status: 'DONE' },
  }
  if (args.since) where.mergedAt = { gte: new Date(args.since) }
  if (args.task) {
    const [team, num] = args.task.split('-')
    if (team && num)
      where.task = {
        status: 'DONE',
        number: Number(num),
        team: { identifier: team },
      }
  }

  const prs = await prisma.pullRequest.findMany({
    where,
    orderBy: { mergedAt: 'desc' },
    select: {
      taskId: true,
      workspaceId: true,
      mergeCommitSha: true,
      task: {
        select: { number: true, team: { select: { identifier: true } } },
      },
    },
    ...(args.limit ? { take: args.limit * 4 } : {}),
  })

  let deliveries = groupDeliveries(prs)
  if (args.limit) deliveries = deliveries.slice(0, args.limit)

  let rejected = 0
  let inserted = 0
  let inconclusive = 0
  for (const d of deliveries) {
    try {
      if (args.dryRun) {
        const signals: GitRejectionSignal[] = detectGitRejections({
          identifier: d.identifier,
          shas: d.shas,
        })
        if (signals.length > 0) {
          rejected++
          for (const s of signals)
            process.stdout.write(
              `REJECTED ${d.identifier}  ${s.kind} (${s.mechanism}) ${s.revertingSha.slice(0, 8)} reverts ${s.revertedSha.slice(0, 8)}\n`
            )
        } else {
          inconclusive++
        }
        continue
      }
      const res = await gitOutcomeRecorder.recordGitRejections({
        workspaceId: d.workspaceId,
        taskId: d.taskId,
        delivery: { identifier: d.identifier, shas: d.shas },
      })
      if (res.signals.length > 0) rejected++
      else inconclusive++
      inserted += res.inserted
      for (const s of res.signals)
        process.stdout.write(
          `${res.inserted ? 'RECORDED' : 'KNOWN'} ${d.identifier}  ${s.kind} (${s.mechanism}) ${s.revertingSha.slice(0, 8)}\n`
        )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`SKIP ${d.identifier}: ${msg}\n`)
    }
  }

  process.stdout.write(
    `\nScanned ${deliveries.length} delivered task(s): ${rejected} REJECTED, ${inconclusive} INCONCLUSIVE` +
      `${args.dryRun ? ' (dry-run, nothing written)' : `, ${inserted} new signal(s) recorded`}\n`
  )
  return 0
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then(code => process.exit(code))
    .catch(err => {
      console.error(err)
      process.exit(1)
    })
    .finally(() => prisma.$disconnect())
}

export { main }
