import { waitUntil } from '@/lib/runtime/wait-until'
import { handleHookRequest } from '@/app/api/hooks/_handler'
import { autoBlockService } from '@/lib/services/auto-block.service'

export async function POST(request: Request) {
  return handleHookRequest(request, 'POST_TOOL_USE_FAILURE', {
    afterRecord: ctx => {
      // LUM-544 §3: server-side blocked-tag automation. A same-tool failure
      // streak crossing the threshold auto-tags the bound task `blocked`
      // (idempotent; attributed; auto-cleared on later progress). Detached —
      // never blocks the hook response; owns its errors.
      waitUntil(autoBlockService.onFailureRecorded(ctx.sessionId))
    },
  })
}
