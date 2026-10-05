import type { AuditActorType, AuditSource, Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import type { AuditCursor, AuditEventFilters } from '@/lib/audit/query'

/**
 * LUM-907: the workspace audit log table. Writes arrive already normalised
 * and redacted by lib/services/audit.service.ts — this layer only persists
 * and prunes.
 */

export interface AuditEventCreateData {
  workspaceId: string
  actorType: AuditActorType
  actorId: string | null
  actorMemberId: string | null
  action: string
  targetType: string
  targetId: string | null
  source: AuditSource
  ip: string | null
  userAgent: string | null
  metadata: Prisma.InputJsonValue | undefined
}

const AUDIT_EVENT_SELECT = {
  id: true,
  createdAt: true,
  action: true,
  actorType: true,
  actorId: true,
  actorMemberId: true,
  source: true,
  targetType: true,
  targetId: true,
  ip: true,
  userAgent: true,
  metadata: true,
} satisfies Prisma.AuditEventSelect

export type AuditEventRow = Prisma.AuditEventGetPayload<{
  select: typeof AUDIT_EVENT_SELECT
}>

/** The WHERE for one workspace's events — `workspaceId` is never optional. */
function auditWhere(
  workspaceId: string,
  f: AuditEventFilters,
  cursor: AuditCursor | null
): Prisma.AuditEventWhereInput {
  const and: Prisma.AuditEventWhereInput[] = [{ workspaceId }]
  if (f.action) {
    and.push(
      f.action.includes('.')
        ? { action: f.action }
        : { action: { startsWith: `${f.action}.` } }
    )
  }
  if (f.actorType) and.push({ actorType: f.actorType })
  if (f.actorId) and.push({ actorId: f.actorId })
  if (f.since) and.push({ createdAt: { gte: f.since } })
  if (f.before) and.push({ createdAt: { lt: f.before } })
  if (f.targetType) and.push({ targetType: f.targetType })
  if (f.targetId) and.push({ targetId: f.targetId })
  if (cursor) {
    and.push({
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ],
    })
  }
  return { AND: and }
}

export const auditEventRepository = {
  /**
   * LUM-907 PR2: one workspace's events, newest first, keyset-paginated on
   * (createdAt, id) — strictly older than `cursor` when one is given.
   */
  async listPage(
    workspaceId: string,
    filters: AuditEventFilters,
    cursor: AuditCursor | null,
    take: number
  ): Promise<AuditEventRow[]> {
    return prisma.auditEvent.findMany({
      where: auditWhere(workspaceId, filters, cursor),
      select: AUDIT_EVENT_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
    })
  },

  /** The workspace's current members (id + Clerk id), for actor filters. */
  async findWorkspaceMembers(
    workspaceId: string
  ): Promise<Array<{ id: string; clerkId: string }>> {
    return prisma.workspaceMember.findMany({
      where: { workspaceId },
      select: { id: true, clerkId: true },
    })
  },

  async create(data: AuditEventCreateData): Promise<{ id: string }> {
    const { metadata, ...rest } = data
    return prisma.auditEvent.create({
      data: metadata === undefined ? rest : { ...rest, metadata },
      select: { id: true },
    })
  },

  /**
   * Delete up to `take` events created before `cutoff`, oldest first.
   * Returns how many were deleted; fewer than `take` means none are left.
   */
  async deleteBatchOlderThan(cutoff: Date, take: number): Promise<number> {
    const rows = await prisma.auditEvent.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take,
    })
    if (rows.length === 0) return 0
    const { count } = await prisma.auditEvent.deleteMany({
      where: { id: { in: rows.map(r => r.id) } },
    })
    return count
  },

  /** The member's Clerk user id, or null when the member row is gone. */
  async findMemberClerkId(memberId: string): Promise<string | null> {
    const row = await prisma.workspaceMember.findUnique({
      where: { id: memberId },
      select: { clerkId: true },
    })
    return row?.clerkId ?? null
  },
}
