/**
 * LUM-758 follow-up — is a failed planning call worth a second window?
 *
 * `securityHuntService.planHunt` never throws (a failed plan has a
 * deterministic answer, and an LLM retry storm is exactly what we do not
 * want), which means `planHuntStep`'s platform retry can never fire. This
 * predicate is therefore the ONLY thing standing between a two-second gateway
 * blip and a scan whose plan is degraded to the deterministic fallback for
 * good — which is what happened in prod on PR 969.
 *
 * Pure and dependency-free so it is tested without mocks, per the rule in
 * `security-hunt.service.ts`'s header.
 */

/** Abort/timeout raised as a DOMException-shaped error rather than a message. */
function isAbortShaped(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name
  return name === 'AbortError' || name === 'TimeoutError'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * What the AI SDK attaches to a `NoObjectGeneratedError` and we were throwing
 * away: the raw text the model produced, why it stopped, and what it spent.
 *
 * Read by duck-typing rather than by importing `NoObjectGeneratedError` from
 * `ai`: this module is pure and is pulled into the `'use workflow'` bundle
 * through the hunt service, and the SDK is kept out of that graph on purpose
 * (it is loaded by dynamic import at the call site).
 */
interface GenerationFailure {
  finishReason?: string | undefined
  text?: string | undefined
  usage?:
    | {
        outputTokens?: number | undefined
        outputTokenDetails?: { reasoningTokens?: number | undefined } | undefined
      }
    | undefined
}

function failureOf(error: unknown): GenerationFailure {
  const e = (error ?? {}) as GenerationFailure
  return {
    finishReason: typeof e.finishReason === 'string' ? e.finishReason : undefined,
    text: typeof e.text === 'string' ? e.text : undefined,
    usage: typeof e.usage === 'object' && e.usage != null ? e.usage : undefined,
  }
}

/** How a failed planning call ended, in the form the audit records. */
export interface PlanFailureFacts {
  message: string
  finishReason?: string
  reasoningTokens?: number
  outputTokens?: number
  /** First characters of whatever the model DID emit — empty means nothing. */
  textPrefix?: string
}

/** Longest slice of the model's raw output to carry into the audit. */
export const PLAN_FAILURE_TEXT_CHARS = 300

/**
 * Turn a planning failure into facts worth storing.
 *
 * Until this existed the audit kept only `error.message`, so "the model did not
 * return a response" and "response did not match schema" were the whole record
 * — neither of which says WHICH field failed, nor whether the empty answer was
 * a model that had nothing to say or one that spent its entire output budget
 * on reasoning and never got to the JSON. Both happened in production on the
 * same day and they need opposite responses.
 */
export function describePlanFailure(error: unknown): PlanFailureFacts {
  const f = failureOf(error)
  const facts: PlanFailureFacts = { message: messageOf(error) }
  if (f.finishReason !== undefined) facts.finishReason = f.finishReason
  const reasoning = f.usage?.outputTokenDetails?.reasoningTokens
  if (typeof reasoning === 'number') facts.reasoningTokens = reasoning
  if (typeof f.usage?.outputTokens === 'number')
    facts.outputTokens = f.usage.outputTokens
  if (f.text !== undefined)
    facts.textPrefix = f.text.slice(0, PLAN_FAILURE_TEXT_CHARS)
  return facts
}

/**
 * Transient = the gateway did not answer: an abort or timeout (including the
 * `Delay was aborted` shape the AI SDK raises when the signal lands inside its
 * backoff sleep), a 5xx, or a connection-level failure.
 *
 * Everything else is NOT transient, and the deterministic failures matter most:
 * a schema-validation miss is the model being wrong about the shape, and it
 * will be wrong the same way next time — retrying spends the budget twice for
 * the same answer. An unrecognised failure also returns false, so the default
 * is the deterministic fallback, which is a real answer rather than an error.
 */
export function isTransientPlanError(error: unknown): boolean {
  if (isAbortShaped(error)) return true
  const f = failureOf(error)
  // A model that ran out of output budget is NOT a model that was wrong about
  // the shape, and the old rule — "anything saying `no object generated` will
  // fail the same way again" — denied it the second window it was configured
  // to have. LUM-766's isolation experiment measured why that is wrong:
  // reasoning appetite is heavy-tailed, the SAME prompt spending 1938 tokens on
  // one run and 3912 on the next. `length` means this attempt hit the ceiling,
  // not that every attempt will.
  if (f.finishReason === 'length') return true
  // Same shape, reported without a finish reason: nothing came back at all.
  // A validation miss always carries the text it failed to validate.
  const message = messageOf(error).toLowerCase()
  if (
    message.includes('did not return a response') &&
    (f.text === undefined || f.text === '')
  )
    return true
  // Shape failures next — some of these also mention "response", so order
  // matters: a schema miss must never be read as a transport problem.
  if (message.includes('no object generated')) return false
  if (message.includes('schema') || message.includes('validation')) return false
  return (
    message.includes('aborted') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('socket hang up') ||
    message.includes('fetch failed') ||
    /\b5\d\d\b/.test(message)
  )
}
