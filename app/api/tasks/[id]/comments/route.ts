import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { createCommentSchema } from '@/lib/validation/schemas'
import { sendDMNotification } from '@/lib/slack/notify'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/tasks/[id]/comments
 * Returns only top-level comments (parentId = null), each with their replies
 * nested under a `replies` array, ordered oldest-first.
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
      where: { taskId: id, parentId: null },
      include: { replies: { orderBy: { createdAt: 'asc' } } },
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
 * POST /api/tasks/[id]/comments
 * Creates a comment or reply. If `parentId` is supplied it must reference a
 * top-level comment on the same task (replies cannot themselves be replied to).
 * Fires TASK_MENTIONED notifications for @mention chips in the body.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const task = await prisma.task.findUnique({
      where: { id },
      select: {
        title: true,
        project: {
          select: {
            workspaceId: true,
            workspace: { select: { slug: true } },
          },
        },
      },
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

    const { body: commentBody, parentId, quotedCommentId } = parsed.data

    // Validate parentId — must be a top-level comment on this task
    if (parentId) {
      const parent = await prisma.comment.findUnique({
        where: { id: parentId },
      })
      if (!parent || parent.taskId !== id) {
        return NextResponse.json(
          { error: 'Parent comment not found' },
          { status: 404 }
        )
      }
      if (parent.parentId !== null) {
        return NextResponse.json(
          { error: 'Cannot reply to a reply' },
          { status: 400 }
        )
      }
    }

    const comment = await prisma.comment.create({
      data: {
        taskId: id,
        authorId: userId,
        body: commentBody,
        parentId: parentId ?? null,
        quotedCommentId: quotedCommentId ?? null,
      },
    })

    // Fire-and-forget: TASK_MENTIONED notifications for @mention chips
    const mentionRegex = /data-type="mention"[^>]*data-id="([^"]+)"/g
    const mentionedIds: string[] = []
    let match: RegExpExecArray | null
    while ((match = mentionRegex.exec(commentBody)) !== null) {
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
          // Send Slack DM to each mentioned user
          const workspaceSlug = task.project.workspace?.slug ?? ''
          for (const m of members) {
            void sendDMNotification(workspaceId, m.clerkId, 'comment_mention', {
              taskId: id,
              taskTitle: task.title,
              commentBody: commentBody.replace(/<[^>]+>/g, '').slice(0, 200),
              taskUrl: `${process.env.NEXT_PUBLIC_APP_URL}/workspace/${workspaceSlug}/task/${id}`,
            })
          }
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
