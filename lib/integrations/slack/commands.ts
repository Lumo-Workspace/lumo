/**
 * Slack `/lumo` and `@Lumo` command handling (LUM-1096).
 *
 * Parses the command, asks lib/services/slack-command.service for the data and
 * formats the reply with the LUM-1094 Block Kit helpers. No Prisma here.
 *
 * Every reply decides its `visibility`: errors, usage hints, "not linked" and
 * help are `ephemeral`; results worth sharing are `in_channel`. Every
 * user-controlled value is escaped with `escapeMrkdwn` (LUM-928).
 */
import { logger } from '@/lib/logger'
import {
  slackCommandService,
  type SlackLinkedMember,
  type SlackTaskDetail,
  type SlackTaskSummary,
} from '@/lib/services/slack-command.service'
import { buildMyTasksUrl, buildTaskUrl } from '@/lib/utils/buildTaskUrl'
import type { CommandResult } from './types'
import { escapeMrkdwn } from './mrkdwn'
import {
  actionsBlock,
  contextBlock,
  headerBlock,
  linkButton,
  priorityLabel,
  sectionBlock,
  slackMessage,
  statusLabel,
} from './blocks'

/** How many tasks `my-tasks` lists before pointing to Lumo for the rest. */
export const MY_TASKS_LIMIT = 5

export const VIEW_ALL_IN_LUMO_LABEL = 'View all in Lumo ↗'

const NOT_LINKED_TEXT =
  "Your Slack account isn't linked to a Lumo account in this workspace. Sign in to Lumo with the same email address you use in Slack."

const CREATE_USAGE_TEXT =
  'Usage: `create "title" in TEAM` (e.g. `create "Fix bug" in ENG`)'

const COMMANDS: ReadonlyArray<[usage: string, summary: string]> = [
  ['status ENG-123', 'show a task'],
  ['assign ENG-123 @user', 'assign a task'],
  ['done ENG-123', 'mark a task done'],
  ['in-review ENG-123', 'move a task to in review'],
  ['create "title" in TEAM', 'create a task'],
  ['my-tasks', 'list your open tasks'],
]

// ── Reply builders ─────────────────────────────────────────────────────────

function ephemeral(text: string): CommandResult {
  return { type: 'text', text, visibility: 'ephemeral' }
}

function blocksReply(
  text: string,
  blocks: object[],
  visibility: CommandResult['visibility'] = 'in_channel'
): CommandResult {
  return {
    type: 'blocks',
    text: slackMessage({ text }).text,
    blocks,
    visibility,
  }
}

/**
 * Link to a task: the canonical project URL, or the project-less My Tasks
 * route when the project name is missing (never `/projects//tasks/…`).
 */
export function taskUrl(
  task: Pick<
    SlackTaskSummary,
    'workspaceSlug' | 'projectName' | 'teamIdentifier' | 'number' | 'identifier'
  >
): string {
  return task.projectName
    ? buildTaskUrl(
        task.workspaceSlug,
        task.projectName,
        task.teamIdentifier,
        task.number
      )
    : buildMyTasksUrl(task.workspaceSlug, task.identifier)
}

/** `ENG-1 · Title`, escaped. */
function heading(task: Pick<SlackTaskSummary, 'identifier' | 'title'>) {
  return `${escapeMrkdwn(task.identifier)} · ${escapeMrkdwn(task.title)}`
}

/** One task's line: bold heading + status · priority, with an open button. */
function taskSection(task: SlackTaskSummary): object {
  return sectionBlock(
    `*${heading(task)}*\n${statusLabel(task.status)} · ${priorityLabel(task.priority)}`,
    linkButton(taskUrl(task))
  )
}

export function helpReply(): CommandResult {
  const lines = COMMANDS.map(
    ([usage, summary]) => `• \`${usage}\` — ${summary}`
  )
  return blocksReply(
    `Available commands: ${COMMANDS.map(([u]) => u.split(' ')[0]).join(', ')}`,
    [
      headerBlock('Lumo commands'),
      sectionBlock(lines.join('\n')),
      contextBlock([
        'Type `/lumo <command>`, or mention `@Lumo <command>` in a channel.',
      ]),
    ],
    'ephemeral'
  )
}

