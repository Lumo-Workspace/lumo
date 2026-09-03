/**
 * @jest-environment node
 *
 * Verifies the wiring added in LUM-277: the task-state transitions stamp
 * lineage-edge outcomes. DONE closes edges as MERGED (the task-level success
 * terminal); reopening a DONE task stamps its merged edges REWORKED. The
 * trigger must be tight — stamping on an intermediate transition would paint
 * outcomes onto edges of work that isn't actually finished.
 */
// Capture the promise passed to waitUntil so each test can await it before
// asserting — the stamp runs in a dynamic import inside the waitUntil callback,
// which has not resolved by the time the outer call returns.
const waitUntilPromises: Array<Promise<unknown>> = []
// LUM-732: the DONE gate now consults the PR security scan. No linked PR here,
// so the real gate short-circuits before touching the scan repository.
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findManyForSecurityByTaskId: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => {
    waitUntilPromises.push(p)
    return p
  },
}))
async function flushWaitUntil() {
  await Promise.all(waitUntilPromises.splice(0))
}
jest.mock('@/lib/services/lineage-outcome.service', () => {
  const service = {
    stampForTaskDone: jest.fn().mockResolvedValue({ count: 0 }),
    stampForTaskReopened: jest.fn().mockResolvedValue({ count: 0 }),
  }
  return {
    lineageOutcomeService: service,
    // Mirror the real helper: invoke the callback against the (mocked) service
    // so tests can assert the stamp without a waitUntil flush.
    stampLineageInBackground: (
      stamp: (s: typeof service) => Promise<unknown>
    ) => void stamp(service),
  }
})
// DONE also fires Layer 2 / sprint side effects via dynamic
// import; mock them so those chains stay out of this module.
jest.mock('@/lib/services/memory/layer2.service', () => ({
  layer2Service: {
    triggerForTaskCompletion: jest.fn().mockResolvedValue(undefined),
  },
}))
jest.mock('@/lib/services/sprint.service', () => ({
  sprintService: {
    autoAddCompletedTaskToActiveSprint: jest.fn().mockResolvedValue(undefined),
  },
}))
jest.mock('@/lib/services/task-notifications.service', () => ({
  dispatchUpdateTaskSideEffects: jest.fn(),
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findForUpdate: jest.fn(),
    update: jest.fn(),
    findChildren: jest.fn().mockResolvedValue([]),
    findProjectIdById: jest.fn(),
    findActorById: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: { findByIdSimple: jest.fn() },
}))
jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: {
    syncTaskTags: jest.fn(),
    findByTask: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
// LUM-426 boundary gate runs on DONE — default to "nothing flagged".
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    findUndispositionedByTask: jest.fn(() => Promise.resolve([])),
    isGateEnabledForWorkspace: jest.fn(() => Promise.resolve(true)),
  },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { findById: jest.fn() },
}))
// LUM-422 ④ DONE gate dep — empty verdicts → gate passes (no send-back).
jest.mock('@/lib/repositories/verification-run.repository', () => ({
  verificationRunRepository: {
    latestRunsByCriterion: jest.fn(async () => new Map()),
  },
}))
jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: { listByTask: jest.fn(async () => []) },
}))
jest.mock('@/lib/task/state-machine', () => ({
  isValidTaskTransition: () => true,
}))

import { taskRepository } from '@/lib/repositories/task.repository'
import { lineageOutcomeService } from '@/lib/services/lineage-outcome.service'
import {
  reopen,
  updateTaskWithSideEffects,
} from '@/lib/services/task-state.service'

const findForUpdate = taskRepository.findForUpdate as jest.Mock
const update = taskRepository.update as jest.Mock
const stampDone = lineageOutcomeService.stampForTaskDone as jest.Mock
const stampReopened = lineageOutcomeService.stampForTaskReopened as jest.Mock

function mockTaskRow(overrides: {
  status: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE'
}) {
  return {
    id: 'task_1',
    title: 'T',
    status: overrides.status,
    projectId: 'proj_1',
    teamId: 'team_1',
    project: { workspaceId: 'ws_1' },
    team: { identifier: 'LUM' },
    sprintId: null,
    assigneeActorId: null,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  update.mockImplementation(async (_id, data) => ({
    ...mockTaskRow({ status: 'DONE' }),
    ...data,
    team: { identifier: 'LUM' },
  }))
})

describe('task-state → lineage outcome stamping', () => {
  it('stamps MERGED when a task transitions to DONE', async () => {
    findForUpdate.mockResolvedValue(mockTaskRow({ status: 'IN_REVIEW' }))

    await updateTaskWithSideEffects(
      'task_1',
      { status: 'DONE' },
      { project: { workspaceId: 'ws_1' } } as never,
      'actor_1',
      'clerk_1'
    )
    await flushWaitUntil()

    expect(stampDone).toHaveBeenCalledWith('task_1')
  })

  it('does NOT stamp when the status moves to a non-DONE state', async () => {
    findForUpdate.mockResolvedValue(mockTaskRow({ status: 'TODO' }))

    await updateTaskWithSideEffects(
      'task_1',
      { status: 'IN_PROGRESS' },
      { project: { workspaceId: 'ws_1' } } as never,
      'actor_1',
      'clerk_1'
    )
    await flushWaitUntil()

    expect(stampDone).not.toHaveBeenCalled()
  })

  it('stamps REWORKED when a DONE task is reopened', async () => {
    findForUpdate.mockResolvedValue(mockTaskRow({ status: 'DONE' }))

    await reopen('task_1', { reason: 'sentry_regression', actorId: 'actor_1' })
    await flushWaitUntil()

    expect(stampReopened).toHaveBeenCalledWith('task_1')
  })

  it('does NOT stamp REWORKED when reopening a task that is not DONE', async () => {
    findForUpdate.mockResolvedValue(mockTaskRow({ status: 'IN_PROGRESS' }))

    await reopen('task_1', { reason: 'sentry_regression', actorId: 'actor_1' })
    await flushWaitUntil()

    expect(stampReopened).not.toHaveBeenCalled()
  })
})
