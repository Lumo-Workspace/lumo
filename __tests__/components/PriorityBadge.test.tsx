/** @jest-environment jsdom */

const enMessages: Record<string, string> = {
  'priority.urgent': 'Urgent',
  'priority.high': 'High',
  'priority.medium': 'Medium',
  'priority.low': 'Low',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => enMessages[id] ?? id,
  }),
}))

import { render, screen } from '@testing-library/react'
import { PriorityBadge } from '@/app/workspace/[workspaceUrl]/components/PriorityBadge'

describe('PriorityBadge', () => {
  it('icon variant renders the localized label', () => {
    render(<PriorityBadge priority='URGENT' variant='icon' />)
    expect(screen.getByText('Urgent')).toBeInTheDocument()
  })

  it('bare variant renders no visible label text', () => {
    render(<PriorityBadge priority='HIGH' variant='bare' />)
    expect(screen.queryByText('High')).not.toBeInTheDocument()
  })

  it('defaults to bare (preserves existing icon-only call sites)', () => {
    render(<PriorityBadge priority='LOW' />)
    expect(screen.queryByText('Low')).not.toBeInTheDocument()
  })

  it('icon variant honors a label override', () => {
    render(<PriorityBadge priority='MEDIUM' variant='icon' label='P2' />)
    expect(screen.getByText('P2')).toBeInTheDocument()
  })
})
