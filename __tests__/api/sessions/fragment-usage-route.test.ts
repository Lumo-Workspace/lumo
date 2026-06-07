/**
 * @jest-environment node
 */
jest.mock('@/lib/auth/bearer', () => ({ verifyBearer: jest.fn() }))
jest.mock('@/lib/services/session.service', () => ({
  sessionService: {
    getFragmentUsageDraft: jest.fn(),
    applyFragmentUsage: jest.fn(),
  },
}))

import {
  GET,
  POST,
} from '@/app/api/sessions/[sessionId]/fragment-usage/route'
import { verifyBearer } from '@/lib/auth/bearer'
import { sessionService } from '@/lib/services/session.service'

const bearer = verifyBearer as jest.Mock
const getDraft = sessionService.getFragmentUsageDraft as jest.Mock
const apply = sessionService.applyFragmentUsage as jest.Mock
const identity = { user: { id: 'ck1' }, workspace: { id: 'w1' } }
const params = (id: string) => ({ params: Promise.resolve({ sessionId: id }) })

beforeEach(() => jest.clearAllMocks())

describe('GET fragment-usage', () => {
  it('401 without a valid bearer', async () => {
    bearer.mockResolvedValue(null)
    const res = await GET(new Request('http://x'), params('s1'))
    expect(res.status).toBe(401)
  })

  it('returns the draft', async () => {
    bearer.mockResolvedValue(identity)
    getDraft.mockResolvedValue({
      taskIdentifier: 'LUM-42',
      candidates: [],
      alreadyVoted: false,
    })
    const res = await GET(new Request('http://x'), params('s1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      taskIdentifier: 'LUM-42',
      candidates: [],
      alreadyVoted: false,
    })
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

describe('POST fragment-usage', () => {
  it('401 without a valid bearer', async () => {
    bearer.mockResolvedValue(null)
    const res = await POST(postReq({ usedRefs: [] }), params('s1'))
    expect(res.status).toBe(401)
  })

  it('400 on malformed body', async () => {
    bearer.mockResolvedValue(identity)
    const res = await POST(postReq({ usedRefs: [{ fragmentType: 'NOPE', fragmentId: 'x' }] }), params('s1'))
    expect(res.status).toBe(400)
    expect(apply).not.toHaveBeenCalled()
  })

  it('applies the vote and returns counts', async () => {
    bearer.mockResolvedValue(identity)
    apply.mockResolvedValue({ used: 1, unused: 2 })
    const res = await POST(
      postReq({ usedRefs: [{ fragmentType: 'MEMORY', fragmentId: 'mem-1' }] }),
      params('s1')
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ used: 1, unused: 2 })
    expect(apply).toHaveBeenCalledWith({
      identity,
      sessionId: 's1',
      usedRefs: [{ fragmentType: 'MEMORY', fragmentId: 'mem-1' }],
    })
  })
})
