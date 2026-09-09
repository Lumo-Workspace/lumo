/**
 * @jest-environment node
 *
 * LUM-735 — the four SARIF ingest routes (spec §6-9):
 *   - POST /api/integrations/security/sarif/upload: @vercel/blob/client
 *     handleUpload wrapper — mints a scoped upload token, then dispatches
 *     the worker from onUploadCompleted.
 *   - POST /api/integrations/security/sarif/complete: fallback dispatch path
 *     for environments where the blob store's own webhook doesn't fire.
 *   - POST /api/internal/security-sarif-ingest: the foreground worker itself
 *     (self-call only, gated by CRON_SECRET).
 *   - GET /api/cron/prune-security-sarif: daily stale-blob sweep.
 *
 * Binding security requirement under test throughout: on the ApiKey path,
 * `workspaceId` in every dispatched job comes from the authenticated key's
 * `identity.workspace.id`, never from the request body or the client's own
 * payload. On the GitHub OIDC path there is no `workspaceId` at all — the
 * token pins repository + PR, and the worker derives the workspace from the
 * `PullRequest` row. Only the two verifiers are mocked, so the real bearer
 * split (lib/auth/sarif-ingest-auth) runs inside these routes.
 */
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn(p => p) }))
jest.mock('@vercel/blob/client', () => ({
  handleUpload: jest.fn(
    async ({
      body,
      onBeforeGenerateToken,
      onUploadCompleted,
    }: {
      body: {
        type: string
        payload: {
          pathname: string
          clientPayload: string | null
          blob?: { url: string; pathname: string }
          tokenPayload?: string | null
        }
      }
      onBeforeGenerateToken: (
        ...args: [string, string | null, boolean]
      ) => Promise<unknown>
      onUploadCompleted: (payload: unknown) => Promise<void>
    }) =>
      body.type === 'blob.generate-client-token'
        ? {
            type: 'blob.generate-client-token',
            clientToken: 'tok',
            _opts: await onBeforeGenerateToken(
              body.payload.pathname,
              body.payload.clientPayload,
              false
            ),
          }
        : (await onUploadCompleted(body.payload),
          { type: 'blob.upload-completed', response: 'ok' })
  ),
}))
jest.mock('@/lib/auth/bearer', () => ({ verifyBearer: jest.fn() }))
jest.mock('@/lib/auth/github-oidc', () => ({
  ...jest.requireActual('@/lib/auth/github-oidc'),
  verifyGithubActionsToken: jest.fn(),
}))
jest.mock('@/lib/services/security-sarif-rate-limit', () => ({
  checkSarifIngestRateLimit: jest.fn(),
}))
jest.mock('@/lib/services/security-sarif-ingest-dispatch', () => ({
  dispatchSecuritySarifIngest: jest.fn(),
}))
jest.mock('@/lib/services/security-sarif-ingest.service', () => ({
  securitySarifIngestService: { ingest: jest.fn(), pruneStaleBlobs: jest.fn() },
  SARIF_MAX_GZ_BYTES: 100 * 1024 * 1024,
}))
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}))

import { POST as uploadPOST } from '@/app/api/integrations/security/sarif/upload/route'
import { POST as completePOST } from '@/app/api/integrations/security/sarif/complete/route'
import { POST as ingestPOST } from '@/app/api/internal/security-sarif-ingest/route'
import { GET as pruneGET } from '@/app/api/cron/prune-security-sarif/route'
import { waitUntil } from '@vercel/functions'
import { handleUpload } from '@vercel/blob/client'
import { verifyBearer } from '@/lib/auth/bearer'
import { verifyGithubActionsToken } from '@/lib/auth/github-oidc'
import { checkSarifIngestRateLimit } from '@/lib/services/security-sarif-rate-limit'
import { dispatchSecuritySarifIngest } from '@/lib/services/security-sarif-ingest-dispatch'
import { securitySarifIngestService } from '@/lib/services/security-sarif-ingest.service'
import {
  expectedSarifPathname,
  pathnameMatches,
} from '@/lib/validation/security-sarif'

