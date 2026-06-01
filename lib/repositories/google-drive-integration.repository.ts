import { prisma } from '@/lib/db/prisma'
import type { GoogleDriveIntegration } from '@prisma/client'

export const googleDriveIntegrationRepository = {
  findByMember(
    workspaceId: string,
    memberId: string
  ): Promise<GoogleDriveIntegration | null> {
    return prisma.googleDriveIntegration.findUnique({
      where: { workspaceId_memberId: { workspaceId, memberId } },
    })
  },

  findById(id: string): Promise<GoogleDriveIntegration | null> {
    return prisma.googleDriveIntegration.findUnique({ where: { id } })
  },

  upsert(input: {
    workspaceId: string
    memberId: string
    accessToken: string
    refreshToken: string
    expiresAt: Date
    googleUserId: string
    googleEmail: string | null
    scopes: string[]
  }): Promise<GoogleDriveIntegration> {
    const { workspaceId, memberId, ...data } = input
    return prisma.googleDriveIntegration.upsert({
      where: { workspaceId_memberId: { workspaceId, memberId } },
      create: { workspaceId, memberId, ...data, needsReauth: false },
      update: { ...data, needsReauth: false },
    })
  },

  updateTokens(
    id: string,
    next: { accessToken: string; refreshToken: string; expiresAt: Date }
  ): Promise<GoogleDriveIntegration> {
    return prisma.googleDriveIntegration.update({ where: { id }, data: next })
  },

  markNeedsReauth(id: string): Promise<GoogleDriveIntegration> {
    return prisma.googleDriveIntegration.update({
      where: { id },
      data: { needsReauth: true },
    })
  },

  delete(workspaceId: string, memberId: string): Promise<void> {
    return prisma.googleDriveIntegration
      .delete({ where: { workspaceId_memberId: { workspaceId, memberId } } })
      .then(() => undefined)
      .catch(() => undefined) // idempotent
  },
}
