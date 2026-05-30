import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { taskRepository, pullRequestRepository } from '@/lib/repositories'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; number: string }> }

function isLikelyCuid(segment: string): boolean {
  return /^c[a-z0-9]{24}$/.test(segment)
}

function parseIdentifier(
  segment: string
): { teamIdentifier: string; number: number } | null {
  const m = /^([A-Za-z]+)-(\d+)$/.exec(segment)
  if (!m) return null
  return { teamIdentifier: m[1]!.toUpperCase(), number: parseInt(m[2]!, 10) }
}

async function resolveTask(rawId: string, workspaceId: string) {
  if (isLikelyCuid(rawId)) {
    return taskRepository.findByIdForMention(rawId, workspaceId)
  }
  const parsed = parseIdentifier(rawId)
  if (!parsed) return null
  return taskRepository.findByWorkspaceIdentifier(
    workspaceId,
    parsed.teamIdentifier,
    parsed.number
  )
}

function errorResponse(err: unknown, route: string) {
  if (err instanceof Error && 'status' in err) {
    return NextResponse.json(
      { error: err.message },
      { status: (err as Error & { status: number }).status }
    )
  }
  console.error(`${route} error:`, err)
  return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
}

/**
 * GET /api/tasks/[id]/pull-requests/[number]
 * Tier-2 retrieval for the cheap inline PR card (LUM-122).
 *
 * Returns the structured PR record stored by the GitHub sync/webhook pipeline
 * (title, state, ciStatus, branches, author, url, draft/merge/close
 * timestamps). Live diff and review comments require a GitHub installation
 * token and live API calls and are NOT included here — we expose a
 * `liveDiffAvailable: false` flag with a note instead of fabricating a diff.
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const { id: rawId, number: numberRaw } = await params
    const number = Number.parseInt(numberRaw, 10)
    if (!Number.isInteger(number))
      return NextResponse.json({ error: 'Invalid PR number' }, { status: 400 })

    const task = await resolveTask(rawId, identity.workspaceId)
    if (!task)
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    const pr = await pullRequestRepository.findByTaskAndNumber(task.id, number)
    if (!pr) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({
      pullRequest: {
        id: pr.id,
        repo: pr.repo,
        number: pr.number,
        title: pr.title,
        url: pr.url,
        state: pr.state,
        isDraft: pr.isDraft,
        ciStatus: pr.ciStatus,
        authorLogin: pr.authorLogin,
        headBranch: pr.headBranch,
        baseBranch: pr.baseBranch,
        mergedAt: pr.mergedAt,
        closedAt: pr.closedAt,
        createdAt: pr.createdAt,
        updatedAt: pr.updatedAt,
      },
      liveDiffAvailable: false,
      note: 'Live PR diff and review comments require a GitHub integration token and are not included. Returned values are the synced PR record.',
    })
  } catch (err) {
    return errorResponse(err, 'GET /api/tasks/[id]/pull-requests/[number]')
  }
}
