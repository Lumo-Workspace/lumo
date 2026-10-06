import { Prisma } from '@prisma/client'
import { unscoped } from '@/lib/db/workspace-scope'

/**
 * LUM-919: reads and writes for the subprocessor change notice (DPA 7.2).
 * Deliberately cross-tenant: one change is announced to every workspace.
 */
const CROSS_TENANT =
  'subprocessor change notice to every workspace owner (LUM-919)'

export interface NoticeWorkspace {
  id: string
  name: string
  /** Set while a deletion is scheduled (LUM-918). */
  deletionRequestedAt: Date | null
  /** Active OWNERs only (deactivated members excluded, LUM-906). */
  owners: { clerkId: string }[]
}

export const subprocessorNoticeRepository = {
  /** Every workspace with its active owners, oldest first. */
  async listWorkspacesWithOwners(): Promise<NoticeWorkspace[]> {
    const rows = await unscoped(CROSS_TENANT).workspace.findMany({
      select: {
        id: true,
        name: true,
        deletionRequestedAt: true,
        members: {
          where: { role: 'OWNER', deactivatedAt: null },
          select: { clerkId: true },
          orderBy: { joinedAt: 'asc' },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    return rows.map(({ members, ...w }) => ({ ...w, owners: members }))
  },

  /** `<workspaceId>:<clerkId>` for every owner already notified of `changeId`. */
  async listDelivered(changeId: string): Promise<Set<string>> {
    const rows = await unscoped(
      CROSS_TENANT
    ).subprocessorNoticeDelivery.findMany({
      where: { changeId },
      select: { workspaceId: true, clerkId: true },
    })
    return new Set(rows.map(r => `${r.workspaceId}:${r.clerkId}`))
  },

  /**
   * Record one delivered notice. A unique-key conflict (a concurrent run got
   * there first) is not an error: the notice is on record either way.
   */
  async recordDelivery(input: {
    changeId: string
    workspaceId: string
    clerkId: string
    messageId: string | null
  }): Promise<void> {
    try {
      await unscoped(CROSS_TENANT).subprocessorNoticeDelivery.create({
        data: input,
        select: { id: true },
      })
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        return
      throw error
    }
  },
}
