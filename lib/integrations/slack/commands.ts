/**
 * Slack `/lumo` and `@Lumo` command handling (LUM-1096).
 *
 * Parses the command, asks lib/services/slack-command.service for the data and
 * formats the reply with the LUM-1094 Block Kit helpers. No Prisma here.
 *
 * Every reply decides its `visibility`: errors, usage hints, "not linked" and
 * help are `ephemeral`; results worth sharing are `in_channel`. Every
 * user-controlled value is escaped with `escapeMrkdwn` (LUM-928).
 *
 * LUM-1097: replies are posted in a channel, so they are written in the
 * workspace's default language (`slack.msg.cmd.*` catalogue keys). The
 * command words themselves (`status`, `create "…" in TEAM`) stay English —
 * they are what the parser reads.
 */
import { logger } from '@/lib/logger'
import {
  slackCommandService,
  type SlackLinkedMember,
  type SlackTaskDetail,
  type SlackTaskSummary,
} from '@/lib/services/slack-command.service'
import { slackLocaleService } from '@/lib/services/slack-locale.service'
import { buildMyTasksUrl, buildTaskUrl } from '@/lib/utils/buildTaskUrl'
import type { CommandResult } from './types'
import { escapeMrkdwn } from './mrkdwn'
import {
  actionsBlock,
  contextBlock,
  headerBlock,
  linkButton,
  openInLumoLabel,
  priorityLabel,
  sectionBlock,
  slackMessage,
  statusLabel,
  statusName,
} from './blocks'
import {
  DEFAULT_SLACK_LOCALE,
  slackMrkdwn,
  slackText,
  type SlackLocale,
} from './i18n'

/** How many tasks `my-tasks` lists before pointing to Lumo for the rest. */
export const MY_TASKS_LIMIT = 5

/** The "View all in Lumo" button label in `locale`. */
export function viewAllInLumoLabel(
  locale: SlackLocale = DEFAULT_SLACK_LOCALE
): string {
  return slackText(locale, 'msg.viewAllInLumo')
}

export const VIEW_ALL_IN_LUMO_LABEL = viewAllInLumoLabel()

/** `code`-formatted mrkdwn of a literal (escaped). */
function code(literal: string): string {
  return `\`${escapeMrkdwn(literal)}\``
}

/** Command usage → catalogue key of its one-line summary. */
const COMMANDS: ReadonlyArray<[usage: string, summaryKey: string]> = [
  ['status ENG-123', 'msg.cmd.help.status'],
  ['assign ENG-123 @user', 'msg.cmd.help.assign'],
  ['done ENG-123', 'msg.cmd.help.done'],
  ['in-review ENG-123', 'msg.cmd.help.inReview'],
  ['create "title" in TEAM', 'msg.cmd.help.create'],
  ['my-tasks', 'msg.cmd.help.myTasks'],
]

function notLinkedReply(locale: SlackLocale): CommandResult {
  return ephemeral(slackMrkdwn(locale, 'msg.cmd.notLinked'))
}

function createUsageReply(locale: SlackLocale): CommandResult {
  return ephemeral(
    slackMrkdwn(locale, 'msg.cmd.createUsage', {
      usage: code('create "title" in TEAM'),
      example: code('create "Fix bug" in ENG'),
    })
  )
}

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
function taskSection(task: SlackTaskSummary, locale: SlackLocale): object {
  return sectionBlock(
    `*${heading(task)}*\n${statusLabel(task.status, locale)} · ${priorityLabel(task.priority, locale)}`,
    linkButton(taskUrl(task), openInLumoLabel(locale))
  )
}

export function helpReply(
  locale: SlackLocale = DEFAULT_SLACK_LOCALE
): CommandResult {
  const lines = COMMANDS.map(
    ([usage, summaryKey]) =>
      `• ${code(usage)} — ${slackMrkdwn(locale, summaryKey)}`
  )
  return blocksReply(
    slackMrkdwn(locale, 'msg.cmd.help.fallback', {
      commands: COMMANDS.map(([usage]) => escapeMrkdwn(usage)).join(', '),
    }),
    [
      headerBlock(slackText(locale, 'msg.cmd.help.title')),
      sectionBlock(lines.join('\n')),
      contextBlock([
        slackMrkdwn(locale, 'msg.cmd.help.hint', {
          slash: code('/lumo <command>'),
          mention: code('@Lumo <command>'),
        }),
      ]),
    ],
    'ephemeral'
  )
}

