import { taskRepository } from '@/lib/repositories/task.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { taskService } from '@/lib/services/task.service'
import { taskSlackContextRepository } from '@/lib/repositories/task-slack-context.repository'
import { taskWebLinkRepository } from '@/lib/repositories/task-web-link.repository'
import { taskArtifactRepository } from '@/lib/repositories/task-artifact.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { commentRepository } from '@/lib/repositories/comment.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { prCommentMirrorRepository } from '@/lib/repositories/pr-comment-mirror.repository'
import { actorRepository } from '@/lib/repositories/actor.repository'
import { taskFigmaLinkService } from '@/lib/services/task-figma-link.service'
import { scheduleDocumentSummary } from '@/lib/services/document.service'
import { waitUntil } from '@vercel/functions'
import type { TaskFigmaLink } from '@prisma/client'
import {
  renderSlackContextSection,
  renderWebLinkSection,
  renderFigmaSection,
  renderArtifactSection,
  renderDocumentSection,
  renderCommentsSection,
  renderPRSection,
  renderPrReviewTodosSection,
  slackBudgetSection,
  webLinkBudgetSection,
  figmaBudgetSection,
  prBudgetSection,
  type ReviewTodoItem,
  type SlackContextCard,
  type WebLinkCard,
  type PRCard,
} from '@/lib/context/render'
import {
  stripPrMirrorHeader,
  REVIEW_HEADER,
} from '@/lib/integrations/github/markdown-bridge'
import {
  applyTokenBudget,
  renderMemorySection,
  renderLayer2ReviewSection,
  wrapUntrustedMemory,
  memoryBudgetSection,
  wrapUntrustedLinked,
  type RenderableMemory,
} from '@/lib/memory/render'
import { allocateBudget } from '@/lib/context/budget'
import { htmlToMarkdown } from '@/lib/utils/markdown'

export interface SessionContext {
  id: string
  startedAt: string
  lastActivityAt: string
  durationMs: number
  eventCount: number
  summaryType: string | null
  headline: string
  unresolved: string[]
}

export interface PreviousSessionRecovery {
  headline: string
  unresolved: string[]
  durationMs: number
  lastActivityAt: string
}

export interface TaskContext {
  task: {
    id: string
    identifier: string
    title: string
    status: string
    description: string | null
    descriptionMarkdown: string | null
    milestone: {
      id: string
      name: string
      status: 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
      targetDate: string | null
      description: string | null
    } | null
  }
  /**
   * Pre-rendered "## Relevant Memory" markdown block, already trimmed to a
   * token budget. Empty string when the task has no relevant memory. The CLI
   * inlines this verbatim — keeping render server-side avoids duplicating
   * memory-shape knowledge in the CLI bundle.
   */
  memorySection: string
  /** Pre-rendered "## Slack Context" markdown; empty when no contexts attached. */
  slackContextSection: string
  /** Pre-rendered "## Web Links" markdown; empty when no links attached. */
  webLinkSection: string
  /** Pre-rendered "## Figma Designs" markdown; empty when no links attached. */
  figmaSection: string
  /** Pre-rendered artifact section (## [kind] title + content); empty when none. */
  artifactSection: string
  /** Pre-rendered "## Documents" markdown; empty when none mentioned. */
  docSection: string
  /** Pre-rendered "## Comments" markdown; empty when none. */
  commentsSection: string
  /** Pre-rendered "## Pull Requests" markdown; empty when none. */
  prSection: string
  /** Pre-rendered "## PR Review 待办" markdown; empty when no review comments. */
  prReviewTodosSection: string
  sessions: SessionContext[]
}

const NO_SUMMARY = '(no summary)'

/**
 * One-line synthesis of a session summary. Preference order matches the
 * session-summary type templates: goal > overview > problem > refactorGoal >
 * reviewScope. All types expose at least one of these, so falling through
 * the list covers every shape the classifier produces.
 */
