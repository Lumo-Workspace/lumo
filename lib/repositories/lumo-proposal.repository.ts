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

  async updateStatus(
    id: string,
    status: LumoProposalStatus,
    appliedAt: Date | null = null
  ) {
    return prisma.lumoProposal.update({
      where: { id },
      data: { status, appliedAt },
      select: { id: true },
    })
  },

  async findLatestAppliedForTask(taskId: string) {
    return prisma.lumoProposal.findFirst({
      where: { taskId, status: 'APPLIED' },
      orderBy: { appliedAt: 'desc' },
      select: { id: true, appliedAt: true },
    })
  },

  async updateSyncResult(
    id: string,
    status: LumoProposalStatus,
    appliedAt: Date,
    prUrl: string
  ) {
    return prisma.lumoProposal.update({
      where: { id },
      data: { status, appliedAt, prUrl },
      select: { id: true },
    })
  },
}