export function statusReply(task: SlackTaskDetail): CommandResult {
  const assignee = task.assigneeName
    ? escapeMrkdwn(task.assigneeName)
    : 'Unassigned'
  const meta = [
    `Status: ${statusLabel(task.status)}`,
    `Priority: ${priorityLabel(task.priority)}`,
    `Assignee: ${assignee}`,
    task.projectName ? `Project: ${escapeMrkdwn(task.projectName)}` : '',
  ]
  return blocksReply(
    `${heading(task)} — ${statusLabel(task.status)} · ${priorityLabel(task.priority)} · ${assignee}`,
    [
      sectionBlock(`*${heading(task)}*`, linkButton(taskUrl(task))),
      contextBlock(meta),
    ]
  )
}

export function statusChangedReply(
  task: SlackTaskSummary,
  to: 'DONE' | 'IN_REVIEW'
): CommandResult {
  const line = `moved to ${statusLabel(to)}`
  return blocksReply(`${heading(task)} ${line}`, [
    sectionBlock(`*${heading(task)}* ${line}`, linkButton(taskUrl(task))),
  ])
}

export function assignedReply(
  task: SlackTaskSummary,
  assigneeName: string
): CommandResult {
  const name = escapeMrkdwn(assigneeName)
  return blocksReply(`${heading(task)} assigned to ${name}`, [
    sectionBlock(
      `*${heading(task)}* assigned to *${name}*`,
      linkButton(taskUrl(task))
    ),
  ])
}

export function createdReply(task: SlackTaskSummary): CommandResult {
  return blocksReply(`✅ Created ${heading(task)}`, [
    sectionBlock(`✅ Created *${heading(task)}*`, linkButton(taskUrl(task))),
  ])
}

export function myTasksReply(
  ownerName: string,
  tasks: SlackTaskSummary[],
  total: number
): CommandResult {
  const first = tasks[0]
  if (!first) {
    return {
      type: 'text',
      text: 'You have no open tasks. 🎉',
      visibility: 'in_channel',
    }
  }
  const count =
    total > tasks.length
      ? `Showing ${tasks.length} of ${total} open tasks`
      : `${total} open ${total === 1 ? 'task' : 'tasks'}`
  const title = `${ownerName}'s open tasks`
  return blocksReply(
    `${escapeMrkdwn(title)} (${count}): ${tasks.map(heading).join(', ')}`,
    [
      headerBlock(title),
      ...tasks.map(taskSection),
      contextBlock([count]),
      actionsBlock([
        linkButton(
          buildMyTasksUrl(first.workspaceSlug),
          VIEW_ALL_IN_LUMO_LABEL
        ),
      ]),
    ]
  )
}

/** Echoes the user's own argument back — escaped so it stays literal text. */
function taskNotFound(identifier: string): CommandResult {
  return ephemeral(`Task \`${escapeMrkdwn(identifier)}\` not found.`)
}

// ── Slack user → Lumo member ───────────────────────────────────────────────

async function resolveSlackUser(
  slackUserId: string,
  slackToken: string,
  workspaceId: string
): Promise<SlackLinkedMember | null> {
  const res = await fetch(
    `https://slack.com/api/users.info?user=${encodeURIComponent(slackUserId)}`,
    { headers: { Authorization: `Bearer ${slackToken}` } }
  )
  const data = await res.json()
  if (!data.ok || !data.user?.profile?.email) return null
  return slackCommandService.findMemberByEmail(
    workspaceId,
    data.user.profile.email as string
  )
}

// ── Entry point ────────────────────────────────────────────────────────────

