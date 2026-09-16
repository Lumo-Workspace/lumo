import { readFileSync, readdirSync } from 'fs'
import path from 'path'
import { taskCriteriaService } from '@/lib/services/task-criteria.service'
import { taskVerificationService } from '@/lib/services/task-verification.service'
import { humanJudgeStepsWarning } from '@/lib/validation/acceptance'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { taskRepository } from '@/lib/repositories/task.repository'

jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: {
    create: jest.fn(),
    listByTask: jest.fn(),
    listByTaskIncludingDeleted: jest.fn(),
    countByTask: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    softDelete: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    listForLifecycle: jest.fn(() => Promise.resolve([])),
  },
}))
jest.mock('@/lib/repositories/verification-run.repository', () => ({
  ...jest.requireActual('@/lib/repositories/verification-run.repository'),
  verificationRunRepository: {
    maxRoundByTask: jest.fn(),
    latestRunsByCriterion: jest.fn(),
    listByTask: jest.fn(),
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
    // LUM-573: statusForTask reads the frozen claim snapshot; null → live fallback.
    loadClaimSnapshot: jest.fn(() => Promise.resolve(null)),
  },
}))
// LUM-564 / LUM-583: statusForTask also reads the latest session's run-claim
// material and the persisted claim-faithfulness verdict.
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
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: { findVerificationMaxRounds: jest.fn() },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findActorByMemberId: jest.fn(async () => ({ id: 'actor-1' })),
  },
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
const TX = { __tx: true }
jest.mock('@/lib/repositories/retrospective.repository', () => ({
  retrospectiveRepository: {
    loadActuals: jest.fn(() => Promise.resolve(null)),
    loadPerSessionCost: jest.fn(() => Promise.resolve([])),
  },
}))
jest.mock('@/lib/db/prisma', () => ({
  prisma: { $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(TX)) },
}))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))

const repo = acceptanceCriterionRepository as jest.Mocked<
  typeof acceptanceCriterionRepository
>
const runRepo = verificationRunRepository as unknown as {
  maxRoundByTask: jest.Mock
  latestRunsByCriterion: jest.Mock
  listByTask: jest.Mock
}
const activity = activityRepository as unknown as {
  create: jest.Mock
  listByTaskAndType: jest.Mock
}
const findHeader = taskRepository.findHeaderById as jest.Mock

const ATTRIBUTION = { actorMemberId: 'member-1', sourceSessionId: 'sess-1' }
const HEADER = {
  id: 't-1',
  number: 465,
  title: 'human-judgeable criteria',
  status: 'IN_REVIEW',
  team: { identifier: 'LUM' },
}
const JUDGE =
  'Open the acceptance tab. Read the steps. Pass if URLs are clickable.'

function criterion(over: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    taskId: 't-1',
    statement: 'the card renders steps',
    verifierType: 'HUMAN' as const,
    checkpointer: null,
    evidenceRequired: false,
    referentKind: 'EXTERNAL_FACT' as const,
    source: 'AGENT_DRAFT' as const,
    addedAtRound: 0,
    judgeSteps: null as string | null,
    createdAt: new Date('2026-06-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z'),
    deletedAt: null,
    confirmedAt: null,
    confirmedByMemberId: null,
    ...over,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  repo.listByTask.mockResolvedValue([])
  repo.listByTaskIncludingDeleted.mockResolvedValue([])
  repo.countByTask.mockResolvedValue(0)
  repo.create.mockImplementation(async input => ({
    ...criterion(),
    id: 'c-new',
    ...input,
  }))
  runRepo.maxRoundByTask.mockResolvedValue(0)
  runRepo.latestRunsByCriterion.mockResolvedValue(new Map())
  runRepo.listByTask.mockResolvedValue([])
  activity.listByTaskAndType.mockResolvedValue([])
  findHeader.mockResolvedValue(HEADER)
})

