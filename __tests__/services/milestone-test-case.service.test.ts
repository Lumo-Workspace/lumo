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
  it('update patches only provided fields, passes nulls through, and dispatches the rollup', async () => {
    repo.findByMilestoneAndNumber.mockResolvedValue(mcase as never)
    repo.update.mockResolvedValue(mcase as never)
    await milestoneTestCaseService.update(
      'm-1',
      'TC1',
      { title: 'New', setup: null, requiredEnvironment: null } as never,
      attribution
    )
    expect(repo.update).toHaveBeenCalledWith(mcase.id, {
      title: 'New',
      setup: null,
      requiredEnvironment: null,
    })
    expect(mockDispatch).toHaveBeenCalledWith('m-1')
  })

  it('update is refused with 409 on a completed milestone', async () => {
    mockFindMilestone.mockResolvedValue({ ...active, completedAt: new Date() })
    await expect(
      milestoneTestCaseService.update(
        'm-1',
        'TC1',
        { title: 'x' } as never,
        attribution
      )
    ).rejects.toMatchObject({ status: 409 })
    expect(repo.update).not.toHaveBeenCalled()
  })

  it('list maps cases with their runs, executedBy and the gate', async () => {
    const run = { id: 'r1', testCaseId: mcase.id, executedByMemberId: 'mem-1' }
    repo.listForMilestone.mockResolvedValue([mcase] as never)
    repo.runsPerCaseForMilestone.mockResolvedValue(
      new Map([[mcase.id, [run]]]) as never
    )
    const res = await milestoneTestCaseService.list('m-1', 'mem-1')
    expect(res.testCases).toHaveLength(1)
    expect(res.testCases[0]!.runs[0]).toMatchObject({
      id: 'r1',
      executedBy: 'mem-1',
    })
    expect(res.gate).toEqual({ held: 0, unresolvedCriteria: 0, cases: [] })
  })

  it('getDetail returns the case with its runs', async () => {
    repo.findByMilestoneAndNumber.mockResolvedValue(mcase as never)
    repo.listRuns.mockResolvedValue([
      { id: 'r1', executedByMemberId: null },
    ] as never)
    const res = await milestoneTestCaseService.getDetail('m-1', 'TC1', 'mem-1')
    expect(res.testCase).toBe(mcase)
    expect(res.runs[0]).toMatchObject({ id: 'r1', executedBy: null })
    // Same shape as the task detail — the CLI's show reads pullRequests.
    expect(res.pullRequests).toEqual([])
  })

  it('resolveCase returns the case, and 404s for another milestone cuid', async () => {
    repo.findById.mockResolvedValue(mcase as never)
    await expect(
      milestoneTestCaseService.resolveCase('m-1', mcase.id, 'mem-1')
    ).resolves.toBe(mcase)
    repo.findById.mockResolvedValue({
      ...mcase,
      milestoneId: 'm-other',
    } as never)
    await expect(
      milestoneTestCaseService.resolveCase('m-1', mcase.id, 'mem-1')
    ).rejects.toMatchObject({ status: 404 })
  })

  it('create and remove dispatch the rollup', async () => {
    repo.createWithNumber.mockResolvedValue(mcase as never)
    await milestoneTestCaseService.create(
      'm-1',
      { title: 'E2E', steps: ['a'], verification: [], expected: 'e' } as never,
      attribution
    )
    expect(mockDispatch).toHaveBeenCalledWith('m-1')
    mockDispatch.mockClear()
    repo.findByMilestoneAndNumber.mockResolvedValue(mcase as never)
    await milestoneTestCaseService.remove('m-1', 'TC1', attribution)
    expect(repo.softDelete).toHaveBeenCalledWith(mcase.id)
    expect(mockDispatch).toHaveBeenCalledWith('m-1')
  })
})
