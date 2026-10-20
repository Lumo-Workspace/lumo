import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth/identity'
import { serviceErrorResponse, zodError } from '@/lib/api/helpers'
import { scanContextQuerySchema } from '@/ee/security/validation/security-scan-context'
import {
  checkScanContextRateLimit,
  securityScanContextService,
} from '@/ee/security/services/security-scan-context.service'

export const runtime = 'nodejs'

/** A strong ETag over the exact body served. */
function scanContextEtag(body: string): string {
  return `"${createHash('sha256').update(body).digest('hex').slice(0, 32)}"`
}

/**
 * GET /api/workspaces/me/security-scan/context?repo=owner/name[&branch=b]
 * — LUM-1256: a repository's server context for `lumo security scan`
 * (baseline fingerprints, rulings, learnings in scope, the security
 * policy). Ids and statuses only. Any member may read; the workspace comes
 * from the identity, so a repository of another workspace is a 404.
 * Answers `If-None-Match` with 304 (the CLI caches by ETag). 30 req/min
 * per member.
 */
export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  const params = request.nextUrl.searchParams
  const parsed = scanContextQuerySchema.safeParse({
    repo: params.get('repo') ?? undefined,
    branch: params.get('branch') ?? undefined,
  })
  if (!parsed.success) return zodError(parsed)
  try {
    await checkScanContextRateLimit(
      `${identity.workspaceId}:${identity.memberId}`
    )
    const view = await securityScanContextService.getForRepo(
      identity.workspaceId,
      parsed.data
    )
    const body = JSON.stringify(view)
    const etag = scanContextEtag(body)
    const headers = { ETag: etag, 'Cache-Control': 'private, no-cache' }
    if (request.headers.get('if-none-match') === etag)
      return new NextResponse(null, { status: 304, headers })
    return new NextResponse(body, {
      status: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return serviceErrorResponse(
      error,
      '[GET /api/workspaces/me/security-scan/context]'
    )
  }
}
