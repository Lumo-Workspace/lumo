import { prisma } from '@/lib/db/prisma'

export const sprintNotificationsRepository = {
  /**
   * Return the deduped actor IDs for all members of the given team.
   * Used by dispatchSprintNotification() to find recipients for
   * SPRINT_STARTED / SPRINT_CLOSED notifications.
   */
  async findTeamActorIds(teamId: string): Promise<string[]> {
    const members = await prisma.teamMember.findMany({
      where: { teamId },
      select: { member: { select: { actor: { select: { id: true } } } } },
    })
    const ids = members
      .map(m => m.member.actor?.id)
      .filter((x): x is string => !!x)
    return Array.from(new Set(ids))
  },
}
