import { waitUntil } from '@vercel/functions'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { createTaskSchema } from '@/lib/validation/schemas'
import { sendChannelNotification } from '@/lib/slack/notify'

type Params = { params: Promise<{ id: string }> }

// ─── Tree builder ───────────────────────────────────────────────────────────

type TaskNode = Omit<
  Awaited<ReturnType<typeof prisma.task.findMany>>[number],
  'team'
> & { viewOrder: number | null; teamIdentifier: string }
type TaskWithChildren = TaskNode & { children: TaskWithChildren[] }

function buildTaskTree(tasks: TaskNode[]): TaskWithChildren[] {
  const map = new Map<string, TaskWithChildren>()
  const roots: TaskWithChildren[] = []

  for (const task of tasks) {
    map.set(task.id, { ...task, children: [] })
  }

  for (const task of tasks) {
    const node = map.get(task.id)!
    if (task.parentTaskId && map.has(task.parentTaskId)) {
      map.get(task.parentTaskId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * GET /api/projects/[id]/tasks — Get all tasks as a tree, with per-view ordering.
 * Also lazy-creates the KANBAN view for the project on first access.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const project = await prisma.project.findUnique({ where: { id } })
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const memberResult = await requireWorkspaceMember(
      project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    const tasks = await prisma.task.findMany({
      where: { projectId: id },
      include: { team: { select: { identifier: true } } },
      orderBy: { order: 'asc' },
    })

    // Lazy-create KANBAN view for this project
    let kanbanView = await prisma.view.findFirst({
      where: { projectId: id, type: 'KANBAN' },
    })
    if (!kanbanView) {
      kanbanView = await prisma.view.create({
        data: {
          workspaceId: project.workspaceId,
          projectId: id,
          name: 'Board',
          type: 'KANBAN',
          isDefault: false,
        },
      })
    }

    // Build viewOrder map
    const taskOrders = await prisma.viewTaskOrder.findMany({
      where: { viewId: kanbanView.id },
    })
    const orderMap = new Map(taskOrders.map(o => [o.taskId, o.order]))

    // Merge viewOrder into tasks
    const tasksWithOrder: TaskNode[] = tasks.map(t => ({
      ...t,
      teamIdentifier: t.team.identifier,
      viewOrder: orderMap.get(t.id) ?? null,
    }))

    const tree = buildTaskTree(tasksWithOrder)

    return NextResponse.json({ tasks: tree, kanbanViewId: kanbanView.id })
  } catch (error) {
    console.error('GET /api/projects/[id]/tasks error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/projects/[id]/tasks — Create a task.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        defaultReviewer: { select: { id: true } },
        workspace: { select: { slug: true } },
      },
    })
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const memberResult = await requireWorkspaceMember(
      project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    const body = await request.json()
    const parsed = createTaskSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      )
    }

    const {
      title,
      description,
      status,
      priority,
      assigneeId,
      parentTaskId,
      order,
    } = parsed.data

    // Validate parentTaskId belongs to the same project
    if (parentTaskId) {
      const parent = await prisma.task.findUnique({
        where: { id: parentTaskId },
      })
      if (!parent || parent.projectId !== id) {
        return NextResponse.json(
          { error: 'Parent task not found in this project' },
          { status: 400 }
        )
      }
    }

    // Auto-calculate order if not provided
    let taskOrder = order
    if (taskOrder === undefined) {
      const maxOrderTask = await prisma.task.findFirst({
        where: {
          projectId: id,
          parentTaskId: parentTaskId ?? null,
        },
        orderBy: { order: 'desc' },
        select: { order: true },
      })
      taskOrder = (maxOrderTask?.order ?? 0) + 1
    }

    // Validate assigneeId belongs to the same workspace
    if (assigneeId) {
      const assignee = await prisma.workspaceMember.findUnique({
        where: { id: assigneeId },
      })
      if (!assignee || assignee.workspaceId !== project.workspaceId) {
        return NextResponse.json(
          { error: 'Assignee is not a member of this workspace' },
          { status: 400 }
        )
      }
    }

    const task = await prisma.$transaction(async tx => {
      const { taskSeq } = await tx.team.update({
        where: { id: project.teamId },
        data: { taskSeq: { increment: 1 } },
        select: { taskSeq: true },
      })

      return tx.task.create({
        data: {
          projectId: id,
          teamId: project.teamId,
          number: taskSeq,
          title,
          description: description ?? null,
          status,
          priority,
          assigneeId: assigneeId ?? null,
          reviewerId: project.defaultReviewer?.id ?? null,
          parentTaskId: parentTaskId ?? null,
          order: taskOrder,
        },
        include: { team: { select: { identifier: true } } },
      })
    })

    const taskWithId = { ...task, teamIdentifier: task.team.identifier }

    // ── Fire-and-forget: task_created Slack channel notification ─────────────
    const taskIdentifier = `${task.team.identifier}-${task.number}`
    const taskUrl = `${process.env.NEXT_PUBLIC_APP_URL}/workspace/${project.workspace?.slug ?? ''}/tasks/${taskIdentifier}`
    waitUntil(
      sendChannelNotification(
        project.workspaceId,
        'task_created',
        {
          taskId: task.id,
          taskTitle: task.title,
          taskIdentifier,
          taskUrl,
        },
        id
      )
    )

    // ── Fire-and-forget: notify assignee if task was created with one ─────────
    if (assigneeId) {
      prisma.workspaceMember
        .findUnique({ where: { id: assigneeId }, select: { clerkId: true } })
        .then(assignee => {
          if (!assignee || assignee.clerkId === userId) return
          return prisma.notification.create({
            data: {
              workspaceId: project.workspaceId,
              recipientId: assignee.clerkId,
              type: 'TASK_ASSIGNED' as const,
              taskId: task.id,
              actorId: userId,
            },
          })
        })
        .catch(err =>
          console.error('[notify] TASK_ASSIGNED (create) failed:', err)
        )
    }

    return NextResponse.json({ task: taskWithId }, { status: 201 })
  } catch (error) {
    console.error('POST /api/projects/[id]/tasks error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
