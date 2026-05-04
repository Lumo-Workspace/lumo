import { waitUntil } from '@vercel/functions'
import { handleHookRequest } from '@/app/api/hooks/_handler'
import { layer1Service } from '@/lib/services/memory/layer1.service'
import { turnSummaryService } from '@/lib/services/turn-summary/turn-summary.service'

export async function POST(request: Request) {
  return handleHookRequest(request, 'STOP', {
    afterRecord: ctx => {
      // Stop marks the end of a Claude Code turn. Two parallel side effects:
      //   1. Layer 1 memory extraction — what to remember from this turn
      //   2. Turn summary — what the agent actually did this turn
      // Both keep the function alive past the response via waitUntil and own
      // their error handling (must never throw).
      if (!ctx.sessionId) return
      waitUntil(
        layer1Service.triggerLayer1Extraction({
          sessionId: ctx.sessionId,
          taskId: ctx.taskId,
          workspaceId: ctx.workspaceId,
        })
      )
      waitUntil(
        turnSummaryService.generateAndStore({
          stopEventId: ctx.eventId,
          sessionId: ctx.sessionId,
        })
      )
    },
  })
}
