/**
 * LUM-1234 — read-only queries behind the reward-hack judge's input: the
 * task's agent sessions with their events, the previous merge of the same
 * task (the session window's start), and the task-requirement text.
 *
 * Every query is scoped to the workspace as well as the task. Only stored
 * text is read — titles, summaries, bodies already in the database; no
 * external URL is fetched here.
 */
import type { HookEventType } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { logger } from '@/lib/logger'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { htmlToMarkdown } from '@/lib/utils/html-to-markdown'
import type {
  RhEvent,
  RhSession,
} from '@/ee/security/security-scan/reward-hack-input'

/**
 * Top-level sessions read per task. `listForTask` defaults to 20 (sized for
 * `task context`); a long task can have more, and a missed session is a
 * missed trajectory, so ask for far more than any task has had.
 */
export const RH_TASK_SESSION_LIMIT = 500

/** The event types the transcript renders (the rest are never read). */
const RH_EVENT_TYPES: HookEventType[] = [
  'USER_PROMPT_SUBMIT',
  'POST_TOOL_USE',
  'STOP',
]

function line(...parts: (string | null | undefined)[]): string {
  return parts
    .filter((s): s is string => !!s && s.trim().length > 0)
    .join(' — ')
}

function section(title: string, items: string[]): string | null {
  const kept = items.filter(s => s.trim().length > 0)
  if (kept.length === 0) return null
  return [`## ${title}`, ...kept.map(s => `- ${s}`)].join('\n')
}

export const rewardHackInputRepository = {
  /**
   * Explicit + inferred top-level sessions and subagent children of the
   * task, kept only when the session row is in `workspaceId`, each with its
   * prompt / tool-use / stop events in time order.
   */
  async loadTaskSessions(
    workspaceId: string,
    taskId: string
  ): Promise<RhSession[]> {
    const [top, children] = await Promise.all([
      sessionRepository.listForTask(taskId, RH_TASK_SESSION_LIMIT),
      sessionRepository.listChildrenForTask(taskId),
    ])
    if (top.length >= RH_TASK_SESSION_LIMIT) {
      logger.warn('reward-hack input: task session limit reached', {
        taskId,
        limit: RH_TASK_SESSION_LIMIT,
      })
    }
    const candidateIds = [
      ...new Set([...top.map(s => s.id), ...children.map(s => s.id)]),
    ]
    if (candidateIds.length === 0) return []

    const inWorkspace = await prisma.session.findMany({
      where: { id: { in: candidateIds }, workspaceId },
      select: { id: true },
    })
    const allowed = new Set(inWorkspace.map(s => s.id))
    const ids = candidateIds.filter(id => allowed.has(id))
    if (ids.length === 0) return []

    const rows = await prisma.hookEvent.findMany({
      where: {
        workspaceId,
        sessionId: { in: ids },
        type: { in: RH_EVENT_TYPES },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        sessionId: true,
        type: true,
        toolName: true,
        payload: true,
        createdAt: true,
      },
    })
    const bySession = new Map<string, RhEvent[]>(ids.map(id => [id, []]))
    for (const r of rows) {
      if (!r.sessionId) continue
      bySession.get(r.sessionId)?.push({
        id: r.id,
        sessionId: r.sessionId,
        type: r.type,
        toolName: r.toolName,
        payload: r.payload,
        createdAt: r.createdAt,
      })
    }
    return ids.map(id => ({ id, events: bySession.get(id) ?? [] }))
  },

  /** Latest `mergedAt` of the task's OTHER PRs in the workspace; null if none. */
  async previousMergedAt(
    workspaceId: string,
    taskId: string,
    excludePrId: string
  ): Promise<Date | null> {
    const row = await prisma.pullRequest.findFirst({
      where: {
        workspaceId,
        taskId,
        id: { not: excludePrId },
        mergedAt: { not: null },
      },
      orderBy: { mergedAt: 'desc' },
      select: { mergedAt: true },
    })
    return row?.mergedAt ?? null
  },

  /**
   * The task-requirement text: title + description, Slack-thread summaries,
   * web links (title / description / note), Figma frames, workspace-visible
   * mentioned documents' summaries, and member comments. Raw, untrusted
   * text — the caller fences it. '' when the task is not in the workspace.
   *
   * Documents: only `visibility: WORKSPACE` ones — there is no viewing member
   * here, and a private doc must not reach a prompt whose evidence other
   * members may open. Comments: `USER` only — an agent's own comments are
   * claims about the work, not part of the contract it is judged against.
   */
  async loadRequirement(workspaceId: string, taskId: string): Promise<string> {
    const task = await prisma.task.findFirst({
      where: { id: taskId, workspaceId, deletedAt: null },
      select: { title: true, description: true },
    })
    if (!task) return ''
    const scoped = { taskId, workspaceId }
    const [slack, web, figma, docs, comments] = await Promise.all([
      prisma.taskSlackContext.findMany({
        where: scoped,
        orderBy: { createdAt: 'asc' },
        select: { slackChannelName: true, summary: true },
      }),
      prisma.taskWebLink.findMany({
        where: scoped,
        orderBy: { createdAt: 'asc' },
        select: { url: true, title: true, description: true, note: true },
      }),
      prisma.taskFigmaLink.findMany({
        where: scoped,
        orderBy: { createdAt: 'asc' },
        select: { fileName: true, frameName: true },
      }),
      prisma.documentMention.findMany({
        where: {
          taskId,
          document: { workspaceId, deletedAt: null, visibility: 'WORKSPACE' },
        },
        select: { document: { select: { title: true, summary: true } } },
      }),
      prisma.comment.findMany({
        where: { taskId, deletedAt: null, type: 'USER', task: { workspaceId } },
        orderBy: { createdAt: 'asc' },
        select: { body: true },
      }),
    ])

    const parts = [
      `# ${task.title}`,
      task.description ? htmlToMarkdown(task.description) : null,
      section(
        'Slack threads',
        slack.map(s =>
          line(s.slackChannelName ? `#${s.slackChannelName}` : null, s.summary)
        )
      ),
      section(
        'Linked pages',
        web.map(w => line(w.title ?? w.url, w.description, w.note))
      ),
      section(
        'Figma',
        figma.map(f => line(f.fileName, f.frameName))
      ),
      section(
        'Documents',
        docs.map(d => line(d.document.title, d.document.summary))
      ),
      section(
        'Comments',
        comments.map(c => htmlToMarkdown(c.body))
      ),
    ]
    return parts.filter((s): s is string => !!s).join('\n\n')
  },
}
