import { NextResponse } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { logger } from '@/lib/logger'
import { usageResyncService } from '@/lib/services/usage-resync.service'
import {
  usageResyncBodySchema,
  type UsageResyncBody,
} from '@/lib/validation/usage-resync'

// Up to 50 session families per request, one transaction each.
export const maxDuration = 300

const UNAUTHORIZED = { error: 'Invalid or revoked API key' }

/**
 * POST /api/sessions/usage-resync — LUM-932 `lumo usage resync`. The CLI
 * sends deduped transcript usage numbers for the caller's own sessions; the
 * service replaces inflated pre-1.85.0 figures exactly where eligible.
 * `dryRun: true` returns the plan and writes nothing.
 */
export async function POST(request: Request): Promise<Response> {
  const identity = await verifyBearer(request)
  if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })
  let body: UsageResyncBody
  try {
    body = usageResyncBodySchema.parse(await request.json())
  } catch {
    return NextResponse.json(
      { error: 'Invalid usage resync body' },
      { status: 400 }
    )
  }
  try {
    const result = await usageResyncService.resync({
      identity,
      dryRun: body.dryRun,
      sessions: body.sessions,
    })
    return NextResponse.json(result)
  } catch (error) {
    const status = (error as { status?: number } | null)?.status
    if (status === 403) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 403 }
      )
    }
    logger.error('POST /api/sessions/usage-resync error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
