/**
 * @jest-environment node
 *
 * LUM-735 — the SARIF ingest bearer split. A GitHub Actions OIDC ID token and
 * a `security:ingest` ApiKey both arrive as `Authorization: Bearer <token>`;
 * this module decides which verifier sees it, and what the caller is allowed
 * to claim afterwards. Both verifiers are mocked here — their own correctness
 * lives in github-oidc.test.ts / bearer.test.ts — so what is under test is the
 * routing itself and the principal it produces.
 */
jest.mock('@/lib/auth/bearer', () => ({ verifyBearer: jest.fn() }))
jest.mock('@/ee/security/auth/github-oidc', () => ({
  ...jest.requireActual('@/ee/security/auth/github-oidc'),
  verifyGithubActionsToken: jest.fn(),
}))

import {
  authenticateSarifIngest,
  assertPayloadMatchesPrincipal,
  type SarifIngestPrincipal,
} from '@/ee/security/auth/sarif-ingest-auth'
import { verifyBearer } from '@/lib/auth/bearer'
import { verifyGithubActionsToken } from '@/ee/security/auth/github-oidc'

const mockedVerifyBearer = verifyBearer as jest.Mock
const mockedVerifyOidc = verifyGithubActionsToken as jest.Mock

/** Three base64url segments — shaped like a JWT, contents irrelevant (mocked). */
const JWT = 'aGVhZGVy.cGF5bG9hZA.c2ln'

const CLAIMS = {
  repository: 'Owner/Repo',
  repositoryOwner: 'Owner',
  ref: 'refs/pull/42/merge',
  sha: 'mergecommit1234567',
  eventName: 'pull_request',
  runId: '1',
  actor: 'octocat',
}

const IDENTITY = {
  user: { id: 'u1' },
  workspace: { id: 'w1', slug: 'acme', name: 'Acme' },
  apiKey: { id: 'k1', name: 'ci', prefix: 'lumo_' },
}

const makeReq = (auth: string | null) =>
  ({
    headers: {
      get: (k: string) => (k.toLowerCase() === 'authorization' ? auth : null),
    },
  }) as unknown as Request

const status = (e: unknown) => (e as { status?: unknown } | null)?.status

beforeEach(() => {
  jest.clearAllMocks()
  mockedVerifyBearer.mockResolvedValue(IDENTITY)
  mockedVerifyOidc.mockResolvedValue(CLAIMS)
})

describe('authenticateSarifIngest', () => {
  it('returns null when the Authorization header is missing', async () => {
    expect(await authenticateSarifIngest(makeReq(null))).toBeNull()
    expect(mockedVerifyOidc).not.toHaveBeenCalled()
    expect(mockedVerifyBearer).not.toHaveBeenCalled()
  })

  it('returns null for a non-bearer scheme or an empty token', async () => {
    expect(await authenticateSarifIngest(makeReq('Basic abc'))).toBeNull()
    expect(await authenticateSarifIngest(makeReq('Bearer   '))).toBeNull()
    expect(mockedVerifyOidc).not.toHaveBeenCalled()
    expect(mockedVerifyBearer).not.toHaveBeenCalled()
  })

  it('routes a JWT-shaped bearer to the OIDC verifier only', async () => {
    const principal = await authenticateSarifIngest(makeReq(`Bearer ${JWT}`))
    expect(mockedVerifyOidc).toHaveBeenCalledWith(JWT)
    expect(mockedVerifyBearer).not.toHaveBeenCalled()
    expect(principal).toEqual({
      kind: 'oidc',
      repository: 'Owner/Repo',
      prNumber: 42,
      rateLimitKey: 'oidc:owner/repo',
    })
  })

  it('matches the bearer scheme case-insensitively (RFC 7235)', async () => {
    const principal = await authenticateSarifIngest(makeReq(`bEaReR ${JWT}`))
    expect(principal).toMatchObject({ kind: 'oidc' })
  })

  it('propagates the OIDC verifier 401 unchanged', async () => {
    mockedVerifyOidc.mockRejectedValue(
      Object.assign(new Error('bad signature'), { status: 401 })
    )
    await expect(
      authenticateSarifIngest(makeReq(`Bearer ${JWT}`))
    ).rejects.toMatchObject({ status: 401, message: 'bad signature' })
  })

  it('rejects a token from a non-pull_request run with 401', async () => {
    mockedVerifyOidc.mockResolvedValue({
      ...CLAIMS,
      eventName: 'push',
      ref: 'refs/heads/main',
    })
    const err = await authenticateSarifIngest(makeReq(`Bearer ${JWT}`)).catch(
      e => e
    )
    expect(status(err)).toBe(401)
    expect(mockedVerifyBearer).not.toHaveBeenCalled()
  })

  it('rejects a pull_request token whose ref is not a PR merge ref with 401', async () => {
    mockedVerifyOidc.mockResolvedValue({ ...CLAIMS, ref: 'refs/heads/main' })
    const err = await authenticateSarifIngest(makeReq(`Bearer ${JWT}`)).catch(
      e => e
    )
    expect(status(err)).toBe(401)
  })

  it('routes a non-JWT bearer to verifyBearer, scoped to security:ingest', async () => {
    const principal = await authenticateSarifIngest(makeReq('Bearer lumo_abc'))
    expect(mockedVerifyOidc).not.toHaveBeenCalled()
    expect(mockedVerifyBearer).toHaveBeenCalledWith(expect.anything(), {
      allowScopes: ['security:ingest'],
    })
    expect(principal).toEqual({
      kind: 'key',
      workspaceId: 'w1',
      apiKeyId: 'k1',
      rateLimitKey: 'k1',
    })
  })

  it('returns null (not a throw) when the api key is unknown or out of scope', async () => {
    mockedVerifyBearer.mockResolvedValue(null)
    expect(await authenticateSarifIngest(makeReq('Bearer lumo_abc'))).toBeNull()
  })
})

describe('assertPayloadMatchesPrincipal', () => {
  const oidc: SarifIngestPrincipal = {
    kind: 'oidc',
    repository: 'Owner/Repo',
    prNumber: 42,
    rateLimitKey: 'oidc:owner/repo',
  }
  const key: SarifIngestPrincipal = {
    kind: 'key',
    workspaceId: 'w1',
    apiKeyId: 'k1',
    rateLimitKey: 'k1',
  }

  it('accepts a payload matching the workflow identity, case-insensitively', () => {
    expect(() =>
      assertPayloadMatchesPrincipal(oidc, {
        repository: 'owner/repo',
        prNumber: 42,
      })
    ).not.toThrow()
  })

  it('rejects a payload naming another repository with 403', () => {
    let err: unknown
    try {
      assertPayloadMatchesPrincipal(oidc, {
        repository: 'other/repo',
        prNumber: 42,
      })
    } catch (e) {
      err = e
    }
    expect(status(err)).toBe(403)
    expect((err as Error).message).toBe(
      'payload does not match the workflow identity'
    )
  })

  it('rejects a payload naming another PR with 403', () => {
    expect(() =>
      assertPayloadMatchesPrincipal(oidc, {
        repository: 'Owner/Repo',
        prNumber: 43,
      })
    ).toThrow('payload does not match the workflow identity')
  })

  it('does not constrain an api-key principal (workspace is the boundary there)', () => {
    expect(() =>
      assertPayloadMatchesPrincipal(key, {
        repository: 'any/repo',
        prNumber: 1,
      })
    ).not.toThrow()
  })
})
