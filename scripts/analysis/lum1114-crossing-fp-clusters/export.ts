/**
 * LUM-1114 export — READ-ONLY. Dumps the task boundary crossings detected
 * since `--since` (default: 30 days ago) — every disposition state, OPEN
 * included — with only the fields the pattern clustering needs. findMany only,
 * no writes. Text fields are re-run through the secret registry
 * (`redactForStorage`) and size-capped before they leave the process.
 *
 *   DATABASE_URL='<prod pooled url>' npx tsx \
 *     scripts/analysis/lum1114-crossing-fp-clusters/export.ts \
 *     --out /tmp/lum1114/crossings.json --workspace lumo --team LUM [--since 2026-09-13]
 *
 * One tenant by default — other workspaces' crossings are customer data.
 * `--workspace <slug>` must resolve to exactly ONE workspace (slugs and team
 * identifiers are not unique across tenants — a bare `--team LUM` would also
 * read another tenant's "LUM"); `--team` then narrows inside it.
 * `--all-tenants` instead reads every workspace; only with a reason that
 * needs it (and the customers' data agreements allow it).
 *
 * Write the export OUTSIDE the repository; it is never committed.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
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
  // Outside = the relative path climbs out (`..` / `../…`, not a dir named
  // `..foo`) or jumps drives; a plain prefix match would also reject a sibling
  // like `<repo>-exports/`.
  const rel = relative(resolve(process.cwd()), outPath)
  const outside = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
  if (!outside) {
    throw new Error('--out must be outside the repository checkout')
  }
  const sinceFlag = flag('--since')
  const since = sinceFlag
    ? new Date(sinceFlag)
    : new Date(Date.now() - DEFAULT_DAYS * 24 * 60 * 60 * 1000)
  if (Number.isNaN(since.getTime())) throw new Error('--since: invalid date')
  // Tenant-scoped by default: other workspaces' crossings are customer data.
  // Reading across tenants is an explicit, separate decision.
  const slug = flag('--workspace')
  const team = flag('--team')
  const allTenants = process.argv.includes('--all-tenants')
  if (!slug && !allTenants) {
    throw new Error(
      '--workspace <slug> is required (e.g. --workspace lumo --team LUM); crossing tenants needs --all-tenants'
    )
  }

  const { prisma } = await import('@/lib/db/prisma')
  const host = new URL(process.env.DATABASE_URL ?? 'postgres://unset').host
  let workspaceId: string | null = null
  if (slug) {
    const matches = await prisma.workspace.findMany({
      where: { slug },
      select: { id: true, name: true },
    })
    if (matches.length !== 1)
      throw new Error(
        `--workspace ${slug} matches ${matches.length} workspaces — refusing (tenant must be unambiguous)`
      )
    workspaceId = matches[0]!.id
    process.stdout.write(
      `[read-only] tenant: workspace ${matches[0]!.name} (${workspaceId})\n`
    )
  }
  process.stdout.write(
    `[read-only] LUM-1114 export · db ${host} · since ${since.toISOString()}${team ? ` · team ${team}` : ''}\n`
  )

  const rows = await prisma.boundaryCrossing.findMany({
    where: {
      detectedAt: { gte: since },
      taskId: { not: null },
      ...(workspaceId || team
        ? {
            task: {
              ...(workspaceId ? { workspaceId } : {}),
              ...(team ? { team: { identifier: team } } : {}),
            },
          }
        : {}),
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
