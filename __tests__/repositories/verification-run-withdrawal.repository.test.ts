/**
 * Tests for the withdrawal repository and the withdrawal-aware pure helpers
 * that back the latestRunsByCriterion + latestHumanVerdictAction derivation
 * (LUM-586 undo-verdict).
 *
 * All three pure helpers are unit-testable without a database — that is the
 * point. The repository-method tests mock Prisma, same pattern as the sibling
 * verification-run.repository.test.ts.
 */
import {
  isRunWithdrawn,
  deriveLatestRunsByCriterion,
  deriveLatestHumanVerdictAction,
} from '@/lib/repositories/verification-run.repository'
import { verificationRunWithdrawalRepository } from '@/lib/repositories/verification-run-withdrawal.repository'

// ── Mock Prisma ──────────────────────────────────────────────────────────────

const mockCreate = jest.fn()
const mockFindFirst = jest.fn()
const mockFindMany = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    verificationRunWithdrawal: {
      create: (...args: any[]) => mockCreate(...args),
      findFirst: (...args: any[]) => mockFindFirst(...args),
      findMany: (...args: any[]) => mockFindMany(...args),
    },
  },
}))

beforeEach(() => jest.clearAllMocks())

// ── isRunWithdrawn ───────────────────────────────────────────────────────────

describe('isRunWithdrawn', () => {
  it('returns false when verdictActionId is null (machine run)', () => {
    expect(isRunWithdrawn({ verdictActionId: null }, new Set())).toBe(false)
  })

  it('returns false when verdictActionId is not in the withdrawn set', () => {
    expect(
      isRunWithdrawn({ verdictActionId: 'act-1' }, new Set(['act-2']))
    ).toBe(false)
  })

  it('returns true when verdictActionId is in the withdrawn set', () => {
    expect(
      isRunWithdrawn({ verdictActionId: 'act-1' }, new Set(['act-1']))
    ).toBe(true)
  })
})

// ── deriveLatestRunsByCriterion ──────────────────────────────────────────────

describe('deriveLatestRunsByCriterion', () => {
  it('returns the last run per criterion when nothing is withdrawn', () => {
    const rows = [
      {
        id: 'r-1',
        criterionId: 'c-1',
        round: 1,
        verdict: 'FAIL',
        verifierType: 'MACHINE',
        verdictActionId: null,
      },
      {
        id: 'r-2',
        criterionId: 'c-1',
        round: 2,
        verdict: 'PASS',
        verifierType: 'MACHINE',
        verdictActionId: null,
      },
      {
        id: 'r-3',
        criterionId: 'c-2',
        round: 1,
        verdict: 'PASS',
        verifierType: 'MACHINE',
        verdictActionId: null,
      },
    ] as any[]
    const result = deriveLatestRunsByCriterion(rows, new Set())
    expect(result.get('c-1')?.id).toBe('r-2')
    expect(result.get('c-2')?.id).toBe('r-3')
  })

  /**
   * LUM-586 acceptance checkpointer — the key invariant this whole task is
   * about. Keep the exact `it` name; it is matched by the acceptance harness.
   */
  it('LUM-586 withdrawn human pass falls back to the prior machine pass', () => {
    const rows = [
      // Round 1: machine pass
      {
        id: 'r-1',
        criterionId: 'c-1',
        round: 1,
        verdict: 'PASS',
        verifierType: 'MACHINE',
        verdictActionId: null,
      },
      // Round 2: human pass — but the action that wrote it has been withdrawn
      {
        id: 'r-2',
        criterionId: 'c-1',
        round: 2,
        verdict: 'PASS',
        verifierType: 'HUMAN',
        verdictActionId: 'act-withdrawn',
      },
    ] as any[]
    const withdrawnActionIds = new Set(['act-withdrawn'])

    const result = deriveLatestRunsByCriterion(rows, withdrawnActionIds)

    // The withdrawn human run must NOT win; fall back to the machine pass.
    expect(result.get('c-1')?.id).toBe('r-1')
    expect(result.get('c-1')?.verifierType).toBe('MACHINE')
  })

  it('a non-withdrawn human run wins over a prior machine run', () => {
    const rows = [
      {
        id: 'r-1',
        criterionId: 'c-1',
        round: 1,
        verdict: 'PASS',
        verifierType: 'MACHINE',
        verdictActionId: null,
      },
      {
        id: 'r-2',
        criterionId: 'c-1',
        round: 2,
        verdict: 'PASS',
        verifierType: 'HUMAN',
        verdictActionId: 'act-live',
      },
    ] as any[]
    const result = deriveLatestRunsByCriterion(rows, new Set())
    expect(result.get('c-1')?.id).toBe('r-2')
  })

  it('returns empty map when all runs for a criterion are withdrawn', () => {
    const rows = [
      {
        id: 'r-1',
        criterionId: 'c-1',
        round: 1,
        verdict: 'PASS',
        verifierType: 'HUMAN',
        verdictActionId: 'act-1',
      },
    ] as any[]
    const result = deriveLatestRunsByCriterion(rows, new Set(['act-1']))
    expect(result.has('c-1')).toBe(false)
  })
})

