import { handleHookRequest } from '@/app/api/hooks/_handler'
import { collisionService } from '@/lib/services/collision.service'

export async function POST(request: Request) {
  return handleHookRequest(request, 'PRE_TOOL_USE', {
    // Before Claude edits a file, check whether another session in the same
    // workspace recently wrote the same file and, if so, hand back a warning
    // for the CLI to inject into the agent's context (LUM-150 step ③). The
    // service cheaply gates non-write tools, so most tool calls add no query.
    afterRecord: async ctx => {
      const result = await collisionService.checkFileCollision({
        workspaceId: ctx.workspaceId,
        filePath: ctx.filePath,
        toolName: ctx.toolName,
        sessionId: ctx.sessionId,
        now: new Date(),
      })
      if (result) return { collisionWarning: result.warning }
      return undefined
    },
  })
}
