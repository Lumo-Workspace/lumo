import {
  computeMilestoneOutcome,
  type OutcomeSignalCountRow,
  type OutcomeTaskRow,
} from '@/lib/summaries/milestone-outcome'

function task(over: Partial<OutcomeTaskRow> & { id: string }): OutcomeTaskRow {
  return {
    ref: `LUM-${over.id}`,
    title: `Task ${over.id}`,
    status: 'DONE',
    claimSnapshot: null,
    claimSnapshotSource: null,
    ...over,
  }
}

describe('computeMilestoneOutcome', () => {
  it('lists every DONE task once — claim rows carry the frozen snapshot + source, claim-less DONE tasks stay visible as explicit no-claim rows', () => {
    const result = computeMilestoneOutcome(
      [
        task({
          id: 't1',
          ref: 'LUM-283',
          claimSnapshot: '首屏 bundle -298KB',
          claimSnapshotSource: 'AGENT',
        }),
        task({ id: 't2', ref: 'LUM-284' }), // DONE, no claim
        task({ id: 't3', ref: 'LUM-285', status: 'IN_PROGRESS' }),
      ],
      []
    )

    expect(result.claims).toEqual([
      {
        taskId: 't1',
        ref: 'LUM-283',
        title: 'Task t1',
        claim: '首屏 bundle -298KB',
        source: 'AGENT',
      },
      {
        taskId: 't2',
        ref: 'LUM-284',
        title: 'Task t2',
        claim: null,
        source: null,
      },
    ])
  })

  it('treats a whitespace-only snapshot as no claim (fail-closed null, source suppressed)', () => {
    const result = computeMilestoneOutcome(
      [
        task({
          id: 't1',
          claimSnapshot: '   ',
          claimSnapshotSource: 'RUN_SUMMARY',
        }),
      ],
      []
    )
    expect(result.claims[0]).toMatchObject({ claim: null, source: null })
  })

  it('falsifier invariant: ≥1 signal → REJECTED with kind breakdown; zero signals → inconclusive count; no third satisfied/pass state exists in the shape', () => {
    const signals: OutcomeSignalCountRow[] = [
      { taskId: 't1', kind: 'REVERTED', count: 2 },
      { taskId: 't1', kind: 'CI_REGRESSION', count: 1 },
    ]
    const result = computeMilestoneOutcome(
      [task({ id: 't1' }), task({ id: 't2' }), task({ id: 't3' })],
      signals
    )

    expect(result.fate.doneCount).toBe(3)
    expect(result.fate.rejected).toEqual([
      {
        taskId: 't1',
        ref: 'LUM-t1',
        title: 'Task t1',
        kinds: [
          { kind: 'REVERTED', count: 2 },
          { kind: 'CI_REGRESSION', count: 1 },
        ],
      },
    ])
    expect(result.fate.inconclusiveCount).toBe(2)
    // The output shape has exactly the two falsifier-derived states — nothing
    // that could render a "satisfied"/"pass" third state.
    expect(Object.keys(result.fate).sort()).toEqual([
      'doneCount',
      'inconclusiveCount',
      'rejected',
    ])
    expect(JSON.stringify(result)).not.toMatch(/satisfied|passed/i)
  })

  it('keeps a REOPENED (no longer DONE) task in the rejected list — narrowing to DONE would hide exactly the rejections the section must surface', () => {
    const result = computeMilestoneOutcome(
      [
        task({ id: 't1', status: 'IN_PROGRESS' }), // reopened after delivery
        task({ id: 't2' }),
      ],
      [{ taskId: 't1', kind: 'REOPENED', count: 1 }]
    )

    expect(result.fate.rejected.map(r => r.taskId)).toEqual(['t1'])
    // t1 is not DONE, so it neither claims nor counts toward done/inconclusive.
    expect(result.claims.map(c => c.taskId)).toEqual(['t2'])
    expect(result.fate.doneCount).toBe(1)
    expect(result.fate.inconclusiveCount).toBe(1)
  })

  it('sorts kind breakdowns by count desc (kind name tiebreak) and ignores unknown-task or non-positive rows', () => {
    const result = computeMilestoneOutcome(
      [task({ id: 't1' })],
      [
        { taskId: 't1', kind: 'REOPENED', count: 1 },
        { taskId: 't1', kind: 'REVERTED', count: 3 },
        { taskId: 't1', kind: 'BYPASSED', count: 1 },
        { taskId: 'ghost', kind: 'REVERTED', count: 5 },
        { taskId: 't1', kind: 'MANUAL', count: 0 },
      ]
    )

    expect(result.fate.rejected).toHaveLength(1)
    expect(result.fate.rejected[0]?.kinds).toEqual([
      { kind: 'REVERTED', count: 3 },
      { kind: 'BYPASSED', count: 1 },
      { kind: 'REOPENED', count: 1 },
    ])
  })

  it('returns an all-empty rollup for a milestone with no tasks', () => {
    const result = computeMilestoneOutcome([], [])
    expect(result).toEqual({
      claims: [],
      fate: { doneCount: 0, rejected: [], inconclusiveCount: 0 },
    })
  })
})
