// app/api/tasks/[id]/branch/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { getHumanActorId } from '@/lib/actor'
import { taskRepository } from '@/lib/repositories'
import { githubService } from '@/lib/services/github.service'
import { dispatchEvents } from '@/lib/events/dispatcher'
import type { TaskActivityEvent } from '@/lib/events/types/task-activity'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/tasks/:id/branch
 * Body: { repo: "owner/repo", branchName: "lumo/ENG-123-fix-bug" }
 *
 * Creates a GitHub branch from main, returns { branchName, url }.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id: taskId } = await params

    const body = await request.json()
    const repo: string = body.repo ?? ''
    const branchName: string = body.branchName ?? ''

    if (!repo || !branchName) {
      return NextResponse.json(
        { error: 'repo and branchName are required' },
        { status: 400 }
      )
    }

    if (!/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(repo)) {
      return NextResponse.json(
        { error: 'repo must be in owner/repo format' },
        { status: 400 }
      )
    }

    // Load task + workspace membership check
    const task = await taskRepository.findWithProjectWorkspaceId(taskId)
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const memberResult = await requireWorkspaceMember(
      task.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    const result = await githubService.createBranchForTask(
      taskId,
      repo,
      branchName,
      task.project.workspaceId
    )

    // Fire-and-forget activity recording
    const triggerActorId = await getHumanActorId(memberResult.id)
    waitUntil(
      dispatchEvents([
        {
          type: 'task:branch_created',
          taskId,
          projectId: task.projectId ?? '',
          actorId: triggerActorId ?? '',
          branchName,
        } satisfies TaskActivityEvent,
      ])
    )

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    const err = error as Error & { status?: number }
    if (err.status === 422) {
      return NextResponse.json({ error: err.message }, { status: 422 })
    }
    console.error('POST /api/tasks/[id]/branch error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
