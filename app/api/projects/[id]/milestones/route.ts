import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { loadProjectForIdentity, zodError } from '@/lib/api/helpers'
import {
  createMilestoneSchema,
  listMilestonesQuerySchema,
} from '@/lib/validation/schemas'
import { milestoneService } from '@/lib/services/milestone.service'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { milestoneHealthFromCounts } from '@/lib/summaries/milestone-health'

interface Params {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { id } = await params

    const result = await loadProjectForIdentity(id, identity)
    if (result instanceof NextResponse) return result
    const { member } = result

    const searchParams = new URL(request.url).searchParams
    const parsedQuery = listMilestonesQuerySchema.safeParse({
      filter: searchParams.get('filter') ?? undefined,
      search: searchParams.get('search') ?? undefined,
    })
    if (!parsedQuery.success) return zodError(parsedQuery)

    const milestones = await milestoneService.listMilestones(
      id,
      member.id,
      parsedQuery.data.filter,
      parsedQuery.data.search
    )
    // Enrich with per-status task counts (so the frontend can render progress
    // without an N+1 follow-up) and a target-date health light.
    const now = new Date()
    const enriched = await Promise.all(
      milestones.map(async m => {
        const taskCounts = await milestoneRepository.countTasksByStatus(m.id)
        return {
          ...m,
          taskCounts,
          health: milestoneHealthFromCounts(m, taskCounts, now),
        }
      })
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
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { id } = await params

    const result = await loadProjectForIdentity(id, identity)
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
