import { prisma } from '@/lib/db/prisma'
import type { GateSignalSource } from '@/lib/services/gate-audit'

/** A GateSignal row to persist (LUM-616). Mirrors the Prisma model minus id/createdAt. */
export interface NewGateSignal {
  workspaceId: string
  taskId: string
  gateKey: string
  outcome: string
  provenance: string
  /** github_check / github_status (LUM-616); lumo_sandbox is historical (LUM-746, retired LUM-837). */
  source: GateSignalSource
  checkName: string
  detailsUrl: string | null
  headSha: string | null
  /** LUM-617: PR this CI signal belongs to (null when the commit maps to no PR). */
  prNumber: number | null
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
        prNumber: true,
      },
    })
  },
}
