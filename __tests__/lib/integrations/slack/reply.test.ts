/**
 * @jest-environment node
 *
 * LUM-1096 — how a command reply is posted back to Slack.
 */
import { logger } from '@/lib/logger'
import {
  sendMentionReply,
  sendSlashCommandReply,
  commandMessage,
  mentionReplyRequest,
  slashCommandReplyBody,
} from '@/lib/integrations/slack/reply'

const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: 'x' } }]

describe('slashCommandReplyBody', () => {
  it('maps visibility to response_type and keeps the text fallback', () => {
    expect(
      slashCommandReplyBody({
        type: 'blocks',
        text: 'ENG-1 · Fix',
        blocks,
        visibility: 'ephemeral',
      })
    ).toEqual({ text: 'ENG-1 · Fix', blocks, response_type: 'ephemeral' })
    expect(
      slashCommandReplyBody({
        type: 'text',
        text: 'ok',
        visibility: 'in_channel',
      }).response_type
    ).toBe('in_channel')
  })

  it('never sends an empty text', () => {
    expect(
      commandMessage({ type: 'text', text: ' ', visibility: 'ephemeral' }).text
    ).not.toBe('')
  })
})

describe('mentionReplyRequest', () => {
  const ctx = { channel: 'C1', user: 'U1', threadTs: '1.2' }

  it('in_channel → chat.postMessage in the thread', () => {
    expect(
      mentionReplyRequest(
        { type: 'blocks', text: 't', blocks, visibility: 'in_channel' },
        ctx
      )
    ).toEqual({
      url: 'https://slack.com/api/chat.postMessage',
      body: { channel: 'C1', thread_ts: '1.2', text: 't', blocks },
    })
  })

  it('ephemeral → chat.postEphemeral to the mentioning user, in the thread', () => {
    expect(
      mentionReplyRequest(
        { type: 'text', text: 'e', visibility: 'ephemeral' },
        ctx
      )
    ).toEqual({
      url: 'https://slack.com/api/chat.postEphemeral',
      body: { channel: 'C1', user: 'U1', thread_ts: '1.2', text: 'e' },
    })
  })

  // LUM-1115: a private reply is never turned into a public one.
  it('ephemeral without a known user has no request (never a thread reply)', () => {
    expect(
      mentionReplyRequest(
        { type: 'text', text: 'e', visibility: 'ephemeral' },
        { channel: 'C1', user: '', threadTs: '1.2' }
      )
    ).toBeNull()
  })

  it('omits thread_ts when there is no thread', () => {
    const req = mentionReplyRequest(
      { type: 'text', text: 'ok', visibility: 'in_channel' },
      { channel: 'C1', user: 'U1' }
    )
    expect(req?.body).toEqual({ channel: 'C1', text: 'ok' })
  })
})

describe('sendSlashCommandReply', () => {
  it('logs (does not throw) when the response_url rejects the reply', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {})
    global.fetch = jest.fn(
      async () => new Response('expired_url', { status: 404 })
    ) as unknown as typeof fetch
    await sendSlashCommandReply('https://hooks.slack.com/commands/x', {
      type: 'text',
      text: 'ok',
      visibility: 'ephemeral',
    })
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('response_url rejected'),
      { status: 404 }
    )
    warn.mockRestore()
  })
})

