/**
 * @jest-environment node
 *
 * LUM-882 — how GitHub's collaborator-permission answers map to "can the
 * verifier still read this repository". Fail closed on GitHub's answers, fail
 * safe on GitHub failing to answer.
 */
import {
  checkRepositoryReadAccess,
  checkRepositoryWriteAccess,
  lookupGitHubUser,
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

describe('lookupGitHubUser', () => {
  it('returns id and login for 200, gone for 404 and null otherwise', async () => {
    reply(200, { login: 'octo', id: 7 })
    reply(404, { message: 'Not Found' })
    reply(500, {})
    reply(200, { login: 'octo' })
    expect(await lookupGitHubUser('t', { login: 'octo' })).toEqual({
      id: 7,
      login: 'octo',
    })
    expect(await lookupGitHubUser('t', { login: 'octo' })).toBe('gone')
    expect(await lookupGitHubUser('t', { login: 'octo' })).toBeNull()
    // A 200 without an id cannot vouch for anyone.
    expect(await lookupGitHubUser('t', { login: 'octo' })).toBeNull()
  })

  it('asks by immutable id when one is recorded, by login otherwise', async () => {
    reply(200, { login: 'octo-renamed', id: 7 })
    reply(200, { login: 'octo', id: 7 })
    expect(await lookupGitHubUser('t', { id: 7 })).toEqual({
      id: 7,
      login: 'octo-renamed',
    })
    await lookupGitHubUser('t', { login: 'o/cto' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/user/7')
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.github.com/users/o%2Fcto'
    )
  })
})

describe('checkRepositoryWriteAccess (LUM-1129)', () => {
  it('asks the permission endpoint for the login', async () => {
    reply(200, { permission: 'write' })
    await checkRepositoryWriteAccess('tok', 'acme/web', 'octo cat')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      'https://api.github.com/repos/acme/web/collaborators/octo%20cat/permission'
    )
    expect(init.headers.Authorization).toBe('Bearer tok')
  })

  it.each(['write', 'maintain', 'admin'])('%s may push', async permission => {
    reply(200, { permission })
    expect(await checkRepositoryWriteAccess('t', 'acme/web', 'octo')).toBe(
      'write'
    )
  })

  it.each(['read', 'triage', 'none', 'mystery'])(
    '%s may not push',
    async permission => {
      reply(200, { permission })
      expect(await checkRepositoryWriteAccess('t', 'acme/web', 'octo')).toBe(
        'no_write'
      )
    }
  )

  it('404 is no access; other failures are unknown', async () => {
    reply(404, {})
    expect(await checkRepositoryWriteAccess('t', 'acme/web', 'octo')).toBe(
      'no_write'
    )
    reply(500, {})
    expect(await checkRepositoryWriteAccess('t', 'acme/web', 'octo')).toBe(
      'unknown'
    )
    fetchMock.mockRejectedValueOnce(new Error('network'))
    expect(await checkRepositoryWriteAccess('t', 'acme/web', 'octo')).toBe(
      'unknown'
    )
  })
})
