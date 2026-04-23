import { prisma } from '@/lib/db/prisma'

export interface UpdateSprintCadenceInput {
  enabled?: boolean
  durationDays?: number
  cooldownDays?: number
  startWeekday?: number
  autoCreate?: number
}

export const teamRepository = {
  /** Read only the fields needed to decide whether the team can create sprints. */
  async findSprintGatingConfig(teamId: string) {
    return prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, sprintsEnabled: true },
    })
  },

  /**
   * Read the cadence config used by sprintService.ensureFutureSprints().
   * Returns null when the team does not exist.
   */
  async findSprintCadenceConfig(teamId: string) {
    return prisma.team.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        sprintsEnabled: true,
        sprintDurationDays: true,
        sprintCooldownDays: true,
        sprintStartWeekday: true,
        sprintAutoCreate: true,
      },
    })
  },

  /** Update sprint cadence fields on the team row. Only provided keys are persisted. */
  async updateSprintCadence(teamId: string, input: UpdateSprintCadenceInput) {
    return prisma.team.update({
      where: { id: teamId },
      data: {
        ...(input.enabled !== undefined
          ? { sprintsEnabled: input.enabled }
          : {}),
        ...(input.durationDays !== undefined
          ? { sprintDurationDays: input.durationDays }
          : {}),
        ...(input.cooldownDays !== undefined
          ? { sprintCooldownDays: input.cooldownDays }
          : {}),
        ...(input.startWeekday !== undefined
          ? { sprintStartWeekday: input.startWeekday }
          : {}),
        ...(input.autoCreate !== undefined
          ? { sprintAutoCreate: input.autoCreate }
          : {}),
      },
    })
  },
}
