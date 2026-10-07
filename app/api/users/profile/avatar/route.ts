import { NextResponse } from 'next/server'
import { getUserDirectory } from '@/lib/auth/users'
import { requireAuth } from '@/lib/auth'

const MAX_SIZE = 2 * 1024 * 1024 // 2 MB

/**
 * POST /api/users/profile/avatar
 * Uploads a new avatar image directly to Clerk.
 * Body: FormData with a "file" field (JPG, PNG, or WebP).
 */
export async function POST(request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const formData = await request.formData()
    const file = formData.get('file')

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 })
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: 'File must be 2 MB or smaller' },
        { status: 400 }
      )
    }

    const allowed = ['image/jpeg', 'image/png', 'image/webp']
    if (!allowed.includes(file.type)) {
      return NextResponse.json(
        { error: 'Only JPG, PNG, and WebP are allowed' },
        { status: 400 }
      )
    }

    const users = await getUserDirectory()
    await users.updateUserProfileImage(userId, { file })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('POST /api/users/profile/avatar error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
