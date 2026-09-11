/**
 * Repository for CrossingSuppressionRule — human-authored, per-repository
 * false-positive rules (LUM-751). Only this repository touches
 * prisma.crossingSuppressionRule (LUM-483 service-layer rule). Rules are
 * soft-revoked (`revokedAt`), never deleted — there is deliberately no delete.
 */
import { prisma } from '@/lib/db/prisma'
import type { BoundaryCrossingCategory } from '@prisma/client'
import type { ActiveSuppressionRule } from '@/lib/boundary-crossing/suppression'

export const crossingSuppressionRuleRepository = {
  async create(input: {
    projectId: string
    category: BoundaryCrossingCategory
    targetPattern: string
    reason: string | null
    createdById: string
    sourceCrossingId: string | null
  }): Promise<{ id: string }> {
    return prisma.crossingSuppressionRule.create({
      data: input,
      select: { id: true },
    })
  },

  /** Active (un-revoked) rules for a project — what the detector consults. */
  async findActiveForProject(
    projectId: string
  ): Promise<ActiveSuppressionRule[]> {
    return prisma.crossingSuppressionRule.findMany({
      where: { projectId, revokedAt: null },
      select: { id: true, category: true, targetPattern: true, reason: true },
      orderBy: { createdAt: 'asc' },
    })
  },

  async findById(id: string) {
    return prisma.crossingSuppressionRule.findUnique({
      where: { id },
      select: { id: true, projectId: true, revokedAt: true },
    })
  },

  /** Soft revoke — the row stays for audit. */
  async revoke(id: string, actorId: string | null, now: Date): Promise<void> {
    await prisma.crossingSuppressionRule.update({
      where: { id },
      data: { revokedAt: now, revokedById: actorId },
    })
  },
}
