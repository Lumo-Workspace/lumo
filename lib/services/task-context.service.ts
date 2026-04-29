import { taskRepository } from '@/lib/repositories/task.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { taskService } from '@/lib/services/task.service'
import {
  applyTokenBudget,
  renderMemorySection,
  type RenderableMemory,
} from '@/lib/memory/render'

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
  }
  /**
   * Pre-rendered "## Relevant Memory" markdown block, already trimmed to a
   * token budget. Empty string when the task has no relevant memory. The CLI
   * inlines this verbatim — keeping render server-side avoids duplicating
   * memory-shape knowledge in the CLI bundle.
   */
  memorySection: string
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

export const taskContextService = {
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

    const [taskMemories, projectMemories] = await Promise.all([
      memoryRepository.findActiveTaskMemories(resolved.id),
      memoryRepository.findActiveProjectMemories(full.projectId),
    ])

    // Project memories first (broader applicability, survive task archival),
    // then task memories. applyTokenBudget drops the tail on overflow, so
    // task-specific items are first to be cut when we hit the cap.
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
    const budgeted = applyTokenBudget(ordered)
    const memorySection = renderMemorySection(budgeted)

    return {
      task: {
        id: full.id,
        identifier: resolved.identifier,
        title: full.title,
        status: full.status,
        description: full.description,
      },
      memorySection,
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
