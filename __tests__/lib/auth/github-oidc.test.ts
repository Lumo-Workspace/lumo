/** @jest-environment node */
/**
 * LUM-735: GitHub Actions OIDC token verification.
 *
 * Signs real RS256 JWTs with a locally generated RSA key pair and serves the
 * matching public JWK through a mocked `global.fetch`, so the module is
 * exercised end to end (base64url decode → JWKS fetch → Web Crypto verify →
 * claim checks) without touching the network.
 */
import { generateKeyPairSync, sign as nodeSign } from 'node:crypto'
import {
  GITHUB_OIDC_AUDIENCE,
  GITHUB_OIDC_ISSUER,
  GITHUB_OIDC_JWKS_URL,
  __resetJwksCacheForTests,
  looksLikeJwt,
  pullNumberFromRef,
  verifyGithubActionsToken,
} from '@/lib/auth/github-oidc'

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
})
const publicJwk = {
  ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>),
  kid: 'k1',
  alg: 'RS256',
  use: 'sig',
}

const OTHER = generateKeyPairSync('rsa', { modulusLength: 2048 })

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url')
}

const NOW = Date.UTC(2026, 0, 2, 3, 4, 5)
const nowSec = Math.floor(NOW / 1000)

function basePayload(): Record<string, unknown> {
  return {
    iss: GITHUB_OIDC_ISSUER,
    aud: GITHUB_OIDC_AUDIENCE,
    sub: 'repo:acme/widgets:pull_request',
    iat: nowSec - 5,
    nbf: nowSec - 5,
    exp: nowSec + 300,
    repository: 'acme/widgets',
    repository_owner: 'acme',
    ref: 'refs/pull/12/merge',
    sha: 'a'.repeat(40),
    event_name: 'pull_request',
    run_id: '9876543210',
    actor: 'octocat',
  }
}

