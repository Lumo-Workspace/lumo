import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { createTaskSchema } from '@/lib/validation/schemas'
import { zodError } from '@/lib/api/helpers'
import { getHumanActorId } from '@/lib/actor'
import {
  taskRepository,
  projectRepository,
  viewRepository,
} from '@/lib/repositories'
import { taskService } from '@/lib/services/task.service'
import { liftTaskTags } from '@/lib/api/task-shape'

type Params = { params: Promise<{ id: string }> }

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * GET /api/projects/[id]/tasks — Get all tasks, with per-view ordering.
 * Also lazy-creates the KANBAN view for the project on first access.
 */
export async function GET(request: NextRequest, { params }: Params) {
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

    // Parse optional sprintId filter:
    //   ?sprintId=<id>   → tasks in that sprint
    //   ?sprintId=null   → backlog tasks (sprintId IS NULL)
    //   (omitted)        → all tasks (no sprint filter)
    const { searchParams } = new URL(request.url)
    const sprintIdParam = searchParams.get('sprintId')
    const sprintId: string | null | undefined =
      sprintIdParam === null
        ? undefined
        : sprintIdParam === 'null'
          ? null
          : sprintIdParam

    // Parse optional milestoneId filter (same semantics as sprintId).
    const milestoneIdParam = searchParams.get('milestoneId')
    const milestoneId: string | null | undefined =
      milestoneIdParam === null
        ? undefined
        : milestoneIdParam === 'null'
          ? null
          : milestoneIdParam

    const tasks = await taskRepository.findByProjectWithDetails(
      id,
      sprintId,
      milestoneId
    )

    // Lazy-create KANBAN view for this project
    const kanbanView = await viewRepository.findOrCreateProjectKanban(
      project.workspaceId,
      id
    )

    // Build viewOrder map
    const taskOrders = await viewRepository.findTaskOrders(kanbanView.id)
    const orderMap = new Map(taskOrders.map(o => [o.taskId, o.order]))

    // Merge viewOrder into tasks
    const tasksWithOrder = tasks.map(t => ({
      ...liftTaskTags(t),
      teamIdentifier: t.team.identifier,
      viewOrder: orderMap.get(t.id) ?? null,
    }))

    return NextResponse.json({
      tasks: tasksWithOrder,
      kanbanViewId: kanbanView.id,
    })
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
    const { id: projectId } = await params

    const project = await projectRepository.findByIdSimple(projectId)
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

    const actorId = await getHumanActorId(memberResult.id)
    const result = await taskService.createTask(
      projectId,
      parsed.data,
      actorId ?? '',
      userId
    )

    return NextResponse.json({ task: result.task }, { status: 201 })
  } catch (error) {
    const status =
      error instanceof Error && 'status' in error
        ? (error as Error & { status: number }).status
        : 500
    const message =
      status === 500 ? 'Internal Server Error' : (error as Error).message
    if (status === 500) {
      console.error('POST /api/projects/[id]/tasks error:', error)
    }
    return NextResponse.json({ error: message }, { status })
  }
}
