/**
 * @jest-environment node
 *
 * LUM-397 — strong/weak outcome stratification (ProdCodeBench: merged alone is
 * a weak ground truth). MERGED lineage edges are split by whether the task
 * ever recorded an all-PASS verification round:
 *
 *   outcomeVerified = true   → MERGED_VERIFIED (strong)
 *   outcomeVerified = false  → weak MERGED (DONE without an all-PASS round)
 *   outcomeVerified = null   → not yet stratified
 *
 * Both stamp paths — the task→DONE immediate stamp and the hourly cron sweep —
 * must derive the signal from the SAME derivation (deriveAllPassRoundTaskIds
 * over the append-only VerificationRun log), and the strength must be
 * monotonic (null/false may upgrade to true, never the reverse). Data-only:
 * no scoring path reads the new column.
 */
import { lineageOutcomeService } from '@/lib/services/lineage-outcome.service'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import {
  deriveAllPassRoundTaskIds,
  verificationRunRepository,
} from '@/lib/repositories/verification-run.repository'

// ── Mock Prisma (real repositories + real service on top) ──────────────────

const mockEdgeUpdateMany = jest.fn()
const mockEdgeGroupBy = jest.fn()
const mockRunFindMany = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    lineageEdge: {
      updateMany: (...args: any[]) => mockEdgeUpdateMany(...args),
      groupBy: (...args: any[]) => mockEdgeGroupBy(...args),
    },
    verificationRun: {
      findMany: (...args: any[]) => mockRunFindMany(...args),
    },
  },
}))

jest.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => p,
}))

type RunRow = { taskId: string; round: number; verdict: string }

const run = (taskId: string, round: number, verdict: string): RunRow => ({
  taskId,
  round,
  verdict,
})

beforeEach(() => {
  jest.clearAllMocks()
  mockEdgeUpdateMany.mockResolvedValue({ count: 0 })
  mockRunFindMany.mockResolvedValue([])
})

// ── The shared derivation (single source for both paths) ───────────────────

describe('deriveAllPassRoundTaskIds', () => {
  it('qualifies a task with one round of only passes', () => {
    const set = deriveAllPassRoundTaskIds([
      run('t-1', 1, 'PASS'),
      run('t-1', 1, 'PASS'),
    ] as any)
    expect(set).toEqual(new Set(['t-1']))
  })

  it('a single FAIL poisons the round, but a later all-PASS round still qualifies', () => {
    const set = deriveAllPassRoundTaskIds([
      run('t-1', 1, 'PASS'),
      run('t-1', 1, 'FAIL'),
      run('t-1', 2, 'PASS'),
      run('t-1', 2, 'PASS'),
    ] as any)
    expect(set).toEqual(new Set(['t-1']))
  })

  it('a task whose every round contains a FAIL never qualifies', () => {
    const set = deriveAllPassRoundTaskIds([
      run('t-1', 1, 'PASS'),
      run('t-1', 1, 'FAIL'),
      run('t-1', 2, 'FAIL'),
    ] as any)
    expect(set).toEqual(new Set())
  })

  it('PASS_WITH_FOLLOWUP counts as a pass — same predicate as the LUM-344 status read model', () => {
    const set = deriveAllPassRoundTaskIds([
      run('t-1', 1, 'PASS'),
      run('t-1', 1, 'PASS_WITH_FOLLOWUP'),
    ] as any)
    expect(set).toEqual(new Set(['t-1']))
  })

  it('no verification log at all → not verified', () => {
    expect(deriveAllPassRoundTaskIds([])).toEqual(new Set())
  })

  it('separates tasks: rounds never bleed across taskIds', () => {
    const set = deriveAllPassRoundTaskIds([
      run('t-pass', 1, 'PASS'),
      run('t-fail', 1, 'FAIL'),
    ] as any)
    expect(set).toEqual(new Set(['t-pass']))
  })
})

// ── Path A: task→DONE immediate stamp ───────────────────────────────────────

