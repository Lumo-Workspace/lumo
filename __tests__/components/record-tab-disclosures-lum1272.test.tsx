/** @jest-environment jsdom */
/**
 * LUM-1272: the Record tab's remaining hand-rolled disclosures (turn events,
 * agent run card, lineage fragments) now use the shared Collapsible, so the
 * trigger is a real button that Enter / Space toggle and that carries
 * aria-expanded.
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      d: { id?: string; defaultMessage?: string },
      values?: Record<string, string | number>
    ) => {
      let s = d.defaultMessage ?? d.id ?? ''
      if (values) {
        s = s.replace(
          /\{(\w+),\s*plural,\s*one\s*\{([^}]*)\}\s*other\s*\{([^}]*)\}\}/g,
          (_: string, key: string, one: string, other: string) => {
            const n = Number(values[key] ?? 0)
            return (n === 1 ? one : other).replace('#', String(n))
          }
        )
        for (const [k, v] of Object.entries(values)) {
          s = s.split(`{${k}}`).join(String(v))
        }
      }
      return s
    },
    formatNumber: (n: number) => String(n),
  }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/components/AgentBadge', () => ({
  AgentBadge: () => null,
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/RunRawRecordDelete',
  () => ({ RunRawRecordDelete: () => null })
)
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTaskLineage', () => ({
  useTaskLineage: jest.fn(),
}))

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TurnCard } from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/TurnCard'
import { AgentRunCard } from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/AgentRunCard'
import { LineageTab } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/LineageTab'
import { useTaskLineage } from '@/app/workspace/[workspaceUrl]/hooks/useTaskLineage'
import type { Turn } from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/segment-turns'
import type { AgentRunSession } from '@/app/workspace/[workspaceUrl]/types'

const event = {
  id: 'e1',
  kind: 'hook',
  type: 'PRE_TOOL_USE',
  toolName: 'Bash',
  payload: { tool_input: { command: 'npm run unique-cmd' } },
  turnSummary: null,
  turnCost: null,
  createdAt: '2026-10-18T10:00:00.000Z',
}

const turn = {
  startTime: '2026-10-18T10:00:00.000Z',
  endTime: '2026-10-18T10:05:00.000Z',
  events: [event],
  memories: [],
  terminated: true,
  summary: null,
  cost: null,
} as unknown as Turn

it('toggles a turn’s event list with Enter and Space', async () => {
  const user = userEvent.setup()
  render(<TurnCard turn={turn} turnNumber={1} />)
  const trigger = screen.getByRole('button', { name: /个事件/ })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText(/unique-cmd/)).not.toBeInTheDocument()
  trigger.focus()
  await user.keyboard('{Enter}')
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText(/unique-cmd/)).toBeInTheDocument()
  await user.keyboard(' ')
  expect(screen.queryByText(/unique-cmd/)).not.toBeInTheDocument()
})

const run = {
  sessionId: 's1',
  agent: 'CLAUDE_CODE',
  runNumber: 4,
  startedAt: '2026-10-18T10:00:00Z',
  lastActivityAt: '2026-10-18T10:10:00Z',
  durationMs: 600_000,
  toolCallCount: 1,
  eventCount: 1,
  memoryCount: 0,
  cost: null,
  member: null,
  attribution: null,
  usageResyncedAt: null,
  items: [],
} as unknown as AgentRunSession

it('toggles an agent run card with Enter and Space', async () => {
  const user = userEvent.setup()
  render(<AgentRunCard run={run} />)
  const trigger = screen.getByRole('button', { name: /Run #4/ })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  trigger.focus()
  await user.keyboard('{Enter}')
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText('本次运行没有捕获到事件')).toBeInTheDocument()
  await user.keyboard(' ')
  expect(screen.queryByText('本次运行没有捕获到事件')).not.toBeInTheDocument()
})

it('keeps defaultExpanded opening the run card', () => {
  render(<AgentRunCard run={run} defaultExpanded />)
  expect(screen.getByRole('button', { name: /Run #4/ })).toHaveAttribute(
    'aria-expanded',
    'true'
  )
})

it('toggles the lineage fragment list with Enter and Space', async () => {
  ;(useTaskLineage as jest.Mock).mockReturnValue({
    loading: false,
    error: null,
    data: {
      task: { identifier: 'LUM-1', title: 'T', status: 'DONE' },
      totals: {
        runCount: 1,
        fragmentCount: 1,
        edgeCount: 1,
        tokens: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheCreation: 0,
          total: 0,
        },
        loopCount: null,
        outcomes: { MERGED: 1, REJECTED: 0, REWORKED: 0, UNKNOWN: 0 },
        funnel: {
          impressions: 0,
          index: 0,
          pulled: 0,
          used: 0,
          tokensSaved: null,
        },
        topOperations: [],
      },
      groups: [
        {
          kind: 'session',
          sessionId: 's1',
          label: 'Session s1',
          includedAt: '2026-10-01T00:00:00.000Z',
          cost: null,
          fragments: [
            {
              fragmentType: 'MEMORY',
              fragmentId: 'f1',
              sourceLabel: 'Only fragment',
              outcome: 'MERGED',
              used: null,
              disclosure: 'FULL',
              pulled: false,
            },
          ],
        },
      ],
    },
  })
  const user = userEvent.setup()
  render(<LineageTab taskIdentifier='LUM-1' enabled showCost={false} />)
  const trigger = screen.getByRole('button', { name: /Show all 1 fragments/ })
  expect(screen.queryByText(/Only fragment/)).not.toBeInTheDocument()
  trigger.focus()
  await user.keyboard('{Enter}')
  expect(screen.getByText(/Only fragment/)).toBeInTheDocument()
  await user.keyboard(' ')
  expect(screen.queryByText(/Only fragment/)).not.toBeInTheDocument()
})
