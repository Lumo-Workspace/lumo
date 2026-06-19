/**
 * LUM-553 — one-time OFFLINE backfill for the memory topic-fold backlog.
 *
 * Folding a large existing corpus (e.g. the live 266-card project) is minutes of
 * LLM work — too long for the serverless cron's time budget. This script runs the
 * same fold pipeline locally (no time limit) to collapse the backlog once; the
 * daily cron then maintains the trickle (a few new cards per run fits serverless).
 *
 * Reads prod via `.env.production` + the gateway key from `.env.local`.
 * Dry-run by default — pass `--apply` to actually fold. Folding is reversible
 * (sources → SUPERSEDED, never deleted). Re-run for another pass.
 *
 *   npx tsx scripts/fold-backfill.ts                 # preview (no writes)
 *   npx tsx scripts/fold-backfill.ts --apply         # fold the biggest project
 *   npx tsx scripts/fold-backfill.ts --apply --project <id>
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
  const projFlag = process.argv.indexOf('--project')
  const explicitId = projFlag >= 0 ? process.argv[projFlag + 1] : undefined

  const { prisma } = await import('@/lib/db/prisma')
  const { computeProjectFoldProposals } =
    await import('@/lib/services/memory/fold-compute')
  const { MEMORY_CAP, selectPruneTargets } =
    await import('@/lib/services/memory/fold.service')
  const { lineageService } = await import('@/lib/services/lineage.service')
  const { memoryRepository } =
    await import('@/lib/repositories/memory.repository')
  const { embedTexts } = await import('@/lib/ai/embedding')
  const { memoryContentToText } = await import('@/lib/memory/content-text')

  const pruneTargets = async (n: number): Promise<string[]> => {
    const act = await memoryRepository.findActiveProjectMemories(projectId!)
    const trust = await lineageService.fragmentTrustForMemories(
      act.map(m => m.id)
    )
    return selectPruneTargets(
      act,
      id => trust[id]?.judgedUsedTasks ?? 0,
      n,
      Date.now()
    )
  }

  let projectId = explicitId
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
  if (!projectId) throw new Error('no project to fold')

  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { name: true, workspaceId: true },
  })
  const before = await prisma.memory.count({
    where: { projectId, scope: 'PROJECT', status: 'ACTIVE' },
  })

  console.error(
    `[backfill] project=${project.name} ACTIVE=${before} mode=${apply ? 'APPLY' : 'DRY-RUN'}`
  )

  const { proposals } = await computeProjectFoldProposals(projectId) // unbounded
  const wouldFold = proposals.reduce((n, p) => n + p.sourceIds.length, 0)
  console.error(
    `[backfill] ${proposals.length} coarse cards would fold ${wouldFold} fine cards → ` +
      `projected ACTIVE ≈ ${before - wouldFold + proposals.length}`
  )
  for (const p of proposals) {
    console.error(
      `  [${p.category}] folds ${p.sourceIds.length}: ${flatten(p.coarseContent).slice(0, 140)}`
    )
  }

  // Prune plan (estimate on the pre-fold set; folds will remove some of these):
  const projectedAfterFold = before - wouldFold + proposals.length
  const eligible = (await pruneTargets(before)).length
  const wouldPrune = Math.min(
    Math.max(0, projectedAfterFold - MEMORY_CAP),
    eligible
  )
  console.error(
    `[backfill] then archive ~${wouldPrune} never-judged-used cards (≈${eligible} eligible) → ` +
      `projected ACTIVE ≈ ${projectedAfterFold - wouldPrune} (cap ${MEMORY_CAP})`
  )

  if (!apply) {
    console.error('[backfill] DRY-RUN — nothing written. Re-run with --apply.')
    await prisma.$disconnect()
    return
  }

  let folded = 0
  for (const p of proposals) {
    try {
      const { coarseId } = await memoryRepository.foldInto({
        sourceIds: p.sourceIds,
        coarseContent: p.coarseContent as Record<string, unknown>,
        category: p.category,
        projectId,
        workspaceId: project.workspaceId,
        sourceSessionId: null,
      })
      try {
        const [vec] = await embedTexts([
          memoryContentToText(p.category, p.coarseContent),
        ])
        if (vec) await memoryRepository.setEmbedding(coarseId, vec)
      } catch {
        /* embedding best-effort */
      }
      folded++
    } catch (e) {
      console.error(
        `  ! skipped one fold: ${e instanceof Error ? e.message : e}`
      )
    }
  }

  const afterFold = await prisma.memory.count({
    where: { projectId, scope: 'PROJECT', status: 'ACTIVE' },
  })

  // Re-rank on the POST-fold set (folded sources are now gone), then archive
  // (reversibly) just enough of the oldest never-judged-used cards to reach cap.
  let pruned = 0
  if (afterFold > MEMORY_CAP) {
    const ids = await pruneTargets(afterFold - MEMORY_CAP)
    if (ids.length) {
      pruned = (
        await memoryRepository.archiveMemoriesInWorkspace(
          ids,
          project.workspaceId
        )
      ).count
    }
  }

  const final = await prisma.memory.count({
    where: { projectId, scope: 'PROJECT', status: 'ACTIVE' },
  })
  console.error(
    `[backfill] APPLIED ${folded} folds + ${pruned} archives — ACTIVE ${before} → ${final} (cap ${MEMORY_CAP})`
  )
  await prisma.$disconnect()
}

main().catch(e => {
  console.error('FATAL', e)
  process.exit(1)
})
