/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

// Only the service call is mocked: the real route handler and the real
// requireCronAuth (lib/api/cron-auth) decide the outcome.
jest.mock('@/lib/services/summary.service', () => ({
  summaryService: { generateCronSummaries: jest.fn() },
}))

import { GET } from '@/app/api/summaries/generate/route'
import { summaryService } from '@/lib/services/summary.service'

const mockGenerate = summaryService.generateCronSummaries as jest.Mock

function req(authHeader?: string) {
  return new NextRequest('http://localhost/api/summaries/generate', {
    method: 'GET',
    ...(authHeader ? { headers: { authorization: authHeader } } : {}),
  })
}

const ORIGINAL_SECRET = process.env.CRON_SECRET

beforeEach(() => {
  jest.clearAllMocks()
  mockGenerate.mockResolvedValue([])
})

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = ORIGINAL_SECRET
})

describe('GET /api/summaries/generate — cron auth (LUM-981)', () => {
  describe('CRON_SECRET unset', () => {
    beforeEach(() => {
      delete process.env.CRON_SECRET
    })

    it('fails closed on `Bearer undefined`: 401 and no summaries generated', async () => {
      const res = await GET(req('Bearer undefined'))
      expect(res.status).toBe(401)
      expect(mockGenerate).not.toHaveBeenCalled()
    })

    it('fails closed with no Authorization header', async () => {
      const res = await GET(req())
      expect(res.status).toBe(401)
      expect(mockGenerate).not.toHaveBeenCalled()
    })
  })

  describe('CRON_SECRET empty string', () => {
    beforeEach(() => {
      process.env.CRON_SECRET = ''
    })

    it('fails closed on `Bearer ` (empty secret): 401', async () => {
      const res = await GET(req('Bearer '))
      expect(res.status).toBe(401)
      expect(mockGenerate).not.toHaveBeenCalled()
    })
  })

  describe('CRON_SECRET set', () => {
    beforeEach(() => {
      process.env.CRON_SECRET = 'test-secret'
    })

    it('rejects a wrong secret with 401', async () => {
      const res = await GET(req('Bearer wrong-secret'))
      expect(res.status).toBe(401)
      expect(mockGenerate).not.toHaveBeenCalled()
    })

    it('runs the cron with the correct secret: 200 and service called', async () => {
      mockGenerate.mockResolvedValue([{ workspaceId: 'w1' }])
      const res = await GET(req('Bearer test-secret'))
      expect(res.status).toBe(200)
      expect(mockGenerate).toHaveBeenCalledTimes(1)
      expect(await res.json()).toEqual({ results: [{ workspaceId: 'w1' }] })
    })
  })
})
