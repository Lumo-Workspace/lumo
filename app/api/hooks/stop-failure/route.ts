import { waitUntil } from '@vercel/functions'
import { handleHookRequest } from '@/app/api/hooks/_handler'
import { turnSummaryService } from '@/lib/services/turn-summary/turn-summary.service'

export async function POST(request: Request) {
  return handleHookRequest(request, 'STOP_FAILURE', {
    afterRecord: ctx => {
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
