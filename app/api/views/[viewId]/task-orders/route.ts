import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { viewService } from '@/lib/services/view.service'

type Params = { params: Promise<{ viewId: string }> }

/**
 * PATCH /api/views/[viewId]/task-orders
 * Upsert a single task's order within a view.
 * Body: { taskId: string, groupKey: string, order: number }
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { viewId } = await params

    const body = (await request.json()) as {
      taskId: string
      groupKey: string
      order: number
    }
    const { taskId, groupKey, order } = body

    if (!taskId || !groupKey || typeof order !== 'number') {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
    }

    await viewService.upsertTaskOrder(viewId, taskId, groupKey, order, userId)

    return NextResponse.json({ ok: true })
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status) {
      return NextResponse.json({ error: (error as Error).message }, { status })
    }
    console.error('PATCH /api/views/[viewId]/task-orders error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
