import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireIdentity } from '@/lib/auth'
import { requireUserWorkspace, zodError } from '@/lib/api/helpers'
import { createProjectSchema } from '@/lib/validation/schemas'
import { projectService } from '@/lib/services'

/**
 * GET /api/projects
 * - isIdea=false  → visible to all workspace members
 * - isIdea=true   → only visible to the member who created it (private draft)
 *
 * Accepts both Clerk sessions (browser) and bearer tokens (CLI).
 */
export async function GET(request: NextRequest) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const projects = await projectService.listProjects(
      identity.workspaceId,
      identity.memberId
    )

    return NextResponse.json({ projects })
  } catch {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/projects — Create a project (also creates default Document view).
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireUserWorkspace(userId)
    if (ws instanceof NextResponse) return ws

    const body = await request.json()
    const parsed = createProjectSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const project = await projectService.createProject(
      ws.workspaceId,
      ws.workspace.slug,
      ws.member.id,
      parsed.data
    )

    return NextResponse.json({ project }, { status: 201 })
  } catch {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
