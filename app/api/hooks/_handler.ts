import { NextResponse } from 'next/server'
import type { HookEventType, Prisma } from '@prisma/client'
import { verifyBearer } from '@/lib/auth/bearer'
import { hookEventService } from '@/lib/services/hook-event.service'

const UNAUTHORIZED = { error: 'Invalid or revoked API key' }

export async function handleHookRequest(
  request: Request,
  type: HookEventType
): Promise<Response> {
  try {
    const identity = await verifyBearer(request)
    if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })

    let payload: unknown
    try {
      payload = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    await hookEventService.recordHookEvent({
      identity,
      type,
      payload: (payload ?? {}) as Prisma.InputJsonValue,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    const status = (error as { status?: number } | null)?.status
    if (typeof status === 'number' && status >= 400 && status < 500) {
      const message = error instanceof Error ? error.message : 'Forbidden'
      return NextResponse.json({ error: message }, { status })
    }
    console.error(`POST /api/hooks/${type} error:`, error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
