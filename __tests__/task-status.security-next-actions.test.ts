import {
  taskVerificationService,
  TASK_STATUS_SCHEMA_VERSION,
} from '@/lib/services/task-verification.service'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { notifyWorkspaceOwners } from '@/lib/notifications/notifyWorkspaceOwners'

jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: {
    listByTask: jest.fn(),
    listByTaskIncludingDeleted: jest.fn(),
    createMany: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    listForLifecycle: jest.fn(() => Promise.resolve([])),
  },
}))
jest.mock('@/lib/repositories/verification-run.repository', () => ({
  // Keep the real pure exports (isPassVerdict, deriveAllPassRoundTaskIds) —
  // only the DB-backed repository is faked.
  ...jest.requireActual('@/lib/repositories/verification-run.repository'),
  verificationRunRepository: {
    listByTask: jest.fn(),
    createMany: jest.fn(),
    maxRoundByTask: jest.fn(),
    latestHumanVerdictAction: jest.fn(() => Promise.resolve(null)),
  },
}))
// LUM-586: the read model reads withdrawal tombstones — fake them so the view
// resolves without a DB. Defaults = nothing withdrawn.
jest.mock('@/lib/repositories/verification-run-withdrawal.repository', () => ({
  verificationRunWithdrawalRepository: {
    actionIdsByTask: jest.fn(() => Promise.resolve(new Set())),
    latestByTask: jest.fn(() => Promise.resolve(null)),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn(), listByTaskAndType: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findHeaderById: jest.fn(),
    findStatus: jest.fn(),
    // LUM-573: null snapshot → the read path falls back to the live
    // latest-session claim, so existing claim expectations are unaffected.
    loadClaimSnapshot: jest.fn(() => Promise.resolve(null)),
  },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: { findActorByMemberId: jest.fn() },
}))
jest.mock('@/lib/notifications/notifyWorkspaceOwners', () => ({
  notifyWorkspaceOwners: jest.fn(),
}))
jest.mock('@/lib/services/task.service', () => ({
  taskService: {
    getTaskDetail: jest.fn(),
    updateTaskWithSideEffects: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/retrospective.repository', () => ({
  retrospectiveRepository: {
    loadActuals: jest.fn(() => Promise.resolve(null)),
    loadPerSessionCost: jest.fn(() => Promise.resolve([])),
  },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    // LUM-564: latest session's run-claim material; null = no session (no claim).
    loadLatestRunClaim: jest.fn(() => Promise.resolve(null)),
  },
}))
// LUM-583: statusForTask reads the persisted claim-faithfulness verdict.
jest.mock('@/lib/repositories/claim-faithfulness-verdict.repository', () => ({
  claimFaithfulnessVerdictRepository: {
    findByTaskId: jest.fn(() => Promise.resolve(null)),
  },
}))
jest.mock('@/lib/db/prisma', () => ({
  prisma: { $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn({})) },
}))
// LUM-737: undispositioned PR security findings feeding into nextActions.
jest.mock('@/lib/services/pr-security-reminder.service', () => ({
  prSecurityReminderService: { loadOpenFindingsForTask: jest.fn() },
}))

const listCriteria = acceptanceCriterionRepository.listByTask as jest.Mock
const listRuns = verificationRunRepository.listByTask as jest.Mock
const findHeader = taskRepository.findHeaderById as jest.Mock
const writeSpies = [
  acceptanceCriterionRepository.createMany as jest.Mock,
  verificationRunRepository.createMany as jest.Mock,
  activityRepository.create as jest.Mock,
  notifyWorkspaceOwners as jest.Mock,
]

const HEADER = {
  id: 't-1',
  number: 344,
  title: 'lumo task status',
  status: 'IN_PROGRESS',
  team: { identifier: 'LUM' },
}

