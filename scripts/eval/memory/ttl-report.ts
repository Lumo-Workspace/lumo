/**
 * DESCRIPTIVE ONLY (LUM-329). Reuses lineage `used=true` votes as a proxy for
 * "an injected CONVENTION/PROCEDURAL fragment got applied". No ground truth —
 * reported in a separate descriptive section, NEVER alongside the AR/SF metrics.
 */
import type { MemoryCategory } from '@prisma/client'

export interface UsageRow {
  category: MemoryCategory
  used: boolean | null
}

export type UsedRateByCategory = Partial<
  Record<MemoryCategory, { usedRate: number; voted: number; used: number }>
>

/** voted = used !== null; usedRate = (used === true) / voted, per category. */
export function aggregateUsedRate(rows: UsageRow[]): UsedRateByCategory {
  const acc: UsedRateByCategory = {}
  for (const row of rows) {
    if (row.used === null) continue
    const cur = acc[row.category] ?? { usedRate: 0, voted: 0, used: 0 }
    cur.voted++
    if (row.used) cur.used++
    cur.usedRate = cur.used / cur.voted
    acc[row.category] = cur
  }
  return acc
}

if (require.main === module) {
  void import('dotenv').then(async ({ config }) => {
    config({ path: '.env.local' })
    const { prisma } = await import('@/lib/db/prisma')
    // lineage_edges.fragmentId → memories.id for memory fragments; join to category.
    const rows = await prisma.$queryRaw<UsageRow[]>`
      SELECT m."category" AS category, e."used" AS used
      FROM "lineage_edges" e
      JOIN "memories" m ON m."id" = e."fragmentId"
      WHERE m."category" IN ('CONVENTION', 'PROCEDURAL')
    `
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(aggregateUsedRate(rows), null, 2))
    await prisma.$disconnect()
  })
}
