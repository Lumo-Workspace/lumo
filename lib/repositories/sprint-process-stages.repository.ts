import type { HookEventType } from '@prisma/client'
import { scopedPrisma } from '@/lib/db/workspace-scope'
import { eventsForTasks } from '@/lib/repositories/task-attribution-where'

/** Hook-event types the active-time derivation consumes (the same set as
 *  `retrospectiveRepository`'s ACTIVE_TIME_EVENT_TYPES). */
const ACTIVE_TIME_EVENT_TYPES: HookEventType[] = [
  'USER_PROMPT_SUBMIT',
  'STOP',
  'STOP_FAILURE',
  'PRE_TOOL_USE',
  'POST_TOOL_USE',
  'POST_TOOL_USE_FAILURE',
  'POST_TOOL_BATCH',
  'SUBAGENT_START',
  'SUBAGENT_STOP',
  'PERMISSION_REQUEST',
  'PERMISSION_DENIED',
  'NOTIFICATION',
  'ELICITATION',
  'ELICITATION_RESULT',
]

/**
 * LUM-1280 — batched reads behind the closed-sprint process-stage stats. One
 * query per source over the whole task set, every one pinned to the
 * workspace (directly, or through the owning task for models without a
 * `workspaceId` column). No business rules: the pure fold in
 * `lib/summaries/sprint-process-stages*.ts` decides what the rows mean.
 */
export const sprintProcessStagesRepository = {
  async loadInputs(workspaceId: string, taskIds: string[]) {
    if (taskIds.length === 0) {
      return {
        statusEvents: [],
        crossings: [],
        pullRequests: [],
        testCases: [],
        turnEvents: [],
        crossingGateEnabled: true,
      }
    }
    const inTasks = { taskId: { in: taskIds } }
    const ownTask = { task: { workspaceId } }
    const [
      statusEvents,
      crossings,
      pullRequests,
      testCases,
      rawTurnEvents,
      workspace,
    ] = await Promise.all([
      scopedPrisma.taskActivity.findMany({
        where: { ...inTasks, ...ownTask, type: 'STATUS_CHANGED' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { taskId: true, payload: true, createdAt: true },
      }),
      scopedPrisma.boundaryCrossing.findMany({
        where: { ...inTasks, ...ownTask },
        select: {
          taskId: true,
          detectedAt: true,
          dispositionedAt: true,
          disposition: true,
          advisory: true,
          severity: true,
        },
      }),
      scopedPrisma.pullRequest.findMany({
        where: { workspaceId, ...inTasks },
        select: {
          id: true,
          taskId: true,
          number: true,
          title: true,
          url: true,
          state: true,
          headSha: true,
          mergeCommitSha: true,
          isDraft: true,
          createdAt: true,
          mergedAt: true,
          closedAt: true,
        },
      }),
      scopedPrisma.testCase.findMany({
        where: { ...inTasks, ...ownTask, deletedAt: null },
        select: {
          id: true,
          taskId: true,
          requiredEnvironment: true,
          // Only the latest run decides (append-only log, LUM-812).
          runs: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              result: true,
              environment: true,
              failureAttribution: true,
              unprovenVerification: true,
              evidence: true,
              stepResults: true,
              pullRequestId: true,
              commitSha: true,
              commitDirty: true,
              createdAt: true,
              disposition: { select: { id: true } },
            },
          },
        },
      }),
      scopedPrisma.hookEvent.findMany({
        where: {
          workspaceId,
          ...eventsForTasks(taskIds),
          type: { in: ACTIVE_TIME_EVENT_TYPES },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          sessionId: true,
          taskId: true,
          type: true,
          createdAt: true,
          session: { select: { taskId: true } },
        },
      }),
      scopedPrisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { boundaryGateEnabled: true },
      }),
    ])
    return {
      statusEvents,
      crossings,
      pullRequests,
      testCases,
      turnEvents: rawTurnEvents.map(e => ({
        sessionId: e.sessionId,
        taskId: e.taskId ?? e.session?.taskId ?? null,
        type: e.type,
        createdAt: e.createdAt,
      })),
      // Absent workspace → the gate stays on (fail safe, as the DONE gate).
      crossingGateEnabled: workspace?.boundaryGateEnabled ?? true,
    }
  },
}

export type SprintProcessStageRows = Awaited<
  ReturnType<typeof sprintProcessStagesRepository.loadInputs>
>
