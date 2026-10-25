/**
 * @jest-environment node
 *
 * LUM-1315 — /api/codeup/connection and /api/codeup/repositories stay thin:
 * auth → validate → service → response, with service errors mapped.
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(async () => ({ userId: 'user1' })),
  requireWorkspaceMember: jest.fn(async () => ({ id: 'mem1', role: 'OWNER' })),
}))
jest.mock('@/lib/api/helpers', () => ({
  requireWorkspaceByUrl: jest.fn(async () => ({ workspaceId: 'ws1' })),
}))
jest.mock('@/lib/services/codeup.service', () => ({
  codeupService: {
    getStatus: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
    listRepositories: jest.fn(),
    updateRepositories: jest.fn(),
  },
}))

import * as connection from '@/app/api/codeup/connection/route'
import * as repositories from '@/app/api/codeup/repositories/route'
import { codeupService } from '@/lib/services/codeup.service'

const svc = codeupService as jest.Mocked<typeof codeupService>
if (!process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = '0'.repeat(64)

const URL_C = 'http://x/api/codeup/connection?workspaceUrl=acme'
const URL_R = 'http://x/api/codeup/repositories?workspaceUrl=acme'

function req(url: string, method = 'GET', body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    ...(body !== undefined
      ? {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  })
}

beforeEach(() => jest.clearAllMocks())

describe('/api/codeup/connection', () => {
  it('GET returns the status', async () => {
    svc.getStatus.mockResolvedValue({ connected: false })
    const res = await connection.GET(req(URL_C))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ connected: false })
    expect(svc.getStatus).toHaveBeenCalledWith('ws1')
  })

  it('GET 404s when the flag is off (service 404)', async () => {
    svc.getStatus.mockRejectedValue(
      Object.assign(new Error('Not found'), { status: 404 })
    )
    const res = await connection.GET(req(URL_C))
    expect(res.status).toBe(404)
  })

  it('POST validates and connects with an audit context', async () => {
    svc.connect.mockResolvedValue([])
    const res = await connection.POST(
      req(URL_C, 'POST', {
        organizationId: '60de7a6852743a5162b5f957',
        accessToken: 'pt-12345678',
      })
    )
    expect(res.status).toBe(200)
    expect(svc.connect).toHaveBeenCalledWith(
      'ws1',
      'mem1',
      'OWNER',
      {
        organizationId: '60de7a6852743a5162b5f957',
        accessToken: 'pt-12345678',
      },
      expect.objectContaining({ source: 'WEB' })
    )
  })

  it('POST 400s on a malformed organization id without calling the service', async () => {
    const res = await connection.POST(
      req(URL_C, 'POST', { organizationId: 'a/b', accessToken: 'pt-12345678' })
    )
    expect(res.status).toBe(400)
    expect(svc.connect).not.toHaveBeenCalled()
  })

  it('POST passes the service 400 for a refused token through', async () => {
    svc.connect.mockRejectedValue(
      Object.assign(
        new Error('Codeup rejected the organization ID or access token'),
        {
          status: 400,
        }
      )
    )
    const res = await connection.POST(
      req(URL_C, 'POST', { organizationId: 'org1', accessToken: 'pt-12345678' })
    )
    expect(res.status).toBe(400)
  })

  it('DELETE disconnects', async () => {
    svc.disconnect.mockResolvedValue(undefined)
    const res = await connection.DELETE(req(URL_C, 'DELETE'))
    expect(res.status).toBe(200)
    expect(svc.disconnect).toHaveBeenCalledWith(
      'ws1',
      'OWNER',
      expect.objectContaining({ source: 'WEB' })
    )
  })

  it('maps an unexpected error to 500', async () => {
    svc.disconnect.mockRejectedValue(new Error('boom'))
    const res = await connection.DELETE(req(URL_C, 'DELETE'))
    expect(res.status).toBe(500)
  })
})

describe('/api/codeup/repositories', () => {
  it('GET lists the organization repositories', async () => {
    svc.listRepositories.mockResolvedValue([])
    const res = await repositories.GET(req(URL_R))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ repositories: [] })
    expect(svc.listRepositories).toHaveBeenCalledWith('ws1', 'OWNER')
  })

  it('PUT replaces the confirmed set', async () => {
    svc.updateRepositories.mockResolvedValue({ connected: false })
    const res = await repositories.PUT(
      req(URL_R, 'PUT', { repositoryIds: [14, 15] })
    )
    expect(res.status).toBe(200)
    expect(svc.updateRepositories).toHaveBeenCalledWith(
      'ws1',
      'OWNER',
      [14, 15],
      expect.objectContaining({ source: 'WEB' })
    )
  })

  it('PUT 400s on non-numeric ids', async () => {
    const res = await repositories.PUT(
      req(URL_R, 'PUT', { repositoryIds: ['x'] })
    )
    expect(res.status).toBe(400)
    expect(svc.updateRepositories).not.toHaveBeenCalled()
  })

  it('PUT passes a 403 for a non-owner through', async () => {
    svc.updateRepositories.mockRejectedValue(
      Object.assign(new Error('owners only'), { status: 403 })
    )
    const res = await repositories.PUT(req(URL_R, 'PUT', { repositoryIds: [] }))
    expect(res.status).toBe(403)
  })
})
