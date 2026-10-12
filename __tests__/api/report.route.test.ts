/**
 * @jest-environment node
 */
import { GET } from '@/app/api/report/route'

jest.mock('@/lib/auth/identity', () => ({
  requireIdentity: jest
    .fn()
    .mockResolvedValue({ workspaceId: 'w1', memberId: 'm1' }),
}))
jest.mock('@/lib/services/report.service', () => ({
  ...jest.requireActual('@/lib/services/report.service'),
  reportService: { getReport: jest.fn() },
}))

import { reportService } from '@/lib/services/report.service'
const getReport = reportService.getReport as jest.Mock

beforeEach(() => {
  getReport.mockReset()
  getReport.mockResolvedValue({ version: 1 })
})

describe('GET /api/report', () => {
  it('passes the window, member, project and limit through for the caller workspace', async () => {
    const res = await GET(
      new Request(
        'http://x/api/report?since=2026-10-06T00:00:00.000Z&until=2026-10-13T00:00:00.000Z&member=m2&project=Lumo&limit=10'
      )
    )
    expect(res.status).toBe(200)
    expect(getReport).toHaveBeenCalledWith('w1', {
      since: new Date('2026-10-06T00:00:00.000Z'),
      until: new Date('2026-10-13T00:00:00.000Z'),
      memberId: 'm2',
      projectRef: 'Lumo',
      limit: 10,
    })
  })

  it('defaults to the 7 days before until', async () => {
    await GET(new Request('http://x/api/report?until=2026-10-13T00:00:00.000Z'))
    const arg = getReport.mock.calls[0][1]
    expect(arg.since.toISOString()).toBe('2026-10-06T00:00:00.000Z')
  })

  it('400s on a malformed date without calling the service', async () => {
    const res = await GET(new Request('http://x/api/report?since=yesterday'))
    expect(res.status).toBe(400)
    expect(getReport).not.toHaveBeenCalled()
  })

  it('maps a service status error to the response', async () => {
    getReport.mockRejectedValue(
      Object.assign(new Error('member not found'), { status: 404 })
    )
    const res = await GET(new Request('http://x/api/report?member=mX'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'member not found' })
  })
})
