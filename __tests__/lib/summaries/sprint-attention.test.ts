/**
 * @jest-environment node
 */
import {
  computeSprintAttention,
  computeStages,
  deriveGateState,
  median,
  measuredTokenTotal,
  scopeQueue,
  securityTrust,
  type AttentionCaseRow,
  type AttentionCrossingRow,
  type AttentionPrRow,
  type AttentionStatusChange,
  type AttentionTaskRow,
  type SecurityPlane,
  type SprintAttentionInput,
} from '@/lib/summaries/sprint-attention'
import {
  isTaskVerified,
  summarizeTestTrust,
} from '@/lib/summaries/sprint-verified'

const NOW = new Date('2026-10-19T12:00:00Z')
const HOUR = 3600
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * HOUR * 1000)

const SHA = 'a'.repeat(40)
const OLD_SHA = 'b'.repeat(40)
const CLEAR: SecurityPlane = {
  state: 'read',
  present: true,
  blocking: 0,
  checked: true,
}

function task(over: Partial<AttentionTaskRow> = {}): AttentionTaskRow {
  return {
    id: 't1',
    identifier: 'LUM-1',
    title: 'Task one',
    status: 'IN_REVIEW',
    createdAt: hoursAgo(100),
    assigneeActorId: 'actor-me',
    ...over,
  }
}

function pr(over: Partial<AttentionPrRow> = {}): AttentionPrRow {
  return {
    id: 'pr1',
    taskId: 't1',
    repo: 'acme/app',
    number: 10,
    title: 'PR',
    url: 'https://github.com/acme/app/pull/10',
    state: 'open',
    isDraft: false,
    headSha: SHA,
    mergeCommitSha: null,
    createdAt: hoursAgo(5),
    mergedAt: null,
    ...over,
  }
}

function crossing(
  over: Partial<AttentionCrossingRow> = {}
): AttentionCrossingRow {
  return {
    id: 'c1',
    number: 7,
    taskId: 't1',
    category: 'DESTRUCTIVE_COMMAND',
    severity: 'MEDIUM',
    advisory: false,
    detectedAt: hoursAgo(3),
    ...over,
  }
}

type Run = NonNullable<AttentionCaseRow['latestRun']>
function passRun(over: Partial<Run> = {}): Run {
  return {
    result: 'PASS',
    environment: 'LOCAL',
    unprovenVerification: [],
    evidence: [{ kind: 'text' }],
    stepResults: [],
    pullRequestId: 'pr1',
    commitSha: SHA,
    commitDirty: false,
    failureAttribution: null,
    disposition: null,
    ...over,
  }
}

function tc(over: Partial<AttentionCaseRow> = {}): AttentionCaseRow {
  return {
    taskId: 't1',
    requiredEnvironment: null,
    latestRun: passRun(),
    ...over,
  }
}

function change(
  from: string,
  to: string,
  at: Date,
  over: Partial<AttentionStatusChange> = {}
): AttentionStatusChange {
  return {
    taskId: 't1',
    actorId: 'actor-me',
    payload: { from, to },
    createdAt: at,
    ...over,
  }
}

function input(over: Partial<SprintAttentionInput> = {}): SprintAttentionInput {
  return {
    now: NOW,
    tasks: [task()],
    pullRequests: [],
    openCrossings: [],
    testCases: [],
    statusChanges: [],
    reworkSignals: [],
    tokenRows: [],
    security: new Map([['t1', CLEAR]]),
    crossingGateEnabled: true,
    actorNames: new Map([['actor-me', 'Me']]),
    ...over,
  }
}

