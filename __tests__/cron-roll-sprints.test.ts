/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/repositories/team.repository', () => ({
  teamRepository: { listSprintsEnabledIds: jest.fn() },
}))
jest.mock('@/lib/services/sprint.service', () => ({
  sprintService: { reconcileSprintStates: jest.fn() },
}))

import { GET } from '@/app/api/cron/roll-sprints/route'
import { teamRepository } from '@/lib/repositories/team.repository'
import { sprintService } from '@/lib/services/sprint.service'

const mockListTeams = teamRepository.listSprintsEnabledIds as jest.Mock
const mockReconcile = sprintService.reconcileSprintStates as jest.Mock

function req(authHeader?: string) {
  return new NextRequest('http://localhost/api/cron/roll-sprints', {
    method: 'GET',
    ...(authHeader ? { headers: { authorization: authHeader } } : {}),
  })
}

beforeAll(() => {
  process.env.CRON_SECRET = 'test-secret'
})

beforeEach(() => {
  jest.clearAllMocks()
  mockListTeams.mockResolvedValue(['t1', 't2'])
  mockReconcile.mockResolvedValue(undefined)
})

describe('GET /api/cron/roll-sprints', () => {
  it('rejects an unauthenticated request with 401 and reconciles nothing', async () => {
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(mockReconcile).not.toHaveBeenCalled()
  })

  it('rejects a wrong bearer token with 401', async () => {
    const res = await GET(req('Bearer wrong'))
    expect(res.status).toBe(401)
    expect(mockReconcile).not.toHaveBeenCalled()
  })

  it('reconciles every sprints-enabled team when authorized', async () => {
    const res = await GET(req('Bearer test-secret'))

    expect(res.status).toBe(200)
    expect(mockReconcile).toHaveBeenCalledTimes(2)
    expect(mockReconcile).toHaveBeenCalledWith('t1')
    expect(mockReconcile).toHaveBeenCalledWith('t2')
    await expect(res.json()).resolves.toEqual({
      teams: 2,
      reconciled: 2,
      failed: 0,
    })
  })

  it('isolates a per-team failure and still returns 200', async () => {
    mockReconcile
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('boom'))

    const res = await GET(req('Bearer test-secret'))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      teams: 2,
      reconciled: 1,
      failed: 1,
    })
  })
})
