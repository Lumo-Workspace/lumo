import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { loadProjectForIdentity, zodError } from '@/lib/api/helpers'
import { reorderMilestonesSchema } from '@/lib/validation/schemas'
import { milestoneService } from '@/lib/services/milestone.service'

interface Params {
  params: Promise<{ id: string }>
}

/**
 * PATCH /api/projects/[id]/milestones/reorder
 * Body: { orderedIds: string[] }
 * Rewrites Milestone.sortOrder for every milestone in the project to match the
 * supplied order. orderedIds must list every milestone in the project exactly
 * once (enforced in the service).
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { id } = await params

    const result = await loadProjectForIdentity(id, identity)
    if (result instanceof NextResponse) return result
    const { member } = result

    const body = await request.json()
    const parsed = reorderMilestonesSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    await milestoneService.reorderMilestones(
      id,
      member.id,
      parsed.data.orderedIds
    )
    return NextResponse.json({ ok: true })
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