function summaryHeadline(summary: unknown): string {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    return NO_SUMMARY
  }
  const s = summary as Record<string, unknown>
  for (const key of [
    'goal',
    'overview',
    'problem',
    'refactorGoal',
    'reviewScope',
  ] as const) {
    const value = s[key]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return NO_SUMMARY
}

/** Keep only the non-empty string entries of a possibly-untyped array. */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((x): x is string => typeof x === 'string' && x.length > 0)
}

/**
 * The debug template carries its pending signal as a status enum rather than a
 * list (fixed | partial | unresolved). Surface the `problem` so the next agent
 * knows what's still open; `fixed` produces nothing.
 */
function debugPending(s: Record<string, unknown>): string[] {
  const status = s.status
  if (status !== 'unresolved' && status !== 'partial') return []
  const prefix = status === 'unresolved' ? 'Bug 未解决' : 'Bug 仅部分修复'
  const problem = typeof s.problem === 'string' ? s.problem.trim() : ''
  return [problem.length > 0 ? `${prefix}：${problem}` : prefix]
}

/**
 * Pull the pending/follow-up items from a structured summary, mapped by
 * `summaryType`. Each session-summary template expresses "what's still open"
 * in a different field, so we route on the type:
 *   - implementation / mixed → `unresolved`
 *   - exploration            → `nextSteps`
 *   - refactor               → `followUps`
 *   - review                 → `severity.critical` (blocking issues only)
 *   - debug                  → `status` enum → a synthesized line (see {@link debugPending})
 * Unknown or null types fall back to `unresolved`, preserving the original
 * Day-7 behavior ("直接用 summary.unresolved"). Non-string / empty entries are
 * always dropped.
 */
function summaryUnresolved(
  summary: unknown,
  summaryType?: string | null
): string[] {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    return []
  }
  const s = summary as Record<string, unknown>
  switch (summaryType) {
    case 'exploration':
      return stringList(s.nextSteps)
    case 'refactor':
      return stringList(s.followUps)
    case 'review': {
      const severity = s.severity
      if (
        !severity ||
        typeof severity !== 'object' ||
        Array.isArray(severity)
      ) {
        return []
      }
      return stringList((severity as Record<string, unknown>).critical)
    }
    case 'debug':
      return debugPending(s)
    case 'implementation':
    case 'mixed':
    default:
      return stringList(s.unresolved)
  }
}

const FIGMA_STALE_MS = 25 * 24 * 3600 * 1000

function scheduleLazyRefresh(
  links: TaskFigmaLink[],
  workspaceId: string,
  taskId: string
): void {
  const stale = links.some(
    l =>
      l.thumbnailFetchedAt === null ||
      Date.now() - l.thumbnailFetchedAt.getTime() > FIGMA_STALE_MS
  )
  if (!stale) return
  // Use the auto variant: lazy refresh shouldn't depend on the context
  // viewer having a personal Figma integration. Any workspace member with a
  // live integration can drive it.
  waitUntil(
    taskFigmaLinkService
      .refreshLinksForTaskAuto({ taskId, workspaceId })
      .catch(() => {})
  )
}

/** A mentioned document as shaped by miscRepository.findDocumentsForContext. */
interface ContextDocument {
  id: string
  title: string
  updatedAt: Date
  summary: string | null
  summaryGeneratedAt: Date | null
  content: string | null
}

/**
 * A document's cached summary is stale when it was never generated, or when
 * the body was edited after the summary was produced. Mirrors the Figma
 * `scheduleLazyRefresh` pattern: we still serve the old summary this call and
 * regenerate in the background.
 */
function isDocumentSummaryStale(doc: ContextDocument): boolean {
  if (doc.summaryGeneratedAt === null) return true
  return doc.updatedAt.getTime() > doc.summaryGeneratedAt.getTime()
}

