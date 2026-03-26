import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { decrypt } from '@/lib/crypto'

/**
 * GET /api/github/repos?workspaceUrl={slug}
 * Lists all GitHub repos accessible with the stored token.
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const workspaceUrl = request.nextUrl.searchParams.get('workspaceUrl')
    if (!workspaceUrl) {
      return NextResponse.json(
        { error: 'workspaceUrl is required' },
        { status: 400 }
      )
    }

    const ws = await getUserWorkspace(userId)
    if (!ws || ws.workspace.slug !== workspaceUrl) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const integration = await prisma.gitHubIntegration.findUnique({
      where: {
        workspaceId_memberId: {
          workspaceId: ws.workspaceId,
          memberId: ws.member.id,
        },
      },
    })
    if (!integration) {
      return NextResponse.json(
        { error: 'GitHub not connected' },
        { status: 404 }
      )
    }

    const token = decrypt(integration.accessToken)

    const res = await fetch(
      'https://api.github.com/user/repos?per_page=100&sort=updated',
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    )

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch repos from GitHub' },
        { status: 502 }
      )
    }

    const data = await res.json()
    const repos = (
      data as Array<{
        full_name: string
        name: string
        private: boolean
        updated_at: string
      }>
    ).map(r => ({
      fullName: r.full_name,
      name: r.name,
      private: r.private,
      updatedAt: r.updated_at,
    }))

    return NextResponse.json({ repos })
  } catch (error) {
    console.error('GET /api/github/repos error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/github/repos?workspaceUrl={slug}
 * Updates the list of authorized repositories for the integration.
 */
export async function PATCH(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const workspaceUrl = request.nextUrl.searchParams.get('workspaceUrl')
    if (!workspaceUrl) {
      return NextResponse.json(
        { error: 'workspaceUrl is required' },
        { status: 400 }
      )
    }

    const ws = await getUserWorkspace(userId)
    if (!ws || ws.workspace.slug !== workspaceUrl) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const repositories: string[] = Array.isArray(body.repositories)
      ? body.repositories
      : []

    const updated = await prisma.gitHubIntegration.update({
      where: {
        workspaceId_memberId: {
          workspaceId: ws.workspaceId,
          memberId: ws.member.id,
        },
      },
      data: { repositories },
      select: { repositories: true },
    })

    return NextResponse.json({ repositories: updated.repositories })
  } catch (error) {
    console.error('PATCH /api/github/repos error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
