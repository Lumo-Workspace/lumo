/** @jest-environment jsdom */
/**
 * LUM-942: the acceptance-criteria / verification-round feature is removed.
 * Its TaskActivityType values stay in Postgres and old rows still exist, so
 * the timeline must render nothing for them — not the raw lowercase default.
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
import { render } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  TimelineEntryRenderer,
  RETIRED_ACTIVITY_TYPES,
} from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TimelineEntryRenderer'
import type { TimelineActivityEntry } from '@/app/workspace/[workspaceUrl]/types'

function entry(type: string): TimelineActivityEntry {
  return {
    id: 'a-1',
    kind: 'activity',
    type,
    payload: { round: 1, verdict: 'PASS', statement: 'legacy criterion' },
    actorId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('retired acceptance activity types', () => {
  it('covers every retired verification / criteria activity type', () => {
    expect([...RETIRED_ACTIVITY_TYPES].sort()).toEqual([
      'CONTRACT_CONFIRMED',
      'CRITERION_CHANGED',
      'VERIFICATION_ESCALATED',
      'VERIFICATION_RUN_RECORDED',
      'VERIFICATION_RUN_WITHDRAWN',
    ])
  })

  it.each([...RETIRED_ACTIVITY_TYPES])('renders nothing for %s', type => {
    const { container } = render(
      <TooltipProvider>
        <TimelineEntryRenderer
          entry={entry(type)}
          members={[]}
          agentActors={[]}
        />
      </TooltipProvider>
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('still renders a surviving activity type', () => {
    const { container } = render(
      <TooltipProvider>
        <TimelineEntryRenderer
          entry={entry('TITLE_CHANGED')}
          members={[]}
          agentActors={[]}
        />
      </TooltipProvider>
    )
    expect(container).not.toBeEmptyDOMElement()
  })
})
