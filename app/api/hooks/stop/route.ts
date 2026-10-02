import { waitUntil } from '@vercel/functions'
import { handleHookRequest } from '@/app/api/hooks/_handler'
import { layer1Service } from '@/lib/services/memory/layer1.service'
import { turnSummaryService } from '@/lib/services/turn-summary/turn-summary.service'
import { recomputeAttributionSafely } from '@/lib/attribution/trigger'
import { autoBlockService } from '@/lib/services/auto-block.service'

export async function POST(request: Request) {
  return handleHookRequest(request, 'STOP', {
    afterRecord: ctx => {
      // LUM-544 §3 safeguard (2): a non-failure turn end is observable progress
      // — clear any Lumo-applied `blocked` auto-block on the bound task. No-op
      // without an active auto-block (incl. human-applied tags). Detached.
      waitUntil(autoBlockService.onProgressRecorded(ctx.sessionId))

      // Stop marks the end of a Claude Code turn. ONE detached side effect
      // (LUM-773 — previously two, each re-reading the same turn):
      //   - task-bound session → Layer 1 extraction, whose single model call
      //     yields both the memory candidates AND the turn summary;
      //   - no bound task → nothing to extract, so only the summary-only call.
      // Both keep the function alive past the response via waitUntil and own
      // their error handling (must never throw).
      if (!ctx.sessionId) return
      // LUM-932 P2: recompute the session family's attribution after the turn.
      waitUntil(recomputeAttributionSafely(ctx.sessionId))
      if (ctx.taskId) {
        waitUntil(
          layer1Service.triggerLayer1Extraction({
            sessionId: ctx.sessionId,
            taskId: ctx.taskId,
            workspaceId: ctx.workspaceId,
            stopEventId: ctx.eventId,
          })
        )
        return
      }
      waitUntil(
        turnSummaryService.generateAndStore({
          stopEventId: ctx.eventId,
          sessionId: ctx.sessionId,
        })
      )
    },
  })
}
