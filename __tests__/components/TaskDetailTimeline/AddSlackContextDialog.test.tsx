/**
 * Mock react-intl to avoid ESM transform issues under jest.
 */
const en: Record<string, string> = {
  'slackContext.dialog.title': 'Attach a Slack message',
  'slackContext.dialog.permalinkLabel': 'Slack permalink',
  'slackContext.dialog.permalinkPlaceholder': 'paste here',
  'slackContext.dialog.submit': 'Attach',
  'slackContext.error.invalidPermalink': 'invalid',
  'slackContext.error.notConnected': 'not connected',
  'slackContext.error.wrongTeam': 'wrong team',
  'slackContext.error.notInChannel': 'not in channel',
  'slackContext.error.messageGone': 'message gone',
  'slackContext.error.slackUnavailable': 'slack unavailable',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
  IntlProvider: ({ children }: { children: React.ReactNode }) => children,
}))

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AddSlackContextDialog } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/AddSlackContextDialog'

function renderIt(onSubmit = jest.fn().mockResolvedValue(undefined)) {
  render(<AddSlackContextDialog open onClose={jest.fn()} onSubmit={onSubmit} />)
  return { onSubmit }
}

describe('AddSlackContextDialog', () => {
  it('renders dialog with input', () => {
    renderIt()
    expect(screen.getByText('Attach a Slack message')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('paste here')).toBeInTheDocument()
  })

  it('calls onSubmit with the permalink', async () => {
    const { onSubmit } = renderIt()
    fireEvent.change(screen.getByPlaceholderText('paste here'), {
      target: { value: 'https://lumo.slack.com/archives/C9/p1700000000000100' },
    })
    fireEvent.click(screen.getByText('Attach'))
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        'https://lumo.slack.com/archives/C9/p1700000000000100'
      )
    })
  })

  it('shows error message when onSubmit throws ApiClientError-shaped error', async () => {
    const onSubmit = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('not_in_channel'), { status: 403 })
      )
    render(
      <AddSlackContextDialog open onClose={jest.fn()} onSubmit={onSubmit} />
    )
    fireEvent.change(screen.getByPlaceholderText('paste here'), {
      target: { value: 'https://lumo.slack.com/archives/C9/p1700000000000100' },
    })
    fireEvent.click(screen.getByText('Attach'))
    await waitFor(() => {
      expect(screen.getByText('not in channel')).toBeInTheDocument()
    })
  })
})
