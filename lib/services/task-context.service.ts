import type { FragmentRef } from '@/lib/repositories/lineage-edge.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import {
  activeDurationMs,
  activeDurationMsBySession,
  activeDurationMsBySessionTask,
} from '@/lib/agent-run/active-time'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import {
  milestoneState,
  type MilestoneState,
} from '@/lib/summaries/milestone-state'
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
import { prSecurityReminderService } from '@/lib/services/pr-security-reminder.service'
import {
  assembleLineageSection,
  computeFragmentTrust,
  trustKey,
} from '@/lib/services/lineage-signal'
import type { TrustVerdict } from '@/types/lineage'
import { rankSessionStartCards } from '@/lib/lineage/session-rank'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { memoryProvenanceRepository } from '@/lib/repositories/memory-provenance.repository'
import { scheduleDocumentSummary } from '@/lib/services/document.service'
import { waitUntil } from '@/lib/runtime/wait-until'
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
  slackManifest,
  webLinkManifest,
  figmaManifest,
  prManifest,
  type ReviewTodoItem,
  type SlackContextCard,
  type WebLinkCard,
  type PRCard,
} from '@/lib/context/render'
import {
  remindAtStart,
  renderTestCaseStartNudge,
} from '@/lib/context/render/test-case-reminder'
import {
  classifyReviewer,
  githubCommentProvenance,
} from '@/lib/context/reviewer-trust'
import { PREVIOUS_SESSIONS_NOTE } from '@/shared/src/untrusted-fence'
import { testCaseReminderService } from '@/lib/services/test-case-reminder.service'
import {
  stripPrMirrorHeader,
  REVIEW_HEADER,
} from '@/lib/integrations/github/markdown-bridge'
import {
  applyTokenBudget,
  renderMemorySection,
  renderMemoryIndexBlock,
  renderLayer2ReviewSection,
  wrapUntrustedMemory,
  wrapUntrustedLinked,
  wrapUntrustedLinkedGroup,
  wrapUntrustedTaskDescription,
  memoryManifestLine,
  renderMemoryItem,
  type MemorySource,
  type RenderableMemory,
} from '@/lib/memory/render'
import { estimateTokens, type BudgetSectionMetric } from '@/lib/context/budget'
import { buildMemoryIndex } from '@/lib/services/memory/index-disclosure'
import { RELEVANCE_GATE_TOP_K } from '@/lib/services/memory/relevance-gate.constants'
import { htmlToMarkdown } from '@/lib/utils/markdown'
import { bigramSimilarity } from '@/lib/similarity'
import { memoryContentToText } from '@/lib/memory/content-text'
import {
  gateProjectMemories,
  type RelevanceGateInput,
  type SimilarityRanking,
  type RelevanceGateResult,
} from '@/lib/services/memory/relevance-gate'
import { logger } from '@/lib/logger'
import { guardPromptLineText } from '@/lib/security-scan/inject-guard'
import { sanitizeField } from '@/lib/utils/sanitize'

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
  /** The prior session's id — recorded as a SESSION lineage fragment (LUM-276). */
  sessionId: string
  headline: string
  unresolved: string[]
  durationMs: number
  lastActivityAt: string
}

/**
 * The kinds of context fragment a task assembly can carry. One value per
 * source the agent is shown. UPPER_SNAKE mirrors the underlying model names so
 * a future LineageEdge fragment-type enum (LUM-275) can adopt them verbatim.
 */
export type ContextFragmentType =
  | 'MEMORY'
  | 'SLACK_CONTEXT'
  | 'WEB_LINK'
  | 'FIGMA_LINK'
  | 'ARTIFACT'
  | 'DOCUMENT'
  | 'COMMENT'
  | 'PULL_REQUEST'
  | 'PR_REVIEW_TODO'
  | 'SESSION'

/**
 * A single addressable piece of the assembled task context. `id` is the
 * source record's stable handle — the cuid for every type except `SESSION`,
 * which uses the session UUID. This flat manifest is what lineage
 * edge-recording (LUM-275+) joins a run back to; the rendered `*Section`
 * strings stay the agent-facing surface. The cuid is "stable" only within a
 * record's lifetime — surviving consolidation/edit drift is LUM-280.
 */
