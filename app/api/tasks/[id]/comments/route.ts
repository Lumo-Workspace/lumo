import { waitUntil } from '@vercel/functions'
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { createCommentSchema } from '@/lib/validation/schemas'
import { zodError } from '@/lib/api/helpers'
import {
  sendDMNotification,
  sendChannelNotification,
} from '@/lib/integrations/slack'
import { getHumanActorId } from '@/lib/actor'
import { pushTaskEvent, pushUserEvent } from '@/lib/integrations/pusher'
import { buildTaskUrl } from '@/lib/utils/buildTaskUrl'
import { shouldNotifyBatch } from '@/lib/notifications/preferenceGate'
import { commentService } from '@/lib/services'
import {
  taskRepository,
  memberRepository,
  notificationRepository,
} from '@/lib/repositories'
import { dispatchEvents } from '@/lib/events/dispatcher'
import type { TaskActivityEvent } from '@/lib/events/types/task-activity'

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

    const task = await taskRepository.findWithProjectWorkspaceId(id)
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const memberResult = await requireWorkspaceMember(
      task.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    const comments = await commentService.getComments(id)

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

    const task = await taskRepository.findForComment(id)
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
    if (!parsed.success) return zodError(parsed)

    const { body: commentBody, parentId, quotedCommentId } = parsed.data

    const comment = await commentService.createComment({
      taskId: id,
      authorActorId,
      body: commentBody,
      parentId: parentId ?? null,
      quotedCommentId: quotedCommentId ?? null,
    })

    // Push real-time comment event to task viewers
    waitUntil(
      pushTaskEvent(id, { type: 'comment:created', commentId: comment.id })
    )

    // Fire-and-forget activity recording
    waitUntil(
      dispatchEvents([
        {
          type: 'task:comment_added',
          taskId: id,
          projectId: task.projectId,
          actorId: authorActorId,
          commentId: comment.id,
        } satisfies TaskActivityEvent,
      ])
    )

    // Handle @agent mention — delegate to orchestrator
    if (commentService.hasAgentMention(commentBody)) {
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
    const mentionedIds = commentService.parseMentionedClerkIds(
      commentBody,
      userId
    )

    if (mentionedIds.length > 0) {
      const workspaceId = task.project.workspaceId
      memberRepository
        .findByWorkspaceAndClerkIds(workspaceId, mentionedIds)
        .then(async members => {
          if (members.length === 0) return
          const workspaceSlug = task.project.workspace?.slug ?? ''
          const mentionPayload = {
            taskId: id,
            taskTitle: task.title,
            commentBody: commentBody.replace(/<[^>]+>/g, '').slice(0, 200),
            taskUrl: buildTaskUrl(
              workspaceSlug,
              task.team?.identifier ?? '',
              task.number
            ),
          }

          const recipientActors = members
            .map(m => m.actor?.id)
            .filter((actorId): actorId is string => !!actorId)

          // Batch preference checks for inApp and slack channels
          const [inAppAllowed, slackAllowed] = await Promise.all([
            shouldNotifyBatch(recipientActors, 'inApp', 'TASK_MENTIONED'),
            shouldNotifyBatch(recipientActors, 'slack', 'TASK_MENTIONED'),
          ])

          // Slack DM — only to users who have slack mention enabled
          for (const m of members) {
            if (m.actor?.id && slackAllowed.has(m.actor.id)) {
              waitUntil(
                sendDMNotification(
                  workspaceId,
                  m.clerkId,
                  'comment_mention',
                  mentionPayload
                )
              )
            }
          }

          // Channel notification (project-level, not gated by personal preference)
          waitUntil(
            sendChannelNotification(
              workspaceId,
              'comment_mention',
              {
                ...mentionPayload,
                taskId: task.id,
                taskIdentifier: `${task.team?.identifier ?? ''}-${task.number}`,
              },
              task.projectId
            )
          )

          // Inbox notifications — only for users who have inApp mention enabled
          const inAppRecipients = recipientActors.filter(id =>
            inAppAllowed.has(id)
          )
          if (inAppRecipients.length === 0) return

          // Push real-time notification for inbox recipients
          for (const m of members) {
            if (m.clerkId && m.actor?.id && inAppAllowed.has(m.actor.id)) {
              waitUntil(pushUserEvent(m.clerkId, { type: 'notification:new' }))
            }
          }
          return notificationRepository.createMany(
            inAppRecipients.map(recipientActorId => ({
              workspaceId,
              recipientActorId,
              type: 'TASK_MENTIONED' as const,
              taskId: id,
              commentId: comment.id,
              triggerActorId: authorActorId,
            }))
          )
        })
        .catch(err => console.error('[notify] TASK_MENTIONED failed:', err))
    }

    return NextResponse.json({ comment }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    console.error('POST /api/tasks/[id]/comments error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
