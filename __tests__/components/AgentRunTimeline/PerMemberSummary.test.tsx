/** @jest-environment jsdom */

jest.mock('react-intl', () => ({
  useIntl: () => ({ formatNumber: (n: number) => String(n) }),
}))

import { render, screen } from '@testing-library/react'
import { PerMemberSummary } from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/PerMemberSummary'
import type { PerMemberSummaryRow } from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/summarize-per-member'

const rows: PerMemberSummaryRow[] = [
  { workspaceMemberId: 'a', name: 'Ann', imageUrl: '', total: 800, pct: 0.8 },
  { workspaceMemberId: 'b', name: 'Bo', imageUrl: '', total: 200, pct: 0.2 },
]

describe('PerMemberSummary', () => {
  it('renders nothing for a single member', () => {
    const { container } = render(<PerMemberSummary rows={[rows[0]!]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for an empty roster', () => {
    const { container } = render(<PerMemberSummary rows={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders one row per member with name and rounded percent when 2+ members', () => {
    render(<PerMemberSummary rows={rows} />)
    expect(screen.getByText('Ann')).toBeInTheDocument()
    expect(screen.getByText('Bo')).toBeInTheDocument()
    expect(screen.getByText('80%')).toBeInTheDocument()
    expect(screen.getByText('20%')).toBeInTheDocument()
  })
})
