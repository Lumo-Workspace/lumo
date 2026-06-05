import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { milestoneService } from '@/lib/services/milestone.service'
import type { MilestoneListFilter } from '@/lib/repositories/milestone.repository'

const VALID_FILTERS: readonly MilestoneListFilter[] = ['active', 'all', 'archived']

export async function GET(request: NextRequest) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { searchParams } = new URL(request.url)
    const raw = searchParams.get('filter')
    const filter: MilestoneListFilter =
      raw && (VALID_FILTERS as readonly string[]).includes(raw)
        ? (raw as MilestoneListFilter)
        : 'active'
    const milestones = await milestoneService.listByWorkspace(
      identity.workspaceId,
      filter
    )
    return NextResponse.json({ milestones })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
