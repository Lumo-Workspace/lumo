import {
  buildMilestoneChangelog,
  type BuildChangelogInput,
} from '@/lib/summaries/milestone-changelog'
import { MIN_BASELINE_SAMPLE } from '@/lib/baseline/types'

function baseInput(
  over: Partial<BuildChangelogInput> = {}
): BuildChangelogInput {
  return {
    milestone: {
      name: 'M1',
      completedAt: null,
      archivedAt: null,
      startDate: new Date('2026-06-01T00:00:00Z'),
      targetDate: new Date('2026-07-01T00:00:00Z'),
    },
    doneTasks: [],
    mergedPrs: [],
    priorMilestoneCounts: [],
    ...over,
  }
}

describe('buildMilestoneChangelog', () => {
  test('assembles done tasks and keeps no-PR tasks explicit', () => {
    const result = buildMilestoneChangelog(
      baseInput({
        doneTasks: [
          {
            id: 't1',
            identifier: 'LUM-1',
            title: 'First',
            claimSnapshot: null,
            claimSnapshotSource: null,
            claimSnapshotSessionId: null,
            claimSnapshotAt: null,
          },
          {
            id: 't2',
            identifier: 'LUM-2',
            title: 'Second (no PR)',
            claimSnapshot: null,
            claimSnapshotSource: null,
            claimSnapshotSessionId: null,
            claimSnapshotAt: null,
          },
        ],
        mergedPrs: [
          {
            taskId: 't1',
            repo: 'lumo/lumo',
            number: 10,
            title: 'PR ten',
            mergeCommitSha: 'abc123',
          },
          {
            taskId: 't1',
            repo: 'lumo/lumo',
            number: 11,
            title: 'PR eleven',
            mergeCommitSha: 'def456',
          },
        ],
      })
    )

    // One entry per DONE task, input order preserved.
    expect(result.entries.map(e => e.identifier)).toEqual(['LUM-1', 'LUM-2'])

    const first = result.entries[0]!
    expect(first.title).toBe('First')
    expect(first.prs.map(p => p.number)).toEqual([10, 11])
    expect(first.prs[0]).toMatchObject({
      repo: 'lumo/lumo',
      number: 10,
      title: 'PR ten',
      mergeCommitSha: 'abc123',
    })

    // The no-PR task is kept explicitly with an empty PR list, never dropped.
    const second = result.entries[1]!
    expect(second.identifier).toBe('LUM-2')
    expect(second.prs).toEqual([])
  })

  test('claimSnapshot provenance and fail-closed empty claim', () => {
    const result = buildMilestoneChangelog(
      baseInput({
        doneTasks: [
          {
            id: 't1',
            identifier: 'LUM-1',
            title: 'Has claim',
            claimSnapshot: 'Implemented X because Y is verifiable',
            claimSnapshotSource: 'RUN_SUMMARY',
            claimSnapshotSessionId: 'sess-1',
            claimSnapshotAt: new Date('2026-06-10T00:00:00Z'),
          },
          {
            id: 't2',
            identifier: 'LUM-2',
            title: 'Synthesized but empty',
            claimSnapshot: null,
            claimSnapshotSource: null,
            claimSnapshotSessionId: null,
            claimSnapshotAt: new Date('2026-06-11T00:00:00Z'),
          },
          {
            id: 't3',
            identifier: 'LUM-3',
            title: 'Never synthesized',
            claimSnapshot: null,
            claimSnapshotSource: null,
            claimSnapshotSessionId: null,
            claimSnapshotAt: null,
          },
        ],
      })
    )

    const [c1, c2, c3] = result.entries.map(e => e.claim)

    // Present claim carries text + provenance.
    expect(c1).toEqual({
      status: 'present',
      text: 'Implemented X because Y is verifiable',
      source: 'RUN_SUMMARY',
      sessionId: 'sess-1',
    })

    // Synthesized-but-empty is an explicit fail-closed "no material", NOT omitted.
    expect(c2).toEqual({ status: 'empty' })

    // Never-synthesized is distinguished from the empty case.
    expect(c3).toEqual({ status: 'unsynthesized' })
  })

  test('headline counts carry a baseline with honest sub-sample fallback', () => {
    const doneTasks = ['t1', 't2', 't3', 't4'].map((id, i) => ({
      id,
      identifier: `LUM-${i + 1}`,
      title: `T${i + 1}`,
      claimSnapshot: null,
      claimSnapshotSource: null,
      claimSnapshotSessionId: null,
      claimSnapshotAt: null,
    }))
    const mergedPrs = [
      {
        taskId: 't1',
        repo: 'lumo/lumo',
        number: 1,
        title: 'a',
        mergeCommitSha: null,
      },
      {
        taskId: 't2',
        repo: 'lumo/lumo',
        number: 2,
        title: 'b',
        mergeCommitSha: null,
      },
    ]

    // >= MIN_BASELINE_SAMPLE prior milestones → real baseline (base populated).
    const withBaseline = buildMilestoneChangelog(
      baseInput({
        doneTasks,
        mergedPrs,
        priorMilestoneCounts: [
          { doneTaskCount: 2, mergedPrCount: 1 },
          { doneTaskCount: 6, mergedPrCount: 3 },
          { doneTaskCount: 4, mergedPrCount: 2 },
        ],
      })
    )
    expect(MIN_BASELINE_SAMPLE).toBe(3)
    expect(withBaseline.headline.tasksShipped.current).toBe(4)
    expect(withBaseline.headline.prsMerged.current).toBe(2)
    expect(withBaseline.headline.tasksShipped.base).not.toBeNull()
    expect(withBaseline.headline.tasksShipped.sampleSize).toBe(3)
    expect(withBaseline.headline.prsMerged.base).not.toBeNull()

    // < MIN_BASELINE_SAMPLE priors → honest "no baseline" (base null), never a fabricated thin baseline.
    const thin = buildMilestoneChangelog(
      baseInput({
        doneTasks,
        mergedPrs,
        priorMilestoneCounts: [
          { doneTaskCount: 2, mergedPrCount: 1 },
          { doneTaskCount: 6, mergedPrCount: 3 },
        ],
      })
    )
    expect(thin.headline.tasksShipped.current).toBe(4)
    expect(thin.headline.tasksShipped.base).toBeNull()
    expect(thin.headline.prsMerged.base).toBeNull()
  })
})
