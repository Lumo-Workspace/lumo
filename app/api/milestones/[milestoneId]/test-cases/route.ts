import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { errorResponse } from '@/lib/api/route-error'
import { milestoneTestCaseService } from '@/lib/services/milestone-test-case.service'
import { createTestCaseBodySchema } from '@/lib/validation/test-case'

export const runtime = 'nodejs'

type Params = { params: Promise<{ milestoneId: string }> }

/** GET — the milestone's test cases (full run history each) + the close gate (LUM-1135). */
export async function GET(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  const { milestoneId } = await params
  try {
    return NextResponse.json(
      await milestoneTestCaseService.list(milestoneId, identity.memberId)
    )
  } catch (error) {
    return errorResponse(error)
  }
}

/** POST — add a milestone test case. Locked once the milestone is completed / archived. */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  const { milestoneId } = await params
  const parsed = createTestCaseBodySchema.safeParse(
    await request.json().catch(() => null)
  )
  if (!parsed.success) return zodError(parsed)
  try {
    return NextResponse.json(
      await milestoneTestCaseService.create(milestoneId, parsed.data, {
        actorMemberId: identity.memberId,
        sourceSessionId: request.headers.get('X-Lumo-Session-Id'),
      })
    )
  } catch (error) {
    return errorResponse(error)
  }
}
