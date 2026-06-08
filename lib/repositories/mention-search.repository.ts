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
 * Note: Project has no slug field — consumers use the project id to build URLs.
 */
export const mentionSearchRepository = {
  searchTasks(workspaceId: string, q: string, take: number) {
    return prisma.task.findMany({
      where: {
        project: { workspaceId },
        OR: [
          { title: insensitive(q) },
          { team: { identifier: insensitive(q) } },
        ],
      },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        team: { select: { identifier: true } },
        project: { select: { id: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take,
    })
  },

  searchSprints(workspaceId: string, q: string, take: number) {
    return prisma.sprint.findMany({
      where: {
        team: { workspaceId },
        name: insensitive(q),
      },
      select: {
        id: true,
        number: true,
        name: true,
        status: true,
        team: { select: { id: true } },
      },
      orderBy: { number: 'desc' },
      take,
    })
  },

  searchProjects(workspaceId: string, q: string, take: number) {
    return prisma.project.findMany({
      where: {
        workspaceId,
        name: insensitive(q),
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
        name: insensitive(q),
      },
      select: {
        id: true,
        name: true,
        slug: true,
        project: { select: { id: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take,
    })
  },
}
