/**
 * LUM-1265 — the "Channel" label always points at a control that exists:
 * the channel select (also when the channel list is empty), or the new
 * channel name input while creating one. While loading there is no label.
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => id,
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

import { fireEvent, render, screen } from '@testing-library/react'
import { ProjectSlackDialog } from '@/app/workspace/[workspaceUrl]/components/ProjectSlackDialog'

const saved = {
  id: 's1',
  channelId: 'C9',
  channelName: 'old-channel',
  events: ['task_created'],
}

function setup(
  channel: typeof saved | null,
  channels: { id: string; name: string; private: boolean }[]
) {
  mockApiFetch.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/slack/channels')) return { channel }
    if (url.startsWith('/api/slack/available-channels')) return { channels }
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

beforeEach(() => jest.clearAllMocks())

it('renders no Channel label while loading', () => {
  mockApiFetch.mockImplementation(() => new Promise(() => {}))
  render(
    <ProjectSlackDialog
      isOpen
      onClose={jest.fn()}
      projectId='p1'
      projectName='Proj'
      workspaceUrl='lumo'
    />
  )
  expect(screen.queryByText('Channel')).toBeNull()
})

it('labels the channel select when channels are listed', async () => {
  setup(null, [{ id: 'C1', name: 'general', private: false }])
  await screen.findByText('Channel')
  expect(screen.getByLabelText('Channel')).toHaveAttribute('role', 'combobox')
})

it('labels the channel select when the channel list is empty', async () => {
  setup(saved, [])
  await screen.findByText('Channel')
  expect(screen.getByLabelText('Channel')).toHaveAttribute('role', 'combobox')
})

it('labels the new channel name input while creating a channel', async () => {
  setup(null, [{ id: 'C1', name: 'general', private: false }])
  fireEvent.click(await screen.findByText('Create channel'))
  expect(screen.getByLabelText('Channel')).toBe(
    screen.getByPlaceholderText('channel-name')
  )
})

// LUM-1265: a saved channel that the fetched list doesn't contain (archived,
// bot not invited, list paged) still shows on the trigger, marked unavailable.
it('shows a saved channel missing from the list instead of a blank trigger', async () => {
  setup(saved, [{ id: 'C1', name: 'general', private: false }])
  await screen.findByText('Channel')
  const trigger = screen.getByLabelText('Channel')
  expect(trigger).toHaveTextContent('old-channel')
  expect(trigger).toHaveTextContent('slack.channelUnavailable')
})

it('marks nothing unavailable when the saved channel is listed', async () => {
  setup({ ...saved, channelId: 'C1', channelName: 'general' }, [
    { id: 'C1', name: 'general', private: false },
  ])
  await screen.findByText('Channel')
  expect(screen.getByLabelText('Channel')).toHaveTextContent('general')
  expect(screen.queryByText('slack.channelUnavailable')).toBeNull()
})
