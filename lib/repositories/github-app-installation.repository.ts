import { prisma } from '@/lib/db/prisma'

export interface UpsertGitHubAppInstallationData {
  workspaceId: string
  installationId: number
  accountLogin?: string | null
  accountType?: string | null
  repositories?: string[]
  installedBy?: string | null
}

export const githubAppInstallationRepository = {
  async findByWorkspace(workspaceId: string) {
    return prisma.gitHubAppInstallation.findUnique({
      where: { workspaceId },
      select: { id: true, workspaceId: true, installationId: true },
    })
  },

  async upsert(data: UpsertGitHubAppInstallationData) {
    return prisma.gitHubAppInstallation.upsert({
      where: { workspaceId: data.workspaceId },
      create: {
        workspaceId: data.workspaceId,
        installationId: data.installationId,
        accountLogin: data.accountLogin ?? null,
        accountType: data.accountType ?? null,
        repositories: data.repositories ?? [],
        installedBy: data.installedBy ?? null,
      },
      update: {
        installationId: data.installationId,
        accountLogin: data.accountLogin ?? null,
        accountType: data.accountType ?? null,
        repositories: data.repositories ?? [],
      },
    })
  },

  async delete(workspaceId: string) {
    return prisma.gitHubAppInstallation.delete({ where: { workspaceId } })
  },
}
