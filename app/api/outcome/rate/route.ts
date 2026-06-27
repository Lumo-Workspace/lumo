import { NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth/identity'
import { outcomeRejectionService } from '@/lib/services/outcome-rejection.service'

export const runtime = 'nodejs'

/**
 * GET /api/outcome/rate — the workspace trust × post-hoc-fate read (LUM-603 /
 * LUM-606): per delivery-time verification-friction bucket (no-verification /
 * single-round / multi-round-or-sendback, frozen at delivery), the post-hoc
 * REJECTED rate from the outcome well, with honest small-N suppression and an
 * inconclusive single-round-vs-multi comparison until the well accumulates
 * enough signal. `?min=N` overrides the per-bucket sample floor.
 */
export async function GET(request: Request): Promise<Response> {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const minRaw = new URL(request.url).searchParams.get('min')
  let minSamples: number | undefined
  if (minRaw !== null) {
    const n = Number(minRaw)
    if (!Number.isInteger(n) || n < 1) {
      return NextResponse.json(
        { error: 'min must be a positive integer' },
        { status: 400 }
      )
    }
    minSamples = n
  }

  const report = await outcomeRejectionService.getOutcomeRejectionRate(
    identity.workspaceId,
    minSamples !== undefined ? { minSamples } : {}
  )
  return NextResponse.json(report)
}
