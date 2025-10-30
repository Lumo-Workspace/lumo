import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { validateWorkspaceUrl } from '@/utils/team-utils'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const url = searchParams.get('url')

    if (!url) {
      return NextResponse.json(
        { error: 'URL parameter is required' },
        { status: 400 }
      )
    }

    // Validate format
    const validation = validateWorkspaceUrl(url)
    if (!validation.valid) {
      return NextResponse.json(
        { available: false, valid: false, error: validation.error },
        { status: 200 }
      )
    }

    // Check uniqueness
    const existingTeam = await prisma.team.findUnique({
      where: { workspaceUrl: url },
    })

    return NextResponse.json(
      {
        available: !existingTeam,
        valid: true,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('URL check error:', error)
    return NextResponse.json({ error: 'Failed to check URL' }, { status: 500 })
  }
}
