jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (descriptor: { id?: string; defaultMessage?: string }) =>
      descriptor.id ?? descriptor.defaultMessage ?? '',
  }),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useSlackContexts', () => ({
  useSlackContexts: jest.fn(),
}))

import { render, screen } from '@testing-library/react'
import { SlackContextTab } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/SlackContextTab'
import { useSlackContexts } from '@/app/workspace/[workspaceUrl]/hooks/useSlackContexts'

const useHook = useSlackContexts as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('SlackContextTab', () => {
  it('renders empty state when no contexts', () => {
    useHook.mockReturnValue({
      contexts: [],
      loading: false,
      error: null,
      refresh: jest.fn(),
      link: jest.fn(),
      refreshOne: jest.fn(),
      unlink: jest.fn(),
    })
    render(<SlackContextTab taskId='tsk_1' slackConnected />)
    expect(
      screen.getByText('slackContext.empty.noContexts')
    ).toBeInTheDocument()
  })

  it('renders not-connected state when slackConnected=false', () => {
    useHook.mockReturnValue({
      contexts: [],
      loading: false,
      error: null,
      refresh: jest.fn(),
      link: jest.fn(),
      refreshOne: jest.fn(),
      unlink: jest.fn(),
    })
    render(<SlackContextTab taskId='tsk_1' slackConnected={false} />)
    expect(
      screen.getByText('slackContext.empty.notConnected')
    ).toBeInTheDocument()
  })

  it('renders cards when contexts are present', () => {
    useHook.mockReturnValue({
      contexts: [
        {
          id: 'ctx_1',
          slackChannelName: 'design',
          permalink: 'https://lumo.slack.com/archives/C9/p1700000000000100',
          snapshotAt: new Date().toISOString(),
          refreshError: null,
          isThread: false,
          snapshot: {
            messages: [
              {
                ts: '1',
                userId: 'U1',
                userName: 'alice',
                userAvatarUrl: null,
                text: 'hello',
                edited: false,
              },
            ],
          },
        },
      ],
      loading: false,
      error: null,
      refresh: jest.fn(),
      link: jest.fn(),
      refreshOne: jest.fn(),
      unlink: jest.fn(),
    })
    render(<SlackContextTab taskId='tsk_1' slackConnected />)
    expect(screen.getByText(/hello/)).toBeInTheDocument()
  })
})