export async function handleCommand(
  text: string,
  slackUserId: string,
  slackToken: string,
  workspaceId: string
): Promise<CommandResult> {
  const parts = text.trim().split(/\s+/)
  const cmd = parts[0]?.toLowerCase()
  const arg = parts[1]

  try {
    // ── status ENG-123 ──────────────────────────────────────────────────────
    if (cmd === 'status' && arg) {
      const task = await slackCommandService.findTask(workspaceId, arg)
      return task ? statusReply(task) : taskNotFound(arg)
    }

    // ── done ENG-123 / in-review ENG-123 ───────────────────────────────────
    if ((cmd === 'done' || cmd === 'in-review') && arg) {
      const member = await resolveSlackUser(
        slackUserId,
        slackToken,
        workspaceId
      )
      if (!member) return ephemeral(NOT_LINKED_TEXT)

      const task = await slackCommandService.findTask(workspaceId, arg)
      if (!task) return taskNotFound(arg)

      const to = cmd === 'done' ? 'DONE' : 'IN_REVIEW'
      await slackCommandService.setStatus(task, to)
      return statusChangedReply(task, to)
    }

    // ── assign ENG-123 @user ────────────────────────────────────────────────
    if (cmd === 'assign' && arg && parts[2]) {
      const member = await resolveSlackUser(
        slackUserId,
        slackToken,
        workspaceId
      )
      if (!member) return ephemeral(NOT_LINKED_TEXT)

      const task = await slackCommandService.findTask(workspaceId, arg)
      if (!task) return taskNotFound(arg)

      // parts[2] is a Slack mention like <@U123456> or <@U123456|displayname>
      const mentionMatch = parts[2].match(/^<@([^|>]+)/)
      if (!mentionMatch)
        return ephemeral('Invalid user format. Mention the assignee with @.')

      const target = await resolveSlackUser(
        mentionMatch[1]!,
        slackToken,
        workspaceId
      )
      if (!target?.actorId)
        return ephemeral("That user doesn't have a linked Lumo account.")

      await slackCommandService.assign(workspaceId, task.id, target.actorId)
      return assignedReply(task, target.name)
    }

    // ── create "title" in TEAM ──────────────────────────────────────────────
    if (cmd === 'create') {
      // Validate format before resolving user for a faster error response
      const titleMatch = text.match(/create\s+"([^"]+)"\s+in\s+([A-Za-z]+)/i)
      if (!titleMatch) return ephemeral(CREATE_USAGE_TEXT)

      const member = await resolveSlackUser(
        slackUserId,
        slackToken,
        workspaceId
      )
      if (!member) return ephemeral(NOT_LINKED_TEXT)

      const result = await slackCommandService.createTask(
        workspaceId,
        titleMatch[2]!.toUpperCase(),
        titleMatch[1]!
      )
      if (result.kind === 'team_not_found')
        return ephemeral(
          `Team \`${escapeMrkdwn(result.teamIdentifier)}\` not found.`
        )
      if (result.kind === 'no_project')
        return ephemeral(
          `Team \`${escapeMrkdwn(result.teamIdentifier)}\` has no project to create the task in.`
        )
      return createdReply(result.task)
    }

    // ── my-tasks ────────────────────────────────────────────────────────────
    if (cmd === 'my-tasks') {
      const member = await resolveSlackUser(
        slackUserId,
        slackToken,
        workspaceId
      )
      if (!member) return ephemeral(NOT_LINKED_TEXT)
      // No actor row → nothing can be assigned to them (and an unscoped
      // `assigneeActorId: null` filter would list unassigned tasks instead).
      if (!member.actorId) return myTasksReply(member.name, [], 0)

      const { tasks, total } = await slackCommandService.listOpenTasks(
        workspaceId,
        member.actorId,
        MY_TASKS_LIMIT
      )
      return myTasksReply(member.name, tasks, total)
    }

    // ── unknown command / help ─────────────────────────────────────────────
    return helpReply()
  } catch (error) {
    logger.error('[slack command] error:', error)
    return ephemeral('Something went wrong. Please try again.')
  }
}
