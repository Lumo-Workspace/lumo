import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { milestoneService } from '@/lib/services/milestone.service'

interface Params {
  params: Promise<{ milestoneId: string }>
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { milestoneId } = await params

    const milestone = await milestoneService.unarchiveMilestone(
      milestoneId,
      identity.memberId
    )
    return NextResponse.json({ milestone })
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
