import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { logger } from '@/lib/logger'
import { pullRequestScanReadoutQuerySchema } from '@/lib/validation/security-scan'
import { prScanReadoutService } from '@/lib/services/pr-scan-readout.service'
import { prReviewControlService } from '@/lib/services/pr-review-control.service'
import { reviewActionSchema } from '@/lib/validation/security-scan'

export const runtime = 'nodejs'

type Params = { params: Promise<{ number: string }> }

/** Same workspace scope as GET. No untrusted body may choose a workspace,
 * repository credential, head SHA or scan id. */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  const { number } = await params
  const parsed = pullRequestScanReadoutQuerySchema.safeParse({
    number,
    repo: new URL(request.url).searchParams.get('repo') ?? undefined,
  })
  if (!parsed.success) return zodError(parsed)
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const action = reviewActionSchema.safeParse(body)
  if (!action.success) return zodError(action)
  try {
    const result = await prReviewControlService.act(
      identity.workspaceId,
      parsed.data.number,
      parsed.data.repo,
      action.data.action,
      action.data.limit
    )
    return NextResponse.json(result, { status: 'queued' in result ? 202 : 200 })
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 400 || status === 404 || status === 409)
      return NextResponse.json({ error: (error as Error).message }, { status })
    logger.error('pullRequestScans.control.failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: 'Could not update review control' },
      { status: 500 }
    )
  }
}

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
