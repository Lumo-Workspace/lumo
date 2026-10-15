import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth/identity'
import { serviceErrorResponse, zodError } from '@/lib/api/helpers'
import { listReviewLearningsQuerySchema } from '@/ee/security/validation/security-scan-settings'
import { listReviewLearnings } from '@/ee/security/services/review-learnings.service'

/**
 * GET /api/workspaces/me/security-scan/learnings[?repo=owner/name] —
 * LUM-1157: the workspace's PR-review learnings, with or without a Lumo
 * project (a learning of a repository linked to no project appears in no
 * project's memory). Any member may read; `lumo memory rm <id>` deletes
 * one. Browser session or CLI bearer.
 */
export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  try {
    const parsed = listReviewLearningsQuerySchema.safeParse({
      repo: request.nextUrl.searchParams.get('repo') ?? undefined,
    })
    if (!parsed.success) return zodError(parsed)
    const result = await listReviewLearnings(
      identity.workspaceId,
      parsed.data.repo ?? null
    )
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    return serviceErrorResponse(
      error,
      '[GET /api/workspaces/me/security-scan/learnings]'
    )
  }
}
