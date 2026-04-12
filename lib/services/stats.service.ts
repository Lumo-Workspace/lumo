import { statsRepository } from '@/lib/repositories/stats.repository'
import {
  aggregateProjectStats,
  aggregateWorkspaceStats,
  type ProjectRiskOverride,
} from '@/lib/summaries/stats'
import { resolveEffectiveRiskConfig } from '@/lib/summaries/risk'
import type { TaskSummaryStats, WorkspaceSummaryStats } from '@/types/summary'

export async function getProjectStats(
  projectId: string,
  workspaceId: string
): Promise<TaskSummaryStats> {
  const [project, workspace] = await Promise.all([
    statsRepository.findProjectWithRiskConfig(projectId),
    statsRepository.findWorkspaceWithRiskConfig(workspaceId),
  ])

  if (!project)
    throw Object.assign(new Error('Project not found'), { status: 404 })
  if (!workspace)
    throw Object.assign(new Error('Workspace not found'), { status: 404 })

  const config = resolveEffectiveRiskConfig(workspace, project)
  return aggregateProjectStats(projectId, config)
}

export async function getWorkspaceStats(
  workspaceId: string
): Promise<WorkspaceSummaryStats> {
  const workspace =
    await statsRepository.findWorkspaceWithProjectRiskConfigs(workspaceId)

  if (!workspace)
    throw Object.assign(new Error('Workspace not found'), { status: 404 })

  const workspaceConfig = {
    riskOverdueRatio: workspace.riskOverdueRatio,
    riskStalledDays: workspace.riskStalledDays,
    riskStalledMinCount: workspace.riskStalledMinCount,
    riskAgentFailRatio: workspace.riskAgentFailRatio,
    riskStalePrDays: workspace.riskStalePrDays,
    riskThroughputDrop: workspace.riskThroughputDrop,
  }

  const effectiveConfig = resolveEffectiveRiskConfig(workspaceConfig, null)

  const projectOverrides = new Map<string, ProjectRiskOverride | null>()
  for (const p of workspace.projects) {
    projectOverrides.set(p.id, {
      riskOverdueRatio: p.riskOverdueRatio,
      riskStalledDays: p.riskStalledDays,
      riskStalledMinCount: p.riskStalledMinCount,
      riskAgentFailRatio: p.riskAgentFailRatio,
      riskStalePrDays: p.riskStalePrDays,
      riskThroughputDrop: p.riskThroughputDrop,
    })
  }

  return aggregateWorkspaceStats(workspaceId, effectiveConfig, projectOverrides)
}
