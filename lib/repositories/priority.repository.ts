import { prisma } from '@/lib/db/prisma'

/**
 * Team-level Priority (LUM-660 schema). Append-only by design: this
 * repository intentionally exposes NO update or delete method — a newer
 * declaration supersedes an older one by a later `effectiveFrom`, and the
 * history is never mutated. Ordering is `effectiveFrom desc, createdAt desc`
 * so a same-instant tie breaks toward the row inserted last.
 */
export const priorityRepository = {
  /**
   * Resolve the workspace's default team. Priority is team-level with no
   * project; a CLI caller declares against their workspace's default team.
   * Returns null when the workspace has no default team (should not happen
   * for a provisioned workspace).
   */
  async findDefaultTeamId(workspaceId: string): Promise<string | null> {
    const team = await prisma.team.findFirst({
      where: { workspaceId, isDefault: true },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })
    return team?.id ?? null
  },

  /** Append a new priority row. Never touches an existing row. */
  async append(data: {
    teamId: string
    workspaceId: string
    statement: string
    effectiveFrom: Date
    declaredByMemberId: string
  }) {
    return prisma.priority.create({ data })
  },

  /** The current priority = the row with the greatest `effectiveFrom`. */
  async findCurrent(teamId: string) {
    return prisma.priority.findFirst({
      where: { teamId },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    })
  },

  /** Full append history, newest first. */
  async listHistory(teamId: string) {
    return prisma.priority.findMany({
      where: { teamId },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    })
  },
}