const mockedVerifyBearer = verifyBearer as jest.Mock
const mockedVerifyOidc = verifyGithubActionsToken as jest.Mock
const mockedRateLimit = checkSarifIngestRateLimit as jest.Mock
const mockedDispatch = dispatchSecuritySarifIngest as jest.Mock
const mockedIngest = securitySarifIngestService.ingest as jest.Mock
const mockedPrune = securitySarifIngestService.pruneStaleBlobs as jest.Mock
const mockedWaitUntil = waitUntil as jest.Mock
const mockedHandleUpload = handleUpload as jest.Mock

const IDENTITY = {
  user: { id: 'u1' },
  workspace: { id: 'w1', slug: 'acme', name: 'Acme' },
  apiKey: { id: 'k1', name: 'ci', prefix: 'lumo_' },
}

const PAYLOAD = {
  repository: 'o/r',
  headSha: 'abc1234',
  prNumber: 42,
  tool: 'semgrep',
}

/** Three base64url segments — shaped like a JWT; contents never parsed here. */
const OIDC_BEARER = 'Bearer aGVhZGVy.cGF5bG9hZA.c2ln'
/** GitHub spells the repo with its own casing; the payload's is lowercase. */
const CLAIMS = {
  repository: 'O/R',
  repositoryOwner: 'O',
  ref: 'refs/pull/42/merge',
  sha: 'mergecommit1234567',
  eventName: 'pull_request',
  runId: '1',
  actor: 'octocat',
}

const makeReq = (
  bodyOrFn: unknown | (() => unknown),
  // Default: an ApiKey-shaped bearer, so the ingest routes take the
  // verifyBearer branch (mocked to IDENTITY below) unless a test opts into
  // the JWT-shaped OIDC bearer.
  auth: string | null = 'Bearer lumo_ci_key'
) =>
  ({
    headers: {
      get: (k: string) => (k.toLowerCase() === 'authorization' ? auth : null),
    },
    json: async () => {
      if (typeof bodyOrFn === 'function') return (bodyOrFn as () => unknown)()
      return bodyOrFn
    },
  }) as never

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CRON_SECRET = 'secret'
  mockedVerifyBearer.mockResolvedValue(IDENTITY)
  mockedVerifyOidc.mockResolvedValue(CLAIMS)
  mockedRateLimit.mockResolvedValue(undefined)
  // A real dispatch call returns a Promise; default it here so tests that
  // assert waitUntil received "the dispatch promise" observe an actual
  // Promise object rather than plain `undefined`.
  mockedDispatch.mockResolvedValue(undefined)
})

