import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { memoryManagementService } from '@/lib/services'
import { createMemoryBodySchema } from '@/lib/validation/memory'
import { parseMemoryContent } from '@/lib/memory/schemas'
import { zodError } from '@/lib/api/helpers'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { id } = await params

    const task = await taskRepository.findWithProjectWorkspaceId(id)
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (task.project.workspaceId !== identity.workspaceId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const raw = await request.json()
    const parsed = createMemoryBodySchema.safeParse(raw)
    if (!parsed.success) return zodError(parsed)

    let content
    try {
      content = parseMemoryContent(parsed.data.category, parsed.data.content)
    } catch {
      return NextResponse.json(
        { error: 'Content does not match the category schema' },
        { status: 400 }
      )
    }

    const result = await memoryManagementService.createForTask({
      taskId: id,
      projectId: task.projectId,
      workspaceId: identity.workspaceId,
      category: parsed.data.category,
      content,
      actorMemberId: identity.memberId,
      agent: parsed.data.agent,
    })
    return NextResponse.json(
      { memory: result.memory, outcome: result.outcome },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    console.error('POST /api/tasks/[id]/memories error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { id } = await params
    const task = await taskRepository.findWithProjectWorkspaceId(id)
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (task.project.workspaceId !== identity.workspaceId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const memories = await memoryManagementService.listTaskMemories(id)
    return NextResponse.json({ memories })
  } catch (error) {
    console.error('GET /api/tasks/[id]/memories error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
