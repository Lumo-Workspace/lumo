import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { trashKindSchema } from '@/lib/validation/schemas'
import { trashService } from '@/lib/services'

type Params = { params: Promise<{ kind: string; id: string }> }

/**
 * DELETE /api/trash/[kind]/[id] — Permanently delete a trashed task or
 * document (and what went to the trash with it) right away, instead of
 * after 30 days (LUM-918; the immediate-erasure path for one item).
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { kind, id } = await params
  const parsedKind = trashKindSchema.safeParse(kind)
  if (!parsedKind.success) {
    return NextResponse.json({ error: 'Unknown trash kind' }, { status: 400 })
  }

  try {
    const deleted = await trashService.deletePermanently(
      parsedKind.data,
      id,
      identity.workspaceId,
      identity.memberId
    )
    return NextResponse.json({ deleted })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    throw error
  }
}
