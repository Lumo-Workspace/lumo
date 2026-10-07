import { memoryRepository } from '@/lib/repositories/memory.repository'
import { lineageService } from '@/lib/services/lineage.service'
import {
  computeProjectRetireCandidates,
  type RetireCandidate,
} from '@/lib/services/memory/retire.service'
import { nearDupClusters, type VecItem } from '@/lib/services/memory/near-dup'

/**
 * LUM-541 (P5) — one-time batch consolidation sweep over the stock PROJECT-scope
 * memories. P5's acceptance is "near-dup cluster count drops"; the LUM-540 retire
 * loop retires by value/contradiction, not duplication, so a near-dup MERGE pass
 * is added here and the retire pass is reused alongside it. Cleanup is human-
 * confirmed and reversible (see the merge/retire routes) — this module only
 * COMPUTES proposals; it performs no writes except the explicit `mergeConfirmed`
 * action invoked by the human-only route.
 *
 * Floor: 0.85 — the cosine at which the eval harness already counts residual
 * near-dup clusters (internal LUM-538 memory eval), kept identical so the
 * human's before/after cluster count is the very metric the sweep clusters on.
 */
export const NEAR_DUP_MERGE_FLOOR = 0.85

export interface MergeProposal {
  /** The row kept ACTIVE (most judged-used in the cluster; tie-break: lowest id). */
  canonicalId: string
  /** The near-dup siblings merged away (ARCHIVED on human confirm). */
  supersededIds: string[]
}

/**
 * Pure: turn near-dup clusters into merge proposals. The canonical is the
 * highest-ranked row (rank = judged-used task count, so the proven entry
 * survives), tie-broken by lowest id for determinism; the rest become the
 * supersede set. No I/O.
 */
export function proposeMergesFromClusters(
  items: VecItem[],
  floor: number,
  rankById: Map<string, number> = new Map()
): MergeProposal[] {
  return nearDupClusters(items, floor).map(ids => {
    const ordered = [...ids].sort((a, b) => {
      const ra = rankById.get(a) ?? 0
      const rb = rankById.get(b) ?? 0
      if (ra !== rb) return rb - ra // higher rank first
      return a < b ? -1 : a > b ? 1 : 0 // tie-break: lowest id
    })
    const [canonicalId, ...supersededIds] = ordered
    return { canonicalId: canonicalId!, supersededIds }
  })
}

export interface ProjectMergeReport {
  projectId: string
  /** Number of multi-member near-dup clusters currently in the corpus. */
  nearDupClusterCount: number
  mergeProposals: MergeProposal[]
}

/**
 * Cluster one project's ACTIVE PROJECT-scope memories and propose merges.
 * Read-only: reads the embedded corpus and the live judged-used track record
 * (to pick the proven row as canonical); writes nothing.
 */
export async function computeProjectMergeProposals(
  projectId: string
): Promise<ProjectMergeReport> {
  const items = await memoryRepository.findActiveProjectMemoryVectors(projectId)
  if (items.length === 0) {
    return { projectId, nearDupClusterCount: 0, mergeProposals: [] }
  }
  const trust = await lineageService.fragmentTrustForMemories(
    items.map(i => i.id)
  )
  const rankById = new Map<string, number>(
    Object.entries(trust).map(([id, v]) => [id, v.judgedUsedTasks])
  )
  const mergeProposals = proposeMergesFromClusters(
    items,
    NEAR_DUP_MERGE_FLOOR,
    rankById
  )
  return {
    projectId,
    nearDupClusterCount: mergeProposals.length,
    mergeProposals,
  }
}

export interface ProjectConsolidationReport extends ProjectMergeReport {
  retireCandidates: RetireCandidate[]
}

export interface BatchConsolidationReport {
  projects: ProjectConsolidationReport[]
  /** Workspace-wide near-dup cluster count = the headline P5 acceptance metric. */
  totalNearDupClusters: number
}

/**
 * The one-time sweep: for each project, assemble both the near-dup merge
 * proposals and the LUM-540 retire candidates, so a reviewer sees both axes of
 * cleanup in one batch. Read-only.
 */
export async function computeBatchConsolidation(
  projectIds: string[]
): Promise<BatchConsolidationReport> {
  const projects: ProjectConsolidationReport[] = []
  for (const projectId of projectIds) {
    const merge = await computeProjectMergeProposals(projectId)
    const retireCandidates = await computeProjectRetireCandidates(projectId)
    projects.push({ ...merge, retireCandidates })
  }
  return {
    projects,
    totalNearDupClusters: projects.reduce(
      (n, p) => n + p.nearDupClusterCount,
      0
    ),
  }
}

/**
 * The human-confirmed near-dup merge action — invoked only by the human-only
 * merge route. Archives the superseded duplicates through the existing status
 * machine (ACTIVE→ARCHIVED, reversible), bounded to the caller's workspace; the
 * canonical row is left ACTIVE. Never a hard delete (失效非删). Returns the
 * number of rows actually archived.
 */
export async function mergeConfirmed(
  supersededIds: string[],
  workspaceId: string
): Promise<number> {
  const res = await memoryRepository.archiveMemoriesInWorkspace(
    supersededIds,
    workspaceId
  )
  return res.count
}
