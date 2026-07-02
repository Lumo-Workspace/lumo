/** @jest-environment node */
/**
 * LUM-634 — backfill discipline: only task-bound merged PRs are processed,
 * dry-run (the script default posture) writes nothing, and a PR whose stats
 * the GitHub API can't produce is explicitly skipped and counted — a
 * fabricated 0 is never written.
 */
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    listMergedTaskBoundMissingChangeVolume: jest.fn(),
    updateChangeVolume: jest.fn(),
  },
}))

import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import {
  backfillPrChangeVolume,
  type BackfillPrRow,
} from '@/lib/services/pr-change-volume-backfill.service'

const listCandidates =
  pullRequestRepository.listMergedTaskBoundMissingChangeVolume as jest.Mock
const updateChangeVolume = pullRequestRepository.updateChangeVolume as jest.Mock

const row = (over: Partial<BackfillPrRow> & { id: string }): BackfillPrRow => ({
  workspaceId: 'ws1',
  taskId: 'task1',
  repo: 'a/b',
  number: 1,
  state: 'merged',
  additions: null,
  deletions: null,
  changedFiles: null,
  ...over,
})

beforeEach(() => jest.clearAllMocks())

describe('backfillPrChangeVolume (LUM-634)', () => {
  it('backfill is task-bound dry-run-first and fail-closed', async () => {
    const rows = [
      // In scope: merged + task-bound, API reachable.
      row({ id: 'p1', number: 1 }),
      // Out of scope: defensive filter rejects a non-merged leak-through.
      row({ id: 'p2', number: 2, state: 'open' }),
      // Out of scope: defensive filter rejects an ownerless leak-through.
      row({ id: 'p3', number: 3, taskId: null }),
      // In scope but the GitHub API errors → explicit skip, never zeroed.
      row({ id: 'p4', number: 4 }),
      // In scope: a real zero-change PR — 0 is written because GitHub SAID 0.
      row({ id: 'p5', number: 5 }),
    ]
    listCandidates.mockResolvedValue(rows)
    const fetchStats = jest.fn(
      async (o: {
        workspaceId: string
        fullName: string
        prNumber: number
      }) => {
        if (o.prNumber === 4) throw new Error('GitHub API error 404')
        if (o.prNumber === 5)
          return { additions: 0, deletions: 0, changedFiles: 0 }
        return { additions: 100, deletions: 40, changedFiles: 3 }
      }
    )

    // Dry-run (the script's required first pass): counts, ZERO writes.
    const dry = await backfillPrChangeVolume({ dryRun: true }, { fetchStats })
    expect(dry).toEqual({
      candidates: 3,
      written: 2,
      skippedApiError: 1,
      filteredOut: 2,
      dryRun: true,
    })
    expect(updateChangeVolume).not.toHaveBeenCalled()
    // Only in-scope rows ever hit the API.
    expect(fetchStats.mock.calls.map(c => c[0]!.prNumber).sort()).toEqual([
      1, 4, 5,
    ])

    // Apply run: writes exactly the fetched stats for reachable rows.
    const apply = await backfillPrChangeVolume(
      { dryRun: false },
      { fetchStats }
    )
    expect(apply.written).toBe(2)
    expect(apply.skippedApiError).toBe(1)
    expect(updateChangeVolume).toHaveBeenCalledTimes(2)
    expect(updateChangeVolume).toHaveBeenCalledWith('p1', {
      additions: 100,
      deletions: 40,
      changedFiles: 3,
    })
    // The real zero from GitHub IS written (0 ≠ unsynced)…
    expect(updateChangeVolume).toHaveBeenCalledWith('p5', {
      additions: 0,
      deletions: 0,
      changedFiles: 0,
    })
    // …but the API-failed PR is never written at all — no fabricated 0.
    expect(updateChangeVolume.mock.calls.some(c => c[0] === 'p4')).toBe(false)
  })
})
