import {
  computeMilestoneMemberDelivery,
  type MemberDeliveryInput,
  type MemberDeliveryTaskRow,
} from '@/lib/summaries/milestone-member-delivery'
import { computeMilestoneOutcome } from '@/lib/summaries/milestone-outcome'

const memberAssignee = (memberId: string) => ({
  actorType: 'HUMAN' as const,
  actorMemberId: memberId,
  agentOwnerMemberId: null,
})

const personalAgent = (ownerMemberId: string) => ({
  actorType: 'AGENT' as const,
  actorMemberId: null,
  agentOwnerMemberId: ownerMemberId,
})

const sharedAgent = () => ({
  actorType: 'AGENT' as const,
  actorMemberId: null,
  agentOwnerMemberId: null,
})

const task = (
  id: string,
  overrides: Partial<MemberDeliveryTaskRow> = {}
): MemberDeliveryTaskRow => ({
  id,
  ref: `LUM-${id}`,
  title: `Task ${id}`,
  status: 'DONE',
  claimSnapshot: `claim ${id}`,
  claimSnapshotSource: 'AGENT',
  assignee: memberAssignee('mA'),
  ...overrides,
})

const session = (
  taskId: string,
  workspaceMemberId: string | null,
  outputTokens: number
) => ({
  taskId,
  workspaceMemberId,
  inputTokens: 0,
  outputTokens,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
})

const emptyInput = (
  overrides: Partial<MemberDeliveryInput> = {}
): MemberDeliveryInput => ({
  tasks: [],
  prRows: [],
  complexityRows: [],
  sessionRows: [],
  signalCounts: [],
  memberLabels: new Map(),
  ...overrides,
})

