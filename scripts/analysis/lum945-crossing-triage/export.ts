/**
 * LUM-945 export — READ-ONLY. Dumps every human-dispositioned boundary
 * crossing (FALSE_POSITIVE / CONFIRMED) with its task context and agent
 * explanations into a local JSON corpus for the offline judge comparison.
 * findMany only — no writes. Every text field is passed through the secret
 * registry (`redactForStorage`) and size-capped before it leaves the process.
 *
 *   DATABASE_URL='<prod pooled url>' npx tsx \
 *     scripts/analysis/lum945-crossing-triage/export.ts --out /tmp/lum945/corpus.json
 *
 * Write the corpus OUTSIDE the repository; it is never committed.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { toCorpusItem, type CorpusItem } from './corpus'

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const out = flag('--out')
  if (!out) throw new Error('--out <path> is required (outside the repo)')
  const outPath = resolve(out)
  if (outPath.startsWith(resolve(process.cwd()))) {
    throw new Error('--out must be outside the repository checkout')
  }

  const { prisma } = await import('@/lib/db/prisma')
  const host = new URL(process.env.DATABASE_URL ?? 'postgres://unset').host
  process.stdout.write(`[read-only] LUM-945 export · db ${host}\n`)

  const rows = await prisma.boundaryCrossing.findMany({
    where: { disposition: { in: ['FALSE_POSITIVE', 'CONFIRMED'] } },
    select: {
      id: true,
      category: true,
      severity: true,
      reversible: true,
      advisory: true,
      detail: true,
      target: true,
      policyRuleText: true,
      disposition: true,
      dispositionNote: true,
      rawPurgedAt: true,
      task: {
        select: {
          number: true,
          title: true,
          description: true,
          team: { select: { identifier: true } },
        },
      },
      explanations: {
        select: { note: true },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { dispositionedAt: 'asc' },
  })

  const items = rows
    .map(toCorpusItem)
    .filter((i): i is CorpusItem => i !== null)

  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, JSON.stringify(items, null, 2))

  const byCategory = new Map<string, { fp: number; confirmed: number }>()
  for (const i of items) {
    const c = byCategory.get(i.category) ?? { fp: 0, confirmed: 0 }
    if (i.label === 'FALSE_POSITIVE') c.fp++
    else c.confirmed++
    byCategory.set(i.category, c)
  }
  process.stdout.write(
    `wrote ${items.length} items (of ${rows.length} rows) → ${outPath}\n`
  )
  for (const [cat, c] of [...byCategory].sort()) {
    process.stdout.write(`  ${cat}: ${c.fp} FP / ${c.confirmed} confirmed\n`)
  }
  const purged = items.filter(i => i.rawPurged).length
  process.stdout.write(`  raw-purged (LUM-912): ${purged}\n`)
  await prisma.$disconnect()
}

main().catch(err => {
  process.stderr.write(`lum945 export: ${(err as Error).message}\n`)
  process.exit(1)
})
