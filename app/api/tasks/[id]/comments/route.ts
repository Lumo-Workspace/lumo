import { waitUntil } from '@vercel/functions'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { createCommentSchema } from '@/lib/validation/schemas'
import { sendDMNotification, sendChannelNotification } from '@/lib/slack/notify'
import { getHumanActorId } from '@/lib/actor'
import { pushTaskEvent, pushUserEvent } from '@/lib/pusher/server'
import { buildTaskUrl } from '@/lib/utils/buildTaskUrl'

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
        id: true,
        projectId: true,
        number: true,
        title: true,
        team: { select: { identifier: true } },
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

    const authorActorId = await getHumanActorId(memberResult.id)
    if (!authorActorId) {
      return NextResponse.json({ error: 'Actor not found' }, { status: 500 })
    }

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
        authorActorId,
        body: commentBody,
        parentId: parentId ?? null,
        quotedCommentId: quotedCommentId ?? null,
      },
    })

    // Push real-time comment event to task viewers
    waitUntil(
      pushTaskEvent(id, { type: 'comment:created', commentId: comment.id })
    )

    // Handle @agent mention — delegate to orchestrator
    if (commentBody.includes('data-id="__agent__"')) {
      const { handleAgentComment } = await import('@/lib/agent/comment-handler')
      waitUntil(
        handleAgentComment({
          taskId: id,
          commentId: comment.id,
          commentBody,
          actorClerkId: userId,
        }).catch(err =>
          console.error('[comment/@agent] handleAgentComment failed:', err)
        )
      )
    }

    // Fire-and-forget: TASK_MENTIONED notifications for @mention chips
    const mentionRegex = /data-type="mention"[^>]*data-id="([^"]+)"/g
    const mentionedIds: string[] = []
    let match: RegExpExecArray | null
    while ((match = mentionRegex.exec(commentBody)) !== null) {
      const clerkId = match[1]
      if (
        clerkId &&
        clerkId !== userId &&
        clerkId !== '__agent__' &&
        !mentionedIds.includes(clerkId)
      ) {
        mentionedIds.push(clerkId)
      }
    }

    if (mentionedIds.length > 0) {
      const workspaceId = task.project.workspaceId
      prisma.workspaceMember
        .findMany({
          where: { workspaceId, clerkId: { in: mentionedIds } },
          select: { clerkId: true, actor: { select: { id: true } } },
        })
        .then(members => {
          if (members.length === 0) return
          // Send Slack DM to each mentioned user
          const workspaceSlug = task.project.workspace?.slug ?? ''
          for (const m of members) {
            waitUntil(
              sendDMNotification(workspaceId, m.clerkId, 'comment_mention', {
                taskId: id,
                taskTitle: task.title,
                commentBody: commentBody.replace(/<[^>]+>/g, '').slice(0, 200),
                taskUrl: buildTaskUrl(
                  workspaceSlug,
                  task.team?.identifier ?? '',
                  task.number
                ),
              })
            )
          }
          // Channel notification for comment_mention (fire-and-forget)
          waitUntil(
            sendChannelNotification(
              workspaceId,
              'comment_mention',
              {
                taskId: task.id,
                taskTitle: task.title,
                taskIdentifier: `${task.team?.identifier ?? ''}-${task.number}`,
                taskUrl: buildTaskUrl(
                  workspaceSlug,
                  task.team?.identifier ?? '',
                  task.number
                ),
                commentBody: commentBody.replace(/<[^>]+>/g, '').slice(0, 200),
              },
              task.projectId
            )
          )
          const recipientActors = members
            .map(m => m.actor?.id)
            .filter((actorId): actorId is string => !!actorId)
          if (recipientActors.length === 0) return
          // Push real-time notification to each mentioned user
          for (const m of members) {
            if (m.clerkId) {
              waitUntil(pushUserEvent(m.clerkId, { type: 'notification:new' }))
            }
          }
          return prisma.notification.createMany({
            data: recipientActors.map(recipientActorId => ({
              workspaceId,
              recipientActorId,
              type: 'TASK_MENTIONED' as const,
              taskId: id,
              commentId: comment.id,
              triggerActorId: authorActorId,
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
