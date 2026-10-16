/**
 * LUM-1188 — run digest + turn count moved to lib so the CLI run report and
 * the web card share them; turns must bracket like the web's segmentIntoTurns.
 */
import { countRunTurns, deriveRunDigest } from '@/lib/agent-run/run-digest'
import { segmentIntoTurns } from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/segment-turns'
import type { AgentRunItem } from '@/app/workspace/[workspaceUrl]/types'

const hook = (
  type: string,
  createdAt: string,
  turnSummary: string | null = null
) =>
  ({
    id: `${type}-${createdAt}`,
    kind: 'hook',
    type,
    toolName: null,
    payload: null,
    turnSummary,
    turnCost: null,
    createdAt,
  }) as unknown as AgentRunItem
const memory = (createdAt: string) =>
  ({
    id: `m-${createdAt}`,
    kind: 'memory',
    category: 'TRAP',
    agent: 'CLAUDE_CODE',
    content: {},
    createdAt,
  }) as unknown as AgentRunItem

describe('countRunTurns', () => {
  const cases: Array<[string, AgentRunItem[]]> = [
    ['empty', []],
    ['memories only', [memory('t1')]],
    ['one closed turn', [hook('PRE_TOOL_USE', 't1'), hook('STOP', 't2')]],
    [
      'closed + trailing open turn',
      [hook('STOP', 't1'), memory('t2'), hook('PRE_TOOL_USE', 't3')],
    ],
    [
      'STOP_FAILURE closes a turn',
      [hook('USER_PROMPT_SUBMIT', 't1'), hook('STOP_FAILURE', 't2')],
    ],
  ]
  it.each(cases)('%s matches the web segmentation', (_n, items) => {
    expect(countRunTurns(items)).toBe(segmentIntoTurns(items).length)
  })
})

describe('deriveRunDigest', () => {
  it('keeps the STOP turn summaries in time order, capped at the last five', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'].map((s, i) =>
      hook('STOP', `2026-01-0${i + 1}`, s)
    )
    expect(deriveRunDigest(items.reverse())).toEqual(['b', 'c', 'd', 'e', 'f'])
  })
})
