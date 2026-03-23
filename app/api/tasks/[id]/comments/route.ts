import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { createCommentSchema } from '@/lib/validation/schemas'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/tasks/[id]/comments — list comments for a task.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const task = await prisma.task.findUnique({
      where: { id },
      include: { project: { select: { workspaceId: true } } },
    })
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const memberResult = await requireWorkspaceMember(
      task.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    const comments = await prisma.comment.findMany({
      where: { taskId: id },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json({ comments })
  } catch (error) {
    console.error('GET /api/tasks/[id]/comments error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/tasks/[id]/comments — create a comment; fires @mention notifications.
 * Mention format in body: @[clerkId]
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const task = await prisma.task.findUnique({
      where: { id },
      include: { project: { select: { workspaceId: true } } },
    })
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const memberResult = await requireWorkspaceMember(
      task.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    const body = await request.json()
    const parsed = createCommentSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      )
    }

    const comment = await prisma.comment.create({
      data: { taskId: id, authorId: userId, body: parsed.data.body },
    })

    // Fire-and-forget: create TASK_MENTIONED notifications.
    // Strip HTML tags first, then detect @[clerkId] patterns in text content.
    const textContent = parsed.data.body.replace(/<[^>]*>/g, ' ')
    const mentionRegex = /@\[([^\]]+)\]/g
    const mentionedIds: string[] = []
    let match: RegExpExecArray | null
    while ((match = mentionRegex.exec(textContent)) !== null) {
      const clerkId = match[1]
      if (clerkId && clerkId !== userId && !mentionedIds.includes(clerkId)) {
        mentionedIds.push(clerkId)
      }
    }

    if (mentionedIds.length > 0) {
      const workspaceId = task.project.workspaceId
      prisma.workspaceMember
        .findMany({
          where: { workspaceId, clerkId: { in: mentionedIds } },
          select: { clerkId: true },
        })
        .then(members => {
          if (members.length === 0) return
          return prisma.notification.createMany({
            data: members.map(m => ({
              workspaceId,
              recipientId: m.clerkId,
              type: 'TASK_MENTIONED' as const,
              taskId: id,
              commentId: comment.id,
              actorId: userId,
            })),
          })
        })
        .catch(err => console.error('[notify] TASK_MENTIONED failed:', err))
    }

    return NextResponse.json({ comment }, { status: 201 })
  } catch (error) {
    console.error('POST /api/tasks/[id]/comments error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
