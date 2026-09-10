import { NextRequest, NextResponse } from 'next/server'
import {
  authenticateSarifIngest,
  assertPayloadMatchesPrincipal,
  type SarifIngestPrincipal,
} from '@/lib/auth/sarif-ingest-auth'
import { checkSarifIngestRateLimit } from '@/lib/services/security-sarif-rate-limit'
import { startSecuritySarifIngest } from '@/lib/services/security-sarif-ingest-start'
import {
  sarifCompleteBodySchema,
  expectedSarifPathname,
  pathnameMatches,
  BLOB_HOST_SUFFIX,
} from '@/lib/validation/security-sarif'

export const runtime = 'nodejs'

/**
 * POST /api/integrations/security/sarif/complete — CI calls this once the
 * client upload finishes, as a fallback path to the upload route's
 * `onUploadCompleted` webhook (which may not fire in every deployment
 * environment). Re-validates the blob's pathname the same way the token was
 * scoped and starts the same durable workflow run; a second run of the same
 * report is harmless (ALREADY_PROCESSED or serialized on the scan-row lock).
 */
export async function POST(request: NextRequest) {
  let principal: SarifIngestPrincipal | null
  try {
    principal = await authenticateSarifIngest(request)
  } catch (error) {
    // A bearer that claimed to be a GitHub OIDC token but failed verification.
    if ((error as { status?: unknown } | null)?.status === 401) {
      const message = error instanceof Error ? error.message : 'Unauthorized'
      return NextResponse.json({ error: message }, { status: 401 })
    }
    throw error
  }
  if (!principal) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // LUM-735 review I4: this route starts the same durable run the upload
  // route does, so it needs the same per-caller budget — otherwise a caller
  // that stays inside the upload limit can still loop here and re-run the
  // ingest (blob fetch, diff fetch, DB writes) without bound. Same limiter,
  // same key (the api key id, or the repository on the OIDC path).
  try {
    await checkSarifIngestRateLimit(principal.rateLimitKey)
  } catch (error) {
    if ((error as { status?: unknown } | null)?.status === 429) {
      const message = error instanceof Error ? error.message : 'Rate limited'
      return NextResponse.json({ error: message }, { status: 429 })
    }
    throw error
  }

  let body
  try {
    body = sarifCompleteBodySchema.parse(await request.json())
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  try {
    assertPayloadMatchesPrincipal(principal, body)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Forbidden'
    return NextResponse.json({ error: message }, { status: 403 })
  }

  const parsedUrl = new URL(body.url)
  if (!parsedUrl.hostname.endsWith(BLOB_HOST_SUFFIX)) {
    return NextResponse.json({ error: 'invalid blob host' }, { status: 400 })
  }

  const actual = parsedUrl.pathname.replace(/^\//, '')
  if (!pathnameMatches(actual, expectedSarifPathname(body))) {
    return NextResponse.json({ error: 'pathname mismatch' }, { status: 400 })
  }

  const runId = await startSecuritySarifIngest({
    url: body.url,
    pathname: actual,
    // Key path only: the OIDC token proves a repository, not a workspace,
    // so the workflow resolves ownership from the PullRequest row instead.
    ...(principal.kind === 'key' ? { workspaceId: principal.workspaceId } : {}),
    // On the OIDC path the token's `repository` claim is the canonical
    // spelling — GitHub's own casing — and `assertPayloadMatchesPrincipal`
    // has already proved the body names the same repository (it compares
    // case-insensitively, because the client's `github.repository` may be
    // cased differently). The pathname check above stays on the body: the
    // client built that path from the casing it sent.
    repository:
      principal.kind === 'oidc' ? principal.repository : body.repository,
    headSha: body.headSha,
    prNumber: body.prNumber,
    tool: body.tool,
  })
  if (runId === null) {
    // Surface it: the CI step prints this status, and the report is still
    // in blob storage for a manual re-push.
    return NextResponse.json(
      { error: 'ingest could not be started' },
      { status: 502 }
    )
  }
  return NextResponse.json({ accepted: true, runId }, { status: 202 })
}