// ── deriveLatestHumanVerdictAction ───────────────────────────────────────────
// C1: the pure helper now returns a full action descriptor (not just a string),
// so the service layer can populate withdrawnVerdict + verdictActionId.

describe('deriveLatestHumanVerdictAction', () => {
  it('returns null when there are no human runs', () => {
    const rows = [
      {
        id: 'r-1',
        criterionId: 'c-1',
        round: 1,
        verdict: 'PASS',
        verifierType: 'MACHINE',
        verdictActionId: null,
        createdAt: new Date(),
      },
    ] as any[]
    expect(deriveLatestHumanVerdictAction(rows, new Set())).toBeNull()
  })

  it('returns the full action descriptor of the latest non-withdrawn human run', () => {
    const t1 = new Date('2026-06-01T10:00:00Z')
    const t2 = new Date('2026-06-01T11:00:00Z')
    const rows = [
      {
        id: 'r-1',
        criterionId: 'c-1',
        round: 1,
        verdict: 'PASS',
        verifierType: 'HUMAN',
        verdictActionId: 'act-1',
        createdAt: t1,
      },
      {
        id: 'r-2',
        criterionId: 'c-2',
        round: 1,
        verdict: 'PASS',
        verifierType: 'HUMAN',
        verdictActionId: 'act-2',
        createdAt: t2,
      },
    ] as any[]
    // rows are oldest-first; last non-withdrawn human action is act-2
    const result = deriveLatestHumanVerdictAction(rows, new Set())
    expect(result).not.toBeNull()
    expect(result!.verdictActionId).toBe('act-2')
    expect(result!.verdict).toBe('PASS')
    expect(result!.criterionIds).toEqual(['c-2'])
    expect(result!.recordedAt).toEqual(t2)
  })

  it('collects all criterionIds belonging to the latest action', () => {
    const t = new Date('2026-06-01T10:00:00Z')
    const rows = [
      {
        id: 'r-1',
        criterionId: 'c-1',
        round: 1,
        verdict: 'FAIL',
        verifierType: 'HUMAN',
        verdictActionId: 'act-1',
        createdAt: t,
      },
      {
        id: 'r-2',
        criterionId: 'c-2',
        round: 1,
        verdict: 'FAIL',
        verifierType: 'HUMAN',
        verdictActionId: 'act-1',
        createdAt: t,
      },
    ] as any[]
    const result = deriveLatestHumanVerdictAction(rows, new Set())
    expect(result!.verdictActionId).toBe('act-1')
    expect(result!.criterionIds.sort()).toEqual(['c-1', 'c-2'])
  })

  it('skips withdrawn human runs and falls back to the prior action', () => {
    const t1 = new Date('2026-06-01T10:00:00Z')
    const t2 = new Date('2026-06-01T11:00:00Z')
    const rows = [
      {
        id: 'r-1',
        criterionId: 'c-1',
        round: 1,
        verdict: 'PASS',
        verifierType: 'HUMAN',
        verdictActionId: 'act-1',
        createdAt: t1,
      },
      {
        id: 'r-2',
        criterionId: 'c-2',
        round: 1,
        verdict: 'PASS',
        verifierType: 'HUMAN',
        verdictActionId: 'act-2',
        createdAt: t2,
      },
    ] as any[]
    // act-2 is withdrawn; falls back to act-1
    const result = deriveLatestHumanVerdictAction(rows, new Set(['act-2']))
    expect(result!.verdictActionId).toBe('act-1')
    expect(result!.criterionIds).toEqual(['c-1'])
  })

  it('returns null when all human runs are withdrawn', () => {
    const rows = [
      {
        id: 'r-1',
        criterionId: 'c-1',
        round: 1,
        verdict: 'PASS',
        verifierType: 'HUMAN',
        verdictActionId: 'act-1',
        createdAt: new Date(),
      },
    ] as any[]
    expect(deriveLatestHumanVerdictAction(rows, new Set(['act-1']))).toBeNull()
  })
})

