import { waitUntil } from '@vercel/functions'
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { createTaskSchema } from '@/lib/validation/schemas'
import { zodError } from '@/lib/api/helpers'
import { sendChannelNotification } from '@/lib/slack/notify'
import { getHumanActorId } from '@/lib/actor'
import { buildTaskUrl, buildTaskIdentifier } from '@/lib/utils/buildTaskUrl'
import {
  taskRepository,
  projectRepository,
  viewRepository,
  notificationRepository,
} from '@/lib/repositories'

type Params = { params: Promise<{ id: string }> }

// ─── Tree builder ───────────────────────────────────────────────────────────

interface TaskNode {
  id: string
  parentTaskId: string | null
  viewOrder: number | null
  teamIdentifier: string
  [key: string]: unknown
}
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

    const project = await projectRepository.findByIdSimple(id)
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const memberResult = await requireWorkspaceMember(
      project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    const tasks = await taskRepository.findByProjectWithDetails(id)

    // Lazy-create KANBAN view for this project
    const kanbanView = await viewRepository.findOrCreateProjectKanban(
      project.workspaceId,
      id
    )

    // Build viewOrder map
    const taskOrders = await viewRepository.findTaskOrders(kanbanView.id)
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
      childrenDoneCount: Array.isArray(t.children) ? t.children.length : 0,
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

    const project = await projectRepository.findByIdWithDefaults(id)
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
      dueDate,
    } = parsed.data

    // Validate parentTaskId belongs to the same project
    if (parentTaskId) {
      const parent = await taskRepository.findWithProject(parentTaskId)
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
      const maxOrderTask = await taskRepository.findMaxOrder(
        id,
        parentTaskId ?? null
      )
      taskOrder = (maxOrderTask?.order ?? 0) + 1
    }

    // Validate assigneeActorId belongs to the same workspace
    let assigneeIsAgent = false
    if (assigneeActorId) {
      const actor = await taskRepository.findActorById(assigneeActorId)
      if (!actor || actor.workspaceId !== project.workspaceId) {
        return NextResponse.json(
          { error: 'Assignee is not part of this workspace' },
          { status: 400 }
        )
      }
      assigneeIsAgent = actor.type === 'AGENT'
    }

    const task = await taskRepository.createWithSequence({
      projectId: id,
      teamId: project.teamId,
      title,
      description: description ?? null,
      status,
      priority,
      assigneeActorId: assigneeActorId ?? null,
      agentStatus: assigneeIsAgent ? 'SUBMITTED' : null,
      reviewerActorId: null,
      parentTaskId: parentTaskId ?? null,
      repositoryId: repositoryId ?? null,
      order: taskOrder,
      dueDate: dueDate ?? null,
      defaultReviewerMemberId: project.defaultReviewer?.id ?? null,
    })

    const taskWithId = task

    // ── Fire-and-forget: task_created Slack channel notification ─────────────
    const taskIdentifier = buildTaskIdentifier(task.teamIdentifier, task.number)
    const taskUrl = buildTaskUrl(
      project.workspace?.slug ?? '',
      task.teamIdentifier,
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
          taskRepository.findActorWithMember(assigneeActorId).then(actor => {
            if (!actor || actor.type !== 'HUMAN' || !actor.member) return
            if (actor.member.clerkId === userId) return
            return notificationRepository.create({
              workspaceId: project.workspaceId,
              recipientActorId: assigneeActorId,
              type: 'TASK_ASSIGNED' as const,
              taskId: task.id,
              triggerActorId,
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
