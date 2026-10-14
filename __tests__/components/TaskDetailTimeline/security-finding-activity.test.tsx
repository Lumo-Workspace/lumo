/** @jest-environment jsdom */
/**
 * LUM-1128: a ruling on a PR security finding shows on the task timeline with
 * the surface it came through — CLI (`lumo finding disposition`) or the web
 * panel — and a web correction of a CLI ruling reads as a change.
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, unknown>
    ) => (values ? `${id} ${JSON.stringify(values)}` : id),
  }),
}))

import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ActivityTimeline } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/ActivityTimeline'
import type { TimelineEntry } from '@/app/workspace/[workspaceUrl]/types'

function entry(id: string, payload: Record<string, unknown>): TimelineEntry {
  return {
    id,
    kind: 'activity',
    type: 'SECURITY_FINDING_DISPOSITIONED',
    payload,
    actorId: null,
    createdAt: '2026-10-14T10:00:00.000Z',
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

describe('SECURITY_FINDING_DISPOSITIONED on the timeline', () => {
  it('renders a CLI ruling and a web correction with their channels', () => {
    renderTimeline([
      entry('a1', {
        ruleId: 'secret:aws',
        from: null,
        to: 'FALSE_POSITIVE',
        channel: 'CLI',
      }),
      entry('a2', {
        ruleId: 'secret:aws',
        from: 'FALSE_POSITIVE',
        to: 'ACCEPTED_RISK',
        channel: 'WEB',
      }),
    ])
    const rows = screen.getAllByTestId(
      'activity-security-finding-dispositioned'
    )
    expect(rows).toHaveLength(2)
    const text = rows.map(r => r.textContent).join('\n')
    expect(text).toContain('activity.securityFindingDispositioned')
    expect(text).toContain('activity.securityFindingChannel.CLI')
    expect(text).toContain('activity.securityFindingRedispositioned')
    expect(text).toContain('activity.securityFindingChannel.WEB')
    expect(text).toContain('securityScan.disposition.ACCEPTED_RISK')
  })
})
