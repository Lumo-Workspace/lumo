import { taskDependencyRepository } from '@/lib/repositories/task-dependency.repository'
import { logger } from '@/lib/logger'
import { isPrismaUniqueViolation } from '@/lib/db/errors'
import { sanitizeField } from '@/lib/utils/sanitize'
import {
  LEGACY_CLI_COMMANDS,
  type CliCommandNames,
} from '@/lib/cli/command-names'

/**
 * LUM-172 task dependency CRUD + cycle prevention + alert rendering.
 * Red line: detected edges can only be confirmed by a human; the service layer
 * never auto-promotes SUGGESTED to CONFIRMED.
 */

export interface DependencyEdgeView {
  id: string
  direction: 'BLOCKED_BY' | 'BLOCKS'
  kind: string
  source: string
  status: string
  reason: string | null
  detail: unknown
  other: { identifier: string; title: string; status: string }
}

/** LUM-1286: one likely original of a task, for `task show` and session context. */
export interface PossibleDuplicate {
  identifier: string
  title: string
  status: string
  /** LLM match score 0–1; null when the edge carries none. */
  score: number | null
}

type EdgeWithTasks = Awaited<
  ReturnType<typeof taskDependencyRepository.findEdgesForTask>
>[number]

function toView(edge: EdgeWithTasks, taskId: string): DependencyEdgeView {
  const blockedSide = edge.blockedTaskId === taskId
  const other = blockedSide ? edge.blockingTask : edge.blockedTask
  return {
    id: edge.id,
    direction: blockedSide ? 'BLOCKED_BY' : 'BLOCKS',
    kind: edge.kind,
    source: edge.source,
    status: edge.status,
    reason: edge.reason,
    detail: edge.detail,
    other: {
      identifier: `${other.team.identifier}-${other.number}`,
      title: other.title,
      status: other.status,
    },
  }
}

/**
 * On the confirmed-BLOCKS graph, check whether adding the edge
 * (blocked ← blocking) creates a cycle: DFS from blocking along the
 * "depends on" direction and see if blocked is reachable.
 *
 * A concurrent check-then-write can bypass cycle prevention under an extreme
 * race (same trade-off as this repo's tag/sprint services; negligible for
 * small-team manual operations; a same-pair collision is caught by the DB
 * unique constraint).
 */
async function assertNoCycle(
  workspaceId: string,
  blockedTaskId: string,
  blockingTaskId: string
): Promise<void> {
  const edges =
    await taskDependencyRepository.findConfirmedBlocksEdges(workspaceId)
  // Build adjacency: blockedTaskId → [blockingTaskIds] (i.e., "depends on")
  const dependsOn = new Map<string, string[]>()
  for (const e of edges) {
    const list = dependsOn.get(e.blockedTaskId) ?? []
    list.push(e.blockingTaskId)
    dependsOn.set(e.blockedTaskId, list)
  }
  // DFS from blockingTaskId — if we can reach blockedTaskId, adding the edge creates a cycle
  const stack = [blockingTaskId]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const cur = stack.pop() as string
    if (cur === blockedTaskId) {
      throw Object.assign(new Error('Dependency would create a cycle'), {
        status: 409,
      })
    }
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const next of dependsOn.get(cur) ?? []) stack.push(next)
  }
}

/** LUM-1286: possible duplicates for session context, or none on a read failure. */
async function possibleDuplicatesOrNone(
  taskId: string
): Promise<PossibleDuplicate[]> {
  try {
    return await taskDependencyService.listPossibleDuplicates(taskId)
  } catch {
    return []
  }
}

