import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { errorResponse } from '@/lib/api/route-error'
import { milestoneTestCaseService } from '@/lib/services/milestone-test-case.service'
import { recordRunBodySchema } from '@/lib/validation/test-case'

export const runtime = 'nodejs'

type Params = { params: Promise<{ milestoneId: string; caseRef: string }> }

/**
 * POST /api/milestones/[milestoneId]/test-cases/[caseRef]/runs — append one
 * execution record.
 *
 * There is deliberately **no** PATCH/DELETE on a run: the log is append-only.
 * Correcting a mis-recorded run means appending another one, not rewriting
 * history. Do not add them.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  const { milestoneId, caseRef } = await params
  const parsed = recordRunBodySchema.safeParse(
    await request.json().catch(() => null)
  )
  if (!parsed.success) return zodError(parsed)
  try {
    return NextResponse.json(
      await milestoneTestCaseService.recordRun(
        milestoneId,
        caseRef,
        parsed.data,
        {
          actorMemberId: identity.memberId,
          sourceSessionId: request.headers.get('X-Lumo-Session-Id'),
        }
      )
    )
  } catch (error) {
    return errorResponse(error)
  }
}