describe('computeMilestoneMemberDelivery', () => {
  it('member delivery buckets are explicit and honest', () => {
    const input = emptyInput({
      tasks: [
        // Direct member assignee.
        task('t1', { assignee: memberAssignee('mA') }),
        // Personal agent → folds to its owning member (mB).
        task('t2', { assignee: personalAgent('mB') }),
        // Shared agent → folds to the member who spent the most tokens on
        // the task's sessions (mA spends more than mB below).
        task('t3', { assignee: sharedAgent() }),
        // Shared agent with a token TIE → deterministic memberId tiebreak
        // (ascending: mA wins over mB).
        task('t4', { assignee: sharedAgent() }),
        // Shared agent with NO attributable session → explicit unattributed
        // bucket, never a silent drop.
        task('t5', { assignee: sharedAgent() }),
        // Unassigned → explicit unassigned bucket.
        task('t6', { assignee: null, status: 'IN_PROGRESS' }),
      ],
      sessionRows: [
        session('t3', 'mA', 900),
        session('t3', 'mB', 100),
        session('t4', 'mB', 500),
        session('t4', 'mA', 500),
        // Member-less session cannot attribute t5.
        session('t5', null, 700),
      ],
      prRows: [
        { taskId: 't1', state: 'merged' },
        { taskId: 't1', state: 'closed' }, // >1 PR → multi-PR churn
        { taskId: 't2', state: 'merged' },
        { taskId: 't2', state: 'merged' },
        { taskId: 't3', state: 'open' },
      ],
      complexityRows: [
        { taskId: 't1', changedFileCount: 7 },
        { taskId: 't3', changedFileCount: 5 },
        // t2/t4/t5/t6 have no complexity row → unmeasured, stated per row.
      ],
      signalCounts: [
        { taskId: 't2', kind: 'REVERTED', count: 1 },
        { taskId: 't2', kind: 'REOPENED', count: 2 },
      ],
      memberLabels: new Map([
        ['mA', 'Alice'],
        ['mB', 'Bob'],
      ]),
    })

    const result = computeMilestoneMemberDelivery(input)

    // Fixed member-name order, special buckets last: Alice, Bob, unassigned,
    // unattributed — never sorted by volume.
    expect(result.rows.map(r => [r.bucket, r.label])).toEqual([
      ['member', 'Alice'],
      ['member', 'Bob'],
      ['unassigned', null],
      ['unattributed', null],
    ])

    const [alice, bob, unassigned, unattributed] = result.rows

    // Alice: t1 (direct) + t3 (shared-agent top spender) + t4 (tiebreak).
    expect(alice).toMatchObject({
      memberId: 'mA',
      taskCount: 3,
      doneCount: 3,
      mergedPrCount: 1,
      fate: { rejectedTaskCount: 0, noRecordDoneCount: 3 },
      friction: { multiPrTaskCount: 1 },
      changedFiles: { total: 12, measuredTasks: 2 },
    })

    // Bob: t2 via his personal agent. Fate carries the rejection.
    expect(bob).toMatchObject({
      memberId: 'mB',
      taskCount: 1,
      doneCount: 1,
      mergedPrCount: 2,
      fate: { rejectedTaskCount: 1, noRecordDoneCount: 0 },
      friction: { multiPrTaskCount: 1 },
      // No complexity row → fail-closed null, never a fabricated 0.
      changedFiles: { total: null, measuredTasks: 0 },
    })

    // Explicit buckets — nothing silently dropped.
    expect(unassigned).toMatchObject({ taskCount: 1, doneCount: 0 })
    expect(unattributed).toMatchObject({ taskCount: 1, doneCount: 1 })

    // Fate is falsifier-shaped: two count states only, no satisfied/pass
    // form anywhere in the row shape, and no ratio field either.
    for (const row of result.rows) {
      expect(Object.keys(row.fate).sort()).toEqual([
        'noRecordDoneCount',
        'rejectedTaskCount',
      ])
      const flat = JSON.stringify(row)
      expect(flat).not.toMatch(/satisf|passRate|successRate|percent|ratio/i)
    }
  })

  it('member delivery reuses outcome and fate sources', () => {
    const tasks: MemberDeliveryTaskRow[] = [
      task('t1', { assignee: memberAssignee('mA') }),
      // DONE without a claim → explicit no-claim row in BOTH read models.
      task('t2', {
        assignee: memberAssignee('mB'),
        claimSnapshot: '   ',
        claimSnapshotSource: 'DIGEST',
      }),
      // Reopened task keeps its rejection visible (fate scans ALL tasks).
      task('t3', { assignee: memberAssignee('mA'), status: 'IN_PROGRESS' }),
      task('t4', { assignee: null }),
    ]
    const signalCounts = [
      { taskId: 't3', kind: 'REVERTED' as const, count: 1 },
      { taskId: 't1', kind: 'CI_REGRESSION' as const, count: 2 },
    ]

    const delivery = computeMilestoneMemberDelivery(
      emptyInput({
        tasks,
        signalCounts,
        memberLabels: new Map([
          ['mA', 'Alice'],
          ['mB', 'Bob'],
        ]),
      })
    )
    const outcome = computeMilestoneOutcome(
      tasks.map(t => ({
        id: t.id,
        ref: t.ref,
        title: t.title,
        status: t.status,
        claimSnapshot: t.claimSnapshot,
        claimSnapshotSource: t.claimSnapshotSource,
      })),
      signalCounts
    )

    // The member expansion's claim rows are the SAME frozen snapshot rows
    // (claim + source 标注) the LUM-626 outcome section renders — compare
    // the full row payloads keyed by task.
    const expandedClaims = delivery.rows
      .flatMap(r => r.claims)
      .sort((a, b) => a.taskId.localeCompare(b.taskId))
    const outcomeClaims = [...outcome.claims].sort((a, b) =>
      a.taskId.localeCompare(b.taskId)
    )
    expect(expandedClaims).toEqual(outcomeClaims)

    // Fate counts reconcile exactly with the outcome well's rollup: Σ
    // per-member rejected == milestone rejected, Σ no-record == milestone
    // inconclusive, Σ done == milestone doneCount.
    const sum = (f: (r: (typeof delivery.rows)[number]) => number) =>
      delivery.rows.reduce((s, r) => s + f(r), 0)
    expect(sum(r => r.fate.rejectedTaskCount)).toBe(
      outcome.fate.rejected.length
    )
    expect(sum(r => r.fate.noRecordDoneCount)).toBe(
      outcome.fate.inconclusiveCount
    )
    expect(sum(r => r.doneCount)).toBe(outcome.fate.doneCount)
  })
})
