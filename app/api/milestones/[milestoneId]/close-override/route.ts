import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { milestoneCloseOverrideSchema } from '@/lib/validation/schemas'
import { milestoneService } from '@/lib/services/milestone.service'

interface Params {
  params: Promise<{ milestoneId: string }>
}

/**
 * LUM-714: explicit human override of the LUM-643 exit-criteria close gate.
 *
 * Completion is derived from task completion, so there is no status to force —
 * this endpoint exists solely to stamp `completedAt` past unresolved exit
 * criteria and record the override trail. It replaces the old
 * `PATCH ?force=1 {status: 'COMPLETED'}` path.
 *
 * Human-only, exactly like its predecessor: a bearer/agent identity is refused
 * outright rather than silently no-op'd, mirroring the task-level DONE gate
 * (LUM-422 ④).
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    if (identity.source !== 'clerk') {
      return NextResponse.json(
        {
          error:
            'Overriding the milestone close gate is human-only; run the milestone test cases (`lumo milestone testcase run`) instead.',
        },
        { status: 403 }
      )
    }
    const { milestoneId } = await params

    const body = await request.json().catch(() => ({}))
    const parsed = milestoneCloseOverrideSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const milestone = await milestoneService.overrideMilestoneClose(
      milestoneId,
      identity.memberId,
      parsed.data.overrideNote ?? null
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
