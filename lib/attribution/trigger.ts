import { logger } from '@/lib/logger'

/**
 * LUM-932 P2: recompute a session family's attribution segments, best-effort.
 * Dynamic import keeps the attribution stack out of every hook route's static
 * import graph (and out of unrelated jest suites). Never throws.
 */
export async function recomputeAttributionSafely(
  sessionId: string
): Promise<void> {
  try {
    const { attributionService } =
      await import('@/lib/services/attribution.service')
    await attributionService.recomputeFamily(sessionId)
  } catch (error) {
    logger.error('attribution recompute failed', { sessionId, error })
  }
}
