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

  async findById(id: string, taskId: string) {
    return prisma.taskArtifact.findFirst({ where: { id, taskId } })
  },

  async deleteById(id: string, taskId: string) {
    const { count } = await prisma.taskArtifact.deleteMany({
      where: { id, taskId },
    })
    return count
  },
}