export function statusReply(
  task: SlackTaskDetail,
  locale: SlackLocale = DEFAULT_SLACK_LOCALE
): CommandResult {
  const assignee = task.assigneeName
    ? escapeMrkdwn(task.assigneeName)
    : slackMrkdwn(locale, 'msg.cmd.unassigned')
  const status = statusLabel(task.status, locale)
  const priority = priorityLabel(task.priority, locale)
  const meta = [
    slackMrkdwn(locale, 'msg.cmd.statusField', { status }),
    slackMrkdwn(locale, 'msg.cmd.priorityField', { priority }),
    slackMrkdwn(locale, 'msg.cmd.assigneeField', { assignee }),
    task.projectName
      ? slackMrkdwn(locale, 'msg.cmd.projectField', {
          project: escapeMrkdwn(task.projectName),
        })
      : '',
  ]
  return blocksReply(
    `${heading(task)} — ${status} · ${priority} · ${assignee}`,
    [
      sectionBlock(
        `*${heading(task)}*`,
        linkButton(taskUrl(task), openInLumoLabel(locale))
      ),
      contextBlock(meta),
    ]
  )
}

export function statusChangedReply(
  task: SlackTaskSummary,
  to: 'DONE' | 'IN_REVIEW',
  locale: SlackLocale = DEFAULT_SLACK_LOCALE
): CommandResult {
  const status = statusLabel(to, locale)
  return blocksReply(
    slackMrkdwn(locale, 'msg.cmd.moved', { task: heading(task), status }),
    [
      sectionBlock(
        slackMrkdwn(locale, 'msg.cmd.moved', {
          task: `*${heading(task)}*`,
          status,
        }),
        linkButton(taskUrl(task), openInLumoLabel(locale))
      ),
    ]
  )
}

export function assignedReply(
  task: SlackTaskSummary,
  assigneeName: string,
  locale: SlackLocale = DEFAULT_SLACK_LOCALE
): CommandResult {
  const name = escapeMrkdwn(assigneeName)
  return blocksReply(
    slackMrkdwn(locale, 'msg.cmd.assigned', { task: heading(task), name }),
    [
      sectionBlock(
        slackMrkdwn(locale, 'msg.cmd.assigned', {
          task: `*${heading(task)}*`,
          name: `*${name}*`,
        }),
        linkButton(taskUrl(task), openInLumoLabel(locale))
      ),
    ]
  )
}

export function createdReply(
  task: SlackTaskSummary,
  locale: SlackLocale = DEFAULT_SLACK_LOCALE
): CommandResult {
  return blocksReply(
    `✅ ${slackMrkdwn(locale, 'msg.cmd.created', { task: heading(task) })}`,
    [
      sectionBlock(
        `✅ ${slackMrkdwn(locale, 'msg.cmd.created', { task: `*${heading(task)}*` })}`,
        linkButton(taskUrl(task), openInLumoLabel(locale))
      ),
    ]
  )
}

export function myTasksReply(
  tasks: SlackTaskSummary[],
  total: number,
  locale: SlackLocale = DEFAULT_SLACK_LOCALE
): CommandResult {
  const first = tasks[0]
  if (!first) {
    return {
      type: 'text',
      text: slackMrkdwn(locale, 'msg.cmd.noOpenTasks'),
      visibility: 'ephemeral',
    }
  }
  const count =
    total > tasks.length
      ? slackMrkdwn(locale, 'msg.cmd.showingOf', { shown: tasks.length, total })
      : slackMrkdwn(locale, 'msg.cmd.openTaskCount', { total })
  const title = slackText(locale, 'msg.cmd.openTasksTitle')
  return blocksReply(
    `${escapeMrkdwn(title)} (${count}): ${tasks.map(heading).join(', ')}`,
    [
      headerBlock(title),
      ...tasks.map(task => taskSection(task, locale)),
      contextBlock([count]),
      actionsBlock([
        linkButton(
          buildMyTasksUrl(first.workspaceSlug),
          viewAllInLumoLabel(locale)
        ),
      ]),
    ],
    // Personal data: only the person who asked sees it.
    'ephemeral'
  )
}

/** Echoes the user's own argument back — escaped so it stays literal text. */
function taskNotFound(identifier: string, locale: SlackLocale): CommandResult {
  return ephemeral(
    slackMrkdwn(locale, 'msg.cmd.taskNotFound', { task: code(identifier) })
  )
}

/**
 * Run a task write. When the shared task service refuses it (a 4xx — e.g.
 * the DONE gate's 409 or an invalid status transition), returns a reply only
 * the caller sees, carrying the service's reason; `null` when it went through.
 * Anything else propagates to the generic error reply.
 */
