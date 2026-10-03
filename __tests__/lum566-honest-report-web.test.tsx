/** @jest-environment jsdom */
/**
 * LUM-566: the web task-detail Record tab renders the honest-report sections
 * that LUM-559~562 put into `lumo task status` + the server read model — the
 * struggle / rework trail (561), the cost read-out (560) and the trend (562).
 * The data rides on GET /api/tasks/[id]/status; this proves the web renders it
 * same-source and fail-closed.
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
import { render, screen, fireEvent } from '@testing-library/react'
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
  const result = render(<RecordTab taskIdentifier='LUM-1' enabled={true} />)
  // LUM-496: the struggle trail folds behind its own heading inside the Run
  // report group — expand it so its body renders.
  const runReport = screen.getByRole('button', { name: /Run report/i })
  if (runReport.getAttribute('aria-expanded') === 'false') {
    fireEvent.click(runReport)
  }
  fireEvent.click(
    screen.getByRole('button', { name: /Struggle \/ rework \/ outstanding/i })
  )
  return result
}

beforeEach(() => jest.clearAllMocks())

// ── LUM-561 ───────────────────────────────────────────────────────────────────
describe('struggle section', () => {
  it('always renders and states the basis when the trail is empty', () => {
    set(statusView())
    render_()
    expect(
      screen.getByText('Struggle / rework / outstanding')
    ).toBeInTheDocument()
    // Honest basis, not a silent omission nor a bare "nothing outstanding".
    expect(screen.getByText(/None recorded/)).toBeInTheDocument()
    expect(screen.queryByText(/nothing outstanding/i)).toBeNull()
  })

  it('lists reopens and PR iterations when present', () => {
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
      })
    )
    render_()
    // LUM-496: the Run report also has a "PR iterations" KPI tile, so match the
    // struggle trail's own labelled line ("PR iterations: ") specifically.
    expect(screen.getByText(/PR iterations:/)).toBeInTheDocument()
    expect(screen.getByText(/Reopened/)).toBeInTheDocument()
    expect(screen.queryByText(/None recorded/)).toBeNull()
  })
})

// ── LUM-560 ───────────────────────────────────────────────────────────────────
// LUM-496: the cost read-out is the Run report's Cost / Rework KPI tiles — a
// null token cost reads "not recorded", never 0.
describe('cost tiles', () => {
  it('renders token spend, active time and accrued rework', () => {
    set(
      statusView({
        cost: { tokenCost: 1_200_000, activeTimeSec: 134 },
        trend: {
          cost: [],
          rework: { reopens: 1, extraPrCycles: 0, total: 1 },
        },
      })
    )
    render_()
    expect(screen.getByText('Cost')).toBeInTheDocument()
    expect(screen.getByTestId('tile-costTokens')).toHaveTextContent('1.2M')
    expect(screen.getByTestId('tile-costTokens')).toHaveTextContent(
      'Active time 2m 14s'
    )
    expect(screen.getByTestId('tile-rework')).toHaveTextContent('1')
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

// ── LUM-562 ───────────────────────────────────────────────────────────────────
describe('trend section', () => {
  it('says there is nothing to trend without measured cost', () => {
    set(statusView())
    render_()
    expect(screen.getByText(/nothing to trend/)).toBeInTheDocument()
  })

  it('draws the per-session cost trajectory across two sessions', () => {
    set(
      statusView({
        trend: {
          cost: [
            { sessionId: 's1', total: 1000, loopCount: 1, at: '2026-06-10' },
            { sessionId: 's2', total: 3000, loopCount: 1, at: '2026-06-11' },
          ],
          rework: { reopens: 0, extraPrCycles: 0, total: 0 },
        },
      })
    )
    render_()
    expect(screen.getByText(/Cost\/session:/)).toBeInTheDocument()
    expect(screen.queryByText(/Pass rate/)).toBeNull()
  })
})
