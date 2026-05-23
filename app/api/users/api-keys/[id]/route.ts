import { NextResponse } from 'next/server'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { requireAuth, getUserWorkspace } from '@/lib/auth'

/**
 * DELETE /api/users/api-keys/:id
 * Revokes (soft-deletes) an API key. Only the owner can revoke their own keys.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await getUserWorkspace(userId)
    if (!ws) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    }

    const { id } = await params

    const existing = await miscRepository.findApiKeyById(id)

    if (!existing || existing.workspaceMemberId !== ws.member.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    if (existing.revokedAt !== null) {
      return NextResponse.json({ error: 'Already revoked' }, { status: 409 })
    }

    await miscRepository.revokeApiKey(id)

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('DELETE /api/users/api-keys error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
