/** @jest-environment node */
/**
 * LUM-634 — the milestone change-volume rollup's three-state discipline:
 * null (unsynced/not backfilled) ≠ 0 (a real zero-change PR) ≠ unmeasured
 * milestone (zero synced PRs → null totals). Sums cover ONLY non-null rows
 * and always carry the coverage counts; the per-member attribution never
 * silently drops volume (Σ rows == summary totals).
 */
import {
  computeMilestoneDeliveryStats,
  type DeliveryStatsInput,
} from '@/lib/summaries/milestone-delivery-stats'

const session = (
  over: Partial<DeliveryStatsInput['sessionRows'][number]> & { id: string }
): DeliveryStatsInput['sessionRows'][number] => ({
  taskId: null,
  workspaceMemberId: null,
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheCreationTokens: null,
  ...over,
})

const base = (over: Partial<DeliveryStatsInput> = {}): DeliveryStatsInput => ({
  taskIds: [],
  prRows: [],
  complexityRows: [],
  sessionRows: [],
  turnEvents: [],
  memberLabels: new Map(),
  ...over,
})

describe('milestone change-volume rollup (LUM-634)', () => {
  it('change volume rollup is three-state fail-closed', () => {
    const stats = computeMilestoneDeliveryStats(
      base({
        taskIds: ['t1', 't2', 't3'],
        prRows: [
          // t1: one synced merged PR — counted in the sums.
          {
            taskId: 't1',
            state: 'merged',
            additions: 100,
            deletions: 40,
            changedFiles: 3,
          },
          // t1: one UNSYNCED merged PR (nulls) — excluded from the sums,
          // visible only as the coverage gap. NOT read as 0.
          {
            taskId: 't1',
            state: 'merged',
            additions: null,
            deletions: null,
            changedFiles: null,
          },
          // t2: a REAL zero-change merged PR — 0 is a measurement, included.
          {
            taskId: 't2',
            state: 'merged',
            additions: 0,
            deletions: 0,
            changedFiles: 0,
          },
          // Open PR volume never counts toward merged delivery exposure.
          {
            taskId: 't2',
            state: 'open',
            additions: 999,
            deletions: 999,
            changedFiles: 9,
          },
          // Pre-634 row shape (fields absent) degrades to unsynced.
          { taskId: 't3', state: 'merged' },
        ],
        sessionRows: [
          // t1: member A outspends member B → t1's volume attributes to A.
          session({
            id: 's1',
            taskId: 't1',
            workspaceMemberId: 'mA',
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
          }),
          session({
            id: 's2',
            taskId: 't1',
            workspaceMemberId: 'mB',
            inputTokens: 10,
            outputTokens: 10,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
          }),
          // t2: only a member-less session → its volume lands in the
          // explicit unattributed bucket, never silently dropped.
          session({
            id: 's3',
            taskId: 't2',
            workspaceMemberId: null,
            inputTokens: 5,
            outputTokens: 5,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
          }),
        ],
        memberLabels: new Map([
          ['mA', 'Alice'],
          ['mB', 'Bob'],
        ]),
      })
    )

    // Summary: sums cover ONLY the synced rows; coverage counts both.
    expect(stats.changeVolume).toEqual({
      additions: 100, // 100 + 0 — the unsynced PRs are NOT in the sum
      deletions: 40,
      changedFiles: 3,
      measuredPrs: 2, // t1 synced + t2 real-zero
      totalMergedPrs: 4, // + t1 unsynced + t3 pre-634 row
    })

    // Per-member: A carries t1 (largest token spender), B gets an explicit
    // null (nothing measured attributes to B — never +0/−0), the
    // unattributed row carries t2's real zero.
    const byMember = new Map(
      stats.perMember.rows.map(r => [r.memberId, r.changeVolume])
    )
    expect(byMember.get('mA')).toEqual({
      additions: 100,
      deletions: 40,
      measuredPrs: 1,
    })
    expect(byMember.get('mB')).toBeNull()
    expect(byMember.get(null)).toEqual({
      additions: 0,
      deletions: 0,
      measuredPrs: 1,
    })

    // Σ-identity: attributed volume reconciles exactly with the summary.
    const rowSum = stats.perMember.rows.reduce(
      (acc, r) => ({
        additions: acc.additions + (r.changeVolume?.additions ?? 0),
        deletions: acc.deletions + (r.changeVolume?.deletions ?? 0),
        measuredPrs: acc.measuredPrs + (r.changeVolume?.measuredPrs ?? 0),
      }),
      { additions: 0, deletions: 0, measuredPrs: 0 }
    )
    expect(rowSum.additions).toBe(stats.changeVolume.additions)
    expect(rowSum.deletions).toBe(stats.changeVolume.deletions)
    expect(rowSum.measuredPrs).toBe(stats.changeVolume.measuredPrs)

    // State 3 — zero synced PRs on a milestone WITH merged PRs: totals are
    // fail-closed null ("not synced"), never a fabricated 0; the coverage
    // counts still tell the truth.
    const unsynced = computeMilestoneDeliveryStats(
      base({
        taskIds: ['t1'],
        prRows: [
          { taskId: 't1', state: 'merged' },
          {
            taskId: 't1',
            state: 'merged',
            additions: null,
            deletions: null,
            changedFiles: null,
          },
        ],
      })
    )
    expect(unsynced.changeVolume).toEqual({
      additions: null,
      deletions: null,
      changedFiles: null,
      measuredPrs: 0,
      totalMergedPrs: 2,
    })

    // No merged PRs at all: coverage 0/0 with null totals — a distinct
    // honest state (nothing to sync), still never 0.
    const noPrs = computeMilestoneDeliveryStats(base({ taskIds: ['t1'] }))
    expect(noPrs.changeVolume).toEqual({
      additions: null,
      deletions: null,
      changedFiles: null,
      measuredPrs: 0,
      totalMergedPrs: 0,
    })
  })

  it('volume of a session-less task still surfaces via the unattributed row', () => {
    // A task with a measured merged PR but NO sessions at all: the volume
    // must create the unattributed row rather than vanish (Σ-identity).
    const stats = computeMilestoneDeliveryStats(
      base({
        taskIds: ['t1'],
        prRows: [
          {
            taskId: 't1',
            state: 'merged',
            additions: 12,
            deletions: 5,
            changedFiles: 2,
          },
        ],
      })
    )
    expect(stats.changeVolume.additions).toBe(12)
    const unattributed = stats.perMember.rows.find(r => r.memberId === null)
    expect(unattributed?.changeVolume).toEqual({
      additions: 12,
      deletions: 5,
      measuredPrs: 1,
    })
    // Unattributed still renders last by contract.
    expect(
      stats.perMember.rows[stats.perMember.rows.length - 1]?.memberId
    ).toBeNull()
  })

  it('attribution tiebreak is deterministic (lexicographically smallest member)', () => {
    const stats = computeMilestoneDeliveryStats(
      base({
        taskIds: ['t1'],
        prRows: [
          {
            taskId: 't1',
            state: 'merged',
            additions: 10,
            deletions: 2,
            changedFiles: 1,
          },
        ],
        sessionRows: [
          session({
            id: 's1',
            taskId: 't1',
            workspaceMemberId: 'mB',
            inputTokens: 50,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
          }),
          session({
            id: 's2',
            taskId: 't1',
            workspaceMemberId: 'mA',
            inputTokens: 50,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
          }),
        ],
      })
    )
    const byMember = new Map(
      stats.perMember.rows.map(r => [r.memberId, r.changeVolume])
    )
    expect(byMember.get('mA')).toEqual({
      additions: 10,
      deletions: 2,
      measuredPrs: 1,
    })
    expect(byMember.get('mB')).toBeNull()
  })
})
