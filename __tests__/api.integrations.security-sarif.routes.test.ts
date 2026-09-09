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
 * Binding security requirement under test throughout: `workspaceId` in every
 * dispatched job comes from the authenticated key's `identity.workspace.id`,
 * never from the request body or the client's own payload.
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
import { checkSarifIngestRateLimit } from '@/lib/services/security-sarif-rate-limit'
import { dispatchSecuritySarifIngest } from '@/lib/services/security-sarif-ingest-dispatch'
import { securitySarifIngestService } from '@/lib/services/security-sarif-ingest.service'
import {
  expectedSarifPathname,
  pathnameMatches,
} from '@/lib/validation/security-sarif'

const mockedVerifyBearer = verifyBearer as jest.Mock
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

const makeReq = (
  bodyOrFn: unknown | (() => unknown),
  auth: string | null = null
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
      workspaceId: 'w1',
      ...PAYLOAD,
    })
    // The blob SDK needs the raw request to verify its own signed callback —
    // handleUpload must be called with it, not just `body`.
    expect(mockedHandleUpload).toHaveBeenCalledWith(
      expect.objectContaining({ request: expect.anything() })
    )
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
    const tokenPayload = JSON.stringify({ workspaceId: 'w1', ...PAYLOAD })
    const body = {
      type: 'blob.upload-completed',
      payload: {
        blob: {
          url: 'https://blob.example/security-sarif/o--r/abc1234/semgrep-Ab12.sarif.gz',
          pathname: 'security-sarif/o--r/abc1234/semgrep-Ab12.sarif.gz',
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

  it('responds without waiting for the worker even if dispatch never resolves', async () => {
    mockedDispatch.mockReturnValue(new Promise(() => {}))
    const tokenPayload = JSON.stringify({ workspaceId: 'w1', ...PAYLOAD })
    const body = {
      type: 'blob.upload-completed',
      payload: {
        blob: {
          url: 'https://blob.example/security-sarif/o--r/abc1234/semgrep-Ab12.sarif.gz',
          pathname: 'security-sarif/o--r/abc1234/semgrep-Ab12.sarif.gz',
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
    'https://xyz123.public.blob.vercel-storage.com/security-sarif/o--r/abc1234/semgrep-Ab12.sarif.gz'

  it('accepts a valid body with a matching (suffixed) pathname and dispatches without a leading slash', async () => {
    const res = await completePOST(makeReq(() => ({ ...PAYLOAD, url })))
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ accepted: true })
    expect(mockedDispatch).toHaveBeenCalledWith({
      url,
      pathname: 'security-sarif/o--r/abc1234/semgrep-Ab12.sarif.gz',
      workspaceId: 'w1',
      ...PAYLOAD,
    })
  })

  it('dispatches via waitUntil without awaiting the worker', async () => {
    mockedDispatch.mockReturnValue(new Promise(() => {}))
    const res = await completePOST(makeReq(() => ({ ...PAYLOAD, url })))
    expect(res.status).toBe(202)
    expect(mockedWaitUntil).toHaveBeenCalledWith(expect.any(Promise))
  })

  it('rejects a url whose pathname does not match the payload with 400 and does not dispatch', async () => {
    const wrongUrl =
      'https://xyz123.public.blob.vercel-storage.com/security-sarif/o--r/deadbeef/semgrep-Ab12.sarif.gz'
    const res = await completePOST(
      makeReq(() => ({ ...PAYLOAD, url: wrongUrl }))
    )
    expect(res.status).toBe(400)
    expect(mockedDispatch).not.toHaveBeenCalled()
  })

  it('rejects a url whose host is not a vercel blob storage host with 400 and does not dispatch', async () => {
    const evilUrl =
      'https://evil.example/security-sarif/o--r/abc1234/semgrep-Ab12.sarif.gz'
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
})

describe('pathnameMatches', () => {
  const expected = 'security-sarif/o--r/abc1234/semgrep.sarif.gz'

  it('matches a genuine addRandomSuffix suffix (mixed-case alphanumeric)', () => {
    expect(
      pathnameMatches(
        'security-sarif/o--r/abc1234/semgrep-Ab12.sarif.gz',
        expected
      )
    ).toBe(true)
  })

  it('does not match a lowercase-only tail that is actually a different (longer) tool slug', () => {
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

  it('rejects an invalid body with 400', async () => {
    const res = await ingestPOST(
      makeReq(() => ({ ...job, workspaceId: undefined }), 'Bearer secret')
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
