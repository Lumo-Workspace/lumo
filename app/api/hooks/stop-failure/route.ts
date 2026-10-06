import { waitUntil } from '@/lib/runtime/wait-until'
import { handleHookRequest } from '@/app/api/hooks/_handler'
import { turnSummaryService } from '@/lib/services/turn-summary/turn-summary.service'
import { autoBlockService } from '@/lib/services/auto-block.service'

export async function POST(request: Request) {
  return handleHookRequest(request, 'STOP_FAILURE', {
    afterRecord: ctx => {
      // LUM-544 §3: a failed turn counts toward the same-type failure streak
      // that auto-tags the bound task `blocked` (idempotent / attributed /
      // auto-cleared on progress). Detached; owns its errors.
      waitUntil(autoBlockService.onFailureRecorded(ctx.sessionId))

      // StopFailure also closes a turn — generate a summary so the UI's
      // "what happened in this turn" header still has something useful
      // even when the turn ended on an API error.
      if (!ctx.sessionId) return
      waitUntil(
        turnSummaryService.generateAndStore({
          stopEventId: ctx.eventId,
          sessionId: ctx.sessionId,
        })
      )
    },
  })
}
