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
  mockHandleCommand.mockResolvedValue({ type: 'text', text: 'ok' })
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