describe('queue — PR awaiting review', () => {
  it('queues an open, non-draft PR since its createdAt', () => {
    const r = computeSprintAttention(input({ pullRequests: [pr()] }))
    expect(r.queue).toHaveLength(1)
    expect(r.queue[0]).toMatchObject({
      kind: 'prReview',
      taskId: 't1',
      waitingSince: hoursAgo(5).toISOString(),
      waitingSec: 5 * HOUR,
      assignee: { actorId: 'actor-me', name: 'Me' },
      pr: { repo: 'acme/app', number: 10 },
    })
    expect(r.tasks[0]!.waitingOn).toBe('prReview')
  })

  it('excludes draft, merged and closed PRs', () => {
    const r = computeSprintAttention(
      input({
        pullRequests: [
          pr({ id: 'd', isDraft: true }),
          pr({ id: 'm', state: 'merged', mergedAt: hoursAgo(1) }),
          pr({ id: 'c', state: 'closed' }),
          pr({ id: 'open2', state: 'open' }),
        ],
      })
    )
    expect(r.queue.filter(q => q.kind === 'prReview')).toHaveLength(1)
  })
})

describe('queue — crossing awaiting ruling', () => {
  it('queues a blocking undispositioned crossing since detectedAt', () => {
    const r = computeSprintAttention(input({ openCrossings: [crossing()] }))
    expect(r.queue).toEqual([
      expect.objectContaining({
        kind: 'crossingRuling',
        waitingSince: hoursAgo(3).toISOString(),
        crossing: {
          id: 'c1',
          number: 7,
          category: 'DESTRUCTIVE_COMMAND',
          severity: 'MEDIUM',
        },
      }),
    ])
    expect(r.tasks[0]!.trust.crossingsBlocking).toBe(1)
    expect(r.tasks[0]!.waitingOn).toBe('crossingRuling')
  })

  it('excludes an advisory crossing', () => {
    const r = computeSprintAttention(
      input({ openCrossings: [crossing({ advisory: true })] })
    )
    expect(r.queue).toEqual([])
    expect(r.tasks[0]!.trust.crossingsBlocking).toBe(0)
  })

  it('excludes a dispositioned crossing (never passed in as open)', () => {
    // The repository only returns undispositioned rows; a dispositioned one
    // is simply absent, so nothing is queued.
    const r = computeSprintAttention(input({ openCrossings: [] }))
    expect(r.queue).toEqual([])
  })

  it('with the workspace gate off, only HIGH blocks', () => {
    const r = computeSprintAttention(
      input({
        crossingGateEnabled: false,
        openCrossings: [
          crossing({ id: 'med', severity: 'MEDIUM' }),
          crossing({ id: 'high', severity: 'HIGH' }),
        ],
      })
    )
    expect(
      r.queue.map(q => q.kind === 'crossingRuling' && q.crossing.id)
    ).toEqual(['high'])
  })
})

describe('queue — awaiting DONE confirmation', () => {
  const merged = (id: string, at: Date) =>
    pr({ id, state: 'merged', mergedAt: at, mergeCommitSha: SHA })

  it('queues a non-DONE task whose PRs are all merged and gate is clear, since the latest merge', () => {
    const r = computeSprintAttention(
      input({
        pullRequests: [merged('p1', hoursAgo(8)), merged('p2', hoursAgo(2))],
      })
    )
    expect(r.queue).toEqual([
      expect.objectContaining({
        kind: 'doneConfirmation',
        waitingSince: hoursAgo(2).toISOString(),
      }),
    ])
    expect(r.tasks[0]!.waitingOn).toBe('doneConfirmation')
  })

  it('ignores closed-unmerged PRs but needs at least one merged', () => {
    const withClosed = computeSprintAttention(
      input({
        pullRequests: [
          merged('p1', hoursAgo(2)),
          pr({ id: 'x', state: 'closed' }),
        ],
      })
    )
    expect(withClosed.queue.map(q => q.kind)).toEqual(['doneConfirmation'])

    const onlyClosed = computeSprintAttention(
      input({ pullRequests: [pr({ state: 'closed' })] })
    )
    expect(onlyClosed.queue).toEqual([])
  })

  it('is not queued while a PR is still open, the task is DONE, or no PR exists', () => {
    expect(
      computeSprintAttention(
        input({
          pullRequests: [
            merged('p1', hoursAgo(2)),
            pr({ id: 'o', isDraft: true }),
          ],
        })
      ).queue
    ).toEqual([])
    expect(
      computeSprintAttention(
        input({
          tasks: [task({ status: 'DONE' })],
          pullRequests: [merged('p1', hoursAgo(2))],
        })
      ).queue
    ).toEqual([])
    expect(computeSprintAttention(input()).queue).toEqual([])
  })

  it('is not queued when the gate is blocked or unknown (fail-closed)', () => {
    const prs = [merged('p1', hoursAgo(2))]
    const blockedByTest = computeSprintAttention(
      input({
        pullRequests: prs,
        testCases: [
          tc({
            latestRun: passRun({
              result: 'FAIL',
              failureAttribution: 'IMPLEMENTATION_DEFECT',
            }),
          }),
        ],
      })
    )
    expect(blockedByTest.queue).toEqual([])

    const unknownSecurity = computeSprintAttention(
      input({ pullRequests: prs, security: new Map() })
    )
    expect(unknownSecurity.queue).toEqual([])
    expect(unknownSecurity.tasks[0]!.trust.security).toBe('unknown')
  })
})

