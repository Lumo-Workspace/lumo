/**
 * LUM-1096 — data for the Slack `/lumo` and `@Lumo` commands.
 *
 * lib/integrations/slack/commands.ts parses the command and formats the reply;
 * everything that reads or writes Lumo data goes through here (and the
 * repositories below), so the Slack layer never touches Prisma.
 */
import { slackCommandRepository } from '@/lib/repositories/slack-command.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { buildTaskIdentifier } from '@/lib/utils/buildTaskUrl'
import type { AuthUser } from '@/lib/auth/users'
import type { TaskPriority, TaskStatus } from '@prisma/client'

/** A task as the Slack replies show it — flat, no nested relations. */
export interface SlackTaskSummary {
  id: string
  identifier: string
  number: number
  title: string
  status: TaskStatus
  priority: TaskPriority
  projectId: string
  /** `null` when the task has no project (the link then avoids `/projects//`). */
  projectName: string | null
  teamIdentifier: string
  workspaceSlug: string
}

export interface SlackTaskDetail extends SlackTaskSummary {
  /** Display name of the assignee, `null` when unassigned. */
  assigneeName: string | null
}

/** A workspace member matched from a Slack user. */
export interface SlackLinkedMember {
  memberId: string
  /** The member's auth-provider user id (the web/API `actorClerkId`). */
  clerkId: string
  /** `null` if the member has no actor row (cannot be assigned). */
  actorId: string | null
  name: string
}

export type SlackCreateTaskResult =
  | { kind: 'team_not_found'; teamIdentifier: string }
  | { kind: 'no_project'; teamIdentifier: string }
  | { kind: 'created'; task: SlackTaskSummary }

const TASK_IDENTIFIER_REGEX = /^([A-Za-z]{1,10})-(\d+)$/

interface TaskRow {
  id: string
  number: number
  title: string
  status: TaskStatus
  priority: TaskPriority
  projectId: string
  project: { name: string } | null
  team: { identifier: string; workspace: { slug: string } }
}

function toSummary(row: TaskRow): SlackTaskSummary {
  return {
    id: row.id,
    identifier: buildTaskIdentifier(row.team.identifier, row.number),
    number: row.number,
    title: row.title,
    status: row.status,
    priority: row.priority,
    projectId: row.projectId,
    projectName: row.project?.name || null,
    teamIdentifier: row.team.identifier,
    workspaceSlug: row.team.workspace.slug,
  }
}

function displayName(
  user: {
    firstName: string | null
    lastName: string | null
    username: string | null
  },
  email: string
): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
  return full || user.username || email.split('@')[0] || email
}

async function assigneeNameOf(
  assignee: {
    type: string
    memberId: string | null
    externalIdentity: string | null
    agent: { name: string } | null
  } | null
): Promise<string | null> {
  if (!assignee) return null
  if (assignee.agent?.name) return assignee.agent.name
  if (assignee.memberId) {
    const labels = await memberRepository.labelsByIds([assignee.memberId])
    return labels.get(assignee.memberId) ?? null
  }
  if (assignee.externalIdentity) {
    return assignee.externalIdentity.replace(/^github:/, '')
  }
  return null
}

/**
 * Apply a task write through the shared task update service — the one the
 * web `PATCH /api/tasks/[id]` and CLI `PATCH /api/tasks/by-identifier` call.
 * Those routes authorize "active member of the task's workspace"; the Slack
 * caller is already an active member of the install's workspace
 * (`findMemberByEmail`) and the task was looked up inside it.
 */
async function updateAsMember(
  workspaceId: string,
  taskId: string,
  input: { status?: 'DONE' | 'IN_REVIEW'; assigneeActorId?: string },
  caller: Pick<SlackLinkedMember, 'actorId' | 'clerkId'>
): Promise<void> {
  const taskCheck = await slackCommandRepository.findTaskForUpdate(
    workspaceId,
    taskId
  )
  if (!taskCheck) {
    throw Object.assign(new Error('Task not found'), { status: 404 })
  }
  // Dynamic import: task-state pulls the lineage / memory / plugin chains,
  // which the Slack command tests (and the reply-only paths) don't need.
  const { updateTaskWithSideEffects } =
    await import('@/lib/services/task-state.service')
  await updateTaskWithSideEffects(
    taskId,
    input,
    taskCheck,
    caller.actorId,
    caller.clerkId
  )
}

/** Directory users one email can match (it is unique per user in practice). */
const EMAIL_MATCH_LIMIT = 10

/**
 * Users whose primary email is `email` (trimmed and lower-cased; `asGiven`
 * is the trimmed original spelling), in
 * ONE directory call filtered by email (LUM-1115) — either provider behind
 * `@/lib/auth/users` supports the `emailAddress` filter. The filter matches
 * any of a user's addresses, so the primary-address check stays here.
 */
async function usersWithPrimaryEmail(
  email: string,
  asGiven: string
): Promise<Array<{ user: AuthUser; primaryEmail: string }>> {
  const { createUserDirectory } = await import('@/lib/auth/users')
  const directory = await createUserDirectory()
  // Both spellings in the same call, in case a provider's filter is
  // case-sensitive and stored the address as Slack reports it.
  const { data } = await directory.getUserList({
    emailAddress: [...new Set([email, asGiven])],
    limit: EMAIL_MATCH_LIMIT,
  })
  return data.flatMap(user => {
    const primary = user.emailAddresses.find(
      e => e.id === user.primaryEmailAddressId
    )
    // Email addresses are case-insensitive in practice (Slack and the
    // directory may store different casing).
    return primary?.emailAddress.toLowerCase() === email
      ? [{ user, primaryEmail: primary.emailAddress }]
      : []
  })
}

