import {
  activeDurationMs,
  activeDurationMsBySession,
  activeDurationMsBySessionTask,
  sumActiveDurationSec,
  IDLE_THRESHOLD_MS,
} from '@/lib/agent-run/active-time'

const T0 = Date.parse('2026-06-13T01:00:00.000Z')
const at = (msOffset: number) => new Date(T0 + msOffset).toISOString()
const ev = (type: string, msOffset: number) => ({
  type,
  createdAt: at(msOffset),
})

const MIN = 60_000
const HOUR = 60 * MIN

describe('activeDurationMs', () => {
  it('counts a single completed turn prompt→STOP', () => {
    expect(
      activeDurationMs([
        ev('USER_PROMPT_SUBMIT', 0),
        ev('PRE_TOOL_USE', 5_000),
        ev('STOP', 30_000),
      ])
    ).toBe(30_000)
  })

  it('excludes the long idle gap between two turns (the bug case)', () => {
    // turn 1: 0 → 30s (30s). idle ~5h. turn 2: 5h → 5h+20s (20s). total 50s.
    expect(
      activeDurationMs([
        ev('USER_PROMPT_SUBMIT', 0),
        ev('STOP', 30_000),
        ev('SESSION_END', 2 * MIN),
        ev('SESSION_START', 5 * HOUR),
        ev('INSTRUCTIONS_LOADED', 5 * HOUR + 1_000),
        ev('USER_PROMPT_SUBMIT', 5 * HOUR + 10_000),
        ev('STOP', 5 * HOUR + 30_000),
      ])
    ).toBe(50_000)
  })

  it('treats STOP_FAILURE as a turn end', () => {
    expect(
      activeDurationMs([
        ev('USER_PROMPT_SUBMIT', 0),
        ev('STOP_FAILURE', 12_000),
      ])
    ).toBe(12_000)
  })

  it('ignores a STOP with no preceding prompt', () => {
    expect(activeDurationMs([ev('STOP', 9_000)])).toBe(0)
  })

  it('does not count an in-flight (open) turn with no STOP yet', () => {
    expect(
      activeDurationMs([
        ev('USER_PROMPT_SUBMIT', 0),
        ev('STOP', 10_000),
        ev('USER_PROMPT_SUBMIT', 60_000),
        ev('PRE_TOOL_USE', 65_000),
      ])
    ).toBe(10_000)
  })

  it('anchors a multi-prompt turn to the FIRST prompt', () => {
    expect(
      activeDurationMs([
        ev('USER_PROMPT_SUBMIT', 0),
        ev('USER_PROMPT_SUBMIT', 4_000),
        ev('STOP', 24_000),
      ])
    ).toBe(24_000)
  })

  it('ignores interleaved non-turn event types', () => {
    expect(
      activeDurationMs([
        ev('SESSION_START', 0),
        ev('USER_PROMPT_SUBMIT', 1_000),
        ev('PRE_TOOL_USE', 2_000),
        ev('POST_TOOL_USE', 3_000),
        ev('STOP', 11_000),
      ])
    ).toBe(10_000)
  })

  it('accepts Date createdAt as well as ISO strings', () => {
    expect(
      activeDurationMs([
        { type: 'USER_PROMPT_SUBMIT', createdAt: new Date(T0) },
        { type: 'STOP', createdAt: new Date(T0 + 7_000) },
      ])
    ).toBe(7_000)
  })

  // --- New wait-exclusion tests ---

  it('excludes PERMISSION_REQUEST gap (human-wait marker → long human pause)', () => {
    // Turn: prompt at 0, two tool calls at 2s/4s, then PERMISSION_REQUEST at 5s,
    // human responds 7 hours later (POST_TOOL_USE at 7h), then STOP at 7h+1s.
    // Active spans: [0→2s=2s] + [2s→4s=2s] + [4s→5s=1s] (PERMISSION_REQUEST gap excluded)
    //              + [7h→7h+1s=1s] = 6_000 ms
    const turnMs = activeDurationMs([
      ev('USER_PROMPT_SUBMIT', 0),
      ev('PRE_TOOL_USE', 2_000),
      ev('POST_TOOL_USE', 4_000),
      ev('PERMISSION_REQUEST', 5_000),
      ev('POST_TOOL_USE', 7 * HOUR), // human approved; tool ran
      ev('STOP', 7 * HOUR + 1_000),
    ])
    // The 7h gap after PERMISSION_REQUEST is excluded; only the 4 short spans count.
    expect(turnMs).toBe(6_000)
  })

  it('excludes NOTIFICATION gap (human-wait marker)', () => {
    // Turn: prompt(0)→PRE_TOOL_USE(2s)→NOTIFICATION(2.5s)→POST_TOOL_USE(2h)→STOP(2h+3s)
    // Gap accounting (consecutive pairs):
    //   0→2s     = 2000 ms  (no marker, below threshold) → counted
    //   2s→2.5s  =  500 ms  (no marker, below threshold) → counted
    //   NOTIFICATION→2h: marker, excluded
    //   2h→2h+3s = 3000 ms  (no marker) → counted
    // Total = 5_500 ms
    const turnMs = activeDurationMs([
      ev('USER_PROMPT_SUBMIT', 0),
      ev('PRE_TOOL_USE', 2_000),
      ev('NOTIFICATION', 2_500),
      ev('POST_TOOL_USE', 2 * HOUR),
      ev('STOP', 2 * HOUR + 3_000),
    ])
    expect(turnMs).toBe(5_500)
  })

  it('excludes ELICITATION gap (human-wait marker)', () => {
    // Turn: prompt(0)→PRE_TOOL_USE(1s)→POST_TOOL_USE(3s)→ELICITATION(3.5s)→ELICITATION_RESULT(6h)→STOP(6h+2s)
    // Gap accounting:
    //   0→1s     = 1000 ms → counted
    //   1s→3s    = 2000 ms → counted
    //   3s→3.5s  =  500 ms → counted
    //   ELICITATION→6h: marker, excluded
    //   6h→6h+2s = 2000 ms → counted
    // Total = 5_500 ms
    const turnMs = activeDurationMs([
      ev('USER_PROMPT_SUBMIT', 0),
      ev('PRE_TOOL_USE', 1_000),
      ev('POST_TOOL_USE', 3_000),
      ev('ELICITATION', 3_500),
      ev('ELICITATION_RESULT', 6 * HOUR),
      ev('STOP', 6 * HOUR + 2_000),
    ])
    expect(turnMs).toBe(5_500)
  })

  it('fully counts a dense turn with no human-wait markers', () => {
    // Turn: prompt at 0, 5 tool pairs each 3s apart, STOP at 30s.
    // All gaps are short (<5min) and no markers — every ms counted.
    const events = [
      ev('USER_PROMPT_SUBMIT', 0),
      ev('PRE_TOOL_USE', 3_000),
      ev('POST_TOOL_USE', 6_000),
      ev('PRE_TOOL_USE', 9_000),
      ev('POST_TOOL_USE', 12_000),
      ev('PRE_TOOL_USE', 15_000),
      ev('POST_TOOL_USE', 18_000),
      ev('STOP', 21_000),
    ]
    expect(activeDurationMs(events)).toBe(21_000)
  })

  it('excludes a gap >IDLE_THRESHOLD_MS even with no human-wait marker (backstop)', () => {
    // Turn: prompt, tool at 1s, then a 6-minute stall (no marker), tool at 6min+1s, STOP.
    // Gaps counted: 0→1s(1s) + 1s→2s(1s) + [2s→6m+2s excluded by backstop]
    //              + 6m+2s→6m+3s(1s) + 6m+3s→6m+4s(1s) = 4 counted 1s gaps = 4_000 ms
    const SIX_MIN = 6 * MIN
    const turnMs = activeDurationMs([
      ev('USER_PROMPT_SUBMIT', 0),
      ev('PRE_TOOL_USE', 1_000),
      ev('POST_TOOL_USE', 2_000),
      // 6-minute gap with no marker — exceeds IDLE_THRESHOLD_MS
      ev('PRE_TOOL_USE', 2_000 + SIX_MIN),
      ev('POST_TOOL_USE', 2_000 + SIX_MIN + 1_000),
      ev('STOP', 2_000 + SIX_MIN + 2_000),
    ])
    expect(turnMs).toBe(4_000)
    // Verify the backstop constant is what we expect
    expect(IDLE_THRESHOLD_MS).toBe(5 * MIN)
  })

  it('keeps a 4-min gap (below threshold, no marker) counted as active', () => {
    // Slightly below IDLE_THRESHOLD_MS — should be counted, not excluded.
    const FOUR_MIN = 4 * MIN
    const turnMs = activeDurationMs([
      ev('USER_PROMPT_SUBMIT', 0),
      ev('PRE_TOOL_USE', 1_000),
      ev('POST_TOOL_USE', 1_000 + FOUR_MIN),
      ev('STOP', 1_000 + FOUR_MIN + 1_000),
    ])
    // All gaps counted: 1s + 4min + 1s
    expect(turnMs).toBe(1_000 + FOUR_MIN + 1_000)
  })
})

