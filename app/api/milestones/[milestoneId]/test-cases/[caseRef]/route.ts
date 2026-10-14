import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { errorResponse } from '@/lib/api/route-error'
import { milestoneTestCaseService } from '@/lib/services/milestone-test-case.service'
import { updateTestCaseBodySchema } from '@/lib/validation/test-case'

export const runtime = 'nodejs'

type Params = { params: Promise<{ milestoneId: string; caseRef: string }> }

/** GET — one milestone test case with its full run history. */
export async function GET(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  const { milestoneId, caseRef } = await params
  try {
    return NextResponse.json(
      await milestoneTestCaseService.getDetail(
        milestoneId,
        caseRef,
        identity.memberId
      )
    )
  } catch (error) {
    return errorResponse(error)
  }
}

/** PATCH — edit a milestone test case. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  const { milestoneId, caseRef } = await params
  const parsed = updateTestCaseBodySchema.safeParse(
    await request.json().catch(() => null)
  )
  if (!parsed.success) return zodError(parsed)
  try {
    return NextResponse.json(
      await milestoneTestCaseService.update(milestoneId, caseRef, parsed.data, {
        actorMemberId: identity.memberId,
        sourceSessionId: request.headers.get('X-Lumo-Session-Id'),
      })
    )
  } catch (error) {
    return errorResponse(error)
  }
}

/** DELETE — remove a milestone test case. */
export async function DELETE(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  const { milestoneId, caseRef } = await params
  try {
    await milestoneTestCaseService.remove(milestoneId, caseRef, {
      actorMemberId: identity.memberId,
      sourceSessionId: request.headers.get('X-Lumo-Session-Id'),
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
}
