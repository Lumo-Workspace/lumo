import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth'
import { loadProjectAndMember, zodError } from '@/lib/api/helpers'
import { batchCreateTasksSchema } from '@/lib/validation/schemas'

type Params = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Params) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult
  const { id: projectId } = await params

  const result = await loadProjectAndMember(projectId, userId)
  if (result instanceof NextResponse) return result
  const { project } = result

  const body = await request.json()
  const parsed = batchCreateTasksSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  const { tasks: taskInputs } = parsed.data

  // Verify all parentTaskIds belong to this project
  const parentIds = [...new Set(taskInputs.map(t => t.parentTaskId))]
  const parents = await prisma.task.findMany({
    where: { id: { in: parentIds }, projectId },
    select: { id: true },
  })
  const validParentIds = new Set(parents.map(p => p.id))
  for (const t of taskInputs) {
    if (!validParentIds.has(t.parentTaskId)) {
      return NextResponse.json(
        { error: `Parent task ${t.parentTaskId} not found in this project` },
        { status: 400 }
      )
    }
  }

  const tasks = await prisma.$transaction(async tx => {
    // Increment task sequence by the number of tasks to create
    const { taskSeq } = await tx.team.update({
      where: { id: project.teamId },
      data: { taskSeq: { increment: taskInputs.length } },
      select: { taskSeq: true },
    })

    // Count existing children for order calculation
    const siblingCounts = new Map<string, number>()
    for (const parentId of parentIds) {
      const count = await tx.task.count({
        where: { parentTaskId: parentId },
      })
      siblingCounts.set(parentId, count)
    }

    const created = []
    for (let i = 0; i < taskInputs.length; i++) {
      const input = taskInputs[i]!
      const siblingCount = siblingCounts.get(input.parentTaskId) ?? 0

      const task = await tx.task.create({
        data: {
          projectId,
          teamId: project.teamId,
          number: taskSeq - taskInputs.length + 1 + i,
          title: input.title,
          status: input.status,
          priority: input.priority,
          assigneeActorId: input.assigneeActorId ?? null,
          parentTaskId: input.parentTaskId,
          order: siblingCount + i,
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

      created.push({
        ...task,
        teamIdentifier: task.team.identifier,
      })

      siblingCounts.set(input.parentTaskId, siblingCount + i + 1)
    }

    return created
  })

  return NextResponse.json({ tasks }, { status: 201 })
}
