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
          overdueTaskIds: ['t1', 't2'],
          stalledTaskIds: ['t3'],
          failingAgentTaskIds: [],
          staleOpenPrNumbers: [],
        }}
        onOpenTask={onOpenTask}
      />
    )
    expect(screen.getByText(/Overdue tasks/)).toBeInTheDocument()
    expect(screen.getByText(/Stalled tasks/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('t1'))
    expect(onOpenTask).toHaveBeenCalledWith('t1')
  })

  it('caps items at 5 and shows +N more', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    render(
      <TopBlockersList
        blockers={{ ...allEmpty, overdueTaskIds: ids }}
        onOpenTask={() => {}}
      />
    )
    expect(screen.getByText('a')).toBeInTheDocument()
    expect(screen.getByText('e')).toBeInTheDocument()
    expect(screen.queryByText('f')).not.toBeInTheDocument()
    expect(screen.getByText('+2 more')).toBeInTheDocument()
  })
})