export interface ContextFragment {
  type: ContextFragmentType
  id: string
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
      state: MilestoneState
      targetDate: string | null
      description: string | null
    } | null
  }
  /**
   * LUM-998: the description (markdown form) inside its
   * `<untrusted-task-description>` fence — redacted, defanged and flagged.
   * What the CLI prints; "" when there is no description. Older CLIs still
   * read `task.descriptionMarkdown`.
   */
  descriptionSection: string
  /**
   * Pre-rendered "## Relevant Memory" markdown block, already trimmed to a
   * token budget. Empty string when the task has no relevant memory. The CLI
   * inlines this verbatim — keeping render server-side avoids duplicating
   * memory-shape knowledge in the CLI bundle.
   */
  memorySection: string
  /**
   * LUM-844: the same memories as `memorySection`, one headline line each
   * (+ id for `lumo memory show`), already wrapped. What the CLI prints by
   * default; `memorySection` stays for `--full` and for older CLIs.
   */
  memoryIndexSection: string
  /**
   * Pre-rendered "## Test cases" nudge (LUM-807); empty once the task has a
   * recorded script, and on DONE tasks. Ungated by PR on purpose — see
   * `lib/context/render/test-case-reminder.ts`.
   */
  testCaseSection: string
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
  /** Pre-rendered "## PR review todos" markdown; empty when no review comments. */
  prReviewTodosSection: string
  /**
   * Pre-rendered "## Flywheel signal · historical merge contribution" block appended at the very end
   * of the context handoff. Empty string when no fragment clears the cold-start
   * sample floor (LUM-278 DoD⑤). Caliber is fixed server-side.
   */
  lineageSection: string
  sessions: SessionContext[]
  /**
   * Flat, render-independent manifest of every fragment that fed the sections
   * above (and the sessions list), each keyed by its stable id. Ordered by
   * section, memory first. The prerequisite for lineage edge-recording
   * (LUM-274 gap A) — consumers join a run to the fragments it was shown.
   */
  fragments: ContextFragment[]
}

const NO_SUMMARY = '(no summary)'
/** Headline of an unattached session attributed to the task by inference. */
const INFERRED_SESSION_HEADLINE =
  '(unattached session; attributed to this task by inference)'

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

/**
 * LUM-998: one session-summary line on its way to an agent. Summaries are
 * LLM-distilled from the session's own transcript, which includes every piece
 * of untrusted content the session read — so a planted directive can survive
 * into the next session's handoff. Collapse to one line (a newline could forge
 * a heading), then redact, defang and mark it inline. The placeholder
 * headlines are Lumo's own text and pass through untouched.
 */
