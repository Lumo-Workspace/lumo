import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'

/**
 * LUM-861: models that `workspace.delete()` does NOT remove through FK
 * cascades — they are FK-less on purpose (see each model's schema comment) and
 * are purged here, in the same transaction as the workspace row.
 */
export const EXPLICITLY_PURGED_MODELS = [
  'McpAuditLog',
  'MemoryStaleAnchorReport',
  'MemoryProvenance',
  'GenerationJob',
] as const

/** Models that are not workspace data, so deleting a workspace leaves them. */
export const NON_WORKSPACE_MODELS: Readonly<Record<string, string>> = {
  WaitlistEntry:
    'global pre-signup list, keyed by email, owned by no workspace',
  McpConnection:
    'per-user OAuth connection; its activeWorkspace pointer is SetNull',
  WorkspaceDeletionReceipt: 'deletion evidence that must outlive the workspace',
}

export type BlobCleanup =
  | { status: 'PENDING'; deleted: 0 }
  | { status: 'DONE'; deleted: number }
  | { status: 'FAILED'; deleted: number; error: string }

export interface PurgeResult {
  receiptId: string
  rowCounts: Record<string, number>
}

type Tx = Prisma.TransactionClient
type CountDelegate = {
  count: (args: { where: { workspaceId: string } }) => Promise<number>
}

/** Models keyed directly by a `workspaceId` column (their rows are counted). */
const WORKSPACE_KEYED_MODELS = Prisma.dmmf.datamodel.models
  .filter(
    m =>
      m.name !== 'WorkspaceDeletionReceipt' &&
      m.fields.some(f => f.name === 'workspaceId' && f.kind === 'scalar')
  )
  .map(m => m.name)

function delegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1)
}

async function countWorkspaceRows(
  tx: Tx,
  workspaceId: string
): Promise<Record<string, number>> {
  const counts: Record<string, number> = { Workspace: 1 }
  for (const model of WORKSPACE_KEYED_MODELS) {
    const delegate = (tx as unknown as Record<string, CountDelegate>)[
      delegateName(model)
    ]
    if (!delegate) continue
    const n = await delegate.count({ where: { workspaceId } })
    if (n > 0) counts[model] = n
  }
  return counts
}

/** Delete the FK-less rows a workspace owns; returns the non-keyed counts. */
async function purgeFkLessRows(
  tx: Tx,
  workspaceId: string
): Promise<Record<string, number>> {
  await tx.mcpAuditLog.deleteMany({ where: { workspaceId } })
  await tx.memoryStaleAnchorReport.deleteMany({ where: { workspaceId } })

  const memoryIds = (
    await tx.memory.findMany({ where: { workspaceId }, select: { id: true } })
  ).map(m => m.id)
  const provenance = await tx.memoryProvenance.deleteMany({
    where: {
      OR: [
        { childMemoryId: { in: memoryIds } },
        { parentMemoryId: { in: memoryIds } },
      ],
    },
  })

  // GenerationJob.targetId points at a workspace, project, sprint or milestone.
  const [projects, sprints, milestones] = await Promise.all([
    tx.project.findMany({ where: { workspaceId }, select: { id: true } }),
    tx.sprint.findMany({
      where: { team: { workspaceId } },
      select: { id: true },
    }),
    tx.milestone.findMany({
      where: { project: { workspaceId } },
      select: { id: true },
    }),
  ])
  const targetIds = [
    workspaceId,
    ...[...projects, ...sprints, ...milestones].map(r => r.id),
  ]
  const jobs = await tx.generationJob.deleteMany({
    where: { targetId: { in: targetIds } },
  })

  const counts: Record<string, number> = {}
  if (provenance.count > 0) counts.MemoryProvenance = provenance.count
  if (jobs.count > 0) counts.GenerationJob = jobs.count
  return counts
}

export const workspaceDeletionRepository = {
  /** Ids of the workspace's tasks that own at least one test case. */
  async findTaskIdsWithTestCases(workspaceId: string): Promise<string[]> {
    const rows = await prisma.task.findMany({
      where: { project: { workspaceId }, testCases: { some: {} } },
      select: { id: true },
    })
    return rows.map(r => r.id)
  },

  /**
   * Delete the workspace and every row it owns in ONE transaction, and write
   * the deletion receipt in that same transaction — a failed delete leaves
   * no receipt behind.
   */
  async purge(
    workspaceId: string,
    requestedByClerkId: string
  ): Promise<PurgeResult> {
    return prisma.$transaction(
      async tx => {
        const keyed = await countWorkspaceRows(tx, workspaceId)
        const fkLess = await purgeFkLessRows(tx, workspaceId)
        await tx.workspace.delete({ where: { id: workspaceId } })
        const rowCounts = { ...keyed, ...fkLess }
        const pending: BlobCleanup = { status: 'PENDING', deleted: 0 }
        const receipt = await tx.workspaceDeletionReceipt.create({
          data: {
            workspaceId,
            requestedByClerkId,
            rowCounts,
            blobCleanup: pending,
          },
          select: { id: true },
        })
        return { receiptId: receipt.id, rowCounts }
      },
      { timeout: 60_000, maxWait: 10_000 }
    )
  },

  async settleBlobCleanup(receiptId: string, outcome: BlobCleanup) {
    await prisma.workspaceDeletionReceipt.update({
      where: { id: receiptId },
      data: { blobCleanup: outcome },
    })
  },
}
