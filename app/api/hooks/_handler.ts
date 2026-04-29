import { NextResponse } from 'next/server'
import type { HookEventType, Prisma } from '@prisma/client'
import { verifyBearer } from '@/lib/auth/bearer'
import { hookEventService } from '@/lib/services/hook-event.service'
import type { VerifyApiKeyResult } from '@/lib/services/auth.service'

const UNAUTHORIZED = { error: 'Invalid or revoked API key' }

export interface AfterRecordContext {
  sessionId: string | null
  taskId: string | null
  workspaceId: string
}

export interface HandleHookOptions {
  /**
   * Optional per-event side effect, invoked after the HookEvent row is
   * persisted but before the response is returned. Routes that need to
   * fire-and-forget background work (e.g. STOP → memory extraction) wrap
   * the call here in `waitUntil(...)` so the response isn't blocked but the
   * function instance stays alive long enough to finish.
   *
   * Must not throw; the caller treats this as best-effort.
   */
  afterRecord?: (ctx: AfterRecordContext, identity: VerifyApiKeyResult) => void
}

export async function handleHookRequest(
  request: Request,
  type: HookEventType,
  options: HandleHookOptions = {}
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

    const recorded = await hookEventService.recordHookEvent({
      identity,
      type,
      payload: (payload ?? {}) as Prisma.InputJsonValue,
    })

    if (options.afterRecord) {
      try {
        options.afterRecord(
          {
            sessionId: recorded.sessionId,
            taskId: recorded.taskId,
            workspaceId: identity.workspace.id,
          },
          identity
        )
      } catch (sideEffectError) {
        // afterRecord is best-effort; never let a side-effect failure flip the
        // hook response to 500 once the event is already persisted.
        console.error(
          `POST /api/hooks/${type} afterRecord error:`,
          sideEffectError
        )
      }
    }

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