describe('task-done stamp stratifies MERGED by verification strength', () => {
  it('stamps outcomeVerified=true when the task has an all-PASS round', async () => {
    mockRunFindMany.mockResolvedValue([
      run('t-1', 1, 'PASS'),
      run('t-1', 1, 'PASS'),
    ])

    await lineageOutcomeService.stampForTaskDone('t-1')

    // 1st update: the outcome advance (UNKNOWN/REJECTED → MERGED), unchanged.
    expect(mockEdgeUpdateMany).toHaveBeenNthCalledWith(1, {
      where: { taskId: 't-1', outcome: { in: ['UNKNOWN', 'REJECTED'] } },
      data: { outcome: 'MERGED' },
    })
    // 2nd update: strength reconcile onto every MERGED edge of the task,
    // monotonic (anything not already true).
    expect(mockEdgeUpdateMany).toHaveBeenNthCalledWith(2, {
      where: {
        taskId: 't-1',
        outcome: 'MERGED',
        NOT: { outcomeVerified: true },
      },
      data: { outcomeVerified: true },
    })
  })

  it('stamps outcomeVerified=false when the task never recorded an all-PASS round', async () => {
    mockRunFindMany.mockResolvedValue([
      run('t-1', 1, 'PASS'),
      run('t-1', 1, 'FAIL'),
    ])

    await lineageOutcomeService.stampForTaskDone('t-1')

    // false only fills null — a prior true is never downgraded, and a later
    // all-PASS round can still upgrade the false on the next stamp/sweep.
    expect(mockEdgeUpdateMany).toHaveBeenNthCalledWith(2, {
      where: { taskId: 't-1', outcome: 'MERGED', outcomeVerified: null },
      data: { outcomeVerified: false },
    })
  })

  it('a task with no verification log stamps weak MERGED (verified=false)', async () => {
    mockRunFindMany.mockResolvedValue([])

    await lineageOutcomeService.stampForTaskDone('t-1')

    expect(mockEdgeUpdateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ data: { outcomeVerified: false } })
    )
  })

  it('REWORKED stamps never touch strength — the merge fact is history', async () => {
    await lineageOutcomeService.stampForTaskReopened('t-1')

    expect(mockEdgeUpdateMany).toHaveBeenCalledTimes(1)
    expect(mockEdgeUpdateMany).toHaveBeenCalledWith({
      where: { taskId: 't-1', outcome: { in: ['MERGED'] } },
      data: { outcome: 'REWORKED' },
    })
  })
})

// ── Path B: hourly cron sweep — dual-path consistency ───────────────────────

