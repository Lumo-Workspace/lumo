import { prisma } from '@/lib/db/prisma'

export const statsRepository = {
  async findProjectId(projectId: string) {
    return prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    })
  },

  async findWorkspaceId(workspaceId: string) {
    return prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
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
