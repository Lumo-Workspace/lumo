import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { SOFT_DELETE_MODELS } from '@/lib/db/soft-delete'

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
  // LUM-1027: the self-hosted (Better Auth) identity store — a person's
  // account outlives any one workspace, exactly like a Clerk user.
  AuthUser: 'self-hosted login identity (Better Auth); owned by no workspace',
  AuthSession: 'login session of an AuthUser; owned by no workspace',
  AuthAccount: 'credential / OAuth link of an AuthUser; owned by no workspace',
  AuthVerification: 'email-verification token; owned by no workspace',
  EmailDelivery:
    'system-email idempotency ledger (LUM-1041): no workspaceId, only the send key + outcome',
}

export type BlobCleanup =
  | { status: 'PENDING'; deleted: 0 }
  | { status: 'DONE'; deleted: number }
  | { status: 'FAILED'; deleted: number; error: string }

export interface PurgeResult {
  receiptId: string
  rowCounts: Record<string, number>
}

/** LUM-918: a workspace's pending-deletion state (all null = not pending). */
export interface PendingDeletion {
  requestedAt: Date
  executeAt: Date
  requestedByClerkId: string
}

export interface DueDeletion {
  workspaceId: string
  requestedByClerkId: string
}

type Tx = Prisma.TransactionClient
type CountDelegate = {
  count: (args: { where: Record<string, unknown> }) => Promise<number>
}

/**
 * LUM-923: the soft-delete extension hides trashed rows from every default
 * read. Deletion must see them — they are deleted too — so these models opt
 * out explicitly (`deletedAt: {}` names the column without filtering it).
 */
const SOFT_DELETE_MODEL_NAMES: ReadonlySet<string> = new Set(
  SOFT_DELETE_MODELS.map(m => m.charAt(0).toUpperCase() + m.slice(1))
)
const INCLUDING_TRASHED = { deletedAt: {} } as const

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
    const where = SOFT_DELETE_MODEL_NAMES.has(model)
      ? { workspaceId, ...INCLUDING_TRASHED }
      : { workspaceId }
    const n = await delegate.count({ where })
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
  /**
   * Ids of the workspace's tasks that own at least one test case — trashed
   * ones included (LUM-923): their evidence blobs go with the workspace.
   */
  async findTaskIdsWithTestCases(workspaceId: string): Promise<string[]> {
    const rows = await prisma.task.findMany({
      where: {
        project: { workspaceId },
        testCases: { some: {} },
        ...INCLUDING_TRASHED,
      },
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
    requestedByClerkId: string,
    opts: { dueBy?: Date } = {}
  ): Promise<PurgeResult | null> {
    return prisma.$transaction(
      async tx => {
        // LUM-918: the cron purges only a deletion that is still due — a
        // cancel that lands between the cron's scan and this transaction
        // wins, and nothing is deleted.
        if (opts.dueBy) {
          const due = await tx.workspace.findFirst({
            where: { id: workspaceId, deletionExecuteAt: { lte: opts.dueBy } },
            select: { id: true },
          })
          if (!due) return null
        }
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

  /** LUM-918: the pending deletion, or null when none is scheduled. */
  async findPending(workspaceId: string): Promise<PendingDeletion | null> {
    const ws = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        deletionRequestedAt: true,
        deletionExecuteAt: true,
        deletionRequestedByClerkId: true,
      },
    })
    if (
      !ws?.deletionRequestedAt ||
      !ws.deletionExecuteAt ||
      !ws.deletionRequestedByClerkId
    ) {
      return null
    }
    return {
      requestedAt: ws.deletionRequestedAt,
      executeAt: ws.deletionExecuteAt,
      requestedByClerkId: ws.deletionRequestedByClerkId,
    }
  },

  /**
   * Schedule the deletion unless one is already pending. Returns false when
   * another request got there first (conditional update, no read-then-write).
   */
  async schedule(workspaceId: string, pending: PendingDeletion) {
    const { count } = await prisma.workspace.updateMany({
      where: { id: workspaceId, deletionExecuteAt: null },
      data: {
        deletionRequestedAt: pending.requestedAt,
        deletionExecuteAt: pending.executeAt,
        deletionRequestedByClerkId: pending.requestedByClerkId,
      },
    })
    return count === 1
  },

  /** Clear a pending deletion. Returns false when none was pending. */
  async cancel(workspaceId: string) {
    const { count } = await prisma.workspace.updateMany({
      where: { id: workspaceId, deletionExecuteAt: { not: null } },
      data: {
        deletionRequestedAt: null,
        deletionExecuteAt: null,
        deletionRequestedByClerkId: null,
      },
    })
    return count === 1
  },

  /** Workspaces whose pending deletion is due at `now`. */
  async findDue(now: Date): Promise<DueDeletion[]> {
    const rows = await prisma.workspace.findMany({
      where: { deletionExecuteAt: { lte: now } },
      select: { id: true, deletionRequestedByClerkId: true },
      orderBy: { deletionExecuteAt: 'asc' },
    })
    return rows.map(r => ({
      workspaceId: r.id,
      requestedByClerkId: r.deletionRequestedByClerkId ?? '',
    }))
  },

  /** Clerk ids of the workspace's OWNERs (the deletion notice recipients). */
  async findOwnerClerkIds(workspaceId: string): Promise<string[]> {
    const rows = await prisma.workspaceMember.findMany({
      where: { workspaceId, role: 'OWNER' },
      select: { clerkId: true },
    })
    return rows.map(r => r.clerkId)
  },

  async settleBlobCleanup(receiptId: string, outcome: BlobCleanup) {
    await prisma.workspaceDeletionReceipt.update({
      where: { id: receiptId },
      data: { blobCleanup: outcome },
    })
  },
}