describe('POST /api/integrations/security/sarif/upload', () => {
  it('rejects with 401 when verifyBearer returns null, scoped to security:ingest', async () => {
    mockedVerifyBearer.mockResolvedValue(null)
    const body = {
      type: 'blob.generate-client-token',
      payload: {
        pathname: 'irrelevant',
        clientPayload: null,
        multipart: false,
      },
    }
    const res = await uploadPOST(makeReq(() => body))
    expect(res.status).toBe(401)
    expect(mockedVerifyBearer).toHaveBeenCalledWith(expect.anything(), {
      allowScopes: ['security:ingest'],
    })
  })

  it('issues a scoped token for a valid payload + matching pathname', async () => {
    const pathname = expectedSarifPathname(PAYLOAD)
    const body = {
      type: 'blob.generate-client-token',
      payload: {
        pathname,
        clientPayload: JSON.stringify(PAYLOAD),
        multipart: false,
      },
    }
    const res = await uploadPOST(makeReq(() => body))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json._opts.allowedContentTypes).toEqual(['application/gzip'])
    expect(json._opts.maximumSizeInBytes).toBe(104857600)
    expect(json._opts.addRandomSuffix).toBe(true)
    expect(JSON.parse(json._opts.tokenPayload)).toEqual({
      auth: 'key',
      workspaceId: 'w1',
      ...PAYLOAD,
    })
    expect(mockedRateLimit).toHaveBeenCalledWith('k1')
    expect(mockedVerifyOidc).not.toHaveBeenCalled()
    // The blob SDK needs the raw request to verify its own signed callback —
    // handleUpload must be called with it, not just `body`.
    expect(mockedHandleUpload).toHaveBeenCalledWith(
      expect.objectContaining({ request: expect.anything() })
    )
  })

  it('routes a JWT-shaped bearer to OIDC and mints a workspace-free token payload', async () => {
    const pathname = expectedSarifPathname(PAYLOAD)
    const body = {
      type: 'blob.generate-client-token',
      payload: {
        pathname,
        clientPayload: JSON.stringify(PAYLOAD),
        multipart: false,
      },
    }
    const res = await uploadPOST(makeReq(() => body, OIDC_BEARER))
    expect(res.status).toBe(200)
    expect(mockedVerifyOidc).toHaveBeenCalledTimes(1)
    expect(mockedVerifyBearer).not.toHaveBeenCalled()
    const json = await res.json()
    // No workspaceId: the worker resolves ownership from the PullRequest row.
    // `repository` is the token's own casing, not the client payload's — the
    // claim is what GitHub says the repo is called.
    expect(JSON.parse(json._opts.tokenPayload)).toEqual({
      auth: 'oidc',
      ...PAYLOAD,
      repository: 'O/R',
    })
    // Rate-limited per repository, not per api key.
    expect(mockedRateLimit).toHaveBeenCalledWith('oidc:o/r')
  })

  it('carries the OIDC claim casing of the repository into the token payload', async () => {
    mockedVerifyOidc.mockResolvedValue({
      ...CLAIMS,
      repository: 'Acme/Widgets',
      repositoryOwner: 'Acme',
    })
    const payload = { ...PAYLOAD, repository: 'acme/widgets' }
    const body = {
      type: 'blob.generate-client-token',
      payload: {
        // The client built the pathname from its own `github.repository`, so
        // the pathname check still runs against the payload's casing.
        pathname: expectedSarifPathname(payload),
        clientPayload: JSON.stringify(payload),
        multipart: false,
      },
    }
    const res = await uploadPOST(makeReq(() => body, OIDC_BEARER))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(JSON.parse(json._opts.tokenPayload).repository).toBe('Acme/Widgets')
  })

  it('rejects a payload whose repository/prNumber contradict the token with 403', async () => {
    const other = { ...PAYLOAD, repository: 'evil/repo' }
    const body = {
      type: 'blob.generate-client-token',
      payload: {
        pathname: expectedSarifPathname(other),
        clientPayload: JSON.stringify(other),
        multipart: false,
      },
    }
    const res = await uploadPOST(makeReq(() => body, OIDC_BEARER))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: 'payload does not match the workflow identity',
    })
  })

  it('rejects a payload for another PR in the same repository with 403', async () => {
    const otherPr = { ...PAYLOAD, prNumber: 43 }
    const body = {
      type: 'blob.generate-client-token',
      payload: {
        pathname: expectedSarifPathname(otherPr),
        clientPayload: JSON.stringify(otherPr),
        multipart: false,
      },
    }
    const res = await uploadPOST(makeReq(() => body, OIDC_BEARER))
    expect(res.status).toBe(403)
  })

  it('maps a failed OIDC verification to 401', async () => {
    mockedVerifyOidc.mockRejectedValue(
      Object.assign(new Error('token expired'), { status: 401 })
    )
    const body = {
      type: 'blob.generate-client-token',
      payload: {
        pathname: expectedSarifPathname(PAYLOAD),
        clientPayload: JSON.stringify(PAYLOAD),
        multipart: false,
      },
    }
    const res = await uploadPOST(makeReq(() => body, OIDC_BEARER))
    expect(res.status).toBe(401)
  })

  it('rejects malformed JSON with 400 through the route error mapping', async () => {
    const res = await uploadPOST(
      makeReq(() => {
        throw new SyntaxError('Unexpected token')
      })
    )
    expect(res.status).toBe(400)
    expect(mockedHandleUpload).not.toHaveBeenCalled()
  })

  it('rejects a pathname that does not match the payload with 400', async () => {
    const body = {
      type: 'blob.generate-client-token',
      payload: {
        pathname: 'security-sarif/wrong--repo/deadbeef/semgrep.sarif.gz',
        clientPayload: JSON.stringify(PAYLOAD),
        multipart: false,
      },
    }
    const res = await uploadPOST(makeReq(() => body))
    expect(res.status).toBe(400)
  })

  it('rejects a clientPayload failing schema validation (missing prNumber) with 400', async () => {
    const { prNumber: _prNumber, ...withoutPrNumber } = PAYLOAD
    void _prNumber
    const pathname = expectedSarifPathname(PAYLOAD)
    const body = {
      type: 'blob.generate-client-token',
      payload: {
        pathname,
        clientPayload: JSON.stringify(withoutPrNumber),
        multipart: false,
      },
    }
    const res = await uploadPOST(makeReq(() => body))
    expect(res.status).toBe(400)
  })

  it('propagates a rate-limit rejection as 429', async () => {
    mockedRateLimit.mockRejectedValue(
      Object.assign(new Error('Rate limit exceeded'), { status: 429 })
    )
    const pathname = expectedSarifPathname(PAYLOAD)
    const body = {
      type: 'blob.generate-client-token',
      payload: {
        pathname,
        clientPayload: JSON.stringify(PAYLOAD),
        multipart: false,
      },
    }
    const res = await uploadPOST(makeReq(() => body))
    expect(res.status).toBe(429)
  })

  it('dispatches the ingest job from onUploadCompleted using ONLY tokenPayload fields', async () => {
    const tokenPayload = JSON.stringify({
      auth: 'key',
      workspaceId: 'w1',
      ...PAYLOAD,
    })
    const body = {
      type: 'blob.upload-completed',
      payload: {
        blob: {
          url: 'https://blob.example/security-sarif/o--r/abc1234/semgrep-a1b2c3d4e5f6g7h8.sarif.gz',
          pathname:
            'security-sarif/o--r/abc1234/semgrep-a1b2c3d4e5f6g7h8.sarif.gz',
        },
        tokenPayload,
      },
    }
    const res = await uploadPOST(makeReq(() => body))
    expect(res.status).toBe(200)
    expect(mockedDispatch).toHaveBeenCalledWith({
      url: body.payload.blob.url,
      pathname: body.payload.blob.pathname,
      workspaceId: 'w1',
      ...PAYLOAD,
    })
    expect(mockedWaitUntil).toHaveBeenCalledWith(
      mockedDispatch.mock.results[0]!.value
    )
  })

  it('dispatches an OIDC-minted tokenPayload without any workspaceId', async () => {
    const tokenPayload = JSON.stringify({ auth: 'oidc', ...PAYLOAD })
    const body = {
      type: 'blob.upload-completed',
      payload: {
        blob: {
          url: 'https://blob.example/security-sarif/o--r/abc1234/semgrep-a1b2c3d4e5f6g7h8.sarif.gz',
          pathname:
            'security-sarif/o--r/abc1234/semgrep-a1b2c3d4e5f6g7h8.sarif.gz',
        },
        tokenPayload,
      },
    }
    const res = await uploadPOST(makeReq(() => body, OIDC_BEARER))
    expect(res.status).toBe(200)
    expect(mockedDispatch).toHaveBeenCalledWith({
      url: body.payload.blob.url,
      pathname: body.payload.blob.pathname,
      ...PAYLOAD,
    })
    expect(mockedDispatch.mock.calls[0]![0]).not.toHaveProperty('workspaceId')
  })

  // Deploy-window compatibility: a token minted by the previous deployment
  // has no `auth` field, and its upload can complete after the new code is
  // live. The shape still says which path minted it.
  it('dispatches a legacy tokenPayload with no auth field but a workspaceId', async () => {
    const tokenPayload = JSON.stringify({ workspaceId: 'w1', ...PAYLOAD })
    const body = {
      type: 'blob.upload-completed',
      payload: {
        blob: {
          url: 'https://blob.example/security-sarif/o--r/abc1234/semgrep-a1b2c3d4e5f6g7h8.sarif.gz',
          pathname:
            'security-sarif/o--r/abc1234/semgrep-a1b2c3d4e5f6g7h8.sarif.gz',
        },
        tokenPayload,
      },
    }
    const res = await uploadPOST(makeReq(() => body))
    expect(res.status).toBe(200)
    expect(mockedDispatch).toHaveBeenCalledWith({
      url: body.payload.blob.url,
      pathname: body.payload.blob.pathname,
      workspaceId: 'w1',
      ...PAYLOAD,
    })
  })

  it('dispatches a legacy tokenPayload with no auth field and no workspaceId', async () => {
    const tokenPayload = JSON.stringify({ ...PAYLOAD })
    const body = {
      type: 'blob.upload-completed',
      payload: {
        blob: {
          url: 'https://blob.example/security-sarif/o--r/abc1234/semgrep-a1b2c3d4e5f6g7h8.sarif.gz',
          pathname:
            'security-sarif/o--r/abc1234/semgrep-a1b2c3d4e5f6g7h8.sarif.gz',
        },
        tokenPayload,
      },
    }
    const res = await uploadPOST(makeReq(() => body, OIDC_BEARER))
    expect(res.status).toBe(200)
    expect(mockedDispatch).toHaveBeenCalledWith({
      url: body.payload.blob.url,
      pathname: body.payload.blob.pathname,
      ...PAYLOAD,
    })
    expect(mockedDispatch.mock.calls[0]![0]).not.toHaveProperty('workspaceId')
  })

  it('responds without waiting for the worker even if dispatch never resolves', async () => {
    mockedDispatch.mockReturnValue(new Promise(() => {}))
    const tokenPayload = JSON.stringify({
      auth: 'key',
      workspaceId: 'w1',
      ...PAYLOAD,
    })
    const body = {
      type: 'blob.upload-completed',
      payload: {
        blob: {
          url: 'https://blob.example/security-sarif/o--r/abc1234/semgrep-a1b2c3d4e5f6g7h8.sarif.gz',
          pathname:
            'security-sarif/o--r/abc1234/semgrep-a1b2c3d4e5f6g7h8.sarif.gz',
        },
        tokenPayload,
      },
    }
    const res = await uploadPOST(makeReq(() => body))
    expect(res.status).toBe(200)
    expect(mockedWaitUntil).toHaveBeenCalledWith(expect.any(Promise))
  })

  it('skips dispatch (still 200) when tokenPayload is missing', async () => {
    const body = {
      type: 'blob.upload-completed',
      payload: {
        blob: { url: 'https://blob.example/x', pathname: 'x' },
        tokenPayload: null,
      },
    }
    const res = await uploadPOST(makeReq(() => body))
    expect(res.status).toBe(200)
    expect(mockedDispatch).not.toHaveBeenCalled()
  })
})

