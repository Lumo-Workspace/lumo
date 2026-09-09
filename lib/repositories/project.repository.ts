import { prisma } from '@/lib/db/prisma'

export interface ProjectUpdateData {
  name?: string
  description?: string | null
  isIdea?: boolean
  ownerId?: string | null
}

// Visibility filter shared by every project-listing query.
// Keep in sync: dropping/adding a clause here affects findByWorkspace AND countTasksByStatus.
function projectVisibilityWhere(workspaceId: string, memberId: string) {
  return {
    workspaceId,
    OR: [{ isIdea: false }, { isIdea: true, createdByMemberId: memberId }],
  }
}

export const projectRepository = {
  /** Find all projects in workspace, filtered by member visibility (public + own ideas). */
  async findByWorkspace(workspaceId: string, memberId: string) {
    return prisma.project.findMany({
      where: projectVisibilityWhere(workspaceId, memberId),
      include: {
        _count: { select: { tasks: true } },
        owner: {
          select: {
            id: true,
            clerkId: true,
            actor: { select: { id: true } },
          },
        },
        repositories: {
          orderBy: [
            { isDefault: 'desc' as const },
            { createdAt: 'asc' as const },
          ] as unknown as { isDefault: 'desc'; createdAt: 'asc' }[],
        },
      },
      orderBy: [{ order: 'asc' as const }, { name: 'asc' as const }],
    })
  },

  /** Group tasks by (projectId, status) for the workspace, return buckets per project. */
  async countTasksByStatus(workspaceId: string, memberId: string) {
    const rows = await prisma.task.groupBy({
      by: ['projectId', 'status'],
      where: {
        project: projectVisibilityWhere(workspaceId, memberId),
      },
      _count: { _all: true },
    })

    const map = new Map<
      string,
      { TODO: number; IN_PROGRESS: number; IN_REVIEW: number; DONE: number }
    >()
    for (const row of rows) {
      // Type guard only: groupBy widens `by` keys to nullable; runtime always has projectId.
      if (!row.projectId) continue
      const bucket = map.get(row.projectId) ?? {
        TODO: 0,
        IN_PROGRESS: 0,
        IN_REVIEW: 0,
        DONE: 0,
      }
      bucket[row.status] = row._count._all
      map.set(row.projectId, bucket)
    }
    return map
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
    order: number
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
          order: data.order,
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

  /**
   * Update project fields. Returns the updated row including the
   * owner's clerkId + actor.id so the service can flatten
   * to the same shape as listProjects/getProject.
   */
  async update(id: string, data: ProjectUpdateData) {
    return prisma.project.update({
      where: { id },
      data,
      include: {
        owner: {
          select: {
            id: true,
            clerkId: true,
            actor: { select: { id: true } },
          },
        },
      },
    })
  },

  /** Delete project (cascades). */
  async delete(id: string) {
    await prisma.project.delete({ where: { id } })
  },

  /** Find project by ID (simple, no includes). */
  async findByIdSimple(id: string) {
    return prisma.project.findUnique({ where: { id } })
  },

  /**
   * Resolve a projectId to its workspace. Used by routes that need to do a
   * workspace-membership check on a project-scoped resource.
   */
  async findWorkspaceId(id: string) {
    return prisma.project.findUnique({
      where: { id },
      select: { workspaceId: true },
    })
  },

  /** LUM-553 — workspace + fold-cooldown state for the autonomous fold pass. */
  async findFoldState(id: string) {
    return prisma.project.findUnique({
      where: { id },
      select: { workspaceId: true, lastMemoryFoldAttemptAt: true },
    })
  },

  /** LUM-553 — stamp the fold attempt time (cooldown anchor). */
  async stampFoldAttempt(id: string, at: Date) {
    await prisma.project.update({
      where: { id },
      data: { lastMemoryFoldAttemptAt: at },
    })
  },

  /** Find project by ID with default owner and workspace slug. */
  async findByIdWithDefaults(id: string) {
    return prisma.project.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true } },
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

  /**
   * LUM-590: find the default linked repository for a project (isDefault: true,
   * or the earliest-created one as fallback). Returns only `fullName` — the
   * only field the code-rule pipeline needs.
   * Returns null when no repositories are linked.
   */
  async findDefaultRepository(
    projectId: string
  ): Promise<{ fullName: string } | null> {
    const row = await prisma.projectRepository.findFirst({
      where: { projectId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: { fullName: true },
    })
    return row ?? null
  },

  /**
   * LUM-735 — has this repo ever pushed a SARIF report? `undefined` = the
   * repo is not linked in this workspace at all; `null` = linked but never
   * ingested (panel: NOT_CONFIGURED); a Date = ingested before (panel: PENDING
   * until this sha's report lands).
   */
  async findLastSarifIngestAt(
    workspaceId: string,
    fullName: string
  ): Promise<Date | null | undefined> {
    const row = await prisma.projectRepository.findFirst({
      where: { fullName, project: { workspaceId } },
      orderBy: { lastSarifIngestAt: { sort: 'desc', nulls: 'last' } },
      select: { lastSarifIngestAt: true },
    })
    if (!row) return undefined
    return row.lastSarifIngestAt
  },

  async markSarifIngested(
    workspaceId: string,
    fullName: string,
    at: Date
  ): Promise<number> {
    const res = await prisma.projectRepository.updateMany({
      where: { fullName, project: { workspaceId } },
      data: { lastSarifIngestAt: at },
    })
    return res.count
  },

  /**
   * Replace the `order` field on a sequence of projects to match the given array
   * (1-based). Runs in a transaction. The `workspaceId` scope is enforced in
   * each update's `where` so a cross-workspace id causes the transaction to
   * abort (`P2025`) instead of silently reordering the wrong workspace. Caller
   * is still expected to dedupe / validate input; this is defense-in-depth.
   */
  async reorder(workspaceId: string, orderedIds: string[]) {
    return prisma.$transaction(async tx => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.project.update({
          where: { id: orderedIds[i]!, workspaceId },
          data: { order: i + 1 },
        })
      }
    })
  },

  /**
   * Max `order` currently in use for a workspace. Returns 0 when there are no
   * projects (safe to pass `max + 1` as the next order).
   */
  async maxOrderInWorkspace(workspaceId: string): Promise<number> {
    const row = await prisma.project.aggregate({
      where: { workspaceId },
      _max: { order: true },
    })
    return row._max.order ?? 0
  },
}
