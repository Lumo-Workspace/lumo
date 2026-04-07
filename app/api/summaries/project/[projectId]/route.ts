import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { loadProjectAndMember } from '@/lib/api/helpers'
import { prisma } from '@/lib/db/prisma'
import { getSummarySchema } from '@/lib/validation/schemas'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const { projectId } = await params

    const projectResult = await loadProjectAndMember(projectId, userId)
    if (projectResult instanceof NextResponse) return projectResult

    const { searchParams } = new URL(request.url)
    const parsed = getSummarySchema.safeParse({
      limit: searchParams.get('limit') ?? undefined,
      before: searchParams.get('before') ?? undefined,
    })
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      )
    }

    const { limit, before } = parsed.data

    const summaries = await prisma.projectSummary.findMany({
      where: {
        projectId,
        ...(before ? { generatedAt: { lt: new Date(before) } } : {}),
      },
      orderBy: { generatedAt: 'desc' },
      take: limit,
    })

    return NextResponse.json({ summaries })
  } catch (error) {
    console.error('GET /api/summaries/project/[projectId] error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch project summaries' },
      { status: 500 }
    )
  }
}
