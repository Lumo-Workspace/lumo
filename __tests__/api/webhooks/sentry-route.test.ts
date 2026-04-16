/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/services/sentry.service', () => ({
  sentryService: { handleWebhook: jest.fn() },
}))

import { POST } from '@/app/api/webhooks/sentry/route'
import { sentryService } from '@/lib/services/sentry.service'

function makeRequest(body: string, signature?: string): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (signature) headers['sentry-hook-signature'] = signature
  return new NextRequest('http://x/api/webhooks/sentry', {
    method: 'POST',
    body,
    headers,
  })
}

describe('POST /api/webhooks/sentry', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 401 when service throws 401', async () => {
    ;(sentryService.handleWebhook as jest.Mock).mockRejectedValue(
      Object.assign(new Error('bad sig'), { status: 401 })
    )
    const res = await POST(makeRequest('{}', 'deadbeef'))
    expect(res.status).toBe(401)
  })

  it('returns 200 for unmapped project', async () => {
    ;(sentryService.handleWebhook as jest.Mock).mockResolvedValue({
      skipped: 'no_mapping',
    })
    const res = await POST(makeRequest('{}', 'abc'))
    expect(res.status).toBe(200)
  })

  it('returns 200 for created', async () => {
    ;(sentryService.handleWebhook as jest.Mock).mockResolvedValue({
      created: true,
      taskId: 't1',
    })
    const res = await POST(makeRequest('{}', 'abc'))
    expect(res.status).toBe(200)
  })

  it('returns 200 even when service throws a non-auth error', async () => {
    ;(sentryService.handleWebhook as jest.Mock).mockRejectedValue(
      new Error('db blew up')
    )
    const res = await POST(makeRequest('{}', 'abc'))
    expect(res.status).toBe(200)
  })
})
