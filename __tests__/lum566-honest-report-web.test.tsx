/** @jest-environment jsdom */
/**
 * LUM-566: the web task-detail Record tab renders the cost read-out (560) that
 * `lumo task status` prints, from the same GET /api/tasks/[id]/status read
 * model — same-source and fail-closed. (LUM-1009 removed the struggle trail
 * (561) and trend (562) from the web; the CLI's `--full` still prints them.)
 */
// The shared `formatDurationSec` (LUM-642) behind the Cost tile's active-time
// caption uses the `duration.*` keys, which carry no defaultMessage — the mock
// needs their en copy to render a real duration instead of the key.
const mockDurationMessages: Record<string, string> = {
  'duration.hours': '{hours}h',
  'duration.minutes': '{minutes}m',
  'duration.seconds': '{seconds}s',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id, defaultMessage }: { id: string; defaultMessage?: string },
      values?: Record<string, unknown>
    ) => {
      let msg = defaultMessage ?? mockDurationMessages[id] ?? id
      msg = msg.replace(
        /\{(\w+),\s*plural,\s*one\s*\{([^}]*)\}\s*other\s*\{([^}]*)\}\}/g,
        (_m, key, one, other) => {
          const n = Number(values?.[key] ?? 0)
          return (n === 1 ? one : other).replace('#', String(n))
        }
      )
      for (const [k, v] of Object.entries(values ?? {})) {
        msg = msg.split(`{${k}}`).join(String(v))
      }
      return msg
    },
  }),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTaskStatus', () => ({
  useTaskStatus: jest.fn(),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings', () => ({
  useBoundaryCrossings: jest.fn(() => ({
    crossings: [],
    loading: false,
    error: null,
    refresh: jest.fn(),
  })),
}))

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/BoundaryCrossingsPanel',
  () => ({
    BoundaryCrossingsPanel: () => <div id='boundary-crossings' />,
  })
)

import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { RecordTab } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/RecordTab'
import { useTaskStatus } from '@/app/workspace/[workspaceUrl]/hooks/useTaskStatus'
import type { TaskStatusView } from '@/app/workspace/[workspaceUrl]/types'

const mockStatus = useTaskStatus as jest.Mock

function statusView(over: Partial<TaskStatusView> = {}): TaskStatusView {
  return {
    version: 2,
    task: { id: 't1', identifier: 'LUM-1', title: 'x', status: 'IN_PROGRESS' },
    struggleTrail: { pullRequests: [], reopens: [] },
    cost: { tokenCost: 12_000, activeTimeSec: 134 },
    trend: {
      cost: [],
      rework: { reopens: 0, extraPrCycles: 0, total: 0 },
    },
    ...over,
  }
}

function set(data: TaskStatusView) {
  mockStatus.mockReturnValue({
    data,
    loading: false,
    error: null,
    refresh: jest.fn(),
  })
}

function render_() {
  return render(<RecordTab taskIdentifier='LUM-1' enabled={true} />)
}

beforeEach(() => jest.clearAllMocks())

// ── LUM-560 ───────────────────────────────────────────────────────────────────
// LUM-496/1009: the cost read-out is the Run overview's Cost tile — a null
// token cost reads "not recorded", never 0.
describe('cost tiles', () => {
  it('renders token spend and active time', () => {
    set(
      statusView({
        cost: { tokenCost: 1_200_000, activeTimeSec: 134 },
      })
    )
    render_()
    expect(screen.getByText('Cost')).toBeInTheDocument()
    expect(screen.getByTestId('tile-costTokens')).toHaveTextContent('1.2M')
    expect(screen.getByTestId('tile-costTokens')).toHaveTextContent(
      'Active time 2m 14s'
    )
  })

  it('shows an explicit not-recorded value when token cost was never measured', () => {
    set(statusView({ cost: { tokenCost: null, activeTimeSec: 0 } }))
    render_()
    expect(screen.getByTestId('tile-costTokens')).toHaveTextContent(
      /not recorded/i
    )
  })

  it('renders a measured zero as 0, distinct from not-recorded', () => {
    set(statusView({ cost: { tokenCost: 0, activeTimeSec: 0 } }))
    render_()
    const tile = screen.getByTestId('tile-costTokens')
    expect(tile).not.toHaveTextContent(/not recorded/i)
    expect(tile).toHaveTextContent('0')
  })
})

// ── LUM-1009 ──────────────────────────────────────────────────────────────────
describe('removed sections', () => {
  it('renders no struggle trail, trend or rework tile even with data for them', () => {
    set(
      statusView({
        struggleTrail: {
          pullRequests: [
            { number: 3, url: 'https://github.com/acme/repo/pull/3' },
            { number: 5, url: 'https://github.com/acme/repo/pull/5' },
          ],
          reopens: [
            {
              from: 'IN_REVIEW',
              to: 'IN_PROGRESS',
              at: '2026-06-11T00:00:00Z',
            },
          ],
        },
        trend: {
          cost: [
            { sessionId: 's1', total: 1000, loopCount: 1, at: '2026-06-10' },
            { sessionId: 's2', total: 3000, loopCount: 1, at: '2026-06-11' },
          ],
          rework: { reopens: 1, extraPrCycles: 1, total: 2 },
        },
      })
    )
    render_()
    expect(screen.queryByText(/Struggle/)).toBeNull()
    expect(screen.queryByText(/Reopened/)).toBeNull()
    expect(screen.queryByText(/Cost\/session/)).toBeNull()
    expect(screen.queryByText('Trend')).toBeNull()
    expect(screen.queryByTestId('tile-rework')).toBeNull()
  })
})