describe('sumActiveDurationSec', () => {
  it('returns whole seconds', () => {
    expect(
      sumActiveDurationSec([
        { sessionId: 's1', type: 'USER_PROMPT_SUBMIT', createdAt: at(0) },
        { sessionId: 's1', type: 'STOP', createdAt: at(30_500) },
      ])
    ).toBe(31) // 30500ms → 31s (rounded)
  })

  it('groups by session — a STOP in one session never closes a prompt in another', () => {
    // s1 has a prompt but its STOP lives in s2; cross-pairing would yield a huge
    // span. Correct: s1 has an open turn (0), s2 has a STOP with no prompt (0).
    const total = sumActiveDurationSec([
      { sessionId: 's1', type: 'USER_PROMPT_SUBMIT', createdAt: at(0) },
      { sessionId: 's2', type: 'STOP', createdAt: at(5 * HOUR) },
    ])
    expect(total).toBe(0)
  })

  it('sums two sessions, each a completed turn', () => {
    const total = sumActiveDurationSec([
      { sessionId: 's1', type: 'USER_PROMPT_SUBMIT', createdAt: at(0) },
      { sessionId: 's1', type: 'STOP', createdAt: at(40_000) },
      { sessionId: 's2', type: 'USER_PROMPT_SUBMIT', createdAt: at(0) },
      { sessionId: 's2', type: 'STOP', createdAt: at(20_000) },
    ])
    expect(total).toBe(60)
  })

  it('handles unordered input within a session', () => {
    const total = sumActiveDurationSec([
      { sessionId: 's1', type: 'STOP', createdAt: at(30_000) },
      { sessionId: 's1', type: 'USER_PROMPT_SUBMIT', createdAt: at(0) },
    ])
    expect(total).toBe(30)
  })

  it('is 0 for an empty stream', () => {
    expect(sumActiveDurationSec([])).toBe(0)
  })
})

