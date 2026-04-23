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
    // Only propagate statuses that Lumo's own services explicitly throw
    // (today: 403 from hookEventService for missing workspace membership).
    // An unknown 4xx from a third-party lib could leak internal messages,
    // so we force it to 500. Expand this allowlist when new service-level
    // 4xx errors are introduced.
    const status = (error as { status?: number } | null)?.status
    if (status === 403) {
      const message = error instanceof Error ? error.message : 'Forbidden'
      return NextResponse.json({ error: message }, { status: 403 })
    }
    console.error(`POST /api/hooks/${type} error:`, error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
