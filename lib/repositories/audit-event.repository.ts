import type { AuditActorType, AuditSource, Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'

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

export const auditEventRepository = {
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
