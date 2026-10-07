import { createSlidingWindow } from '@/lib/rate-limit'

export const BOOTSTRAP_TOOLS = new Set([
  'list_my_workspaces',
  'select_workspace',
  'get_active_workspace',
])

/**
 * 60 MCP tool calls per user per rolling minute. Backend is pluggable
 * (LUM-1020): Vercel KV / Upstash, `REDIS_URL`, or a per-instance in-memory
 * window when neither is configured. Unlike the endpoint limiters, a backend
 * error here propagates (the tool call fails), as before.
 */
const ratelimit = createSlidingWindow({
  prefix: 'mcp:rate',
  max: 60,
  windowMs: 60_000,
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

/** Test-only: reset module-level limiter state between test cases. */
export function __resetMcpRateLimitForTests(): void {
  ratelimit.reset()
}
