import { waitUntil } from '@vercel/functions'
import { handleHookRequest } from '@/app/api/hooks/_handler'
import { stopTurnService } from '@/lib/services/stop-turn.service'
import { autoBlockService } from '@/lib/services/auto-block.service'

export async function POST(request: Request) {
  return handleHookRequest(request, 'STOP', {
    afterRecord: ctx => {
      // LUM-544 §3 safeguard (2): a non-failure turn end is observable progress
      // — clear any Lumo-applied `blocked` auto-block on the bound task. No-op
      // without an active auto-block (incl. human-applied tags). Detached.
      waitUntil(autoBlockService.onProgressRecorded(ctx.sessionId))

      // Stop marks the end of a Claude Code turn: attribution recompute plus
      // ONE model call (LUM-773) — Layer 1 extraction for a task turn, else the
      // summary-only call. For an unattached session the recompute runs first
      // so Layer 1 targets the turn's re-attributed task (LUM-932). Detached;
      // the service owns its errors (must never throw).
      if (!ctx.sessionId) return
      waitUntil(
        stopTurnService.afterStop({
          sessionId: ctx.sessionId,
          taskId: ctx.taskId,
          workspaceId: ctx.workspaceId,
          eventId: ctx.eventId,
        })
      )
    },
  })
}
