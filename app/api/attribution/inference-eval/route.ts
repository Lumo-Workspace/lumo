import { NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { attributionService } from '@/lib/services/attribution.service'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
})

/**
 * GET /api/attribution/inference-eval?days=7
 *
 * Read-only: scores the engine's inferred per-turn task attribution against
 * the caller's own explicit `session attach` bindings.
 *
 * Load bound: `days` defaults to 7 (max 90) and at most the 50 most recently
 * active attached sessions are re-inferred per call, each loading its whole
 * session family.
 */
export async function GET(request: Request): Promise<Response> {
  const identity = await verifyBearer(request)
  if (!identity) {
    return NextResponse.json(
      { error: 'Invalid or revoked API key' },
      { status: 401 }
    )
  }

  const raw = new URL(request.url).searchParams.get('days')
  const parsed = querySchema.safeParse(raw === null ? {} : { days: raw })
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'days must be an integer between 1 and 90' },
      { status: 400 }
    )
  }

  try {
    const result = await attributionService.inferenceEval({
      identity,
      days: parsed.data.days,
    })
    return NextResponse.json(result)
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 403) {
      return NextResponse.json(
        { error: 'Not a workspace member' },
        { status: 403 }
      )
    }
    logger.error('attribution.inferenceEval.failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
