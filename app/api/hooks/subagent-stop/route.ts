import { waitUntil } from '@vercel/functions'
import { handleHookRequest } from '@/app/api/hooks/_handler'
import { recomputeAttributionSafely } from '@/lib/attribution/trigger'

export async function POST(request: Request) {
  return handleHookRequest(request, 'SUBAGENT_STOP', {
    afterRecord: ctx => {
      // LUM-932 P2: a finished subagent changes the family's attribution.
      // ctx.sessionId is the child id; recomputeFamily maps it to the root.
      if (ctx.sessionId) waitUntil(recomputeAttributionSafely(ctx.sessionId))
    },
  })
}
