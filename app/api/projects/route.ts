import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { createProjectSchema } from '@/lib/validation/schemas'

/**
 * GET /api/projects
 * - isIdea=false  → visible to all workspace members
 * - isIdea=true   → only visible to the member who created it (private draft)
 */
export async function GET() {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await getUserWorkspace(userId)
    if (!ws) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    }

    const projects = await prisma.project.findMany({
      where: {
        workspaceId: ws.workspaceId,
        OR: [
          { isIdea: false },
          { isIdea: true, createdByMemberId: ws.member.id },
        ],
      },
      include: {
        _count: { select: { tasks: true } },
        // Count in-progress tasks without an extra query
        tasks: {
          where: { status: 'IN_PROGRESS' },
          select: { id: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    })

    // Shape response: replace raw tasks array with inProgressCount
    const shaped = projects.map(({ tasks, ...p }) => ({
      ...p,
      inProgressCount: tasks.length,
    }))

    return NextResponse.json({ projects: shaped })
  } catch (error) {
    console.error('GET /api/projects error:', error)
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

    const ws = await getUserWorkspace(userId)
    if (!ws) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    }

    const body = await request.json()
    const parsed = createProjectSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      )
    }

    const result = await prisma.$transaction(async tx => {
      const project = await tx.project.create({
        data: {
          workspaceId: ws.workspaceId,
          createdByMemberId: ws.member.id,
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          isIdea: parsed.data.isIdea,
        },
      })

      // Create default Document view for every new project
      await tx.view.create({
        data: {
          workspaceId: ws.workspaceId,
          projectId: project.id,
          name: 'Document',
          type: 'DOCUMENT',
          isDefault: true,
        },
      })

      return project
    })

    return NextResponse.json({ project: result }, { status: 201 })
  } catch (error) {
    console.error('POST /api/projects error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
