/**
 * @jest-environment node
 */
jest.mock('@/lib/services/auth.service', () => ({
  authService: { verifyApiKey: jest.fn() },
}))
jest.mock('@/lib/services/attribution.service', () => ({
  attributionService: { inferenceEval: jest.fn() },
}))

import { authService } from '@/lib/services/auth.service'
import { attributionService } from '@/lib/services/attribution.service'
import { GET } from '@/app/api/attribution/inference-eval/route'

const verify = authService.verifyApiKey as jest.Mock
const evalFn = attributionService.inferenceEval as jest.Mock
const identity = {
  user: { id: 'u' },
  workspace: { id: 'ws' },
  apiKey: { id: 'k', scope: null },
}
const req = (qs = '', auth = true) =>
  new Request(`http://x/api/attribution/inference-eval${qs}`, {
    headers: auth ? { Authorization: 'Bearer k' } : {},
  })

beforeEach(() => {
  jest.clearAllMocks()
  verify.mockResolvedValue(identity)
  evalFn.mockResolvedValue({ sessionsEvaluated: 0 })
})

describe('GET /api/attribution/inference-eval', () => {
  it('401 without a bearer token', async () => {
    expect((await GET(req('', false))).status).toBe(401)
  })
  it('401 with an invalid key', async () => {
    verify.mockResolvedValue(null)
    expect((await GET(req())).status).toBe(401)
  })
  it.each(['?days=0', '?days=91', '?days=abc', '?days=1.5'])(
    '400 for %s',
    async qs => {
      expect((await GET(req(qs))).status).toBe(400)
      expect(evalFn).not.toHaveBeenCalled()
    }
  )
  it('403 when the service says not a member', async () => {
    evalFn.mockRejectedValue(Object.assign(new Error('x'), { status: 403 }))
    expect((await GET(req())).status).toBe(403)
  })
  it('200 with default days 30', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(evalFn).toHaveBeenCalledWith({ identity, days: 30 })
  })
  it('passes explicit days', async () => {
    await GET(req('?days=90'))
    expect(evalFn).toHaveBeenCalledWith({ identity, days: 90 })
  })
})
