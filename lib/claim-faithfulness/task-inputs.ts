import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'

export interface TaskClaimInputs {
  identifier: string
  claim: string | null
  claimSnapshotAt: Date | null
  // LUM-618: the session that produced the frozen claim, used to pair the claim
  // with the delivery it actually describes (see delivery-pairing.ts). Null for
  // legacy / synthesized snapshots that carry no session pointer.
  claimSnapshotSessionId: string | null
  criteria: string[]
  // LUM-901: the owning workspace, so the judge can honour its AI-review switch.
  workspaceId: string
}

interface TaskRow {
  team: { identifier: string; workspaceId: string }
  number: number
  claimSnapshot: string | null
  claimSnapshotAt: Date | null
  claimSnapshotSessionId: string | null
  acceptanceCriteria: { statement: string }[]
}

export function mapTaskRowToInputs(row: TaskRow): TaskClaimInputs {
  return {
    identifier: `${row.team.identifier}-${row.number}`,
    claim: row.claimSnapshot,
    claimSnapshotAt: row.claimSnapshotAt,
    claimSnapshotSessionId: row.claimSnapshotSessionId,
    criteria: row.acceptanceCriteria.map(c => c.statement),
    workspaceId: row.team.workspaceId,
  }
}

export const TASK_INPUT_SELECT = {
  team: { select: { identifier: true, workspaceId: true } },
  number: true,
  claimSnapshot: true,
  claimSnapshotAt: true,
  claimSnapshotSessionId: true,
  acceptanceCriteria: { select: { statement: true } },
} satisfies Prisma.TaskSelect

export async function loadTaskInputs(
  taskId: string
): Promise<TaskClaimInputs | null> {
  const row = await prisma.task.findUnique({
    where: { id: taskId },
    select: TASK_INPUT_SELECT,
  })
  return row ? mapTaskRowToInputs(row) : null
}
