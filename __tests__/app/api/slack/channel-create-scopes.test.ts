/**
 * @jest-environment node
 *
 * LUM-1080 — the install link asks for the scopes conversations.create needs,
 * and a token that predates them yields a "reconnect Slack" error code (not a
 * bare failure) from the service through the create-channel route.
 */
process.env.SLACK_CLIENT_ID = 'cid'
process.env.SLACK_CLIENT_SECRET = 'placeholder'
process.env.SLACK_SIGNING_SECRET = 'placeholder'
process.env.NEXT_PUBLIC_APP_URL = 'https://lumo.test'
if (!process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = '0'.repeat(64)

jest.mock('@/lib/auth')
jest.mock('@/lib/repositories/slack.repository', () => ({
  slackRepository: { findIntegrationWithToken: jest.fn() },
}))

import { NextRequest } from 'next/server'
import * as auth from '@/lib/auth'
import { encrypt } from '@/lib/crypto'
import { slackRepository } from '@/lib/repositories/slack.repository'
import { slackService } from '@/lib/services/slack.service'
import { SLACK_RECONNECT_REQUIRED } from '@/lib/integrations/slack/types'
import { GET as oauthGET } from '@/app/api/slack/oauth/route'
import { POST as createChannelPOST } from '@/app/api/slack/create-channel/route'

const fetchMock = jest.fn()

beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch
})

beforeEach(() => {
  jest.resetAllMocks()
  ;(auth.requireAuth as jest.Mock).mockResolvedValue({ userId: 'clerk_1' })
  ;(auth.getUserWorkspace as jest.Mock).mockResolvedValue({
    workspaceId: 'w1',
    member: { id: 'm1' },
    workspace: { slug: 'lumo' },
  })
  ;(slackRepository.findIntegrationWithToken as jest.Mock).mockResolvedValue({
    accessToken: encrypt('xoxb-test'),
  })
})

describe('Slack install link scopes', () => {
  it('requests channels:manage and groups:write alongside the existing scopes', async () => {
    const res = await oauthGET(
      new NextRequest('https://lumo.test/api/slack/oauth?workspaceUrl=lumo')
    )
    expect(res.status).toBe(307)
    const url = new URL(res.headers.get('location')!)
    expect(url.origin + url.pathname).toBe(
      'https://slack.com/oauth/v2/authorize'
    )
    const scopes = url.searchParams.get('scope')!.split(',')
    expect(scopes).toEqual(
      expect.arrayContaining([
        'channels:manage',
        'groups:write',
        'commands',
        'chat:write',
        'app_mentions:read',
      ])
    )
  })
})

describe('creating a channel with a token missing the scope', () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'missing_scope' }))
    )
  })

  it('service throws 422 with the reconnect code', async () => {
    await expect(
      slackService.createChannelWithInvite('w1', 'proj', false, 'clerk_1')
    ).rejects.toMatchObject({
      status: 422,
      slackError: 'missing_scope',
      code: SLACK_RECONNECT_REQUIRED,
      message: expect.stringMatching(/reconnect slack/i),
    })
  })

  it('route returns the code so the UI can offer Reconnect Slack', async () => {
    const res = await createChannelPOST(
      new NextRequest(
        'https://lumo.test/api/slack/create-channel?workspaceUrl=lumo',
        { method: 'POST', body: JSON.stringify({ name: 'proj' }) }
      )
    )
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({
      error: expect.stringMatching(/reconnect slack/i),
      slackError: 'missing_scope',
      code: SLACK_RECONNECT_REQUIRED,
    })
  })

  it('other Slack errors carry no reconnect code', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'name_taken' }))
    )
    const res = await createChannelPOST(
      new NextRequest(
        'https://lumo.test/api/slack/create-channel?workspaceUrl=lumo',
        { method: 'POST', body: JSON.stringify({ name: 'proj' }) }
      )
    )
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.slackError).toBe('name_taken')
    expect(body.code).toBeUndefined()
  })
})
