import { segmentIntoTurns } from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/segment-turns'
import type { AgentRunItem } from '@/app/workspace/[workspaceUrl]/types'

it('attaches the STOP item turnCost to its terminated turn', () => {
  const items: AgentRunItem[] = [
    {
      id: 'a',
      kind: 'hook',
      type: 'PRE_TOOL_USE',
      toolName: 'Read',
      payload: {},
      turnSummary: null,
      turnCost: null,
      createdAt: '2026-06-01T10:00:00.000Z',
    },
    {
      id: 'b',
      kind: 'hook',
      type: 'STOP',
      toolName: null,
      payload: {},
      turnSummary: 'done',
      turnCost: {
        byModel: [
          {
            model: 'opus',
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheCreation: 0,
            total: 2,
          },
        ],
      },
      createdAt: '2026-06-01T10:01:00.000Z',
    },
  ]
  const turns = segmentIntoTurns(items)
  expect(turns).toHaveLength(1)
  expect(turns[0]!.cost).toEqual({
    byModel: [
      {
        model: 'opus',
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheCreation: 0,
        total: 2,
      },
    ],
  })
})

it('leaves cost null for an unterminated turn', () => {
  const items: AgentRunItem[] = [
    {
      id: 'a',
      kind: 'hook',
      type: 'PRE_TOOL_USE',
      toolName: 'Read',
      payload: {},
      turnSummary: null,
      turnCost: null,
      createdAt: '2026-06-01T10:00:00.000Z',
    },
  ]
  expect(segmentIntoTurns(items)[0]!.cost).toBeNull()
})
