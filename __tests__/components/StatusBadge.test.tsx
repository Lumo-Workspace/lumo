/** @jest-environment jsdom */

const enMessages: Record<string, string> = {
  'status.todo': 'Todo',
  'status.inProgress': 'In Progress',
  'status.inReview': 'In Review',
  'status.done': 'Done',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => enMessages[id] ?? id,
  }),
}))

import { render, screen } from '@testing-library/react'
import { StatusBadge } from '@/app/workspace/[workspaceUrl]/components/StatusBadge'

describe('StatusBadge', () => {
  it('renders the localized label for each status', () => {
    render(<StatusBadge status='IN_PROGRESS' />)
    expect(screen.getByText('In Progress')).toBeInTheDocument()
  })

  it('honors a label override', () => {
    render(<StatusBadge status='DONE' label='Shipped' />)
    expect(screen.getByText('Shipped')).toBeInTheDocument()
  })

  it('falls back to todo label for an unknown status', () => {
    render(<StatusBadge status='WAT' />)
    expect(screen.getByText('Todo')).toBeInTheDocument()
  })
})
