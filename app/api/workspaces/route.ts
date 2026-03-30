import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { createWorkspaceSchema } from '@/lib/validation/schemas'
import { generateWorkspaceSlug } from '@/lib/workspace/slug'
import { generateIdentifier } from '@/lib/team'

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
    if (!parsed.success) return zodError(parsed)

    const { name } = parsed.data
    const slug = parsed.data.slug ?? generateWorkspaceSlug(name)

    // Create workspace + default team + owner membership in a transaction
    const result = await prisma.$transaction(async tx => {
      const workspace = await tx.workspace.create({
        data: { name, slug },
      })

      const team = await tx.team.create({
        data: {
          workspaceId: workspace.id,
          name,
          identifier: generateIdentifier(name),
          isDefault: true,
        },
      })

      const member = await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          clerkId: userId,
          role: 'OWNER',
        },
      })

      // Add owner to the default team
      await tx.teamMember.create({
        data: { teamId: team.id, memberId: member.id },
      })

      // Create human actor for the owner
      await tx.actor.create({
        data: { workspaceId: workspace.id, type: 'HUMAN', memberId: member.id },
      })

      // Create Coding Agent profile + actor
      const agentProfile = await tx.agentProfile.create({
        data: {
          workspaceId: workspace.id,
          name: 'Coding Agent',
          type: 'CODING',
        },
      })
      await tx.actor.create({
        data: {
          workspaceId: workspace.id,
          type: 'AGENT',
          agentId: agentProfile.id,
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
