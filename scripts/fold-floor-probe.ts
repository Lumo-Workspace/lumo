/**
 * LUM-556 — deterministic floor probe (no LLM). For the largest project, run the
 * same nearDupClusters the fold coherence guard uses, per category, across a
 * sweep of cosine floors. Reveals how the embedding structure separates so the
 * FOLD_COHERENCE_FLOOR can be picked from data, not blind LLM dry-runs.
 *
 *   npx tsx scripts/fold-floor-probe.ts
 */
import { config } from 'dotenv'
config({ path: '.env.production' })
config({ path: '.env.local' })

async function main() {
  const { prisma } = await import('@/lib/db/prisma')
  const { memoryRepository } =
    await import('@/lib/repositories/memory.repository')
  const { nearDupClusters } = await import('@/lib/services/memory/near-dup')

  const rows = await prisma.memory.findMany({
    where: { scope: 'PROJECT', status: 'ACTIVE' },
    select: { projectId: true },
  })
  const count = new Map<string, number>()
  for (const r of rows)
    if (r.projectId) count.set(r.projectId, (count.get(r.projectId) ?? 0) + 1)
  const projectId = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  if (!projectId) throw new Error('no project')

  const [active, vecs] = await Promise.all([
    memoryRepository.findActiveProjectMemories(projectId),
    memoryRepository.findActiveProjectMemoryVectors(projectId),
  ])
  const vById = new Map(vecs.map(v => [v.id, v.vector]))
  const cats = ['TRAP', 'DECISION', 'CONVENTION', 'PROCEDURAL'] as const
  const floors = [0.6, 0.62, 0.64, 0.66, 0.68, 0.7, 0.72]

  for (const cat of cats) {
    const items = active
      .filter(m => m.category === cat)
      .map(m => ({ id: m.id, vector: vById.get(m.id) }))
      .filter((i): i is { id: string; vector: number[] } => !!i.vector)
    console.error(`\n[${cat}] ${items.length} embedded cards`)
    for (const f of floors) {
      const clusters = nearDupClusters(items, f).filter(c => c.length >= 3)
      const sizes = clusters.map(c => c.length).sort((a, b) => b - a)
      console.error(
        `  floor ${f}: ${clusters.length} cluster(s) ≥3 → sizes [${sizes.join(', ')}]`
      )
    }
  }
  await prisma.$disconnect()
}

main().catch(e => {
  console.error('FATAL', e)
  process.exit(1)
})
