/**
 * Mock react-intl to avoid ESM transform issues under jest (react-intl ships
 * as ESM and next/jest does not transpile it). We only need useIntl().formatMessage
 * and IntlProvider to accept a messages map.
 */
const messages: Record<string, string> = {
  'summary.riskLevel.healthy': 'Healthy',
  'summary.riskLevel.watch': 'Watch',
  'summary.riskLevel.atRisk': 'At risk',
  'summary.riskLevel.unassessed': 'Not assessed',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => messages[id] ?? id,
  }),
}))

import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { RiskBadge } from '@/app/workspace/[workspaceUrl]/components/summary/RiskBadge'

describe('RiskBadge', () => {
  it('renders healthy label', () => {
    render(<RiskBadge level='healthy' showLabel />)
    expect(screen.getByText('Healthy')).toBeInTheDocument()
  })
  it('renders watch label', () => {
    render(<RiskBadge level='watch' showLabel />)
    expect(screen.getByText('Watch')).toBeInTheDocument()
  })
  it('renders at-risk label', () => {
    render(<RiskBadge level='at-risk' showLabel />)
    expect(screen.getByText('At risk')).toBeInTheDocument()
  })
  it('renders null state as Not assessed', () => {
    render(<RiskBadge level={null} showLabel />)
    expect(screen.getByText('Not assessed')).toBeInTheDocument()
  })
  it('hides label when showLabel is false', () => {
    render(<RiskBadge level='healthy' showLabel={false} />)
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument()
  })
})