describe('POST /api/integrations/security/sarif/complete', () => {
  const url =
    'https://xyz123.public.blob.vercel-storage.com/security-sarif/o--r/abc1234/semgrep-a1b2c3d4e5f6g7h8.sarif.gz'

  it('accepts a valid body with a matching (suffixed) pathname and dispatches without a leading slash', async () => {
    const res = await completePOST(makeReq(() => ({ ...PAYLOAD, url })))
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ accepted: true })
    expect(mockedDispatch).toHaveBeenCalledWith({
      url,
      pathname: 'security-sarif/o--r/abc1234/semgrep-a1b2c3d4e5f6g7h8.sarif.gz',
      workspaceId: 'w1',
      ...PAYLOAD,
    })
  })

  it('dispatches without a workspaceId on the OIDC path', async () => {
    const res = await completePOST(
      makeReq(() => ({ ...PAYLOAD, url }), OIDC_BEARER)
    )
    expect(res.status).toBe(202)
    expect(mockedVerifyOidc).toHaveBeenCalledTimes(1)
    expect(mockedVerifyBearer).not.toHaveBeenCalled()
    expect(mockedRateLimit).toHaveBeenCalledWith('oidc:o/r')
    expect(mockedDispatch).toHaveBeenCalledWith({
      url,
      pathname: 'security-sarif/o--r/abc1234/semgrep-a1b2c3d4e5f6g7h8.sarif.gz',
      ...PAYLOAD,
      // GitHub's own casing from the claim, not the body's.
      repository: 'O/R',
    })
    expect(mockedDispatch.mock.calls[0]![0]).not.toHaveProperty('workspaceId')
  })

  it('dispatches the OIDC claim casing of the repository', async () => {
    mockedVerifyOidc.mockResolvedValue({
      ...CLAIMS,
      repository: 'Acme/Widgets',
      repositoryOwner: 'Acme',
    })
    const acmeUrl =
      'https://xyz123.public.blob.vercel-storage.com/security-sarif/acme--widgets/abc1234/semgrep-a1b2c3d4e5f6g7h8.sarif.gz'
    const res = await completePOST(
      makeReq(
        () => ({ ...PAYLOAD, repository: 'acme/widgets', url: acmeUrl }),
        OIDC_BEARER
      )
    )
    expect(res.status).toBe(202)
    expect(mockedDispatch.mock.calls[0]![0]).toMatchObject({
      repository: 'Acme/Widgets',
    })
  })

  it('keeps the body casing of the repository on the api key path', async () => {
    const res = await completePOST(makeReq(() => ({ ...PAYLOAD, url })))
    expect(res.status).toBe(202)
    expect(mockedDispatch.mock.calls[0]![0]).toMatchObject({
      repository: 'o/r',
      workspaceId: 'w1',
    })
  })

  it('rejects a body contradicting the OIDC token with 403 and does not dispatch', async () => {
    mockedVerifyOidc.mockResolvedValue({ ...CLAIMS, ref: 'refs/pull/99/merge' })
    const res = await completePOST(
      makeReq(() => ({ ...PAYLOAD, url }), OIDC_BEARER)
    )
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: 'payload does not match the workflow identity',
    })
    expect(mockedDispatch).not.toHaveBeenCalled()
  })

  it('maps a failed OIDC verification to 401 and does not dispatch', async () => {
    mockedVerifyOidc.mockRejectedValue(
      Object.assign(new Error('bad signature'), { status: 401 })
    )
    const res = await completePOST(
      makeReq(() => ({ ...PAYLOAD, url }), OIDC_BEARER)
    )
    expect(res.status).toBe(401)
    expect(mockedDispatch).not.toHaveBeenCalled()
  })

  it('dispatches via waitUntil without awaiting the worker', async () => {
    mockedDispatch.mockReturnValue(new Promise(() => {}))
    const res = await completePOST(makeReq(() => ({ ...PAYLOAD, url })))
    expect(res.status).toBe(202)
    expect(mockedWaitUntil).toHaveBeenCalledWith(expect.any(Promise))
  })

  it('rejects a url whose pathname does not match the payload with 400 and does not dispatch', async () => {
    const wrongUrl =
      'https://xyz123.public.blob.vercel-storage.com/security-sarif/o--r/deadbeef/semgrep-a1b2c3d4e5f6g7h8.sarif.gz'
    const res = await completePOST(
      makeReq(() => ({ ...PAYLOAD, url: wrongUrl }))
    )
    expect(res.status).toBe(400)
    expect(mockedDispatch).not.toHaveBeenCalled()
  })

  it('rejects a url whose host is not a vercel blob storage host with 400 and does not dispatch', async () => {
    const evilUrl =
      'https://evil.example/security-sarif/o--r/abc1234/semgrep-a1b2c3d4e5f6g7h8.sarif.gz'
    const res = await completePOST(
      makeReq(() => ({ ...PAYLOAD, url: evilUrl }))
    )
    expect(res.status).toBe(400)
    expect(mockedDispatch).not.toHaveBeenCalled()
  })

  it('rejects a missing bearer with 401', async () => {
    mockedVerifyBearer.mockResolvedValue(null)
    const res = await completePOST(makeReq(() => ({ ...PAYLOAD, url })))
    expect(res.status).toBe(401)
    expect(mockedDispatch).not.toHaveBeenCalled()
  })

  it('rejects a body with an extra field with 400', async () => {
    const res = await completePOST(
      makeReq(() => ({ ...PAYLOAD, url, extra: 'nope' }))
    )
    expect(res.status).toBe(400)
    expect(mockedDispatch).not.toHaveBeenCalled()
  })

  it('rate-limits per api key and maps the 429 through', async () => {
    // LUM-735 review I4: the upload route is rate-limited, but /complete
    // dispatches the SAME worker job on its own — an unlimited loop here
    // re-runs the ingest (blob fetch, diff fetch, DB writes) as fast as CI
    // can call it while upload stays inside its budget.
    mockedRateLimit.mockRejectedValueOnce(
      Object.assign(new Error('rate limited'), { status: 429 })
    )
    const res = await completePOST(makeReq(() => ({ ...PAYLOAD, url })))
    expect(res.status).toBe(429)
    expect(mockedRateLimit).toHaveBeenCalledWith('k1')
    expect(mockedDispatch).not.toHaveBeenCalled()
  })

  it('does not spend a rate-limit token before the bearer is verified', async () => {
    mockedVerifyBearer.mockResolvedValue(null)
    const res = await completePOST(makeReq(() => ({ ...PAYLOAD, url })))
    expect(res.status).toBe(401)
    expect(mockedRateLimit).not.toHaveBeenCalled()
  })
})

