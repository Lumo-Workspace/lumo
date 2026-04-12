import { prisma } from '@/lib/db/prisma'
import {
  aggregateProjectStats,
  aggregateWorkspaceStats,
  type ProjectRiskOverride,
} from '@/lib/summaries/stats'
import { resolveEffectiveRiskConfig } from '@/lib/summaries/risk'
import type { TaskSummaryStats, WorkspaceSummaryStats } from '@/types/summary'

const RISK_FIELDS = {
  riskOverdueRatio: true,
  riskStalledDays: true,
  riskStalledMinCount: true,
  riskAgentFailRatio: true,
  riskStalePrDays: true,
  riskThroughputDrop: true,
} as const

export async function getProjectStats(
  projectId: string,
  workspaceId: string
): Promise<TaskSummaryStats> {
  const [project, workspace] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, ...RISK_FIELDS },
    }),
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: RISK_FIELDS,
    }),
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
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      id: true,
      ...RISK_FIELDS,
      projects: {
        select: { id: true, ...RISK_FIELDS },
      },
    },
  })

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
