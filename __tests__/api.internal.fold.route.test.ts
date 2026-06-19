/**
 * @jest-environment node
 *
 * LUM-555 — POST /api/internal/fold: the dedicated foreground fold worker.
 * Runs the fold pass in its own function with a full time budget (maxDuration
 * 300), in the same foreground context as the working dry-run route — NOT in a
 * cramped post-task waitUntil. Auth-gated by the shared CRON_SECRET (self-call
 * only). One project per request; no DB scan, no fan-out.
 */
jest.mock('@/lib/services/memory/fold.service', () => ({
  foldService: { triggerForProject: jest.fn() },
}))

import { POST } from '@/app/api/internal/fold/route'
import { foldService } from '@/lib/services/memory/fold.service'

const mTrigger = foldService.triggerForProject as jest.Mock

const makeReq = (auth: string | null, body: unknown) =>
  ({
    headers: {
      get: (k: string) => (k.toLowerCase() === 'authorization' ? auth : null),
    },
    json: async () => body,
  }) as never

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CRON_SECRET = 'test-secret'
  mTrigger.mockResolvedValue({ folded: 2, pruned: 0 })
})

describe('POST /api/internal/fold is auth-gated and folds the posted project', () => {
  it('rejects a request without the CRON_SECRET bearer with 401', async () => {
    const res = await POST(makeReq(null, { projectId: 'p1' }))
    expect(res.status).toBe(401)
    expect(mTrigger).not.toHaveBeenCalled()
  })

  it('rejects a wrong bearer with 401', async () => {
    const res = await POST(makeReq('Bearer nope', { projectId: 'p1' }))
    expect(res.status).toBe(401)
    expect(mTrigger).not.toHaveBeenCalled()
  })

  it('invokes triggerForProject for the posted project on a valid bearer', async () => {
    const res = await POST(
      makeReq('Bearer test-secret', {
        projectId: 'p1',
        sourceSessionId: 's1',
      })
    )
    expect(res.status).toBe(200)
    expect(mTrigger).toHaveBeenCalledWith('p1', 's1')
    expect(await res.json()).toEqual({ folded: 2, pruned: 0 })
  })

  it('rejects a missing projectId with 400', async () => {
    const res = await POST(makeReq('Bearer test-secret', {}))
    expect(res.status).toBe(400)
    expect(mTrigger).not.toHaveBeenCalled()
  })
})
