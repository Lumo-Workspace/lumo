import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import type { UsageSignalHealth } from '@/types/lineage-usage'

type TaskRow = { taskId: string; resolved: boolean; merged: boolean }

/**
 * Task-deduped merge rate with the LUM-484 iteration taint applied: a resolved
 * task whose id is in `failed` is recounted as non-merged regardless of its
 * edge outcomes. `failed` (the negative-class size) = resolved − merged after
 * the taint, so it folds send-back-tainted, REWORKED and REJECTED tasks
 * uniformly. Null rate when there are no resolved tasks at all.
 */
function foldWithTaint(
  tasks: TaskRow[],
  failed: Set<string>
): { rate: number | null; resolved: number; failed: number } {
  const resolvedRows = tasks.filter(t => t.resolved)
  const resolved = resolvedRows.length
  if (resolved === 0) return { rate: null, resolved: 0, failed: 0 }
  const merged = resolvedRows.filter(
    t => t.merged && !failed.has(t.taskId)
  ).length
  return { rate: merged / resolved, resolved, failed: resolved - merged }
}

function populationVariance(xs: number[]): number {
  if (xs.length === 0) return 0
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  return xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length
}

export const usageSignalService = {
  async getUsageSignalHealth(workspaceId: string): Promise<UsageSignalHealth> {
    const agg = await lineageEdgeRepository.usageSignalAggregates(workspaceId)
    const candidateTaskIds = [
      ...new Set([
        ...agg.usedTasks.map(t => t.taskId),
        ...agg.baseTasks.map(t => t.taskId),
      ]),
    ]
    // Negative class = HUMAN/AGENT send-backs ∪ judge-confirmed laundering
    // (LUM-511 Phase 4: laundered spinoffs + silent-fix markers + contract
    // weakening). All additive failure sources fold the same way.
    const sendBack =
      await verificationRunRepository.taskIdsWithSendBack(candidateTaskIds)
    // LUM-511 Phase 6: the judge-confirmed laundering signals are now boundary
    // crossings (spinoff / silent-fix / contract-weakening) — fold all three.
    const laundered = await boundaryCrossingRepository.taskIdsWithCategory(
      candidateTaskIds,
      ['SPINOFF_LAUNDERED', 'SILENT_FIX', 'CONTRACT_WEAKENING']
    )
    const failed = new Set([...sendBack, ...laundered])
    const fractions = agg.perSession
      .filter(s => s.injected > 0)
      .map(s => s.used / s.injected)
    const used = foldWithTaint(agg.usedTasks, failed)
    const base = foldWithTaint(agg.baseTasks, failed)
    const spinoffsDuringInFlight =
      await activityRepository.countSpinoffsForWorkspace(workspaceId)
    return {
      distribution: agg.distribution,
      perSessionVariance: populationVariance(fractions),
      votedSessions: agg.perSession.length,
      usedMergeRate: used.rate,
      baseMergeRate: base.rate,
      usedResolvedTasks: used.resolved,
      baseResolvedTasks: base.resolved,
      usedFailedTasks: used.failed,
      baseFailedTasks: base.failed,
      spinoffsDuringInFlight,
    }
  },
}
