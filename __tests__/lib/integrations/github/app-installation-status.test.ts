/**
 * @jest-environment node
 *
 * LUM-902 — what GitHub says about one of our installations. Only GitHub's
 * own answers (404, suspended_at) may lead a caller to remove anything.
 */
jest.mock('@/lib/integrations/github/auth', () => ({
  getGithubAppJwt: jest.fn().mockResolvedValue('app-jwt'),
  createInstallationToken: jest.fn(),
}))

import { findAppInstallationStatus } from '@/lib/integrations/github/app-installations'
import { getGithubAppJwt } from '@/lib/integrations/github/auth'

const fetchMock = jest.fn()

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = fetchMock as unknown as typeof fetch
})

function reply(status: number, body: unknown = {}) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }))
}

describe('findAppInstallationStatus', () => {
  it('reads an installation with the App JWT', async () => {
    reply(200, { id: 42, suspended_at: null })
    await expect(findAppInstallationStatus(42)).resolves.toBe('active')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/app/installations/42',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer app-jwt' }),
      })
    )
  })

  it('is gone only on 404', async () => {
    reply(404)
    await expect(findAppInstallationStatus(42)).resolves.toBe('gone')
  })

  it('is suspended when GitHub says so', async () => {
    reply(200, { id: 42, suspended_at: '2026-09-30T00:00:00Z' })
    await expect(findAppInstallationStatus(42)).resolves.toBe('suspended')
  })

  it('is unknown when GitHub fails to answer', async () => {
    reply(502)
    await expect(findAppInstallationStatus(42)).resolves.toBe('unknown')
    fetchMock.mockRejectedValue(new Error('ECONNRESET'))
    await expect(findAppInstallationStatus(42)).resolves.toBe('unknown')
    ;(getGithubAppJwt as jest.Mock).mockRejectedValueOnce(new Error('no key'))
    await expect(findAppInstallationStatus(42)).resolves.toBe('unknown')
  })
})
