import { prisma } from '@/lib/db/prisma'
import type { LumoProposalStatus, Prisma } from '@prisma/client'

interface CreateLumoProposalInput {
  projectId: string
  taskId: string
  operations: Prisma.InputJsonValue
  lumoMdSnapshot: string | null
  summary: string | null
}

export const lumoProposalRepository = {
  async create(input: CreateLumoProposalInput) {
    return prisma.lumoProposal.create({
      data: {
        projectId: input.projectId,
        taskId: input.taskId,
        operations: input.operations,
        lumoMdSnapshot: input.lumoMdSnapshot,
        summary: input.summary,
      },
      select: { id: true },
    })
  },

  async findById(id: string) {
    return prisma.lumoProposal.findUnique({
      where: { id },
    })
  },

  async findByTaskId(taskId: string) {
    return prisma.lumoProposal.findMany({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
    })
  },

  async updateStatus(id: string, status: LumoProposalStatus, appliedAt?: Date) {
    return prisma.lumoProposal.update({
      where: { id },
      data: { status, appliedAt },
      select: { id: true },
    })
  },
}
