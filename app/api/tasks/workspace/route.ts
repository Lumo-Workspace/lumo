import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { taskQueryService } from '@/lib/services/task-query.service'
import { workspaceTaskFiltersSchema } from '@/lib/validation/schemas'
import { zodError } from '@/lib/api/helpers'
import { WORKSPACE_TASK_QUERY_LIMIT } from '@/lib/repositories/task.repository'

function parseList(
  searchParams: URLSearchParams,
  key: string
): string[] | undefined {
  const raw = searchParams.get(key)
  if (!raw) return undefined
  const arr = raw.split(',').filter(Boolean)
  return arr.length ? arr : undefined
}

export async function GET(request: NextRequest) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const { searchParams } = new URL(request.url)
    const parsed = workspaceTaskFiltersSchema.safeParse({
      projectIds: parseList(searchParams, 'projectIds'),
      milestoneIds: parseList(searchParams, 'milestoneIds'),
      statuses: parseList(searchParams, 'statuses'),
      priorities: parseList(searchParams, 'priorities'),
      assigneeActorIds: parseList(searchParams, 'assigneeActorIds'),
      tagIds: parseList(searchParams, 'tagIds'),
      sprintIds: parseList(searchParams, 'sprintIds'),
      unassigned: searchParams.get('unassigned') === '1' ? true : undefined,
      q: searchParams.get('q') ?? undefined,
      dueAfter: searchParams.get('dueAfter') ?? undefined,
      dueBefore: searchParams.get('dueBefore') ?? undefined,
    })
    if (!parsed.success) return zodError(parsed)

    const tasks = await taskQueryService.findForWorkspace(
      identity.workspaceId,
      parsed.data
    )

    return NextResponse.json({
      tasks,
      truncated: tasks.length >= WORKSPACE_TASK_QUERY_LIMIT,
    })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