function guardSummaryLine(line: string): string {
  if (line === NO_SUMMARY || line === INFERRED_SESSION_HEADLINE) return line
  return guardPromptLineText(sanitizeField(line).replace(/\s*\n\s*/g, ' '))
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
  const prefix =
    status === 'unresolved' ? 'Bug unresolved' : 'Bug only partially fixed'
  const problem = typeof s.problem === 'string' ? s.problem.trim() : ''
  return [problem.length > 0 ? `${prefix}: ${problem}` : prefix]
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
 * Day-7 behavior ("use summary.unresolved directly"). Non-string / empty entries are
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

/**
 * Format an active duration in milliseconds to a compact human label for
 * the Tier-1 "Progress so far" headline suffix, e.g. "23min" or "1h 5min".
 * Uses Math.round so that e.g. 89 500 ms → 1min (not 0min) and 3 599 000 → 60min.
 * Returns null when ms is 0 (caller omits the suffix entirely).
 */
function formatActiveDuration(ms: number): string | null {
  if (ms <= 0) return null
  const m = Math.round(ms / 60_000)
  if (m === 0) return null
  if (m < 60) return `${m}min`
  return `${Math.floor(m / 60)}h ${m % 60}min`
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
function scheduleStaleDocumentSummaries(
  docs: ContextDocument[],
  workspaceId: string
): void {
  for (const doc of docs) {
    if (!isDocumentSummaryStale(doc)) continue
    if (!doc.content) continue
    const bodyText = htmlToMarkdown(doc.content)
    if (bodyText.trim().length > 0)
      scheduleDocumentSummary(doc.id, workspaceId, bodyText)
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

/**
 * Fetch a task's relevant memories and order them for rendering: project
 * memories first (broader applicability, survive task archival), then task
 * memories. Shared by `buildMemorySectionForTask` (which budgets + renders)
 * and `getContextForIdentifier` (which budgets + renders AND derives the memory
 * fragment ids), so the ordering/shape lives in exactly one place.
 *
 * LUM-486: project memories are passed through the relevance gate so the
 * displayed set matches what session-start injects. Task-scoped memories are
 * never gated.
 */
async function fetchOrderedTaskMemories(task: {
  id: string
  title: string
  description: string | null
  projectId: string
}): Promise<RenderableMemory[]> {
  const [taskMemories, projectMemories] = await Promise.all([
    memoryRepository.findActiveTaskMemories(task.id),
    memoryRepository.findActiveProjectMemories(task.projectId),
  ])
  const projectRenderable = toProjectRenderables(projectMemories)
  // LUM-486: gate the project corpus by relevance before rendering, so the
  // displayed memory matches what session-start injects.
  const gate = await selectRelevantProjectMemories(task, projectRenderable)
  return [
    ...gate.selected,
    ...taskMemories.map(m => ({
      id: m.id,
      scope: 'TASK' as const,
      category: m.category,
      content: m.content,
      source: memorySource(m.createdByMemberId),
    })),
  ]
}

/**
 * Wire the real deps to the pure project-memory relevance gate (LUM-486):
 * embedding-first cosine ranking via pgvector, lexical-bigram fallback when the
 * corpus is cold or no embedding key, and merge-contribution trust. Never
 * throws — the gate itself degrades to the full corpus on any dep failure.
 */
async function selectRelevantProjectMemories(
  task: {
    id: string
    title: string
    description: string | null
    projectId: string
  },
  projectMemories: RenderableMemory[]
): Promise<RelevanceGateResult> {
  const queryText = [task.title, task.description ?? ''].join('\n').trim()

  const lexicalRanking = (input: RelevanceGateInput): SimilarityRanking => ({
    mechanism: 'lexical',
    ranked: input.projectMemories
      .map(m => ({
        id: m.id,
        score: bigramSimilarity(
          queryText,
          memoryContentToText(m.category, m.content)
        ),
      }))
      .sort((a, b) => b.score - a.score),
  })

  const rankBySimilarity = async (
    input: RelevanceGateInput
  ): Promise<SimilarityRanking | null> => {
    try {
      const { embedTexts } = await import('@/lib/ai/embedding')
      const [v] = await embedTexts([queryText])
      const vector = v && v.length > 0 ? v : undefined
      // Empty embedding response → treat as a cold corpus, not an outage.
      if (!vector) return lexicalRanking(input)
      const { neighbors, scopeHasEmbeddings } =
        await memoryRepository.findNeighborEmbeddings({
          scope: { kind: 'PROJECT', projectId: task.projectId },
          queryVector: vector,
          k: input.projectMemories.length,
        })
      // Cold corpus (no stored embeddings yet) → lexical relevance still gates.
      if (!scopeHasEmbeddings) return lexicalRanking(input)
      return {
        mechanism: 'embedding',
        ranked: neighbors.map(n => ({ id: n.id, score: n.score })),
      }
    } catch {
      // Embedding-gateway / pgvector outage → null lets the gate degrade to the
      // FULL corpus (status quo); never silently re-gate via a different signal.
      return null
    }
  }

  const trustByFragment = async (
    ids: string[]
  ): Promise<Map<string, TrustVerdict>> => {
    // Gated memories are ACTIVE PROJECT rows, which are canonical (a fully
    // promoted PROJECT memory has no provenance child), so keying the trust
    // lookup by current id matches how LineageEdges store the fragment id. If a
    // non-canonical PROJECT row ever reaches here, the worst case is a missed
    // always-keep (trust is the additive layer; similarity can still select it)
    // — never a wrong fragment recorded.
    const refs = ids.map(id => ({
      fragmentType: 'MEMORY' as const,
      fragmentId: id,
    }))
    const judged = await lineageEdgeRepository.judgedUsageByFragments(refs)
    const { verdicts } = computeFragmentTrust(refs, { judged })
    const out = new Map<string, TrustVerdict>()
    for (const id of ids) {
      const v = verdicts.get(trustKey('MEMORY', id))
      if (v) out.set(id, v)
    }
    return out
  }

  return gateProjectMemories(
    {
      task: { title: task.title, description: task.description },
      projectMemories,
      projectId: task.projectId,
    },
    { rankBySimilarity, trustByFragment }
  )
}

/** Test-only export of the wiring helper (LUM-486). */
export const __test__selectRelevantProjectMemories =
  selectRelevantProjectMemories

/**
 * Derive the rendering-layer source attribution (LUM-347) from authorship:
 * rows without a creating member were distilled by an agent (Layer 1/2
 * extraction); rows with one were recorded by a human via the CLI/UI.
 */
function memorySource(createdByMemberId: string | null): MemorySource {
  return createdByMemberId ? 'user' : 'agent'
}

/** Map raw active PROJECT memory rows to the RenderableMemory shape the gate and
 * renderer consume (LUM-486 — shared by session-start and the display path). */
function toProjectRenderables(
  rows: Awaited<ReturnType<typeof memoryRepository.findActiveProjectMemories>>
): RenderableMemory[] {
  return rows.map(m => ({
    id: m.id,
    scope: 'PROJECT' as const,
    category: m.category,
    content: m.content,
    source: memorySource(m.createdByMemberId),
  }))
}

/**
 * Collect a task's PR review todos plus, in lockstep, the stable mirror-row id
 * behind each surviving todo. Includes every line-level comment (REVIEW_LINE)
 * and every `changes_requested` review summary; plain comment / approval /
 * dismissal summaries and tombstoned rows are dropped. Reviewer handles are
 * resolved from the GITHUB_USER pseudo-actor's `externalIdentity` (no Clerk
 * call); each todo carries the reviewer's verified standing (LUM-1003,
 * `classifyReviewer`). `fragmentIds[i]` is the mirror id of `todos[i]` — the two arrays stay
 * index-aligned so `getContextForIdentifier` can surface a fragment per
 * rendered todo without re-deriving the filter. Empty arrays when the task has
 * no qualifying review comments.
 */
async function collectReviewTodos(
  taskId: string
): Promise<{ todos: ReviewTodoItem[]; fragmentIds: string[] }> {
  const empty = { todos: [], fragmentIds: [] }
  const prs = await pullRequestRepository.listIdAndNumberByTask(taskId)
  if (prs.length === 0) return empty

  const prNumberById = new Map(prs.map(p => [p.id, p.number]))
  const mirrors = await prCommentMirrorRepository.listReviewTodosForPrs(
    prs.map(p => p.id)
  )
  if (mirrors.length === 0) return empty

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
  const fragmentIds: string[] = []
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
      // LUM-1003: only a verified reviewer's ask renders as a todo.
      reviewer: classifyReviewer({
        authorAssociation: m.authorAssociation,
        authorActorType: m.comment.author?.type,
      }),
    })
    fragmentIds.push(m.id)
  }

  return { todos, fragmentIds }
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

    // applyTokenBudget drops the tail on overflow.
    const ordered = await fetchOrderedTaskMemories({
      id: task.id,
      title: task.title,
      description: task.description,
      projectId: task.projectId,
    })
    // Wrap in an explicit trust boundary before the section leaves the
    // service: this string is auto-injected into the agent via SessionStart
    // `additionalContext` and is authored by arbitrary workspace members, so
    // it must be framed as untrusted reference data, not instructions (LUM-140).
    return wrapUntrustedMemory(renderMemorySection(applyTokenBudget(ordered)))
  },

  /**
   * Build the standalone "## Test cases" nudge for a task (LUM-807): one short
   * block telling the agent to record a re-runnable script, shown while the
   * task has none. No PR gate — at attach/context time there is usually no PR
   * yet, and gating on one would hide the reminder exactly when acting on it
   * is cheapest. Empty string for a missing/DONE task, or once a script
   * exists.
   */
  async buildTestCaseSectionForTask(
    taskId: string,
    taskIdentifier: string,
    status: string
  ): Promise<string> {
    return testCaseReminderService
      .stateForTask({ taskId, taskDone: status === 'DONE' })
      .then(state =>
        remindAtStart(state) ? renderTestCaseStartNudge(taskIdentifier) : ''
      )
      .catch(() => '')
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
  async buildSessionStartSections(taskId: string): Promise<{
    /** LUM-807: "## Test cases" nudge ('' once a script exists or on DONE). */
    testCaseSection: string
    memorySection: string
    linkedResourcesSection: string
    /** LUM-737: undispositioned security findings on the task's PRs ('' = nothing to show). */
    securityFindingsSection: string
    fragments: FragmentRef[]
    /** Fragments dropped by the relevance gate before ranking (LUM-522). */
    droppedFragments: Array<{
      fragmentType: 'MEMORY'
      fragmentId: string
      relevanceScore: number
    }>
    /** Per-section budget attribution (LUM-402 telemetry) — observe-only. */
    budget: {
      budgetTokens: number
      sections: Record<
        'memory' | 'pr' | 'slack' | 'figma' | 'web',
        BudgetSectionMetric
      >
    }
  }> {
    const emptyMetric: BudgetSectionMetric = {
      keptCards: 0,
      droppedCards: 0,
      keptTokens: 0,
      droppedTokens: 0,
    }
    const empty = {
      testCaseSection: '',
      memorySection: '',
      linkedResourcesSection: '',
      securityFindingsSection: '',
      fragments: [] as FragmentRef[],
      droppedFragments: [] as Array<{
        fragmentType: 'MEMORY'
        fragmentId: string
        relevanceScore: number
      }>,
      budget: {
        budgetTokens: SESSION_START_BUDGET_TOKENS,
        sections: {
          memory: emptyMetric,
          pr: emptyMetric,
          slack: emptyMetric,
          figma: emptyMetric,
          web: emptyMetric,
        },
      },
    }
    const task = await taskRepository.findById(taskId)
    if (!task) return empty

    // LUM-500: the manifest retrieval hints (`lumo task <kind> show …`) require
    // the human task identifier (e.g. "LUM-42") as their first positional, so an
    // agent can run them verbatim. Compose it from the team prefix + number.
    const taskIdentifier = `${task.team.identifier}-${task.number}`

    const safe = <T>(p: Promise<T>, fallback: T): Promise<T> =>
      p.catch(() => fallback)

    const [
      taskMemories,
      projectMemories,
      slack,
      web,
      figma,
      prs,
      securityFindingsSection,
    ] = await Promise.all([
      safe(memoryRepository.findActiveTaskMemories(taskId), []),
      safe(memoryRepository.findActiveProjectMemories(task.projectId), []),
      safe(
        taskSlackContextRepository.listByTask(taskId),
        [] as Awaited<ReturnType<typeof taskSlackContextRepository.listByTask>>
      ),
      safe(
        taskWebLinkRepository.listByTask(taskId),
        [] as Awaited<ReturnType<typeof taskWebLinkRepository.listByTask>>
      ),
      safe(
        taskFigmaLinkService.listForTask(taskId),
        [] as Awaited<ReturnType<typeof taskFigmaLinkService.listForTask>>
      ),
      safe(
        pullRequestRepository.listByTask(taskId),
        [] as Awaited<ReturnType<typeof pullRequestRepository.listByTask>>
      ),
      // LUM-737: undispositioned security findings on the task's PRs — the
      // "fix before you claim done" warning. Best-effort: a scan read
      // failing must never take session-start down, and '' means "nothing
      // to show", never "confirmed clean" (task status carries the
      // fail-closed read).
      safe(
        prSecurityReminderService.buildSessionStartSection(
          taskId,
          taskIdentifier
        ),
        ''
      ),
    ])

    const projectRenderable = toProjectRenderables(projectMemories)
    // LUM-486: relevance-gate the project corpus before it becomes both the
    // rendered block AND the lineage manifest. Task memories are never gated.
    const gate = await selectRelevantProjectMemories(
      {
        id: task.id,
        title: task.title,
        description: task.description,
        projectId: task.projectId,
      },
      projectRenderable
    )
    logger.info('memory.relevanceGate', {
      taskId,
      corpusSize: gate.telemetry.corpusSize,
      selectedCount: gate.telemetry.selectedCount,
      mechanism: gate.telemetry.mechanism,
    })
    const orderedMemories: RenderableMemory[] = [
      ...gate.selected,
      ...taskMemories.map(m => ({
        id: m.id,
        scope: 'TASK' as const,
        category: m.category,
        content: m.content,
        source: memorySource(m.createdByMemberId),
      })),
    ]

    // LUM-279: reorder each section by historical merge contribution (high-merge
    // survives the budget, proven-low degrades first) and collapse pre/post-
    // consolidation memory dups. Never throws — falls back to the fixed order.
    const ranked = await rankSessionStartCards(
      { memories: orderedMemories, slack, web, figma, prs },
      {
        resolveCanonical: (type, id) =>
          memoryProvenanceRepository.resolveCanonicalFragment(type, id),
        mergeRateByFragments: refs =>
          lineageEdgeRepository.mergeRateByFragments(refs),
      }
    )

    // Tier-2 memory: top-K addressable index, then a pointer for the rest.
    // Wrapped in the same untrusted boundary as the old full card.
    const memorySection = wrapUntrustedMemory(
      buildMemoryIndex(ranked.memories, RELEVANCE_GATE_TOP_K)
    )
    // Observe-only telemetry (LUM-402): keep the `memory` metric shape so the
    // return type and the session-start metrics stamp stay intact. Memory no
    // longer competes for the token budget, so nothing is "dropped" to overflow
    // here — droppedCards counts entries that fell past the top-K index.
    const memoryMetric: BudgetSectionMetric = {
      keptCards: Math.min(RELEVANCE_GATE_TOP_K, ranked.memories.length),
      droppedCards: Math.max(0, ranked.memories.length - RELEVANCE_GATE_TOP_K),
      keptTokens: estimateTokens(memorySection),
      droppedTokens: 0,
    }

    // LUM-807: the test-case nudge — before the first line of code, ask what
    // script proves the work again tomorrow.
    // Isolated like every other section here: a reminder that cannot be
    // computed renders empty rather than failing the whole injection.
    const testCaseSection = await testCaseReminderService
      .stateForTask({ taskId, taskDone: task.status === 'DONE' })
      .then(state =>
        remindAtStart(state) ? renderTestCaseStartNudge(taskIdentifier) : ''
      )
      .catch(() => '')

    // LUM-500: linked resources are Tier-2 — each renders as a clean manifest
    // block (heading + one descriptive one-line manifest per card), never a
    // full budgeted card. An agent reads the index and pulls only what it
    // needs. Empty list → empty block, dropped from the joined section.
    const manifestBlock = <T>(
      heading: string,
      cards: T[],
      toManifest: (card: T) => string
    ): string =>
      cards.length === 0
        ? ''
        : `${heading}\n\n${cards.map(toManifest).join('\n')}`

    const prManifestBlock = manifestBlock(
      '## Pull Requests',
      ranked.prs as unknown as PRCard[],
      pr => prManifest(pr, taskIdentifier)
    )
    const slackManifestBlock = manifestBlock(
      '## Slack Context',
      ranked.slack as unknown as SlackContextCard[],
      c => slackManifest(c, taskIdentifier)
    )
    const figmaManifestBlock = manifestBlock(
      '## Figma Designs',
      ranked.figma,
      link => figmaManifest(link, taskIdentifier)
    )
    const webManifestBlock = manifestBlock(
      '## Web Links',
      ranked.web as unknown as WebLinkCard[],
      l => webLinkManifest(l, taskIdentifier)
    )

    const linkedJoined = [
      prManifestBlock,
      slackManifestBlock,
      figmaManifestBlock,
      webManifestBlock,
    ]
      .filter(s => s !== '')
      .join('\n\n')

    // Observe-only telemetry (LUM-402): resources no longer compete for the
    // token budget — they're all rendered as Tier-2 manifests. Keep the metric
    // shape so the return type and the metrics stamp stay intact: every card is
    // "dropped" to a manifest (keptCards 0), with the manifest's own cheap
    // tokens recorded as keptTokens.
    const manifestMetric = (
      block: string,
      count: number
    ): BudgetSectionMetric => ({
      keptCards: 0,
      droppedCards: count,
      keptTokens: estimateTokens(block),
      droppedTokens: 0,
    })
    const prMetric = manifestMetric(prManifestBlock, ranked.prs.length)
    const slackMetric = manifestMetric(slackManifestBlock, ranked.slack.length)
    const figmaMetric = manifestMetric(figmaManifestBlock, ranked.figma.length)
    const webMetric = manifestMetric(webManifestBlock, ranked.web.length)

    // LUM-500: every session-start fragment is now Tier-2 — memory is an
    // addressable index and the resources are descriptive manifests — so each
    // edge is tagged INDEX. The route's extra fragments (review-todos, layer2,
    // SESSION) carry no disclosure and correctly default to FULL, since they're
    // injected as full content.
    const droppedFragments = gate.dropped.map(d => ({
      fragmentType: 'MEMORY' as const,
      fragmentId: d.id,
      relevanceScore: d.score,
    }))

    const fragments: FragmentRef[] = [
      ...ranked.memories.map(m => {
        const indexTokens = estimateTokens(memoryManifestLine(m))
        const fullTokens = estimateTokens(renderMemoryItem(m))
        const score = gate.scores.get(m.id)
        return {
          fragmentType: 'MEMORY' as const,
          fragmentId: m.id,
          disclosure: 'INDEX' as const,
          indexTokens,
          fullTokens,
          ...(score != null ? { relevanceScore: score } : {}),
        }
      }),
      ...ranked.slack.map(s => ({
        fragmentType: 'SLACK_CONTEXT' as const,
        fragmentId: s.id,
        disclosure: 'INDEX' as const,
      })),
      ...ranked.web.map(w => ({
        fragmentType: 'WEB_LINK' as const,
        fragmentId: w.id,
        disclosure: 'INDEX' as const,
      })),
      ...ranked.figma.map(f => ({
        fragmentType: 'FIGMA' as const,
        fragmentId: f.id,
        disclosure: 'INDEX' as const,
      })),
      ...ranked.prs.map(p => ({
        fragmentType: 'PR' as const,
        fragmentId: p.id,
        disclosure: 'INDEX' as const,
      })),
    ]

    return {
      testCaseSection,
      memorySection,
      linkedResourcesSection: wrapUntrustedLinked(linkedJoined),
      securityFindingsSection,
      fragments,
      droppedFragments,
      budget: {
        budgetTokens: SESSION_START_BUDGET_TOKENS,
        sections: {
          memory: memoryMetric,
          pr: prMetric,
          slack: slackMetric,
          figma: figmaMetric,
          web: webMetric,
        },
      },
    }
  },

  /**
   * Build the "## PR review todos" markdown block for a task: mirrored PR review
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
  async buildReviewTodosSectionForTask(
    taskId: string
  ): Promise<{ section: string; fragments: FragmentRef[] }> {
    const { todos, fragmentIds } = await collectReviewTodos(taskId)
    return {
      section: renderPrReviewTodosSection(todos),
      fragments: fragmentIds.map(id => ({
        fragmentType: 'PR_REVIEW_TODO' as const,
        fragmentId: id,
      })),
    }
  },

  /**
   * Build the resume-previous-progress recovery payload for a task: the most recent prior
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
      // LUM-932 P3: an unattached session's summary may cover other tasks.
      if (s.inferred) continue
      const headline = summaryHeadline(s.summary)
      if (headline === NO_SUMMARY) continue
      // Agent active time (Σ per-turn STOP − prompt), not the session span —
      // a resumed session's idle gap would otherwise inflate it (LUM-487).
      const turnEvents =
        await hookEventRepository.findTurnBoundaryEventsForSessions([s.id])
      return {
        sessionId: s.id,
        headline: guardSummaryLine(headline),
        unresolved: summaryUnresolved(s.summary, s.summaryType).map(
          guardSummaryLine
        ),
        durationMs: activeDurationMs(turnEvents),
        lastActivityAt: s.lastActivityAt.toISOString(),
      }
    }
    return null
  },

  /**
   * Render the prior-session progress summary as a Tier-1 full markdown section
   * (LUM-500). Tier 1 of progressive disclosure: where Tier-1 progress always
   * injects in full and everything else degrades to an addressable index, this
   * is the "what the last session got done / left open" block, rendered
   * server-side.
   *
   * A pure render of {@link buildPreviousSessionRecoveryForTask} — no fetching
   * beyond that one call. Returns "" when there is no prior session with a
   * summary, so the caller can omit the section. The "Unresolved" checklist is
   * dropped entirely when the prior session left nothing open.
   */
  async buildProgressSectionForTask(
    taskId: string,
    currentSessionId: string
  ): Promise<string> {
    const recovery =
      await taskContextService.buildPreviousSessionRecoveryForTask(
        taskId,
        currentSessionId
      )
    if (!recovery) return ''
    const durationLabel = formatActiveDuration(recovery.durationMs)
    const headline = durationLabel
      ? `${recovery.headline} (${durationLabel} active)`
      : recovery.headline
    const lines = ['## Progress so far', PREVIOUS_SESSIONS_NOTE, headline]
    if (recovery.unresolved.length > 0) {
      const CAP = 5
      const visible = recovery.unresolved.slice(0, CAP)
      const overflow = recovery.unresolved.length - CAP
      lines.push('', 'Unresolved:')
      for (const item of visible) lines.push(`- [ ] ${item}`)
      if (overflow > 0) {
        lines.push(
          `- +${overflow} more — \`lumo task context\` for the full list`
        )
      }
    }
    return lines.join('\n')
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
  ): Promise<{ section: string; fragments: FragmentRef[]; dropped: number }> {
    const empty = { section: '', fragments: [] as FragmentRef[], dropped: 0 }
    const task = await taskRepository.findById(taskId)
    if (!task) return empty

    const prevSessionId =
      await sessionRepository.findPreviousSessionIdForMember(currentSessionId)
    if (!prevSessionId) return empty

    const promoted = await memoryRepository.findProjectMemoriesBySession(
      prevSessionId,
      task.projectId
    )
    if (promoted.length === 0) return empty

    const ordered: RenderableMemory[] = promoted.map(m => ({
      id: m.id,
      scope: 'PROJECT' as const,
      category: m.category,
      content: m.content,
      source: memorySource(m.createdByMemberId),
    }))
    const survivors = applyTokenBudget(ordered)
    return {
      section: renderLayer2ReviewSection(survivors),
      fragments: survivors.map(m => ({
        fragmentType: 'MEMORY' as const,
        fragmentId: m.id,
      })),
      dropped: ordered.length - survivors.length,
    }
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
    // Per-session agent active time (Σ per-turn STOP − prompt), not the session
    // wall-clock span — excludes idle when a session resumes (LUM-487).
    const turnEvents =
      await hookEventRepository.findTurnBoundaryEventsForSessions(
        sessions.map(s => s.id)
      )
    const sessionDurationMs = activeDurationMsBySession(turnEvents)
    // LUM-932 P3: an unattached (inferred) session may span several tasks —
    // only its turns attributed to THIS task count toward its duration.
    const inferredIds = new Set(sessions.filter(s => s.inferred).map(s => s.id))
    const onThisTask = new Map<string, number>()
    for (const g of activeDurationMsBySessionTask(
      turnEvents.filter(e => e.sessionId && inferredIds.has(e.sessionId)),
      () => null
    )) {
      if (g.taskId === resolved.id) onThisTask.set(g.sessionId, g.ms)
    }
    for (const id of inferredIds)
      sessionDurationMs.set(id, onThisTask.get(id) ?? 0)

    const slackContexts = await taskSlackContextRepository.listByTask(
      resolved.id
    )

    const webLinks = await taskWebLinkRepository.listByTask(resolved.id)

    const figmaLinks = await taskFigmaLinkService.listForTask(resolved.id)
    const figmaSection = renderFigmaSection(figmaLinks, resolved.identifier)
    if (figmaLinks.length > 0) {
      scheduleLazyRefresh(figmaLinks, workspaceId, resolved.id)
    }

    const artifacts = await taskArtifactRepository.listByTask(resolved.id)
    const artifactSection = renderArtifactSection(
      artifacts,
      resolved.identifier
    )

    // LUM-807: the test-case nudge — `task context` is a read-the-context
    // moment, and a script recorded now can be re-run for the life of the task.
    const testCaseSection = await testCaseReminderService
      .stateForTask({ taskId: resolved.id, taskDone: full.status === 'DONE' })
      .then(state =>
        remindAtStart(state)
          ? renderTestCaseStartNudge(resolved.identifier)
          : ''
      )
      .catch(() => '')

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
    scheduleStaleDocumentSummaries(docs, workspaceId)

    // Comments: short threads inline verbatim, longer ones fall back to the
    // cached commentsSummary (computed at write time, Task 6). The renderer
    // maps actor ids to authors — we only have the actor id here.
    const comments = await commentRepository.listAllForTask(resolved.id)
    const commentsSection = renderCommentsSection({
      comments: comments.map(c => ({
        author: c.authorActorId ?? 'unknown',
        createdAt: c.createdAt,
        body: c.body,
        github: githubCommentProvenance(c),
      })),
      identifier: resolved.identifier,
      commentsSummary: full.commentsSummary ?? null,
    })

    const prs = await pullRequestRepository.listByTask(resolved.id)
    const prSection = renderPRSection(prs, resolved.identifier)

    // collectReviewTodos returns the rendered todos AND their stable mirror
    // ids in lockstep, so the fragment manifest references exactly the todos
    // the agent sees (post-filter), without re-deriving the filter here.
    const { todos: reviewTodos, fragmentIds: reviewTodoIds } =
      await collectReviewTodos(resolved.id)
    const prReviewTodosSection = renderPrReviewTodosSection(reviewTodos)

    // Inline the memory build (rather than calling buildMemorySectionForTask)
    // so the fragment ids come from the *budgeted* set — the memories that
    // actually survive into the rendered section, i.e. what the agent sees.
    const budgetedMemories = applyTokenBudget(
      await fetchOrderedTaskMemories({
        id: full.id,
        title: full.title,
        description: full.description,
        projectId: full.projectId,
      })
    )
    const memorySection = wrapUntrustedMemory(
      renderMemorySection(budgetedMemories)
    )
    const memoryIndexSection = renderMemoryIndexBlock(
      budgetedMemories,
      resolved.identifier
    )

    const milestone = full.milestoneId
      ? await milestoneRepository.findById(full.milestoneId)
      : null

    // Flat fragment manifest, section order (memory first). Each id is the
    // source record's stable handle — cuid for every type, session UUID for
    // SESSION. The prerequisite for lineage edge-recording (LUM-274 gap A).
    const fragments: ContextFragment[] = [
      ...budgetedMemories.map(m => ({ type: 'MEMORY' as const, id: m.id })),
      ...slackContexts.map(s => ({ type: 'SLACK_CONTEXT' as const, id: s.id })),
      ...webLinks.map(w => ({ type: 'WEB_LINK' as const, id: w.id })),
      ...figmaLinks.map(f => ({ type: 'FIGMA_LINK' as const, id: f.id })),
      ...artifacts.map(a => ({ type: 'ARTIFACT' as const, id: a.id })),
      ...docs.map(d => ({ type: 'DOCUMENT' as const, id: d.id })),
      ...comments.map(c => ({ type: 'COMMENT' as const, id: c.id })),
      ...prs.map(p => ({ type: 'PULL_REQUEST' as const, id: p.id })),
      ...reviewTodoIds.map(id => ({ type: 'PR_REVIEW_TODO' as const, id })),
      // LUM-932 P3: an inferred session is not this task's source record.
      ...sessions
        .filter(s => !s.inferred)
        .map(s => ({ type: 'SESSION' as const, id: s.id })),
    ]

    // Trailing judged-used track-record signal (LUM-539). Reads accumulated
    // lineage edges, task-deduped, gated on the cold-start audit floor.
    // Best-effort: any failure degrades to "" inside assembleLineageSection.
    const memoryContentById = new Map<string, string>(
      budgetedMemories.map(m => [
        m.id,
        typeof m.content === 'string' ? m.content : '',
      ])
    )
    const lineageSection = await assembleLineageSection(
      fragments,
      memoryContentById,
      {
        resolveCanonicalFragment: (type, id) =>
          memoryProvenanceRepository.resolveCanonicalFragment(type, id),
        judgedUsageByFragments: refs =>
          lineageEdgeRepository.judgedUsageByFragments(refs),
      }
    )

    // Defaults only narrow the noUncheckedIndexedAccess `string | undefined`;
    // the group always returns one entry per input.
    const [
      wrappedSlack = '',
      wrappedWeb = '',
      wrappedFigma = '',
      wrappedArtifact = '',
      wrappedDoc = '',
      wrappedComments = '',
      wrappedPr = '',
    ] = wrapUntrustedLinkedGroup([
      renderSlackContextSection(
        slackContexts as unknown as SlackContextCard[],
        resolved.identifier
      ),
      renderWebLinkSection(webLinks, resolved.identifier),
      figmaSection,
      artifactSection,
      docSection,
      commentsSection,
      prSection,
    ])

    const descriptionMarkdown = full.description
      ? htmlToMarkdown(full.description)
      : null

    return {
      task: {
        id: full.id,
        identifier: resolved.identifier,
        title: full.title,
        status: full.status,
        description: full.description,
        descriptionMarkdown,
        milestone: milestone
          ? {
              id: milestone.id,
              name: milestone.name,
              state: milestoneState(milestone),
              targetDate: milestone.targetDate
                ? milestone.targetDate.toISOString()
                : null,
              description: milestone.description,
            }
          : null,
      },
      descriptionSection: wrapUntrustedTaskDescription(
        descriptionMarkdown ?? ''
      ),
      memorySection,
      memoryIndexSection,
      testCaseSection,
      // LUM-347 follow-up: every member/externally-authored free-text section
      // crosses the same LUM-140 injection surface when the CLI prints it, so
      // it leaves the service wrapped — mirroring what buildSessionStartSections
      // already does for its joined linked block. Per-section (not joined)
      // because the response shape is a CLI contract; the wrappers return ""
      // for empty input, so empty sections are still omitted.
      // LUM-352: wrapped as an ordered group — full preamble on the first
      // non-empty section only, one-line continuation on the rest. The array
      // order below MUST stay in sync with the CLI print order
      // (cli/src/commands/task-context.ts).
      // Deliberately NOT wrapped: prReviewTodosSection (an actionable
      // review todo list — framing it "do not obey" would contradict its
      // purpose; same in the session-start path). LUM-998: each todo line
      // is guarded inline instead (renderPrReviewTodosSection).
      slackContextSection: wrappedSlack,
      webLinkSection: wrappedWeb,
      figmaSection: wrappedFigma,
      artifactSection: wrappedArtifact,
      docSection: wrappedDoc,
      commentsSection: wrappedComments,
      prSection: wrappedPr,
      prReviewTodosSection,
      sessions: sessions.map(s => ({
        id: s.id,
        startedAt: s.startedAt.toISOString(),
        lastActivityAt: s.lastActivityAt.toISOString(),
        durationMs: sessionDurationMs.get(s.id) ?? 0,
        eventCount: s.eventCount,
        summaryType: s.summaryType,
        // LUM-932 P3: an unattached session's summary may describe other
        // tasks' work — never surface it as this task's history.
        headline: s.inferred
          ? INFERRED_SESSION_HEADLINE
          : guardSummaryLine(summaryHeadline(s.summary)),
        unresolved: s.inferred
          ? []
          : summaryUnresolved(s.summary, s.summaryType).map(guardSummaryLine),
      })),
      lineageSection,
      fragments,
    }
  },
}
