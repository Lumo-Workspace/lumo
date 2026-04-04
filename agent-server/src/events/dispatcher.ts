import type { DomainEvent } from '@lumo/shared'
import { registry } from './handlers/index.js'

/**
 * Dispatch domain events to registered handlers.
 * Each handler gets 1 retry on failure. Failures are logged but never
 * propagate — side-effects must not break the transition that emitted them.
 */
export async function dispatchEvents(events: DomainEvent[]): Promise<void> {
  for (const event of events) {
    switch (event.type) {
      case 'agent:status_changed': {
        const handlers = registry['agent:status_changed']
        await Promise.all(handlers.map(h => runWithRetry(h, event)))
        break
      }
      case 'task:status_changed': {
        const handlers = registry['task:status_changed']
        await Promise.all(handlers.map(h => runWithRetry(h, event)))
        break
      }
    }
  }
}

async function runWithRetry<T>(
  handler: (event: T) => Promise<void>,
  event: T
): Promise<void> {
  try {
    await handler(event)
  } catch {
    try {
      await handler(event)
    } catch (retryError) {
      console.error(`[events] Handler failed after retry:`, retryError)
    }
  }
}
