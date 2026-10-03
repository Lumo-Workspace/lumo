/**
 * @jest-environment node
 *
 * Verifies the wiring added in LUM-72: updateTaskWithSideEffects fires
 * Layer 2 memory consolidation only when a task transitions to DONE.
 * The trigger has to be tight — firing on every status update would
 * burn LLM calls; missing the DONE transition would defeat the purpose
 * of moving off cron.
 */
// Capture the promise passed to waitUntil so each test can await it
// before asserting. The Layer 2 wiring uses a dynamic import inside the
// waitUntil callback — the outer call returns immediately and the trigger
// has not been invoked yet by the time updateTaskWithSideEffects returns.
const waitUntilPromises: Array<Promise<unknown>> = []
// LUM-732: the DONE gate now consults the PR security scan. No linked PR here,
// so the real gate short-circuits before touching the scan repository.
// LUM-812: the DONE gate now consults the test-case plane fail-closed (a proven,
// undispositioned defect blocks). Default it to "no test cases" so this suite
// keeps isolating what it was written for.
jest.mock('@/lib/repositories/test-case.repository', () => ({
  testCaseRepository: {
    listForTask: jest.fn(() => Promise.resolve([])),
    runsPerCase: jest.fn(() => Promise.resolve(new Map())),
  },
}))
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
jest.mock('@/lib/services/memory/layer2.service', () => ({
  layer2Service: {
    triggerForTaskCompletion: jest.fn().mockResolvedValue(undefined),
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
jest.mock('@/lib/task/state-machine', () => ({
  isValidTaskTransition: () => true,
}))

import { taskRepository } from '@/lib/repositories/task.repository'
import { layer2Service } from '@/lib/services/memory/layer2.service'
import { updateTaskWithSideEffects } from '@/lib/services/task-state.service'

const findForUpdate = taskRepository.findForUpdate as jest.Mock
const update = taskRepository.update as jest.Mock
const trigger = layer2Service.triggerForTaskCompletion as jest.MockedFunction<
  typeof layer2Service.triggerForTaskCompletion
>

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
  // Fresh row + clean update result for each case. Individual tests
  // override status to set up the relevant transition.
  update.mockImplementation(async (_id, data) => ({
    ...mockTaskRow({ status: 'DONE' }),
    ...data,
    team: { identifier: 'LUM' },
  }))
})

describe('updateTaskWithSideEffects → Layer 2 trigger', () => {
  it('fires Layer 2 when status transitions TODO → DONE', async () => {
    findForUpdate.mockResolvedValue(mockTaskRow({ status: 'TODO' }))

    await updateTaskWithSideEffects(
      'task_1',
      { status: 'DONE' },
      { project: { workspaceId: 'ws_1' } } as never,
      'actor_1',
      'clerk_1'
    )
    await flushWaitUntil()

    expect(trigger).toHaveBeenCalledWith({
      taskId: 'task_1',
      projectId: 'proj_1',
    })
  })

  it('fires Layer 2 when status transitions IN_REVIEW → DONE', async () => {
    findForUpdate.mockResolvedValue(mockTaskRow({ status: 'IN_REVIEW' }))

    await updateTaskWithSideEffects(
      'task_1',
      { status: 'DONE' },
      { project: { workspaceId: 'ws_1' } } as never,
      'actor_1',
      'clerk_1'
    )
    await flushWaitUntil()

    expect(trigger).toHaveBeenCalledTimes(1)
  })

  it('threads the sourceSessionId into the Layer 2 trigger (LUM-165)', async () => {
    // The CLI passes the CC session id as a 6th arg so the consolidated
    // PROJECT memory is attributed to the session that marked the task done.
    findForUpdate.mockResolvedValue(mockTaskRow({ status: 'IN_REVIEW' }))

    await updateTaskWithSideEffects(
      'task_1',
      { status: 'DONE' },
      { project: { workspaceId: 'ws_1' } } as never,
      'actor_1',
      'clerk_1',
      'sess_99'
    )
    await flushWaitUntil()

    expect(trigger).toHaveBeenCalledWith({
      taskId: 'task_1',
      projectId: 'proj_1',
      sourceSessionId: 'sess_99',
    })
  })

  it('does NOT fire Layer 2 when status moves to IN_PROGRESS', async () => {
    // Anything that isn't DONE must not fire — burning LLM calls on
    // intermediate transitions was the whole point of moving off cron.
    findForUpdate.mockResolvedValue(mockTaskRow({ status: 'TODO' }))

    await updateTaskWithSideEffects(
      'task_1',
      { status: 'IN_PROGRESS' },
      { project: { workspaceId: 'ws_1' } } as never,
      'actor_1',
      'clerk_1'
    )
    await flushWaitUntil()

    expect(trigger).not.toHaveBeenCalled()
  })

  it('does NOT fire Layer 2 when only non-status fields change', async () => {
    // Title-only updates must not fire — Layer 2 cares about the lesson
    // landing point, not about cosmetic edits.
    findForUpdate.mockResolvedValue(mockTaskRow({ status: 'IN_PROGRESS' }))

    await updateTaskWithSideEffects(
      'task_1',
      { title: 'renamed' },
      { project: { workspaceId: 'ws_1' } } as never,
      'actor_1',
      'clerk_1'
    )
    await flushWaitUntil()

    expect(trigger).not.toHaveBeenCalled()
  })
})