describe('activeDurationMsBySession', () => {
  it('returns per-session active ms (a session with no completed turn maps to 0)', () => {
    const map = activeDurationMsBySession([
      { sessionId: 's1', type: 'USER_PROMPT_SUBMIT', createdAt: at(0) },
      { sessionId: 's1', type: 'STOP', createdAt: at(40_000) },
      // s2 has only an open prompt (no STOP) → 0
      { sessionId: 's2', type: 'USER_PROMPT_SUBMIT', createdAt: at(0) },
    ])
    expect(map.get('s1')).toBe(40_000)
    expect(map.get('s2')).toBe(0)
  })

  it('excludes inter-turn idle within a session', () => {
    const map = activeDurationMsBySession([
      { sessionId: 's1', type: 'USER_PROMPT_SUBMIT', createdAt: at(0) },
      { sessionId: 's1', type: 'STOP', createdAt: at(30_000) },
      { sessionId: 's1', type: 'USER_PROMPT_SUBMIT', createdAt: at(5 * HOUR) },
      { sessionId: 's1', type: 'STOP', createdAt: at(5 * HOUR + 20_000) },
    ])
    expect(map.get('s1')).toBe(50_000)
  })
})

describe('activeDurationMsBySessionTask', () => {
  it("buckets one session's turns by each event's own task", () => {
    const groups = activeDurationMsBySessionTask(
      [
        {
          sessionId: 'U',
          taskId: 't1',
          type: 'USER_PROMPT_SUBMIT',
          createdAt: at(0),
        },
        { sessionId: 'U', taskId: 't1', type: 'STOP', createdAt: at(60_000) },
        {
          sessionId: 'U',
          taskId: 't2',
          type: 'USER_PROMPT_SUBMIT',
          createdAt: at(HOUR),
        },
        {
          sessionId: 'U',
          taskId: 't2',
          type: 'STOP',
          createdAt: at(HOUR + 120_000),
        },
      ],
      () => null
    )
    expect(groups).toEqual([
      { sessionId: 'U', taskId: 't1', ms: 60_000 },
      { sessionId: 'U', taskId: 't2', ms: 120_000 },
    ])
  })

  it('falls back to the session task when an event carries no task', () => {
    const groups = activeDurationMsBySessionTask(
      [
        { sessionId: 's1', type: 'USER_PROMPT_SUBMIT', createdAt: at(0) },
        { sessionId: 's1', type: 'STOP', createdAt: at(30_000) },
        { sessionId: null, type: 'USER_PROMPT_SUBMIT', createdAt: at(0) },
        { sessionId: null, type: 'STOP', createdAt: at(10_000) },
      ],
      sessionId => (sessionId === 's1' ? 't9' : null)
    )
    expect(groups).toEqual([
      { sessionId: 's1', taskId: 't9', ms: 30_000 },
      { sessionId: '__none__', taskId: null, ms: 10_000 },
    ])
  })
})
