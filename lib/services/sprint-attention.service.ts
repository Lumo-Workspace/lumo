import { sprintRepository } from '@/lib/repositories/sprint.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { testCaseRepository } from '@/lib/repositories/test-case.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { outcomeSignalRepository } from '@/lib/repositories/outcome-signal.repository'
import { retrospectiveRepository } from '@/lib/repositories/retrospective.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { readDoneGatePluginRow } from '@/lib/plugins/done-gate'
import { actorDisplayNames } from '@/lib/services/comment-author-names'
import { logger } from '@/lib/logger'
import {
  computeSprintAttention,
  scopeQueue,
  type AttentionScope,
  type SecurityPlane,
  type SprintAttention,
  type SprintAttentionFold,
} from '@/lib/summaries/sprint-attention'

/** The security plane has no batch API; at most this many tasks at once. */
const SECURITY_CONCURRENCY = 4

export interface AttentionSprintRef {
  id: string
  number: number
  teamId: string
  workspaceId: string
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const i = cursor++
      results[i] = await fn(items[i]!)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  )
  return results
}

/** Per-task security plane, fail-closed per task: a throw reads `unknown`. */
async function readSecurityPlanes(
  taskIds: string[]
): Promise<Map<string, SecurityPlane>> {
  const planes = await mapWithConcurrency(
    taskIds,
    SECURITY_CONCURRENCY,
    async (taskId): Promise<SecurityPlane> => {
      try {
        return { state: 'read', ...(await readDoneGatePluginRow(taskId)) }
      } catch (error) {
        logger.warn('sprint-attention: security plane unavailable', {
          taskId,
          error: error instanceof Error ? error.message : String(error),
        })
        return { state: 'unknown' }
      }
    }
  )
  return new Map(taskIds.map((id, i) => [id, planes[i]!]))
}

/**
 * Every read for one sprint's task set — a fixed number of batched queries
 * regardless of task count, plus the per-task security plane for the tasks
 * `securityFor` selects.
 */
async function foldSprint(
  sprintId: string,
  workspaceId: string,
  now: Date,
  opts: {
    securityFor: (task: { status: string }) => boolean
    /** Resolve assignee / confirmer names (a Clerk call); off when only
     *  the cost numbers are read. */
    withNames: boolean
  }
): Promise<SprintAttentionFold> {
  const tasks = await sprintRepository.taskRowsForAttention(
    sprintId,
    workspaceId
  )
  const taskIds = tasks.map(t => t.id)
  const [
    pullRequests,
    openCrossings,
    testCases,
    statusChanges,
    reworkSignals,
    tokenRows,
    security,
  ] = await Promise.all([
    pullRequestRepository.listForAttentionByTaskIds(workspaceId, taskIds),
    boundaryCrossingRepository.findOpenByTaskIds(workspaceId, taskIds),
    testCaseRepository.listWithLatestRunByTaskIds(workspaceId, taskIds),
    activityRepository.listStatusChangesByTaskIds(workspaceId, taskIds),
    outcomeSignalRepository.listReworkByTaskIds(workspaceId, taskIds),
    retrospectiveRepository.loadSessionTokenRowsForTasks(taskIds),
    readSecurityPlanes(tasks.filter(opts.securityFor).map(t => t.id)),
  ])
  // The workspace switch only matters when a non-advisory crossing is open.
  const crossingGateEnabled = openCrossings.some(c => !c.advisory)
    ? await boundaryCrossingRepository.isGateEnabledForWorkspace(workspaceId)
    : true

  const actorIds = [
    ...new Set(
      [
        ...tasks.map(t => t.assigneeActorId),
        ...statusChanges.map(c => c.actorId),
      ].filter((id): id is string => !!id)
    ),
  ]
  const actorNames = opts.withNames
    ? await actorDisplayNames(workspaceId, actorIds)
    : new Map<string, string>()

  return computeSprintAttention({
    now,
    tasks,
    pullRequests,
    openCrossings,
    testCases,
    statusChanges,
    reworkSignals,
    tokenRows,
    security,
    crossingGateEnabled,
    actorNames,
  })
}

/**
 * LUM-1278 — the Sprint attention read model for an already-authorized
 * sprint: queue, per-task trust + verified, stages, cost vs. the previous
 * sprint. Performs NO auth; call only after authorizing the sprint.
 */
export const sprintAttentionService = {
  async getForSprint(
    sprint: AttentionSprintRef,
    opts: { viewerMemberId: string; scope: AttentionScope; now: Date }
  ): Promise<SprintAttention> {
    // Only cost is read from the previous sprint, and only DONE tasks can be
    // verified — so its security plane is read for DONE tasks alone.
    const readPrevious = async () => {
      const ref = await sprintRepository.findPreviousInTeam(
        sprint.teamId,
        sprint.number
      )
      if (!ref) return null
      const fold = await foldSprint(ref.id, sprint.workspaceId, opts.now, {
        securityFor: t => t.status === 'DONE',
        withNames: false,
      })
      return { ref, cost: fold.cost }
    }
    const [current, previous, viewerActor] = await Promise.all([
      foldSprint(sprint.id, sprint.workspaceId, opts.now, {
        securityFor: () => true,
        withNames: true,
      }),
      readPrevious(),
      memberRepository.findActorByMemberId(opts.viewerMemberId),
    ])

    return {
      scope: opts.scope,
      asOf: opts.now.toISOString(),
      queue: scopeQueue(current.queue, opts.scope, viewerActor?.id ?? null),
      tasks: current.tasks,
      stages: current.stages,
      cost: {
        ...current.cost,
        previousSprint: previous
          ? {
              sprintId: previous.ref.id,
              number: previous.ref.number,
              name: previous.ref.name,
              tokensPerVerifiedTask: previous.cost.tokensPerVerifiedTask,
              reworkShare: previous.cost.reworkShare,
            }
          : null,
      },
    }
  },
}
