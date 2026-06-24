import { prisma } from '@/lib/db/prisma'

export interface TaskClaimInputs {
  identifier: string
  claim: string | null
  claimSnapshotAt: Date | null
  criteria: string[]
}

interface TaskRow {
  team: string
  number: number
  claimSnapshot: string | null
  claimSnapshotAt: Date | null
  acceptanceCriteria: { statement: string }[]
}

export function mapTaskRowToInputs(row: TaskRow): TaskClaimInputs {
  return {
    identifier: `${row.team}-${row.number}`,
    claim: row.claimSnapshot,
    claimSnapshotAt: row.claimSnapshotAt,
    criteria: row.acceptanceCriteria.map(c => c.statement),
  }
}

export async function loadTaskInputs(
  taskId: string
): Promise<TaskClaimInputs | null> {
  const row = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      team: true,
      number: true,
      claimSnapshot: true,
      claimSnapshotAt: true,
      acceptanceCriteria: { select: { statement: true } },
    },
  })
  return row ? mapTaskRowToInputs(row) : null
}
