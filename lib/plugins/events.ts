/**
 * LUM-1061 (RFC §3.4 "事件") — core domain events for plugins.
 *
 * Fire-and-forget and synchronous: each handler is called in registration
 * order and never awaited; a handler that starts background work registers
 * it with `waitUntil` itself. A handler that throws is logged and skipped —
 * an event can never fail the webhook or the request that raised it. No
 * handler → nothing happens.
 */
import { logger } from '@/lib/logger'
import { getPluginRegistry } from './registry'
import type { CoreEvents } from './types'

export function emitCoreEvent<E extends keyof CoreEvents>(
  event: E,
  payload: CoreEvents[E]
): void {
  for (const handler of getPluginRegistry().handlersFor(event)) {
    try {
      handler(payload)
    } catch (error) {
      logger.error(
        `[plugins] ${event} handler failed:`,
        error instanceof Error ? error.message : String(error)
      )
    }
  }
}
