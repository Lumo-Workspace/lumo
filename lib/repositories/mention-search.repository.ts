import { prisma } from '@/lib/db/prisma'

const insensitive = (q: string) => ({
  contains: q,
  mode: 'insensitive' as const,
})

/**
 * Data-access layer for @-mention entity search.
 * Returns minimal fields sufficient for the service layer to build mention DTOs
 * with hrefs. All queries are scoped to a workspaceId.
 *
 * Blank query (`q === ''`) omits the name filter and returns the most-recent
 * entities — this powers the "recent" suggestions shown when the user types a
 * bare `@` before typing anything to search.
 *
 * Note: Project has no slug field — consumers slugify the project name to build URLs.
 */
export const mentionSearchRepository = {
  searchTasks(workspaceId: string, q: string, take: number) {
    // A full `TEAM-N` identifier (e.g. `LUM-538`) can't be found by a substring
    // match — `team.identifier` holds only the prefix (`LUM`). Parse it so an
    // exact-identifier query surfaces that one task regardless of status or
    // recency (otherwise older/DONE tasks get crowded out of the take-N window).
    const [, idTeam, idNum] = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/.exec(q) ?? []
    return prisma.task.findMany({
      where: {
        project: { workspaceId },
        ...(q
          ? {
              OR: [
                { title: insensitive(q) },
                { team: { identifier: insensitive(q) } },
                ...(idTeam && idNum
                  ? [
                      {
                        team: {
                          identifier: {
                            equals: idTeam,
                            mode: 'insensitive' as const,
                          },
                        },
                        number: Number(idNum),
                      },
                    ]
                  : []),
              ],
            }
          : {}),
      },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        team: { select: { identifier: true } },
        project: { select: { name: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take,
    })
  },

  searchSprints(workspaceId: string, q: string, take: number) {
    return prisma.sprint.findMany({
      where: {
        team: { workspaceId },
        ...(q ? { name: insensitive(q) } : {}),
      },
      select: {
        id: true,
        number: true,
        name: true,
        status: true,
      },
      orderBy: { number: 'desc' },
      take,
    })
  },

  searchProjects(workspaceId: string, q: string, take: number) {
    return prisma.project.findMany({
      where: {
        workspaceId,
        ...(q ? { name: insensitive(q) } : {}),
      },
      select: {
        id: true,
        name: true,
      },
      orderBy: { updatedAt: 'desc' },
      take,
    })
  },

  searchMilestones(workspaceId: string, q: string, take: number) {
    return prisma.milestone.findMany({
      where: {
        project: { workspaceId },
        ...(q ? { name: insensitive(q) } : {}),
      },
      select: {
        id: true,
        name: true,
        slug: true,
        project: { select: { name: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take,
    })
  },
}
