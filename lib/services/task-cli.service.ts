import { projectRepository } from '@/lib/repositories/project.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { taskService } from '@/lib/services/task.service'
import { authService } from '@/lib/services/auth.service'
import { slugify } from '@/lib/utils/slugify'
import type { TaskPriority } from '@prisma/client'

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status })
}

/**
 * Resolve a `--project <ref>` argument to a project id within a workspace.
 * Matches case-insensitively against the project's name OR its slugified
 * name (the same form the web UI uses in URLs). When ref is omitted, picks
 * the single non-idea project, or throws with a candidate list.
 */
async function resolveProjectId(
  workspaceId: string,
  projectRef: string | undefined
): Promise<string> {
  const projects = await projectRepository.findByWorkspaceNonIdea(workspaceId)
  if (projects.length === 0) {
    throw httpError(
      400,
      'Workspace has no projects. Create one in the web UI first.'
    )
  }

  const candidates = projects.map(p => slugify(p.name)).join(', ')

  if (!projectRef) {
    if (projects.length === 1) return projects[0]!.id
    throw httpError(
      400,
      `Workspace has multiple projects. Use --project <name>.\nAvailable: ${candidates}`
    )
  }

  const ref = projectRef.trim().toLowerCase()
  const refSlug = slugify(projectRef)
  const matches = projects.filter(
    p => p.name.toLowerCase() === ref || slugify(p.name) === refSlug
  )
  if (matches.length === 1) return matches[0]!.id
  if (matches.length === 0) {
    throw httpError(
      400,
      `no project matches "${projectRef}".\nAvailable: ${candidates}`
    )
  }
  throw httpError(
    400,
    `multiple projects match "${projectRef}". Use a more specific name.`
  )
}

/**
 * Resolve a `--milestone <ref>` argument to a milestone id within a project.
 * Matches case-insensitively against the milestone name. Returns null on
 * empty / undefined ref. Throws 400 when the name is not found.
 */
async function resolveMilestoneId(
  projectId: string,
  milestoneRef: string | undefined
): Promise<string | null> {
  if (!milestoneRef) return null
  const milestones = await milestoneRepository.findByProject(projectId)
  const ref = milestoneRef.trim().toLowerCase()
  const match = milestones.find(m => m.name.toLowerCase() === ref)
  if (!match) {
    throw httpError(
      400,
      `no milestone matches "${milestoneRef}" in this project. Try \`lumo milestone list\`.`
    )
  }
  return match.id
}

async function resolveAssigneeActorId(args: {
  workspaceId: string
  callerClerkId: string
  assigneeRef: string | undefined
}): Promise<string> {
  const { workspaceId, callerClerkId, assigneeRef } = args
  const isMe = !assigneeRef || assigneeRef.trim().toLowerCase() === 'me'

  if (isMe) {
    const member = await memberRepository.findByWorkspaceAndClerkId(
      workspaceId,
      callerClerkId
    )
    if (!member) {
      throw httpError(400, 'Caller is not a member of this workspace')
    }
    const actor = await memberRepository.findActorByMemberId(member.id)
    if (!actor) {
      throw httpError(
        500,
        'Member has no actor row — workspace data is inconsistent'
      )
    }
    return actor.id
  }

  const ref = assigneeRef!.trim().toLowerCase()
  const candidates =
    await memberRepository.findAllWithProfilesForCli(workspaceId)

  const byEmail = candidates.filter(c => c.email.toLowerCase() === ref)
  if (byEmail.length === 1) return byEmail[0]!.actorId
  if (byEmail.length > 1) {
    const list = byEmail.map(c => c.email).join(', ')
    throw httpError(400, `multiple members match "${assigneeRef}": ${list}`)
  }

  const byName = candidates.filter(c => c.displayName.toLowerCase() === ref)
  if (byName.length === 1) return byName[0]!.actorId
  if (byName.length > 1) {
    const list = byName.map(c => c.email).join(', ')
    throw httpError(400, `multiple members match "${assigneeRef}": ${list}`)
  }

  throw httpError(400, `no member matches "${assigneeRef}".`)
}

