import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth/identity'
import { serviceErrorResponse, zodError } from '@/lib/api/helpers'
import { updateRepoReviewSettingsSchema } from '@/ee/security/validation/security-scan-settings'
import { repoReviewSettingsService } from '@/ee/security/services/repo-review-settings.service'
import { memberAuditContext } from '@/lib/api/audit-context'

/**
 * GET /api/workspaces/me/security-scan/repositories — LUM-1133: every
 * repository the workspace confirmed, with its automatic review settings
 * (PRs without a task: on/off, drafts). Any member may read. Browser
 * session or CLI bearer.
 */
export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  try {
    const settings = await repoReviewSettingsService.list(identity)
    return NextResponse.json(settings, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    return serviceErrorResponse(
      error,
      '[GET /api/workspaces/me/security-scan/repositories]'
    )
  }
}

/**
 * PATCH /api/workspaces/me/security-scan/repositories — change one
 * repository: `{ repo, autoReview?, reviewDrafts? }`. OWNER only; audited.
 * Returns the list as GET does.
 */
export async function PATCH(request: NextRequest) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  try {
    const parsed = updateRepoReviewSettingsSchema.safeParse(
      await request.json().catch(() => null)
    )
    if (!parsed.success) return zodError(parsed)
    const settings = await repoReviewSettingsService.update(
      identity,
      parsed.data,
      memberAuditContext(request.headers, identity, identity.source)
    )
    return NextResponse.json(settings)
  } catch (error) {
    return serviceErrorResponse(
      error,
      '[PATCH /api/workspaces/me/security-scan/repositories]'
    )
  }
}
