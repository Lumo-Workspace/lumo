import { waitUntil } from '@vercel/functions'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { createTaskSchema } from '@/lib/validation/schemas'
import { zodError } from '@/lib/api/helpers'
import { sendChannelNotification } from '@/lib/slack/notify'
import { getHumanActorId } from '@/lib/actor'
import { buildTaskUrl, buildTaskIdentifier } from '@/lib/utils/buildTaskUrl'

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
      include: {
        team: { select: { identifier: true } },
        assignee: {
          select: {
            id: true,
            type: true,
            member: { select: { id: true, clerkId: true } },
            agent: { select: { id: true, name: true, avatarColor: true } },
          },
        },
        parent: {
          select: {
            id: true,
            title: true,
            number: true,
            team: { select: { identifier: true } },
          },
        },
        _count: { select: { children: true } },
        children: {
          where: { status: 'DONE' },
          select: { id: true },
        },
      },
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
      parent: t.parent
        ? {
            id: t.parent.id,
            title: t.parent.title,
            number: t.parent.number,
            teamIdentifier: t.parent.team.identifier,
          }
        : null,
      _count: t._count,
      childrenDoneCount: (t.children as { id: string }[])?.length ?? 0,
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
    if (!parsed.success) return zodError(parsed)

    const {
      title,
      description,
      status,
      priority,
      assigneeActorId,
      parentTaskId,
      repositoryId,
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

    // Validate assigneeActorId belongs to the same workspace
    let assigneeIsAgent = false
    if (assigneeActorId) {
      const actor = await prisma.actor.findUnique({
        where: { id: assigneeActorId },
        select: { type: true, workspaceId: true },
      })
      if (!actor || actor.workspaceId !== project.workspaceId) {
        return NextResponse.json(
          { error: 'Assignee is not part of this workspace' },
          { status: 400 }
        )
      }
      assigneeIsAgent = actor.type === 'AGENT'
    }

    const task = await prisma.$transaction(async tx => {
      const { taskSeq } = await tx.team.update({
        where: { id: project.teamId },
        data: { taskSeq: { increment: 1 } },
        select: { taskSeq: true },
      })

      // Resolve default reviewer to actor
      let defaultReviewerActorId: string | null = null
      if (project.defaultReviewer?.id) {
        const reviewerActor = await tx.actor.findUnique({
          where: { memberId: project.defaultReviewer.id },
        })
        defaultReviewerActorId = reviewerActor?.id ?? null
      }

      return tx.task.create({
        data: {
          projectId: id,
          teamId: project.teamId,
          number: taskSeq,
          title,
          description: description ?? null,
          status,
          priority,
          assigneeActorId: assigneeActorId ?? null,
          agentStatus: assigneeIsAgent ? 'SUBMITTED' : null,
          reviewerActorId: defaultReviewerActorId,
          parentTaskId: parentTaskId ?? null,
          repositoryId: repositoryId ?? null,
          order: taskOrder,
        },
        include: {
          team: { select: { identifier: true } },
          assignee: {
            select: {
              id: true,
              type: true,
              member: { select: { id: true, clerkId: true } },
              agent: { select: { id: true, name: true, avatarColor: true } },
            },
          },
        },
      })
    })

    const taskWithId = { ...task, teamIdentifier: task.team.identifier }

    // ── Fire-and-forget: task_created Slack channel notification ─────────────
    const taskIdentifier = buildTaskIdentifier(
      task.team.identifier,
      task.number
    )
    const taskUrl = buildTaskUrl(
      project.workspace?.slug ?? '',
      task.team.identifier,
      task.number
    )
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
    if (assigneeActorId) {
      getHumanActorId(memberResult.id)
        .then(triggerActorId =>
          prisma.actor
            .findUnique({
              where: { id: assigneeActorId },
              select: { type: true, member: { select: { clerkId: true } } },
            })
            .then(actor => {
              if (!actor || actor.type !== 'HUMAN' || !actor.member) return
              if (actor.member.clerkId === userId) return
              return prisma.notification.create({
                data: {
                  workspaceId: project.workspaceId,
                  recipientActorId: assigneeActorId,
                  type: 'TASK_ASSIGNED' as const,
                  taskId: task.id,
                  triggerActorId,
                },
              })
            })
        )
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
