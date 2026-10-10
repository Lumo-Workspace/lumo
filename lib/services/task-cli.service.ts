import { projectRepository } from '@/lib/repositories/project.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { taskService } from '@/lib/services/task.service'
import { taskTemplateService } from '@/lib/services/task-template.service'
import { authService } from '@/lib/services/auth.service'
import { withMarkdown } from '@/lib/services/task-rendering'
import { slugify } from '@/lib/utils/slugify'
import { enforceSessionBinding } from '@/lib/services/session-binding-guard'
import {
  classifyTaskCreateIntent,
  isInFlightStatus,
  type BoundTaskRef,
} from '@/lib/services/task-create-binding'
import type { TaskPriority } from '@prisma/client'
import { resolvePublicUrl } from '@/lib/utils/public-url'
import {
  computeNextSteps,
  type NextStep,
  type TaskStatusForNextSteps,
} from '@/lib/context/render/next-steps'

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status })
}

const reworkRedirectMessage = (target: string): string =>
  `This belongs on ${target}. Fix it in place on ${target} instead of opening a new task for ${target}'s own scope.`

const mustDeclareMessage = (identifier: string, title: string): string =>
  `You're working on ${identifier} ("${title}"). If this defect is rework of ${identifier}, fix it in place there — pass \`--rework-of ${identifier}\`. If it's genuinely new, separate work, pass \`--new-scope\`.`

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

