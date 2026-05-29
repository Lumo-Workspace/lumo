import { prisma } from '@/lib/db/prisma'

export interface CreateTaskArtifactInput {
  taskId: string
  workspaceId: string
  kind: string
  title: string
  content: string
  source: string
  order: number
  createdById: string | null
}

export const taskArtifactRepository = {
  async create(input: CreateTaskArtifactInput) {
    return prisma.taskArtifact.create({ data: input })
  },

  async listByTask(taskId: string) {
    return prisma.taskArtifact.findMany({
      where: { taskId },
      orderBy: { order: 'asc' },
    })
  },

  async countByTask(taskId: string) {
    return prisma.taskArtifact.count({ where: { taskId } })
  },
}
