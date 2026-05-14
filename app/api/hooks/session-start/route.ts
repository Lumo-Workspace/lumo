import { handleHookRequest } from '@/app/api/hooks/_handler'
import { sessionRepository } from '@/lib/repositories/session.repository'

export async function POST(request: Request) {
  return handleHookRequest(request, 'SESSION_START', {
    afterRecord: async ctx => {
      if (!ctx.sessionId) return
      const binding = await sessionRepository.findTaskBinding(ctx.sessionId)
      return { sessionId: ctx.sessionId, taskBinding: binding }
    },
  })
}
