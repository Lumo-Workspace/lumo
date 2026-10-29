/**
 * @jest-environment node
 *
 * LUM-1332 — POST /api/internal/self-host-check: CRON_SECRET-gated, not
 * served on Vercel, returns the service's results as `checks`.
 */
const mockRun = jest.fn()
jest.mock('@/lib/services/self-host-check.service', () => ({
  defaultSelfHostProbes: {},
  runSelfHostChecks: (...a: unknown[]) => mockRun(...a),
}))

import { NextRequest } from 'next/server'
import { POST } from '@/app/api/internal/self-host-check/route'

const SECRET = ['cron', 'fixture', 'value'].join('-')

function request(auth?: string): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/internal/self-host-check', {
    method: 'POST',
    headers: auth ? { authorization: auth } : {},
  })
}

const saved = {
  CRON_SECRET: process.env.CRON_SECRET,
  VERCEL: process.env.VERCEL,
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET
  delete process.env.VERCEL
  mockRun
    .mockReset()
    .mockResolvedValue([{ id: 'database', status: 'ok', detail: 'connected' }])
})

afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe('POST /api/internal/self-host-check', () => {
  it('returns the checks for the cron secret', async () => {
    const res = await POST(request(`Bearer ${SECRET}`))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      checks: [{ id: 'database', status: 'ok', detail: 'connected' }],
    })
  })

  it('401 without the secret, and runs nothing', async () => {
    expect((await POST(request())).status).toBe(401)
    expect((await POST(request('Bearer wrong'))).status).toBe(401)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('404 on Vercel, even with the secret', async () => {
    process.env.VERCEL = '1'
    expect((await POST(request(`Bearer ${SECRET}`))).status).toBe(404)
    expect(mockRun).not.toHaveBeenCalled()
  })
})
