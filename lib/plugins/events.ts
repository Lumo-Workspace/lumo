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
import { GITHUB_PROVIDER } from '@/lib/integrations/git-provider'
import { getPluginRegistry } from './registry'
import type { CoreEventHandler, CoreEvents, GithubCoreEvent } from './types'

/**
 * LUM-1318 — each GitHub webhook event's provider-neutral name. Emitting a
 * `github.*` event also delivers its `git.*` twin with `provider: 'github'`,
 * so plugins listen on the neutral name and the GitHub emitters (and every
 * event name they log) stay as they are.
 */
export const GITHUB_TO_GIT_EVENT = {
  'github.pullRequest': 'git.pullRequest',
  'github.push': 'git.push',
  'github.reviewThread': 'git.reviewThread',
  'github.issueComment': 'git.issueComment',
  'github.reviewComment': 'git.reviewComment',
} as const satisfies Record<GithubCoreEvent, keyof CoreEvents>

function isGithubEvent(event: keyof CoreEvents): event is GithubCoreEvent {
  return Object.prototype.hasOwnProperty.call(GITHUB_TO_GIT_EVENT, event)
}

export function emitCoreEvent<E extends keyof CoreEvents>(
  event: E,
  payload: CoreEvents[E]
): void {
  deliver(event, payload)
  if (isGithubEvent(event))
    deliver(GITHUB_TO_GIT_EVENT[event], {
      ...(payload as CoreEvents[GithubCoreEvent]),
      provider: GITHUB_PROVIDER,
    } as never)
}

function deliver<E extends keyof CoreEvents>(
  event: E,
  payload: CoreEvents[E]
): void {
  const handlers: readonly CoreEventHandler<E>[] =
    getPluginRegistry().handlersFor(event)
  for (const handler of handlers) {
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
