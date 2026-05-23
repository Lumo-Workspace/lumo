import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { loadProjectAndMember } from '@/lib/api/helpers'
import { milestoneService } from '@/lib/services/milestone.service'

interface Params {
  params: Promise<{ id: string; slug: string }>
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { id, slug } = await params

    const result = await loadProjectAndMember(id, identity.clerkId)
    if (result instanceof NextResponse) return result
    const { member } = result

    const milestone = await milestoneService.getMilestoneBySlug(
      id,
      slug,
      member.id
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
