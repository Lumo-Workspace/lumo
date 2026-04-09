import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories/task.repository'
import { githubRepository } from '@/lib/repositories'
import { decrypt } from '@/lib/crypto'

type Params = { params: Promise<{ id: string; branchId: string }> }

const GH_API = 'https://api.github.com'
const GH_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
})

/**
 * DELETE /api/tasks/[id]/branch/[branchId]
 * Query: ?deleteRemote=true  — also delete the branch on GitHub
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id: taskId, branchId } = await params

    // Verify task exists and user is workspace member
    const task = await taskRepository.findWithProjectWorkspaceId(taskId)
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }
    const memberResult = await requireWorkspaceMember(
      task.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    // Verify branch belongs to this task
    const branch = await githubRepository.findTaskBranch(branchId)
    if (!branch || branch.taskId !== taskId) {
      return NextResponse.json(
        { error: 'Branch not linked to this task' },
        { status: 404 }
      )
    }

    // Optionally delete remote branch on GitHub
    const deleteRemote =
      request.nextUrl.searchParams.get('deleteRemote') === 'true'

    if (deleteRemote) {
      const integration = await githubRepository.findIntegrationByRepo(
        task.project.workspaceId,
        branch.repo
      )
      if (integration) {
        const token = decrypt(integration.accessToken)
        const res = await fetch(
          `${GH_API}/repos/${branch.repo}/git/refs/heads/${branch.branchName}`,
          { method: 'DELETE', headers: GH_HEADERS(token) }
        )
        // 422 = branch already deleted or is default branch — not a fatal error
        if (!res.ok && res.status !== 422 && res.status !== 404) {
          const err = await res.json().catch(() => ({}))
          return NextResponse.json(
            {
              error:
                (err as { message?: string }).message ??
                'Failed to delete remote branch',
            },
            { status: 422 }
          )
        }
      }
    }

    // Delete DB record
    await githubRepository.deleteTaskBranch(branchId)

    return NextResponse.json({ success: true })
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