function makeToken(
  payload: Record<string, unknown> = basePayload(),
  opts: {
    header?: Record<string, unknown>
    key?: Parameters<typeof nodeSign>[2]
    signature?: string
  } = {}
): string {
  const header = opts.header ?? { alg: 'RS256', typ: 'JWT', kid: 'k1' }
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(
    JSON.stringify(payload)
  )}`
  const signature =
    opts.signature ??
    b64url(
      nodeSign('sha256', Buffer.from(signingInput), opts.key ?? privateKey)
    )
  return `${signingInput}.${signature}`
}

let fetchMock: jest.Mock

function jwksResponse(keys: unknown[] = [publicJwk]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ keys }),
  } as unknown as Response
}

beforeEach(() => {
  __resetJwksCacheForTests()
  fetchMock = jest.fn(async () => jwksResponse())
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('looksLikeJwt', () => {
  it('accepts three base64url segments', () => {
    expect(looksLikeJwt('abc.def-ghi._jkl123')).toBe(true)
    expect(looksLikeJwt(makeToken())).toBe(true)
  })

  it('rejects anything else', () => {
    expect(looksLikeJwt('lumo_sk_abcdef')).toBe(false)
    expect(looksLikeJwt('abc.def')).toBe(false)
    expect(looksLikeJwt('abc.def.ghi.jkl')).toBe(false)
    expect(looksLikeJwt('abc.def.gh i')).toBe(false)
    expect(looksLikeJwt('abc..ghi')).toBe(false)
    expect(looksLikeJwt('')).toBe(false)
  })
})

describe('pullNumberFromRef', () => {
  it('extracts the PR number from a merge ref', () => {
    expect(pullNumberFromRef('refs/pull/12/merge')).toBe(12)
    expect(pullNumberFromRef('refs/pull/1/merge')).toBe(1)
  })

  it('returns null for non PR merge refs', () => {
    expect(pullNumberFromRef('refs/heads/main')).toBeNull()
    expect(pullNumberFromRef('refs/pull/12/head')).toBeNull()
    expect(pullNumberFromRef('refs/tags/v1')).toBeNull()
    expect(pullNumberFromRef('refs/pull/abc/merge')).toBeNull()
    expect(pullNumberFromRef('')).toBeNull()
  })
})

describe('verifyGithubActionsToken', () => {
  it('returns the claims for a valid token', async () => {
    const claims = await verifyGithubActionsToken(makeToken(), { now: NOW })

    expect(claims).toEqual({
      repository: 'acme/widgets',
      repositoryOwner: 'acme',
      ref: 'refs/pull/12/merge',
      sha: 'a'.repeat(40),
      eventName: 'pull_request',
      runId: '9876543210',
      actor: 'octocat',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(GITHUB_OIDC_JWKS_URL)
  })

  it('normalises a numeric run_id and a missing actor', async () => {
    const claims = await verifyGithubActionsToken(
      makeToken({ ...basePayload(), run_id: 9876543210, actor: undefined }),
      { now: NOW }
    )

    expect(claims.runId).toBe('9876543210')
    expect(claims.actor).toBeNull()
  })

  it('falls back to the owner segment of repository', async () => {
    const claims = await verifyGithubActionsToken(
      makeToken({ ...basePayload(), repository_owner: undefined }),
      { now: NOW }
    )

    expect(claims.repositoryOwner).toBe('acme')
  })

  it('accepts an audience array containing the audience', async () => {
    const claims = await verifyGithubActionsToken(
      makeToken({ ...basePayload(), aud: ['other', GITHUB_OIDC_AUDIENCE] }),
      { now: NOW }
    )

    expect(claims.repository).toBe('acme/widgets')
  })

  it('honours an audience override', async () => {
    const token = makeToken({ ...basePayload(), aud: 'lumo-staging' })

    await expect(
      verifyGithubActionsToken(token, { now: NOW, audience: 'lumo-staging' })
    ).resolves.toMatchObject({ repository: 'acme/widgets' })
    await expect(
      verifyGithubActionsToken(token, { now: NOW })
    ).rejects.toMatchObject({ status: 401 })
  })

  it('rejects a token signed by a different key', async () => {
    await expect(
      verifyGithubActionsToken(
        makeToken(basePayload(), {
          key: OTHER.privateKey,
        }),
        { now: NOW }
      )
    ).rejects.toMatchObject({ status: 401 })
  })

  it('rejects a tampered payload', async () => {
    const token = makeToken()
    const [h, , s] = token.split('.')
    const forged = `${h}.${b64url(
      JSON.stringify({ ...basePayload(), repository: 'evil/repo' })
    )}.${s}`

    await expect(
      verifyGithubActionsToken(forged, { now: NOW })
    ).rejects.toMatchObject({ status: 401 })
  })

  it('rejects an expired token', async () => {
    await expect(
      verifyGithubActionsToken(
        makeToken({ ...basePayload(), exp: nowSec - 120 }),
        { now: NOW }
      )
    ).rejects.toMatchObject({ status: 401 })
  })

  it('allows a token that expired inside the clock skew window', async () => {
    await expect(
      verifyGithubActionsToken(
        makeToken({ ...basePayload(), exp: nowSec - 30 }),
        { now: NOW }
      )
    ).resolves.toMatchObject({ repository: 'acme/widgets' })
  })

  it('rejects a token that is not valid yet', async () => {
    await expect(
      verifyGithubActionsToken(
        makeToken({ ...basePayload(), nbf: nowSec + 600, iat: nowSec + 600 }),
        { now: NOW }
      )
    ).rejects.toMatchObject({ status: 401 })
  })

  it('rejects a wrong audience', async () => {
    await expect(
      verifyGithubActionsToken(
        makeToken({ ...basePayload(), aud: 'https://github.com/acme' }),
        { now: NOW }
      )
    ).rejects.toMatchObject({ status: 401 })
  })

  it('rejects a wrong issuer', async () => {
    await expect(
      verifyGithubActionsToken(
        makeToken({ ...basePayload(), iss: 'https://evil.example.com' }),
        { now: NOW }
      )
    ).rejects.toMatchObject({ status: 401 })
  })

  it('rejects alg: none', async () => {
    const header = { alg: 'none', typ: 'JWT', kid: 'k1' }
    const signingInput = `${b64url(JSON.stringify(header))}.${b64url(
      JSON.stringify(basePayload())
    )}`

    await expect(
      verifyGithubActionsToken(`${signingInput}.`, { now: NOW })
    ).rejects.toMatchObject({ status: 401 })
    await expect(
      verifyGithubActionsToken(`${signingInput}.AAAA`, { now: NOW })
    ).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a symmetric alg', async () => {
    await expect(
      verifyGithubActionsToken(
        makeToken(basePayload(), {
          header: { alg: 'HS256', typ: 'JWT', kid: 'k1' },
        }),
        { now: NOW }
      )
    ).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a header without kid', async () => {
    await expect(
      verifyGithubActionsToken(
        makeToken(basePayload(), { header: { alg: 'RS256', typ: 'JWT' } }),
        { now: NOW }
      )
    ).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['repository', 'ref', 'sha'])(
    'rejects a token missing the %s claim',
    async claim => {
      const payload = basePayload()
      delete payload[claim]

      await expect(
        verifyGithubActionsToken(makeToken(payload), { now: NOW })
      ).rejects.toMatchObject({ status: 401 })
    }
  )

  it.each([
    ['not a jwt at all', 'lumo_sk_live_abc'],
    ['two segments', 'aaa.bbb'],
    ['non base64url characters', 'aa*a.bbb.ccc'],
    ['a non JSON header', `${b64url('nope')}.${b64url('{}')}.AAAA`],
  ])('rejects %s', async (_label, token) => {
    await expect(
      verifyGithubActionsToken(token, { now: NOW })
    ).rejects.toMatchObject({ status: 401 })
  })

  it('re-fetches once for an unknown kid, then fails with 401', async () => {
    await expect(
      verifyGithubActionsToken(
        makeToken(basePayload(), {
          header: { alg: 'RS256', typ: 'JWT', kid: 'rotated' },
        }),
        { now: NOW }
      )
    ).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not fetch again while the cached key is fresh', async () => {
    await verifyGithubActionsToken(makeToken(), { now: NOW })
    await verifyGithubActionsToken(makeToken(), { now: NOW })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('re-fetches after the cache TTL expires', async () => {
    const realNow = Date.now()
    const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(realNow)

    await verifyGithubActionsToken(makeToken(), { now: NOW })
    dateSpy.mockReturnValue(realNow + 11 * 60 * 1000)
    await verifyGithubActionsToken(makeToken(), { now: NOW })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('ignores JWKS entries that are not RS256 signing keys', async () => {
    fetchMock.mockResolvedValue(
      jwksResponse([
        { kty: 'oct', kid: 'k1', k: 'AAAA' },
        { ...publicJwk, kid: 'k1', alg: 'ES256' },
        { ...publicJwk, kid: 'k1', use: 'enc' },
        { ...publicJwk, kid: 'other' },
      ])
    )

    await expect(
      verifyGithubActionsToken(makeToken(), { now: NOW })
    ).rejects.toMatchObject({ status: 401 })
  })

  it('maps a JWKS network failure to 401', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'))

    await expect(
      verifyGithubActionsToken(makeToken(), { now: NOW })
    ).rejects.toMatchObject({ status: 401 })
  })

  it('maps a non-200 JWKS response to 401', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as unknown as Response)

    await expect(
      verifyGithubActionsToken(makeToken(), { now: NOW })
    ).rejects.toMatchObject({ status: 401 })
  })

  it('maps a malformed JWKS body to 401', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ nope: true }),
    } as unknown as Response)

    await expect(
      verifyGithubActionsToken(makeToken(), { now: NOW })
    ).rejects.toMatchObject({ status: 401 })
  })

  it('defaults `now` to the current clock', async () => {
    const realSec = Math.floor(Date.now() / 1000)

    await expect(
      verifyGithubActionsToken(
        makeToken({
          ...basePayload(),
          iat: realSec - 5,
          nbf: realSec - 5,
          exp: realSec + 300,
        })
      )
    ).resolves.toMatchObject({ repository: 'acme/widgets' })
  })

  it('exposes the GitHub OIDC constants', () => {
    expect(GITHUB_OIDC_ISSUER).toBe(
      'https://token.actions.githubusercontent.com'
    )
    expect(GITHUB_OIDC_JWKS_URL).toBe(
      'https://token.actions.githubusercontent.com/.well-known/jwks'
    )
    expect(GITHUB_OIDC_AUDIENCE).toBe('lumo')
  })
})
