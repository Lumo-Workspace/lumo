/** @jest-environment jsdom */
/**
 * LUM-942: the acceptance-criteria / verification-round activities are retired.
 * Old rows still come back from the timeline API; the Activity tab drops them
 * before grouping, and offers no "Verification" filter chip any more.
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({
      id,
      defaultMessage,
    }: {
      id: string
      defaultMessage?: string
    }) => defaultMessage ?? id,
  }),
}))

import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ActivityTimeline } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/ActivityTimeline'
import type { TimelineEntry } from '@/app/workspace/[workspaceUrl]/types'

function activity(id: string, type: string): TimelineEntry {
  return {
    id,
    kind: 'activity',
    type,
    payload: { statement: 'legacy criterion', round: 1, verdict: 'PASS' },
    actorId: null,
    createdAt: '2026-06-10T10:00:00.000Z',
  } as TimelineEntry
}

function renderTimeline(entries: TimelineEntry[]) {
  return render(
    <TooltipProvider>
      <ActivityTimeline
        entries={entries}
        loading={false}
        hasMore={false}
        loadingMore={false}
        onLoadMore={jest.fn()}
        members={[]}
        agentActors={[]}
      />
    </TooltipProvider>
  )
}

describe('ActivityTimeline — retired acceptance activities', () => {
  it('renders surviving activities and drops retired ones', () => {
    renderTimeline([
      activity('a1', 'TITLE_CHANGED'),
      activity('a2', 'CRITERION_CHANGED'),
      activity('a3', 'VERIFICATION_RUN_RECORDED'),
      activity('a4', 'CONTRACT_CONFIRMED'),
    ])
    expect(screen.getByText('System')).toBeInTheDocument()
    expect(screen.getAllByText('System')).toHaveLength(1)
    expect(screen.queryByText(/legacy criterion/)).toBeNull()
    expect(screen.queryByText('Verification')).toBeNull()
  })

  it('shows the empty state when only retired activities exist', () => {
    renderTimeline([
      activity('a1', 'VERIFICATION_ESCALATED'),
      activity('a2', 'VERIFICATION_RUN_WITHDRAWN'),
    ])
    expect(screen.queryByText('System')).toBeNull()
    expect(screen.queryByText('Verification')).toBeNull()
  })
})
