import { taskVerificationService } from '@/lib/services/task-verification.service'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { taskRepository } from '@/lib/repositories/task.repository'

jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: {
    listByTask: jest.fn(),
    listByTaskIncludingDeleted: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    listForLifecycle: jest.fn(() => Promise.resolve([])),
  },
}))
jest.mock('@/lib/repositories/verification-run.repository', () => ({
  // Keep the real pure exports (deriveMachinePassedCriteria, isPassVerdict).
  ...jest.requireActual('@/lib/repositories/verification-run.repository'),
  verificationRunRepository: { listByTask: jest.fn() },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { listByTaskAndType: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findHeaderById: jest.fn() },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: { findVerificationMaxRounds: jest.fn() },
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
  },
}))
jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))

const listActive = acceptanceCriterionRepository.listByTask as jest.Mock
const listAll =
  acceptanceCriterionRepository.listByTaskIncludingDeleted as jest.Mock
const listRuns = verificationRunRepository.listByTask as jest.Mock
const listChangeEvents = activityRepository.listByTaskAndType as jest.Mock
const findHeader = taskRepository.findHeaderById as jest.Mock

const HEADER = {
  id: 't-1',
  number: 457,
  title: 'stale-verdict detection',
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
    deletedAt: null,
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
  listActive.mockResolvedValue([])
  listAll.mockResolvedValue([])
  listRuns.mockResolvedValue([])
  listChangeEvents.mockResolvedValue([])
})

// LUM-457: each criterion exposes two derived staleness flags so the UI can
// distinguish a verdict that still vouches for the current criterion from one
// recorded against a pre-edit version.
describe('stale-verdict read model (LUM-457)', () => {
  describe('verdictStale', () => {
    it('is true when the criterion was edited after its latest verdict', async () => {
      const c = criterion({
        // updatedAt later than the verdict's createdAt → the verdict predates
        // the edit.
        updatedAt: new Date('2026-06-03T00:00:00Z'),
      })
      listActive.mockResolvedValue([c])
      listAll.mockResolvedValue([c])
      listRuns.mockResolvedValue([run()])

      const s = await taskVerificationService.statusForTask('t-1')

      expect(s.criteria[0]!.verdictStale).toBe(true)
    })

    it('is false for a fresh verdict recorded after the last edit', async () => {
      const c = criterion({ updatedAt: new Date('2026-06-01T00:00:00Z') })
      listActive.mockResolvedValue([c])
      listAll.mockResolvedValue([c])
      listRuns.mockResolvedValue([run()]) // verdict at 06-02, after the edit

      const s = await taskVerificationService.statusForTask('t-1')

      expect(s.criteria[0]!.verdictStale).toBe(false)
    })

    it('is false when there is no verdict yet (nothing to be stale)', async () => {
      const c = criterion({ updatedAt: new Date('2026-06-09T00:00:00Z') })
      listActive.mockResolvedValue([c])
      listAll.mockResolvedValue([c])
      listRuns.mockResolvedValue([])

      const s = await taskVerificationService.statusForTask('t-1')

      expect(s.criteria[0]!.verdictStale).toBe(false)
    })
  })

  describe('checkMismatch', () => {
    it('is true when the machine PASS evidence ran a different command than the current checkpointer', async () => {
      const c = criterion({ checkpointer: 'npx jest new-name.test.ts' })
      listActive.mockResolvedValue([c])
      listAll.mockResolvedValue([c])
      listRuns.mockResolvedValue([
        run({ evidencePointer: 'cmd:npx jest old-name.test.ts#exit=0' }),
      ])

      const s = await taskVerificationService.statusForTask('t-1')

      expect(s.criteria[0]!.checkMismatch).toBe(true)
    })

    it('is false when the machine PASS evidence matches the current checkpointer', async () => {
      const c = criterion({ checkpointer: 'npx jest x.test.ts' })
      listActive.mockResolvedValue([c])
      listAll.mockResolvedValue([c])
      listRuns.mockResolvedValue([
        run({ evidencePointer: 'cmd:npx jest x.test.ts#exit=0' }),
      ])

      const s = await taskVerificationService.statusForTask('t-1')

      expect(s.criteria[0]!.checkMismatch).toBe(false)
    })

    it('is false for a HUMAN criterion (no machine check to mismatch)', async () => {
      const c = criterion({
        verifierType: 'HUMAN',
        checkpointer: null,
      })
      listActive.mockResolvedValue([c])
      listAll.mockResolvedValue([c])
      listRuns.mockResolvedValue([
        run({ verifierType: 'HUMAN', evidencePointer: null }),
      ])

      const s = await taskVerificationService.statusForTask('t-1')

      expect(s.criteria[0]!.checkMismatch).toBe(false)
    })

    it('is false when a MACHINE criterion is passing only via a human override (no machine pass to compare)', async () => {
      const c = criterion({ checkpointer: 'npx jest x.test.ts' })
      listActive.mockResolvedValue([c])
      listAll.mockResolvedValue([c])
      listRuns.mockResolvedValue([
        run({
          verifierType: 'HUMAN',
          verdict: 'PASS',
          evidencePointer: null,
        }),
      ])

      const s = await taskVerificationService.statusForTask('t-1')

      expect(s.criteria[0]!.machinePassed).toBe(false)
      expect(s.criteria[0]!.checkMismatch).toBe(false)
    })
  })

  it('a genuinely fresh machine PASS is neither stale nor mismatched', async () => {
    const c = criterion({
      checkpointer: 'npx jest x.test.ts',
      updatedAt: new Date('2026-06-01T00:00:00Z'),
    })
    listActive.mockResolvedValue([c])
    listAll.mockResolvedValue([c])
    listRuns.mockResolvedValue([
      run({ evidencePointer: 'cmd:npx jest x.test.ts#exit=0' }),
    ])

    const s = await taskVerificationService.statusForTask('t-1')

    expect(s.criteria[0]!.verdictStale).toBe(false)
    expect(s.criteria[0]!.checkMismatch).toBe(false)
  })
})
