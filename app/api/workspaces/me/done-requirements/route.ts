import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth/identity'
import { serviceErrorResponse, zodError } from '@/lib/api/helpers'
import { updateDoneRequirementsSchema } from '@/lib/validation/done-requirements'
import { doneRequirementsSettingsService } from '@/lib/services/done-requirements-settings.service'
import { memberAuditContext } from '@/lib/api/audit-context'

/**
 * GET /api/workspaces/me/done-requirements — the LUM-1334 switches (DONE
 * requires a passing test case / a review on each linked PR's latest commit)
 * and whether the caller may change them. Any member may read. Browser
 * session or CLI bearer.
 */
export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  try {
    const settings = await doneRequirementsSettingsService.get(identity)
    return NextResponse.json(settings, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    return serviceErrorResponse(
      error,
      '[GET /api/workspaces/me/done-requirements]'
    )
  }
}

/**
 * PATCH /api/workspaces/me/done-requirements — `{ testCase?, review? }`.
 * OWNER only. Returns the settings as GET does.
 */
export async function PATCH(request: NextRequest) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  try {
    const parsed = updateDoneRequirementsSchema.safeParse(
      await request.json().catch(() => null)
    )
    if (!parsed.success) return zodError(parsed)
    const settings = await doneRequirementsSettingsService.update(
      identity,
      parsed.data,
      memberAuditContext(request.headers, identity, identity.source)
    )
    return NextResponse.json(settings)
  } catch (error) {
    return serviceErrorResponse(
      error,
      '[PATCH /api/workspaces/me/done-requirements]'
    )
  }
}
