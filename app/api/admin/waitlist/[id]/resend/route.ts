import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'
import { errorResponse } from '@/lib/api/route-error'
import { waitlistAdmin } from '@/lib/services/waitlist-admin.service'

/** POST /api/admin/waitlist/[id]/resend — platform admin. Audited in the service. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requirePlatformAdmin(request)
  if (admin instanceof NextResponse) return admin
  try {
    const { id } = await params
    const result = await waitlistAdmin.resend(id, admin.userId)
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}
