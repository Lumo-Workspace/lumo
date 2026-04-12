/**
 * Mock react-intl to avoid ESM transform issues under jest.
 * We need useIntl() to return both formatMessage and locale.
 */
const messages: Record<string, string> = {
  'summary.todayFocus': "Today's Focus",
  'summary.showFullReport': 'Show full report',
  'summary.hideFullReport': 'Hide full report',
  'summary.riskLevel.healthy': 'Healthy',
  'summary.riskLevel.watch': 'Watch',
  'summary.riskLevel.atRisk': 'At risk',
  'summary.riskLevel.unassessed': 'Not assessed',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => messages[id] ?? id,
  }),
}))

import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import { BriefingCard } from '@/app/workspace/[workspaceUrl]/components/summary/BriefingCard'

const fullReport = `## Today's Focus

- Unblock PR #42
- Reassign AUTH task

## Risk

Project at risk: 7/20 overdue.`

describe('BriefingCard', () => {
  it('renders tldr, bullets, and risk narrative', () => {
    render(
      <BriefingCard
        tldr='Critical week ahead'
        report={fullReport}
        generatedAt={new Date('2026-04-11').toISOString()}
        risk={{ level: 'at-risk', score: 5, reasons: [] }}
      />
    )
    expect(screen.getByText('Critical week ahead')).toBeInTheDocument()
    expect(screen.getByText('Unblock PR #42')).toBeInTheDocument()
    expect(
      screen.getByText(/Project at risk: 7\/20 overdue/)
    ).toBeInTheDocument()
    expect(screen.getByText('At risk')).toBeInTheDocument()
  })

  it('falls back to raw markdown when no sections match (old data)', () => {
    const oldReport = `## Progress Overview\nOld content body.`
    render(
      <BriefingCard
        tldr='Old summary'
        report={oldReport}
        generatedAt={new Date('2026-04-01').toISOString()}
        risk={null}
      />
    )
    expect(screen.getByText(/Old content body/)).toBeInTheDocument()
    expect(screen.getByText('Not assessed')).toBeInTheDocument()
  })

  it('toggles full report visibility', () => {
    render(
      <BriefingCard
        tldr='x'
        report={fullReport}
        generatedAt={new Date().toISOString()}
        risk={{ level: 'healthy', score: 0, reasons: [] }}
      />
    )
    const toggle = screen.getByText('Show full report')
    fireEvent.click(toggle)
    expect(screen.getByText('Hide full report')).toBeInTheDocument()
  })
})
