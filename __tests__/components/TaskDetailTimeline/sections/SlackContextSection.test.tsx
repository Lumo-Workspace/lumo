jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (d: { id?: string; defaultMessage?: string }) =>
      d.id ?? d.defaultMessage ?? '',
  }),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useParams: () => ({ workspaceUrl: 'test-workspace' }),
}))

import { render, screen } from '@testing-library/react'
import { Accordion } from '@/components/landing/ui/accordion'
import { SlackContextSection } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/SlackContextSection'

const noop = jest.fn()
const handlers = { onLink: noop, onRefreshOne: noop, onUnlink: noop }

describe('SlackContextSection', () => {
  it('shows not-connected empty state when slackConnected=false', () => {
    render(
      <Accordion type='multiple' defaultValue={['slack']}>
        <SlackContextSection
          contexts={[]}
          slackConnected={false}
          {...handlers}
        />
      </Accordion>
    )
    expect(
      screen.getByText('slackContext.empty.notConnected')
    ).toBeInTheDocument()
  })

  it('shows no-contexts empty state when connected and empty', () => {
    render(
      <Accordion type='multiple' defaultValue={['slack']}>
        <SlackContextSection contexts={[]} slackConnected {...handlers} />
      </Accordion>
    )
    expect(
      screen.getByText('slackContext.empty.noContexts')
    ).toBeInTheDocument()
  })

  it('renders count in the header', () => {
    render(
      <Accordion type='multiple'>
        <SlackContextSection
          contexts={[
            {
              id: 'c1',
              snapshot: {
                messages: [{ ts: '1', text: 't', userId: 'u', userName: 'U' }],
              },
              snapshotAt: new Date().toISOString(),
              isThread: false,
              permalink: '#',
              slackChannelName: 'general',
              refreshError: null,
            } as never,
          ]}
          slackConnected
          {...handlers}
        />
      </Accordion>
    )
    expect(screen.getByText('1')).toBeInTheDocument()
  })
})