describe('scopeQueue — mine vs team', () => {
  const r = computeSprintAttention(
    input({
      tasks: [
        task({ id: 't1', identifier: 'LUM-1', assigneeActorId: 'actor-me' }),
        task({ id: 't2', identifier: 'LUM-2', assigneeActorId: 'actor-other' }),
      ],
      pullRequests: [pr({ taskId: 't1' }), pr({ id: 'pr2', taskId: 't2' })],
      openCrossings: [
        crossing({ id: 'c1', taskId: 't1' }),
        crossing({ id: 'c2', taskId: 't2' }),
      ],
      security: new Map([
        ['t1', CLEAR],
        ['t2', CLEAR],
      ]),
    })
  )

  it('team shows everything, oldest wait first', () => {
    const team = scopeQueue(r.queue, 'team', 'actor-me')
    expect(team).toHaveLength(4)
    expect(team.map(q => q.waitingSec)).toEqual(
      [...team.map(q => q.waitingSec)].sort((a, b) => b - a)
    )
  })

  it("mine keeps only the viewer's tasks and drops PR review", () => {
    const mine = scopeQueue(r.queue, 'mine', 'actor-me')
    expect(mine.map(q => [q.kind, q.taskId])).toEqual([
      ['crossingRuling', 't1'],
    ])
  })

  it('mine without a viewer actor is empty', () => {
    expect(scopeQueue(r.queue, 'mine', null)).toEqual([])
  })
})

describe('trust + verified', () => {
  const done = (over: Partial<SprintAttentionInput> = {}) =>
    computeSprintAttention(
      input({
        tasks: [task({ status: 'DONE' })],
        pullRequests: [pr({ state: 'merged', mergeCommitSha: SHA })],
        statusChanges: [change('IN_REVIEW', 'DONE', hoursAgo(1))],
        ...over,
      })
    ).tasks[0]!

  it('DONE + gate clear + every TC latest PASS and fresh → verified', () => {
    const t = done({ testCases: [tc(), tc()] })
    expect(t.trust).toEqual({
      testsPassing: 2,
      testsTotal: 2,
      testsFresh: 2,
      crossingsBlocking: 0,
      security: 'clear',
    })
    expect(t.verified).toBe(true)
    expect(t.confirmedBy).toEqual({ actorId: 'actor-me', name: 'Me' })
  })

  it('a PASS on a stale commit is passing but not fresh → not verified', () => {
    const t = done({
      testCases: [tc(), tc({ latestRun: passRun({ commitSha: OLD_SHA }) })],
    })
    expect(t.trust.testsPassing).toBe(2)
    expect(t.trust.testsFresh).toBe(1)
    expect(t.verified).toBe(false)
  })

  it('zero test cases → not verified', () => {
    expect(done({ testCases: [] }).verified).toBe(false)
  })

  it('a PASS with no evidence is capped UNPROVEN → not passing', () => {
    const t = done({
      testCases: [tc({ latestRun: passRun({ evidence: [] }) })],
    })
    expect(t.trust.testsPassing).toBe(0)
    expect(t.verified).toBe(false)
  })

  it('security unknown or blocked → not verified', () => {
    expect(done({ testCases: [tc()], security: new Map() }).verified).toBe(
      false
    )
    const blocked = done({
      testCases: [tc()],
      security: new Map([
        ['t1', { state: 'read', present: true, blocking: 1, checked: true }],
      ]),
    })
    expect(blocked.trust.security).toBe('blocked')
    expect(blocked.verified).toBe(false)
  })

  it('not DONE → not verified, no confirmedBy', () => {
    const t = computeSprintAttention(input({ testCases: [tc()] })).tasks[0]!
    expect(t.verified).toBe(false)
    expect(t.confirmedBy).toBeNull()
  })

  it('confirmedBy is the latest move to DONE', () => {
    const t = done({
      testCases: [tc()],
      statusChanges: [
        change('IN_REVIEW', 'DONE', hoursAgo(10), { actorId: 'a-old' }),
        change('DONE', 'IN_PROGRESS', hoursAgo(9)),
        change('IN_REVIEW', 'DONE', hoursAgo(1), { actorId: 'a-new' }),
      ],
    })
    expect(t.confirmedBy).toEqual({ actorId: 'a-new', name: null })
  })
})

