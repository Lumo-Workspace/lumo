import { listUsersByIds } from '@/lib/auth/user-batch'
import { projectRepository } from '@/lib/repositories/project.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { privateFileRepository } from '@/lib/repositories/private-file.repository'
import { privateFileService } from '@/lib/services/private-file.service'
import { getDefaultTeam } from '@/lib/team'
import { pushWorkspaceEvent } from '@/lib/integrations/pusher/server'
import { getActorClerkId } from '@/lib/actor'
import { buildProjectUrl } from '@/lib/utils/buildProjectUrl'
import { notifyMentionDelta } from '@/lib/services/mention-notify.service'
import { waitUntil } from '@/lib/runtime/wait-until'
import type { ProjectStatus } from '@prisma/client'
import {
  isProjectCompleted,
  isValidProjectDateWindow,
} from '@/shared/src/project-lifecycle'

// ── Types ───────────────────────────────────────────────────────────────────

export interface UpdateProjectInput {
  name?: string | undefined
  description?: string | null | undefined
  isIdea?: boolean | undefined
  ownerId?: string | null | undefined
  /** LUM-1285: human ruling — the CLI gates it behind a confirmation. */
  status?: ProjectStatus | undefined
  startDate?: Date | null | undefined
  targetDate?: Date | null | undefined
  /** true stamps archivedAt (kept if already archived); false clears it. */
  archived?: boolean | undefined
}

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Resolve a project by id inside the caller's own workspace. The member row
 * fixes the workspace, then the project is read scoped to it (LUM-979), so a
 * foreign id reads as missing — same two queries as a load-then-compare.
 * Routes that already validate membership upfront get this as a redundant
 * pass; bearer-token / MCP / agent flows that hand a raw projectId to the
 * service rely on it as their primary defense.
 *
 * Throws 404 (not 403) so the existence of foreign projects doesn't leak
 * through the error code.
 */
async function findProjectInMemberWorkspace(
  projectId: string,
  memberId: string
) {
  const member = await memberRepository.findById(memberId)
  const project = member
    ? await projectRepository.findById(projectId, member.workspaceId)
    : null
  if (!project) {
    throw Object.assign(new Error('Project not found'), { status: 404 })
  }
  return project
}

// ── Project Service ─────────────────────────────────────────────────────────

