import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { getHumanActorId } from '@/lib/actor'
import { milestoneService } from '@/lib/services/milestone.service'

interface Params {
  params: Promise<{ milestoneId: string }>
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { milestoneId } = await params

    const { searchParams } = new URL(request.url)
    const assignedToMe = searchParams.get('assigned') === 'me'

    let assigneeActorId: string | undefined
    if (assignedToMe) {
      const actorId = await getHumanActorId(identity.memberId)
      if (!actorId) {
        return NextResponse.json(
          { error: 'No human actor linked to this member' },
          { status: 401 }
        )
      }
      assigneeActorId = actorId
    }

    const tasks = await milestoneService.listTasks(
      milestoneId,
      identity.memberId,
      {
        ...(assigneeActorId && { assigneeActorId }),
      }
    )

    return NextResponse.json({ tasks })
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
