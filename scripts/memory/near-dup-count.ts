/**
 * LUM-541 (P5) — live near-dup cluster count over the stock PROJECT-scope
 * memories. The headline acceptance metric for the one-time cleanup: run it
 * BEFORE surfacing the batch sweep to capture a baseline, then again AFTER a
 * human confirms the surfaced merges/retires on the Memory review surface — the
 * count should have dropped materially and (with P1/LUM-538's hardened
 * generator) stay down.
 *
 * Same clustering the live sweep and the offline eval use
 * (`nearDupClusters`, cosine >= NEAR_DUP_MERGE_FLOOR), so the number here is the
 * very metric the merge proposals are built on. Read-only — counts, never writes.
 *
 * Usage: npx tsx scripts/memory/near-dup-count.ts
 *   (requires DATABASE_URL — reads the live corpus)
 */
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { nearDupClusters } from '@/lib/services/memory/near-dup'
import { NEAR_DUP_MERGE_FLOOR } from '@/lib/services/memory/batch-consolidate.service'

async function main(): Promise<void> {
  const projects =
    await memoryRepository.findProjectsOverActiveMemoryThreshold(0)

  let totalClusters = 0
  let totalMemories = 0
  const lines: string[] = []

  for (const { projectId, activeCount } of projects) {
    const items =
      await memoryRepository.findActiveProjectMemoryVectors(projectId)
    const clusters = nearDupClusters(items, NEAR_DUP_MERGE_FLOOR)
    totalClusters += clusters.length
    totalMemories += activeCount
    lines.push(
      `  ${projectId}: ${clusters.length} near-dup cluster(s) over ` +
        `${activeCount} active PROJECT memories (${items.length} embedded)`
    )
  }

  process.stdout.write(
    `near-dup cluster count (cos >= ${NEAR_DUP_MERGE_FLOOR}) over live ` +
      `PROJECT-scope memories\n`
  )
  for (const l of lines) process.stdout.write(l + '\n')
  process.stdout.write(
    `TOTAL: ${totalClusters} near-dup cluster(s) across ` +
      `${projects.length} project(s), ${totalMemories} active PROJECT memories\n`
  )
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    process.stderr.write(`near-dup-count failed: ${String(err)}\n`)
    process.exit(1)
  })