export const projectService = {
  /** List projects with permission filtering, status counts, and Clerk-resolved owner name. */
  async listProjects(workspaceId: string, memberId: string) {
    const [projects, statusCounts] = await Promise.all([
      projectRepository.findByWorkspace(workspaceId, memberId),
      projectRepository.countTasksByStatus(workspaceId, memberId),
    ])

    // Batch-resolve owner display names from Clerk (one call for all owners).
    const clerkIds = Array.from(
      new Set(
        projects.map(p => p.owner?.clerkId).filter((c): c is string => !!c)
      )
    )
    const nameByClerkId = new Map<string, string>()
    if (clerkIds.length > 0) {
      const { getUserDirectory } = await import('@/lib/auth/users')
      const clerk = await getUserDirectory()
      const users = await listUsersByIds(clerk, clerkIds)
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
        BACKLOG: 0,
        TODO: 0,
        IN_PROGRESS: 0,
        IN_REVIEW: 0,
        DONE: 0,
      }
      const { owner, ...rest } = p
      // Owner ids exposed to the API are actor ids — the same id space the
      // UI's OwnerSelect uses for project owner. The DB stores
      // WorkspaceMember.id on the FK; we translate via the joined `actor` row.
      const ownerActorId = owner?.actor?.id ?? null
      return {
        ...rest,
        ownerId: ownerActorId,
        todoCount: counts.TODO,
        inProgressCount: counts.IN_PROGRESS,
        inReviewCount: counts.IN_REVIEW,
        doneCount: counts.DONE,
        // LUM-1285: derived for display only — never stored.
        completed: isProjectCompleted(counts),
        owner:
          owner && ownerActorId
            ? {
                id: ownerActorId,
                name: nameByClerkId.get(owner.clerkId) ?? 'Unknown',
              }
            : null,
      }
    })
  },

  /** Get a single project. Throws 404 if not found, if the caller belongs to
   * a different workspace, or if the project is an idea draft not owned by
   * the caller. The workspace check is the primary defense for bearer-token
   * and MCP callers that don't validate workspace membership at the route
   * layer — see `findProjectInMemberWorkspace`. */
  async getProject(projectId: string, memberId: string) {
    const project = await findProjectInMemberWorkspace(projectId, memberId)

    if (project.isIdea && project.createdByMemberId !== memberId) {
      throw Object.assign(new Error('Project not found'), { status: 404 })
    }

    return project
  },

  /**
   * Create a new project. Uses getDefaultTeam(). Publishes a `project-created`
   * pusher event so other workspace members' (and other tabs') sidebars can
   * refresh — same pattern as `reorderProjects`.
   */
  async createProject(
    workspaceId: string,
    workspaceSlug: string,
    memberId: string,
    data: {
      name: string
      description?: string | undefined
      isIdea?: boolean | undefined
    }
  ) {
    const defaultTeam = await getDefaultTeam(workspaceId)
    // Tie-tolerant: two concurrent creates reading the same max are fine —
    // findByWorkspace sorts by (order ASC, name ASC), so a shared order
    // value simply falls back to the name tiebreaker.
    const maxOrder = await projectRepository.maxOrderInWorkspace(workspaceId)

    const project = await projectRepository.create({
      workspaceId,
      teamId: defaultTeam!.id,
      createdByMemberId: memberId,
      name: data.name,
      description: data.description,
      isIdea: data.isIdea,
      order: maxOrder + 1,
    })

    // Non-idea projects are visible to every member; idea drafts are private
    // to the creator and the sidebar filters them out anyway, so there's no
    // point broadcasting them. The event echoes back to the creator's own tab
    // too, which is how the sidebar hook (independent state from WorkspaceApp)
    // learns about the new project.
    if (!project.isIdea) {
      await pushWorkspaceEvent(workspaceSlug, {
        type: 'project-created',
        projectId: project.id,
      })
    }

    return project
  },

  /**
   * Update a project. Validates idea edit permission and owner workspace
   * membership. `input.ownerId` is interpreted as an Actor.id (the
   * same id space the UI's OwnerSelect uses for project owner); the service
   * resolves it to the underlying WorkspaceMember.id for storage and
   * translates the response back to actor.id for the UI.
   */
  async updateProject(
    projectId: string,
    workspaceSlug: string,
    memberId: string,
    input: UpdateProjectInput
  ) {
    const project = await findProjectInMemberWorkspace(projectId, memberId)

    if (project.isIdea && project.createdByMemberId !== memberId) {
      throw Object.assign(new Error('Forbidden'), { status: 403 })
    }

    const data: import('@/lib/repositories/project.repository').ProjectUpdateData =
      {}
    if (input.name !== undefined) data.name = input.name
    if (input.description !== undefined) data.description = input.description
    if (input.isIdea !== undefined) data.isIdea = input.isIdea
    if (input.status !== undefined) data.status = input.status
    if (input.startDate !== undefined) data.startDate = input.startDate
    if (input.targetDate !== undefined) data.targetDate = input.targetDate
    // The window is checked against the stored side too, so a lone --target
    // before the existing start is refused as well.
    const nextStart =
      input.startDate !== undefined ? input.startDate : project.startDate
    const nextTarget =
      input.targetDate !== undefined ? input.targetDate : project.targetDate
    if (!isValidProjectDateWindow(nextStart, nextTarget)) {
      throw Object.assign(
        new Error('Target date must be on or after the start date'),
        { status: 400 }
      )
    }
    if (input.archived !== undefined) {
      if (!input.archived) data.archivedAt = null
      else if (!project.archivedAt) data.archivedAt = new Date()
    }
    if (input.ownerId !== undefined) {
      if (input.ownerId !== null) {
        const ownerMember = await memberRepository.findByActorId(input.ownerId)
        if (!ownerMember || ownerMember.workspaceId !== project.workspaceId) {
          throw Object.assign(
            new Error('Owner is not a member of this workspace'),
            { status: 400 }
          )
        }
        data.ownerId = ownerMember.id
      } else {
        data.ownerId = null
      }
    }

    const oldDescription = project.description
    const updated = await projectRepository.update(
      projectId,
      project.workspaceId,
      data
    )

    // Broadcast so other members / tabs can pick up the change. Idea drafts
    // are private to the creator, so don't broadcast those.
    if (!updated.isIdea) {
      await pushWorkspaceEvent(workspaceSlug, {
        type: 'project-updated',
        projectId: updated.id,
      })
    }

    // Notify users newly @-mentioned in the project description (delta only).
    // Resolution + send is fully fire-and-forget so a lookup failure never
    // breaks the save — nothing notify-related is awaited on the path to return.
    if (input.description !== undefined) {
      const newHtml = input.description
      waitUntil(
        (async () => {
          const authorActor =
            await memberRepository.findActorByMemberId(memberId)
          const [authorClerkId, ws] = await Promise.all([
            authorActor
              ? getActorClerkId(authorActor.id)
              : Promise.resolve(null),
            workspaceRepository.findNameAndSlug(project.workspaceId),
          ])
          if (authorActor?.id && authorClerkId && ws?.slug) {
            const projectUrl = buildProjectUrl(ws.slug, updated.name)
            await notifyMentionDelta({
              oldHtml: oldDescription ?? '',
              newHtml,
              authorClerkId,
              authorActorId: authorActor.id,
              workspaceId: project.workspaceId,
              notificationType: 'PROJECT_MENTIONED',
              ref: { projectId: project.id },
              slackEvent: 'comment_mention',
              slackPayload: {
                entityKind: 'project',
                entityId: project.id,
                entityTitle: updated.name,
                entityUrl: projectUrl,
                mentionSurface: 'content',
              },
              waitUntil,
            })
          }
        })().catch(() => {})
      )
    }

    const { owner, ...rest } = updated
    return {
      ...rest,
      ownerId: owner?.actor?.id ?? null,
    }
  },

  /** Delete a project. Validates workspace scoping and idea delete permission. */
  async deleteProject(
    projectId: string,
    workspaceSlug: string,
    memberId: string
  ) {
    const project = await findProjectInMemberWorkspace(projectId, memberId)

    if (project.isIdea && project.createdByMemberId !== memberId) {
      throw Object.assign(new Error('Forbidden'), { status: 403 })
    }

    // Tasks cascade with the project; their evidence blobs do not (LUM-916).
    const evidenceTaskIds =
      await privateFileRepository.findTaskIdsWithTestCasesInProject(projectId)
    const evidenceMilestoneIds =
      await privateFileRepository.findMilestoneIdsWithTestCasesInProject(
        projectId
      )
    await projectRepository.delete(projectId, project.workspaceId)
    await privateFileService.deleteTaskEvidence(evidenceTaskIds)
    await privateFileService.deleteMilestoneEvidence(evidenceMilestoneIds)

    // Idea drafts are private to the creator — only the creator's own tab
    // needs to react, and that tab already did so optimistically.
    if (!project.isIdea) {
      await pushWorkspaceEvent(workspaceSlug, {
        type: 'project-deleted',
        projectId,
      })
    }
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

    // Uses findByWorkspace, which applies member visibility (public + own
    // ideas). A member cannot reorder a project they can't see; the generic
    // error message below intentionally avoids leaking the existence of
    // someone else's idea project.
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
