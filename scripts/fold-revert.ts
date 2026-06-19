/**
 * LUM-556 — one-time OFFLINE revert for over-merged fold coarse cards.
 *
 * The pre-LUM-556 fold lumped unrelated subsystems into single mega-cards. This
 * un-folds a chosen coarse card: its SUPERSEDED source cards are restored to
 * ACTIVE and the coarse card is ARCHIVED (reversible — nothing deleted). After
 * reverting, re-run `scripts/fold-backfill.ts --apply` so the restored granular
 * cards re-fold coherently under the new size/coherence guard.
 *
 * A "fold coarse card" is detected structurally: an ACTIVE card that has ≥2
 * SUPERSEDED children pointing at it via supersededById (a reconcile-on-write
 * SUPERSEDE has exactly 1 child, so the ≥2 cut excludes it).
 *
 * Reads prod via `.env.production`. Dry-run/inspect by default.
 *
 *   npx tsx scripts/fold-revert.ts                          # list fold coarse cards
 *   npx tsx scripts/fold-revert.ts --id <coarseId> [--id …] # preview a revert
 *   npx tsx scripts/fold-revert.ts --id <coarseId> --apply  # revert it
 */
import { config } from 'dotenv'
config({ path: '.env.production' })
config({ path: '.env.local' })

function flatten(content: unknown): string {
  if (content === null || typeof content !== 'object') return ''
  return Object.values(content as Record<string, unknown>)
    .map(v => (Array.isArray(v) ? v.join(' ') : typeof v === 'string' ? v : ''))
    .filter(Boolean)
    .join(' — ')
}

async function main() {
  const apply = process.argv.includes('--apply')
  const ids = process.argv.reduce<string[]>((acc, arg, i) => {
    if (arg === '--id' && process.argv[i + 1]) acc.push(process.argv[i + 1]!)
    return acc
  }, [])
  const projFlag = process.argv.indexOf('--project')
  const explicitProject = projFlag >= 0 ? process.argv[projFlag + 1] : undefined

  const { prisma } = await import('@/lib/db/prisma')

  // Resolve the target project (the largest active one, like fold-backfill).
  let projectId = explicitProject
  if (!projectId) {
    const rows = await prisma.memory.findMany({
      where: { scope: 'PROJECT', status: 'ACTIVE' },
      select: { projectId: true },
    })
    const count = new Map<string, number>()
    for (const r of rows)
      if (r.projectId) count.set(r.projectId, (count.get(r.projectId) ?? 0) + 1)
    projectId = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  }
  if (!projectId) throw new Error('no project found')

  // Every supersede link in the project (fold AND reconcile), so the revert can
  // walk a recursive fold tree down to its granular leaves.
  const superseded = await prisma.memory.findMany({
    where: {
      scope: 'PROJECT',
      projectId,
      status: 'SUPERSEDED',
      supersededById: { not: null },
    },
    select: { id: true, supersededById: true },
  })
  const childrenByParent = new Map<string, string[]>()
  for (const c of superseded) {
    const k = c.supersededById!
    childrenByParent.set(k, [...(childrenByParent.get(k) ?? []), c.id])
  }
  // Fold coarse cards = ACTIVE parents with ≥2 superseded children.
  const foldParentIds = [...childrenByParent.entries()]
    .filter(([, s]) => s.length >= 2)
    .map(([id]) => id)
  const coarseCards = await prisma.memory.findMany({
    where: { id: { in: foldParentIds }, status: 'ACTIVE' },
    select: { id: true, category: true, content: true },
  })
  const byId = new Map(coarseCards.map(c => [c.id, c]))

  // Recursively walk a fold tree rooted at an ACTIVE coarse card: granular
  // leaves (no superseded children) are restored to ACTIVE; every intermediate
  // coarse node (incl. the root) is ARCHIVED. Returns { leaves, coarse } ids.
  const unfoldTree = (root: string) => {
    const leaves: string[] = []
    const coarse: string[] = []
    const visit = (id: string) => {
      const kids = childrenByParent.get(id)
      if (!kids || kids.length === 0) {
        leaves.push(id)
        return
      }
      coarse.push(id)
      for (const k of kids) visit(k)
    }
    visit(root)
    return { leaves, coarse }
  }
  const sourcesByCoarse = childrenByParent // alias for inspect output

  // ── INSPECT (no --id): list every fold coarse card to choose from ──────────
  if (ids.length === 0) {
    console.error(
      `[revert] project=${projectId} — ${coarseCards.length} fold coarse card(s):\n`
    )
    for (const c of coarseCards.sort(
      (a, b) =>
        (sourcesByCoarse.get(b.id)?.length ?? 0) -
        (sourcesByCoarse.get(a.id)?.length ?? 0)
    )) {
      const n = sourcesByCoarse.get(c.id)?.length ?? 0
      console.error(
        `  ${c.id}  [${c.category}]  folds ${n}\n    ${flatten(c.content).slice(0, 200)}\n`
      )
    }
    console.error(
      'Pick the over-merged ones, then: npx tsx scripts/fold-revert.ts --id <id> [--id …] --apply'
    )
    await prisma.$disconnect()
    return
  }

  // ── REVERT (with --id): recursively un-fold each chosen tree ───────────────
  for (const coarseId of ids) {
    if (!byId.has(coarseId)) {
      console.error(
        `  ! ${coarseId}: not an ACTIVE fold coarse card in this project — skipped`
      )
      continue
    }
    const { leaves, coarse } = unfoldTree(coarseId)
    console.error(
      `[revert] ${coarseId} → restore ${leaves.length} granular leaves + archive ${coarse.length} coarse node(s) ${apply ? '(APPLY)' : '(DRY-RUN)'}`
    )
    if (!apply) continue
    await prisma.$transaction(async tx => {
      await tx.memory.updateMany({
        where: { id: { in: leaves }, status: 'SUPERSEDED' },
        data: { status: 'ACTIVE', supersededAt: null, supersededById: null },
      })
      await tx.memory.updateMany({
        where: { id: { in: coarse } },
        data: { status: 'ARCHIVED' },
      })
    })
  }

  if (!apply)
    console.error('[revert] DRY-RUN — nothing written. Re-run with --apply.')
  await prisma.$disconnect()
}

main().catch(e => {
  console.error('FATAL', e)
  process.exit(1)
})
