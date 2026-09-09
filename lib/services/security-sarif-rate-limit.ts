import { Ratelimit } from '@upstash/ratelimit'
import { kv } from '@vercel/kv'

/** 30 token requests / minute per ingest key — a workflow needs 2 per PR. */
const ratelimit = new Ratelimit({
  redis: kv,
  limiter: Ratelimit.slidingWindow(30, '60 s'),
  prefix: 'sarif:rate',
  analytics: false,
})

export async function checkSarifIngestRateLimit(
  apiKeyId: string
): Promise<void> {
  const res = await ratelimit.limit(apiKeyId)
  if (!res.success) {
    throw Object.assign(new Error('Rate limit exceeded (30 req/min)'), {
      status: 429,
    })
  }
}