const DEFAULT_PUBLIC_URL = 'https://www.uselumo.ai'

function resolvePublicUrl(): string {
  const v = process.env.LUMO_PUBLIC_URL?.trim()
  return v && v.length > 0 ? v.replace(/\/+$/, '') : DEFAULT_PUBLIC_URL
}

async function createFromCli(args: {
  workspaceId: string
  workspaceSlug: string
  callerClerkId: string
  input: {
    title: string
    description?: string | null | undefined
    priority: TaskPriority
    projectRef?: string | undefined
    assigneeRef?: string | undefined
    milestoneRef?: string | undefined
  }
}): Promise<{ id: string; identifier: string; title: string; url: string }> {
  const { workspaceId, workspaceSlug, callerClerkId, input } = args

  const projectId = await resolveProjectId(workspaceId, input.projectRef)
  const assigneeActorId = await resolveAssigneeActorId({
    workspaceId,
    callerClerkId,
    assigneeRef: input.assigneeRef,
  })
  const milestoneId = await resolveMilestoneId(projectId, input.milestoneRef)

  // We need the caller's own actor id to attribute the create activity.
  // For assigneeRef === "me" this is identical to assigneeActorId; for
  // other refs we still need it, so resolve via the caller's member row.
  const callerMember = await memberRepository.findByWorkspaceAndClerkId(
    workspaceId,
    callerClerkId
  )
  if (!callerMember) {
    throw httpError(400, 'Caller is not a member of this workspace')
  }
  const callerActor = await memberRepository.findActorByMemberId(
    callerMember.id
  )
  if (!callerActor) {
    throw httpError(
      500,
      'Member has no actor row — workspace data is inconsistent'
    )
  }

  const { task } = await taskService.createTask(
    projectId,
    {
      title: input.title,
      description: input.description ?? null,
      status: 'TODO',
      priority: input.priority,
      assigneeActorId,
      milestoneId,
    },
    callerActor.id,
    callerClerkId
  )

  const identifier = `${task.teamIdentifier}-${task.number}`
  const url = `${resolvePublicUrl()}/workspace/${workspaceSlug}/my-tasks/${identifier}`

  return { id: task.id, identifier, title: task.title, url }
}