describe('pathnameMatches', () => {
  const expected = 'security-sarif/o--r/abc1234/semgrep.sarif.gz'

  it('matches an exact pathname', () => {
    expect(pathnameMatches(expected, expected)).toBe(true)
  })

  it('matches a genuine addRandomSuffix suffix, even all-lowercase/digits', () => {
    // Vercel's `addRandomSuffix` is generated server-side and opaque to this
    // repo — it must not be assumed to always mix case.
    expect(
      pathnameMatches(
        'security-sarif/o--r/abc1234/semgrep-abcdefghijklmnop.sarif.gz',
        expected
      )
    ).toBe(true)
  })

  it('does not match a short tail that is actually a different (shorter) tool slug', () => {
    // `semgrep-oss` is itself a valid, distinct tool slug (see toolSlug() /
    // the ingest service tests) — it must never be accepted as "semgrep" +
    // a random suffix just because it happens to share the "semgrep-" prefix.
    expect(
      pathnameMatches(
        'security-sarif/o--r/abc1234/semgrep-oss.sarif.gz',
        expected
      )
    ).toBe(false)
  })

  it('does not match a short tail even if it mixes case', () => {
    expect(
      pathnameMatches(
        'security-sarif/o--r/abc1234/semgrep-Ab3.sarif.gz',
        expected
      )
    ).toBe(false)
  })
})

