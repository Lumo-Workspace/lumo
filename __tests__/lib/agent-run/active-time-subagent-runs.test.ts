/**
 * LUM-1237: subagent child sessions are timed by their own SUBAGENT_START →
 * SUBAGENT_STOP turns, and a run (root session + its subagents) is unioned
 * per task so overlap is counted once.
 */
import {
  activeDurationMs,
  activeDurationMsByRun,
  activeDurationMsByRunTask,
  activeDurationMsBySession,
  activeIntervals,
  isSubagentSessionId,
  runKeyOf,
  sumActiveDurationSec,
  unionMs,
  IDLE_THRESHOLD_MS,
} from '@/lib/agent-run/active-time'

const T0 = Date.parse('2026-10-18T09:00:00.000Z')
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString()
const ROOT = 'root-uuid'
const A1 = `${ROOT}:agent1`
const A2 = `${ROOT}:agent2`
const e = (
  sessionId: string,
  type: string,
  sec: number,
  taskId?: string | null
) => ({
  sessionId,
  type,
  createdAt: at(sec),
  ...(taskId !== undefined ? { taskId } : {}),
})

describe('session ids', () => {
  it('runKeyOf maps a child to its root and a root to itself', () => {
    expect(runKeyOf(A1)).toBe(ROOT)
    expect(runKeyOf(ROOT)).toBe(ROOT)
    expect(runKeyOf('__none__')).toBe('__none__')
  })

  it('isSubagentSessionId tells a child id from a root id', () => {
    expect(isSubagentSessionId(A1)).toBe(true)
    expect(isSubagentSessionId(ROOT)).toBe(false)
  })
})

describe('unionMs', () => {
  it('counts overlapping spans once and disjoint spans fully', () => {
    expect(
      unionMs([
        [0, 10],
        [5, 20],
        [30, 40],
        [35, 36],
      ])
    ).toBe(30)
    expect(unionMs([])).toBe(0)
  })
})

describe('activeIntervals / activeDurationMs with subagent turns', () => {
  const sub = [
    { type: 'SUBAGENT_START', createdAt: at(0) },
    { type: 'PRE_TOOL_USE', createdAt: at(10) },
    { type: 'POST_TOOL_USE', createdAt: at(40) },
    { type: 'SUBAGENT_STOP', createdAt: at(60) },
    // SendMessage resume: another pair on the same child.
    { type: 'SUBAGENT_START', createdAt: at(600) },
    { type: 'PRE_TOOL_USE', createdAt: at(620) },
    { type: 'SUBAGENT_STOP', createdAt: at(650) },
  ]

  it('a subagent stream counts each START→STOP turn, not the gap between', () => {
    expect(activeDurationMs(sub, { subagent: true })).toBe(110_000)
    expect(activeIntervals(sub, { subagent: true })).toEqual([
      [T0, T0 + 10_000],
      [T0 + 10_000, T0 + 40_000],
      [T0 + 40_000, T0 + 60_000],
      [T0 + 600_000, T0 + 620_000],
      [T0 + 620_000, T0 + 650_000],
    ])
  })

  it('read as a root stream (no prompts) the same events count nothing', () => {
    expect(activeDurationMs(sub)).toBe(0)
  })

  it('a still-running subagent (no SUBAGENT_STOP yet) is not counted', () => {
    expect(
      activeDurationMs(
        [
          { type: 'SUBAGENT_START', createdAt: at(0) },
          { type: 'PRE_TOOL_USE', createdAt: at(30) },
        ],
        { subagent: true }
      )
    ).toBe(0)
  })

  it('the first gap after SUBAGENT_START is exempt from the idle backstop, later long gaps are not', () => {
    const long = IDLE_THRESHOLD_MS / 1000 + 60
    expect(
      activeDurationMs(
        [
          { type: 'SUBAGENT_START', createdAt: at(0) },
          { type: 'PRE_TOOL_USE', createdAt: at(long) },
          { type: 'POST_TOOL_USE', createdAt: at(2 * long) },
          { type: 'SUBAGENT_STOP', createdAt: at(2 * long + 5) },
        ],
        { subagent: true }
      )
    ).toBe((long + 5) * 1000)
  })

  it('a SUBAGENT_STOP never closes a root turn (legacy rows on the parent)', () => {
    expect(
      activeDurationMs([
        { type: 'USER_PROMPT_SUBMIT', createdAt: at(0) },
        { type: 'SUBAGENT_STOP', createdAt: at(10) },
        { type: 'STOP', createdAt: at(30) },
      ])
    ).toBe(30_000)
  })
})

