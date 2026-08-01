/** @jest-environment node */
import {
  computeMilestoneDeliveryStats,
  type DeliveryStatsInput,
} from '@/lib/summaries/milestone-delivery-stats'
import { sumActiveDurationSec } from '@/lib/agent-run/active-time'

/** prompt→stop pair `sec` seconds apart — one fully-active turn. */
function turn(
  sessionId: string | null,
  startIso: string,
  sec: number
): Array<{ sessionId: string | null; type: string; createdAt: Date }> {
  const start = new Date(startIso)
  return [
    { sessionId, type: 'USER_PROMPT_SUBMIT', createdAt: start },
    {
      sessionId,
      type: 'STOP',
      createdAt: new Date(start.getTime() + sec * 1000),
    },
  ]
}

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

describe('computeMilestoneDeliveryStats', () => {
  it('delivery stats buckets are explicit and honest', () => {
    const stats = computeMilestoneDeliveryStats({
      taskIds: ['t1', 't2', 't3'],
      prRows: [
        // t1: two PRs (one merged, one open) → the only multi-PR task.
        { taskId: 't1', state: 'merged' },
        { taskId: 't1', state: 'open' },
        // t2: exactly one merged PR → linked but NOT multi-PR.
        { taskId: 't2', state: 'merged' },
        // t3: no PR rows at all → explicit unlinked bucket.
      ],
      complexityRows: [
        { taskId: 't1', changedFileCount: 5 },
        { taskId: 't3', changedFileCount: 3 },
        // t2 has no complexity row → counted as unmeasured coverage.
      ],
      sessionRows: [
        // t1 measured, spent by member A.
        session({
          id: 's1',
          taskId: 't1',
          workspaceMemberId: 'mA',
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 10,
          cacheCreationTokens: 40,
        }),
        // t2 measured, but the session has no member → explicit unattributed.
        session({
          id: 's2',
          taskId: 't2',
          workspaceMemberId: null,
          inputTokens: 10,
          outputTokens: 10,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        }),
        // t3: member B worked but no usage recorded → t3 stays unmeasured;
        // B's active time still attributes to B, tokens stay 0.
        session({ id: 's3', taskId: 't3', workspaceMemberId: 'mB' }),
      ],
      turnEvents: [
        ...turn('s1', '2026-01-05T10:00:00Z', 60),
        ...turn('s2', '2026-01-05T11:00:00Z', 10),
        ...turn('s3', '2026-01-05T12:00:00Z', 30),
        // Session-less events land in the unattributed bucket, never dropped.
        ...turn(null, '2026-01-05T13:00:00Z', 5),
      ],
      memberLabels: new Map([
        ['mA', 'Alice'],
        ['mB', 'Bob'],
      ]),
    })

    // PR buckets: merged count is PR-level; multi-PR counts ONLY >1;
    // no-PR tasks land in the explicit unlinked bucket.
    expect(stats.pr).toEqual({
      mergedPrCount: 2,
      multiPrTaskCount: 1,
      linkedTaskCount: 2,
      unlinkedTaskCount: 1,
      totalTasks: 3,
    })
    // Nothing silently dropped: linked + unlinked covers every task.
    expect(stats.pr.linkedTaskCount + stats.pr.unlinkedTaskCount).toBe(
      stats.pr.totalTasks
    )

    // Change surface: per-task sum with honest coverage (t2 unmeasured).
    expect(stats.changedFiles).toEqual({
      total: 8,
      measuredTasks: 2,
      totalTasks: 3,
    })

    // Per-member: measured gate is per-task (t1, t2); the member-less s2
    // spend and the session-less events form an explicit unattributed row,
    // rendered last; B appears with 0 tokens (t3 unmeasured) but real time.
    expect(stats.perMember.measuredTasks).toBe(2)
    expect(stats.perMember.tokenCost).toBe(220)
    expect(stats.perMember.activeTimeSec).toBe(105)
    expect(stats.perMember.rows).toEqual([
      {
        memberId: 'mA',
        label: 'Alice',
        tokenCost: 200,
        activeTimeSec: 60,
        changeVolume: null,
        // No usageByModel maps in these fixtures: no fabricated model rows,
        // the whole spend reads as the explicit unattributed remainder.
        models: [],
        modelUnattributedTokens: 200,
      },
      {
        memberId: 'mB',
        label: 'Bob',
        tokenCost: 0,
        activeTimeSec: 30,
        changeVolume: null,
        models: [],
        modelUnattributedTokens: 0,
      },
      {
        memberId: null,
        label: null,
        tokenCost: 20,
        activeTimeSec: 15,
        changeVolume: null,
        models: [],
        modelUnattributedTokens: 20,
      },
    ])
  })

  it('per-member totals reconcile with cost rollup', () => {
    // Fractional-second windows force rounding: the largest-remainder split
    // must still sum EXACTLY to the round-once total the LUM-627 costRollup
    // reports (sumActiveDurationSec), or the two surfaces drift.
    const turnEvents = [
      ...turn('s1', '2026-01-05T10:00:00Z', 1.7),
      ...turn('s2', '2026-01-05T11:00:00Z', 2.6),
      ...turn('s3', '2026-01-05T12:00:00Z', 0.9),
    ]
    const sessionRows = [
      session({
        id: 's1',
        taskId: 't1',
        workspaceMemberId: 'mA',
        inputTokens: 7,
        outputTokens: 3,
        cacheReadTokens: 1,
        cacheCreationTokens: 2,
      }),
      // Second session on the SAME measured task with no usage columns —
      // coalesces to 0 exactly like loadActualsForTasks.
      session({ id: 's2', taskId: 't1', workspaceMemberId: 'mB' }),
      session({
        id: 's3',
        taskId: 't2',
        workspaceMemberId: null,
        inputTokens: 5,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      }),
    ]
    const stats = computeMilestoneDeliveryStats({
      taskIds: ['t1', 't2'],
      prRows: [],
      complexityRows: [],
      sessionRows,
      turnEvents,
      memberLabels: new Map(),
    })

    // Token Σ-identity: same columns + same per-task measured gate as
    // loadActualsForTasks → Σ rows == aggregate == the costRollup total.
    const measured = new Set(
      sessionRows
        .filter(s => s.taskId !== null && s.outputTokens !== null)
        .map(s => s.taskId)
    )
    const referenceTokens = sessionRows
      .filter(s => s.taskId !== null && measured.has(s.taskId))
      .reduce(
        (sum, s) =>
          sum +
          (s.inputTokens ?? 0) +
          (s.outputTokens ?? 0) +
          (s.cacheReadTokens ?? 0) +
          (s.cacheCreationTokens ?? 0),
        0
      )
    expect(stats.perMember.tokenCost).toBe(referenceTokens)
    expect(stats.perMember.rows.reduce((sum, r) => sum + r.tokenCost, 0)).toBe(
      referenceTokens
    )

    // Active-time Σ-identity: aggregate equals the canonical round-once
    // total, and the per-row apportioned seconds sum EXACTLY to it.
    const referenceActiveSec = sumActiveDurationSec(turnEvents)
    expect(stats.perMember.activeTimeSec).toBe(referenceActiveSec)
    expect(
      stats.perMember.rows.reduce((sum, r) => sum + r.activeTimeSec, 0)
    ).toBe(referenceActiveSec)

    // Zero-measured: fail-closed null (never a fabricated 0) while the
    // attribution rows stay visible for active time.
    const unmeasured = computeMilestoneDeliveryStats({
      taskIds: ['t1'],
      prRows: [],
      complexityRows: [],
      sessionRows: [
        session({ id: 's1', taskId: 't1', workspaceMemberId: 'mA' }),
      ],
      turnEvents: turn('s1', '2026-01-05T10:00:00Z', 30),
      memberLabels: new Map(),
    })
    expect(unmeasured.perMember.measuredTasks).toBe(0)
    expect(unmeasured.perMember.tokenCost).toBeNull()
    expect(unmeasured.changedFiles.total).toBeNull()
    expect(unmeasured.perMember.rows).toEqual([
      {
        memberId: 'mA',
        label: 'mA',
        tokenCost: 0,
        activeTimeSec: 30,
        changeVolume: null,
        models: [],
        modelUnattributedTokens: 0,
      },
    ])
  })

  it('splits per-member spend by model through the same measured gate', () => {
    const stats = computeMilestoneDeliveryStats({
      taskIds: ['t1', 't2'],
      prRows: [],
      complexityRows: [],
      sessionRows: [
        // Two measured sessions for Alice, maps merging across sessions.
        session({
          id: 's1',
          taskId: 't1',
          workspaceMemberId: 'mA',
          inputTokens: 10,
          outputTokens: 20,
          cacheReadTokens: 30,
          cacheCreationTokens: 40,
          usageByModel: {
            'claude-opus-4-5': {
              input: 10,
              output: 20,
              cacheRead: 30,
              cacheCreation: 40,
            },
          },
        }),
        session({
          id: 's2',
          taskId: 't1',
          workspaceMemberId: 'mA',
          inputTokens: 1,
          outputTokens: 2,
          cacheReadTokens: 3,
          cacheCreationTokens: 4,
          usageByModel: {
            'claude-opus-4-5': {
              input: 1,
              output: 0,
              cacheRead: 0,
              cacheCreation: 0,
            },
            'claude-haiku-4-5': {
              input: 0,
              output: 2,
              cacheRead: 3,
              cacheCreation: 3,
            },
          },
        }),
        // Measured session WITHOUT a map (pre-LUM-298): its spend stays in
        // the flat sum and surfaces as the explicit unattributed remainder.
        session({
          id: 's3',
          taskId: 't2',
          workspaceMemberId: 'mB',
          inputTokens: 5,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        }),
      ],
      turnEvents: [],
      memberLabels: new Map([
        ['mA', 'Alice'],
        ['mB', 'Bob'],
      ]),
    })

    const alice = stats.perMember.rows.find(r => r.memberId === 'mA')!
    // Same-model rows merge across sessions; sorted by total desc.
    expect(alice.models).toEqual([
      {
        model: 'claude-opus-4-5',
        input: 11,
        output: 20,
        cacheRead: 30,
        cacheCreation: 40,
        total: 101,
      },
      {
        model: 'claude-haiku-4-5',
        input: 0,
        output: 2,
        cacheRead: 3,
        cacheCreation: 3,
        total: 8,
      },
    ])
    // Σ(models) + unattributed == the row's flat tokenCost (110 − 109 = 1).
    expect(alice.tokenCost).toBe(110)
    expect(alice.modelUnattributedTokens).toBe(1)

    // A member with only map-less sessions: no fabricated model rows.
    const bob = stats.perMember.rows.find(r => r.memberId === 'mB')!
    expect(bob.models).toEqual([])
    expect(bob.modelUnattributedTokens).toBe(10)
  })

  it('per-task rows carry only tasks with signal and reconcile on active time', () => {
    // t1: measured spend + active time + two PRs (multi-PR, one synced).
    // t2: active time only, no usage-bearing session → unmeasured spend.
    // t3: a member task with no signal at all → no row.
    // s9: a session outside the milestone → its seconds are the remainder.
    const turnEvents = [
      ...turn('s1', '2026-01-05T10:00:00Z', 1.7),
      ...turn('s2', '2026-01-05T11:00:00Z', 2.6),
      ...turn('s9', '2026-01-05T12:00:00Z', 0.9),
    ]
    const sessionRows = [
      session({
        id: 's1',
        taskId: 't1',
        workspaceMemberId: 'mA',
        inputTokens: 7,
        outputTokens: 3,
        cacheReadTokens: 1,
        cacheCreationTokens: 2,
      }),
      // No outputTokens → t2 never passes the measured gate.
      session({ id: 's2', taskId: 't2', workspaceMemberId: 'mA' }),
      session({ id: 's9', taskId: 'outside', workspaceMemberId: 'mA' }),
    ]
    const stats = computeMilestoneDeliveryStats({
      taskIds: ['t1', 't2', 't3'],
      prRows: [
        {
          taskId: 't1',
          state: 'merged',
          additions: 120,
          deletions: 8,
          changedFiles: 4,
        },
        { taskId: 't1', state: 'merged' },
      ],
      complexityRows: [],
      sessionRows,
      turnEvents,
      memberLabels: new Map(),
      taskLabels: new Map([
        ['t1', { ref: 'LUM-497', title: 'reference-class anchors' }],
        ['t2', { ref: 'LUM-707', title: 'deferred cleanups' }],
        ['t3', { ref: 'LUM-499', title: 'design philosophy doc' }],
      ]),
    })

    expect(stats.perTask.rows.map(r => r.ref)).toEqual(['LUM-497', 'LUM-707'])

    const t1 = stats.perTask.rows.find(r => r.taskId === 't1')!
    expect(t1.title).toBe('reference-class anchors')
    expect(t1.tokenCost).toBe(13)
    expect(t1.prCount).toBe(2)
    expect(t1.multiPr).toBe(true)
    // Only the synced PR is summed; the unsynced one is coverage, not a 0.
    expect(t1.changeVolume).toEqual({
      additions: 120,
      deletions: 8,
      measuredPrs: 1,
    })

    // Unmeasured spend reads null, never a fabricated 0.
    const t2 = stats.perTask.rows.find(r => r.taskId === 't2')!
    expect(t2.tokenCost).toBeNull()
    expect(t2.models).toEqual([])
    expect(t2.changeVolume).toBeNull()

    // Σ-identity: per-task seconds + the out-of-milestone remainder equal the
    // single rounded total the chip renders.
    const rowSeconds = stats.perTask.rows.reduce(
      (sum, r) => sum + r.activeTimeSec,
      0
    )
    expect(rowSeconds + stats.perTask.unattributedActiveTimeSec).toBe(
      sumActiveDurationSec(turnEvents)
    )
    expect(stats.perTask.unattributedActiveTimeSec).toBeGreaterThan(0)
  })
})