async function refusedWrite(
  locale: SlackLocale,
  action: string,
  write: () => Promise<void>
): Promise<CommandResult | null> {
  try {
    await write()
    return null
  } catch (error) {
    const status = (error as { status?: unknown } | null)?.status
    if (
      typeof status === 'number' &&
      status >= 400 &&
      status < 500 &&
      error instanceof Error
    ) {
      // `action` is escaped mrkdwn; the service's reason is escaped here.
      return ephemeral(
        slackMrkdwn(locale, 'msg.cmd.refused', {
          action,
          reason: escapeMrkdwn(error.message),
        })
      )
    }
    throw error
  }
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
  // Never throws: a failed lookup falls back to English.
  const locale = await slackLocaleService.forWorkspace(workspaceId)

  try {
    // ── status ENG-123 ──────────────────────────────────────────────────────
    if (cmd === 'status' && arg) {
      // Task details are workspace data: only linked Lumo members may read them.
      const member = await resolveSlackUser(
        slackUserId,
        slackToken,
        workspaceId
      )
      if (!member) return notLinkedReply(locale)
      const task = await slackCommandService.findTask(workspaceId, arg)
      return task ? statusReply(task, locale) : taskNotFound(arg, locale)
    }

    // ── done ENG-123 / in-review ENG-123 ───────────────────────────────────
    if ((cmd === 'done' || cmd === 'in-review') && arg) {
      const member = await resolveSlackUser(
        slackUserId,
        slackToken,
        workspaceId
      )
      if (!member) return notLinkedReply(locale)

      const task = await slackCommandService.findTask(workspaceId, arg)
      if (!task) return taskNotFound(arg, locale)

      const to = cmd === 'done' ? 'DONE' : 'IN_REVIEW'
      const refused = await refusedWrite(
        locale,
        slackMrkdwn(locale, 'msg.cmd.actionMove', {
          task: escapeMrkdwn(task.identifier),
          status: escapeMrkdwn(statusName(to, locale)),
        }),
        () => slackCommandService.setStatus(workspaceId, task.id, to, member)
      )
      return refused ?? statusChangedReply(task, to, locale)
    }

    // ── assign ENG-123 @user ────────────────────────────────────────────────
    if (cmd === 'assign' && arg && parts[2]) {
      const member = await resolveSlackUser(
        slackUserId,
        slackToken,
        workspaceId
      )
      if (!member) return notLinkedReply(locale)

      const task = await slackCommandService.findTask(workspaceId, arg)
      if (!task) return taskNotFound(arg, locale)

      // parts[2] is a Slack mention like <@U123456> or <@U123456|displayname>
      const mentionMatch = parts[2].match(/^<@([^|>]+)/)
      if (!mentionMatch)
        return ephemeral(slackMrkdwn(locale, 'msg.cmd.invalidUser'))

      const target = await resolveSlackUser(
        mentionMatch[1]!,
        slackToken,
        workspaceId
      )
      if (!target?.actorId)
        return ephemeral(slackMrkdwn(locale, 'msg.cmd.targetNotLinked'))

      const assigneeActorId = target.actorId
      const refused = await refusedWrite(
        locale,
        slackMrkdwn(locale, 'msg.cmd.actionAssign', {
          task: escapeMrkdwn(task.identifier),
        }),
        () =>
          slackCommandService.assign(
            workspaceId,
            task.id,
            assigneeActorId,
            member
          )
      )
      return refused ?? assignedReply(task, target.name, locale)
    }

    // ── create "title" in TEAM ──────────────────────────────────────────────
    if (cmd === 'create') {
      // Validate format before resolving user for a faster error response
      const titleMatch = text.match(/create\s+"([^"]+)"\s+in\s+([A-Za-z]+)/i)
      if (!titleMatch) return createUsageReply(locale)

      const member = await resolveSlackUser(
        slackUserId,
        slackToken,
        workspaceId
      )
      if (!member) return notLinkedReply(locale)

      const result = await slackCommandService.createTask(
        workspaceId,
        titleMatch[2]!.toUpperCase(),
        titleMatch[1]!
      )
      if (result.kind === 'team_not_found')
        return ephemeral(
          slackMrkdwn(locale, 'msg.cmd.teamNotFound', {
            team: code(result.teamIdentifier),
          })
        )
      if (result.kind === 'no_project')
        return ephemeral(
          slackMrkdwn(locale, 'msg.cmd.teamNoProject', {
            team: code(result.teamIdentifier),
          })
        )
      return createdReply(result.task, locale)
    }

    // ── my-tasks ────────────────────────────────────────────────────────────
    if (cmd === 'my-tasks') {
      const member = await resolveSlackUser(
        slackUserId,
        slackToken,
        workspaceId
      )
      if (!member) return notLinkedReply(locale)
      // No actor row → nothing can be assigned to them (and an unscoped
      // `assigneeActorId: null` filter would list unassigned tasks instead).
      if (!member.actorId) return myTasksReply([], 0, locale)

      const { tasks, total } = await slackCommandService.listOpenTasks(
        workspaceId,
        member.actorId,
        MY_TASKS_LIMIT
      )
      return myTasksReply(tasks, total, locale)
    }

    // ── unknown command / help ─────────────────────────────────────────────
    return helpReply(locale)
  } catch (error) {
    logger.error('[slack command] error:', error)
    return ephemeral(slackMrkdwn(locale, 'msg.cmd.error'))
  }
}
