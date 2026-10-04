import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { trashKindSchema } from '@/lib/validation/schemas'
import { trashService } from '@/lib/services'

type Params = { params: Promise<{ kind: string; id: string }> }

/**
 * POST /api/trash/[kind]/[id]/restore — Restore a trashed task or document
 * together with whatever went to the trash with it — sub-pages, or the
 * subtasks of a task trashed before LUM-959 (LUM-918).
 */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { kind, id } = await params
  const parsedKind = trashKindSchema.safeParse(kind)
  if (!parsedKind.success) {
    return NextResponse.json({ error: 'Unknown trash kind' }, { status: 400 })
  }

  try {
    await trashService.restore(
      parsedKind.data,
      id,
      identity.workspaceId,
      identity.memberId
    )
    return NextResponse.json({ restored: true })
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
