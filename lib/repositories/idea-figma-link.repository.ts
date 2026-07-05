import { prisma } from '@/lib/db/prisma'
import type { IdeaFigmaLink } from '@prisma/client'

export interface CreateIdeaFigmaLinkInput {
  ideaId: string
  workspaceId: string
  createdById: string
  integrationId?: string
  url: string
  fileKey: string
  nodeId: string // "" for file-level
  fileName: string
  frameName: string | null
  thumbnailUrl?: string | null
  thumbnailFetchedAt?: Date | null
  lastSyncError?: string | null
}

export const ideaFigmaLinkRepository = {
  create(input: CreateIdeaFigmaLinkInput): Promise<IdeaFigmaLink> {
    return prisma.ideaFigmaLink.create({ data: input })
  },

  listByIdea(ideaId: string): Promise<IdeaFigmaLink[]> {
    return prisma.ideaFigmaLink.findMany({
      where: { ideaId },
      orderBy: { createdAt: 'asc' },
    })
  },

  findById(id: string): Promise<IdeaFigmaLink | null> {
    return prisma.ideaFigmaLink.findUnique({ where: { id } })
  },

  findByIdeaAndKey(
    ideaId: string,
    fileKey: string,
    nodeId: string
  ): Promise<IdeaFigmaLink | null> {
    return prisma.ideaFigmaLink.findUnique({
      where: {
        ideaId_fileKey_nodeId: { ideaId, fileKey, nodeId },
      },
    })
  },

  update(
    id: string,
    data: Partial<{
      fileName: string
      frameName: string | null
      thumbnailUrl: string | null
      thumbnailFetchedAt: Date | null
      lastSyncedAt: Date
      lastSyncError: string | null
      integrationId: string | null
    }>
  ): Promise<IdeaFigmaLink> {
    return prisma.ideaFigmaLink.update({ where: { id }, data })
  },

  delete(id: string): Promise<void> {
    return prisma.ideaFigmaLink
      .delete({ where: { id } })
      .then(() => undefined)
      .catch(() => undefined) // idempotent
  },
}
