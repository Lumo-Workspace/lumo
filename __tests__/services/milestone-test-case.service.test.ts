const mockGetProject = jest.fn()
const mockFindMilestone = jest.fn()
const mockDispatch = jest.fn()

jest.mock('@/lib/services/project.service', () => ({
  projectService: { getProject: (...a: unknown[]) => mockGetProject(...a) },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: {
    findById: (...a: unknown[]) => mockFindMilestone(...a),
  },
}))
jest.mock('@/lib/services/milestone-rollup.service', () => ({
  milestoneRollupService: {
    dispatchRollup: (...a: unknown[]) => mockDispatch(...a),
  },
}))
jest.mock('@/lib/services/milestone-close-gate.service', () => ({
  milestoneCloseGateService: {
    read: jest
      .fn()
      .mockResolvedValue({ held: 0, unresolvedCriteria: 0, cases: [] }),
  },
}))
jest.mock('@/lib/repositories/test-case.repository', () => ({
  testCaseRepository: {
    createWithNumber: jest.fn(),
    listForMilestone: jest.fn(),
    findById: jest.fn(),
    findByMilestoneAndNumber: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    createRun: jest.fn(),
    listRuns: jest.fn(),
    runsPerCaseForMilestone: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findActorByMemberId: jest.fn(),
    labelsByIds: jest.fn().mockResolvedValue(new Map()),
  },
}))
jest.mock('@/lib/db/transaction', () => ({
  runInTransaction: (fn: (tx: unknown) => unknown) => fn({}),
}))

import { milestoneTestCaseService } from '@/lib/services/milestone-test-case.service'
import { testCaseRepository } from '@/lib/repositories/test-case.repository'

const repo = testCaseRepository as jest.Mocked<typeof testCaseRepository>
const attribution = { actorMemberId: 'mem-1', sourceSessionId: null }
const active = {
  id: 'm-1',
  projectId: 'p-1',
  archivedAt: null,
  completedAt: null,
}
const mcase = {
  id: 'cabcdefghijklmnopqrstuvwx',
  taskId: null,
  milestoneId: 'm-1',
  number: 1,
  title: 'E2E',
  setup: null,
  steps: ['a'],
  verification: [],
  expected: 'e',
  requiredEnvironment: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFindMilestone.mockResolvedValue(active)
  mockGetProject.mockResolvedValue({ id: 'p-1' })
})

describe('milestoneTestCaseService', () => {
  it('404s for an unknown milestone', async () => {
    mockFindMilestone.mockResolvedValue(null)
    await expect(
      milestoneTestCaseService.list('nope', 'mem-1')
    ).rejects.toMatchObject({ status: 404 })
  })

  it('propagates the project membership refusal', async () => {
    mockGetProject.mockRejectedValue(
      Object.assign(new Error('Forbidden'), { status: 403 })
    )
    await expect(
      milestoneTestCaseService.list('m-1', 'mem-1')
    ).rejects.toMatchObject({ status: 403 })
  })

  it('authorize is public and propagates the membership refusal', async () => {
    await expect(
      milestoneTestCaseService.authorize('m-1', 'mem-1')
    ).resolves.toBeUndefined()
    mockGetProject.mockRejectedValue(
      Object.assign(new Error('Forbidden'), { status: 403 })
    )
    await expect(
      milestoneTestCaseService.authorize('m-1', 'mem-2')
    ).rejects.toMatchObject({ status: 403 })
  })

  it('creates a case owned by the milestone', async () => {
    repo.createWithNumber.mockResolvedValue(mcase as never)
    await milestoneTestCaseService.create(
      'm-1',
      { title: 'E2E', steps: ['a'], verification: [], expected: 'e' } as never,
      attribution
    )
    expect(repo.createWithNumber).toHaveBeenCalledWith(
      expect.objectContaining({ milestoneId: 'm-1', title: 'E2E' }),
      expect.anything()
    )
    expect(repo.createWithNumber.mock.calls[0]![0]).not.toHaveProperty('taskId')
  })

  it('locks the contract on a completed milestone (409) but still records runs', async () => {
    mockFindMilestone.mockResolvedValue({ ...active, completedAt: new Date() })
    await expect(
      milestoneTestCaseService.create(
        'm-1',
        { title: 'x', steps: ['a'], verification: [], expected: 'e' } as never,
        attribution
      )
    ).rejects.toMatchObject({ status: 409 })

    repo.findByMilestoneAndNumber.mockResolvedValue(mcase as never)
    repo.createRun.mockResolvedValue({
      id: 'r1',
      result: 'PASS',
      environment: 'PRODUCTION',
      evidence: [],
    } as never)
    await milestoneTestCaseService.recordRun(
      'm-1',
      'TC1',
      { result: 'PASS', environment: 'PRODUCTION' } as never,
      attribution
    )
    expect(repo.createRun).toHaveBeenCalledWith(
      expect.objectContaining({ milestoneId: 'm-1', taskId: null })
    )
  })

  it('locks the contract on an archived milestone', async () => {
    mockFindMilestone.mockResolvedValue({ ...active, archivedAt: new Date() })
    await expect(
      milestoneTestCaseService.remove('m-1', 'TC1', attribution)
    ).rejects.toMatchObject({ status: 409 })
  })

  it('resolves a cuid only when it belongs to this milestone', async () => {
    repo.findById.mockResolvedValue({
      ...mcase,
      milestoneId: 'm-other',
    } as never)
    await expect(
      milestoneTestCaseService.getDetail('m-1', mcase.id, 'mem-1')
    ).rejects.toMatchObject({ status: 404 })
    repo.findById.mockResolvedValue({
      ...mcase,
      milestoneId: null,
      taskId: 't-1',
    } as never)
    await expect(
      milestoneTestCaseService.getDetail('m-1', mcase.id, 'mem-1')
    ).rejects.toMatchObject({ status: 404 })
  })

  it('rejects a PR number on a milestone run', async () => {
    repo.findByMilestoneAndNumber.mockResolvedValue(mcase as never)
    await expect(
      milestoneTestCaseService.recordRun(
        'm-1',
        'TC1',
        {
          result: 'PASS',
          environment: 'LOCAL',
          pullRequestNumber: 12,
        } as never,
        attribution
      )
    ).rejects.toMatchObject({ status: 400 })
  })

  it('dispatches the rollup after a run', async () => {
    repo.findByMilestoneAndNumber.mockResolvedValue(mcase as never)
    repo.createRun.mockResolvedValue({
      id: 'r1',
      result: 'PASS',
      environment: 'LOCAL',
      evidence: [],
    } as never)
    await milestoneTestCaseService.recordRun(
      'm-1',
      'TC1',
      { result: 'PASS', environment: 'LOCAL' } as never,
      attribution
    )
    expect(mockDispatch).toHaveBeenCalledWith('m-1')
  })
})
