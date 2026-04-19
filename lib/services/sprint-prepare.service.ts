import { prisma } from '@/lib/db/prisma'
import { sprintRepository } from '@/lib/repositories/sprint.repository'
import {
  sprintService,
  addDays,
  nextUtcMondayMidnight,
} from '@/lib/services/sprint.service'

const SYSTEM_ACTOR = { memberId: null } as const

export const sprintPrepareService = {
  async prepareNextDraft(teamId: string): Promise<void> {
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, sprintCadenceDays: true, sprintAutoPrepare: true },
    })
    if (!team || !team.sprintCadenceDays || !team.sprintAutoPrepare) return

    const existingDrafts = await sprintRepository.listByTeam(teamId, {
      status: 'DRAFT',
      limit: 1,
    })
    if (existingDrafts.length > 0) return

    const latestAny = await sprintRepository.listByTeam(teamId, { limit: 1 })
    const startDate =
      latestAny.length > 0 && latestAny[0]
        ? latestAny[0].endDate
        : nextUtcMondayMidnight(new Date())
    const endDate = addDays(startDate, team.sprintCadenceDays)

    await sprintService.createDraft(
      teamId,
      { startDate, endDate },
      SYSTEM_ACTOR as any
    )
  },

  async prepareAll(): Promise<{
    processed: number
    failures: Array<{ teamId: string; error: string }>
  }> {
    const teams = await prisma.team.findMany({
      where: { sprintCadenceDays: { not: null }, sprintAutoPrepare: true },
      select: { id: true, sprintCadenceDays: true, sprintAutoPrepare: true },
    })
    const failures: Array<{ teamId: string; error: string }> = []
    for (const team of teams) {
      try {
        await sprintPrepareService.prepareNextDraft(team.id)
      } catch (e) {
        failures.push({ teamId: team.id, error: (e as Error).message })
      }
    }
    return { processed: teams.length, failures }
  },
}
