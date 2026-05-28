import { prisma } from '@/lib/db/prisma'
import type { FigmaIntegration } from '@prisma/client'

export const figmaIntegrationRepository = {
  findByMember(
    workspaceId: string,
    memberId: string
  ): Promise<FigmaIntegration | null> {
    return prisma.figmaIntegration.findUnique({
      where: { workspaceId_memberId: { workspaceId, memberId } },
    })
  },

  findAnyForWorkspace(workspaceId: string): Promise<FigmaIntegration | null> {
    return prisma.figmaIntegration.findFirst({
      where: { workspaceId, needsReauth: false },
      orderBy: { updatedAt: 'desc' },
    })
  },

  upsert(input: {
    workspaceId: string
    memberId: string
    accessToken: string
    refreshToken: string
    expiresAt: Date
    figmaUserId: string
    figmaHandle: string
    figmaEmail: string | null
    scopes: string[]
  }): Promise<FigmaIntegration> {
    const { workspaceId, memberId, ...data } = input
    return prisma.figmaIntegration.upsert({
      where: { workspaceId_memberId: { workspaceId, memberId } },
      create: { workspaceId, memberId, ...data, needsReauth: false },
      update: { ...data, needsReauth: false },
    })
  },

  updateTokens(
    id: string,
    next: { accessToken: string; refreshToken: string; expiresAt: Date }
  ): Promise<FigmaIntegration> {
    return prisma.figmaIntegration.update({ where: { id }, data: next })
  },

  markNeedsReauth(id: string): Promise<FigmaIntegration> {
    return prisma.figmaIntegration.update({
      where: { id },
      data: { needsReauth: true },
    })
  },

  delete(workspaceId: string, memberId: string): Promise<void> {
    prisma.figmaIntegration
      .delete({ where: { workspaceId_memberId: { workspaceId, memberId } } })
      .catch(() => null) // idempotent
    return Promise.resolve()
  },
}
