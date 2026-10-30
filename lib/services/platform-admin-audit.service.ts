import type { Prisma } from '@prisma/client'
import {
  platformAdminAuditRepository,
  type PlatformAdminAuditRow,
} from '@/lib/repositories/platform-admin-audit.repository'

export type { PlatformAdminAuditRow }

export type PlatformAdminAction =
  | 'workspace.list'
  | 'workspace.view'
  | 'user.list'
  | 'user.view'
  | 'usage.view'
  | 'waitlist.list'
  | 'waitlist.approve'
  | 'waitlist.resend'
  | 'audit.list'

export interface PlatformAdminAuditInput {
  adminUserId: string
  action: PlatformAdminAction
  targetType: 'workspace' | 'user' | 'waitlist' | 'usage' | 'audit'
  /** List actions use '*'. */
  targetId: string
  workspaceId?: string
  metadata?: Record<string, unknown>
}

export interface PlatformAdminAuditQuery {
  adminUserId?: string
  targetType?: string
  targetId?: string
  before?: Date
  /** id of the last row of the previous page */
  cursor?: string
  limit: number
}

const MAX_LIMIT = 100

export const platformAdminAudit = {
  /** Throws on write failure: an admin access that cannot be audited must fail. */
  async record(input: PlatformAdminAuditInput): Promise<void> {
    await platformAdminAuditRepository.create({
      adminUserId: input.adminUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      workspaceId: input.workspaceId,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    })
  },

  async list(
    q: PlatformAdminAuditQuery
  ): Promise<{ items: PlatformAdminAuditRow[]; nextCursor: string | null }> {
    const limit = Math.max(1, Math.min(Math.floor(q.limit), MAX_LIMIT))
    const rows = await platformAdminAuditRepository.listPage(
      {
        adminUserId: q.adminUserId,
        targetType: q.targetType,
        targetId: q.targetId,
        before: q.before,
      },
      q.cursor,
      limit + 1
    )
    const items = rows.slice(0, limit)
    const last = items[items.length - 1]
    const nextCursor = rows.length > limit && last ? last.id : null
    return { items, nextCursor }
  },
}
