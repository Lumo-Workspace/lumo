/** @jest-environment node */
import { GET, POST } from '@/app/api/pull-requests/[number]/scans/route'
import { prReviewControlService } from '@/lib/services/pr-review-control.service'
jest.mock('@/lib/services/pr-review-control.service', () => ({
  prReviewControlService: { act: jest.fn() },
}))
import { requireIdentity } from '@/lib/auth'
import { prScanReadoutService } from '@/lib/services/pr-scan-readout.service'

jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/services/pr-scan-readout.service', () => ({
  prScanReadoutService: { getForPullRequest: jest.fn() },
}))
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}))

const identity = requireIdentity as jest.Mock
const read = prScanReadoutService.getForPullRequest as jest.Mock

function req(query = '') {
  return {
    url: `https://lumo.test/api/pull-requests/1013/scans${query}`,
    headers: { get: () => null },
  } as never
}
const params = (number: string) => ({ params: Promise.resolve({ number }) })

beforeEach(() => {
  jest.clearAllMocks()
  identity.mockResolvedValue({
    clerkId: 'c1',
    memberId: 'm1',
    workspaceId: 'ws-1',
    workspaceSlug: 'lumo',
    workspaceName: 'Lumo',
    source: 'bearer',
  })
  read.mockResolvedValue({ version: 1, scans: [] })
})

test('LUM-1056 POST validates controls and derives workspace from the identity', async () => {
  const act = prReviewControlService.act as jest.Mock
  act.mockResolvedValueOnce({ queued: true, mode: 'full' })
  const request = {
    url: 'https://lumo.test/api/pull-requests/7/scans?repo=o/r',
    json: async () => ({ action: 'full' }),
  } as never
  const res = await POST(request, params('7'))
  expect(res.status).toBe(202)
  expect(act).toHaveBeenCalledWith('ws-1', 7, 'o/r', 'full', undefined)
  for (const body of [
    { action: 'full', workspaceId: 'other' },
    { action: 'resume', limit: 0 },
    { action: 'resume', limit: 101 },
  ]) {
    const invalid = await POST(
      { ...(request as object), json: async () => body } as never,
      params('7')
    )
    expect(invalid.status).toBe(400)
  }
  expect(act).toHaveBeenCalledTimes(1)
})

/**
 * LUM-788 — `GET /api/pull-requests/[number]/scans`: thin, read-only, scoped
 * to the identity's workspace. The route never sees a workspace id from the
 * query; the service's 404 / 409 are passed through as-is.
 */
describe('GET /api/pull-requests/[number]/scans', () => {
  it('reads the latest scan for the identity workspace by default', async () => {
    const res = await GET(req(), params('1013'))
    expect(res.status).toBe(200)
    expect(read).toHaveBeenCalledWith('ws-1', {
      number: 1013,
      repo: undefined,
      all: false,
    })
  })

  it('passes --repo and --all through the query', async () => {
    const res = await GET(
      req('?repo=Lumo-Workspace/lumo&all=1'),
      params('1013')
    )
    expect(res.status).toBe(200)
    expect(read).toHaveBeenCalledWith('ws-1', {
      number: 1013,
      repo: 'Lumo-Workspace/lumo',
      all: true,
    })
  })

  it('rejects a non-numeric PR number and a malformed repo with 400', async () => {
    expect((await GET(req(), params('abc'))).status).toBe(400)
    expect((await GET(req('?repo=not-a-repo'), params('1013'))).status).toBe(
      400
    )
    expect(read).not.toHaveBeenCalled()
  })

  it('returns the identity failure untouched (401 for a missing credential)', async () => {
    const { NextResponse } = await import('next/server')
    identity.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await GET(req(), params('1013'))
    expect(res.status).toBe(401)
    expect(read).not.toHaveBeenCalled()
  })

  it('maps the service 404 (unknown / other-workspace PR) and 409 (ambiguous repo, with candidates)', async () => {
    read.mockRejectedValueOnce(
      Object.assign(new Error('PR #1013 not found in this workspace'), {
        status: 404,
      })
    )
    const missing = await GET(req(), params('1013'))
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({
      error: 'PR #1013 not found in this workspace',
    })

    read.mockRejectedValueOnce(
      Object.assign(new Error('PR #1013 exists in several repos'), {
        status: 409,
        repos: ['a/one', 'a/two'],
      })
    )
    const ambiguous = await GET(req(), params('1013'))
    expect(ambiguous.status).toBe(409)
    expect(await ambiguous.json()).toEqual({
      error: 'PR #1013 exists in several repos',
      repos: ['a/one', 'a/two'],
    })
  })

  it('turns an unexpected failure into a 500 without leaking the message', async () => {
    read.mockRejectedValueOnce(new Error('db down: postgres://user:pw@host'))
    const res = await GET(req(), params('1013'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal Server Error' })
  })
})
