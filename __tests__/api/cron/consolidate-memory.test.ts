/**
 * @jest-environment node
 *
 * Tests the cron route's two responsibilities: the CRON_SECRET bearer
 * check (the only thing standing between this endpoint and the public
 * internet) and the totals-aggregation that the cron log relies on.
 */
jest.mock('@/lib/services/memory/layer2.service', () => ({
  layer2Service: {
    runConsolidation: jest.fn(),
  },
}))

import { NextRequest } from 'next/server'
import { layer2Service } from '@/lib/services/memory/layer2.service'
import { GET } from '@/app/api/cron/consolidate-memory/route'

const runConsolidation = layer2Service.runConsolidation as jest.MockedFunction<
  typeof layer2Service.runConsolidation
>

const CRON_SECRET = 'test_secret_value'

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CRON_SECRET = CRON_SECRET
})

function makeRequest(authHeader: string | null) {
  const headers = new Headers()
  if (authHeader !== null) headers.set('authorization', authHeader)
  return new NextRequest('http://localhost/api/cron/consolidate-memory', {
    method: 'GET',
    headers,
  })
}

describe('GET /api/cron/consolidate-memory', () => {
  it('returns 401 when the bearer secret is missing', async () => {
    const res = await GET(makeRequest(null))
    expect(res.status).toBe(401)
    expect(runConsolidation).not.toHaveBeenCalled()
  })

  it('returns 401 when the bearer secret is wrong', async () => {
    const res = await GET(makeRequest('Bearer wrong-secret'))
    expect(res.status).toBe(401)
    expect(runConsolidation).not.toHaveBeenCalled()
  })

  it('returns aggregated totals across projects on success', async () => {
    runConsolidation.mockResolvedValue({
      projects: [
        { projectId: 'proj_1', added: 2, updated: 1, noop: 0, skipped: 0 },
        { projectId: 'proj_2', added: 0, updated: 0, noop: 3, skipped: 1 },
        {
          projectId: 'proj_3',
          added: 0,
          updated: 0,
          noop: 0,
          skipped: 0,
          error: 'boom',
        },
      ],
      skippedProjects: ['proj_4'],
    })

    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      projectsProcessed: 3,
      projectsSkipped: 1,
      totals: { added: 2, updated: 1, noop: 3, skipped: 1, failed: 1 },
      projects: expect.any(Array),
    })
  })
})
