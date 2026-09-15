import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { logger } from '@/lib/logger'
import { pullRequestScanReadoutQuerySchema } from '@/lib/validation/security-scan'
import { prScanReadoutService } from '@/lib/services/pr-scan-readout.service'

export const runtime = 'nodejs'

type Params = { params: Promise<{ number: string }> }

/**
 * GET /api/pull-requests/[number]/scans?repo=owner/repo&all=1 — the
 * security scans of one PR in the caller's workspace (LUM-788), consumed by
 * `lumo pr scan`. Read-only, no LLM. Bearer (CLI) and Clerk sessions alike;
 * the workspace comes from the identity, never from the query, so a PR of
 * another workspace is a plain 404.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { number } = await params
  const { searchParams } = new URL(request.url)
  const parsed = pullRequestScanReadoutQuerySchema.safeParse({
    number,
    repo: searchParams.get('repo') ?? undefined,
    all: searchParams.get('all') ?? undefined,
  })
  if (!parsed.success) return zodError(parsed)

  try {
    const view = await prScanReadoutService.getForPullRequest(
      identity.workspaceId,
      parsed.data
    )
    return NextResponse.json(view)
  } catch (error) {
    const status = (error as { status?: number } | null)?.status
    if (status === 404 || status === 409) {
      const repos = (error as { repos?: string[] }).repos
      return NextResponse.json(
        {
          error: (error as Error).message,
          ...(repos ? { repos } : {}),
        },
        { status }
      )
    }
    logger.error('pullRequestScans.read.failed', {
      workspaceId: identity.workspaceId,
      number: parsed.data.number,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
