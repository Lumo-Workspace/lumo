import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireIdentity } from '@/lib/auth'
import { updateProjectSchema } from '@/lib/validation/schemas'
import { loadProjectAndMember, zodError } from '@/lib/api/helpers'
import { projectService } from '@/lib/services'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/projects/[id] — Get a single project with its task/view count.
 * Ideas are only accessible to their creator.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const result = await loadProjectAndMember(id, userId)
    if (result instanceof NextResponse) return result
    const { member } = result

    const project = await projectService.getProject(id, member.id)

    return NextResponse.json({ project })
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

/**
 * PATCH /api/projects/[id] — Update a project.
 * Ideas can only be edited by their creator. Browser session or CLI bearer
 * (LUM-821: `lumo project update`); the service 404s a project outside the
 * caller's workspace.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { id } = await params

    const body = await request.json()
    const parsed = updateProjectSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const updated = await projectService.updateProject(
      id,
      identity.workspaceSlug,
      identity.memberId,
      parsed.data
    )

    return NextResponse.json({ project: updated })
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

/**
 * DELETE /api/projects/[id] — Delete a project (cascades to tasks, views).
 * Ideas can only be deleted by their creator.
 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const result = await loadProjectAndMember(id, userId)
    if (result instanceof NextResponse) return result
    const { member, workspaceSlug } = result

    await projectService.deleteProject(id, workspaceSlug, member.id)

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
