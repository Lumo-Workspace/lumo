import { updateTask } from '@/lib/services/task-state.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'

// updateTask's own deps — mocked so the test isolates the LUM-422 ④ DONE gate.
// LUM-732: the DONE gate now consults the PR security scan. No linked PR here,
// so the real gate short-circuits before touching the scan repository.
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findManyForSecurityByTaskId: jest.fn().mockResolvedValue([]),
  },
}))
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
// LUM-426 boundary gate runs alongside the send-back gate on DONE — default it
// to "nothing flagged" so these tests keep isolating the LUM-422 ④ gate.
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    findUndispositionedByTask: jest.fn(() => Promise.resolve([])),
    isGateEnabledForWorkspace: jest.fn(() => Promise.resolve(true)),
  },
}))

const findForUpdate = taskRepository.findForUpdate as jest.Mock
const update = taskRepository.update as jest.Mock
const latestRuns = verificationRunRepository.latestRunsByCriterion as jest.Mock
const listCriteria = acceptanceCriterionRepository.listByTask as jest.Mock

const TASK = {
  id: 't-1',
  status: 'IN_PROGRESS',
  projectId: 'p-1',
  project: { workspaceId: 'w-1' },
  sprintId: null,
  assigneeActorId: null,
  parentTaskId: null,
}

beforeEach(() => {
  jest.clearAllMocks()
  findForUpdate.mockResolvedValue({ ...TASK })
  update.mockResolvedValue({
    ...TASK,
    status: 'DONE',
    team: { identifier: 'LUM' },
    teamId: 'team-1',
  })
  latestRuns.mockResolvedValue(new Map())
  listCriteria.mockResolvedValue([
    { id: 'c-1', statement: 'the retry path is covered' },
  ])
})

const failMap = () =>
  new Map([['c-1', { criterionId: 'c-1', verdict: 'FAIL' }]])
const passMap = () =>
  new Map([['c-1', { criterionId: 'c-1', verdict: 'PASS' }]])

describe('LUM-422 ④ DONE gate', () => {
  it('refuses a DONE transition with 409 while a criterion latest verdict is FAIL', async () => {
    latestRuns.mockResolvedValue(failMap())
    await expect(updateTask('t-1', { status: 'DONE' })).rejects.toMatchObject({
      status: 409,
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('lists the unresolved criterion statements in the 409 message', async () => {
    latestRuns.mockResolvedValue(failMap())
    await expect(updateTask('t-1', { status: 'DONE' })).rejects.toThrow(
      /the retry path is covered/
    )
  })

  it('blocks regardless of the verdict channel (AGENT FAIL is a send-back too)', async () => {
    latestRuns.mockResolvedValue(
      new Map([['c-1', { criterionId: 'c-1', verdict: 'FAIL' }]])
    )
    await expect(updateTask('t-1', { status: 'DONE' })).rejects.toMatchObject({
      status: 409,
    })
  })

  it('lets a human override the gate (overrideDoneGate) past the FAIL', async () => {
    latestRuns.mockResolvedValue(failMap())
    await expect(
      updateTask('t-1', { status: 'DONE' }, null, { overrideDoneGate: true })
    ).resolves.toBeDefined()
    expect(update).toHaveBeenCalled()
    // Overridden → it never even needs to look up the verdicts.
    expect(latestRuns).not.toHaveBeenCalled()
  })

  it('transitions freely when the latest verdicts all pass', async () => {
    latestRuns.mockResolvedValue(passMap())
    await expect(updateTask('t-1', { status: 'DONE' })).resolves.toBeDefined()
    expect(update).toHaveBeenCalledWith(
      't-1',
      expect.objectContaining({ status: 'DONE' })
    )
  })

  it('never blocks an un-adjudicated criterion (no runs = tacit pass)', async () => {
    latestRuns.mockResolvedValue(new Map())
    await expect(updateTask('t-1', { status: 'DONE' })).resolves.toBeDefined()
    expect(update).toHaveBeenCalled()
    // No FAIL in the latest map → never fetches criterion statements.
    expect(listCriteria).not.toHaveBeenCalled()
  })

  it('does not run the gate for a non-DONE transition even with a standing FAIL', async () => {
    latestRuns.mockResolvedValue(failMap())
    await update.mockResolvedValue({
      ...TASK,
      status: 'IN_REVIEW',
      team: { identifier: 'LUM' },
      teamId: 'team-1',
    })
    await expect(
      updateTask('t-1', { status: 'IN_REVIEW' })
    ).resolves.toBeDefined()
    expect(latestRuns).not.toHaveBeenCalled()
  })
})
