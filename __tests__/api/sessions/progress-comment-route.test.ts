/**
 * @jest-environment node
 */
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))
jest.mock('@/lib/auth/bearer', () => ({ verifyBearer: jest.fn() }))
jest.mock('@/lib/services/session.service', () => ({
  sessionService: { postProgressComment: jest.fn() },
}))

import { POST } from '@/app/api/sessions/[sessionId]/progress-comment/route'
import { verifyBearer } from '@/lib/auth/bearer'
import { sessionService } from '@/lib/services/session.service'

const bearer = verifyBearer as jest.Mock
const post = sessionService.postProgressComment as jest.Mock
const params = { params: Promise.resolve({ sessionId: 's1' }) }

const req = (body: unknown) =>
  new Request('http://x/api/sessions/s1/progress-comment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => jest.clearAllMocks())

it('401 when bearer invalid', async () => {
  bearer.mockResolvedValue(null)
  const res = await POST(req({ body: 'x', watermark: '2026-06-01T10:00:00.000Z' }), params)
  expect(res.status).toBe(401)
})

it('400 when body fails validation (empty)', async () => {
  bearer.mockResolvedValue({ user: { id: 'u1' }, workspace: { id: 'w1' } })
  const res = await POST(req({ body: '', watermark: '2026-06-01T10:00:00.000Z' }), params)
  expect(res.status).toBe(400)
  expect(post).not.toHaveBeenCalled()
})

it('400 when watermark is missing', async () => {
  bearer.mockResolvedValue({ user: { id: 'u1' }, workspace: { id: 'w1' } })
  const res = await POST(req({ body: 'hello' }), params)
  expect(res.status).toBe(400)
})

it('201 with commentId on success', async () => {
  bearer.mockResolvedValue({ user: { id: 'u1' }, workspace: { id: 'w1' } })
  post.mockResolvedValue({ commentId: 'c1' })
  const res = await POST(req({ body: 'hello', watermark: '2026-06-01T10:00:00.000Z' }), params)
  expect(res.status).toBe(201)
  expect(await res.json()).toEqual({ commentId: 'c1' })
})

it('maps service status errors (409 unbound)', async () => {
  bearer.mockResolvedValue({ user: { id: 'u1' }, workspace: { id: 'w1' } })
  post.mockRejectedValue(Object.assign(new Error('not bound'), { status: 409 }))
  const res = await POST(req({ body: 'hello', watermark: '2026-06-01T10:00:00.000Z' }), params)
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: 'not bound' })
})
