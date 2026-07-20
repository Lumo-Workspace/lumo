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
})