describe('sprint-verified helpers', () => {
  it('a run bound to an unknown PR is never fresh', () => {
    expect(
      summarizeTestTrust(
        [tc({ latestRun: passRun({ pullRequestId: 'gone' }) })],
        new Map()
      )
    ).toEqual({ total: 1, passing: 1, fresh: 0 })
  })

  it('a dirty run is never fresh', () => {
    expect(
      summarizeTestTrust(
        [tc({ latestRun: passRun({ commitDirty: true }) })],
        new Map([['pr1', pr()]])
      ).fresh
    ).toBe(0)
  })

  it('isTaskVerified requires every piece', () => {
    const tests = { total: 1, passing: 1, fresh: 1 }
    expect(isTaskVerified({ status: 'DONE', gate: 'clear', tests })).toBe(true)
    expect(isTaskVerified({ status: 'DONE', gate: 'unknown', tests })).toBe(
      false
    )
    expect(isTaskVerified({ status: 'DONE', gate: 'blocked', tests })).toBe(
      false
    )
    expect(isTaskVerified({ status: 'IN_REVIEW', gate: 'clear', tests })).toBe(
      false
    )
  })
})

describe('gate + security trust', () => {
  it('blocked wins over unknown', () => {
    expect(
      deriveGateState({
        crossingsBlocking: 1,
        testsBlocking: 0,
        security: undefined,
      })
    ).toBe('blocked')
    expect(
      deriveGateState({
        crossingsBlocking: 0,
        testsBlocking: 0,
        security: { state: 'unknown' },
      })
    ).toBe('unknown')
  })

  it('no checked result reads notScanned, never clear', () => {
    expect(
      securityTrust({
        state: 'read',
        present: false,
        blocking: 0,
        checked: false,
      })
    ).toBe('notScanned')
    expect(securityTrust(CLEAR)).toBe('clear')
  })

  it('a dispositioned defect run does not block', () => {
    const r = computeSprintAttention(
      input({
        pullRequests: [pr({ state: 'merged', mergedAt: hoursAgo(1) })],
        testCases: [
          tc({
            latestRun: passRun({
              result: 'FAIL',
              failureAttribution: 'IMPLEMENTATION_DEFECT',
              disposition: { id: 'd1' },
            }),
          }),
        ],
      })
    )
    expect(r.queue.map(q => q.kind)).toEqual(['doneConfirmation'])
  })
})

