import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth'

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

    // Verify view exists and resolve its workspace
    const view = await prisma.view.findUnique({
      where: { id: viewId },
      include: {
        project: { select: { workspaceId: true } },
        member: { select: { workspaceId: true, clerkId: true } },
      },
    })
    if (!view) {
      return NextResponse.json({ error: 'View not found' }, { status: 404 })
    }

    const workspaceId = view.project?.workspaceId ?? view.member?.workspaceId
    if (!workspaceId) {
      return NextResponse.json(
        { error: 'View has no workspace' },
        { status: 400 }
      )
    }

    // Check caller belongs to this workspace
    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId, clerkId: userId },
    })
    if (!member) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Personal views: only the owner can update
    if (view.memberId && view.member?.clerkId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await prisma.viewTaskOrder.upsert({
      where: { viewId_taskId: { viewId, taskId } },
      update: { order, groupKey },
      create: { viewId, taskId, groupKey, order },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('PATCH /api/views/[viewId]/task-orders error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
