import { NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth/identity'
import { serviceErrorResponse } from '@/lib/api/helpers'
import { sessionRecordNoticeService } from '@/lib/services/session-record-notice.service'

/**
 * GET /api/workspaces/me/session-records — how the caller's workspace stores
 * session records (mode, day tier, settings link and the rendered notice line).
 * Read by `lumo setup` (LUM-943); any member may read it, only an OWNER may
 * change it (PATCH /api/workspaces/me). `sessionRecords` is null when the
 * setting could not be read — the CLI then prints nothing.
 */
export async function GET(request: Request) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const sessionRecords = await sessionRecordNoticeService.getForWorkspace(
      identity.workspaceId
    )
    return NextResponse.json(
      { sessionRecords },
      { headers: { 'Cache-Control': 'private, no-store' } }
    )
  } catch (error) {
    return serviceErrorResponse(
      error,
      '[GET /api/workspaces/me/session-records]'
    )
  }
}
