/**
 * @jest-environment node
 *
 * LUM-598 — the post-hoc outcome well as a falsifier oracle.
 *
 * The well is the single external oracle for correctness + fidelity. Its
 * defining invariant: it is a FALSIFIER, not a verifier. It can read
 * "reality REJECTED this delivery" or "no rejection on record" (INCONCLUSIVE)
 * — never "satisfied". Absence of a rejection is not evidence of satisfaction,
 * so the verdict space has exactly two members and no SATISFIED branch exists.
 *
 * These tests run the real service + real repository on top of a tiny stateful
 * Prisma fake (not a method-by-method mock), so the SQL-shaping in the
 * repository is exercised and "record then re-read the oracle" round-trips.
 */
import {
  outcomeWellService,
  OUTCOME_VERDICTS,
} from '@/lib/services/outcome-well.service'
import { outcomeSignalRepository } from '@/lib/repositories/outcome-signal.repository'

// In-memory store (mock-prefixed so jest's hoisted factory may reference it).
const mockStore: Array<Record<string, unknown>> = []

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    outcomeSignal: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `sig_${mockStore.length + 1}`,
          detectedAt: new Date(),
          ...data,
        }
        mockStore.push(row)
        return row
      }),
      count: jest.fn(
        async ({ where }: { where: { taskId: string } }) =>
          mockStore.filter(r => r.taskId === where.taskId).length
      ),
      findMany: jest.fn(async ({ where }: { where?: { taskId?: string } }) =>
        mockStore.filter(r => !where?.taskId || r.taskId === where.taskId)
      ),
    },
  },
}))

beforeEach(() => {
  mockStore.length = 0
})

describe('outcome well — falsifier oracle', () => {
  it('falsifier-only: empty well reads INCONCLUSIVE and verdict union excludes satisfied', async () => {
    // A delivered task with zero recorded signals is INCONCLUSIVE — never PASS.
    expect(await outcomeWellService.deriveVerdict('task-empty')).toBe(
      'INCONCLUSIVE'
    )

    // The verdict space is exactly {REJECTED, INCONCLUSIVE}. There is no
    // 'satisfied'/'pass' member anywhere — the structural guarantee.
    expect([...OUTCOME_VERDICTS].sort()).toEqual(['INCONCLUSIVE', 'REJECTED'])
    const lowered = OUTCOME_VERDICTS.map(v => v.toLowerCase())
    expect(lowered).not.toContain('satisfied')
    expect(lowered).not.toContain('pass')
  })

  it('presence of any signal yields REJECTED', async () => {
    await outcomeSignalRepository.insert({
      workspaceId: 'ws1',
      taskId: 'task-reverted',
      kind: 'REVERTED',
      source: 'GIT',
    })
    expect(await outcomeWellService.deriveVerdict('task-reverted')).toBe(
      'REJECTED'
    )
    // Presence is per-task: an unrelated task stays INCONCLUSIVE.
    expect(await outcomeWellService.deriveVerdict('task-other')).toBe(
      'INCONCLUSIVE'
    )
  })

  it('manual record inserts a signal and flips the oracle to REJECTED', async () => {
    expect(await outcomeWellService.deriveVerdict('task-manual')).toBe(
      'INCONCLUSIVE'
    )

    const sig = await outcomeWellService.record({
      workspaceId: 'ws1',
      taskId: 'task-manual',
      kind: 'MANUAL',
      source: 'MANUAL',
      evidence: { note: 'rolled back in prod by oncall' },
    })
    expect(sig.taskId).toBe('task-manual')
    expect(await outcomeWellService.deriveVerdict('task-manual')).toBe(
      'REJECTED'
    )

    // Append-only: re-recording adds a row, never mutates the prior one.
    await outcomeWellService.record({
      workspaceId: 'ws1',
      taskId: 'task-manual',
      kind: 'MANUAL',
      source: 'MANUAL',
    })
    const rows = await outcomeSignalRepository.listForTask('task-manual')
    expect(rows).toHaveLength(2)
  })
})
