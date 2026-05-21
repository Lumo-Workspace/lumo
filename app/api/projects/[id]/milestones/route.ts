import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { loadProjectAndMember, zodError } from '@/lib/api/helpers'
import { createMilestoneSchema } from '@/lib/validation/schemas'
import { milestoneService } from '@/lib/services/milestone.service'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'

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
    // Enrich with per-status task counts so the frontend can render
    // progress without an N+1 follow-up from the client.
    const enriched = await Promise.all(
      milestones.map(async m => ({
        ...m,
        taskCounts: await milestoneRepository.countTasksByStatus(m.id),
      }))
    )
    return NextResponse.json({ milestones: enriched })
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
