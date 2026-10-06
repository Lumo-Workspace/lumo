import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth/identity'
import { serviceErrorResponse, zodError } from '@/lib/api/helpers'
import { updateSecurityScanSettingsSchema } from '@/lib/validation/schemas'
import {
  securityScanSettingsService,
  type SecurityScanSettingsUpdate,
} from '@/lib/services/security-scan-settings.service'
import { memberAuditContext } from '@/lib/api/audit-context'

/**
 * GET /api/workspaces/me/security-scan — the workspace's PR security-scan
 * switches, the platform ceiling and the layers that will actually run
 * (LUM-1002). Any member may read. Browser session or CLI bearer.
 */
export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  try {
    const settings = await securityScanSettingsService.get(identity.workspaceId)
    return NextResponse.json(settings, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    return serviceErrorResponse(error, '[GET /api/workspaces/me/security-scan]')
  }
}

/**
 * PATCH /api/workspaces/me/security-scan — change the switches: `{ all }` to
 * disable / enable every one, or any of the three single switches. OWNER
 * only. Returns the settings as GET does.
 */
export async function PATCH(request: NextRequest) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  try {
    const parsed = updateSecurityScanSettingsSchema.safeParse(
      await request.json().catch(() => null)
    )
    if (!parsed.success) return zodError(parsed)

    const settings = await securityScanSettingsService.update(
      identity,
      parsed.data as SecurityScanSettingsUpdate,
      memberAuditContext(request.headers, identity, identity.source)
    )
    return NextResponse.json(settings)
  } catch (error) {
    return serviceErrorResponse(
      error,
      '[PATCH /api/workspaces/me/security-scan]'
    )
  }
}