async function createFromCli(args: {
  workspaceId: string
  workspaceSlug: string
  callerClerkId: string
  memberId?: string | null
  sessionId?: string | null
  input: {
    title: string
    description?: string | null | undefined
    priority: TaskPriority
    projectRef?: string | undefined
    assigneeRef?: string | undefined
    milestoneRef?: string | undefined
    tagIds?: string[] | undefined
    reworkOfRef?: string | undefined
    newScope?: boolean | undefined
    dueDate?: string | undefined
    templateKey?: string | undefined
  }
}): Promise<{
  id: string
  identifier: string
  title: string
  url: string
  teamId: string
  taskTags: Array<{ id: string; name: string }>
  nextSteps: NextStep[]
}> {
  const { workspaceId, workspaceSlug, callerClerkId, input } = args

  // LUM-686: whether this session already carries a binding. A bound session
  // must NOT be told to attach — the binding is a lifetime lock and a second
  // attach is refused with 409.
  let sessionAlreadyBound = false

  // Layer 1: force an explicit intent. --rework-of always redirects (the work
  // belongs on the existing task); otherwise a mid-task binding forces a
  // --new-scope declaration. The binding lookup only runs when a session is
  // present. The bearer/CLI path is the only caller here, so the human/web
  // red line needs no extra guard.
  // Phase 3: when a mid-flight --new-scope create is allowed, the parent task
  // id is captured here so the spinoff can be recorded after B is created.
  let spinoffParentTaskId: string | null = null
  {
    let boundTask: BoundTaskRef | null = null
    let boundTaskId: string | null = null
    if (args.sessionId && args.memberId) {
      const bound = await sessionRepository.findForMemberWithBinding(
        args.sessionId,
        args.memberId
      )
      if (bound?.task) {
        sessionAlreadyBound = true
        boundTaskId = bound.task.id
        boundTask = {
          identifier: `${bound.task.team.identifier}-${bound.task.number}`,
          title: bound.task.title,
          status: bound.task.status,
        }
      }
    }

    const intent = classifyTaskCreateIntent({
      boundTask,
      reworkOf: input.reworkOfRef,
      newScope: input.newScope ?? false,
    })

    if (intent.kind === 'redirect-rework') {
      throw httpError(409, reworkRedirectMessage(intent.target))
    }
    if (intent.kind === 'must-declare') {
      throw httpError(
        409,
        mustDeclareMessage(intent.boundIdentifier, intent.boundTitle)
      )
    }

    // Allowed past the gate: if this was a --new-scope spinoff from an in-flight
    // bound task, remember the parent for the Phase 3 audit record below.
    if (boundTask && boundTaskId && isInFlightStatus(boundTask.status)) {
      spinoffParentTaskId = boundTaskId
    }
  }

  // LUM-970: --template pre-fills the description with the template's
  // Markdown (normalized to HTML by createTask like any CLI description).
  let description = input.description ?? null
  if (input.templateKey !== undefined) {
    if (description !== null && description.trim() !== '') {
      throw httpError(400, 'Pass either --description or --template, not both')
    }
    description = await taskTemplateService.resolveContent(
      workspaceId,
      input.templateKey,
      { memberId: args.memberId ?? null }
    )
  }

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

  const { task, taskTags } = await taskService.createTask(
    projectId,
    {
      title: input.title,
      description,
      status: 'TODO',
      priority: input.priority,
      assigneeActorId,
      milestoneId,
      ...(input.tagIds !== undefined ? { tagIds: input.tagIds } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
    },
    callerActor.id,
    callerClerkId
  )

  const identifier = `${task.teamIdentifier}-${task.number}`
  const url = `${resolvePublicUrl()}/workspace/${workspaceSlug}/my-tasks/${identifier}`

  // Phase 3 (LUM-511): record the A→B spinoff on the parent. Audit-only — a
  // recording failure must never break task creation.
  if (spinoffParentTaskId) {
    try {
      await activityRepository.create({
        taskId: spinoffParentTaskId,
        actorId: callerActor.id,
        type: 'TASK_SPUN_OFF',
        payload: {
          spunOffTaskId: task.id,
          spunOffIdentifier: identifier,
          sessionId: args.sessionId ?? null,
        },
      })
    } catch (err) {
      console.error('TASK_SPUN_OFF record error:', err)
    }
  }

  return {
    id: task.id,
    identifier,
    title: task.title,
    url,
    teamId: task.teamId,
    taskTags,
    // A brand-new task: no crossings yet — the only unknown is whether this session can still be attached.
    nextSteps: computeNextSteps({
      taskIdentifier: identifier,
      status: 'TODO',
      sessionBound: sessionAlreadyBound,
      openCrossings: 0,
    }),
  }
}

async function updateFromCli(args: {
  workspaceId: string
  workspaceSlug: string
  callerClerkId: string
  identifier: string
  /**
   * Claude Code session id from the `X-Lumo-Session-Id` request header
   * (LUM-165). Validated here before being threaded into Layer 2 so a
   * stale or cross-workspace id never lands on a Memory.sourceSessionId FK.
   */
  sourceSessionId?: string | null | undefined
  input: {
    title?: string | undefined
    description?: string | null | undefined
    status?:
      | 'BACKLOG'
      | 'TODO'
      | 'IN_PROGRESS'
      | 'IN_REVIEW'
      | 'DONE'
      | undefined
    priority?: TaskPriority | undefined
    assigneeRef?: string | null | undefined
    milestoneRef?: string | null | undefined
    claimable?: boolean | undefined
    tagIds?: string[] | undefined
    addTagIds?: string[] | undefined
    removeTagIds?: string[] | undefined
    dueDate?: string | null | undefined
  }
}): Promise<{
  id: string
  identifier: string
  title: string
  url: string
  taskTags: Array<{ id: string; name: string }>
  /** Post-update status — the route needs it to compute next steps (LUM-686). */
  status: TaskStatusForNextSteps
}> {
  const {
    workspaceId,
    workspaceSlug,
    callerClerkId,
    identifier,
    sourceSessionId,
    input,
  } = args

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
    status?: 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE'
    priority?: TaskPriority
    assigneeActorId?: string | null
    milestoneId?: string | null
    claimable?: boolean
    tagIds?: string[]
    addTagIds?: string[]
    removeTagIds?: string[]
    dueDate?: string | null
  } = {}
  if (input.title !== undefined) updateInput.title = input.title
  if ('description' in input)
    updateInput.description = input.description ?? null
  if (input.status !== undefined) updateInput.status = input.status
  if (input.priority !== undefined) updateInput.priority = input.priority
  if (assigneeActorId !== undefined)
    updateInput.assigneeActorId = assigneeActorId
  if (milestoneId !== undefined) updateInput.milestoneId = milestoneId
  if (input.claimable !== undefined) updateInput.claimable = input.claimable
  if (input.tagIds !== undefined) updateInput.tagIds = input.tagIds
  if (input.addTagIds !== undefined) updateInput.addTagIds = input.addTagIds
  if (input.removeTagIds !== undefined)
    updateInput.removeTagIds = input.removeTagIds
  if ('dueDate' in input && input.dueDate !== undefined)
    updateInput.dueDate = input.dueDate

  // LUM-491: a status transition is "doing the task". Enforce the session-binding
  // lock at this work boundary — a session bound to a different task is refused
  // (409, mirroring LUM-459); a provably-unbound session records a MEDIUM crossing
  // and proceeds (the DONE gate then catches it). Bearer-only route → source bearer.
  // LUM-640: steward sessions PASS here — task update is a governance action
  // (planning/dispatch); the one steward-specific refusal is below.
  if (updateInput.status !== undefined) {
    const { steward } = await enforceSessionBinding({
      source: 'bearer',
      sessionId: sourceSessionId ?? null,
      memberId: callerMember.id,
      targetTaskId: resolved.id,
      action: 'status change',
      stewardPolicy: 'allow-governance',
    })
    // LUM-640: a steward may dispatch work to OTHERS, but taking a task into
    // IN_PROGRESS with itself as the effective assignee is implementation-by-
    // another-name — refused. The effective assignee is the one this update
    // lands on: the incoming assignee when the call sets it, else the current.
    if (steward && updateInput.status === 'IN_PROGRESS') {
      const effectiveAssigneeActorId =
        updateInput.assigneeActorId !== undefined
          ? updateInput.assigneeActorId
          : (detail.assignee?.id ?? null)
      if (effectiveAssigneeActorId === callerActor.id) {
        throw httpError(
          409,
          `This session is a STEWARD (governance) session for milestone "${steward.milestoneName}" (LUM-640) — it cannot move ${identifier} to in_progress assigned to itself. Dispatch the task to an implementation owner, or start a new Claude Code session and run \`lumo session attach ${identifier}\`.`
        )
      }
    }
  }

  // Only forward the session id once we've confirmed it's a real session in
  // this workspace. A bogus/cross-workspace id would otherwise either fail
  // the Memory FK (rolling back the whole Layer 2 batch) or attribute a
  // promoted memory to someone else's session. Drop to null on any mismatch.
  let validatedSessionId: string | null = null
  if (sourceSessionId) {
    const session = await sessionRepository.findWorkspaceId(sourceSessionId)
    if (session?.workspaceId === workspaceId) {
      validatedSessionId = sourceSessionId
    }
  }

  const result = await taskService.updateTaskWithSideEffects(
    resolved.id,
    updateInput,
    detail,
    callerActor.id,
    callerClerkId,
    validatedSessionId
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

  const taskTags = (
    result.task.tags as Array<{
      id: string
      name: string
      color: string | null
    }>
  ).map(t => ({ id: t.id, name: t.name }))

  return {
    id: result.task.id,
    identifier: identOut,
    title: result.task.title,
    url,
    taskTags,
    // Surfaced, not acted on: next-step state reads belong off this write path
    // (they broke every partial-prisma mock when they lived here), so the route
    // composes them via nextStepsService instead.
    status: (result.task as unknown as { status: TaskStatusForNextSteps })
      .status,
  }
}

export interface ShowTaskFromCliResult {
  id: string
  identifier: string
  title: string
  status: string
  priority: string
  description: string | null
  descriptionMarkdown: string | null
  url: string
  sprintId: string | null
  teamId: string
  project: { id: string; name: string }
  assignee: {
    type: 'member' | 'agent'
    label: string
    email: string | null
  } | null
  /**
   * LUM-731: linked PRs with their synced state, so `lumo task update
   * --status done` can show which ones are not merged before asking for
   * confirmation. `getTaskDetail` refreshes open PRs from GitHub first.
   */
  pullRequests: Array<{
    number: number
    title: string | null
    url: string | null
    state: string | null
    /** LUM-825: the PR's current head commit; null when never synced. */
    headSha: string | null
  }>
  /** LUM-821: due instant (local midnight of the due day) or null. */
  dueDate: string | null
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
      // A Clerk lookup failure (user deleted in Clerk, Clerk outage) must not
      // turn into "task not found" — Clerk's 404 used to surface as the
      // route's own 404. The label degrades instead (LUM-821 e2e finding).
      const profile = await authService
        .fetchUserProfile(detail.assignee.member.clerkId)
        .catch(() => null)
      assignee = profile
        ? {
            type: 'member',
            label: profile.name || profile.email,
            email: profile.email || null,
          }
        : { type: 'member', label: '(unknown member)', email: null }
    } else if (detail.assignee.type === 'AGENT' && detail.assignee.agent) {
      assignee = {
        type: 'agent',
        label: detail.assignee.agent.name,
        email: null,
      }
    }
  }

  return withMarkdown({
    id: detail.id,
    identifier: resolved.identifier,
    title: detail.title,
    status: detail.status,
    priority: detail.priority,
    description: detail.description,
    url,
    sprintId: detail.sprintId ?? null,
    teamId: detail.teamId,
    project: { id: detail.project.id, name: detail.project.name },
    assignee,
    pullRequests: detail.pullRequests.map(pr => ({
      number: pr.number,
      title: pr.title,
      url: pr.url,
      state: pr.state,
      headSha: pr.headSha ?? null,
    })),
    dueDate: detail.dueDate ? new Date(detail.dueDate).toISOString() : null,
  })
}

/**
 * LUM-821 / LUM-918: delete a task by identifier (CLI `task delete`). The CLI
 * gates this behind the exit-4 confirmation envelope; the task moves to the
 * trash, restorable for 30 days.
 */
async function deleteFromCli(args: {
  workspaceId: string
  identifier: string
  clerkId: string
}): Promise<{ identifier: string; title: string }> {
  const resolved = await taskService.resolveIdentifier(
    args.workspaceId,
    args.identifier
  )
  if (!resolved) throw httpError(404, `Task ${args.identifier} not found`)
  await taskService.deleteTask(resolved.id, args.clerkId)
  return { identifier: resolved.identifier, title: resolved.title }
}

export const taskCliService = {
  resolveProjectId,
  resolveAssigneeActorId,
  createFromCli,
  updateFromCli,
  showFromCli,
  deleteFromCli,
}
