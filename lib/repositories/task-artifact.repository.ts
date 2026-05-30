import { prisma } from '@/lib/db/prisma'
import type { TaskArtifactAgent } from '@prisma/client'

export interface CreateTaskArtifactInput {
  taskId: string
  workspaceId: string
  kind: string
  title: string
  content: string
  source: string
  agent: TaskArtifactAgent
  order: number
  createdById: string | null
}

export interface UpdateTaskArtifactInput {
  kind?: string | undefined
  title?: string | undefined
  source?: string | undefined
  agent?: TaskArtifactAgent | undefined
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

  async updateSummary(id: string, summary: string) {
    return prisma.taskArtifact.update({
      where: { id },
      data: { summary },
    })
  },

  async deleteById(id: string, taskId: string) {
    const { count } = await prisma.taskArtifact.deleteMany({
      where: { id, taskId },
    })
    return count
  },

  /**
   * Patch an artifact's metadata, scoped to its task. Uses updateMany so a
   * mismatched (id, taskId) pair is a no-op rather than throwing — the caller
   * inspects the returned count to surface a 404.
   */
  async updateById(id: string, taskId: string, data: UpdateTaskArtifactInput) {
    const { count } = await prisma.taskArtifact.updateMany({
      where: { id, taskId },
      data: {
        ...(data.kind !== undefined ? { kind: data.kind } : {}),
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.source !== undefined ? { source: data.source } : {}),
        ...(data.agent !== undefined ? { agent: data.agent } : {}),
      },
    })
    return count
  },
}
