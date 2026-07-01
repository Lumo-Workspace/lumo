/**
 * @jest-environment node
 */
jest.mock('@/lib/auth', () => ({
  requireIdentity: jest.fn(),
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: {
    findById: jest.fn(),
    countTasksByStatus: jest.fn(),
    sprintCoverageCounts: jest.fn(),
    outcomeRollupRows: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/sprint.repository', () => ({
  sprintRepository: { findByIds: jest.fn() },
}))
jest.mock('@/lib/services/project.service', () => ({
  projectService: { getProject: jest.fn() },
}))

import { GET } from '@/app/api/milestones/[milestoneId]/route'
import { milestoneService } from '@/lib/services/milestone.service'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { sprintRepository } from '@/lib/repositories/sprint.repository'
import { projectService } from '@/lib/services/project.service'
import { requireIdentity } from '@/lib/auth'

const mockIdentity = requireIdentity as jest.Mock
const findById = milestoneRepository.findById as jest.Mock
const countTasksByStatus = milestoneRepository.countTasksByStatus as jest.Mock
const sprintCoverageCounts =
  milestoneRepository.sprintCoverageCounts as jest.Mock
const outcomeRollupRows = milestoneRepository.outcomeRollupRows as jest.Mock
const findByIds = sprintRepository.findByIds as jest.Mock
const getProject = projectService.getProject as jest.Mock

beforeEach(() => {
  mockIdentity.mockReset()
  findById.mockReset()
  countTasksByStatus.mockReset()
  sprintCoverageCounts.mockReset()
  outcomeRollupRows.mockReset()
  findByIds.mockReset()
  getProject.mockReset()
})

const rollupRows = {
  tasks: [
    {
      id: 't1',
      number: 283,
      title: 'Bundle diet',
      status: 'DONE',
      claimSnapshot: '首屏 -298KB',
      claimSnapshotSource: 'AGENT',
      team: { identifier: 'LUM' },
    },
    {
      id: 't2',
      number: 290,
      title: 'No-claim delivery',
      status: 'DONE',
      claimSnapshot: null,
      claimSnapshotSource: null,
      team: { identifier: 'LUM' },
    },
  ],
  signalCounts: [{ taskId: 't1', kind: 'REVERTED', count: 1 }],
}

describe('milestoneService.getOutcomeForMilestone', () => {
  it('maps repository rows into the outcome rollup (ref = identifier-number)', async () => {
    outcomeRollupRows.mockResolvedValue(rollupRows)

    const outcome = await milestoneService.getOutcomeForMilestone('m-1')

    expect(outcomeRollupRows).toHaveBeenCalledWith('m-1')
    expect(outcome.claims).toEqual([
      {
        taskId: 't1',
        ref: 'LUM-283',
        title: 'Bundle diet',
        claim: '首屏 -298KB',
        source: 'AGENT',
      },
      {
        taskId: 't2',
        ref: 'LUM-290',
        title: 'No-claim delivery',
        claim: null,
        source: null,
      },
    ])
    expect(outcome.fate).toEqual({
      doneCount: 2,
      rejected: [
        {
          taskId: 't1',
          ref: 'LUM-283',
          title: 'Bundle diet',
          kinds: [{ kind: 'REVERTED', count: 1 }],
        },
      ],
      inconclusiveCount: 1,
    })
  })
})

describe('GET /api/milestones/[milestoneId]', () => {
  it('enriches the milestone response with the outcome section', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1' })
    findById.mockResolvedValue({
      id: 'm-1',
      projectId: 'p-1',
      status: 'PLANNED',
      targetDate: null,
    })
    getProject.mockResolvedValue({ id: 'p-1', teamId: 'team-1' })
    countTasksByStatus.mockResolvedValue({
      TODO: 0,
      IN_PROGRESS: 0,
      IN_REVIEW: 0,
      DONE: 2,
    })
    sprintCoverageCounts.mockResolvedValue([])
    findByIds.mockResolvedValue([])
    outcomeRollupRows.mockResolvedValue(rollupRows)

    const res = await GET(new Request('http://x/api/milestones/m-1') as never, {
      params: Promise.resolve({ milestoneId: 'm-1' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.milestone.outcome.claims).toHaveLength(2)
    expect(body.milestone.outcome.claims[0]).toMatchObject({
      ref: 'LUM-283',
      claim: '首屏 -298KB',
      source: 'AGENT',
    })
    expect(body.milestone.outcome.fate).toMatchObject({
      doneCount: 2,
      inconclusiveCount: 1,
    })
    expect(body.milestone.outcome.fate.rejected).toHaveLength(1)
  })
})