describe('activeDurationMsBySession', () => {
  it('times a child session by its subagent turns', () => {
    const m = activeDurationMsBySession([
      e(A1, 'SUBAGENT_START', 0),
      e(A1, 'SUBAGENT_STOP', 90),
    ])
    expect(m.get(A1)).toBe(90_000)
  })
})

describe('activeDurationMsByRunTask / ByRun', () => {
  it('a background subagent working while the parent idles adds its own time', () => {
    const events = [
      // Parent turn 0–10s dispatches; parent idle until the notification.
      e(ROOT, 'USER_PROMPT_SUBMIT', 0, 't1'),
      e(ROOT, 'STOP', 10, 't1'),
      e(A1, 'SUBAGENT_START', 5, 't1'),
      e(A1, 'PRE_TOOL_USE', 60, 't1'),
      e(A1, 'SUBAGENT_STOP', 200, 't1'),
      e(ROOT, 'USER_PROMPT_SUBMIT', 210, 't1'),
      e(ROOT, 'STOP', 220, 't1'),
    ]
    // Union: [0,200] ∪ [210,220] = 210s.
    expect(activeDurationMsByRun(events).get(ROOT)).toBe(210_000)
  })

  it('a foreground subagent inside a parent turn on the same task counts once', () => {
    const events = [
      e(ROOT, 'USER_PROMPT_SUBMIT', 0, 't1'),
      e(A1, 'SUBAGENT_START', 10, 't1'),
      e(A1, 'SUBAGENT_STOP', 50, 't1'),
      e(ROOT, 'STOP', 60, 't1'),
    ]
    expect(activeDurationMsByRun(events).get(ROOT)).toBe(60_000)
  })

  it('two parallel subagents on different tasks each keep their full time', () => {
    const groups = activeDurationMsByRunTask([
      e(A1, 'SUBAGENT_START', 0, 't1'),
      e(A2, 'SUBAGENT_START', 1, 't2'),
      e(A2, 'SUBAGENT_STOP', 241, 't2'),
      e(A1, 'SUBAGENT_STOP', 300, 't1'),
    ])
    expect(groups).toEqual([
      { runKey: ROOT, taskId: 't1', ms: 300_000 },
      { runKey: ROOT, taskId: 't2', ms: 240_000 },
    ])
    expect(
      activeDurationMsByRun([
        e(A1, 'SUBAGENT_START', 0, 't1'),
        e(A1, 'SUBAGENT_STOP', 300, 't1'),
        e(A2, 'SUBAGENT_START', 1, 't2'),
        e(A2, 'SUBAGENT_STOP', 241, 't2'),
      ]).get(ROOT)
    ).toBe(540_000)
  })

  it('falls back to the session task when an event carries none', () => {
    const groups = activeDurationMsByRunTask(
      [
        { sessionId: A1, type: 'SUBAGENT_START', createdAt: at(0) },
        { sessionId: A1, type: 'SUBAGENT_STOP', createdAt: at(30) },
      ],
      sessionId => (sessionId === A1 ? 't9' : null)
    )
    expect(groups).toEqual([{ runKey: ROOT, taskId: 't9', ms: 30_000 }])
  })

  it('sumActiveDurationSec rounds the run/task total once', () => {
    expect(
      sumActiveDurationSec([
        e(ROOT, 'USER_PROMPT_SUBMIT', 0, 't1'),
        e(ROOT, 'STOP', 10, 't1'),
        e(A1, 'SUBAGENT_START', 5, 't1'),
        e(A1, 'SUBAGENT_STOP', 200, 't1'),
      ])
    ).toBe(200)
  })
})
