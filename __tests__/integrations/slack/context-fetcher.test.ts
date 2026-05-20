/** @jest-environment node */
import {
  fetchSingleMessage,
  fetchThread,
  resolveUsers,
  resolveChannelName,
  toSnapshot,
  SlackApiError,
} from '@/lib/integrations/slack/context-fetcher'

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
})

function mockSlackJson(body: object) {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => body,
  })) as unknown as typeof fetch
}

describe('fetchSingleMessage', () => {
  it('calls conversations.history with the right params', async () => {
    const fetchSpy = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [
          {
            ts: '1.000100',
            user: 'U1',
            text: 'hi',
            edited: { ts: '1.000200' },
          },
        ],
      }),
    })) as unknown as typeof fetch
    global.fetch = fetchSpy

    const msg = await fetchSingleMessage('tok', 'C9', '1.000100')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = (fetchSpy as jest.Mock).mock.calls[0]
    expect(url).toBe('https://slack.com/api/conversations.history')
    expect((init as RequestInit).method).toBe('POST')
    expect(
      (init as { headers: Record<string, string> }).headers.Authorization
    ).toBe('Bearer tok')
    expect(JSON.parse((init as { body: string }).body)).toEqual({
      channel: 'C9',
      latest: '1.000100',
      inclusive: true,
      limit: 1,
    })
    expect(msg).toMatchObject({
      ts: '1.000100',
      user: 'U1',
      edited: { ts: '1.000200' },
    })
  })

  it('throws SlackApiError when ok=false', async () => {
    mockSlackJson({ ok: false, error: 'not_in_channel' })
    await expect(fetchSingleMessage('tok', 'C9', '1.000100')).rejects.toThrow(
      SlackApiError
    )
  })

  it('throws message_not_found when history returns empty', async () => {
    mockSlackJson({ ok: true, messages: [] })
    await expect(
      fetchSingleMessage('tok', 'C9', '1.000100')
    ).rejects.toMatchObject({ code: 'message_not_found' })
  })
})

describe('fetchThread', () => {
  it('paginates via response_metadata.next_cursor', async () => {
    const calls: RequestInit[] = []
    global.fetch = jest.fn(async (_url, init) => {
      calls.push(init as RequestInit)
      const isFirst = calls.length === 1
      return {
        ok: true,
        json: async () =>
          isFirst
            ? {
                ok: true,
                messages: [{ ts: '1.000100', user: 'U1', text: 'root' }],
                response_metadata: { next_cursor: 'CUR' },
                has_more: true,
              }
            : {
                ok: true,
                messages: [{ ts: '1.000200', user: 'U2', text: 'reply' }],
                has_more: false,
              },
      }
    }) as unknown as typeof fetch

    const msgs = await fetchThread('tok', 'C9', '1.000100')
    expect(msgs.map(m => m.ts)).toEqual(['1.000100', '1.000200'])
    expect(JSON.parse(calls[1]!.body as string)).toMatchObject({
      cursor: 'CUR',
    })
  })
})

describe('resolveUsers', () => {
  it('dedupes ids and fetches each only once', async () => {
    const fetchSpy = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        user: {
          id: 'U1',
          profile: { display_name: 'alice', image_72: 'a.png' },
        },
      }),
    })) as unknown as typeof fetch
    global.fetch = fetchSpy

    const out = await resolveUsers('tok', ['U1', 'U1', 'U2', 'U2'])
    // 1 fetch per unique id
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(out.get('U1')).toEqual({ name: 'alice', avatarUrl: 'a.png' })
  })

  it('returns null name when users.info fails', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ ok: false, error: 'user_not_found' }),
    })) as unknown as typeof fetch

    const out = await resolveUsers('tok', ['U1'])
    expect(out.get('U1')).toEqual({ name: null, avatarUrl: null })
  })
})

describe('resolveChannelName', () => {
  it('returns the channel name on success', async () => {
    mockSlackJson({ ok: true, channel: { name: 'design' } })
    expect(await resolveChannelName('tok', 'C9')).toBe('design')
  })

  it('returns null on failure (e.g. private)', async () => {
    mockSlackJson({ ok: false, error: 'channel_not_found' })
    expect(await resolveChannelName('tok', 'C9')).toBeNull()
  })
})

describe('toSnapshot', () => {
  it('joins raw messages with resolved users', () => {
    const raw = [
      { ts: '1.000100', user: 'U1', text: 'hi', edited: undefined },
      { ts: '1.000200', user: 'U2', text: 'yo', edited: { ts: '...' } },
    ]
    const users = new Map([
      ['U1', { name: 'alice', avatarUrl: 'a.png' }],
      ['U2', { name: null, avatarUrl: null }],
    ])
    expect(toSnapshot(raw, users)).toEqual({
      messages: [
        {
          ts: '1.000100',
          userId: 'U1',
          userName: 'alice',
          userAvatarUrl: 'a.png',
          text: 'hi',
          edited: false,
        },
        {
          ts: '1.000200',
          userId: 'U2',
          userName: null,
          userAvatarUrl: null,
          text: 'yo',
          edited: true,
        },
      ],
    })
  })
})
