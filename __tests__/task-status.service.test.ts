/**
 * @jest-environment node
 *
 * LUM-942 — the task-status read model after acceptance criteria and
 * verification rounds were removed: rework (PR cycles + reopens), cost, trend,
 * security / test-case next actions, and the v1 padding old CLIs rely on.
 */
// LUM-1064: plugin cases live in __tests__/ee/security/task-status.service.test.ts.
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    listForLifecycle: jest.fn(() => Promise.resolve([])),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { listByTaskAndType: jest.fn(() => Promise.resolve([])) },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findHeaderById: jest.fn(),
    loadClaimSnapshot: jest.fn(() => Promise.resolve(null)),
  },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    loadLatestRunClaim: jest.fn(() => Promise.resolve(null)),
  },
}))
jest.mock('@/lib/repositories/claim-faithfulness-verdict.repository', () => ({
  claimFaithfulnessVerdictRepository: {
    findByTaskId: jest.fn(() => Promise.resolve(null)),
  },
}))
jest.mock('@/lib/repositories/retrospective.repository', () => ({
  retrospectiveRepository: {
    loadActuals: jest.fn(() => Promise.resolve(null)),
    loadPerSessionCost: jest.fn(() => Promise.resolve([])),
  },
}))
// LUM-1064: core test, run without the security plugin (the OSS build).
jest.mock('@/lib/plugins/installed', () => ({ INSTALLED_SERVER_PLUGINS: [] }))
jest.mock('@/lib/services/test-case-reminder.service', () => ({
  testCaseReminderService: {
    stateForTask: jest.fn(() => Promise.resolve(null)),
  },
}))
jest.mock('@/lib/services/done-verdict.service', () => ({
  readTestCaseAdvisories: jest.fn(() => Promise.resolve([])),
}))
jest.mock('@/lib/services/test-case-review.service', () => ({
  testCaseReviewService: {
    sentBackForTask: jest.fn(() => Promise.resolve([])),
  },
}))
jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))

import {
  taskStatusService,
  withLegacyV1Fields,
  TASK_STATUS_SCHEMA_VERSION,
} from '@/lib/services/task-status.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { retrospectiveRepository } from '@/lib/repositories/retrospective.repository'
import { testCaseReminderService } from '@/lib/services/test-case-reminder.service'
import { readTestCaseAdvisories } from '@/lib/services/done-verdict.service'

const findHeader = taskRepository.findHeaderById as jest.Mock
const listPrs = pullRequestRepository.listForLifecycle as jest.Mock
const listActivities = activityRepository.listByTaskAndType as jest.Mock
const loadActuals = retrospectiveRepository.loadActuals as jest.Mock
const loadPerSessionCost =
  retrospectiveRepository.loadPerSessionCost as jest.Mock
const testCaseState = testCaseReminderService.stateForTask as jest.Mock
const testCaseAdvisories = readTestCaseAdvisories as jest.Mock

const HEADER = {
  id: 't-1',
  number: 942,
  title: 'remove criteria',
  status: 'IN_PROGRESS',
  team: { identifier: 'LUM' },
}

function statusEvent(from: string, to: string, at: string) {
  return { payload: { from, to }, createdAt: new Date(at) }
}

beforeEach(() => {
  jest.clearAllMocks()
  findHeader.mockResolvedValue(HEADER)
  listPrs.mockResolvedValue([])
  listActivities.mockResolvedValue([])
  loadActuals.mockResolvedValue(null)
  loadPerSessionCost.mockResolvedValue([])
  testCaseState.mockResolvedValue(null)
  testCaseAdvisories.mockResolvedValue([])
})

