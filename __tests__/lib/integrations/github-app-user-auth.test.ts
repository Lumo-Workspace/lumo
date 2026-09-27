/**
 * @jest-environment node
 *
 * LUM-875: the GitHub App user-authorization helpers behind the install
 * callback's ownership check.
 */
import {
  buildAppUserAuthorizeUrl,
  exchangeAppUserCode,
  listUserInstallationIds,
  revokeAppUserToken,
  GithubAppUserAuthNotConfiguredError,
} from '@/lib/integrations/github/app-user-auth'

const fetchMock = jest.fn()
const REDIRECT = 'https://app.test/api/github/app/callback'

function json(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

describe('GitHub App user authorization', () => {
  const env = process.env

  beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
    process.env = {
      ...env,
      GITHUB_APP_CLIENT_ID: 'Iv1.client',
      GITHUB_APP_CLIENT_SECRET: 'client-secret',
    }
  })

  afterAll(() => {
    process.env = env
  })

  it('builds the authorize URL with the App client id, state and redirect', () => {
    const url = new URL(buildAppUserAuthorizeUrl('st', REDIRECT))
    expect(url.origin + url.pathname).toBe(
      'https://github.com/login/oauth/authorize'
    )
    expect(url.searchParams.get('client_id')).toBe('Iv1.client')
    expect(url.searchParams.get('state')).toBe('st')
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT)
  })

  it('throws not-configured when the App client credentials are missing', async () => {
    delete process.env.GITHUB_APP_CLIENT_SECRET
    expect(() => buildAppUserAuthorizeUrl('st', REDIRECT)).toThrow(
      GithubAppUserAuthNotConfiguredError
    )
    await expect(exchangeAppUserCode('c', REDIRECT)).rejects.toBeInstanceOf(
      GithubAppUserAuthNotConfiguredError
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('exchanges a code for a user token and rejects an error body', async () => {
    fetchMock.mockResolvedValueOnce(json({ access_token: 'ghu_x' }))
    await expect(exchangeAppUserCode('c', REDIRECT)).resolves.toBe('ghu_x')

    fetchMock.mockResolvedValueOnce(json({ error: 'bad_verification_code' }))
    await expect(exchangeAppUserCode('c', REDIRECT)).rejects.toThrow(
      'bad_verification_code'
    )
  })

  it('lists the installation ids the user can access and throws on a GitHub error', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ total_count: 2, installations: [{ id: 1 }, { id: 42 }] })
    )
    await expect(listUserInstallationIds('ghu_x')).resolves.toEqual([1, 42])
    expect(fetchMock.mock.calls[0][0]).toContain('/user/installations')
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      'Bearer ghu_x'
    )

    fetchMock.mockResolvedValueOnce(json({ message: 'Bad credentials' }, 401))
    await expect(listUserInstallationIds('ghu_x')).rejects.toThrow('401')
  })

  it('revokes the user token without ever throwing', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 204))
    await expect(revokeAppUserToken('ghu_x')).resolves.toBeUndefined()
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.github.com/applications/Iv1.client/token'
    )
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE')

    fetchMock.mockRejectedValueOnce(new Error('network'))
    await expect(revokeAppUserToken('ghu_x')).resolves.toBeUndefined()
  })
})
