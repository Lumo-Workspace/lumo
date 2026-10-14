/**
 * LUM-1139 — one retry for the thread-reply classifier.
 *
 * The FAST-tier model sometimes answers `isLearning: false` to a reply it
 * accepts on the next call, and sometimes runs past its timeout (the
 * LUM-1131 probe: recall 0.78, the stochastic misses were one refusal and
 * one 30 s timeout). So a refusal or a failure gets exactly one more call —
 * never more — within a bounded total time, because the webhook handler
 * runs this inside its function budget.
 *
 * Only reached for a reply the deterministic gate already labelled
 * `LEARNING` (`screenReply`); the retry never widens the gate, and a
 * learning still needs the model's own `isLearning: true` plus
 * `decideLearning`'s text checks. Pure orchestration: the caller passes the
 * model call (`classifyThreadReply`), so this module stays free of the AI
 * SDK and is unit-testable.
 */
import type { ThreadReplyVerdict } from '@/ee/security/llm/thread-reply-client'

/** One call's timeout (the LUM-1131 value). */
export const CLASSIFY_ATTEMPT_TIMEOUT_MS = 30_000
/** Both calls together never take longer than this. */
export const CLASSIFY_TOTAL_BUDGET_MS = 55_000
/** A retry with less time than this left is not attempted. */
export const CLASSIFY_MIN_RETRY_MS = 5_000

export interface ClassifyWithRetryResult {
  /** The answer to use: the retry's, else the first call's refusal, else null. */
  verdict: ThreadReplyVerdict | null
  /** 1 or 2. */
  attempts: number
  /** Why a second call was made, if one was. */
  retried: 'refused' | 'error' | null
  /** The message of each failed call, in order. */
  errors: string[]
}

export interface ClassifyWithRetryOptions {
  attemptTimeoutMs?: number
  totalBudgetMs?: number
  minRetryMs?: number
  now?: () => number
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * Call `classify` once; on a refusal (`isLearning: false`) or a thrown
 * error (timeout included) call it once more with the time left. `attempt`
 * tells the caller which call this is, so the retry can go to the fallback
 * model (a second opinion from a different model, and a different route
 * when the first one timed out). Never throws.
 */
export async function classifyWithRetry(
  classify: (timeoutMs: number, attempt: 1 | 2) => Promise<ThreadReplyVerdict>,
  options: ClassifyWithRetryOptions = {}
): Promise<ClassifyWithRetryResult> {
  const attemptTimeout = options.attemptTimeoutMs ?? CLASSIFY_ATTEMPT_TIMEOUT_MS
  const budget = options.totalBudgetMs ?? CLASSIFY_TOTAL_BUDGET_MS
  const minRetry = options.minRetryMs ?? CLASSIFY_MIN_RETRY_MS
  const now = options.now ?? Date.now
  const deadline = now() + budget
  const errors: string[] = []

  let first: ThreadReplyVerdict | null = null
  try {
    first = await classify(Math.min(attemptTimeout, budget), 1)
    if (first.isLearning)
      return { verdict: first, attempts: 1, retried: null, errors }
  } catch (error) {
    errors.push(messageOf(error))
  }

  const retried = first ? 'refused' : 'error'
  const left = deadline - now()
  if (left < minRetry)
    return { verdict: first, attempts: 1, retried: null, errors }

  try {
    const second = await classify(Math.min(attemptTimeout, left), 2)
    return { verdict: second, attempts: 2, retried, errors }
  } catch (error) {
    errors.push(messageOf(error))
    return { verdict: first, attempts: 2, retried, errors }
  }
}