describe('taskStatusService.statusForTask (LUM-942)', () => {
  it('404s when the task is gone', async () => {
    findHeader.mockResolvedValue(null)
    await expect(taskStatusService.statusForTask('t-1')).rejects.toMatchObject({
      status: 404,
    })
  })

  it('emits schema v2 with no criteria / verification fields', async () => {
    const s = await taskStatusService.statusForTask('t-1')
    expect(s.version).toBe(2)
    expect(TASK_STATUS_SCHEMA_VERSION).toBe(2)
    expect(s.task).toEqual({
      id: 't-1',
      identifier: 'LUM-942',
      title: 'remove criteria',
      status: 'IN_PROGRESS',
    })
    for (const gone of [
      'criteria',
      'currentRound',
      'maxRounds',
      'verificationHistory',
      'machineVerification',
      'removedCriteria',
    ]) {
      expect(s).not.toHaveProperty(gone)
    }
  })

  it('derives rework from PR cycles and backward status transitions only', async () => {
    listPrs.mockResolvedValue([
      { number: 1, url: 'u1', createdAt: new Date() },
      { number: 2, url: 'u2', createdAt: new Date() },
      { number: 3, url: 'u3', createdAt: new Date() },
    ])
    listActivities.mockResolvedValue([
      statusEvent('TODO', 'IN_PROGRESS', '2026-10-01T00:00:00Z'),
      statusEvent('IN_PROGRESS', 'IN_REVIEW', '2026-10-02T00:00:00Z'),
      statusEvent('IN_REVIEW', 'IN_PROGRESS', '2026-10-03T00:00:00Z'),
      { payload: null, createdAt: new Date('2026-10-04T00:00:00Z') },
    ])
    const s = await taskStatusService.statusForTask('t-1')
    expect(listActivities).toHaveBeenCalledWith('t-1', 'STATUS_CHANGED')
    expect(s.struggleTrail.pullRequests).toEqual([
      { number: 1, url: 'u1' },
      { number: 2, url: 'u2' },
      { number: 3, url: 'u3' },
    ])
    expect(s.struggleTrail.reopens).toEqual([
      { from: 'IN_REVIEW', to: 'IN_PROGRESS', at: '2026-10-03T00:00:00.000Z' },
    ])
    expect(s.trend.rework).toEqual({ reopens: 1, extraPrCycles: 2, total: 3 })
  })

  it('keeps "not measured" tokens distinct from a measured 0', async () => {
    const unmeasured = await taskStatusService.statusForTask('t-1')
    expect(unmeasured.cost).toEqual({ tokenCost: null, activeTimeSec: 0 })

    loadActuals.mockResolvedValue({ tokenCost: 0, totalDurationSec: 42 })
    loadPerSessionCost.mockResolvedValue([
      {
        sessionId: 's-1',
        tokenCost: 0,
        loopCount: 2,
        startedAt: new Date('2026-10-01T00:00:00Z'),
      },
    ])
    const measured = await taskStatusService.statusForTask('t-1')
    expect(measured.cost).toEqual({ tokenCost: 0, activeTimeSec: 42 })
    expect(measured.trend.cost).toEqual([
      {
        sessionId: 's-1',
        total: 0,
        loopCount: 2,
        at: '2026-10-01T00:00:00.000Z',
      },
    ])
  })

  // LUM-1064: with no plugin installed the core contributes no security
  // read-out at all — the field is absent and only test-case actions remain.
  it('without a plugin, omits securityFindings and lists only test-case advisories', async () => {
    testCaseState.mockResolvedValue({
      hasLinkedPr: true,
      hasTestCases: false,
      taskDone: false,
    })
    testCaseAdvisories.mockResolvedValue([
      {
        number: 2,
        title: 'login',
        signal: 'PROVEN_DEFECT',
        runId: 'r',
        dispositioned: false,
      },
    ])
    const s = await taskStatusService.statusForTask('t-1')
    expect(s).not.toHaveProperty('securityFindings')
    expect(s.nextActions.map(a => a.kind)).toEqual([
      'TEST_CASE',
      'TEST_CASE_VERDICT',
    ])
  })
})

describe('withLegacyV1Fields (LUM-942 old-CLI compatibility)', () => {
  it('pads the removed v1 fields with empty values and keeps the v2 data', async () => {
    listPrs.mockResolvedValue([{ number: 1, url: 'u1', createdAt: new Date() }])
    const report = await taskStatusService.statusForTask('t-1')
    const padded = withLegacyV1Fields(report)
    expect(padded).toMatchObject({
      version: 2,
      currentRound: 0,
      maxRounds: 0,
      escalated: false,
      criteria: [],
      removedCriteria: [],
      verificationHistory: [],
      lastRoundFailures: [],
      undoableHumanVerdict: null,
      lastVerdictWithdrawal: null,
      machineVerification: { total: 0, machineVerified: 0, humanOverridden: 0 },
      struggleTrail: {
        pullRequests: [{ number: 1, url: 'u1' }],
        reworkRounds: [],
        sendBacks: [],
        followUps: [],
      },
      cost: { tokenCost: null, activeTimeSec: 0, reworkRounds: 0 },
      trend: { passRate: [], rework: { reworkRounds: 0, extraPrCycles: 0 } },
    })
  })
})

describe('taskStatusService.aggregateStruggleForTasks', () => {
  it('rolls up reopens / extra PR cycles and drops tasks that 404', async () => {
    findHeader.mockImplementation((id: string) =>
      Promise.resolve(
        id === 'gone' ? null : { ...HEADER, id, number: id === 'a' ? 1 : 2 }
      )
    )
    listPrs.mockImplementation((id: string) =>
      Promise.resolve(
        id === 'a'
          ? [
              { number: 1, url: 'u1', createdAt: new Date() },
              { number: 2, url: 'u2', createdAt: new Date() },
            ]
          : []
      )
    )
    const agg = await taskStatusService.aggregateStruggleForTasks([
      'a',
      'b',
      'gone',
    ])
    expect(agg).toEqual({
      tasksConsidered: 2,
      tasksWithStruggle: 1,
      reopens: 0,
      extraPrCycles: 1,
      hardTasks: [
        {
          identifier: 'LUM-1',
          title: 'remove criteria',
          reopens: 0,
          extraPrCycles: 1,
        },
      ],
    })
  })
})
