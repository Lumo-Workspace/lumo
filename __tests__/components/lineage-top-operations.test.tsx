/**
 * LUM-840: a `Bash · <purpose>` row in the lineage Top operations table
 * expands to the commands behind it.
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (d: { id?: string; defaultMessage?: string }) =>
      d.defaultMessage ?? d.id ?? '',
    formatNumber: (n: number) => n.toLocaleString('en-US'),
  }),
}))

import { fireEvent, render, screen } from '@testing-library/react'
import { TopOperations } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TopOperations'

const cost = (total: number) => ({
  output: 0,
  input: 0,
  cacheCreation: 0,
  cacheRead: total,
  total,
})

const OPS = [
  {
    tool: 'Bash · read/search',
    ...cost(9000),
    commands: [
      { command: 'grep', ...cost(6000) },
      { command: 'git show', ...cost(3000) },
    ],
  },
  { tool: 'Read', ...cost(4000) },
]

describe('TopOperations command drill-down', () => {
  it('expands a Bash row to its commands', () => {
    render(
      <TopOperations
        operations={OPS}
        precision={null}
        taskIdentifier='LUM-837'
      />
    )
    const toggle = screen.getByRole('button', { name: /Bash · read\/search/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/git show/)).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/↳ grep/)).toBeInTheDocument()
    expect(screen.getByText(/↳ git show/)).toBeInTheDocument()
    expect(screen.getAllByText('6,000').length).toBeGreaterThan(0)

    fireEvent.click(toggle)
    expect(screen.queryByText(/↳ grep/)).not.toBeInTheDocument()
  })

  it('renders a row without commands as plain text, not a toggle', () => {
    render(
      <TopOperations
        operations={OPS}
        precision={null}
        taskIdentifier='LUM-837'
      />
    )
    expect(screen.queryByRole('button', { name: 'Read' })).toBeNull()
    expect(screen.getByText('Read')).toBeInTheDocument()
  })
})
