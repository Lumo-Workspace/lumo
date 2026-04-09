import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { linkPullRequestSchema } from '@/lib/validation/schemas'
import { zodError } from '@/lib/api/helpers'
import { taskService } from '@/lib/services'
import { taskRepository } from '@/lib/repositories/task.repository'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/tasks/[id]/pull-requests/link — Link a PR to a task.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const task = await taskRepository.findWithProject(id)
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }
    const memberResult = await requireWorkspaceMember(
      task.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    const body = await request.json()
    const parsed = linkPullRequestSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const { prId, url, force } = parsed.data
    const input: { prId?: string; url?: string; force?: boolean } = { force }
    if (prId !== undefined) input.prId = prId
    if (url !== undefined) input.url = url
    const result = await taskService.linkPullRequest(id, input)

    return NextResponse.json({ pullRequest: result })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      const status = (error as Error & { status: number }).status
      const response: Record<string, unknown> = { error: error.message }
      if ('conflictTask' in error) {
        response.conflictTask = (
          error as Error & { conflictTask: unknown }
        ).conflictTask
      }
      return NextResponse.json(response, { status })
    }
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
