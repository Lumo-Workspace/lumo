import { prisma } from '@/lib/db/prisma'

const RISK_FIELDS = {
  riskOverdueRatio: true,
  riskStalledDays: true,
  riskStalledMinCount: true,
  riskAgentFailRatio: true,
  riskStalePrDays: true,
  riskThroughputDrop: true,
} as const

export const statsRepository = {
  async findProjectWithRiskConfig(projectId: string) {
    return prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, ...RISK_FIELDS },
    })
  },

  async findWorkspaceWithRiskConfig(workspaceId: string) {
    return prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: RISK_FIELDS,
    })
  },

  async findWorkspaceWithProjectRiskConfigs(workspaceId: string) {
    return prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        ...RISK_FIELDS,
        projects: {
          select: { id: true, ...RISK_FIELDS },
        },
      },
    })
  },

  async findWorkspaceSummaryLocale(workspaceId: string) {
    return prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { summaryLocale: true },
    })
  },

  async findProjectNameAndDescription(projectId: string) {
    return prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true, description: true },
    })
  },
}