// ── verificationRunWithdrawalRepository ─────────────────────────────────────

describe('verificationRunWithdrawalRepository', () => {
  describe('create', () => {
    it('inserts a withdrawal tombstone row', async () => {
      const row = {
        id: 'w-1',
        taskId: 't-1',
        verdictActionId: 'act-1',
        withdrawnById: 'member-1',
        note: null,
        createdAt: new Date(),
      }
      mockCreate.mockResolvedValue(row)

      const result = await verificationRunWithdrawalRepository.create({
        taskId: 't-1',
        verdictActionId: 'act-1',
        withdrawnById: 'member-1',
        note: null,
      })

      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          taskId: 't-1',
          verdictActionId: 'act-1',
          withdrawnById: 'member-1',
          note: null,
        },
        select: expect.objectContaining({
          id: true,
          taskId: true,
          verdictActionId: true,
        }),
      })
      expect(result).toEqual(row)
    })
  })

  describe('actionIdsByTask', () => {
    it('returns a Set of withdrawn verdictActionIds for a task', async () => {
      mockFindMany.mockResolvedValue([
        { verdictActionId: 'act-1' },
        { verdictActionId: 'act-2' },
      ])

      const result =
        await verificationRunWithdrawalRepository.actionIdsByTask('t-1')

      expect(result).toEqual(new Set(['act-1', 'act-2']))
      expect(mockFindMany).toHaveBeenCalledWith({
        where: { taskId: 't-1' },
        select: { verdictActionId: true },
      })
    })

    it('returns an empty Set when no withdrawals exist', async () => {
      mockFindMany.mockResolvedValue([])
      const result =
        await verificationRunWithdrawalRepository.actionIdsByTask('t-1')
      expect(result).toEqual(new Set())
    })
  })

  describe('latestByTask', () => {
    it('returns the most-recent withdrawal or null', async () => {
      const row = {
        id: 'w-1',
        taskId: 't-1',
        verdictActionId: 'act-1',
        withdrawnById: 'member-1',
        note: null,
        createdAt: new Date(),
      }
      mockFindFirst.mockResolvedValue(row)

      const result =
        await verificationRunWithdrawalRepository.latestByTask('t-1')

      expect(result).toEqual(row)
      expect(mockFindFirst).toHaveBeenCalledWith({
        where: { taskId: 't-1' },
        orderBy: { createdAt: 'desc' },
        select: expect.objectContaining({ id: true, verdictActionId: true }),
      })
    })

    it('returns null when no withdrawals exist', async () => {
      mockFindFirst.mockResolvedValue(null)
      const result =
        await verificationRunWithdrawalRepository.latestByTask('t-1')
      expect(result).toBeNull()
    })
  })
})
