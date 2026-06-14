import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { recordFragmentPull } from '@/lib/services/lineage-pull.service'
import { recordPullBodySchema } from '@/lib/validation/lineage'
import { zodError } from '@/lib/api/helpers'

export const runtime = 'nodejs'

/**
 * POST /api/lineage/pulls
 * Fire-and-forget telemetry from the CLI: records that an agent pulled a
 * fragment's body on demand, stamping `pulledAt` on the lineage edge (LUM-500).
 */
export async function POST(request: NextRequest) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const raw = await request.json()
    const parsed = recordPullBodySchema.safeParse(raw)
    if (!parsed.success) return zodError(parsed)

    const count = await recordFragmentPull(parsed.data)
    return NextResponse.json({ recorded: count })
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
