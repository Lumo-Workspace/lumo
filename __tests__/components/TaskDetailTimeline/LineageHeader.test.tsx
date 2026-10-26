// Mock react-intl: echo interpolated defaultMessage (same recipe as LineageTab.test).
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      d: { id?: string; defaultMessage?: string },
      values?: Record<string, string | number>
    ) => {
      let s = d.defaultMessage ?? d.id ?? ''
      if (values)
        for (const [k, v] of Object.entries(values))
          s = s.split(`{${k}}`).join(String(v))
      return s
    },
  }),
}))

import { render, screen } from '@testing-library/react'
import { LineageHeader } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/LineageHeader'

const BASE = {
  impressions: 41,
  index: 32,
  used: 0,
  voted: 0,
  sessions: 1,
  outcomes: { MERGED: 41, REWORKED: 0, REJECTED: 0, UNKNOWN: 0 },
}

describe('LineageHeader (LUM-1294)', () => {
  it('without votes: states what was injected and warns usefulness is unknown', () => {
    render(<LineageHeader {...BASE} />)
    expect(screen.getByText(/32 sent as a one-line index/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      "usefulness can't be measured"
    )
  })

  it('with votes: leads with the helped share and drops the warning', () => {
    render(<LineageHeader {...BASE} used={5} voted={12} />)
    expect(
      screen.getByText(/5 of 41 injected items helped \(12%\)/)
    ).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows a single outcome once, and counts when outcomes are mixed', () => {
    const { rerender } = render(<LineageHeader {...BASE} />)
    expect(screen.getByText('Task outcome: merged')).toBeInTheDocument()
    rerender(
      <LineageHeader
        {...BASE}
        outcomes={{ MERGED: 30, REWORKED: 11, REJECTED: 0, UNKNOWN: 0 }}
      />
    )
    expect(screen.getByText('merged · 30')).toBeInTheDocument()
    expect(screen.getByText('reworked · 11')).toBeInTheDocument()
  })
})
