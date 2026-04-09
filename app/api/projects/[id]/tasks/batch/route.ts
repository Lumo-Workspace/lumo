import { waitUntil } from '@vercel/functions'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { loadProjectAndMember, zodError } from '@/lib/api/helpers'
import { batchCreateTasksSchema } from '@/lib/validation/schemas'
import { pushTaskEvent, pushProjectEvent } from '@/lib/pusher/server'
import { taskRepository } from '@/lib/repositories'

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
  const parents = await taskRepository.findByIds(parentIds, projectId)
  const validParentIds = new Set(parents.map(p => p.id))
  for (const t of taskInputs) {
    if (!validParentIds.has(t.parentTaskId)) {
      return NextResponse.json(
        { error: `Parent task ${t.parentTaskId} not found in this project` },
        { status: 400 }
      )
    }
  }

  const tasks = await taskRepository.batchCreateWithSequence(
    projectId,
    project.teamId,
    taskInputs
  )

  // ── Fire-and-forget: Pusher real-time events ─────────────────────────────
  // Notify parent task detail panels that children changed, plus board-level update
  const affectedParentIds = [...new Set(taskInputs.map(t => t.parentTaskId))]
  waitUntil(
    Promise.all([
      ...affectedParentIds.map(parentId =>
        pushTaskEvent(parentId, { type: 'task:updated', fields: ['children'] })
      ),
      ...tasks.map(t =>
        pushProjectEvent(projectId, {
          type: 'task:updated',
          taskId: t.id,
          fields: ['title', 'status', 'priority', 'parentTaskId'],
        })
      ),
    ])
  )

  return NextResponse.json({ tasks }, { status: 201 })
}
