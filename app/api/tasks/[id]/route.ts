import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { updateTaskSchema } from '@/lib/validation/schemas'
import { notifyTaskInReview } from '@/lib/notifications/notifyTaskInReview'

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
          },
        },
        team: { select: { identifier: true } },
        assignee: { select: { id: true, clerkId: true } },
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
          include: { defaultReviewer: { select: { id: true, clerkId: true } } },
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

    const { parentTaskId, assigneeId, reviewerId, projectId, ...rest } =
      parsed.data

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

    // Validate assigneeId belongs to the same workspace
    if (assigneeId !== undefined && assigneeId !== null) {
      const assignee = await prisma.workspaceMember.findUnique({
        where: { id: assigneeId },
      })
      if (!assignee || assignee.workspaceId !== task.project.workspaceId) {
        return NextResponse.json(
          { error: 'Assignee is not a member of this workspace' },
          { status: 400 }
        )
      }
    }

    // Validate reviewerId belongs to the same workspace
    if (reviewerId !== undefined && reviewerId !== null) {
      const reviewer = await prisma.workspaceMember.findUnique({
        where: { id: reviewerId },
      })
      if (!reviewer || reviewer.workspaceId !== task.project.workspaceId) {
        return NextResponse.json(
          { error: 'Reviewer is not a member of this workspace' },
          { status: 400 }
        )
      }
    }

    // Build update data explicitly to satisfy exactOptionalPropertyTypes
    const data: Record<string, unknown> = {}
    if (rest.title !== undefined) data.title = rest.title
    if (rest.description !== undefined) data.description = rest.description
    if (rest.status !== undefined) data.status = rest.status
    if (rest.priority !== undefined) data.priority = rest.priority
    if (rest.order !== undefined) data.order = rest.order
    if (parentTaskId !== undefined) data.parentTaskId = parentTaskId
    if (assigneeId !== undefined) data.assigneeId = assigneeId
    if (reviewerId !== undefined) data.reviewerId = reviewerId
    if (projectId !== undefined) data.projectId = projectId

    const updated = await prisma.task.update({
      where: { id },
      data,
      include: {
        project: { select: { id: true, name: true } },
        team: { select: { identifier: true } },
      },
    })

    const workspaceId = task.project.workspaceId

    // ── Fire-and-forget notification side-effects ────────────────────────────
    if (parsed.data.status === 'IN_REVIEW' && task.status !== 'IN_REVIEW') {
      notifyTaskInReview({
        workspaceId,
        taskId: id,
        reviewerId: updated.reviewerId,
        defaultReviewerId: task.project.defaultReviewerId,
        actorId: userId,
      }).catch(err => console.error('[notify] TASK_IN_REVIEW failed:', err))
    }

    if (
      parsed.data.assigneeId !== undefined &&
      parsed.data.assigneeId !== null &&
      parsed.data.assigneeId !== task.assigneeId
    ) {
      // Notify the new assignee (skip if they assigned it to themselves)
      prisma.workspaceMember
        .findUnique({
          where: { id: parsed.data.assigneeId },
          select: { clerkId: true },
        })
        .then(assignee => {
          if (!assignee || assignee.clerkId === userId) return
          return prisma.notification.create({
            data: {
              workspaceId,
              recipientId: assignee.clerkId,
              type: 'TASK_ASSIGNED' as const,
              taskId: id,
              actorId: userId,
            },
          })
        })
        .catch(err => console.error('[notify] TASK_ASSIGNED failed:', err))
    }

    if (parsed.data.status === 'IN_PROGRESS' && task.status === 'IN_REVIEW') {
      // Notify the assignee that the task was sent back
      if (task.assigneeId) {
        prisma.workspaceMember
          .findUnique({
            where: { id: task.assigneeId },
            select: { clerkId: true },
          })
          .then(assignee => {
            if (!assignee || assignee.clerkId === userId) return
            return prisma.notification.create({
              data: {
                workspaceId,
                recipientId: assignee.clerkId,
                type: 'TASK_SENT_BACK' as const,
                taskId: id,
                actorId: userId,
              },
            })
          })
          .catch(err => console.error('[notify] TASK_SENT_BACK failed:', err))
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
