import { updateTask } from '@/lib/services/task-state.service'
import { boundaryDetectorService } from '@/lib/services/boundary-detector.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'

// updateTask's own deps — mocked so the test isolates the LUM-426 DONE gate.
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findForUpdate: jest.fn(), update: jest.fn() },
}))
jest.mock('@/lib/repositories/verification-run.repository', () => ({
  verificationRunRepository: { latestRunsByCriterion: jest.fn() },
}))
jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: { listByTask: jest.fn() },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: { findByIdSimple: jest.fn() },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: {
    findByTask: jest.fn(() => []),
    syncTaskTags: jest.fn(),
    addTaskTags: jest.fn(),
    removeTaskTags: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    create: jest.fn(),
    findUndispositionedByTask: jest.fn(),
    isGateEnabledForWorkspace: jest.fn(),
  },
}))

const findForUpdate = taskRepository.findForUpdate as jest.Mock
const update = taskRepository.update as jest.Mock
const latestRuns = verificationRunRepository.latestRunsByCriterion as jest.Mock
const findOpen =
  boundaryCrossingRepository.findUndispositionedByTask as jest.Mock
const gateEnabled =
  boundaryCrossingRepository.isGateEnabledForWorkspace as jest.Mock
const createCrossing = boundaryCrossingRepository.create as jest.Mock
const createActivity = activityRepository.create as jest.Mock

const TASK = {
  id: 't-1',
  status: 'IN_REVIEW',
  projectId: 'p-1',
  project: { workspaceId: 'w-1' },
  sprintId: null,
  assigneeActorId: null,
  parentTaskId: null,
}

const openCrossing = () => [
  {
    id: 'bc-1',
    taskId: 't-1',
    category: 'PUSH_TO_PROTECTED_BRANCH',
    detail: 'git push origin main',
  },
]

beforeEach(() => {
  jest.clearAllMocks()
  findForUpdate.mockResolvedValue({ ...TASK })
  update.mockResolvedValue({
    ...TASK,
    status: 'DONE',
    team: { identifier: 'LUM' },
    teamId: 'team-1',
  })
  // No unresolved send-back — isolate the boundary gate from the LUM-422 gate.
  latestRuns.mockResolvedValue(new Map())
  findOpen.mockResolvedValue([])
  gateEnabled.mockResolvedValue(true)
  createCrossing.mockResolvedValue({ id: 'bc-1' })
  createActivity.mockResolvedValue({ id: 'act-1' })
})

describe('LUM-426 DONE gate — assertNoUnacknowledgedBoundaryCrossings', () => {
  it('unacknowledged boundary-crossing blocks DONE with 409', async () => {
    findOpen.mockResolvedValue(openCrossing())
    await expect(updateTask('t-1', { status: 'DONE' })).rejects.toMatchObject({
      status: 409,
    })
    expect(update).not.toHaveBeenCalled()
    // Only the workspace it belongs to is consulted for the toggle.
    expect(gateEnabled).toHaveBeenCalledWith('w-1')
  })

  it('acknowledging a boundary-crossing clears the DONE block', async () => {
    // While unacknowledged → blocked.
    findOpen.mockResolvedValue(openCrossing())
    await expect(updateTask('t-1', { status: 'DONE' })).rejects.toMatchObject({
      status: 409,
    })

    // After a human acknowledges it, there are no open crossings → DONE flows.
    findOpen.mockResolvedValue([])
    await expect(updateTask('t-1', { status: 'DONE' })).resolves.toBeDefined()
    expect(update).toHaveBeenCalledWith(
      't-1',
      expect.objectContaining({ status: 'DONE' })
    )
  })

  it('gate setting defaults on and opting out keeps flagging but drops the DONE block', async () => {
    // FLAGGING HALF (always on): the detector records a crossing without ever
    // consulting the gate toggle — recording is unconditional by construction.
    await boundaryDetectorService.detectAndRecord({
      taskId: 't-1',
      hookEventId: 'evt-1',
      toolName: 'Bash',
      filePath: null,
      payload: { tool_input: { command: 'git push origin main' } },
    })
    expect(createCrossing).toHaveBeenCalledTimes(1)
    expect(createActivity).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'BOUNDARY_CROSSING_DETECTED' })
    )
    expect(gateEnabled).not.toHaveBeenCalled() // detector never reads the toggle

    // DEFAULT ON: with the toggle at its default (true) an open crossing blocks.
    findOpen.mockResolvedValue(openCrossing())
    gateEnabled.mockResolvedValue(true)
    await expect(updateTask('t-1', { status: 'DONE' })).rejects.toMatchObject({
      status: 409,
    })

    // OPT OUT: turn the toggle off → the same open crossing no longer blocks DONE.
    gateEnabled.mockResolvedValue(false)
    await expect(updateTask('t-1', { status: 'DONE' })).resolves.toBeDefined()
    expect(update).toHaveBeenCalledWith(
      't-1',
      expect.objectContaining({ status: 'DONE' })
    )
  })

  it('short-circuits free when there are no open crossings (never reads the toggle)', async () => {
    findOpen.mockResolvedValue([])
    await expect(updateTask('t-1', { status: 'DONE' })).resolves.toBeDefined()
    expect(gateEnabled).not.toHaveBeenCalled()
  })

  it('a human override (overrideDoneGate) sails past an open crossing', async () => {
    findOpen.mockResolvedValue(openCrossing())
    await expect(
      updateTask('t-1', { status: 'DONE' }, null, { overrideDoneGate: true })
    ).resolves.toBeDefined()
    expect(findOpen).not.toHaveBeenCalled()
  })

  it('does not run the boundary gate for a non-DONE transition', async () => {
    findOpen.mockResolvedValue(openCrossing())
    update.mockResolvedValue({
      ...TASK,
      status: 'IN_PROGRESS',
      team: { identifier: 'LUM' },
      teamId: 'team-1',
    })
    await expect(
      updateTask('t-1', { status: 'IN_PROGRESS' })
    ).resolves.toBeDefined()
    expect(findOpen).not.toHaveBeenCalled()
  })
})