describe('dual-path consistency (immediate stamp vs cron sweep)', () => {
  // One verification log, consumed by BOTH paths.
  const LOG = [
    run('t-verified', 1, 'FAIL'),
    run('t-verified', 2, 'PASS'),
    run('t-verified', 2, 'PASS_WITH_FOLLOWUP'),
    run('t-unverified', 1, 'PASS'),
    run('t-unverified', 1, 'FAIL'),
  ]

  it('the sweep splits DONE tasks into the same verified/unverified strata as the derivation', async () => {
    mockRunFindMany.mockResolvedValue(LOG)

    await lineageOutcomeService.sweepDoneTaskEdges()

    // 1st: the LUM-296 outcome advance, unchanged.
    expect(mockEdgeUpdateMany).toHaveBeenNthCalledWith(1, {
      where: {
        outcome: { in: ['UNKNOWN', 'REJECTED'] },
        task: { status: 'DONE' },
      },
      data: { outcome: 'MERGED' },
    })
    // 2nd: verified stratum = exactly the derivation's all-PASS set.
    expect(mockEdgeUpdateMany).toHaveBeenNthCalledWith(2, {
      where: {
        outcome: 'MERGED',
        task: { status: 'DONE' },
        taskId: { in: ['t-verified'] },
        NOT: { outcomeVerified: true },
      },
      data: { outcomeVerified: true },
    })
    // 3rd: unverified stratum — null-only fill, monotonic.
    expect(mockEdgeUpdateMany).toHaveBeenNthCalledWith(3, {
      where: {
        outcome: 'MERGED',
        task: { status: 'DONE' },
        taskId: { notIn: ['t-verified'] },
        outcomeVerified: null,
      },
      data: { outcomeVerified: false },
    })
  })

  it('both paths agree on every task of the same verification log', async () => {
    mockRunFindMany.mockResolvedValue(LOG)
    const expected = deriveAllPassRoundTaskIds(LOG as any)

    for (const taskId of ['t-verified', 't-unverified']) {
      mockRunFindMany.mockResolvedValue(
        LOG.filter(r => r.taskId === taskId)
      )
      const single = await verificationRunRepository.hasAllPassRound(taskId)
      expect(single).toBe(expected.has(taskId))
    }
  })

  it('the immediate stamp consumes the derivation through the single-task convenience (no second definition)', async () => {
    const spy = jest.spyOn(verificationRunRepository, 'taskIdsWithAllPassRound')
    mockRunFindMany.mockResolvedValue([run('t-1', 1, 'PASS')])

    await lineageOutcomeService.stampForTaskDone('t-1')

    expect(spy).toHaveBeenCalledWith(['t-1'], undefined)
    spy.mockRestore()
  })

  it('sweep strength is monotonic: a true stamp is never targeted for downgrade', async () => {
    mockRunFindMany.mockResolvedValue(LOG)

    await lineageOutcomeService.sweepDoneTaskEdges()

    const strengthWrites = mockEdgeUpdateMany.mock.calls.filter(
      ([arg]) => 'outcomeVerified' in (arg.data ?? {})
    )
    for (const [arg] of strengthWrites) {
      if (arg.data.outcomeVerified === false) {
        // false writes only ever fill null.
        expect(arg.where.outcomeVerified).toBeNull()
      } else {
        // true writes exclude already-true rows (idempotent upgrade).
        expect(arg.where.NOT).toEqual({ outcomeVerified: true })
      }
    }
    expect(strengthWrites).toHaveLength(2)
  })
})

// ── Scoring untouched (data-only landing) ───────────────────────────────────

describe('flywheel scoring ignores the strength column', () => {
  it('mergeRateByFragments groups and filters without reading outcomeVerified, and verified MERGED edges still count as merged', async () => {
    mockEdgeGroupBy.mockResolvedValue([
      // A verified-merged task and an unverified-merged task: both must count
      // identically — the groupBy shape carries no strength at all.
      { fragmentType: 'MEMORY', fragmentId: 'm-1', taskId: 't-a', outcome: 'MERGED', _count: { _all: 1 } },
      { fragmentType: 'MEMORY', fragmentId: 'm-1', taskId: 't-b', outcome: 'MERGED', _count: { _all: 1 } },
    ])

    const rates = await lineageEdgeRepository.mergeRateByFragments([
      { fragmentType: 'MEMORY', fragmentId: 'm-1' },
    ])

    expect(rates).toEqual([
      {
        fragmentType: 'MEMORY',
        fragmentId: 'm-1',
        resolvedTasks: 2,
        mergedTasks: 2,
      },
    ])
    const [groupByArg] = mockEdgeGroupBy.mock.calls[0]
    expect(groupByArg.by).toEqual([
      'fragmentType',
      'fragmentId',
      'taskId',
      'outcome',
    ])
    expect(JSON.stringify(groupByArg)).not.toContain('outcomeVerified')
  })

  it('usageMergeRateByFragments likewise never references the strength column', async () => {
    mockEdgeGroupBy.mockResolvedValue([])

    await lineageEdgeRepository.usageMergeRateByFragments([
      { fragmentType: 'MEMORY', fragmentId: 'm-1' },
    ])

    const [groupByArg] = mockEdgeGroupBy.mock.calls[0]
    expect(JSON.stringify(groupByArg)).not.toContain('outcomeVerified')
  })

  it('aggregateByFragments likewise never references the strength column', async () => {
    mockEdgeGroupBy.mockResolvedValue([])

    await lineageEdgeRepository.aggregateByFragments([
      { fragmentType: 'MEMORY', fragmentId: 'm-1' },
    ])

    const [groupByArg] = mockEdgeGroupBy.mock.calls[0]
    expect(JSON.stringify(groupByArg)).not.toContain('outcomeVerified')
  })
})
