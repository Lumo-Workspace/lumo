import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { trashService } from '@/lib/services'

/**
 * GET /api/trash — The caller's trash (LUM-918): the workspace's deleted
 * tasks and the caller's own deleted documents, each with its purge date.
 */
export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const items = await trashService.list(identity.workspaceId, identity.memberId)
  return NextResponse.json({ items })
}
