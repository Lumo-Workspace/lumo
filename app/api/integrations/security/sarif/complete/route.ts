import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { verifyBearer } from '@/lib/auth/bearer'
import { SECURITY_INGEST_SCOPE } from '@/lib/services/auth.service'
import { dispatchSecuritySarifIngest } from '@/lib/services/security-sarif-ingest-dispatch'
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
 * scoped and dispatches the SAME worker job; the worker is idempotent
 * (dedupes by scan row), so a double-dispatch from both paths is harmless.
 */
export async function POST(request: NextRequest) {
  const identity = await verifyBearer(request, {
    allowScopes: [SECURITY_INGEST_SCOPE],
  })
  if (!identity) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body
  try {
    body = sarifCompleteBodySchema.parse(await request.json())
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const parsedUrl = new URL(body.url)
  if (!parsedUrl.hostname.endsWith(BLOB_HOST_SUFFIX)) {
    return NextResponse.json({ error: 'invalid blob host' }, { status: 400 })
  }

  const actual = parsedUrl.pathname.replace(/^\//, '')
  if (!pathnameMatches(actual, expectedSarifPathname(body))) {
    return NextResponse.json({ error: 'pathname mismatch' }, { status: 400 })
  }

  // Do NOT await: the worker runs with a 300s budget on its own route: see
  // the matching comment in the upload route's onUploadCompleted.
  waitUntil(
    dispatchSecuritySarifIngest({
      url: body.url,
      pathname: actual,
      workspaceId: identity.workspace.id,
      repository: body.repository,
      headSha: body.headSha,
      prNumber: body.prNumber,
      tool: body.tool,
    })
  )

  return NextResponse.json({ accepted: true }, { status: 202 })
}
