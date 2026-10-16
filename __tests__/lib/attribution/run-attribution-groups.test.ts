/**
 * LUM-1188 — badge confidence and subagent grouping moved out of the web
 * component into lib so the CLI run report renders the same values.
 */
import {
  groupSubagents,
  weakestConfidence,
  type RunSubagentView,
} from '@/lib/attribution/run-attribution'

const sub = (over: Partial<RunSubagentView>): RunSubagentView => ({
  sessionId: 's',
  agentType: 'Explore',
  source: 'INFERRED',
  confidence: 'HIGH',
  evidence: [],
  followsParent: false,
  ...over,
})

describe('weakestConfidence', () => {
  it('is null with no segments or subagents', () => {
    expect(weakestConfidence({ segments: [], subagents: [] })).toBeNull()
  })
  it('is MEDIUM when anything is medium, else HIGH', () => {
    expect(
      weakestConfidence({
        segments: [],
        subagents: [sub({ confidence: 'MEDIUM' })],
      })
    ).toBe('MEDIUM')
    expect(weakestConfidence({ segments: [], subagents: [sub({})] })).toBe(
      'HIGH'
    )
  })
})

describe('groupSubagents', () => {
  it('collapses look-alikes and keeps distinct ones apart, first-seen order', () => {
    const at = '2026-10-10T00:00:00.000Z'
    const ev = [{ kind: 'AGENT_PROMPT' as const, identifier: 'LUM-1', at }]
    const groups = groupSubagents([
      sub({ sessionId: 'a', evidence: ev }),
      sub({ sessionId: 'b', agentType: 'Plan' }),
      sub({ sessionId: 'c', evidence: ev }),
    ])
    expect(groups.map(g => [g.sub.sessionId, g.count])).toEqual([
      ['a', 2],
      ['b', 1],
    ])
  })
})
