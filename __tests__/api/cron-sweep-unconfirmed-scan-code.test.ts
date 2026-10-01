/**
 * @jest-environment node
 *
 * LUM-902 — the backstop sweep's cron route: CRON_SECRET only, and
 * scheduled daily in vercel.json.
 */
jest.mock('@/lib/services/scan-code-retention.service', () => ({
  sweepUnconfirmedScanCode: jest
    .fn()
    .mockResolvedValue({ workspaces: 1, repositories: 2, failed: 0 }),
}))

import { NextRequest } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import { GET } from '@/app/api/cron/sweep-unconfirmed-scan-code/route'
import { sweepUnconfirmedScanCode } from '@/lib/services/scan-code-retention.service'

const URL = 'http://localhost/api/cron/sweep-unconfirmed-scan-code'

describe('GET /api/cron/sweep-unconfirmed-scan-code', () => {
  const OLD = process.env.CRON_SECRET
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.CRON_SECRET = 'cron-secret'
  })
  afterAll(() => {
    process.env.CRON_SECRET = OLD
  })

  it('refuses a request without the cron secret', async () => {
    const res = await GET(new NextRequest(URL))
    expect(res.status).toBe(401)
    expect(sweepUnconfirmedScanCode).not.toHaveBeenCalled()
  })

  it('runs the sweep and returns its summary', async () => {
    const res = await GET(
      new NextRequest(URL, {
        headers: { authorization: 'Bearer cron-secret' },
      })
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      workspaces: 1,
      repositories: 2,
      failed: 0,
    })
  })

  it('is scheduled daily in vercel.json', () => {
    const config = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8')
    ) as { crons: { path: string; schedule: string }[] }
    const cron = config.crons.find(
      c => c.path === '/api/cron/sweep-unconfirmed-scan-code'
    )
    expect(cron?.schedule).toMatch(/^\d+ \d+ \* \* \*$/)
  })
})
