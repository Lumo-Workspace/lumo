import { prisma } from '@/lib/db/prisma'

export interface TaskClaimInputs {
  identifier: string
  claim: string | null
  claimSnapshotAt: Date | null
  criteria: string[]
}

interface TaskRow {
  team: { identifier: string }
  number: number
  claimSnapshot: string | null
  claimSnapshotAt: Date | null
  acceptanceCriteria: { statement: string }[]
}

export function mapTaskRowToInputs(row: TaskRow): TaskClaimInputs {
  return {
    identifier: `${row.team.identifier}-${row.number}`,
    claim: row.claimSnapshot,
    claimSnapshotAt: row.claimSnapshotAt,
    criteria: row.acceptanceCriteria.map(c => c.statement),
  }
}

export const TASK_INPUT_SELECT = {
  team: { select: { identifier: true } },
  number: true,
  claimSnapshot: true,
  claimSnapshotAt: true,
  acceptanceCriteria: { select: { statement: true } },
} as const

export async function loadTaskInputs(
  taskId: string
): Promise<TaskClaimInputs | null> {
  const row = await prisma.task.findUnique({
    where: { id: taskId },
    select: TASK_INPUT_SELECT,
  })
  return row ? mapTaskRowToInputs(row) : null
}
