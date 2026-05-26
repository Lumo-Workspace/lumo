/**
 * Mock react-intl to avoid ESM transform issues under jest.
 * Returns the key as the rendered string when no translation is registered,
 * matching react-intl's missing-translation fallback.
 */
const en: Record<string, string> = {
  'task.contextLink.slack.placeholder':
    'https://your-team.slack.com/archives/…/p…',
  'task.contextLink.slack.errors.workspaceNotConnected':
    'Slack is not connected to this workspace.',
  'task.contextLink.slack.connectCta': 'Open integrations',
  'task.contextLink.common.errors.network': 'Network error',
  'slackContext.add': 'Add Slack message',
  'slackContext.error.invalidPermalink': 'invalid permalink',
  'slackContext.error.notConnected': 'not connected',
  'slackContext.error.wrongTeam': 'wrong team',
  'slackContext.error.notInChannel': 'not in channel',
  'slackContext.error.messageGone': 'message gone',
  'slackContext.error.missingScope': 'missing scope',
  'slackContext.error.slackUnavailable': 'slack unavailable',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: React.ReactNode
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LinkSlackPopover } from '@/app/workspace/[workspaceUrl]/components/LinkSlackPopover'

function openPopover() {
  const trigger = screen.getByRole('button', { name: 'Add Slack message' })
  fireEvent.click(trigger)
}

describe('LinkSlackPopover', () => {
  it('renders the trigger button', () => {
    render(
      <LinkSlackPopover
        connected
        integrationsHref='/workspace/x/settings/integrations'
        onAttach={jest.fn()}
      />
    )
    expect(
      screen.getByRole('button', { name: 'Add Slack message' })
    ).toBeInTheDocument()
  })

  it('submits permalink via Enter when Slack is connected', async () => {
    const onAttach = jest.fn().mockResolvedValue(undefined)
    render(
      <LinkSlackPopover
        connected
        integrationsHref='/workspace/x/settings/integrations'
        onAttach={onAttach}
      />
    )
    openPopover()

    const input = await screen.findByPlaceholderText(
      'https://your-team.slack.com/archives/…/p…'
    )
    await userEvent.type(
      input,
      'https://example.slack.com/archives/C1/p1700000000{Enter}'
    )

    await waitFor(() => {
      expect(onAttach).toHaveBeenCalledWith(
        'https://example.slack.com/archives/C1/p1700000000'
      )
    })
  })

  it('shows connect CTA when Slack is not connected', async () => {
    const onAttach = jest.fn()
    render(
      <LinkSlackPopover
        connected={false}
        integrationsHref='/workspace/x/settings/integrations'
        onAttach={onAttach}
      />
    )
    openPopover()

    const link = await screen.findByRole('link', { name: 'Open integrations' })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/workspace/x/settings/integrations')
    expect(onAttach).not.toHaveBeenCalled()
    expect(
      screen.queryByPlaceholderText('https://your-team.slack.com/archives/…/p…')
    ).not.toBeInTheDocument()
  })

  it('renders error when onAttach rejects with a known code', async () => {
    const onAttach = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('not_in_channel'), { status: 403 })
      )
    render(
      <LinkSlackPopover
        connected
        integrationsHref='/workspace/x/settings/integrations'
        onAttach={onAttach}
      />
    )
    openPopover()

    const input = await screen.findByPlaceholderText(
      'https://your-team.slack.com/archives/…/p…'
    )
    await userEvent.type(input, 'https://x.slack.com/archives/C1/p1{Enter}')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('not in channel')
  })

  it('falls back to network error message when error is unknown', async () => {
    const onAttach = jest.fn().mockRejectedValue({})
    render(
      <LinkSlackPopover
        connected
        integrationsHref='/workspace/x/settings/integrations'
        onAttach={onAttach}
      />
    )
    openPopover()

    const input = await screen.findByPlaceholderText(
      'https://your-team.slack.com/archives/…/p…'
    )
    await userEvent.type(input, 'https://x.slack.com/archives/C1/p1{Enter}')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Network error')
  })
})