export const slackCommandService = {
  /**
   * The active member whose primary email is `email`, or `null`. One
   * email-filtered directory call finds the user(s) (LUM-1115 — previously
   * every member's profile was fetched, 100 ids per call), then one query
   * keeps those that are active members here. With several matches the
   * first in member order wins.
   */
  async findMemberByEmail(
    workspaceId: string,
    email: string
  ): Promise<SlackLinkedMember | null> {
    const trimmed = email.trim()
    const wanted = trimmed.toLowerCase()
    if (!wanted) return null
    const matches = await usersWithPrimaryEmail(wanted, trimmed)
    if (matches.length === 0) return null
    const byId = new Map(matches.map(m => [m.user.id, m]))
    const members = await slackCommandRepository.listActiveMembersByClerkIds(
      workspaceId,
      [...byId.keys()]
    )
    for (const member of members) {
      const match = byId.get(member.clerkId)
      if (!match) continue
      return {
        memberId: member.id,
        clerkId: member.clerkId,
        actorId: member.actor?.id ?? null,
        // Lumo's own record, never the Slack-supplied string.
        name: displayName(match.user, match.primaryEmail),
      }
    }
    return null
  },

  /** A task by its `TEAM-123` identifier, or `null` if there is none. */
  async findTask(
    workspaceId: string,
    identifier: string
  ): Promise<SlackTaskDetail | null> {
    const match = identifier.match(TASK_IDENTIFIER_REGEX)
    if (!match) return null
    const team = await slackCommandRepository.findTeamByIdentifier(
      workspaceId,
      match[1]!.toUpperCase()
    )
    if (!team) return null
    const row = await slackCommandRepository.findTaskByNumber(
      workspaceId,
      team.id,
      parseInt(match[2]!, 10)
    )
    if (!row) return null
    return {
      ...toSummary(row),
      assigneeName: await assigneeNameOf(row.assignee),
    }
  },

  /**
   * Move a task to DONE / IN_REVIEW as `caller` (LUM-1102).
   *
   * Goes through the same service entry as the web and CLI task update
   * (`updateTaskWithSideEffects`): status-machine validation, the DONE gate,
   * activity events and the `task.statusChanged` core event. Slack has no
   * "confirm past the soft prompt" step, so — like the CLI — it never sets
   * `overrideDoneGate`: an open DONE blocker refuses the move (409).
   *
   * Throws `{ status }` errors from the shared service; the caller turns a
   * 4xx into a reply only the caller sees.
   */
  async setStatus(
    workspaceId: string,
    taskId: string,
    to: 'DONE' | 'IN_REVIEW',
    caller: Pick<SlackLinkedMember, 'actorId' | 'clerkId'>
  ): Promise<void> {
    await updateAsMember(workspaceId, taskId, { status: to }, caller)
  },

  /**
   * Assign a task as `caller`, through the same service entry as the web and
   * CLI (assignee-in-workspace validation, activity, notifications).
   */
  async assign(
    workspaceId: string,
    taskId: string,
    assigneeActorId: string,
    caller: Pick<SlackLinkedMember, 'actorId' | 'clerkId'>
  ): Promise<void> {
    await updateAsMember(workspaceId, taskId, { assigneeActorId }, caller)
  },

  /**
   * Create a task in the team's most recently updated project, numbered from
   * the team's atomic sequence (LUM-920).
   */
  async createTask(
    workspaceId: string,
    teamIdentifier: string,
    title: string,
    /** LUM-1283: the linked Slack member, recorded as the creator. */
    creatorMemberId: string
  ): Promise<SlackCreateTaskResult> {
    const team = await slackCommandRepository.findTeamByIdentifier(
      workspaceId,
      teamIdentifier
    )
    if (!team) return { kind: 'team_not_found', teamIdentifier }

    const project = await slackCommandRepository.findLatestProjectForTeam(
      workspaceId,
      team.id
    )
    if (!project) return { kind: 'no_project', teamIdentifier: team.identifier }

    // createWithSequence also applies the task storage redaction, so the
    // reply echoes the stored title rather than the raw input.
    const created = await taskRepository.createWithSequence({
      workspaceId,
      projectId: project.id,
      teamId: team.id,
      title,
      description: null,
      status: 'TODO',
      priority: 'MEDIUM',
      assigneeActorId: null,
      createdByMemberId: creatorMemberId,
      agentStatus: null,
      order: 0,
      dueDate: null,
    })
    return {
      kind: 'created',
      task: toSummary({
        id: created.id,
        number: created.number,
        title: created.title,
        status: created.status,
        priority: created.priority,
        projectId: project.id,
        project: { name: project.name },
        team: {
          identifier: team.identifier,
          workspace: { slug: team.workspace.slug },
        },
      }),
    }
  },

  /** The actor's open tasks (first `limit`) and how many there are in all. */
  async listOpenTasks(
    workspaceId: string,
    actorId: string,
    limit: number
  ): Promise<{ tasks: SlackTaskSummary[]; total: number }> {
    const { tasks, total } =
      await slackCommandRepository.listOpenTasksForAssignee(
        workspaceId,
        actorId,
        limit
      )
    return { tasks: tasks.map(toSummary), total }
  },
}