function criterion(over: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    taskId: 't-1',
    statement: 'route rejects bad input',
    verifierType: 'MACHINE',
    checkpointer: 'npx jest x.test.ts',
    evidenceRequired: false,
    source: 'AGENT_DRAFT',
    addedAtRound: 0,
    createdAt: new Date('2026-06-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z'),
    ...over,
  }
}

function run(over: Record<string, unknown> = {}) {
  return {
    id: 'r-1',
    taskId: 't-1',
    criterionId: 'c-1',
    round: 1,
    verifierType: 'MACHINE',
    verdict: 'PASS',
    evidencePointer: 'cmd:npx jest x.test.ts#exit=0',
    rejectionReason: null,
    rejectionReasonEnum: null,
    createdAt: new Date('2026-06-02T10:00:00Z'),
    ...over,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  findHeader.mockResolvedValue(HEADER)
  listCriteria.mockResolvedValue([])
  listRuns.mockResolvedValue([])
  ;(
    acceptanceCriterionRepository.listByTaskIncludingDeleted as jest.Mock
  ).mockResolvedValue([])
  ;(activityRepository.listByTaskAndType as jest.Mock).mockResolvedValue([])
})

import { prSecurityReminderService } from '@/lib/services/pr-security-reminder.service'
const loadSecurity =
  prSecurityReminderService.loadOpenFindingsForTask as jest.Mock

const OPEN = {
  id: 'f1',
  kind: 'SECRET',
  ruleId: 'secret:aws-access-key-id',
  severity: 'HIGH',
  provenance: 'DETERMINISTIC',
  filePath: 'lib/cfg.ts',
  line: 12,
  title: 'AWS access key id',
  blocking: true,
  prNumber: 12,
  scanId: 's1',
}

describe('statusForTask — security findings (LUM-737)', () => {
  it('appends SECURITY_FINDING next actions after the unmet criteria and tags every criterion action kind=CRITERION', async () => {
    listCriteria.mockResolvedValue([criterion()])
    loadSecurity.mockResolvedValue({
      findings: [
        OPEN,
        {
          ...OPEN,
          id: 'f2',
          provenance: 'LLM_JUDGE',
          blocking: false,
          line: null,
        },
      ],
      blockingCount: 1,
      unconfirmedPrs: [{ number: 14, reason: 'FAILED' }],
      latestScans: [],
    })
    const s = await taskVerificationService.statusForTask('t-1')
    expect(s.nextActions.map(a => a.kind)).toEqual([
      'CRITERION',
      'SECURITY_FINDING',
      'SECURITY_FINDING',
    ])
    expect(s.nextActions[1]).toEqual({
      kind: 'SECURITY_FINDING',
      findingId: 'f1',
      statement:
        'secret:aws-access-key-id at lib/cfg.ts:12 — AWS access key id',
      severity: 'HIGH',
      provenance: 'DETERMINISTIC',
      blocking: true,
      prNumber: 12,
      ruleId: 'secret:aws-access-key-id',
      filePath: 'lib/cfg.ts',
      line: 12,
    })
    expect(s.securityFindings).toEqual({
      open: 2,
      blocking: 1,
      unconfirmedPrs: [{ number: 14, reason: 'FAILED' }],
    })
  })

  it('a failed security read yields securityFindings:null (could not confirm) and no SECURITY_FINDING actions', async () => {
    loadSecurity.mockRejectedValue(new Error('db down'))
    const s = await taskVerificationService.statusForTask('t-1')
    expect(s.securityFindings).toBeNull()
    expect(s.nextActions).toEqual([])
  })

  it('no open findings → an empty summary, not null', async () => {
    loadSecurity.mockResolvedValue({
      findings: [],
      blockingCount: 0,
      unconfirmedPrs: [],
      latestScans: [],
    })
    const s = await taskVerificationService.statusForTask('t-1')
    expect(s.securityFindings).toEqual({
      open: 0,
      blocking: 0,
      unconfirmedPrs: [],
    })
  })
})
