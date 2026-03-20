import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth'
import { createWorkspaceSchema } from '@/lib/validation/schemas'
import { generateWorkspaceSlug } from '@/lib/workspace/slug'

/**
 * POST /api/workspaces — Create a workspace and become owner.
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const body = await request.json()
    const parsed = createWorkspaceSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      )
    }

    const { name } = parsed.data
    const slug = parsed.data.slug ?? generateWorkspaceSlug(name)

    // Create workspace + membership in a transaction
    const result = await prisma.$transaction(async tx => {
      const workspace = await tx.workspace.create({
        data: { name, slug },
      })

      const member = await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          clerkId: userId,
          role: 'OWNER',
        },
      })

      return { workspace, member }
    })

    return NextResponse.json(
      { workspace: result.workspace, member: result.member },
      { status: 201 }
    )
  } catch (error) {
    console.error('POST /api/workspaces error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
