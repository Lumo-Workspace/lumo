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
  type SlackContextCard,
} from '@/lib/context/render'
import {
  applyTokenBudget,
  renderMemorySection,
  wrapUntrustedMemory,
  type RenderableMemory,
} from '@/lib/memory/render'
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
  sessions: SessionContext[]
}

/**
 * One-line synthesis of a session summary. Preference order matches the
 * session-summary type templates: goal > overview > problem > refactorGoal >
 * reviewScope. All types expose at least one of these, so falling through
 * the list covers every shape the classifier produces.
 */
function summaryHeadline(summary: unknown): string {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    return '(no summary)'
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
  return '(no summary)'
}

/**
 * Pull the `unresolved` array from a structured summary. implementation and
 * mixed templates both emit this field; other types (exploration, debug,
 * refactor, review) either lack it or express pendings differently — callers
 * that care about those can add type-specific paths later. For Day 7 we
 * follow the user's guidance: "直接用 summary.unresolved, 不加新字段".
 */
function summaryUnresolved(summary: unknown): string[] {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    return []
  }
  const u = (summary as Record<string, unknown>).unresolved
  if (!Array.isArray(u)) return []
  return u.filter((x): x is string => typeof x === 'string' && x.length > 0)
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
        unresolved: summaryUnresolved(s.summary),
      })),
    }
  },
}