export const taskDependencyService = {
  /**
   * LUM-1286: tasks this one likely duplicates, from the background check
   * after `lumo task create` — the SUGGESTED DUPLICATES edges it points from.
   */
  async listPossibleDuplicates(taskId: string): Promise<PossibleDuplicate[]> {
    const rows =
      await taskDependencyRepository.findSuggestedDuplicatesForTask(taskId)
    return rows.map(r => {
      const score = (r.detail as { score?: unknown } | null)?.score
      return {
        identifier: `${r.blockingTask.team.identifier}-${r.blockingTask.number}`,
        title: r.blockingTask.title,
        status: r.blockingTask.status,
        score: typeof score === 'number' ? score : null,
      }
    })
  },

  async listForTask(taskId: string): Promise<DependencyEdgeView[]> {
    const edges = await taskDependencyRepository.findEdgesForTask(taskId)
    return edges.map(e => toView(e, taskId))
  },

  /** Manual hard-dependency entry point: directly MANUAL + CONFIRMED (a human-known edge; deliberately thin). */
  async addManual(input: {
    workspaceId: string
    blockedTaskId: string
    blockingTaskId: string
    kind?: 'BLOCKS' | 'RELATES' | undefined
  }) {
    const { workspaceId, blockedTaskId, blockingTaskId } = input
    const kind = input.kind ?? 'BLOCKS'

    if (blockedTaskId === blockingTaskId) {
      throw Object.assign(new Error('A task cannot depend on itself'), {
        status: 400,
      })
    }

    const existing = await taskDependencyRepository.findByPair(
      blockedTaskId,
      blockingTaskId
    )

    if (existing?.status === 'CONFIRMED') {
      throw Object.assign(new Error('Dependency already exists'), {
        status: 409,
      })
    }

    if (kind === 'BLOCKS') {
      await assertNoCycle(workspaceId, blockedTaskId, blockingTaskId)
    }

    if (existing) {
      // Same-direction candidate the detector found first: a manual add amounts to confirming it; keep the DETECTED provenance.
      return taskDependencyRepository.update(existing.id, {
        status: 'CONFIRMED',
        confirmedAt: new Date(),
      })
    }

    return taskDependencyRepository.create({
      workspaceId,
      blockedTaskId,
      blockingTaskId,
      kind,
      source: 'MANUAL',
      status: 'CONFIRMED',
      confirmedAt: new Date(),
    })
  },

  /**
   * LUM-1282: record that `duplicateTaskId` (being canceled) duplicates
   * `canonicalTaskId` — a MANUAL + CONFIRMED DUPLICATES edge, blocked side =
   * the duplicate. Idempotent: an existing edge for the same pair (a BLOCKS /
   * RELATES edge, or a detector suggestion) is turned into the DUPLICATES
   * edge rather than refused, since the pair is unique whatever its kind.
   * Duplicates never take part in the BLOCKS cycle check.
   */
  async recordDuplicate(input: {
    workspaceId: string
    duplicateTaskId: string
    canonicalTaskId: string
  }) {
    const { workspaceId, duplicateTaskId, canonicalTaskId } = input
    if (duplicateTaskId === canonicalTaskId) {
      throw Object.assign(new Error('A task cannot duplicate itself'), {
        status: 400,
      })
    }
    const existing = await taskDependencyRepository.findByPair(
      duplicateTaskId,
      canonicalTaskId
    )
    if (existing) {
      if (existing.kind === 'DUPLICATES' && existing.status === 'CONFIRMED') {
        return existing
      }
      return taskDependencyRepository.update(existing.id, {
        kind: 'DUPLICATES',
        status: 'CONFIRMED',
        confirmedAt: new Date(),
      })
    }
    return taskDependencyRepository.create({
      workspaceId,
      blockedTaskId: duplicateTaskId,
      blockingTaskId: canonicalTaskId,
      kind: 'DUPLICATES',
      source: 'MANUAL',
      status: 'CONFIRMED',
      confirmedAt: new Date(),
    })
  },

  /** One-click confirm of a candidate edge; reverse flips the direction (the detector's direction is only a heuristic). */
  async confirm(input: { edgeId: string; reverse?: boolean | undefined }) {
    const edge = await taskDependencyRepository.findById(input.edgeId)
    if (!edge)
      throw Object.assign(new Error('Dependency not found'), { status: 404 })

    const [blockedTaskId, blockingTaskId] = input.reverse
      ? [edge.blockingTaskId, edge.blockedTaskId]
      : [edge.blockedTaskId, edge.blockingTaskId]

    if (input.reverse) {
      const reverseExisting = await taskDependencyRepository.findByPair(
        blockedTaskId,
        blockingTaskId
      )
      if (reverseExisting) {
        throw Object.assign(new Error('Reverse edge already exists'), {
          status: 409,
        })
      }
    }

    if (edge.kind === 'BLOCKS') {
      await assertNoCycle(edge.workspaceId, blockedTaskId, blockingTaskId)
    }

    try {
      return await taskDependencyRepository.update(edge.id, {
        status: 'CONFIRMED',
        confirmedAt: new Date(),
        ...(input.reverse ? { blockedTaskId, blockingTaskId } : {}),
      })
    } catch (err) {
      if (input.reverse && isPrismaUniqueViolation(err)) {
        throw Object.assign(new Error('Reverse edge already exists'), {
          status: 409,
        })
      }
      throw err
    }
  },

  /** Dismiss a candidate: keep the row instead of deleting, so the detector cannot re-suggest it next round. */
  async dismiss(edgeId: string) {
    const edge = await taskDependencyRepository.findById(edgeId)
    if (!edge)
      throw Object.assign(new Error('Dependency not found'), { status: 404 })
    return taskDependencyRepository.update(edgeId, {
      status: 'DISMISSED',
      confirmedAt: null,
    })
  },

  async remove(edgeId: string) {
    const edge = await taskDependencyRepository.findById(edgeId)
    if (!edge)
      throw Object.assign(new Error('Dependency not found'), { status: 404 })
    await taskDependencyRepository.delete(edgeId)
  },

  /**
   * Agent scheduling alert (the only v1 payoff): injected at attach/session-start.
   * Never throws — a broken alert must not kill session startup.
   */
  async buildBlockerWarningSectionForTask(
    taskId: string,
    taskIdentifier: string,
    commands: CliCommandNames = LEGACY_CLI_COMMANDS
  ): Promise<string> {
    try {
      const [blockers, suggestedCount, duplicates] = await Promise.all([
        taskDependencyRepository.findLiveBlockersForTask(taskId),
        taskDependencyRepository.countSuggestedForTask(taskId),
        // A failed duplicate read must not drop the blocker warning too.
        possibleDuplicatesOrNone(taskId),
      ])

      if (blockers.length === 0 && suggestedCount === 0) return ''

      const parts: string[] = []

      // LUM-1286: possible duplicates are named on their own — a human should
      // rule on them before anyone works on the task.
      if (duplicates.length > 0) {
        parts.push('## ⚠ Possible duplicate', '')
        for (const d of duplicates) {
          const match =
            d.score === null ? '' : ` (${Math.round(d.score * 100)}% match)`
          parts.push(
            `- This task may duplicate ${d.identifier} "${sanitizeField(d.title)}"${match} — flagged by the duplicate check when it was created.`,
            `  Confirm: \`${commands.taskDepConfirm(taskIdentifier, d.identifier)}\` · Not a duplicate: \`${commands.taskDepDismiss(taskIdentifier, d.identifier)}\``
          )
        }
        parts.push(
          '',
          'Ask the user whether it is a duplicate before starting work; run the command they choose.',
          ''
        )
      }

      if (blockers.length > 0) {
        parts.push('## ⚠ Dependency alerts', '')
        for (const b of blockers) {
          const t = b.blockingTask
          const ident = `${t.team.identifier}-${t.number}`
          const pr = t.pullRequests[0]
          const prNote = pr
            ? `, PR #${pr.number}${pr.isDraft ? ' (draft)' : ''} not merged`
            : ''
          // LUM-346 convention: workspace-authored free text (task title) gets the
          // control-char strip at the render source, covering every consumer
          // (session-start hook injection has no client-side sanitize pass).
          parts.push(
            `- This task is blocked by ${ident} "${sanitizeField(t.title)}" (status ${t.status}${prNote}).`
          )
        }
        parts.push(
          '',
          `Consider waiting for the blocker(s) to merge before starting work to avoid a wasted run; if an edge is stale, clean it up with ${commands.taskDepCleanup}.`
        )
      }

      const otherSuggested = suggestedCount - duplicates.length
      if (otherSuggested > 0) {
        parts.push(
          `Detected ${otherSuggested} candidate dependencies awaiting confirmation: run \`${commands.taskDeps(taskIdentifier)}\`.`
        )
      }

      return parts.join('\n').trimEnd()
    } catch (err) {
      logger.error(
        'buildBlockerWarningSectionForTask failed; omitting blocker warning',
        err
      )
      return ''
    }
  },
}
