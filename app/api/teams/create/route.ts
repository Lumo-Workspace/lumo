import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/config'
import { prisma } from '@/lib/db/prisma'
import { generateWorkspaceSlug, validateWorkspaceUrl } from '@/utils/team-utils'

export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user already has a team
    const existingMembership = await prisma.teamMember.findFirst({
      where: { userId: session.user.id },
    })

    if (existingMembership) {
      return NextResponse.json(
        { error: 'You already belong to a team' },
        { status: 400 }
      )
    }

    // Parse request body
    const body = await request.json()
    const {
      teamName,
      workspaceUrl: customUrl,
      teamSize,
    } = body as {
      teamName: string
      workspaceUrl?: string
      teamSize?: string
    }

    // Validate team name
    if (
      !teamName ||
      typeof teamName !== 'string' ||
      teamName.trim().length < 2
    ) {
      return NextResponse.json(
        { error: 'Team name must be at least 2 characters' },
        { status: 400 }
      )
    }

    if (teamName.trim().length > 100) {
      return NextResponse.json(
        { error: 'Team name must be less than 100 characters' },
        { status: 400 }
      )
    }

    // Validate optional teamSize against planned enum keys
    const allowedSizes: readonly string[] = [
      'ONE',
      'TWO_TO_FIVE',
      'SIX_TO_TWENTY',
      'TWENTY_ONE_TO_FIFTY',
      'FIFTY_ONE_TO_TWO_HUNDRED',
      'TWO_HUNDRED_PLUS',
    ]
    if (teamSize && !allowedSizes.includes(teamSize)) {
      return NextResponse.json({ error: 'Invalid team size' }, { status: 400 })
    }

    // Generate or validate workspace URL
    const workspaceUrl = customUrl || generateWorkspaceSlug(teamName)

    // Validate URL format
    const validation = validateWorkspaceUrl(workspaceUrl)
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    // Check for URL uniqueness
    const existingTeam = await prisma.team.findUnique({
      where: { workspaceUrl },
    })

    if (existingTeam) {
      return NextResponse.json(
        {
          error: 'This workspace URL is already taken',
        },
        { status: 400 }
      )
    }

    // Create team, workspace, and membership in a transaction
    const result = await prisma.$transaction(async tx => {
      // Create team
      const team = await tx.team.create({
        data: {
          name: teamName.trim(),
          workspaceUrl,
        },
      })

      // Create workspace
      const workspace = await tx.workspace.create({
        data: {
          teamId: team.id,
          settings: teamSize ? { teamSize } : {},
        },
      })

      // Create team membership
      const membership = await tx.teamMember.create({
        data: {
          userId: session.user.id,
          teamId: team.id,
          role: 'owner',
        },
      })

      return { team, workspace, membership }
    })

    return NextResponse.json(
      {
        success: true,
        team: {
          id: result.team.id,
          name: result.team.name,
          workspaceUrl: result.team.workspaceUrl,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create team' },
      { status: 500 }
    )
  }
}
