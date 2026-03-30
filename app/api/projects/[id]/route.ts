import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth'
import { updateProjectSchema } from '@/lib/validation/schemas'
import { loadProjectAndMember, zodError } from '@/lib/api/helpers'

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
    const { project, member } = result

    // Draft ideas are private — only the creator can view them
    if (project.isIdea && project.createdByMemberId !== member.id) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const projectWithCount = await prisma.project.findUnique({
      where: { id },
      include: { _count: { select: { tasks: true, views: true } } },
    })

    return NextResponse.json({ project: projectWithCount })
  } catch (error) {
    console.error('GET /api/projects/[id] error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/projects/[id] — Update a project.
 * Ideas can only be edited by their creator.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const result = await loadProjectAndMember(id, userId)
    if (result instanceof NextResponse) return result
    const { project, member } = result

    if (project.isIdea && project.createdByMemberId !== member.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = updateProjectSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const data: Record<string, unknown> = {}
    if (parsed.data.name !== undefined) data.name = parsed.data.name
    if (parsed.data.description !== undefined)
      data.description = parsed.data.description
    if (parsed.data.isIdea !== undefined) data.isIdea = parsed.data.isIdea
    if (parsed.data.defaultReviewerId !== undefined) {
      // Validate reviewer belongs to this workspace
      if (parsed.data.defaultReviewerId !== null) {
        const reviewer = await prisma.workspaceMember.findUnique({
          where: { id: parsed.data.defaultReviewerId },
        })
        if (!reviewer || reviewer.workspaceId !== project.workspaceId) {
          return NextResponse.json(
            { error: 'Reviewer is not a member of this workspace' },
            { status: 400 }
          )
        }
      }
      data.defaultReviewerId = parsed.data.defaultReviewerId
    }
    const updated = await prisma.project.update({ where: { id }, data })

    return NextResponse.json({ project: updated })
  } catch (error) {
    console.error('PATCH /api/projects/[id] error:', error)
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
    const { project, member } = result

    if (project.isIdea && project.createdByMemberId !== member.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await prisma.project.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE /api/projects/[id] error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
