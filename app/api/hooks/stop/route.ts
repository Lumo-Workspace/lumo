import { waitUntil } from '@vercel/functions'
import { handleHookRequest } from '@/app/api/hooks/_handler'
import { layer1Service } from '@/lib/services/memory/layer1.service'

export async function POST(request: Request) {
  return handleHookRequest(request, 'STOP', {
    afterRecord: ctx => {
      // Stop marks the end of a Claude Code turn — kick off Layer 1 memory
      // extraction. waitUntil keeps the serverless function alive past the
      // response so the LLM call + DB writes have time to complete; the
      // service owns its own error handling (must never throw).
      if (!ctx.sessionId) return
      waitUntil(
        layer1Service.triggerLayer1Extraction({
          sessionId: ctx.sessionId,
          taskId: ctx.taskId,
          workspaceId: ctx.workspaceId,
        })
      )
    },
  })
}
