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

export const taskDependencyService = {
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
      const [blockers, suggestedCount] = await Promise.all([
        taskDependencyRepository.findLiveBlockersForTask(taskId),
        taskDependencyRepository.countSuggestedForTask(taskId),
      ])

      if (blockers.length === 0 && suggestedCount === 0) return ''

      const parts: string[] = []

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

      if (suggestedCount > 0) {
        parts.push(
          `Detected ${suggestedCount} candidate dependencies awaiting confirmation: run \`${commands.taskDeps(taskIdentifier)}\`.`
        )
      }

      return parts.join('\n')
    } catch (err) {
      logger.error(
        'buildBlockerWarningSectionForTask failed; omitting blocker warning',
        err
      )
      return ''
    }
  },
}
