import { handleHookRequest } from '@/app/api/hooks/_handler'
import { collisionService } from '@/lib/services/collision.service'
import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'

export async function POST(request: Request) {
  return handleHookRequest(request, 'PRE_TOOL_USE', {
    // Before Claude edits a file, hand back two best-effort context signals for
    // the CLI to inject into the agent's turn:
    //   1. parallel-edit collision warning (LUM-150 step ③)
    //   2. one-time reminder of freshly-detected boundary crossings (LUM-542) —
    //      so the agent learns it can file a `lumo crossing explain` rationale.
    // Both are cheap-gated (collision skips non-write tools; the reminder query
    // is a single id-scoped lookup that returns null once nothing is unnotified).
    afterRecord: async ctx => {
      const extra: Record<string, unknown> = {}

      const collision = await collisionService.checkFileCollision({
        workspaceId: ctx.workspaceId,
        filePath: ctx.filePath,
        toolName: ctx.toolName,
        sessionId: ctx.sessionId,
        now: new Date(),
      })
      if (collision) extra.collisionWarning = collision.warning

      if (ctx.taskId) {
        const reminder = await boundaryCrossingService.buildAgentReminder(
          ctx.taskId
        )
        if (reminder) extra.crossingReminder = reminder
      }

      return Object.keys(extra).length > 0 ? extra : undefined
    },
  })
}