describe('POST /api/internal/security-sarif-ingest', () => {
  const job = {
    url: 'https://blob.example.com/security-sarif/o--r/abc1234/semgrep.sarif.gz',
    pathname: 'security-sarif/o--r/abc1234/semgrep.sarif.gz',
    workspaceId: 'w1',
    ...PAYLOAD,
  }

  it('rejects a request without the CRON_SECRET bearer with 401', async () => {
    const res = await ingestPOST(makeReq(() => job, null))
    expect(res.status).toBe(401)
    expect(mockedIngest).not.toHaveBeenCalled()
  })

  it('runs ingest() with the parsed job and echoes its result as 200', async () => {
    mockedIngest.mockResolvedValue({
      outcome: 'INGESTED',
      scanId: 's1',
      findings: 3,
      partial: false,
    })
    const res = await ingestPOST(makeReq(() => job, 'Bearer secret'))
    expect(res.status).toBe(200)
    expect(mockedIngest).toHaveBeenCalledWith(job)
    expect(await res.json()).toEqual({
      outcome: 'INGESTED',
      scanId: 's1',
      findings: 3,
      partial: false,
    })
  })

  it('accepts a job without a workspaceId (the OIDC path)', async () => {
    const { workspaceId: _w, ...oidcJob } = job
    void _w
    mockedIngest.mockResolvedValue({ outcome: 'ALREADY_PROCESSED' })
    const res = await ingestPOST(makeReq(() => oidcJob, 'Bearer secret'))
    expect(res.status).toBe(200)
    expect(mockedIngest).toHaveBeenCalledWith(oidcJob)
  })

  it('rejects an invalid body with 400', async () => {
    const res = await ingestPOST(
      makeReq(() => ({ ...job, prNumber: undefined }), 'Bearer secret')
    )
    expect(res.status).toBe(400)
    expect(mockedIngest).not.toHaveBeenCalled()
  })

  it('rejects an empty-string workspaceId with 400', async () => {
    const res = await ingestPOST(
      makeReq(() => ({ ...job, workspaceId: '' }), 'Bearer secret')
    )
    expect(res.status).toBe(400)
    expect(mockedIngest).not.toHaveBeenCalled()
  })
})

describe('GET /api/cron/prune-security-sarif', () => {
  it('rejects a request without the CRON_SECRET bearer with 401', async () => {
    const res = await pruneGET(makeReq(null, null))
    expect(res.status).toBe(401)
    expect(mockedPrune).not.toHaveBeenCalled()
  })

  it('runs pruneStaleBlobs() and returns its result as 200', async () => {
    mockedPrune.mockResolvedValue({ deleted: 3, failed: 0 })
    const res = await pruneGET(makeReq(null, 'Bearer secret'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deleted: 3, failed: 0 })
  })
})
