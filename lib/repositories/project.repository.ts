import { prisma } from '@/lib/db/prisma'

export const projectRepository = {
  /** Find all projects in workspace, filtered by member visibility (public + own ideas). */
  async findByWorkspace(workspaceId: string, memberId: string) {
    return prisma.project.findMany({
      where: {
        workspaceId,
        OR: [{ isIdea: false }, { isIdea: true, createdByMemberId: memberId }],
      },
      include: {
        _count: { select: { tasks: true } },
        tasks: {
          where: { status: 'IN_PROGRESS' },
          select: { id: true },
        },
        repositories: {
          orderBy: [
            { isDefault: 'desc' as const },
            { createdAt: 'asc' as const },
          ] as { isDefault: 'desc'; createdAt: 'asc' }[],
        },
      },
      orderBy: { updatedAt: 'desc' },
    })
  },

  /** Find project by ID with task/view counts. */
  async findById(id: string) {
    return prisma.project.findUnique({
      where: { id },
      include: { _count: { select: { tasks: true, views: true } } },
    })
  },

  /** Create project with default DOCUMENT view in a transaction. */
  async create(data: {
    workspaceId: string
    teamId: string
    name: string
    description?: string
    isIdea?: boolean
    createdByMemberId: string
  }) {
    return prisma.$transaction(async tx => {
      const project = await tx.project.create({
        data: {
          workspaceId: data.workspaceId,
          teamId: data.teamId,
          createdByMemberId: data.createdByMemberId,
          name: data.name,
          description: data.description ?? null,
          isIdea: data.isIdea,
        },
      })

      await tx.view.create({
        data: {
          workspaceId: data.workspaceId,
          projectId: project.id,
          name: 'Document',
          type: 'DOCUMENT',
          isDefault: true,
        },
      })

      return project
    })
  },

  /** Update project fields. */
  async update(id: string, data: Record<string, unknown>) {
    return prisma.project.update({ where: { id }, data })
  },

  /** Delete project (cascades). */
  async delete(id: string) {
    await prisma.project.delete({ where: { id } })
  },
}
