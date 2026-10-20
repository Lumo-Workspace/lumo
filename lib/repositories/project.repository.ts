import type { ProjectStatus } from '@prisma/client'
import { scopedPrisma as prisma, unscoped } from '@/lib/db/workspace-scope'

export interface ProjectUpdateData {
  name?: string
  description?: string | null
  isIdea?: boolean
  ownerId?: string | null
  /** LUM-1285 lifecycle fields. */
  status?: ProjectStatus
  startDate?: Date | null
  targetDate?: Date | null
  archivedAt?: Date | null
}

// Visibility filter shared by every project-listing query.
// Keep in sync: dropping/adding a clause here affects findByWorkspace AND countTasksByStatus.
function projectVisibilityWhere(workspaceId: string, memberId: string) {
  return {
    workspaceId,
    OR: [{ isIdea: false }, { isIdea: true, createdByMemberId: memberId }],
  }
}

const PROJECT_COUNTS_INCLUDE = {
  _count: {
    select: { tasks: { where: { deletedAt: null } }, views: true },
  },
} as const

// LUM-979: tenant-resolution lookups — the caller has only a project id and
// authorizes against the returned row's workspaceId (404 on mismatch).
const TENANT_RESOLUTION =
  'tenant resolution: caller authorizes on the returned workspaceId'

export const projectRepository = {
  /** Find all projects in workspace, filtered by member visibility (public + own ideas). */
  async findByWorkspace(workspaceId: string, memberId: string) {
    return prisma.project.findMany({
      where: projectVisibilityWhere(workspaceId, memberId),
      include: {
        _count: { select: { tasks: { where: { deletedAt: null } } } },
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
        workspaceId,
        // Trashed tasks are not part of the project any more — same filter as
        // the `_count.tasks` the list shows (LUM-1285: derived completion).
        deletedAt: null,
        project: projectVisibilityWhere(workspaceId, memberId),
      },
      _count: { _all: true },
    })

    const map = new Map<
      string,
      {
        BACKLOG: number
        TODO: number
        IN_PROGRESS: number
        IN_REVIEW: number
        DONE: number
      }
    >()
    for (const row of rows) {
      // Type guard only: groupBy widens `by` keys to nullable; runtime always has projectId.
      if (!row.projectId) continue
      const bucket = map.get(row.projectId) ?? {
        BACKLOG: 0,
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

  /**
   * Find project by ID with task/view counts, within `workspaceId` (LUM-979):
   * another workspace's id reads as missing.
   */
  async findById(id: string, workspaceId: string) {
    return prisma.project.findUnique({
      where: { id, workspaceId },
      include: PROJECT_COUNTS_INCLUDE,
    })
  },

  /**
   * Is `id` a project in `workspaceId`? One indexed lookup, id only — for
   * validating a caller-supplied `projectId` (LUM-993). Another workspace's
   * id reads as missing.
   */
  async findIdInWorkspace(id: string, workspaceId: string) {
    return prisma.project.findUnique({
      where: { id, workspaceId },
      select: { id: true },
    })
  },

  /**
   * `findById` for background jobs that start from a bare project id (Layer-2
   * memory consolidation, milestone-close distillation) — no caller workspace
   * to scope to.
   */
  async findByIdForSystemJob(id: string) {
    return unscoped(
      'system job: memory consolidation/distillation starts from a bare project id'
    ).project.findUnique({
      where: { id },
      include: PROJECT_COUNTS_INCLUDE,
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
  async update(id: string, workspaceId: string, data: ProjectUpdateData) {
    return prisma.project.update({
      where: { id, workspaceId },
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
  async delete(id: string, workspaceId: string) {
    await prisma.project.delete({ where: { id, workspaceId } })
  },

  /** Find project by ID (simple, no includes). */
  async findByIdSimple(id: string) {
    return unscoped(TENANT_RESOLUTION).project.findUnique({ where: { id } })
  },

  /**
   * Resolve a projectId to its workspace. Used by routes that need to do a
   * workspace-membership check on a project-scoped resource.
   */
  async findWorkspaceId(id: string) {
    return unscoped(TENANT_RESOLUTION).project.findUnique({
      where: { id },
      select: { workspaceId: true },
    })
  },

  /** LUM-553 — workspace + fold-cooldown state for the autonomous fold pass. */
  async findFoldState(id: string) {
    return unscoped(
      'system job: autonomous memory fold starts from a bare project id'
    ).project.findUnique({
      where: { id },
      select: { workspaceId: true, lastMemoryFoldAttemptAt: true },
    })
  },

  /** LUM-553 — stamp the fold attempt time (cooldown anchor). */
  async stampFoldAttempt(id: string, workspaceId: string, at: Date) {
    await prisma.project.update({
      where: { id, workspaceId },
      data: { lastMemoryFoldAttemptAt: at },
    })
  },

  /**
   * Find project by ID with default owner and workspace slug. Task creation
   * (route, CLI, crossing remediation, Sentry webhook) has already resolved
   * and authorized the project id by the time it gets here.
   */
  async findByIdWithDefaults(id: string) {
    return unscoped(
      'task creation: project id already resolved and authorized by the caller'
    ).project.findUnique({
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
   * LUM-1131: the workspace project a GitHub repository is linked to — the
   * project whose link is marked default first, then the oldest link. Names
   * compare case-insensitively (GitHub's do). null when no project links it.
   */
  async findProjectIdByRepoFullName(
    workspaceId: string,
    fullName: string
  ): Promise<string | null> {
    const row = await prisma.projectRepository.findFirst({
      where: {
        project: { workspaceId },
        fullName: { equals: fullName, mode: 'insensitive' },
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: { projectId: true },
    })
    return row?.projectId ?? null
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
