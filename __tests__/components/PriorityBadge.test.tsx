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

import { render, screen, within } from '@testing-library/react'
import { PriorityBadge } from '@/app/workspace/[workspaceUrl]/components/PriorityBadge'
import type { ApiPriority } from '@/app/workspace/[workspaceUrl]/types'

const CASES: [ApiPriority, string][] = [
  ['URGENT', 'text-priority-urgent'],
  ['HIGH', 'text-priority-high'],
  ['MEDIUM', 'text-priority-medium'],
  ['LOW', 'text-priority-low'],
]

describe('PriorityBadge', () => {
  it('renders a colour dot for every priority', () => {
    for (const [priority, colorClass] of CASES) {
      for (const variant of ['dot', 'label'] as const) {
        const { container, unmount } = render(
          <PriorityBadge priority={priority} variant={variant} />
        )
        const dot = within(container).getByTestId(
          `priority-dot-${priority.toLowerCase()}`
        )
        expect(dot).toHaveClass('rounded-full', 'bg-current', colorClass)
        // The battery glyph is gone — a priority surface renders no icon (LUM-702).
        expect(container.querySelector('svg')).toBeNull()
        unmount()
      }
    }
  })

  it('label variant renders the localized label next to the dot', () => {
    render(<PriorityBadge priority='URGENT' variant='label' />)
    expect(screen.getByText('Urgent')).toBeInTheDocument()
    expect(screen.getByTestId('priority-dot-urgent')).toBeInTheDocument()
  })

  it('defaults to the tooltip-only dot with no visible label', () => {
    render(<PriorityBadge priority='LOW' />)
    expect(screen.getByTestId('priority-dot-low')).toBeInTheDocument()
    expect(screen.queryByText('Low')).not.toBeInTheDocument()
  })

  it('label variant honors a label override', () => {
    render(<PriorityBadge priority='MEDIUM' variant='label' label='P2' />)
    expect(screen.getByText('P2')).toBeInTheDocument()
  })
})
