import {
  buildRunAttribution,
  parseEvidence,
  summarizeRunAttributions,
  type RunAttribution,
  type TaskSegmentRow,
} from '@/lib/attribution/run-attribution'

const at = (m: number) => new Date(Date.UTC(2026, 9, 2, 10, m))
const row = (o: Partial<TaskSegmentRow>): TaskSegmentRow => ({
  sessionId: 'root',
  parentSessionId: null,
  agentType: null,
  source: 'INFERRED',
  confidence: 'HIGH',
  fromTurn: 0,
  toTurn: 0,
  fromAt: at(0),
  toAt: null,
  evidence: [],
  ...o,
})

describe('run attribution read model', () => {
  it('lists the root segments in turn order with parsed evidence', () => {
    const a = buildRunAttribution({
      runSessionId: 'root',
      mode: 'INFERRED',
      rows: [
        row({ fromTurn: 3, toTurn: 4, fromAt: at(30) }),
        row({
          fromTurn: 0,
          toTurn: 1,
          evidence: [{ kind: 'BRANCH', identifier: 'LUM-12', at: at(1).toISOString() }],
        }),
      ],
    })
    expect(a.segments.map(s => s.fromTurn)).toEqual([0, 3])
    expect(a.segments[0]!.evidence).toEqual([
      { kind: 'BRANCH', identifier: 'LUM-12', at: at(1).toISOString() },
    ])
    expect(a.approximate).toBe(true)
  })

  it('folds subagent rows under the run and keeps their agent type', () => {
    const a = buildRunAttribution({
      runSessionId: 'root',
      mode: 'HOST',
      rows: [
        row({
          sessionId: 'root:a1',
          parentSessionId: 'root',
          agentType: 'general-purpose',
          source: 'SUBAGENT_ATTACH',
          confidence: 'EXPLICIT',
        }),
        row({ sessionId: 'other', source: 'SESSION_ATTACH', confidence: 'EXPLICIT' }),
      ],
    })
    expect(a.segments).toEqual([])
    expect(a.subagents).toEqual([
      {
        sessionId: 'root:a1',
        agentType: 'general-purpose',
        source: 'SUBAGENT_ATTACH',
        confidence: 'EXPLICIT',
        evidence: [],
      },
    ])
    expect(a.approximate).toBe(false)
  })

  it('merges a subagent with several segments into one row at its weakest confidence', () => {
    const a = buildRunAttribution({
      runSessionId: 'root',
      mode: 'INFERRED',
      rows: [
        row({ sessionId: 'root:a1', parentSessionId: 'root', confidence: 'HIGH',
          evidence: [{ kind: 'AGENT_PROMPT', identifier: 'LUM-12', at: at(2).toISOString() }] }),
        row({ sessionId: 'root:a1', parentSessionId: 'root', confidence: 'MEDIUM', fromAt: at(5),
          evidence: [{ kind: 'PROMPT', identifier: 'LUM-12', at: at(5).toISOString() }] }),
      ],
    })
    expect(a.subagents).toHaveLength(1)
    expect(a.subagents[0]!.confidence).toBe('MEDIUM')
    expect(a.subagents[0]!.evidence.map(e => e.kind)).toEqual(['AGENT_PROMPT', 'PROMPT'])
  })

  it('an explicit run with only inherited subagents is exact', () => {
    const a = buildRunAttribution({
      runSessionId: 'root',
      mode: 'EXPLICIT',
      rows: [
        row({ source: 'SESSION_ATTACH', confidence: 'EXPLICIT' }),
        row({ sessionId: 'root:a1', parentSessionId: 'root', source: 'INHERITED', confidence: 'EXPLICIT' }),
      ],
    })
    expect(a.approximate).toBe(false)
  })

  it('a host run becomes approximate when one of its subagents was inferred', () => {
    const a = buildRunAttribution({
      runSessionId: 'root',
      mode: 'HOST',
      rows: [row({ sessionId: 'root:a1', parentSessionId: 'root', source: 'INFERRED' })],
    })
    expect(a.approximate).toBe(true)
  })

  it('drops malformed evidence entries', () => {
    expect(
      parseEvidence([
        { kind: 'BRANCH', identifier: 'LUM-1', at: '2026-10-02T10:00:00.000Z' },
        { kind: 'NOPE', identifier: 'LUM-1', at: 'x' },
        null,
        'str',
      ])
    ).toEqual([{ kind: 'BRANCH', identifier: 'LUM-1', at: '2026-10-02T10:00:00.000Z' }])
    expect(parseEvidence({})).toEqual([])
  })

  it('summarizes runs: host counts as explicit, unlinked runs are skipped', () => {
    const exact: RunAttribution = { mode: 'EXPLICIT', segments: [], subagents: [], approximate: false }
    const host: RunAttribution = { mode: 'HOST', segments: [], subagents: [], approximate: false }
    const inferred: RunAttribution = { mode: 'INFERRED', segments: [], subagents: [], approximate: true }
    expect(summarizeRunAttributions([exact, host, inferred, null])).toEqual({
      explicit: 2,
      inferred: 1,
      approximate: true,
    })
    expect(summarizeRunAttributions([exact])).toEqual({ explicit: 1, inferred: 0, approximate: false })
  })
})
