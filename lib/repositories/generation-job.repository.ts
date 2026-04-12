import { prisma } from '@/lib/db/prisma'

export const generationJobRepository = {
  async findRecentByTarget(targetId: string, cooldownMinutes: number) {
    const since = new Date(Date.now() - cooldownMinutes * 60 * 1000)
    return prisma.generationJob.findFirst({
      where: {
        targetId,
        status: { in: ['pending', 'completed'] },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
    })
  },

  async create(type: 'project' | 'workspace', targetId: string) {
    return prisma.generationJob.create({
      data: { type, targetId },
    })
  },

  async updateStatus(
    id: string,
    status: 'completed' | 'failed',
    summaryId?: string
  ) {
    return prisma.generationJob.update({
      where: { id },
      data: { status, ...(summaryId ? { summaryId } : {}) },
    })
  },

  async findById(id: string) {
    return prisma.generationJob.findFirst({
      where: { id },
    })
  },

  async deleteOlderThan(days: number) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    return prisma.generationJob.deleteMany({
      where: { createdAt: { lt: cutoff } },
    })
  },
}
