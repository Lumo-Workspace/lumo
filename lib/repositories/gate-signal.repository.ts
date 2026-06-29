import { prisma } from '@/lib/db/prisma'

/** A GateSignal row to persist (LUM-616). Mirrors the Prisma model minus id/createdAt. */
export interface NewGateSignal {
  workspaceId: string
  taskId: string
  gateKey: string
  outcome: string
  provenance: string
  source: string
  checkName: string
  detailsUrl: string | null
  headSha: string | null
}

export const gateSignalRepository = {
  /** Append independent CI gate signals (append-only; re-runs add rows). */
  async createMany(rows: readonly NewGateSignal[]): Promise<number> {
    if (rows.length === 0) return 0
    const result = await prisma.gateSignal.createMany({ data: [...rows] })
    return result.count
  },

  /** All gate signals for a task, oldest-first (the read-model picks latest). */
  async findByTaskId(taskId: string) {
    return prisma.gateSignal.findMany({
      where: { taskId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        gateKey: true,
        outcome: true,
        checkName: true,
        detailsUrl: true,
        source: true,
        createdAt: true,
      },
    })
  },
}
