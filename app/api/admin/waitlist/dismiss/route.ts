import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'
import { zodError } from '@/lib/api/helpers'
import { errorResponse } from '@/lib/api/route-error'
import { adminWaitlistDismissSchema } from '@/lib/validation/platform-admin'
import { waitlistAdmin } from '@/lib/services/waitlist-admin.service'

/**
 * POST /api/admin/waitlist/dismiss — platform admin: dismiss up to 100
 * PENDING entries at once. Body `{ ids: string[] }`. Audited in the service.
 */
export async function POST(request: Request) {
  const admin = await requirePlatformAdmin(request)
  if (admin instanceof NextResponse) return admin
  try {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const parsed = adminWaitlistDismissSchema.safeParse(body ?? {})
    if (!parsed.success) return zodError(parsed)
    const result = await waitlistAdmin.dismiss(parsed.data.ids, admin.userId)
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}
