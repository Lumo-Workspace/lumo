/**
 * @jest-environment node
 *
 * LUM-932 POST /api/sessions/usage-resync: bearer auth → Zod → service.
 */
jest.mock('@/lib/auth/bearer', () => ({ verifyBearer: jest.fn() }))
jest.mock('@/lib/services/usage-resync.service', () => ({
  usageResyncService: { resync: jest.fn() },
}))

import { POST } from '@/app/api/sessions/usage-resync/route'
import { verifyBearer } from '@/lib/auth/bearer'
import { usageResyncService } from '@/lib/services/usage-resync.service'

const bearer = verifyBearer as jest.Mock
const resync = usageResyncService.resync as jest.Mock
const identity = {
  user: { id: 'clerk_1' },
  workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
  apiKey: { id: 'k', name: 'k', prefix: 'lum_k' },
}
const usage = { input: 1, output: 1, cacheRead: 1, cacheCreation: 1 }
const total = {
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 1,
  cacheCreationTokens: 1,
}
const req = (body: unknown) =>
  new Request('http://x/api/sessions/usage-resync', {
    method: 'POST',
    body: JSON.stringify(body),
  })

beforeEach(() => jest.clearAllMocks())

describe('POST /api/sessions/usage-resync', () => {
  it('401s without a valid bearer', async () => {
    bearer.mockResolvedValueOnce(null)
    const res = await POST(req({ dryRun: true, sessions: [] }))
    expect(res.status).toBe(401)
    expect(resync).not.toHaveBeenCalled()
  })

  it('passes a valid body to the service and returns its result', async () => {
    bearer.mockResolvedValueOnce(identity)
    resync.mockResolvedValueOnce({ dryRun: true, results: [] })
    const sessions = [
      {
        sessionId: 's1',
        total,
        byModel: { opus: usage },
        bySubagent: { a1: { total, byModel: { opus: usage } } },
      },
    ]
    const res = await POST(req({ dryRun: true, sessions }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ dryRun: true, results: [] })
    expect(resync).toHaveBeenCalledWith({ identity, dryRun: true, sessions })
  })

  it.each([
    [
      'negative tokens',
      {
        dryRun: true,
        sessions: [
          { sessionId: 's', total: { ...total, inputTokens: -1 }, byModel: {} },
        ],
      },
    ],
    [
      'non-integer tokens',
      {
        dryRun: true,
        sessions: [
          { sessionId: 's', total, byModel: { m: { ...usage, output: 1.5 } } },
        ],
      },
    ],
    [
      'a bad agent id',
      {
        dryRun: true,
        sessions: [
          {
            sessionId: 's',
            total,
            byModel: {},
            bySubagent: { 'a:b': { total, byModel: {} } },
          },
        ],
      },
    ],
    [
      'more than 50 sessions',
      {
        dryRun: true,
        sessions: Array.from({ length: 51 }, (_, i) => ({
          sessionId: `s${i}`,
          total,
          byModel: {},
        })),
      },
    ],
    ['a missing dryRun', { sessions: [] }],
  ])('400s on %s', async (_label, body) => {
    bearer.mockResolvedValueOnce(identity)
    const res = await POST(req(body))
    expect(res.status).toBe(400)
    expect(resync).not.toHaveBeenCalled()
  })

  it('maps a service 403 to 403', async () => {
    bearer.mockResolvedValueOnce(identity)
    resync.mockRejectedValueOnce(
      Object.assign(new Error('Not a workspace member'), { status: 403 })
    )
    const res = await POST(req({ dryRun: false, sessions: [] }))
    expect(res.status).toBe(403)
  })
})
