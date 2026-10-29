/** LUM-1340 — the dialog's config read, now the queryFn behind its useQuery. */
jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
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

import { ApiClientError } from '@/lib/api-client/base'
import { fetchProjectSlackConfig } from '@/app/workspace/[workspaceUrl]/components/ProjectSlackDialog'

beforeEach(() => jest.clearAllMocks())

describe('fetchProjectSlackConfig', () => {
  it('returns the saved channel and the pickable channels', async () => {
    mockApiFetch.mockImplementation(async (url: string) =>
      url.startsWith('/api/slack/channels')
        ? {
            channel: {
              id: 's1',
              channelId: 'C1',
              channelName: '#a',
              events: [],
            },
          }
        : { channels: [{ id: 'C1', name: '#a', private: false }] }
    )
    const cfg = await fetchProjectSlackConfig('lumo', 'p1')
    expect(cfg.savedChannel?.channelId).toBe('C1')
    expect(cfg.availableChannels).toHaveLength(1)
  })

  it('treats a 404 (Slack not connected) as an empty config', async () => {
    mockApiFetch.mockRejectedValue(new ApiClientError('nope', 404))
    await expect(fetchProjectSlackConfig('lumo', 'p1')).resolves.toEqual({
      savedChannel: null,
      availableChannels: [],
    })
  })

  it('rethrows any other failure', async () => {
    mockApiFetch.mockRejectedValue(new ApiClientError('boom', 500))
    await expect(fetchProjectSlackConfig('lumo', 'p1')).rejects.toThrow('boom')
  })
})
