import { prisma } from '@/lib/db/prisma'

export interface ProjectUpdateData {
  name?: string
  description?: string | null
  isIdea?: boolean
  defaultReviewerId?: string | null
}

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
          ] as unknown as { isDefault: 'desc'; createdAt: 'asc' }[],
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
    description?: string | undefined
    isIdea?: boolean | undefined
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
          isIdea: data.isIdea ?? false,
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
  async update(id: string, data: ProjectUpdateData) {
    return prisma.project.update({ where: { id }, data })
  },

  /** Delete project (cascades). */
  async delete(id: string) {
    await prisma.project.delete({ where: { id } })
  },

  /** Find project by ID (simple, no includes). */
  async findByIdSimple(id: string) {
    return prisma.project.findUnique({ where: { id } })
  },

  /** Find project by ID with default reviewer and workspace slug. */
  async findByIdWithDefaults(id: string) {
    return prisma.project.findUnique({
      where: { id },
      include: {
        defaultReviewer: { select: { id: true } },
        workspace: { select: { slug: true } },
      },
    })
  },

  /** Find all non-idea projects in a workspace (for AI context). */
  async findByWorkspaceNonIdea(workspaceId: string) {
    return prisma.project.findMany({
      where: { workspaceId, isIdea: false },
      select: { id: true, name: true, description: true },
      orderBy: { createdAt: 'desc' },
    })
  },

  // ── ProjectRepository (linked repos) ──────────────────────────────────

  /** Find all linked repositories for a project. */
  async findRepositories(projectId: string) {
    return prisma.projectRepository.findMany({
      where: { projectId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    })
  },

  /** Find a project repository by ID with project workspace info. */
  async findRepositoryById(repoId: string) {
    return prisma.projectRepository.findUnique({
      where: { id: repoId },
      include: { project: { select: { workspaceId: true } } },
    })
  },

  /** Clear default flag on all repos in a project. */
  async clearDefaultRepositories(projectId: string) {
    return prisma.projectRepository.updateMany({
      where: { projectId, isDefault: true },
      data: { isDefault: false },
    })
  },

  /** Count repositories linked to a project. */
  async countRepositories(projectId: string) {
    return prisma.projectRepository.count({
      where: { projectId },
    })
  },

  /** Create a project repository link. */
  async createRepository(data: {
    projectId: string
    fullName: string
    name: string
    isDefault: boolean
  }) {
    return prisma.projectRepository.create({ data })
  },

  /** Update a project repository. */
  async updateRepository(repoId: string, data: { isDefault?: boolean }) {
    return prisma.projectRepository.update({
      where: { id: repoId },
      data,
    })
  },

  /** Delete a project repository link. */
  async deleteRepository(repoId: string) {
    return prisma.projectRepository.delete({ where: { id: repoId } })
  },
}
