import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import type { UsageSignalHealth } from '@/types/lineage-usage'

function mergeRate(
  tasks: { resolved: boolean; merged: boolean }[]
): { rate: number | null; resolved: number } {
  const resolved = tasks.filter(t => t.resolved).length
  if (resolved === 0) return { rate: null, resolved: 0 }
  const merged = tasks.filter(t => t.merged).length
  return { rate: merged / resolved, resolved }
}

function populationVariance(xs: number[]): number {
  if (xs.length === 0) return 0
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  return xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length
}

export const usageSignalService = {
  async getUsageSignalHealth(workspaceId: string): Promise<UsageSignalHealth> {
    const agg = await lineageEdgeRepository.usageSignalAggregates(workspaceId)
    const fractions = agg.perSession
      .filter(s => s.injected > 0)
      .map(s => s.used / s.injected)
    const used = mergeRate(agg.usedTasks)
    const base = mergeRate(agg.baseTasks)
    return {
      distribution: agg.distribution,
      perSessionVariance: populationVariance(fractions),
      votedSessions: agg.perSession.length,
      usedMergeRate: used.rate,
      baseMergeRate: base.rate,
      usedResolvedTasks: used.resolved,
      baseResolvedTasks: base.resolved,
    }
  },
}
