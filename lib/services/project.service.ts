import { projectRepository } from '@/lib/repositories/project.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { getDefaultTeam } from '@/lib/team'

// ── Types ───────────────────────────────────────────────────────────────────

export interface UpdateProjectInput {
  name?: string | undefined
  description?: string | null | undefined
  isIdea?: boolean | undefined
  defaultReviewerId?: string | null | undefined
}

// ── Project Service ─────────────────────────────────────────────────────────

export const projectService = {
  /** List projects with permission filtering, status counts, and Clerk-resolved reviewer name. */
  async listProjects(workspaceId: string, memberId: string) {
    const [projects, statusCounts] = await Promise.all([
      projectRepository.findByWorkspace(workspaceId, memberId),
      projectRepository.countTasksByStatus(workspaceId, memberId),
    ])

    // Batch-resolve reviewer display names from Clerk (one call for all reviewers).
    const clerkIds = Array.from(
      new Set(
        projects
          .map(p => p.defaultReviewer?.clerkId)
          .filter((c): c is string => !!c)
      )
    )
    const nameByClerkId = new Map<string, string>()
    if (clerkIds.length > 0) {
      const { clerkClient } = await import('@clerk/nextjs/server')
      const clerk = await clerkClient()
      const { data: users } = await clerk.users.getUserList({
        userId: clerkIds,
        limit: clerkIds.length,
      })
      for (const u of users) {
        const trimmed = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim()
        nameByClerkId.set(
          u.id,
          trimmed || u.emailAddresses[0]?.emailAddress || 'Unknown'
        )
      }
    }

    return projects.map(p => {
      const counts = statusCounts.get(p.id) ?? {
        TODO: 0,
        IN_PROGRESS: 0,
        IN_REVIEW: 0,
        DONE: 0,
      }
      const { defaultReviewer, ...rest } = p
      return {
        ...rest,
        todoCount: counts.TODO,
        inProgressCount: counts.IN_PROGRESS,
        inReviewCount: counts.IN_REVIEW,
        doneCount: counts.DONE,
        defaultReviewer: defaultReviewer
          ? {
              id: defaultReviewer.id,
              name: nameByClerkId.get(defaultReviewer.clerkId) ?? 'Unknown',
            }
          : null,
      }
    })
  },

  /** Get a single project. Throws 404 if not found or if idea not owned by member. */
  async getProject(projectId: string, memberId: string) {
    const project = await projectRepository.findById(projectId)
    if (!project) {
      throw Object.assign(new Error('Project not found'), { status: 404 })
    }

    if (project.isIdea && project.createdByMemberId !== memberId) {
      throw Object.assign(new Error('Project not found'), { status: 404 })
    }

    return project
  },

  /** Create a new project. Uses getDefaultTeam(). */
  async createProject(
    workspaceId: string,
    memberId: string,
    data: {
      name: string
      description?: string | undefined
      isIdea?: boolean | undefined
    }
  ) {
    const defaultTeam = await getDefaultTeam(workspaceId)

    return projectRepository.create({
      workspaceId,
      teamId: defaultTeam!.id,
      createdByMemberId: memberId,
      name: data.name,
      description: data.description,
      isIdea: data.isIdea,
    })
  },

  /** Update a project. Validates idea edit permission and reviewer workspace membership. */
  async updateProject(
    projectId: string,
    memberId: string,
    input: UpdateProjectInput
  ) {
    const project = await projectRepository.findById(projectId)
    if (!project) {
      throw Object.assign(new Error('Project not found'), { status: 404 })
    }

    if (project.isIdea && project.createdByMemberId !== memberId) {
      throw Object.assign(new Error('Forbidden'), { status: 403 })
    }

    const data: import('@/lib/repositories/project.repository').ProjectUpdateData =
      {}
    if (input.name !== undefined) data.name = input.name
    if (input.description !== undefined) data.description = input.description
    if (input.isIdea !== undefined) data.isIdea = input.isIdea
    if (input.defaultReviewerId !== undefined) {
      if (input.defaultReviewerId !== null) {
        const reviewer = await memberRepository.findById(
          input.defaultReviewerId
        )
        if (!reviewer || reviewer.workspaceId !== project.workspaceId) {
          throw Object.assign(
            new Error('Reviewer is not a member of this workspace'),
            { status: 400 }
          )
        }
      }
      data.defaultReviewerId = input.defaultReviewerId
    }

    return projectRepository.update(projectId, data)
  },

  /** Delete a project. Validates idea delete permission. */
  async deleteProject(projectId: string, memberId: string) {
    const project = await projectRepository.findById(projectId)
    if (!project) {
      throw Object.assign(new Error('Project not found'), { status: 404 })
    }

    if (project.isIdea && project.createdByMemberId !== memberId) {
      throw Object.assign(new Error('Forbidden'), { status: 403 })
    }

    await projectRepository.delete(projectId)
  },
}