describe('send* never throw and never report a failed send as success', () => {
  const ctx = { channel: 'C1', user: 'U1', threadTs: '1.2' }
  let warn: jest.SpyInstance
  let error: jest.SpyInstance
  beforeEach(() => {
    warn = jest.spyOn(logger, 'warn').mockImplementation(() => {})
    error = jest.spyOn(logger, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    warn.mockRestore()
    error.mockRestore()
  })

  it('a network error on a mention reply is caught and logged', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    await expect(
      sendMentionReply(
        'xoxb',
        { type: 'text', text: 'ok', visibility: 'in_channel' },
        ctx
      )
    ).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('could not reach Slack'),
      expect.objectContaining({ url: 'https://slack.com/api/chat.postMessage' })
    )
  })

  it('a network error on the response_url is caught and logged', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    await expect(
      sendSlashCommandReply('https://hooks.slack.com/commands/x', {
        type: 'text',
        text: 'ok',
        visibility: 'ephemeral',
      })
    ).resolves.toBeUndefined()
    expect(error).toHaveBeenCalled()
  })

  it('chat.postMessage answering ok:false is logged as a failure', async () => {
    global.fetch = jest.fn(
      async () => new Response('{"ok":false,"error":"channel_not_found"}')
    ) as unknown as typeof fetch
    await sendMentionReply(
      'xoxb',
      { type: 'text', text: 'ok', visibility: 'in_channel' },
      ctx
    )
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Slack rejected the reply'),
      expect.objectContaining({ error: 'channel_not_found' })
    )
  })

  // LUM-1115: when Slack refuses the ephemeral reply (user_not_in_channel,
  // rate limit, Slack Connect…), the reply goes to the user's DM — never to
  // the channel thread, where everyone would see a private answer.
  function calledUrls(fetchMock: jest.Mock): string[] {
    return fetchMock.mock.calls.map(c => c[0] as string)
  }
  function bodyOf(fetchMock: jest.Mock, n: number): Record<string, unknown> {
    const init = fetchMock.mock.calls[n]![1] as { body: string }
    return JSON.parse(init.body) as Record<string, unknown>
  }

  it.each([
    [
      'ok:false user_not_in_channel',
      () => new Response('{"ok":false,"error":"user_not_in_channel"}'),
    ],
    ['a non-JSON 5xx', () => new Response('upstream error', { status: 502 })],
  ])(
    'postEphemeral failing with %s → DM to the user, no in_channel reply',
    async (_label, failure) => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(failure())
        .mockResolvedValueOnce(
          new Response('{"ok":true,"channel":{"id":"D42"}}')
        )
        .mockResolvedValueOnce(new Response('{"ok":true}'))
      global.fetch = fetchMock as unknown as typeof fetch
      await sendMentionReply(
        'xoxb',
        { type: 'text', text: 'only for you', visibility: 'ephemeral' },
        ctx
      )
      expect(calledUrls(fetchMock)).toEqual([
        'https://slack.com/api/chat.postEphemeral',
        'https://slack.com/api/conversations.open',
        'https://slack.com/api/chat.postMessage',
      ])
      expect(bodyOf(fetchMock, 1)).toEqual({ users: 'U1' })
      // Posted into the DM channel, not the mention's channel or thread.
      expect(bodyOf(fetchMock, 2)).toEqual({
        channel: 'D42',
        text: 'only for you',
      })
    }
  )

  it('DM cannot be opened → only logged, nothing posted to the channel', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        new Response('{"ok":false,"error":"user_not_in_channel"}')
      )
      .mockResolvedValueOnce(
        new Response('{"ok":false,"error":"missing_scope"}')
      )
    global.fetch = fetchMock as unknown as typeof fetch
    await sendMentionReply(
      'xoxb',
      { type: 'text', text: 'only for you', visibility: 'ephemeral' },
      ctx
    )
    expect(calledUrls(fetchMock)).toEqual([
      'https://slack.com/api/chat.postEphemeral',
      'https://slack.com/api/conversations.open',
    ])
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('private reply not delivered'),
      expect.objectContaining({ channel: 'C1' })
    )
  })

  it('an ephemeral reply without a user sends nothing', async () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    await sendMentionReply(
      'xoxb',
      { type: 'text', text: 'only for you', visibility: 'ephemeral' },
      { channel: 'C1', user: '', threadTs: '1.2' }
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
  })

  it('a delivered ephemeral reply makes exactly one call', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response('{"ok":true}'))
    global.fetch = fetchMock as unknown as typeof fetch
    await sendMentionReply(
      'xoxb',
      { type: 'text', text: 'e', visibility: 'ephemeral' },
      ctx
    )
    expect(calledUrls(fetchMock)).toEqual([
      'https://slack.com/api/chat.postEphemeral',
    ])
  })
})
