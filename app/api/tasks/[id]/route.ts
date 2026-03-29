import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { updateTaskSchema } from '@/lib/validation/schemas'
import { notifyTaskInReview } from '@/lib/notifications/notifyTaskInReview'
import { sendChannelNotification, sendDMNotification } from '@/lib/slack/notify'

type Params = { params: Promise<{ id: string }> }

/**
 * Check if targetId is a descendant of ancestorId (prevent circular refs).
 */
async function isDescendant(
  ancestorId: string,
  targetId: string
): Promise<boolean> {
  const children = await prisma.task.findMany({
    where: { parentTaskId: ancestorId },
    select: { id: true },
  })

  for (const child of children) {
    if (child.id === targetId) return true
    if (await isDescendant(child.id, targetId)) return true
  }

  return false
}

/**
 * GET /api/tasks/[id] — Fetch a single task with full details.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            workspaceId: true,
            defaultReviewerId: true,
            githubRepo: true,
            repositories: {
              orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
            },
          },
        },
        team: { select: { identifier: true } },
        assignee: {
          select: {
            id: true,
            type: true,
            member: { select: { id: true, clerkId: true } },
            agent: { select: { id: true, name: true, avatarColor: true } },
          },
        },
        reviewer: {
          select: {
            id: true,
            type: true,
            member: { select: { id: true, clerkId: true } },
          },
        },
        pullRequests: {
          select: {
            id: true,
            number: true,
            title: true,
            url: true,
            state: true,
            authorLogin: true,
            headBranch: true,
            ciStatus: true,
            mergedAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        branches: {
          select: {
            id: true,
            repo: true,
            branchName: true,
            lastCommitSha: true,
            lastCommitMessage: true,
            lastCommitAuthor: true,
            lastPushedAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' as const },
        },
        clarifies: {
          select: {
            id: true,
            question: true,
            context: true,
            reply: true,
            repliedAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' as const },
        },
      },
    })
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const memberResult = await requireWorkspaceMember(
      task.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    return NextResponse.json({
      task: { ...task, teamIdentifier: task.team.identifier },
    })
  } catch (error) {
    console.error('GET /api/tasks/[id] error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/tasks/[id] — Update a task.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        project: {
          include: {
            defaultReviewer: { select: { id: true, clerkId: true } },
            workspace: { select: { slug: true } },
          },
        },
        team: { select: { identifier: true } },
      },
    })
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const memberResult = await requireWorkspaceMember(
      task.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    const body = await request.json()
    const parsed = updateTaskSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      )
    }

    const {
      parentTaskId,
      assigneeActorId,
      reviewerActorId,
      projectId,
      repositoryId,
      ...rest
    } = parsed.data

    // Validate parentTaskId change
    if (parentTaskId !== undefined) {
      if (parentTaskId !== null) {
        // Can't be own parent
        if (parentTaskId === id) {
          return NextResponse.json(
            { error: 'A task cannot be its own parent' },
            { status: 400 }
          )
        }

        // Parent must be in the same project
        const parent = await prisma.task.findUnique({
          where: { id: parentTaskId },
        })
        if (!parent || parent.projectId !== task.projectId) {
          return NextResponse.json(
            { error: 'Parent task not found in this project' },
            { status: 400 }
          )
        }

        // Prevent circular reference: proposed parent must not be a descendant
        if (await isDescendant(id, parentTaskId)) {
          return NextResponse.json(
            { error: 'Cannot create circular parent reference' },
            { status: 400 }
          )
        }
      }
    }

    // Validate projectId belongs to the same workspace
    if (projectId !== undefined) {
      const newProject = await prisma.project.findUnique({
        where: { id: projectId },
      })
      if (!newProject || newProject.workspaceId !== task.project.workspaceId) {
        return NextResponse.json(
          { error: 'Project not found in this workspace' },
          { status: 400 }
        )
      }
    }

    // Validate assigneeActorId belongs to the same workspace
    if (assigneeActorId !== undefined && assigneeActorId !== null) {
      const actor = await prisma.actor.findUnique({
        where: { id: assigneeActorId },
      })
      if (!actor || actor.workspaceId !== task.project.workspaceId) {
        return NextResponse.json(
          { error: 'Assignee is not part of this workspace' },
          { status: 400 }
        )
      }
    }

    // Validate reviewerActorId belongs to the same workspace
    if (reviewerActorId !== undefined && reviewerActorId !== null) {
      const actor = await prisma.actor.findUnique({
        where: { id: reviewerActorId },
      })
      if (!actor || actor.workspaceId !== task.project.workspaceId) {
        return NextResponse.json(
          { error: 'Reviewer is not part of this workspace' },
          { status: 400 }
        )
      }
    }

    // Build update data explicitly to satisfy exactOptionalPropertyTypes
    const data: Record<string, unknown> = {}
    if (rest.title !== undefined) data.title = rest.title
    if (rest.description !== undefined) data.description = rest.description
    if (rest.spec !== undefined) data.spec = rest.spec
    if (rest.status !== undefined) data.status = rest.status
    if (rest.priority !== undefined) data.priority = rest.priority
    if (rest.order !== undefined) data.order = rest.order
    if (parentTaskId !== undefined) data.parentTaskId = parentTaskId
    if (assigneeActorId !== undefined) data.assigneeActorId = assigneeActorId
    if (reviewerActorId !== undefined) data.reviewerActorId = reviewerActorId
    if (projectId !== undefined) data.projectId = projectId
    if (repositoryId !== undefined) data.repositoryId = repositoryId

    const updated = await prisma.task.update({
      where: { id },
      data,
      include: {
        project: { select: { id: true, name: true } },
        team: { select: { identifier: true } },
      },
    })

    const workspaceId = task.project.workspaceId
    const workspaceSlug = task.project.workspace?.slug ?? ''

    // ── Fire-and-forget notification side-effects ────────────────────────────
    if (parsed.data.status) {
      console.log(`[task status] ${id}: ${task.status} → ${parsed.data.status}`)
    }
    if (parsed.data.status === 'IN_REVIEW' && task.status !== 'IN_REVIEW') {
      waitUntil(
        notifyTaskInReview({
          workspaceId,
          taskId: id,
          reviewerActorId: updated.reviewerActorId ?? null,
          defaultReviewerActorId: null,
          actorId: userId,
        }).catch(err => console.error('[notify] TASK_IN_REVIEW failed:', err))
      )
    }

    if (
      parsed.data.assigneeActorId !== undefined &&
      parsed.data.assigneeActorId !== null &&
      parsed.data.assigneeActorId !== task.assigneeActorId
    ) {
      // Notify the new assignee (skip if they assigned it to themselves)
      prisma.actor
        .findUnique({
          where: { id: parsed.data.assigneeActorId },
          select: { type: true, member: { select: { clerkId: true } } },
        })
        .then(actor => {
          if (!actor || actor.type !== 'HUMAN' || !actor.member) return
          if (actor.member.clerkId === userId) return
          return prisma.notification.create({
            data: {
              workspaceId,
              recipientId: actor.member.clerkId,
              type: 'TASK_ASSIGNED' as const,
              taskId: id,
              actorId: userId,
            },
          })
        })
        .catch(err => console.error('[notify] TASK_ASSIGNED failed:', err))
    }

    if (
      parsed.data.assigneeActorId !== undefined &&
      parsed.data.assigneeActorId !== null &&
      parsed.data.assigneeActorId !== task.assigneeActorId
    ) {
      waitUntil(
        sendChannelNotification(
          workspaceId,
          'task_assigned',
          {
            taskId: id,
            taskTitle: updated.title,
            taskIdentifier: `${updated.team.identifier}-${task.number}`,
            taskUrl: `${process.env.NEXT_PUBLIC_APP_URL}/workspace/${workspaceSlug}/tasks/${updated.team.identifier}-${task.number}`,
          },
          task.projectId
        )
      )
      prisma.actor
        .findUnique({
          where: { id: parsed.data.assigneeActorId },
          select: { type: true, member: { select: { clerkId: true } } },
        })
        .then(actor => {
          if (!actor || actor.type !== 'HUMAN' || !actor.member) return
          if (actor.member.clerkId === userId) return
          waitUntil(
            sendDMNotification(
              workspaceId,
              actor.member.clerkId,
              'task_assigned',
              {
                taskId: id,
                taskTitle: updated.title,
                taskIdentifier: `${updated.team.identifier}-${task.number}`,
                taskUrl: `${process.env.NEXT_PUBLIC_APP_URL}/workspace/${workspaceSlug}/tasks/${updated.team.identifier}-${task.number}`,
              }
            )
          )
        })
        .catch(err => console.error('[slack] task_assigned DM failed:', err))
    }

    if (parsed.data.status === 'IN_PROGRESS' && task.status === 'IN_REVIEW') {
      // Notify the assignee that the task was sent back
      if (task.assigneeActorId) {
        prisma.actor
          .findUnique({
            where: { id: task.assigneeActorId },
            select: { type: true, member: { select: { clerkId: true } } },
          })
          .then(actor => {
            if (!actor || actor.type !== 'HUMAN' || !actor.member) return
            if (actor.member.clerkId === userId) return
            return prisma.notification.create({
              data: {
                workspaceId,
                recipientId: actor.member.clerkId,
                type: 'TASK_SENT_BACK' as const,
                taskId: id,
                actorId: userId,
              },
            })
          })
          .catch(err => console.error('[notify] TASK_SENT_BACK failed:', err))
      }
      waitUntil(
        sendChannelNotification(
          workspaceId,
          'task_sent_back',
          {
            taskId: id,
            taskTitle: updated.title,
            taskIdentifier: `${updated.team.identifier}-${task.number}`,
            taskUrl: `${process.env.NEXT_PUBLIC_APP_URL}/workspace/${workspaceSlug}/tasks/${updated.team.identifier}-${task.number}`,
          },
          task.projectId
        )
      )
      if (task.assigneeActorId) {
        prisma.actor
          .findUnique({
            where: { id: task.assigneeActorId },
            select: { type: true, member: { select: { clerkId: true } } },
          })
          .then(actor => {
            if (!actor || actor.type !== 'HUMAN' || !actor.member) return
            if (actor.member.clerkId === userId) return
            waitUntil(
              sendDMNotification(
                workspaceId,
                actor.member.clerkId,
                'task_sent_back',
                {
                  taskId: id,
                  taskTitle: updated.title,
                  taskIdentifier: `${updated.team.identifier}-${task.number}`,
                  taskUrl: `${process.env.NEXT_PUBLIC_APP_URL}/workspace/${workspaceSlug}/tasks/${updated.team.identifier}-${task.number}`,
                }
              )
            )
          })
          .catch(err =>
            console.error('[slack] task_sent_back IN_PROGRESS DM failed:', err)
          )
      }
    }

    if (parsed.data.status === 'DONE' && task.status !== 'DONE') {
      const dmPayload = {
        taskId: id,
        taskTitle: updated.title,
        taskIdentifier: `${updated.team.identifier}-${task.number}`,
        taskUrl: `${process.env.NEXT_PUBLIC_APP_URL}/workspace/${workspaceSlug}/tasks/${updated.team.identifier}-${task.number}`,
      }
      waitUntil(
        sendChannelNotification(
          workspaceId,
          'task_done',
          dmPayload,
          task.projectId
        )
      )
      if (task.assigneeActorId) {
        prisma.actor
          .findUnique({
            where: { id: task.assigneeActorId },
            select: { type: true, member: { select: { clerkId: true } } },
          })
          .then(actor => {
            if (!actor || actor.type !== 'HUMAN' || !actor.member) return
            waitUntil(
              sendDMNotification(
                workspaceId,
                actor.member.clerkId,
                'task_done',
                dmPayload
              )
            )
          })
          .catch(err => console.error('[slack] task_done DM failed:', err))
      }
    }

    if (parsed.data.status === 'TODO' && task.status === 'IN_REVIEW') {
      const sentBackPayload = {
        taskId: id,
        taskTitle: updated.title,
        taskIdentifier: `${updated.team.identifier}-${task.number}`,
        taskUrl: `${process.env.NEXT_PUBLIC_APP_URL}/workspace/${workspaceSlug}/tasks/${updated.team.identifier}-${task.number}`,
      }
      waitUntil(
        sendChannelNotification(
          workspaceId,
          'task_sent_back',
          sentBackPayload,
          task.projectId
        )
      )
      if (task.assigneeActorId) {
        prisma.actor
          .findUnique({
            where: { id: task.assigneeActorId },
            select: { type: true, member: { select: { clerkId: true } } },
          })
          .then(actor => {
            if (!actor || actor.type !== 'HUMAN' || !actor.member) return
            if (actor.member.clerkId === userId) return
            waitUntil(
              sendDMNotification(
                workspaceId,
                actor.member.clerkId,
                'task_sent_back',
                sentBackPayload
              )
            )
          })
          .catch(err => console.error('[slack] task_sent_back DM failed:', err))
      }
    }

    return NextResponse.json({
      task: { ...updated, teamIdentifier: updated.team.identifier },
    })
  } catch (error) {
    console.error('PATCH /api/tasks/[id] error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/tasks/[id] — Delete a task.
 * Children get parentTaskId set to null (onDelete: SetNull).
 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const task = await prisma.task.findUnique({
      where: { id },
      include: { project: true },
    })
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const memberResult = await requireWorkspaceMember(
      task.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    await prisma.task.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE /api/tasks/[id] error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
