/**
 * @jest-environment node
 */
/**
 * LUM-1064: plugin half of __tests__/task-status.service.test.ts (split)
 *
 * LUM-942 — the task-status read model after acceptance criteria and
 * verification rounds were removed: rework (PR cycles + reopens), cost, trend,
 * security / test-case next actions, and the v1 padding old CLIs rely on.
 */
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
jest.mock('@/ee/security/services/pr-security-reminder.service', () => ({
  prSecurityReminderService: {
    loadOpenFindingsForTask: jest.fn(() => Promise.resolve(null)),
  },
}))
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

import { taskStatusService } from '@/lib/services/task-status.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { retrospectiveRepository } from '@/lib/repositories/retrospective.repository'
import { prSecurityReminderService } from '@/ee/security/services/pr-security-reminder.service'
import { testCaseReminderService } from '@/lib/services/test-case-reminder.service'
import { readTestCaseAdvisories } from '@/lib/services/done-verdict.service'

const findHeader = taskRepository.findHeaderById as jest.Mock
const listPrs = pullRequestRepository.listForLifecycle as jest.Mock
const listActivities = activityRepository.listByTaskAndType as jest.Mock
const loadActuals = retrospectiveRepository.loadActuals as jest.Mock
const loadPerSessionCost =
  retrospectiveRepository.loadPerSessionCost as jest.Mock
const loadFindings =
  prSecurityReminderService.loadOpenFindingsForTask as jest.Mock
const testCaseState = testCaseReminderService.stateForTask as jest.Mock
const testCaseAdvisories = readTestCaseAdvisories as jest.Mock

const HEADER = {
  id: 't-1',
  number: 942,
  title: 'remove criteria',
  status: 'IN_PROGRESS',
  team: { identifier: 'LUM' },
}

beforeEach(() => {
  jest.clearAllMocks()
  findHeader.mockResolvedValue(HEADER)
  listPrs.mockResolvedValue([])
  listActivities.mockResolvedValue([])
  loadActuals.mockResolvedValue(null)
  loadPerSessionCost.mockResolvedValue([])
  loadFindings.mockResolvedValue(null)
  testCaseState.mockResolvedValue(null)
  testCaseAdvisories.mockResolvedValue([])
})

describe('taskStatusService.statusForTask (LUM-942)', () => {
  it('reports a failed security read as null, never as clean', async () => {
    loadFindings.mockRejectedValue(new Error('db down'))
    const s = await taskStatusService.statusForTask('t-1')
    expect(s.securityFindings).toBeNull()
    expect(s.nextActions).toEqual([])
  })

  it('lists security findings first, then test-case advisories', async () => {
    loadFindings.mockResolvedValue({
      findings: [
        {
          id: 'f-1',
          severity: 'HIGH',
          provenance: 'DETERMINISTIC',
          blocking: true,
          prNumber: 7,
          ruleId: 'secret',
          filePath: 'a.ts',
          line: 3,
          message: 'leaked key',
        },
      ],
      blockingCount: 1,
      unconfirmedPrs: [],
      scans: [],
    })
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
    expect(s.nextActions.map(a => a.kind)).toEqual([
      'SECURITY_FINDING',
      'TEST_CASE',
      'TEST_CASE_VERDICT',
    ])
    expect(s.securityFindings).toMatchObject({ open: 1, blocking: 1 })
  })
})

describe('withLegacyV1Fields (LUM-942 old-CLI compatibility)', () => {})

describe('taskStatusService.aggregateStruggleForTasks', () => {})
