/**
 * LUM-793 — read-only sweep of every ACTIVE memory against the write gate.
 *
 *   npx tsx scripts/analysis/lum793-memory-poison/scan.ts
 *
 * Reads two tables and writes none. The read-only property is the point of
 * the script (a sweep that "fixed" what it found would be an unreviewed mass
 * edit of team knowledge), so it is asserted by a test rather than promised
 * by a comment: `runScan` takes its reads as an injected dependency, and the
 * test drives it with a client that throws on every mutating Prisma method.
 */
import { PrismaClient } from '@prisma/client'
import {
  classifyRows,
  formatReport,
  type ScanHit,
  type ScanRow,
} from './classify'
import type { PolicyRuleRef } from '@/lib/memory/poison-gate'

export interface ScanDeps {
  listActiveMemories(): Promise<ScanRow[]>
  listPolicyRules(projectId: string): Promise<PolicyRuleRef[]>
}

/** The only two reads this script performs. */
export function prismaDeps(client: {
  memory: { findMany: (args: unknown) => Promise<unknown[]> }
  projectPolicy: { findFirst: (args: unknown) => Promise<unknown> }
}): ScanDeps {
  return {
    async listActiveMemories() {
      const rows = (await client.memory.findMany({
        where: { status: 'ACTIVE' },
        select: {
          id: true,
          projectId: true,
          scope: true,
          category: true,
          content: true,
        },
        orderBy: { createdAt: 'asc' },
      })) as ScanRow[]
      return rows
    },
    async listPolicyRules(projectId: string) {
      const row = (await client.projectPolicy.findFirst({
        where: { projectId },
        orderBy: { compiledAt: 'desc' },
        select: { rules: true },
      })) as { rules: PolicyRuleRef[] } | null
      return row?.rules ?? []
    },
  }
}

export async function runScan(
  deps: ScanDeps
): Promise<{ hits: ScanHit[]; scanned: number; report: string }> {
  const rows = await deps.listActiveMemories()
  const byProject = new Map<string, readonly PolicyRuleRef[]>()
  for (const projectId of new Set(rows.map(r => r.projectId))) {
    byProject.set(projectId, await deps.listPolicyRules(projectId))
  }
  const hits = classifyRows(rows, byProject)
  return { hits, scanned: rows.length, report: formatReport(hits, rows.length) }
}

async function main(): Promise<void> {
  const prisma = new PrismaClient()
  try {
    const { report } = await runScan(prismaDeps(prisma))
    console.log(report)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
