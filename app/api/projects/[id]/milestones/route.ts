import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { loadProjectAndMember, zodError } from '@/lib/api/helpers'
import { createMilestoneSchema } from '@/lib/validation/schemas'
import { milestoneService } from '@/lib/services/milestone.service'

interface Params {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const result = await loadProjectAndMember(id, userId)
    if (result instanceof NextResponse) return result
    const { member } = result

    const milestones = await milestoneService.listMilestones(id, member.id)
    return NextResponse.json({ milestones })
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

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const result = await loadProjectAndMember(id, userId)
    if (result instanceof NextResponse) return result
    const { member } = result

    const body = await request.json()
    const parsed = createMilestoneSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const milestone = await milestoneService.createMilestone(
      id,
      member.id,
      parsed.data
    )
    return NextResponse.json({ milestone }, { status: 201 })
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
