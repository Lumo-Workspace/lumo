import { waitUntil } from '@/lib/runtime/wait-until'
import { handleHookRequest } from '@/app/api/hooks/_handler'
import { boundaryDetectorService } from '@/lib/services/boundary-detector.service'
import { autoBlockService } from '@/lib/services/auto-block.service'

export async function POST(request: Request) {
  return handleHookRequest(request, 'POST_TOOL_USE', {
    afterRecord: ctx => {
      // LUM-544 §3 safeguard (2): a SUCCESSFUL tool call is observable progress
      // — clear any Lumo-applied `blocked` auto-block on the bound task. No-op
      // when there's no active auto-block (incl. human-applied tags). Detached.
      waitUntil(autoBlockService.onProgressRecorded(ctx.sessionId))

      // LUM-426: async forbidden-action boundary detection. Observe-only and
      // server-side, AFTER ingestion — runs detached via waitUntil so it never
      // blocks the response (exit-0 invariant, LUM-348). detectAndRecord owns
      // its errors and never throws. It gets the UNREDACTED payload (LUM-859):
      // secret detection needs the original text; only the stored copy is
      // redacted.
      if (!ctx.taskId) {
        // LUM-640: a task-less event may belong to a milestone-bound STEWARD
        // session — the detector backstop checks for implementation artifacts
        // (git commit / PR creation) and records a milestone-scoped crossing.
        // No-op for ordinary unbound sessions.
        waitUntil(
          boundaryDetectorService.detectAndRecordStewardArtifact({
            sessionId: ctx.sessionId,
            hookEventId: ctx.eventId,
            toolName: ctx.toolName,
            payload: ctx.rawPayload,
          })
        )
        return
      }
      waitUntil(
        boundaryDetectorService.detectAndRecord({
          taskId: ctx.taskId,
          hookEventId: ctx.eventId,
          toolName: ctx.toolName,
          filePath: ctx.filePath,
          payload: ctx.rawPayload,
          sessionId: ctx.sessionId,
        })
      )
    },
  })
}
