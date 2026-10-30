import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'

/**
 * LUM-1344: platform-level admin audit log (not workspace-scoped).
 * This layer only persists and reads; the service owns paging policy.
 */

export interface PlatformAdminAuditCreateData {
  adminUserId: string
  action: string
  targetType: string
  targetId: string
  workspaceId?: string | undefined
  metadata?: Prisma.InputJsonValue | undefined
}

export interface PlatformAdminAuditFilters {
  adminUserId?: string | undefined
  targetType?: string | undefined
  targetId?: string | undefined
  before?: Date | undefined
}

const PLATFORM_ADMIN_AUDIT_SELECT = {
  id: true,
  adminUserId: true,
  action: true,
  targetType: true,
  targetId: true,
  workspaceId: true,
  metadata: true,
  createdAt: true,
} satisfies Prisma.PlatformAdminAuditEventSelect

export type PlatformAdminAuditRow = Prisma.PlatformAdminAuditEventGetPayload<{
  select: typeof PLATFORM_ADMIN_AUDIT_SELECT
}>

export const platformAdminAuditRepository = {
  async create(data: PlatformAdminAuditCreateData): Promise<void> {
    const { workspaceId, metadata, ...required } = data
    await prisma.platformAdminAuditEvent.create({
      data: {
        ...required,
        ...(workspaceId !== undefined ? { workspaceId } : {}),
        ...(metadata !== undefined ? { metadata } : {}),
      },
      select: { id: true },
    })
  },

  /**
   * Newest first. `cursor` is the id of the last row of the previous page;
   * Prisma resumes strictly after it in (createdAt desc, id desc) order.
   */
  async listPage(
    filters: PlatformAdminAuditFilters,
    cursor: string | undefined,
    take: number
  ): Promise<PlatformAdminAuditRow[]> {
    const where: Prisma.PlatformAdminAuditEventWhereInput = {}
    if (filters.adminUserId) where.adminUserId = filters.adminUserId
    if (filters.targetType) where.targetType = filters.targetType
    if (filters.targetId) where.targetId = filters.targetId
    if (filters.before) where.createdAt = { lt: filters.before }
    return prisma.platformAdminAuditEvent.findMany({
      where,
      select: PLATFORM_ADMIN_AUDIT_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
  },
}
