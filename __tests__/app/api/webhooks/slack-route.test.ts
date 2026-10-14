/**
 * @jest-environment node
 *
 * LUM-1080 — /api/webhooks/slack: slash commands arrive form-encoded, events
 * as JSON. The signature is checked on the raw body before any parsing, for
 * both shapes.
 */
import { createHmac } from 'crypto'

const SECRET = 'test-signing-secret'
process.env.SLACK_CLIENT_ID = 'placeholder'
process.env.SLACK_CLIENT_SECRET = 'placeholder'
process.env.SLACK_SIGNING_SECRET = SECRET
if (!process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = '0'.repeat(64)

const mockFindIntegrationByTeamId = jest.fn()
jest.mock('@/lib/repositories/slack.repository', () => ({
  slackRepository: {
    findIntegrationByTeamId: (...a: unknown[]) =>
      mockFindIntegrationByTeamId(...a),
  },
}))
jest.mock('@/lib/crypto', () => ({ decrypt: () => 'xoxb-test' }))
const mockHandleCommand = jest.fn()
jest.mock('@/lib/integrations/slack', () => ({
  handleCommand: (...a: unknown[]) => mockHandleCommand(...a),
}))
const pending: Promise<unknown>[] = []
jest.mock('@/lib/runtime/wait-until', () => ({
  waitUntil: (p: Promise<unknown>) => {
    pending.push(p)
  },
}))

import { NextRequest } from 'next/server'
import { POST } from '@/app/api/webhooks/slack/route'

const fetchMock = jest.fn()

beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch
})

beforeEach(() => {
  jest.clearAllMocks()
  pending.length = 0
  mockFindIntegrationByTeamId.mockResolvedValue({
    workspaceId: 'w1',
    accessToken: 'enc',
  })
  mockHandleCommand.mockResolvedValue({
    type: 'text',
    text: 'ok',
    visibility: 'in_channel',
  })
  fetchMock.mockResolvedValue(new Response('{}'))
})

function signed(
  body: string,
  contentType: string,
  opts: { secret?: string; ts?: number } = {}
) {
  const ts = opts.ts ?? Math.floor(Date.now() / 1000)
  const sig =
    'v0=' +
    createHmac('sha256', opts.secret ?? SECRET)
      .update(`v0:${ts}:${body}`)
      .digest('hex')
  return new NextRequest('https://lumo.test/api/webhooks/slack', {
    method: 'POST',
    body,
    headers: {
      'content-type': contentType,
      'x-slack-request-timestamp': String(ts),
      'x-slack-signature': sig,
    },
  })
}

const FORM = 'application/x-www-form-urlencoded'
const slashBody = new URLSearchParams({
  token: 'legacy',
  team_id: 'T1',
  channel_id: 'C1',
  user_id: 'U1',
  command: '/lumo',
  text: 'status LUM-12',
  response_url: 'https://hooks.slack.com/commands/T1/1/abc',
}).toString()

