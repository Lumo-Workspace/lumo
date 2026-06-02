/**
 * @jest-environment node
 */
jest.mock('@/lib/auth/bearer', () => ({ verifyBearer: jest.fn() }))
jest.mock('@/lib/services/session.service', () => ({
  sessionService: {
    getSessionMemoryDraft: jest.fn(),
    applyMemoryReview: jest.fn(),
  },
}))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))

import { GET } from '@/app/api/sessions/[sessionId]/session-memories/route'
import { POST } from '@/app/api/sessions/[sessionId]/memory-review/route'
import { verifyBearer } from '@/lib/auth/bearer'
import { sessionService } from '@/lib/services/session.service'

const bearer = verifyBearer as jest.Mock
const getDraft = sessionService.getSessionMemoryDraft as jest.Mock
const apply = sessionService.applyMemoryReview as jest.Mock
const identity = { user: { id: 'ck1' }, workspace: { id: 'w1' } }
const params = (id: string) => ({ params: Promise.resolve({ sessionId: id }) })

beforeEach(() => jest.clearAllMocks())

describe('GET session-memories', () => {
  it('401 without a valid bearer', async () => {
    bearer.mockResolvedValue(null)
    const res = await GET(new Request('http://x'), params('s1'))
    expect(res.status).toBe(401)
  })

  it('returns the draft', async () => {
    bearer.mockResolvedValue(identity)
    getDraft.mockResolvedValue({ taskIdentifier: 'LUM-42', memories: [], watermark: null })
    const res = await GET(new Request('http://x'), params('s1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ taskIdentifier: 'LUM-42', memories: [], watermark: null })
    expect(getDraft).toHaveBeenCalledWith({ identity, sessionId: 's1' })
  })
})

function postReq(body: unknown): Request {
  return new Request('http://x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST memory-review', () => {
  it('401 without a valid bearer', async () => {
    bearer.mockResolvedValue(null)
    const res = await POST(postReq({ watermark: '2026-06-01T10:00:00.000Z', deleteIds: [], promoteIds: [] }), params('s1'))
    expect(res.status).toBe(401)
  })

  it('400 on an invalid watermark', async () => {
    bearer.mockResolvedValue(identity)
    const res = await POST(postReq({ watermark: 'nope', deleteIds: [], promoteIds: [] }), params('s1'))
    expect(res.status).toBe(400)
    expect(apply).not.toHaveBeenCalled()
  })

  it('applies the review and returns counts', async () => {
    bearer.mockResolvedValue(identity)
    apply.mockResolvedValue({ deleted: 1, promoted: 0 })
    const res = await POST(
      postReq({ watermark: '2026-06-01T10:00:00.000Z', deleteIds: ['m1'], promoteIds: [] }),
      params('s1')
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deleted: 1, promoted: 0 })
    expect(apply).toHaveBeenCalledWith({
      identity, sessionId: 's1',
      watermark: '2026-06-01T10:00:00.000Z',
      deleteIds: ['m1'], promoteIds: [],
    })
  })

  it('maps a thrown 404 to a 404 response', async () => {
    bearer.mockResolvedValue(identity)
    apply.mockRejectedValue(Object.assign(new Error('Session not found'), { status: 404 }))
    const res = await POST(postReq({ watermark: '2026-06-01T10:00:00.000Z', deleteIds: [], promoteIds: [] }), params('s1'))
    expect(res.status).toBe(404)
  })
})
