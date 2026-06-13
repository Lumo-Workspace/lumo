import type { AgentRunItem } from '../../../types'
import { deriveRunDigest } from '../derive-run-digest'

function makeStop(createdAt: string, turnSummary: string | null): AgentRunItem {
  return {
    id: `id-${createdAt}`,
    kind: 'hook',
    type: 'STOP',
    toolName: null,
    payload: null,
    turnSummary,
    turnCost: null,
    createdAt,
  } as AgentRunItem
}

function makeStopFailure(
  createdAt: string,
  turnSummary: string | null
): AgentRunItem {
  return {
    id: `idf-${createdAt}`,
    kind: 'hook',
    type: 'STOP_FAILURE',
    toolName: null,
    payload: null,
    turnSummary,
    turnCost: null,
    createdAt,
  } as AgentRunItem
}

function makeMemory(createdAt: string): AgentRunItem {
  return {
    id: `mem-${createdAt}`,
    kind: 'memory',
    category: 'DECISION',
    agent: 'CLAUDE_CODE',
    content: {},
    createdAt,
  } as unknown as AgentRunItem
}

describe('deriveRunDigest', () => {
  it('returns STOP turnSummaries in time order dropping empties', () => {
    const items: AgentRunItem[] = [
      makeStop('2024-01-01T00:00:03Z', 'third'),
      makeStop('2024-01-01T00:00:01Z', 'first'),
      makeStop('2024-01-01T00:00:02Z', null), // null → dropped
      makeStop('2024-01-01T00:00:04Z', '   '), // whitespace → dropped
      makeStopFailure('2024-01-01T00:00:05Z', 'fifth'),
    ]
    expect(deriveRunDigest(items)).toEqual(['first', 'third', 'fifth'])
  })

  it('caps to the most recent five', () => {
    const items: AgentRunItem[] = [
      makeStop('2024-01-01T00:00:01Z', 'one'),
      makeStop('2024-01-01T00:00:02Z', 'two'),
      makeStop('2024-01-01T00:00:03Z', 'three'),
      makeStop('2024-01-01T00:00:04Z', 'four'),
      makeStop('2024-01-01T00:00:05Z', 'five'),
      makeStop('2024-01-01T00:00:06Z', 'six'),
      makeStop('2024-01-01T00:00:07Z', 'seven'),
      makeStop('2024-01-01T00:00:08Z', 'eight'),
    ]
    const result = deriveRunDigest(items)
    expect(result).toHaveLength(5)
    expect(result).toEqual(['four', 'five', 'six', 'seven', 'eight'])
  })

  it('returns empty array when no STOP summaries', () => {
    expect(deriveRunDigest([])).toEqual([])

    const onlyMemory: AgentRunItem[] = [
      makeMemory('2024-01-01T00:00:01Z'),
      makeMemory('2024-01-01T00:00:02Z'),
    ]
    expect(deriveRunDigest(onlyMemory)).toEqual([])

    const noSummaries: AgentRunItem[] = [
      makeStop('2024-01-01T00:00:01Z', null),
      makeStop('2024-01-01T00:00:02Z', ''),
    ]
    expect(deriveRunDigest(noSummaries)).toEqual([])
  })
})
