/**
 * LUM-1080 — creating a channel with a Slack token that predates the
 * channel-create scopes shows a "Reconnect Slack" action that re-runs the
 * install, instead of a bare failure.
 */
const en: Record<string, string> = {
  'slack.reconnect': 'Reconnect Slack',
  'slack.reconnectToCreateChannel':
    'Slack needs new permissions to create channels. Reconnect Slack to grant them.',
}
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))
jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}))
const mockApiFetch = jest.fn()
jest.mock('@/lib/api-client', () => {
  const actual = jest.requireActual('@/lib/api-client/base')
  return {
    ApiClientError: actual.ApiClientError,
    apiFetch: (...a: unknown[]) => mockApiFetch(...a),
  }
})

import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithQueryClient as render } from '../helpers/query-client'
import { ApiClientError } from '@/lib/api-client/base'
import { SLACK_RECONNECT_REQUIRED } from '@/lib/integrations/slack/types'
import { ProjectSlackDialog } from '@/app/workspace/[workspaceUrl]/components/ProjectSlackDialog'

function setup(createError: unknown) {
  mockApiFetch.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/slack/channels')) return { channel: null }
    if (url.startsWith('/api/slack/available-channels'))
      return { channels: [{ id: 'C1', name: '#general', private: false }] }
    if (url.startsWith('/api/slack/create-channel')) throw createError
    throw new Error(`unexpected ${url}`)
  })
  render(
    <ProjectSlackDialog
      isOpen
      onClose={jest.fn()}
      projectId='p1'
      projectName='Proj'
      workspaceUrl='lumo'
    />
  )
}

async function submitCreate() {
  fireEvent.click(await screen.findByText('Create channel'))
  const input = screen.getByPlaceholderText('channel-name')
  fireEvent.change(input, { target: { value: 'proj' } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('ProjectSlackDialog create channel — missing scope', () => {
  beforeEach(() => jest.clearAllMocks())

  it('offers Reconnect Slack, which opens the install link', async () => {
    const open = jest.spyOn(window, 'open').mockImplementation(() => null)
    setup(
      new ApiClientError('needs permissions', 422, SLACK_RECONNECT_REQUIRED)
    )
    await submitCreate()

    expect(
      await screen.findByText(en['slack.reconnectToCreateChannel']!)
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect Slack' }))
    expect(open).toHaveBeenCalledWith(
      '/api/slack/oauth?workspaceUrl=lumo',
      '_blank'
    )
    open.mockRestore()
  })

  it('shows other errors as-is without a reconnect action', async () => {
    setup(new ApiClientError('A channel named #proj already exists', 422))
    await submitCreate()
    await waitFor(() =>
      expect(
        screen.getByText('A channel named #proj already exists')
      ).toBeInTheDocument()
    )
    expect(
      screen.queryByRole('button', { name: 'Reconnect Slack' })
    ).not.toBeInTheDocument()
  })
})
