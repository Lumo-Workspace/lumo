import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { getSummarySchema } from '@/lib/validation/schemas'

export async function GET(request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const member = await prisma.workspaceMember.findFirst({
      where: { clerkId: userId },
    })

    if (!member) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    }

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

    const summaries = await prisma.workspaceSummary.findMany({
      where: {
        workspaceId: member.workspaceId,
        ...(before ? { generatedAt: { lt: new Date(before) } } : {}),
      },
      orderBy: { generatedAt: 'desc' },
      take: limit,
    })

    return NextResponse.json({ summaries })
  } catch (error) {
    console.error('GET /api/summaries/workspace error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch workspace summaries' },
      { status: 500 }
    )
  }
}
