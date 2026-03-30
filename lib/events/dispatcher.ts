import type { DomainEvent, EventHandler } from './types'
import { getHandlers } from './handlers'

/**
 * Dispatch domain events to registered handlers.
 *
 * Each handler gets 1 retry on failure. Failures are logged but never
 * propagate — side-effects must not break the transition that emitted them.
 */
export async function dispatchEvents(events: DomainEvent[]): Promise<void> {
  for (const event of events) {
    const handlers = getHandlers(event.type)
    await Promise.all(handlers.map(h => runWithRetry(h, event)))
  }
}

async function runWithRetry(
  handler: EventHandler,
  event: DomainEvent
): Promise<void> {
  try {
    await handler(event)
  } catch {
    // 1 retry
    try {
      await handler(event)
    } catch (retryError) {
      console.error(
        `[events] Handler failed after retry for ${event.type}:`,
        retryError
      )
    }
  }
}
