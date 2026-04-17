import { Ratelimit } from '@upstash/ratelimit'
import { kv } from '@vercel/kv'

export const BOOTSTRAP_TOOLS = new Set([
  'list_my_workspaces',
  'select_workspace',
  'get_active_workspace',
])

const ratelimit = new Ratelimit({
  redis: kv,
  limiter: Ratelimit.slidingWindow(60, '60 s'),
  prefix: 'mcp:rate',
  analytics: false,
})

export async function checkRateLimit(input: {
  clerkUserId: string
  toolName: string
}): Promise<{ success: true; remaining?: number }> {
  if (BOOTSTRAP_TOOLS.has(input.toolName)) {
    return { success: true }
  }
  const result = await ratelimit.limit(input.clerkUserId)
  if (!result.success) {
    throw Object.assign(new Error('Rate limit exceeded (60 req/min)'), {
      code: 'RATE_LIMIT',
    })
  }
  return { success: true, remaining: result.remaining }
}
