import { projectRepository } from '@/lib/repositories/project.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { getDefaultTeam } from '@/lib/team'
import { pushWorkspaceEvent } from '@/lib/integrations/pusher/server'

// ── Types ───────────────────────────────────────────────────────────────────

export interface UpdateProjectInput {
  name?: string | undefined
  description?: string | null | undefined
  isIdea?: boolean | undefined
  ownerId?: string | null | undefined
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
        projects.map(p => p.owner?.clerkId).filter((c): c is string => !!c)
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
      const { owner, ...rest } = p
      // Reviewer ids exposed to the API are actor ids — the same id space the
      // UI's ReviewerSelect uses for tasks. The DB stores WorkspaceMember.id
      // on the FK; we translate via the joined `actor` row.
      const reviewerActorId = owner?.actor?.id ?? null
      return {
        ...rest,
        ownerId: reviewerActorId,
        todoCount: counts.TODO,
        inProgressCount: counts.IN_PROGRESS,
        inReviewCount: counts.IN_REVIEW,
        doneCount: counts.DONE,
        owner:
          owner && reviewerActorId
            ? {
                id: reviewerActorId,
                name: nameByClerkId.get(owner.clerkId) ?? 'Unknown',
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
    const maxOrder = await projectRepository.maxOrderInWorkspace(workspaceId)

    return projectRepository.create({
      workspaceId,
      teamId: defaultTeam!.id,
      createdByMemberId: memberId,
      name: data.name,
      description: data.description,
      isIdea: data.isIdea,
      order: maxOrder + 1,
    })
  },

  /**
   * Update a project. Validates idea edit permission and reviewer workspace
   * membership. `input.ownerId` is interpreted as an Actor.id (the
   * same id space the UI's ReviewerSelect uses for tasks); the service
   * resolves it to the underlying WorkspaceMember.id for storage and
   * translates the response back to actor.id for the UI.
   */
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
    if (input.ownerId !== undefined) {
      if (input.ownerId !== null) {
        const reviewerMember = await memberRepository.findByActorId(
          input.ownerId
        )
        if (
          !reviewerMember ||
          reviewerMember.workspaceId !== project.workspaceId
        ) {
          throw Object.assign(
            new Error('Reviewer is not a member of this workspace'),
            { status: 400 }
          )
        }
        data.ownerId = reviewerMember.id
      } else {
        data.ownerId = null
      }
    }

    const updated = await projectRepository.update(projectId, data)
    const { owner, ...rest } = updated
    return {
      ...rest,
      ownerId: owner?.actor?.id ?? null,
    }
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

  /**
   * Reorder a workspace's projects. Caller must pass ids that all belong to
   * `workspaceId`; any mismatch throws 400. Publishes a pusher event so other
   * members' sidebars can re-sort in real time.
   *
   * @param workspaceId  DB id of the workspace (used for repo calls).
   * @param workspaceSlug  Workspace slug (= URL segment). Used as the Pusher
   *   channel key so clients can subscribe using the URL param they already
   *   have, without an id-resolution round-trip.
   * @param memberId  The caller's workspace member id (used to scope the
   *   visibility filter when resolving the workspace's project list).
   * @param orderedIds  The full list of project ids in the desired order.
   */
  async reorderProjects(
    workspaceId: string,
    workspaceSlug: string,
    memberId: string,
    orderedIds: string[]
  ) {
    if (orderedIds.length === 0) {
      throw Object.assign(new Error('orderedIds must not be empty'), {
        status: 400,
      })
    }

    const workspaceProjects = await projectRepository.findByWorkspace(
      workspaceId,
      memberId
    )
    const workspaceProjectIds = new Set(workspaceProjects.map(p => p.id))
    const unknownId = orderedIds.find(id => !workspaceProjectIds.has(id))
    if (unknownId) {
      throw Object.assign(
        new Error('One or more projects do not belong to this workspace'),
        { status: 400 }
      )
    }

    await projectRepository.reorder(workspaceId, orderedIds)

    await pushWorkspaceEvent(workspaceSlug, {
      type: 'projects-reordered',
      orderedIds,
    })
  },
}
