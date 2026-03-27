// app/api/tasks/[id]/branch/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'

type Params = { params: Promise<{ id: string }> }

const GH_API = 'https://api.github.com'
const GH_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
})

/**
 * POST /api/tasks/:id/branch
 * Body: { repo: "owner/repo", branchName: "lumo/ENG-123-fix-bug" }
 *
 * Creates a GitHub branch from main, saves repo to project.githubRepo,
 * returns { branchName, url }.
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
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { project: { select: { id: true, workspaceId: true } } },
    })
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const memberResult = await requireWorkspaceMember(
      task.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    // Find a GitHub integration for this workspace that has the repo authorized
    const integration = await prisma.gitHubIntegration.findFirst({
      where: {
        workspaceId: task.project.workspaceId,
        repositories: { has: repo },
      },
    })
    if (!integration) {
      return NextResponse.json(
        { error: 'Repository not connected. Add it in Integrations settings.' },
        { status: 422 }
      )
    }

    const token = decrypt(integration.accessToken)
    const slash = repo.indexOf('/')
    const owner = repo.slice(0, slash)
    const repoName = repo.slice(slash + 1)
    const headers = GH_HEADERS(token)

    // Get SHA of main branch
    const refRes = await fetch(
      `${GH_API}/repos/${owner}/${repoName}/git/refs/heads/main`,
      { headers }
    )
    if (!refRes.ok) {
      const err = await refRes.json().catch(() => ({}))
      return NextResponse.json(
        {
          error:
            (err as { message?: string }).message ??
            'Could not find main branch on GitHub',
        },
        { status: 422 }
      )
    }
    const refData = await refRes.json()
    const sha: string | undefined = refData?.object?.sha
    if (!sha) {
      return NextResponse.json(
        { error: 'Could not find main branch on GitHub' },
        { status: 422 }
      )
    }

    // Create the branch
    const createRes = await fetch(
      `${GH_API}/repos/${owner}/${repoName}/git/refs`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha }),
      }
    )
    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}))
      return NextResponse.json(
        {
          error:
            (err as { message?: string }).message ?? 'Failed to create branch',
        },
        { status: 422 }
      )
    }

    const createdBranch = await prisma.taskBranch.create({
      data: { taskId, repo, branchName },
    })

    // Save repo to project for next time (fire-and-forget)
    prisma.project
      .update({
        where: { id: task.project.id },
        data: { githubRepo: repo },
      })
      .catch(err =>
        console.error('[branch] failed to save project.githubRepo:', err)
      )

    const url = `https://github.com/${repo}/tree/${branchName}`
    return NextResponse.json(
      { branchName, url, branch: createdBranch },
      { status: 201 }
    )
  } catch (error) {
    console.error('POST /api/tasks/[id]/branch error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
