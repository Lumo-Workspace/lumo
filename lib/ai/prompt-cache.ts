/**
 * LUM-1224 — Anthropic prompt caching for the multi-step tool loops.
 *
 * A tool loop re-sends its whole transcript on every step. Marking a message
 * as a cache breakpoint makes Anthropic keep the prefix up to and including
 * it for five minutes: the next step reads that prefix at a tenth of the
 * input price instead of paying for it again (the write costs 1.25×, once).
 * The marker travels as `providerOptions.anthropic.cacheControl` on the
 * message; the AI Gateway forwards it to Anthropic under the provider pin and
 * zero data retention (probed live 2026-10-17, LUM-1224), and a provider that
 * is not Anthropic ignores it. Nothing else about the message changes — the
 * text the model reads is byte-identical.
 *
 * A breakpoint only pays when the next request repeats the prefix up to it
 * byte for byte, so callers mark the last message that the NEXT step will
 * send unchanged (`markCacheBreakpoint`). Prefixes shorter than the model's
 * minimum (512 tokens on Sonnet 5.5, 4096 on Haiku 4.5) are silently not
 * cached and not charged.
 *
 * Kept free of runtime dependencies (the `ai` import is type-only) so it is
 * unit-testable without pulling the gateway into scope.
 */
import type { ModelMessage } from 'ai'

/** The provider option that makes a message an Anthropic cache breakpoint. */
export const ANTHROPIC_CACHE_BREAKPOINT = {
  anthropic: { cacheControl: { type: 'ephemeral' } },
} as const

/** `message` with the cache breakpoint merged into its provider options. */
export function withCacheBreakpoint<M extends ModelMessage>(message: M): M {
  const options = message.providerOptions ?? {}
  return {
    ...message,
    providerOptions: {
      ...options,
      anthropic: {
        ...(options.anthropic ?? {}),
        ...ANTHROPIC_CACHE_BREAKPOINT.anthropic,
      },
    },
  }
}

/**
 * A copy of `messages` with the message at `index` marked as a breakpoint.
 * An index outside the list marks nothing; the input is never mutated.
 */
export function markCacheBreakpoint(
  messages: ReadonlyArray<ModelMessage>,
  index: number
): ModelMessage[] {
  return messages.map((m, i) => (i === index ? withCacheBreakpoint(m) : m))
}

export interface CacheUsage {
  /** Input tokens served from the cache (billed at ~0.1×). */
  cacheReadTokens: number
  /** Input tokens written to the cache (billed at ~1.25×). */
  cacheWriteTokens: number
}

/**
 * The cache share of a call's usage. `inputTokens` already includes both
 * (the SDK reports the total), so token budgets and existing counters are
 * unaffected; these two say how much of it was billed at the cache rates.
 */
export function cacheUsageOf(
  usage:
    | {
        inputTokenDetails?: {
          cacheReadTokens?: number | undefined
          cacheWriteTokens?: number | undefined
        }
      }
    | undefined
): CacheUsage {
  return {
    cacheReadTokens: usage?.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWriteTokens: usage?.inputTokenDetails?.cacheWriteTokens ?? 0,
  }
}
