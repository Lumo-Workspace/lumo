import {
  activeDurationMs,
  sumActiveDurationSec,
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
