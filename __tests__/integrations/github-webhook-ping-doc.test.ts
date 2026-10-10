/**
 * @jest-environment node
 */
/**
 * LUM-1078 — docs/self-hosting/integrations.md tells operators to check the
 * App webhook with a signed `ping`: 200 when GITHUB_APP_WEBHOOK_SECRET
 * matches, 401 when it does not. Hold the route to that contract.
 */
import { createHmac } from 'crypto'
import { NextRequest } from 'next/server'

jest.mock('@/lib/services/github.service', () => ({
  githubService: { findWebhooksByRepo: jest.fn(async () => []) },
}))
jest.mock('@/lib/services/github-app-install.service', () => ({
  githubAppInstallService: {
    resolveWorkspacesForRepository: jest.fn(async () => []),
  },
}))
jest.mock('@/lib/services/github-access-recheck.service', () => ({
  githubAccessRecheckService: {},
}))
// The real HMAC check, without the App-auth module the package index loads.
jest.mock('@/lib/integrations/github', () => ({
  verifyGitHubSignature: jest.requireActual('@/lib/integrations/github/verify')
    .verifyGitHubSignature,
}))
jest.mock('@/app/api/webhooks/github/handlers', () => ({}))

import { POST } from '@/app/api/webhooks/github/route'

const SECRET = 'placeholder-webhook-secret'
const BODY = '{"zen":"test","hook_id":1}'

function ping(signature: string) {
  return new NextRequest('http://localhost/api/webhooks/github', {
    method: 'POST',
    body: BODY,
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'ping',
      'x-hub-signature-256': signature,
    },
  })
}

describe('GitHub App webhook ping (integrations.md verification step)', () => {
  const prev = process.env.GITHUB_APP_WEBHOOK_SECRET
  beforeEach(() => {
    process.env.GITHUB_APP_WEBHOOK_SECRET = SECRET
  })
  afterAll(() => {
    process.env.GITHUB_APP_WEBHOOK_SECRET = prev
  })

  it('answers 200 to a ping signed with the App webhook secret', async () => {
    const sig = `sha256=${createHmac('sha256', SECRET).update(BODY).digest('hex')}`
    const res = await POST(ping(sig))
    expect(res.status).toBe(200)
  })

  it('answers 401 when the secret does not match', async () => {
    const sig = `sha256=${createHmac('sha256', 'another-secret').update(BODY).digest('hex')}`
    const res = await POST(ping(sig))
    expect(res.status).toBe(401)
  })
})
