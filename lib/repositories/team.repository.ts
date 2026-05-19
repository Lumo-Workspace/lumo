import { prisma } from '@/lib/db/prisma'

export interface UpdateSprintCadenceInput {
  enabled?: boolean
  durationDays?: number
  cooldownDays?: number
  startWeekday?: number
  autoCreate?: number
}

/** Field set returned by `listForMember` — kept in sync with the GET /api/teams contract. */
const TEAM_LIST_SELECT = {
  id: true,
  name: true,
  identifier: true,
  isDefault: true,
  sprintsEnabled: true,
  sprintDurationDays: true,
  sprintCooldownDays: true,
  sprintStartWeekday: true,
  sprintAutoCreate: true,
} as const

export const teamRepository = {
  /**
   * Resolve a teamId to its workspace. Returned by the route-helper that
   * gates all `/api/teams/[teamId]/...` endpoints — they need `workspaceId`
   * to feed `requireTeamMemberOrOwner`.
   */
  async findWorkspaceId(teamId: string) {
    return prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, workspaceId: true },
    })
  },

  /**
   * List teams visible to `memberId` in `workspaceId`. OWNERs see every team,
   * others only see teams where they have an explicit TeamMember row.
   */
  async listForMember(
    workspaceId: string,
    memberId: string,
    opts: { isOwner: boolean }
  ) {
    return prisma.team.findMany({
      where: {
        workspaceId,
        ...(opts.isOwner ? {} : { members: { some: { memberId } } }),
      },
      select: TEAM_LIST_SELECT,
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    })
  },

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
