/**
 * @jest-environment node
 *
 * LUM-1186 — the task-status read model carries the Done gate (only when the
 * caller names its workspace) and says which proven test defects block DONE.
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
  readDoneGateInputs: jest.fn(),
}))
jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))

import { taskStatusService } from '@/lib/services/task-status.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import {
  readDoneGateInputs,
  readTestCaseAdvisories,
} from '@/lib/services/done-verdict.service'

const findHeader = taskRepository.findHeaderById as jest.Mock
const advisories = readTestCaseAdvisories as jest.Mock
const gateInputs = readDoneGateInputs as jest.Mock

const HEADER = {
  id: 't-1',
  number: 1186,
  title: 'done gate',
  status: 'IN_REVIEW',
  team: { identifier: 'LUM' },
}

const INPUTS = {
  confirmed: true,
  counts: {
    crossingsOpen: 0,
    crossingsBlocking: 0,
    crossingsTotal: 0,
    securityBlocking: 0,
    testsBlocking: 1,
  },
  opts: {
    securityScanned: false,
    showSecurity: false,
    tests: { total: 2, passing: 1 },
  },
}

beforeEach(() => {
  jest.clearAllMocks()
  findHeader.mockResolvedValue(HEADER)
  advisories.mockResolvedValue([])
  gateInputs.mockResolvedValue(INPUTS)
})

describe('statusForTask doneGate (LUM-1186)', () => {
  it('derives the gate from the header status when given a workspace', async () => {
    const s = await taskStatusService.statusForTask('t-1', 'w-1')
    expect(gateInputs).toHaveBeenCalledWith('t-1', 'w-1')
    expect(s.doneGate).toMatchObject({
      confirmed: true,
      headline: 'blocked',
      security: null,
      tests: { state: 'blocked', blocking: 1, passing: 1, total: 2 },
    })
  })

  it('a DONE task reads accepted', async () => {
    findHeader.mockResolvedValue({ ...HEADER, status: 'DONE' })
    const s = await taskStatusService.statusForTask('t-1', 'w-1')
    expect(s.doneGate).toMatchObject({ headline: 'accepted' })
  })

  it('passes an unconfirmed gate through', async () => {
    gateInputs.mockResolvedValue({
      confirmed: false,
      unconfirmed: ['test cases'],
    })
    const s = await taskStatusService.statusForTask('t-1', 'w-1')
    expect(s.doneGate).toEqual({
      confirmed: false,
      unconfirmed: ['test cases'],
    })
  })

  it('omits the gate without a workspace (internal roll-ups)', async () => {
    const s = await taskStatusService.statusForTask('t-1')
    expect(gateInputs).not.toHaveBeenCalled()
    expect(s).not.toHaveProperty('doneGate')
  })
})

describe('TEST_CASE_VERDICT blocking (LUM-1186)', () => {
  it('an unruled proven defect blocks; ruled-on and other signals do not', async () => {
    advisories.mockResolvedValue([
      {
        number: 1,
        title: 'a',
        signal: 'PROVEN_DEFECT',
        runId: 'r1',
        dispositioned: false,
      },
      {
        number: 2,
        title: 'b',
        signal: 'PROVEN_DEFECT',
        runId: 'r2',
        dispositioned: true,
      },
      {
        number: 3,
        title: 'c',
        signal: 'UNPROVEN_PASS',
        runId: 'r3',
        dispositioned: false,
        ceilingReason: 'no-evidence',
      },
    ])
    const s = await taskStatusService.statusForTask('t-1', 'w-1')
    const rows = s.nextActions.filter(a => a.kind === 'TEST_CASE_VERDICT')
    expect(rows.map(r => [r.number, r.blocking, r.advisory])).toEqual([
      [1, true, false],
      [2, false, true],
      [3, false, true],
    ])
  })
})
