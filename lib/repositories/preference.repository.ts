import { prisma } from '@/lib/db/prisma'

// ── Preference Repository ──────────────────────────────────────────────────

export const preferenceRepository = {
  /** Find user preferences by member ID. */
  async findByMemberId(memberId: string) {
    return prisma.userPreference.findUnique({ where: { memberId } })
  },

  /**
   * LUM-1097: the saved language of the active member `clerkId` in
   * `workspaceId`; null when they have no preference row (or no membership).
   */
  async findLocaleForMember(
    workspaceId: string,
    clerkId: string
  ): Promise<string | null> {
    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId, clerkId, deactivatedAt: null },
      select: { preference: { select: { locale: true } } },
    })
    return member?.preference?.locale ?? null
  },

  /** Upsert user preferences. */
  async upsert(memberId: string, update: Record<string, unknown>) {
    return prisma.userPreference.upsert({
      where: { memberId },
      update,
      create: { memberId, ...update },
    })
  },
}
