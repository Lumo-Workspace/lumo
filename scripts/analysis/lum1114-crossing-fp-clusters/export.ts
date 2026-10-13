/**
 * LUM-1114 export — READ-ONLY. Dumps the task boundary crossings detected
 * since `--since` (default: 30 days ago) — every disposition state, OPEN
 * included — with only the fields the pattern clustering needs. findMany only,
 * no writes. Text fields are re-run through the secret registry
 * (`redactForStorage`) and size-capped before they leave the process.
 *
 *   DATABASE_URL='<prod pooled url>' npx tsx \
 *     scripts/analysis/lum1114-crossing-fp-clusters/export.ts \
 *     --out /tmp/lum1114/crossings.json [--since 2026-09-13] [--team LUM]
 *
 * Write the export OUTSIDE the repository; it is never committed.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { redactForStorage } from '@/lib/security-scan/scan-secrets'
import { formatCrossingRef } from '@/lib/boundary-crossing/crossing-ref'
import type { ExportedCrossing } from './cluster'

const MAX_TEXT = 500
const DEFAULT_DAYS = 30

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function safe(text: string | null): string | null {
  return text == null ? null : redactForStorage(text).text.slice(0, MAX_TEXT)
}

async function main(): Promise<void> {
  const out = flag('--out')
  if (!out) throw new Error('--out <path> is required (outside the repo)')
  const outPath = resolve(out)
  if (outPath.startsWith(resolve(process.cwd()))) {
    throw new Error('--out must be outside the repository checkout')
  }
  const sinceFlag = flag('--since')
  const since = sinceFlag
    ? new Date(sinceFlag)
    : new Date(Date.now() - DEFAULT_DAYS * 24 * 60 * 60 * 1000)
  if (Number.isNaN(since.getTime())) throw new Error('--since: invalid date')
  const team = flag('--team')

  const { prisma } = await import('@/lib/db/prisma')
  const host = new URL(process.env.DATABASE_URL ?? 'postgres://unset').host
  process.stdout.write(
    `[read-only] LUM-1114 export · db ${host} · since ${since.toISOString()}${team ? ` · team ${team}` : ''}\n`
  )

  const rows = await prisma.boundaryCrossing.findMany({
    where: {
      detectedAt: { gte: since },
      taskId: { not: null },
      ...(team ? { task: { team: { identifier: team } } } : {}),
    },
    select: {
      id: true,
      number: true,
      category: true,
      severity: true,
      advisory: true,
      disposition: true,
      detail: true,
      target: true,
      policyRuleText: true,
      triageProbability: true,
      detectedAt: true,
      task: { select: { team: { select: { identifier: true } } } },
    },
    orderBy: { detectedAt: 'asc' },
  })

  const items: ExportedCrossing[] = rows.map(r => ({
    id: r.id,
    ref: formatCrossingRef(r.task?.team.identifier, r.number, r.id),
    category: r.category,
    severity: r.severity,
    advisory: r.advisory,
    disposition: r.disposition,
    detail: safe(r.detail) ?? '',
    target: safe(r.target),
    policyRuleText: safe(r.policyRuleText),
    triageProbability: r.triageProbability,
    detectedAt: r.detectedAt.toISOString(),
  }))

  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, JSON.stringify(items, null, 2))
  process.stdout.write(`wrote ${items.length} crossings → ${outPath}\n`)
  await prisma.$disconnect()
}

main().catch(err => {
  process.stderr.write(`lum1114 export: ${(err as Error).message}\n`)
  process.exit(1)
})
