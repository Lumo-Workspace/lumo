/**
 * @jest-environment node
 */
jest.mock('@/lib/auth/bearer', () => ({ verifyBearer: jest.fn() }))
jest.mock('@/lib/services/session.service', () => ({
  sessionService: { getSessionProgressDraft: jest.fn() },
}))

import { GET } from '@/app/api/sessions/[sessionId]/turn-summaries/route'
import { verifyBearer } from '@/lib/auth/bearer'
import { sessionService } from '@/lib/services/session.service'

const bearer = verifyBearer as jest.Mock
const draft = sessionService.getSessionProgressDraft as jest.Mock
const params = { params: Promise.resolve({ sessionId: 's1' }) }

beforeEach(() => jest.clearAllMocks())

it('401 when bearer invalid', async () => {
  bearer.mockResolvedValue(null)
  const res = await GET(new Request('http://x/api/sessions/s1/turn-summaries'), params)
  expect(res.status).toBe(401)
})

it('returns the draft payload', async () => {
  bearer.mockResolvedValue({ user: { id: 'u1' }, workspace: { id: 'w1' } })
  draft.mockResolvedValue({ taskIdentifier: 'LUM-42', taskTitle: 'T', summaries: [], watermark: null })
  const res = await GET(new Request('http://x/api/sessions/s1/turn-summaries'), params)
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ taskIdentifier: 'LUM-42', taskTitle: 'T', summaries: [], watermark: null })
  expect(draft).toHaveBeenCalledWith({ identity: expect.anything(), sessionId: 's1' })
})