describe('stages', () => {
  it('counts per status and takes the median dwell since entering it', () => {
    const tasks = [
      task({ id: 'a', status: 'IN_PROGRESS' }),
      task({ id: 'b', status: 'IN_PROGRESS' }),
      task({ id: 'c', status: 'IN_PROGRESS', createdAt: hoursAgo(9) }),
      task({ id: 'd', status: 'DONE' }),
    ]
    const changes = new Map([
      ['a', [change('TODO', 'IN_PROGRESS', hoursAgo(2), { taskId: 'a' })]],
      [
        'b',
        [
          change('TODO', 'IN_PROGRESS', hoursAgo(50), { taskId: 'b' }),
          change('IN_PROGRESS', 'TODO', hoursAgo(40), { taskId: 'b' }),
          change('TODO', 'IN_PROGRESS', hoursAgo(4), { taskId: 'b' }),
        ],
      ],
    ])
    const stages = computeStages(tasks, changes, NOW)
    expect(stages.map(s => s.key)).toEqual([
      'BACKLOG',
      'TODO',
      'IN_PROGRESS',
      'IN_REVIEW',
      'DONE',
    ])
    // dwell: a=2h, b=4h (re-entry), c=9h (no change → createdAt) → median 4h
    expect(stages[2]).toEqual({
      key: 'IN_PROGRESS',
      count: 3,
      medianDwellSec: 4 * HOUR,
    })
    expect(stages[0]).toEqual({
      key: 'BACKLOG',
      count: 0,
      medianDwellSec: null,
    })
    expect(stages[4]!.count).toBe(1)
  })

  it('median of an even set averages the middle pair', () => {
    expect(median([1, 10, 3, 4])).toBe(4) // (3+4)/2 = 3.5 → rounded 4
    expect(median([])).toBeNull()
  })
})

describe('cost', () => {
  it('reopen and REVERTED both count as rework; REOPENED signal not double counted', () => {
    const r = computeSprintAttention(
      input({
        tasks: [
          task({ id: 't1', identifier: 'LUM-1' }),
          task({ id: 't2', identifier: 'LUM-2' }),
          task({ id: 't3', identifier: 'LUM-3' }),
          task({ id: 't4', identifier: 'LUM-4' }),
        ],
        statusChanges: [
          change('DONE', 'IN_PROGRESS', hoursAgo(5), { taskId: 't1' }),
          // forward move — not a reopen
          change('TODO', 'IN_PROGRESS', hoursAgo(5), { taskId: 't3' }),
        ],
        reworkSignals: [
          { taskId: 't1', kind: 'REOPENED' },
          { taskId: 't2', kind: 'REVERTED' },
          { taskId: 't2', kind: 'REVERTED' },
        ],
      })
    )
    expect(r.cost.reworkShare).toBe(0.5)
    expect(r.cost.reworkTop).toEqual([
      {
        taskId: 't2',
        identifier: 'LUM-2',
        title: 'Task one',
        reopens: 0,
        reverts: 2,
      },
      {
        taskId: 't1',
        identifier: 'LUM-1',
        title: 'Task one',
        reopens: 1,
        reverts: 0,
      },
    ])
  })

  it('tokens per verified task = measured tokens ÷ verified count', () => {
    const r = computeSprintAttention(
      input({
        tasks: [
          task({ status: 'DONE' }),
          task({ id: 't2', status: 'IN_PROGRESS' }),
        ],
        pullRequests: [pr({ state: 'merged', mergeCommitSha: SHA })],
        testCases: [tc()],
        tokenRows: [
          {
            taskId: 't1',
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
          },
          {
            taskId: 't2',
            inputTokens: 300,
            outputTokens: 50,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
          },
          // not in the sprint
          {
            taskId: 'zz',
            inputTokens: 9999,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
          },
        ],
      })
    )
    expect(r.cost.tokensPerVerifiedTask).toBe(500)
  })

  it('no verified task or no measured tokens → null', () => {
    expect(
      computeSprintAttention(input()).cost.tokensPerVerifiedTask
    ).toBeNull()
    expect(
      measuredTokenTotal(new Set(['t1']), [
        {
          taskId: 't1',
          inputTokens: null,
          outputTokens: null,
          cacheReadTokens: null,
          cacheCreationTokens: null,
        },
      ])
    ).toBeNull()
  })

  it('empty sprint → empty queue/tasks, zero stages, null cost', () => {
    const r = computeSprintAttention(input({ tasks: [], security: new Map() }))
    expect(r.queue).toEqual([])
    expect(r.tasks).toEqual([])
    expect(
      r.stages.every(s => s.count === 0 && s.medianDwellSec === null)
    ).toBe(true)
    expect(r.cost).toEqual({
      tokensPerVerifiedTask: null,
      reworkShare: null,
      reworkTop: [],
    })
  })
})
