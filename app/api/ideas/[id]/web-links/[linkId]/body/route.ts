import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveIdeaRef } from '@/lib/services/idea-evidence-resolve'
import { ideaWebLinkService } from '@/lib/services/idea-web-link.service'
import { redactWebBodyForInjection } from '@/lib/security-scan/inject-guard'

export const runtime = 'nodejs'
export const maxDuration = 60

type Params = { params: Promise<{ id: string; linkId: string }> }

function errorResponse(err: unknown, route: string) {
  if (err instanceof Error && 'status' in err) {
    return NextResponse.json(
      { error: err.message },
      { status: (err as Error & { status: number }).status }
    )
  }
  console.error(`${route} error:`, err)
  return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
}

/**
 * GET /api/ideas/[id]/web-links/[linkId]/body
 * Tier-2 retrieval for the cheap inline WebLink card (LUM-122), mirrored onto
 * ideas. Returns the cached body when present, otherwise the service fetches
 * it behind the SSRF guard and backfills the row. The service enforces scope
 * (link.workspaceId === workspaceId), throwing 404 on mismatch.
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const { id, linkId } = await params
    await resolveIdeaRef({
      workspaceId: identity.workspaceId,
      ideaRef: id,
    })

    const body = await ideaWebLinkService.fetchBody(
      identity.workspaceId,
      linkId
    )
    // LUM-784: the body is printed verbatim into the agent's context by
    // `web show` — redact every registry secret on the way out; the count
    // lets the CLI print the notice.
    return NextResponse.json(redactWebBodyForInjection(body))
  } catch (err) {
    return errorResponse(err, 'GET /api/ideas/[id]/web-links/[linkId]/body')
  }
}
