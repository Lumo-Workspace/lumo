/** @jest-environment node */
import {
  computeSprintTeamPerformance,
  type SprintTeamPerformanceInput,
  type SprintPerfSessionRow,
} from '@/lib/summaries/sprint-team-performance'

/** prompt→stop pair `sec` seconds apart — one fully-active turn. */
function turn(
  sessionId: string,
  startIso: string,
  sec: number
): SprintTeamPerformanceInput['turnEvents'] {
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
  over: Partial<SprintPerfSessionRow> & { id: string }
): SprintPerfSessionRow => ({
  taskId: null,
  workspaceMemberId: null,
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheCreationTokens: null,
  ...over,
})

const D = new Date('2026-07-15T00:00:00.000Z')
const task = (
  id: string,
  status: SprintTeamPerformanceInput['taskRows'][number]['status'],
  over: Partial<SprintTeamPerformanceInput['taskRows'][number]> = {}
): SprintTeamPerformanceInput['taskRows'][number] => ({
  id,
  identifier: `LUM-${id}`,
  title: `Task ${id}`,
  status,
  priority: 'MEDIUM',
  updatedAt: D,
  ...over,
})

describe('computeSprintTeamPerformance', () => {
  it('attributes tokens/runs per spender and DONE tasks to the top spender', () => {
    const input: SprintTeamPerformanceInput = {
      taskRows: [task('t1', 'DONE'), task('t2', 'DONE'), task('t3', 'TODO')],
      sessionRows: [
        // t1: mA spends more than mB → t1's DONE credit goes to mA.
        session({
          id: 's1',
          taskId: 't1',
          workspaceMemberId: 'mA',
          inputTokens: 100,
          outputTokens: 100,
        }),
        session({
          id: 's2',
          taskId: 't1',
          workspaceMemberId: 'mB',
          inputTokens: 10,
          outputTokens: 10,
        }),
        // t2: only mB → t2's DONE credit goes to mB.
        session({
          id: 's3',
          taskId: 't2',
          workspaceMemberId: 'mB',
          inputTokens: 50,
          outputTokens: 50,
        }),
      ],
      turnEvents: [],
      memberLabels: new Map([
        ['mA', 'Alice'],
        ['mB', 'Bob'],
      ]),
    }
    const out = computeSprintTeamPerformance(input)

    const alice = out.rows.find(r => r.memberId === 'mA')!
    const bob = out.rows.find(r => r.memberId === 'mB')!
    expect(alice.label).toBe('Alice')
    expect(alice.tokenCost).toBe(200)
    expect(alice.runs).toBe(1)
    expect(alice.tasksDone).toBe(1) // t1
    expect(bob.tokenCost).toBe(120)
    expect(bob.runs).toBe(2) // s2 + s3
    expect(bob.tasksDone).toBe(1) // t2
    // t3 is TODO → contributes to nobody's tasksDone.
    expect(alice.tasksDone + bob.tasksDone).toBe(2)
    expect(out.totalTokenCost).toBe(320)
    expect(out.measuredTasks).toBe(2) // t1, t2 have usage-bearing sessions
    expect(out.totalRuns).toBe(3)
    // Sorted by tokenCost desc.
    expect(out.rows.map(r => r.memberId)).toEqual(['mA', 'mB'])
  })

  it('fail-closed: no usage-bearing session → totalTokenCost null', () => {
    const out = computeSprintTeamPerformance({
      taskRows: [task('t1', 'DONE')],
      sessionRows: [
        session({ id: 's1', taskId: 't1', workspaceMemberId: 'mA' }), // all null
      ],
      turnEvents: [],
      memberLabels: new Map(),
    })
    expect(out.measuredTasks).toBe(0)
    expect(out.totalTokenCost).toBeNull()
  })

  it('unattributed bucket: DONE task with no session sorts last', () => {
    const out = computeSprintTeamPerformance({
      taskRows: [task('t1', 'DONE'), task('t2', 'DONE')],
      sessionRows: [
        session({
          id: 's1',
          taskId: 't1',
          workspaceMemberId: 'mA',
          outputTokens: 10,
        }),
        // t2 DONE but never touched by a session → unattributed.
      ],
      turnEvents: [],
      memberLabels: new Map([['mA', 'Alice']]),
    })
    const last = out.rows[out.rows.length - 1]!
    expect(last.memberId).toBeNull()
    expect(last.label).toBeNull()
    expect(last.tasksDone).toBe(1) // t2
  })

  it('active time apportions so member rows and per-task rows reconcile', () => {
    const out = computeSprintTeamPerformance({
      taskRows: [task('t1', 'DONE'), task('t2', 'DONE')],
      sessionRows: [
        session({
          id: 's1',
          taskId: 't1',
          workspaceMemberId: 'mA',
          outputTokens: 10,
        }),
        session({
          id: 's2',
          taskId: 't2',
          workspaceMemberId: 'mA',
          outputTokens: 20,
        }),
      ],
      // s1: 30s active on t1, s2: 90s active on t2.
      turnEvents: [
        ...turn('s1', '2026-07-15T10:00:00.000Z', 30),
        ...turn('s2', '2026-07-15T11:00:00.000Z', 90),
      ],
      memberLabels: new Map([['mA', 'Alice']]),
    })
    const alice = out.rows.find(r => r.memberId === 'mA')!
    expect(alice.activeTimeSec).toBe(120)
    expect(out.totalActiveTimeSec).toBe(120)
    // Per-task rows sum EXACTLY to the member's activeTimeSec.
    const perTaskSum = alice.perTask.reduce((s, r) => s + r.activeTimeSec, 0)
    expect(perTaskSum).toBe(120)
    const t2Row = alice.perTask.find(r => r.taskId === 't2')!
    expect(t2Row.activeTimeSec).toBe(90)
    expect(t2Row.tokenCost).toBe(20)
    expect(t2Row.identifier).toBe('LUM-t2')
  })

  it('per-model split with explicit unattributed remainder', () => {
    const out = computeSprintTeamPerformance({
      taskRows: [task('t1', 'DONE')],
      sessionRows: [
        session({
          id: 's1',
          taskId: 't1',
          workspaceMemberId: 'mA',
          inputTokens: 100,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          usageByModel: {
            'claude-opus-4-8': {
              input: 60,
              output: 0,
              cacheRead: 0,
              cacheCreation: 0,
            },
          },
        }),
      ],
      turnEvents: [],
      memberLabels: new Map([['mA', 'Alice']]),
    })
    const alice = out.rows.find(r => r.memberId === 'mA')!
    expect(alice.models).toHaveLength(1)
    expect(alice.models[0]!.model).toBe('claude-opus-4-8')
    expect(alice.models[0]!.total).toBe(60)
    // 100 flat − 60 attributed to a model = 40 explicit remainder.
    expect(alice.modelUnattributedTokens).toBe(40)
    expect(alice.perTask[0]!.topModel).toBe('claude-opus-4-8')
  })

  it('exposes the per-model token split on each drill-down task row', () => {
    const out = computeSprintTeamPerformance({
      taskRows: [task('t1', 'DONE'), task('t2', 'DONE')],
      sessionRows: [
        // t1: two models, split across two sessions of the same member.
        session({
          id: 's1',
          taskId: 't1',
          workspaceMemberId: 'mA',
          inputTokens: 10,
          outputTokens: 20,
          cacheReadTokens: 30,
          cacheCreationTokens: 40,
          usageByModel: {
            'claude-opus-4-8': {
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
          inputTokens: 0,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          usageByModel: {
            'claude-haiku-4-5': {
              input: 0,
              output: 5,
              cacheRead: 0,
              cacheCreation: 0,
            },
          },
        }),
        // t2: flat columns only (pre-LUM-298) → no model split to show.
        session({
          id: 's3',
          taskId: 't2',
          workspaceMemberId: 'mA',
          outputTokens: 7,
        }),
        // Another member's spend on t1 must not leak into mA's split.
        session({
          id: 's4',
          taskId: 't1',
          workspaceMemberId: 'mB',
          outputTokens: 900,
          usageByModel: {
            'claude-sonnet-4-5': {
              input: 0,
              output: 900,
              cacheRead: 0,
              cacheCreation: 0,
            },
          },
        }),
      ],
      turnEvents: [],
      memberLabels: new Map([
        ['mA', 'Alice'],
        ['mB', 'Bob'],
      ]),
    })

    const alice = out.rows.find(r => r.memberId === 'mA')!
    const t1 = alice.perTask.find(r => r.taskId === 't1')!
    // Sorted by total desc, with the four token kinds carried per model.
    expect(t1.models.map(m => m.model)).toEqual([
      'claude-opus-4-8',
      'claude-haiku-4-5',
    ])
    expect(t1.models[0]).toMatchObject({
      input: 10,
      output: 20,
      cacheRead: 30,
      cacheCreation: 40,
      total: 100,
    })
    expect(t1.models[1]!.total).toBe(5)
    // The split reconciles with the row's own spend — Bob's 900 stays out.
    expect(t1.models.reduce((s, m) => s + m.total, 0)).toBe(t1.tokenCost)
    expect(t1.tokenCost).toBe(105)

    // No per-model map captured → empty split, spend still reported.
    const t2 = alice.perTask.find(r => r.taskId === 't2')!
    expect(t2.models).toEqual([])
    expect(t2.tokenCost).toBe(7)
  })

  it("splits an unattached session's active time across tasks by the event's task", () => {
    const tagged = (t: string, iso: string, sec: number) =>
      turn('U', iso, sec).map(e => ({ ...e, taskId: t }))
    const out = computeSprintTeamPerformance({
      taskRows: [task('t1', 'TODO'), task('t2', 'TODO')],
      sessionRows: [
        session({
          id: 'U',
          taskId: 't1',
          workspaceMemberId: 'mA',
          inputTokens: 5,
          outputTokens: 1,
        }),
        session({
          id: 'U',
          taskId: 't2',
          workspaceMemberId: 'mA',
          inputTokens: 7,
          outputTokens: 1,
        }),
      ],
      turnEvents: [
        ...tagged('t1', '2026-07-01T10:00:00Z', 60),
        ...tagged('t2', '2026-07-01T11:00:00Z', 120),
      ],
      memberLabels: new Map(),
    })
    const mA = out.rows.find(r => r.memberId === 'mA')!
    expect(mA.activeTimeSec).toBe(180)
    const byTask = new Map(mA.perTask.map(r => [r.taskId, r.activeTimeSec]))
    expect(byTask.get('t1')).toBe(60)
    expect(byTask.get('t2')).toBe(120)
  })

  it('counts runs as distinct top-level sessions per member (LUM-932)', () => {
    const out = computeSprintTeamPerformance({
      taskRows: [task('t1', 'TODO'), task('t2', 'TODO'), task('t3', 'TODO')],
      sessionRows: [
        // One unattached session U inferred onto three tasks → three rows.
        ...['t1', 't2', 't3'].map(t =>
          session({
            id: 'U',
            taskId: t,
            workspaceMemberId: 'mA',
            inputTokens: 1,
            outputTokens: 1,
          })
        ),
        // Two of its subagent children, each its own row.
        session({
          id: 'U:a1',
          taskId: 't1',
          workspaceMemberId: 'mA',
          inputTokens: 2,
          outputTokens: 0,
        }),
        session({
          id: 'U:a2',
          taskId: 't2',
          workspaceMemberId: 'mA',
          inputTokens: 3,
          outputTokens: 0,
        }),
        // A second, explicit top-level session.
        session({
          id: 'S',
          taskId: 't1',
          workspaceMemberId: 'mA',
          inputTokens: 4,
          outputTokens: 0,
        }),
      ],
      turnEvents: [],
      memberLabels: new Map(),
    })
    const mA = out.rows.find(r => r.memberId === 'mA')!
    expect(mA.runs).toBe(2) // U + S
    // Tokens stay per row: 3×2 + 2 + 3 + 4.
    expect(mA.tokenCost).toBe(15)
  })
})
