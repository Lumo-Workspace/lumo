import { logger } from '@/lib/logger'
import { isIntegrationConfigured } from '@/lib/integrations/configured'
import { fetchOpenGraph } from '@/lib/integrations/og-metadata/fetch'
import { fetchOpenGraphChromium } from '@/lib/integrations/og-metadata/fetch-chromium'
import { shouldEscalateToChromium } from '@/lib/integrations/og-metadata/should-escalate'
import type { FetchResult } from '@/lib/integrations/og-metadata/fetch'

export function normalizeUrl(raw: string): { url: string; domain: string } {
  const u = new URL(raw.trim())
  u.protocol = u.protocol.toLowerCase()
  u.hostname = u.hostname.toLowerCase()
  u.hash = ''
  return { url: u.toString(), domain: u.hostname }
}

// Single entrypoint: try fast, escalate to chromium on block signal.
export async function fetchWithFallback(url: string): Promise<FetchResult> {
  const fast = await fetchOpenGraph(url)
  if (fast.ok) return fast
  if (!shouldEscalateToChromium(fast.error)) return fast
  // LUM-1025: no browser on this deployment — the plain fetch's answer stands.
  if (!isIntegrationConfigured('chromium')) {
    logger.info(
      `[og] chromium not configured, keeping plain fetch result: ${new URL(url).hostname}`
    )
    return fast
  }
  logger.info(
    `[og] escalating to chromium: ${new URL(url).hostname} reason=${fast.error}`
  )
  return fetchOpenGraphChromium(url)
}