/**
 * Schedule a background summary refresh for every stale mentioned document,
 * reusing the document service's exact scheduling path (which runs under
 * `waitUntil` and swallows errors). We convert the stored HTML body to
 * markdown for the LLM, matching how the document service feeds create/update.
 */
function scheduleStaleDocumentSummaries(docs: ContextDocument[]): void {
  for (const doc of docs) {
    if (!isDocumentSummaryStale(doc)) continue
    if (!doc.content) continue
    const bodyText = htmlToMarkdown(doc.content)
    if (bodyText.trim().length > 0) scheduleDocumentSummary(doc.id, bodyText)
  }
}

/**
 * Reduce a mirrored comment's stored HTML body to a single line of plain text
 * for a todo entry: drop the pr-mirror header block (the file:line / review
 * label is rendered separately), strip tags, decode the handful of entities
 * that survive, and collapse all whitespace so the bullet stays on one line.
 */
function mirrorBodyToText(html: string): string {
  return stripPrMirrorHeader(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** Global session-start injection budget shared by memory + linked resources. */
const SESSION_START_BUDGET_TOKENS = 2500

export const taskContextService = {
  /**
   * Build the "## Relevant Memory" markdown block for a given task.
   *
   * Fetches both task-scope and project-scope memories, orders them
   * (project first — broader applicability, survive task archival), applies
   * the token budget, and delegates rendering to renderMemorySection.
   *
   * Returns an empty string when the task doesn't exist or has no memories.
   */
  async buildMemorySectionForTask(taskId: string): Promise<string> {
    const task = await taskRepository.findById(taskId)
    if (!task) return ''

    const [taskMemories, projectMemories] = await Promise.all([
      memoryRepository.findActiveTaskMemories(taskId),
      memoryRepository.findActiveProjectMemories(task.projectId),
    ])

    // Project memories first (broader applicability, survive task archival),
    // then task memories. applyTokenBudget drops the tail on overflow.
    const ordered: RenderableMemory[] = [
      ...projectMemories.map(m => ({
        id: m.id,
        scope: 'PROJECT' as const,
        category: m.category,
        content: m.content,
      })),
      ...taskMemories.map(m => ({
        id: m.id,
        scope: 'TASK' as const,
        category: m.category,
        content: m.content,
      })),
    ]
    // Wrap in an explicit trust boundary before the section leaves the
    // service: this string is auto-injected into the agent via SessionStart
    // `additionalContext` and is authored by arbitrary workspace members, so
    // it must be framed as untrusted reference data, not instructions (LUM-140).
    return wrapUntrustedMemory(renderMemorySection(applyTokenBudget(ordered)))
  },

  /**
   * Build the session-start injection payload for a bound task: memory plus the
   * linked Slack/web/Figma/PR cards, all sharing one global token budget
   * (priority memory > PR > Slack > Figma > web). Overflowed cards degrade to a
   * one-line manifest. memory and linked are wrapped in their own trust
   * boundaries. Returns empty strings when the task is gone or has nothing.
   *
   * All fetches run in parallel (session-start has a 3s budget). A single
   * resource fetch failing is isolated — that section renders empty, the rest
   * still inject.
   */
  async buildSessionStartSections(
    taskId: string
  ): Promise<{ memorySection: string; linkedResourcesSection: string }> {
    const empty = { memorySection: '', linkedResourcesSection: '' }
    const task = await taskRepository.findById(taskId)
    if (!task) return empty

    const safe = <T>(p: Promise<T>, fallback: T): Promise<T> =>
      p.catch(() => fallback)

    const [taskMemories, projectMemories, slack, web, figma, prs] =
      await Promise.all([
        safe(memoryRepository.findActiveTaskMemories(taskId), []),
        safe(memoryRepository.findActiveProjectMemories(task.projectId), []),
        safe(taskSlackContextRepository.listByTask(taskId), [] as Awaited<ReturnType<typeof taskSlackContextRepository.listByTask>>),
        safe(taskWebLinkRepository.listByTask(taskId), [] as Awaited<ReturnType<typeof taskWebLinkRepository.listByTask>>),
        safe(taskFigmaLinkService.listForTask(taskId), [] as Awaited<ReturnType<typeof taskFigmaLinkService.listForTask>>),
        safe(pullRequestRepository.listByTask(taskId), [] as Awaited<ReturnType<typeof pullRequestRepository.listByTask>>),
      ])

    const orderedMemories: RenderableMemory[] = [
      ...projectMemories.map(m => ({
        id: m.id,
        scope: 'PROJECT' as const,
        category: m.category,
        content: m.content,
      })),
      ...taskMemories.map(m => ({
        id: m.id,
        scope: 'TASK' as const,
        category: m.category,
        content: m.content,
      })),
    ]

    // Priority order: memory > PR > Slack > Figma > web.
    const [memoryOut, prOut, slackOut, figmaOut, webOut] = allocateBudget(
      [
        memoryBudgetSection(orderedMemories),
        prBudgetSection(prs as unknown as PRCard[]),
        slackBudgetSection(slack as unknown as SlackContextCard[]),
        figmaBudgetSection(figma),
        webLinkBudgetSection(web as unknown as WebLinkCard[]),
      ],
      SESSION_START_BUDGET_TOKENS
    ) as [string, string, string, string, string]

    const linkedJoined = [prOut, slackOut, figmaOut, webOut]
      .filter(s => s !== '')
      .join('\n\n')

    return {
      memorySection: wrapUntrustedMemory(memoryOut),
      linkedResourcesSection: wrapUntrustedLinked(linkedJoined),
    }
  },

  /**
   * Build the "## PR Review 待办" markdown block for a task: mirrored PR review
   * comments turned into a checkbox todo list. Includes every line-level
   * comment (REVIEW_LINE) and every `changes_requested` review summary across
   * the task's PRs; plain comment / approval / dismissal summaries and
   * tombstoned rows are dropped. Reviewer handles are resolved from the
   * GITHUB_USER pseudo-actor's `externalIdentity` — no Clerk call.
   *
   * Returns an empty string when the task has no qualifying review comments.
   * Shared by `getContextForIdentifier` (on-demand) and the session-start hook
   * (auto-injected as `additionalContext`).
   */
  async buildReviewTodosSectionForTask(taskId: string): Promise<string> {
    const prs = await pullRequestRepository.listIdAndNumberByTask(taskId)
    if (prs.length === 0) return ''

    const prNumberById = new Map(prs.map(p => [p.id, p.number]))
    const mirrors = await prCommentMirrorRepository.listReviewTodosForPrs(
      prs.map(p => p.id)
    )
    if (mirrors.length === 0) return ''

    // Resolve reviewer GitHub handles in one batch (GITHUB_USER actors only).
    const actorIds = [
      ...new Set(
        mirrors
          .map(m => m.comment.authorActorId)
          .filter((id): id is string => id !== null)
      ),
    ]
    const identities = await actorRepository.findGithubIdentitiesByIds(actorIds)
    const loginByActorId = new Map(
      identities
        .filter(a => a.externalIdentity?.startsWith('github:'))
        .map(a => [a.id, a.externalIdentity!.slice('github:'.length)])
    )

    const todos: ReviewTodoItem[] = []
    for (const m of mirrors) {
      // Keep line-level comments; for review summaries keep only changes_requested.
      if (
        m.externalSource === 'REVIEW' &&
        !m.comment.body.includes(REVIEW_HEADER.CHANGES_REQUESTED)
      ) {
        continue
      }
      const text = mirrorBodyToText(m.comment.body)
      // A line comment with no body after stripping is still actionable
      // (the file:line is the ask); a review summary with no body is just the
      // "changes requested" signal — both are worth surfacing.
      todos.push({
        kind: m.externalSource === 'REVIEW_LINE' ? 'line' : 'overall',
        prNumber: prNumberById.get(m.pullRequestId) ?? 0,
        filePath: m.filePath,
        line: m.lineEnd ?? m.lineStart,
        text,
        url: m.externalUrl,
        author: m.comment.authorActorId
          ? (loginByActorId.get(m.comment.authorActorId) ?? null)
          : null,
      })
    }

    return renderPrReviewTodosSection(todos)
  },

  /**
   * Build the "续上次进度" recovery payload for a task: the most recent prior
   * session (newest-first) that actually produced a summary, reduced to
   * headline + unresolved + duration. Walks back past summary-less sessions
   * (still generating / too short) and excludes `currentSessionId` so the
   * brand-new session doesn't echo itself. Returns null when no prior session
   * with a summary exists. Keyed on taskId, so it spans branches (squash-merge
   * continuation). Rendered CLI-side; this returns structured data only.
   */
  async buildPreviousSessionRecoveryForTask(
    taskId: string,
    currentSessionId: string
  ): Promise<PreviousSessionRecovery | null> {
    // Cap at 5: walking back more than 5 sessions for a recovery card is
    // unlikely to surface anything useful and keeps the query light.
    const sessions = await sessionRepository.listForTask(taskId, 5)
    for (const s of sessions) {
      if (s.id === currentSessionId) continue
      const headline = summaryHeadline(s.summary)
      if (headline === NO_SUMMARY) continue
      return {
        headline,
        unresolved: summaryUnresolved(s.summary, s.summaryType),
        durationMs: Math.max(
          0,
          s.lastActivityAt.getTime() - s.startedAt.getTime()
        ),
        lastActivityAt: s.lastActivityAt.toISOString(),
      }
    }
    return null
  },

  /**
   * Build the session-start "review the project memories the previous session
   * just promoted" section (LUM-165). Layer 2 consolidation runs async on
   * task→done and stamps the triggering session id onto each promoted PROJECT
   * memory; we surface those here at the *next* session-start so they can be
   * sanity-checked before they accrue forever.
   *
   * Anchored on the member's immediately-preceding session (not the task) via
   * `findPreviousSessionIdForMember`, then filtered to the current task's
   * project — Layer 2 is project-scoped, so the prior session may have been a
   * different task in the same project. Returns "" when there's no prior
   * session, or it promoted nothing into this project. Surfacing only the one
   * preceding session makes this "show once" without a per-row reviewed flag
   * (a migration LUM-152 deliberately declined).
   *
   * Keyed on (taskId, currentSessionId) to mirror
   * `buildPreviousSessionRecoveryForTask` and slot into the same session-start
   * Promise.all. Rendered server-side; the framing is trusted, the memory
   * bodies are wrapped as untrusted.
   */
  async buildLayer2ReviewSectionForTask(
    taskId: string,
    currentSessionId: string
  ): Promise<string> {
    const task = await taskRepository.findById(taskId)
    if (!task) return ''

    const prevSessionId =
      await sessionRepository.findPreviousSessionIdForMember(currentSessionId)
    if (!prevSessionId) return ''

    const promoted = await memoryRepository.findProjectMemoriesBySession(
      prevSessionId,
      task.projectId
    )
    if (promoted.length === 0) return ''

    const ordered: RenderableMemory[] = promoted.map(m => ({
      id: m.id,
      scope: 'PROJECT' as const,
      category: m.category,
      content: m.content,
    }))
    return renderLayer2ReviewSection(applyTokenBudget(ordered))
  },

  /**
   * Assemble a task's historical context for the coding agent: the task
   * itself plus prior sessions tagged with it (newest first), each reduced
   * to duration + one-line headline + unresolved items.
   *
   * Returns null when the identifier doesn't resolve in the workspace —
   * callers map that to HTTP 404.
   */
  async getContextForIdentifier(
    workspaceId: string,
    // Retained for API stability — lazy Figma refresh now uses the auto
    // variant that picks any active workspace integration, so the caller's
    // memberId is no longer needed here. Drop on next signature change.
    _actorMemberId: string,
    identifier: string
  ): Promise<TaskContext | null> {
    const resolved = await taskService.resolveIdentifier(
      workspaceId,
      identifier
    )
    if (!resolved) return null

    // taskService.resolveIdentifier returns a compact descriptor — fetch
    // once more to include the description field used in the context
    // markdown. Kept separate because most callers of resolveIdentifier
    // don't need description.
    const full = await taskRepository.findById(resolved.id)
    if (!full) return null

    const sessions = await sessionRepository.listForTask(resolved.id)

    const slackContexts = await taskSlackContextRepository.listByTask(
      resolved.id
    )

    const webLinks = await taskWebLinkRepository.listByTask(resolved.id)

    const figmaLinks = await taskFigmaLinkService.listForTask(resolved.id)
    const figmaSection = renderFigmaSection(figmaLinks)
    if (figmaLinks.length > 0) {
      scheduleLazyRefresh(figmaLinks, workspaceId, resolved.id)
    }

    const artifacts = await taskArtifactRepository.listByTask(resolved.id)
    const artifactSection = renderArtifactSection(artifacts)

    // Mentioned documents (EXPLICIT + CONTENT, workspace-visibility filtered).
    const docs = (await miscRepository.findDocumentsForContext(
      resolved.id,
      workspaceId,
      _actorMemberId
    )) as ContextDocument[]
    const docSection = renderDocumentSection(
      docs.map(d => ({ id: d.id, title: d.title, summary: d.summary }))
    )
    // Serve the cached summaries now; refresh stale ones in the background.
    scheduleStaleDocumentSummaries(docs)

    // Comments: short threads inline verbatim, longer ones fall back to the
    // cached commentsSummary (computed at write time, Task 6). The renderer
    // maps actor ids to authors — we only have the actor id here.
    const comments = await commentRepository.listAllForTask(resolved.id)
    const commentsSection = renderCommentsSection({
      comments: comments.map(c => ({
        author: c.authorActorId ?? 'unknown',
        createdAt: c.createdAt,
        body: c.body,
      })),
      identifier: resolved.identifier,
      commentsSummary: full.commentsSummary ?? null,
    })

    const prs = await pullRequestRepository.listByTask(resolved.id)
    const prSection = renderPRSection(prs)

    const prReviewTodosSection =
      await taskContextService.buildReviewTodosSectionForTask(resolved.id)

    const memorySection = await taskContextService.buildMemorySectionForTask(
      full.id
    )

    const milestone = full.milestoneId
      ? await milestoneRepository.findById(full.milestoneId)
      : null

    return {
      task: {
        id: full.id,
        identifier: resolved.identifier,
        title: full.title,
        status: full.status,
        description: full.description,
        descriptionMarkdown: full.description
          ? htmlToMarkdown(full.description)
          : null,
        milestone: milestone
          ? {
              id: milestone.id,
              name: milestone.name,
              status: milestone.status,
              targetDate: milestone.targetDate
                ? milestone.targetDate.toISOString()
                : null,
              description: milestone.description,
            }
          : null,
      },
      memorySection,
      slackContextSection: renderSlackContextSection(
        slackContexts as unknown as SlackContextCard[]
      ),
      webLinkSection: renderWebLinkSection(webLinks),
      figmaSection,
      artifactSection,
      docSection,
      commentsSection,
      prSection,
      prReviewTodosSection,
      sessions: sessions.map(s => ({
        id: s.id,
        startedAt: s.startedAt.toISOString(),
        lastActivityAt: s.lastActivityAt.toISOString(),
        durationMs: Math.max(
          0,
          s.lastActivityAt.getTime() - s.startedAt.getTime()
        ),
        eventCount: s.eventCount,
        summaryType: s.summaryType,
        headline: summaryHeadline(s.summary),
        unresolved: summaryUnresolved(s.summary, s.summaryType),
      })),
    }
  },
}
