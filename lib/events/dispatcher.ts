import type { DomainEvent } from './types'
import type { TaskActivityEvent } from './types/task-activity'
import { registry } from './handlers'

/**
 * Dispatch domain events to registered handlers.
 *
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
      default: {
        if ('task:activity' in registry) {
          const handlers = registry['task:activity']
          await Promise.all(
            handlers.map(h => runWithRetry(h, event as TaskActivityEvent))
          )
        }
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
    // 1 retry
    try {
      await handler(event)
    } catch (retryError) {
      console.error(`[events] Handler failed after retry:`, retryError)
    }
  }
}
