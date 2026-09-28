/**
 * @jest-environment node
 *
 * LUM-882 — how GitHub's collaborator-permission answers map to "can the
 * verifier still read this repository". Fail closed on GitHub's answers, fail
 * safe on GitHub failing to answer.
 */
import {
  checkRepositoryReadAccess,
  checkUserExists,
} from '@/lib/integrations/github/collaborator-access'

const fetchMock = jest.fn()
global.fetch = fetchMock as unknown as typeof fetch

function reply(status: number, body: unknown, remaining = '4000') {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'x-ratelimit-remaining': remaining },
    })
  )
}

beforeEach(() => fetchMock.mockReset())

describe('checkRepositoryReadAccess', () => {
  it('asks the permission endpoint with the installation token', async () => {
    reply(200, { permission: 'admin', role_name: 'admin' })
    await checkRepositoryReadAccess('inst-token', 'acme/web', 'octo')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      'https://api.github.com/repos/acme/web/collaborators/octo/permission'
    )
    expect(init.headers.Authorization).toBe('Bearer inst-token')
  })

  it.each(['read', 'triage', 'write', 'maintain', 'admin'])(
    'treats %s as readable',
    async permission => {
      reply(200, { permission })
      expect(await checkRepositoryReadAccess('t', 'acme/web', 'octo')).toEqual({
        access: 'readable',
        remaining: 4000,
      })
    }
  )

  it('treats none and an unrecognised role as unreadable', async () => {
    reply(200, { permission: 'none' })
    reply(200, { permission: 'mystery' })
    expect(
      (await checkRepositoryReadAccess('t', 'acme/web', 'octo')).access
    ).toBe('unreadable')
    expect(
      (await checkRepositoryReadAccess('t', 'acme/web', 'octo')).access
    ).toBe('unreadable')
  })

  it('treats 404 (unknown user or unreachable repository) as unreadable', async () => {
    reply(404, { message: 'octo is not a user' })
    expect(
      (await checkRepositoryReadAccess('t', 'acme/web', 'octo')).access
    ).toBe('unreadable')
  })

  it('reports an exhausted rate limit instead of an answer', async () => {
    reply(403, { message: 'API rate limit exceeded' }, '0')
    reply(429, { message: 'slow down' }, '12')
    expect(
      (await checkRepositoryReadAccess('t', 'acme/web', 'octo')).access
    ).toBe('rate_limited')
    expect(
      (await checkRepositoryReadAccess('t', 'acme/web', 'octo')).access
    ).toBe('rate_limited')
  })

  it('keeps the repository on a server error or network failure', async () => {
    reply(502, { message: 'bad gateway' })
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'))
    expect(
      (await checkRepositoryReadAccess('t', 'acme/web', 'octo')).access
    ).toBe('unknown')
    expect(await checkRepositoryReadAccess('t', 'acme/web', 'octo')).toEqual({
      access: 'unknown',
      remaining: null,
    })
  })
})

describe('checkUserExists', () => {
  it('is true for 200, false for 404 and null otherwise', async () => {
    reply(200, { login: 'octo' })
    reply(404, { message: 'Not Found' })
    reply(500, {})
    expect(await checkUserExists('t', 'octo')).toBe(true)
    expect(await checkUserExists('t', 'octo')).toBe(false)
    expect(await checkUserExists('t', 'octo')).toBeNull()
  })
})
