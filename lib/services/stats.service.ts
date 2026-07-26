import { statsRepository } from '@/lib/repositories/stats.repository'
import {
  aggregateProjectStats,
  aggregateSprintRisk,
  aggregateWorkspaceStats,
  type ProjectRiskOverride,
} from '@/lib/summaries/stats'
import { resolveEffectiveRiskConfig } from '@/lib/summaries/risk'
import { reconcileStaleProjectPrs } from './stale-pr-reconcile.service'
import type {
  RiskAssessment,
  TaskSummaryStats,
  TopBlockers,
  WorkspaceSummaryStats,
} from '@/types/summary'

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

  // Correct any drifted PR state before aggregating, so a PR that was merged
  // without its webhook landing doesn't get counted (and shown) as a stale PR
  // awaiting review. Fail-soft and bounded — see the service for why this runs
  // on the read path rather than only in a background job.
  await reconcileStaleProjectPrs(projectId, workspaceId, config.stalePrDays)

  return aggregateProjectStats(projectId, config)
}

/**
 * Sprint-dimension risk. Sprints live under a team and carry no risk-config
 * overrides of their own (no schema change for this), so the effective config
 * is the workspace baseline. The caller already loaded the sprint and passes
 * its workspaceId.
 */
export async function getSprintRisk(
  sprintId: string,
  workspaceId: string
): Promise<{ risk: RiskAssessment; topBlockers: TopBlockers }> {
  const workspace =
    await statsRepository.findWorkspaceWithRiskConfig(workspaceId)
  if (!workspace)
    throw Object.assign(new Error('Workspace not found'), { status: 404 })

  const config = resolveEffectiveRiskConfig(workspace, null)
  return aggregateSprintRisk(sprintId, config)
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
