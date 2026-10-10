/**
 * LUM-775 — finding-queue read-out (task "验证口径").
 *
 * READ-ONLY — no writes. Loads every undispositioned `PrSecurityFinding`
 * with its scan and PR, the newest scan per PR, each repo's default-branch
 * baseline and each workspace's security policy, then classifies every row
 * with the same predicate the reminders / DONE gate / panel use and prints
 * the buckets, the OPEN queue with a per-row reason, and the numbers the
 * task started from (985 / 182 / 1) for the side-by-side.
 *
 * Run from the main checkout of origin/main (a worktree has no
 * .env.production):
 *   DOTENV_CONFIG_PATH="$(pwd)/.env.production" npx tsx -r dotenv/config scripts/analysis/lum775-finding-queue/report.ts
 */
import { prisma } from '../../../lib/db/prisma'
import {
  DEFAULT_SECURITY_POLICY,
  parseSecurityPolicy,
  type SecurityPolicy,
} from '@/ee/security/security-scan/policy'
import type { SecurityBaseline } from '@/ee/security/security-scan/types'
import {
  classifyQueue,
  renderQueueReport,
  type QueueFindingRow,
} from './aggregate'

async function main(): Promise<void> {
  const rows = (await prisma.prSecurityFinding.findMany({
    where: { disposition: null },
    select: {
      id: true,
      kind: true,
      ruleId: true,
      severity: true,
      provenance: true,
      filePath: true,
      fingerprint: true,
      persisting: true,
      scan: {
        select: {
          id: true,
          pullRequestId: true,
          workspaceId: true,
          pullRequest: {
            select: { number: true, state: true, repo: true, mergedAt: true },
          },
        },
      },
    },
  })) as QueueFindingRow[]

  const prIds = [...new Set(rows.map(r => r.scan.pullRequestId))]
  const scans = await prisma.prSecurityScan.findMany({
    where: { pullRequestId: { in: prIds } },
    select: { id: true, pullRequestId: true, startedAt: true },
  })
  const newest = new Map<string, { id: string; startedAt: Date }>()
  for (const s of scans) {
    const cur = newest.get(s.pullRequestId)
    if (!cur || s.startedAt.getTime() > cur.startedAt.getTime())
      newest.set(s.pullRequestId, s)
  }
  const latestScanIdByPr = new Map(
    [...newest.entries()].map(([pr, s]) => [pr, s.id] as const)
  )

  const repos = await prisma.projectRepository.findMany({
    select: {
      fullName: true,
      securityBaseline: true,
      project: { select: { workspaceId: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  const baselines = new Map<string, SecurityBaseline | null>()
  for (const r of repos) {
    const key = `${r.project.workspaceId}:${r.fullName}`
    // Same tie-break as projectRepository.findSecurityBaseline: oldest row wins.
    if (!baselines.has(key))
      baselines.set(
        key,
        (r.securityBaseline as SecurityBaseline | null) ?? null
      )
  }

  const workspaces = await prisma.workspace.findMany({
    where: { id: { in: [...new Set(rows.map(r => r.scan.workspaceId))] } },
    select: { id: true, securityPolicy: true },
  })
  const policies = new Map<string, SecurityPolicy>(
    workspaces.map(w => [w.id, parseSecurityPolicy(w.securityPolicy)] as const)
  )

  const stats = classifyQueue({
    rows,
    latestScanIdByPr,
    baselines,
    policies,
    defaultPolicy: DEFAULT_SECURITY_POLICY,
  })
  process.stdout.write(renderQueueReport(stats))
}

main()
  .catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack : error}\n`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
