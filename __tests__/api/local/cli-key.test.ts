/**
 * @jest-environment node
 *
 * LUM-1335 — POST /api/local/cli-key exists only in local mode.
 */
import { NextRequest } from 'next/server'

const mockIssue = jest.fn()
jest.mock('@/lib/services/local-mode.service', () => ({
  localModeService: { issueCliKey: (...a: unknown[]) => mockIssue(...a) },
}))

import { POST } from '@/app/api/local/cli-key/route'

const req = () =>
  new NextRequest('http://localhost:3000/api/local/cli-key', {
    method: 'POST',
    headers: { 'user-agent': 'lumo-cli' },
  })

const saved = process.env.LUMO_MODE
afterEach(() => {
  if (saved === undefined) delete process.env.LUMO_MODE
  else process.env.LUMO_MODE = saved
  mockIssue.mockReset()
})

describe('POST /api/local/cli-key', () => {
  it('is 404 without LUMO_MODE=local and issues nothing', async () => {
    delete process.env.LUMO_MODE
    const res = await POST(req())
    expect(res.status).toBe(404)
    expect(mockIssue).not.toHaveBeenCalled()
  })

  it('issues a key in local mode, with a CLI audit context', async () => {
    process.env.LUMO_MODE = 'local'
    mockIssue.mockResolvedValue({
      key: 'lum_abc',
      workspaceSlug: 'my-workspace',
    })
    const res = await POST(req())
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      key: 'lum_abc',
      workspaceSlug: 'my-workspace',
    })
    expect(mockIssue).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'CLI', userAgent: 'lumo-cli' })
    )
  })

  it('passes a service refusal through with its status', async () => {
    process.env.LUMO_MODE = 'local'
    mockIssue.mockRejectedValue(
      Object.assign(new Error('several accounts'), { status: 409 })
    )
    const res = await POST(req())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'several accounts' })
  })
})