async function updateFromCli(args: {
  workspaceId: string
  workspaceSlug: string
  callerClerkId: string
  identifier: string
  input: {
    title?: string | undefined
    description?: string | null | undefined
    status?: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE' | undefined
    priority?: TaskPriority | undefined
    assigneeRef?: string | null | undefined
    milestoneRef?: string | null | undefined
  }
}): Promise<{ id: string; identifier: string; title: string; url: string }> {
  const { workspaceId, workspaceSlug, callerClerkId, identifier, input } = args

  const resolved = await taskService.resolveIdentifier(workspaceId, identifier)
  if (!resolved) {
    throw httpError(404, `Task ${identifier} not found`)
  }

  const detail = await taskService.getTaskDetail(resolved.id)
  if (!detail) {
    throw httpError(404, `Task ${identifier} not found`)
  }

  // Resolve assignee:
  //   undefined → field absent → don't touch
  //   null      → clear
  //   string    → resolve via ref helper
  let assigneeActorId: string | null | undefined = undefined
  if ('assigneeRef' in input) {
    if (input.assigneeRef === null) {
      assigneeActorId = null
    } else if (input.assigneeRef !== undefined) {
      assigneeActorId = await resolveAssigneeActorId({
        workspaceId,
        callerClerkId,
        assigneeRef: input.assigneeRef,
      })
    }
  }

  // Resolve milestone (same tri-state as assigneeRef).
  let milestoneId: string | null | undefined = undefined
  if ('milestoneRef' in input) {
    if (input.milestoneRef === null) {
      milestoneId = null
    } else if (input.milestoneRef !== undefined) {
      milestoneId = await resolveMilestoneId(
        detail.projectId,
        input.milestoneRef
      )
    }
  }

  const callerMember = await memberRepository.findByWorkspaceAndClerkId(
    workspaceId,
    callerClerkId
  )
  if (!callerMember) {
    throw httpError(400, 'Caller is not a member of this workspace')
  }
  const callerActor = await memberRepository.findActorByMemberId(
    callerMember.id
  )
  if (!callerActor) {
    throw httpError(
      500,
      'Member has no actor row — workspace data is inconsistent'
    )
  }

  const updateInput: {
    title?: string
    description?: string | null
    status?: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE'
    priority?: TaskPriority
    assigneeActorId?: string | null
    milestoneId?: string | null
  } = {}
  if (input.title !== undefined) updateInput.title = input.title
  if ('description' in input)
    updateInput.description = input.description ?? null
  if (input.status !== undefined) updateInput.status = input.status
  if (input.priority !== undefined) updateInput.priority = input.priority
  if (assigneeActorId !== undefined)
    updateInput.assigneeActorId = assigneeActorId
  if (milestoneId !== undefined) updateInput.milestoneId = milestoneId

  const result = await taskService.updateTaskWithSideEffects(
    resolved.id,
    updateInput,
    detail,
    callerActor.id,
    callerClerkId
  )

  const teamIdentifier =
    (
      result.task as unknown as {
        teamIdentifier?: string
        team?: { identifier: string }
      }
    ).teamIdentifier ??
    (result.task as unknown as { team: { identifier: string } }).team.identifier
  const number = (result.task as unknown as { number: number }).number
  const identOut = `${teamIdentifier}-${number}`
  const url = `${resolvePublicUrl()}/workspace/${workspaceSlug}/my-tasks/${identOut}`

  return {
    id: result.task.id,
    identifier: identOut,
    title: result.task.title,
    url,
  }
}

export interface ShowTaskFromCliResult {
  id: string
  identifier: string
  title: string
  status: string
  priority: string
  description: string | null
  url: string
  project: { id: string; name: string }
  assignee: {
    type: 'member' | 'agent'
    label: string
    email: string | null
  } | null
}

async function showFromCli(args: {
  workspaceId: string
  workspaceSlug: string
  identifier: string
}): Promise<ShowTaskFromCliResult> {
  const { workspaceId, workspaceSlug, identifier } = args

  const resolved = await taskService.resolveIdentifier(workspaceId, identifier)
  if (!resolved) {
    throw httpError(404, `Task ${identifier} not found`)
  }

  const detail = await taskService.getTaskDetail(resolved.id)
  if (!detail) {
    throw httpError(404, `Task ${identifier} not found`)
  }

  const url = `${resolvePublicUrl()}/workspace/${workspaceSlug}/my-tasks/${resolved.identifier}`

  // Member display name comes from Clerk, not the DB — fetch it on demand
  // so the CLI can render "Assignee: Alice <alice@example.com>". Agent
  // assignees already carry their display name in the DB.
  let assignee: ShowTaskFromCliResult['assignee'] = null
  if (detail.assignee) {
    if (detail.assignee.type === 'HUMAN' && detail.assignee.member) {
      const profile = await authService.fetchUserProfile(
        detail.assignee.member.clerkId
      )
      assignee = {
        type: 'member',
        label: profile.name || profile.email,
        email: profile.email || null,
      }
    } else if (detail.assignee.type === 'AGENT' && detail.assignee.agent) {
      assignee = {
        type: 'agent',
        label: detail.assignee.agent.name,
        email: null,
      }
    }
  }

  return {
    id: detail.id,
    identifier: resolved.identifier,
    title: detail.title,
    status: detail.status,
    priority: detail.priority,
    description: detail.description,
    url,
    project: { id: detail.project.id, name: detail.project.name },
    assignee,
  }
}

export const taskCliService = {
  resolveProjectId,
  resolveAssigneeActorId,
  createFromCli,
  updateFromCli,
  showFromCli,
}
