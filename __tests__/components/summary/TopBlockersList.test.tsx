/**
 * Mock react-intl to avoid ESM transform issues under jest.
 * formatMessage supports simple {n} interpolation for "+{n} more".
 */
const messages: Record<string, string> = {
  'summary.topBlockers': 'Top blockers',
  'summary.blockerGroup.overdue': 'Overdue tasks',
  'summary.blockerGroup.stalled': 'Stalled tasks',
  'summary.blockerGroup.failingAgents': 'Failing agents',
  'summary.blockerGroup.stalePrs': 'Stale PRs',
  'summary.noBlockers': 'No blockers',
  'summary.showMore': '+{n} more',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, string | number>
    ) => {
      const raw = messages[id] ?? id
      if (!values) return raw
      return raw.replace(/\{(\w+)\}/g, (_, key) =>
        values[key] !== undefined ? String(values[key]) : `{${key}}`
      )
    },
  }),
}))

import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import { TopBlockersList } from '@/app/workspace/[workspaceUrl]/components/summary/TopBlockersList'
import type { TopBlockers } from '@/types/summary'

const allEmpty: TopBlockers = {
  overdueTaskIds: [],
  stalledTaskIds: [],
  failingAgentTaskIds: [],
  staleOpenPrNumbers: [],
}

describe('TopBlockersList', () => {
  it('renders "No blockers" when everything is empty', () => {
    render(<TopBlockersList blockers={allEmpty} onOpenTask={() => {}} />)
    expect(screen.getByText('No blockers')).toBeInTheDocument()
  })

  it('renders overdue and stalled groups with clickable items', () => {
    const onOpenTask = jest.fn()
    render(
      <TopBlockersList
        blockers={{
          overdueTaskIds: [
            { id: 't1', identifier: 'LUM-1', title: 'Fix login' },
            { id: 't2', identifier: 'LUM-2', title: 'Update API' },
          ],
          stalledTaskIds: [
            { id: 't3', identifier: 'LUM-3', title: 'Refactor auth' },
          ],
          failingAgentTaskIds: [],
          staleOpenPrNumbers: [],
        }}
        onOpenTask={onOpenTask}
      />
    )
    expect(screen.getByText(/Overdue tasks/)).toBeInTheDocument()
    expect(screen.getByText(/Stalled tasks/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('LUM-1 Fix login'))
    expect(onOpenTask).toHaveBeenCalledWith('t1')
  })

  it('caps items at 5 and shows +N more', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, i) => ({
      id,
      identifier: `LUM-${i + 1}`,
      title: `Task ${id}`,
    }))
    render(
      <TopBlockersList
        blockers={{ ...allEmpty, overdueTaskIds: items }}
        onOpenTask={() => {}}
      />
    )
    expect(screen.getByText('LUM-1 Task a')).toBeInTheDocument()
    expect(screen.getByText('LUM-5 Task e')).toBeInTheDocument()
    expect(screen.queryByText('LUM-6 Task f')).not.toBeInTheDocument()
    expect(screen.getByText('+2 more')).toBeInTheDocument()
  })
})
