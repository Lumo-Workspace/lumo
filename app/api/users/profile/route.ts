import { NextResponse } from 'next/server'
import { getUserDirectory } from '@/lib/auth/users'
import { requireAuth } from '@/lib/auth'

/**
 * PATCH /api/users/profile
 * Updates the authenticated user's firstName and/or lastName in Clerk.
 * Only fields present and non-empty in the body are updated; omitted fields
 * are left unchanged in Clerk.
 * Body: { firstName?: string; lastName?: string }
 */
export async function PATCH(request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const body = await request.json()
    const firstName = (body?.firstName ?? '').trim()
    const lastName = (body?.lastName ?? '').trim()

    if (!firstName && !lastName) {
      return NextResponse.json(
        { error: 'firstName or lastName is required' },
        { status: 400 }
      )
    }

    // Build partial update — only send fields that are non-empty so we never
    // blank out an existing value that wasn't included in this request.
    const update: { firstName?: string; lastName?: string } = {}
    if (firstName) update.firstName = firstName
    if (lastName) update.lastName = lastName

    const users = await getUserDirectory()
    await users.updateUser(userId, update)

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('PATCH /api/users/profile error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
