import { handleHookRequest } from '@/app/api/hooks/_handler'
import { collisionService } from '@/lib/services/collision.service'
import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'
import { collectPreToolUseReminders } from '@/lib/plugins/agent-context'

export async function POST(request: Request) {
  return handleHookRequest(request, 'PRE_TOOL_USE', {
    // Before Claude edits a file, hand back three best-effort context signals
    // for the CLI to inject into the agent's turn:
    //   1. parallel-edit collision warning (LUM-150 step ③)
    //   2. one-time reminder of freshly-detected boundary crossings (LUM-542) —
    //      so the agent learns it can file a `lumo crossing explain` rationale.
    //   3. one-time reminders contributed by plugins (LUM-1061) — the
    //      security plugin's PR scan with undispositioned findings (LUM-737),
    //      served as `securityReminder`.
    // All are cheap-gated (collision skips non-write tools; each reminder is a
    // single id-scoped lookup that returns null once nothing is un-notified).
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
        // The reminders are independent reads: one failing must not drop
        // another, so each is settled on its own and logged, never thrown
        // (the plugin reads are settled inside collectPreToolUseReminders).
        const [crossing, plugins] = await Promise.allSettled([
          boundaryCrossingService.buildAgentReminder(ctx.taskId),
          collectPreToolUseReminders({
            sessionId: ctx.sessionId,
            taskId: ctx.taskId,
          }),
        ])
        if (crossing.status === 'fulfilled') {
          if (crossing.value) extra.crossingReminder = crossing.value
        } else {
          console.error(
            'pre-tool-use crossing reminder error:',
            crossing.reason
          )
        }
        if (plugins.status === 'fulfilled') Object.assign(extra, plugins.value)
      }

      return Object.keys(extra).length > 0 ? extra : undefined
    },
  })
}