describe('POST /api/webhooks/slack', () => {
  it('runs a form-encoded slash command and replies to response_url', async () => {
    const res = await POST(signed(slashBody, FORM))
    expect(res.status).toBe(200)
    await Promise.all(pending)

    expect(mockFindIntegrationByTeamId).toHaveBeenCalledWith('T1')
    expect(mockHandleCommand).toHaveBeenCalledWith(
      'status LUM-12',
      'U1',
      'xoxb-test',
      'w1'
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://hooks.slack.com/commands/T1/1/abc',
      expect.objectContaining({ method: 'POST' })
    )
    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body)
    expect(sent).toEqual({ text: 'ok', response_type: 'in_channel' })
  })

  it('rejects a slash command with a bad signature (401) without handling it', async () => {
    const res = await POST(signed(slashBody, FORM, { secret: 'wrong' }))
    expect(res.status).toBe(401)
    expect(mockFindIntegrationByTeamId).not.toHaveBeenCalled()
    expect(mockHandleCommand).not.toHaveBeenCalled()
  })

  it('rejects a slash command whose body was altered after signing (401)', async () => {
    const req = signed(slashBody, FORM)
    const tampered = new NextRequest(req.url, {
      method: 'POST',
      body: slashBody.replace('LUM-12', 'LUM-13'),
      headers: req.headers,
    })
    const res = await POST(tampered)
    expect(res.status).toBe(401)
    expect(mockHandleCommand).not.toHaveBeenCalled()
  })

  it('does not run or reply to a slash command whose response_url is not Slack', async () => {
    const body = slashBody.replace(
      encodeURIComponent('https://hooks.slack.com/commands/T1/1/abc'),
      encodeURIComponent('https://169.254.169.254/latest')
    )
    const res = await POST(signed(body, FORM))
    expect(res.status).toBe(200)
    await Promise.all(pending)
    expect(mockHandleCommand).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a replayed (stale) request (401)', async () => {
    const res = await POST(
      signed(slashBody, FORM, { ts: Math.floor(Date.now() / 1000) - 600 })
    )
    expect(res.status).toBe(401)
    expect(mockHandleCommand).not.toHaveBeenCalled()
  })

  it('answers url_verification with the challenge', async () => {
    const res = await POST(
      signed(
        JSON.stringify({ type: 'url_verification', challenge: 'abc123' }),
        'application/json'
      )
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ challenge: 'abc123' })
  })

  it('still handles a JSON app_mention event and replies in channel', async () => {
    const body = JSON.stringify({
      type: 'event_callback',
      team_id: 'T1',
      event: {
        type: 'app_mention',
        text: '<@B1> status LUM-12',
        channel: 'C9',
        user: 'U2',
      },
    })
    const res = await POST(signed(body, 'application/json'))
    expect(res.status).toBe(200)
    await Promise.all(pending)
    expect(mockHandleCommand).toHaveBeenCalledWith(
      'status LUM-12',
      'U2',
      'xoxb-test',
      'w1'
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://slack.com/api/chat.postMessage',
      expect.anything()
    )
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      channel: 'C9',
      text: 'ok',
    })
  })

  // LUM-1094: a blocks reply must also carry the top-level text fallback, on
  // both send paths (response_url and chat.postMessage).
  const blocksResult = {
    type: 'blocks',
    visibility: 'in_channel',
    text: 'LUM-12 · Fix login',
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'x' } }],
  }

  it('sends text alongside blocks to the response_url', async () => {
    mockHandleCommand.mockResolvedValue(blocksResult)
    await POST(signed(slashBody, FORM))
    await Promise.all(pending)
    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body)
    expect(sent).toEqual({
      text: 'LUM-12 · Fix login',
      blocks: blocksResult.blocks,
      response_type: 'in_channel',
    })
  })

  it('sends text alongside blocks via chat.postMessage for a mention', async () => {
    mockHandleCommand.mockResolvedValue(blocksResult)
    const body = JSON.stringify({
      type: 'event_callback',
      team_id: 'T1',
      event: {
        type: 'app_mention',
        text: '<@B1> status LUM-12',
        channel: 'C9',
      },
    })
    await POST(signed(body, 'application/json'))
    await Promise.all(pending)
    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body)
    expect(sent).toEqual({
      channel: 'C9',
      text: 'LUM-12 · Fix login',
      blocks: blocksResult.blocks,
    })
  })

  it('never posts an empty text even if a reply comes back blank', async () => {
    mockHandleCommand.mockResolvedValue({
      type: 'text',
      text: '',
      visibility: 'ephemeral',
    })
    await POST(signed(slashBody, FORM))
    await Promise.all(pending)
    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body)
    expect(typeof sent.text).toBe('string')
    expect(sent.text.trim()).not.toBe('')
  })

  // LUM-1096: visibility comes from the reply; mentions answer in a thread.
  describe('reply visibility and threading (LUM-1096)', () => {
    function mention(event: Record<string, unknown>) {
      return signed(
        JSON.stringify({
          type: 'event_callback',
          team_id: 'T1',
          event: {
            type: 'app_mention',
            text: '<@B1> status LUM-12',
            channel: 'C9',
            user: 'U2',
            ...event,
          },
        }),
        'application/json'
      )
    }

    it('sends an ephemeral reply to the response_url as response_type ephemeral', async () => {
      mockHandleCommand.mockResolvedValue({
        type: 'text',
        text: 'Task `X` not found.',
        visibility: 'ephemeral',
      })
      await POST(signed(slashBody, FORM))
      await Promise.all(pending)
      const sent = JSON.parse(fetchMock.mock.calls[0]![1].body)
      expect(sent).toEqual({
        text: 'Task `X` not found.',
        response_type: 'ephemeral',
      })
    })

    it('keeps an in_channel reply in_channel on the response_url', async () => {
      await POST(signed(slashBody, FORM))
      await Promise.all(pending)
      const sent = JSON.parse(fetchMock.mock.calls[0]![1].body)
      expect(sent.response_type).toBe('in_channel')
    })

    it('answers a mention in a thread under the mention (thread_ts = ts)', async () => {
      await POST(mention({ ts: '1700000000.000100' }))
      await Promise.all(pending)
      expect(fetchMock.mock.calls[0]![0]).toBe(
        'https://slack.com/api/chat.postMessage'
      )
      expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
        channel: 'C9',
        thread_ts: '1700000000.000100',
        text: 'ok',
      })
    })

    it('answers a mention made inside a thread in that same thread', async () => {
      await POST(
        mention({ ts: '1700000000.000200', thread_ts: '1700000000.000001' })
      )
      await Promise.all(pending)
      const sent = JSON.parse(fetchMock.mock.calls[0]![1].body)
      expect(sent.thread_ts).toBe('1700000000.000001')
    })

    it('sends an ephemeral mention reply via chat.postEphemeral to the mentioning user, in the thread', async () => {
      mockHandleCommand.mockResolvedValue({
        type: 'text',
        text: 'Something went wrong. Please try again.',
        visibility: 'ephemeral',
      })
      fetchMock.mockResolvedValue(new Response('{"ok":true}'))
      await POST(mention({ ts: '1700000000.000100' }))
      await Promise.all(pending)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0]![0]).toBe(
        'https://slack.com/api/chat.postEphemeral'
      )
      expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe(
        'Bearer xoxb-test'
      )
      expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
        channel: 'C9',
        user: 'U2',
        thread_ts: '1700000000.000100',
        text: 'Something went wrong. Please try again.',
      })
    })

    // LUM-1115: a refused private reply goes to the user's DM — never to
    // the channel thread where everyone would see it.
    it('sends a refused ephemeral reply to the user DM, never in_channel', async () => {
      mockHandleCommand.mockResolvedValue({
        type: 'text',
        text: 'Task `X` not found.',
        visibility: 'ephemeral',
      })
      fetchMock
        .mockResolvedValueOnce(
          new Response('{"ok":false,"error":"user_not_in_channel"}')
        )
        .mockResolvedValueOnce(
          new Response('{"ok":true,"channel":{"id":"D7"}}')
        )
        .mockResolvedValueOnce(new Response('{"ok":true}'))
      await POST(mention({ ts: '1700000000.000100' }))
      await Promise.all(pending)
      expect(fetchMock.mock.calls.map(c => c[0])).toEqual([
        'https://slack.com/api/chat.postEphemeral',
        'https://slack.com/api/conversations.open',
        'https://slack.com/api/chat.postMessage',
      ])
      expect(JSON.parse(fetchMock.mock.calls[2]![1].body)).toEqual({
        channel: 'D7',
        text: 'Task `X` not found.',
      })
      // No call ever targets the mention's channel except the ephemeral one.
      const bodies = fetchMock.mock.calls.map(c => JSON.parse(c[1].body))
      expect(
        bodies.filter(b => b.channel === 'C9' && b.user === undefined)
      ).toEqual([])
    })
  })

  // LUM-1115: Slack re-delivers an event (X-Slack-Retry-Num) when the first
  // delivery was not acknowledged within 3 s. That first delivery is still
  // running the command, so a retry is acknowledged and dropped — otherwise
  // `@Lumo create` could create the task twice.
  describe('Slack retries', () => {
    const createMention = JSON.stringify({
      type: 'event_callback',
      team_id: 'T1',
      event_id: 'Ev1',
      event: {
        type: 'app_mention',
        text: '<@B1> create LUM Fix login',
        channel: 'C9',
        user: 'U2',
        ts: '1.1',
      },
    })

    it.each(['1', '2', '3'])(
      'acknowledges retry #%s with 200 without running the command',
      async n => {
        const req = signed(createMention, 'application/json')
        req.headers.set('x-slack-retry-num', n)
        req.headers.set('x-slack-retry-reason', 'http_timeout')
        const res = await POST(req)
        expect(res.status).toBe(200)
        expect(res.headers.get('x-slack-no-retry')).toBe('1')
        await Promise.all(pending)
        expect(mockHandleCommand).not.toHaveBeenCalled()
        expect(mockFindIntegrationByTeamId).not.toHaveBeenCalled()
        expect(fetchMock).not.toHaveBeenCalled()
      }
    )

    it.each(['', 'http_error', 'unknown_error'])(
      'also drops a retry whose reason is %j (first delivery may have run)',
      async reason => {
        const req = signed(createMention, 'application/json')
        req.headers.set('x-slack-retry-num', '1')
        if (reason) req.headers.set('x-slack-retry-reason', reason)
        const res = await POST(req)
        expect(res.status).toBe(200)
        await Promise.all(pending)
        expect(mockHandleCommand).not.toHaveBeenCalled()
      }
    )

    it.each(['connection_failed', 'ssl_error', 'too_many_redirects'])(
      'processes a retry whose first delivery never arrived (%s)',
      async reason => {
        const req = signed(createMention, 'application/json')
        req.headers.set('x-slack-retry-num', '1')
        req.headers.set('x-slack-retry-reason', reason)
        const res = await POST(req)
        expect(res.status).toBe(200)
        await Promise.all(pending)
        expect(mockHandleCommand).toHaveBeenCalledTimes(1)
      }
    )

    it('runs the first delivery exactly once', async () => {
      const res = await POST(signed(createMention, 'application/json'))
      expect(res.status).toBe(200)
      await Promise.all(pending)
      expect(mockHandleCommand).toHaveBeenCalledTimes(1)
    })

    it('still rejects an unsigned retry (401)', async () => {
      const req = signed(createMention, 'application/json', {
        secret: 'wrong',
      })
      req.headers.set('x-slack-retry-num', '1')
      const res = await POST(req)
      expect(res.status).toBe(401)
    })
  })

  // LUM-1096: a failure while running or replying must never surface as an
  // unhandled rejection / non-200 — Slack would retry and re-run the command.
  it('answers 200 and swallows (logs) a failure inside the command run', async () => {
    mockHandleCommand.mockRejectedValue(new Error('boom'))
    const res = await POST(signed(slashBody, FORM))
    expect(res.status).toBe(200)
    await expect(Promise.all(pending)).resolves.toBeDefined()
  })

  it('answers 200 and does not reject when replying to Slack throws', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    const res = await POST(signed(slashBody, FORM))
    expect(res.status).toBe(200)
    await expect(Promise.all(pending)).resolves.toBeDefined()
    expect(mockHandleCommand).toHaveBeenCalledTimes(1)
  })

  it('rejects a JSON event with a bad signature (401)', async () => {
    const res = await POST(
      signed(
        JSON.stringify({ type: 'url_verification', challenge: 'x' }),
        'application/json',
        {
          secret: 'wrong',
        }
      )
    )
    expect(res.status).toBe(401)
  })

  it('acknowledges an interactive payload= request without running a command', async () => {
    const body = new URLSearchParams({
      payload: JSON.stringify({ type: 'block_actions', team: { id: 'T1' } }),
    }).toString()
    const res = await POST(signed(body, FORM))
    expect(res.status).toBe(200)
    expect(mockHandleCommand).not.toHaveBeenCalled()
  })

  it('acknowledges (200) a signed body that does not parse, without handling it', async () => {
    const res = await POST(signed('not json', 'application/json'))
    expect(res.status).toBe(200)
    expect(mockFindIntegrationByTeamId).not.toHaveBeenCalled()
    expect(mockHandleCommand).not.toHaveBeenCalled()
  })
})
