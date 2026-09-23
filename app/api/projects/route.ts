import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
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
 * Browser session or CLI bearer (LUM-821: `lumo project create`).
 */
export async function POST(request: NextRequest) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const body = await request.json()
    const parsed = createProjectSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const project = await projectService.createProject(
      identity.workspaceId,
      identity.workspaceSlug,
      identity.memberId,
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
