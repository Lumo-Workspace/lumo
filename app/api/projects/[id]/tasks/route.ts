import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { createTaskSchema } from '@/lib/validation/schemas'
import type { Task } from '@prisma/client'

type Params = { params: Promise<{ id: string }> }

// ─── Tree builder ───────────────────────────────────────────────────────────

type TaskWithChildren = Task & { children: TaskWithChildren[] }

function buildTaskTree(tasks: Task[]): TaskWithChildren[] {
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
 * GET /api/projects/[id]/tasks — Get all tasks as a tree.
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

    const memberResult = await requireWorkspaceMember(project.workspaceId, userId)
    if (memberResult instanceof NextResponse) return memberResult

    const tasks = await prisma.task.findMany({
      where: { projectId: id },
      orderBy: { order: 'asc' },
    })

    const tree = buildTaskTree(tasks)

    return NextResponse.json({ tasks: tree })
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

    const project = await prisma.project.findUnique({ where: { id } })
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const memberResult = await requireWorkspaceMember(project.workspaceId, userId)
    if (memberResult instanceof NextResponse) return memberResult

    const body = await request.json()
    const parsed = createTaskSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      )
    }

    const { title, description, status, priority, assigneeId, parentTaskId, order } = parsed.data

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

    const task = await prisma.task.create({
      data: {
        projectId: id,
        title,
        description: description ?? null,
        status,
        priority,
        assigneeId: assigneeId ?? null,
        parentTaskId: parentTaskId ?? null,
        order: taskOrder,
      },
    })

    return NextResponse.json({ task }, { status: 201 })
  } catch (error) {
    console.error('POST /api/projects/[id]/tasks error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
