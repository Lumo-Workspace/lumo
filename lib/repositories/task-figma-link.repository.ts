import { prisma } from '@/lib/db/prisma'
import type { TaskFigmaLink } from '@prisma/client'

export interface CreateFigmaLinkInput {
  taskId: string
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

export const taskFigmaLinkRepository = {
  create(input: CreateFigmaLinkInput): Promise<TaskFigmaLink> {
    return prisma.taskFigmaLink.create({ data: input })
  },

  listByTask(taskId: string): Promise<TaskFigmaLink[]> {
    return prisma.taskFigmaLink.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' },
    })
  },

  findById(id: string): Promise<TaskFigmaLink | null> {
    return prisma.taskFigmaLink.findUnique({ where: { id } })
  },

  findByTaskAndKey(
    taskId: string,
    fileKey: string,
    nodeId: string
  ): Promise<TaskFigmaLink | null> {
    return prisma.taskFigmaLink.findUnique({
      where: {
        taskId_fileKey_nodeId: { taskId, fileKey, nodeId },
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
  ): Promise<TaskFigmaLink> {
    return prisma.taskFigmaLink.update({ where: { id }, data })
  },

  delete(id: string): Promise<void> {
    prisma.taskFigmaLink.delete({ where: { id } }).catch(() => null) // idempotent
    return Promise.resolve()
  },
}
