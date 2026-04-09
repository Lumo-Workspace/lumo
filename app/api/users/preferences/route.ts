import { NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { preferenceService } from '@/lib/services/preference.service'

async function resolveMember(userId: string) {
  const ws = await getUserWorkspace(userId)
  if (!ws) return null
  return ws.member
}

export async function GET(_request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const member = await resolveMember(userId)
    if (!member) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 403 })
    }

    const preferences = await preferenceService.getPreferences(member.id)
    return NextResponse.json(preferences)
  } catch (error) {
    console.error('GET /api/users/preferences error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const member = await resolveMember(userId)
    if (!member) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 403 })
    }

    const body = await request.json()
    const preferences = await preferenceService.updatePreferences(
      member.id,
      body
    )

    return NextResponse.json(preferences)
  } catch (error) {
    const err = error as Error & { status?: number }
    if (err.status === 400) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    console.error('PATCH /api/users/preferences error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