describe('LUM-465 judgeSteps', () => {
  it('judgeSteps round-trips through submit into the status read model', async () => {
    // Persist half: submitting a criterion with judgeSteps passes it to create.
    await taskCriteriaService.submitDraft(
      't-1',
      [
        {
          statement: 'the card renders steps',
          verifierType: 'HUMAN',
          judgeSteps: JUDGE,
          referentKind: 'EXTERNAL_FACT',
        } as never,
      ],
      ATTRIBUTION,
      'TODO',
      null
    )
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ judgeSteps: JUDGE }),
      expect.anything()
    )

    // Read-model half: a stored criterion's judgeSteps is projected to the view.
    repo.listByTask.mockResolvedValue([criterion({ judgeSteps: JUDGE })])
    repo.listByTaskIncludingDeleted.mockResolvedValue([
      criterion({ judgeSteps: JUDGE }),
    ])
    const status = await taskVerificationService.statusForTask('t-1')
    expect(status.criteria[0]!.judgeSteps).toBe(JUDGE)
  })

  it('a HUMAN criterion missing judgeSteps produces a non-blocking warning', async () => {
    // Pure helper: a HUMAN criterion without judgeSteps warns; covered ones don't.
    expect(
      humanJudgeStepsWarning([{ verifierType: 'HUMAN', judgeSteps: null }])
    ).toMatch(/judg/i)
    expect(
      humanJudgeStepsWarning([{ verifierType: 'HUMAN', judgeSteps: JUDGE }])
    ).toBeNull()
    expect(
      humanJudgeStepsWarning([{ verifierType: 'MACHINE', judgeSteps: null }])
    ).toBeNull()

    // Service: the draft is still stored (no throw) and surfaces the warning.
    repo.listByTask
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([criterion({ judgeSteps: null })])
    const result = await taskCriteriaService.submitDraft(
      't-1',
      [
        {
          statement: 'the card renders steps',
          verifierType: 'HUMAN',
          referentKind: 'EXTERNAL_FACT',
        } as never,
      ],
      ATTRIBUTION,
      'TODO',
      null
    )
    expect(repo.create).toHaveBeenCalled()
    expect(result.judgeStepsWarning).toMatch(/judg/i)
  })

  it('editing only judgeSteps records a CRITERION_CHANGED with before and after judgeSteps', async () => {
    const existing = criterion({ id: 'c-1', judgeSteps: 'old guidance' })
    repo.listByTask.mockResolvedValue([existing])
    repo.update.mockResolvedValue(
      criterion({ id: 'c-1', judgeSteps: 'new guidance' })
    )

    await taskCriteriaService.submitDraft(
      't-1',
      [
        {
          id: 'c-1',
          statement: 'the card renders steps',
          verifierType: 'HUMAN',
          judgeSteps: 'new guidance',
          referentKind: 'EXTERNAL_FACT',
        } as never,
      ],
      ATTRIBUTION,
      'IN_PROGRESS',
      new Date('2026-06-02')
    )

    const updated = activity.create.mock.calls
      .map(c => c[0])
      .filter(a => a.type === 'CRITERION_CHANGED' && a.payload.op === 'UPDATED')
      .map(a => a.payload)
    expect(updated).toHaveLength(1)
    expect(updated[0].before.judgeSteps).toBe('old guidance')
    expect(updated[0].after.judgeSteps).toBe('new guidance')
  })

  it('the judgeSteps migration is purely additive', () => {
    const root = path.join(__dirname, '..', 'prisma', 'migrations')
    const sqls = readdirSync(root)
      .map(d => path.join(root, d, 'migration.sql'))
      .map(p => {
        try {
          return readFileSync(p, 'utf8')
        } catch {
          return ''
        }
      })
      .filter(s => /judgeSteps/i.test(s))
    expect(sqls.length).toBeGreaterThan(0)
    const sql = sqls.join('\n')
    expect(sql).toMatch(/ADD COLUMN[^;]*"?judgeSteps"?/i)
    // Purely additive: no destructive DDL/data ops.
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)/i)
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(sql).not.toMatch(/\bTRUNCATE\b/i)
  })
})
