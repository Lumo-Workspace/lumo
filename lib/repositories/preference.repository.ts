import { prisma } from '@/lib/db/prisma'

// ── Preference Repository ──────────────────────────────────────────────────

export const preferenceRepository = {
  /** Find user preferences by member ID. */
  async findByMemberId(memberId: string) {
    return prisma.userPreference.findUnique({ where: { memberId } })
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
