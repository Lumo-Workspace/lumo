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
        outputTokenDetails?:
          | { reasoningTokens?: number | undefined }
          | undefined
      }
    | undefined
}

function failureOf(error: unknown): GenerationFailure {
  const e = (error ?? {}) as GenerationFailure
  return {
    finishReason:
      typeof e.finishReason === 'string' ? e.finishReason : undefined,
    text: typeof e.text === 'string' ? e.text : undefined,
    usage: typeof e.usage === 'object' && e.usage != null ? e.usage : undefined,
  }
}

/**
 * LUM-776 — the STABLE name of how a planning call failed. The message was
 * the only handle before, and the one the acceptance read-out kept tripping
 * on carries two opposite failures under one prefix: `No object generated:
 * the model did not return a response` (the output budget went to reasoning
 * and the JSON never came) versus `No object generated: response did not
 * match schema` (JSON came and a field missed). Counting them apart by
 * grepping prose is what this replaces.
 *
 *   - `budget-exhausted` — `finishReason: length`: the ceiling was hit,
 *     whether nothing came out or the JSON was cut off mid-way. Retryable
 *     (heavy-tailed reasoning appetite — LUM-766).
 *   - `empty-output`     — nothing came back and no `length` was reported.
 *     Retryable.
 *   - `schema-mismatch`  — output arrived and failed validation (or could
 *     not be parsed) with the model having STOPPED on its own. Not
 *     retryable: the same prompt gets the same shape.
 *   - `timeout`          — our abort fired, or the gateway said so.
 *   - `transport`        — 5xx / connection-level failure.
 *   - `unknown`          — none of the above; treated as not transient.
 */
export type PlanFailureShape =
  | 'budget-exhausted'
  | 'empty-output'
  | 'schema-mismatch'
  | 'timeout'
  | 'transport'
  | 'unknown'

export const PLAN_FAILURE_SHAPES: readonly PlanFailureShape[] = [
  'budget-exhausted',
  'empty-output',
  'schema-mismatch',
  'timeout',
  'transport',
  'unknown',
]

/**
 * Classify a planning failure. ORDER IS THE RULE SET:
 *
 *   1. an abort-shaped error (name) is a timeout — before reading any text.
 *   2. `finishReason: length` is a budget miss, even when the SDK reports it
 *      as a schema mismatch (truncated JSON) — the reason must be read
 *      BEFORE the message (LUM-766 follow-up).
 *   3. "did not return a response" with no text is an empty output.
 *   4. anything else the SDK calls "no object generated" / schema /
 *      validation / parse is a shape miss — checked BEFORE transport words,
 *      because those messages sometimes mention one, and a shape miss must
 *      never be read as a transport blip.
 *   5. timeout words, then the other transport signatures.
 */
export function classifyPlanFailure(error: unknown): PlanFailureShape {
  if (isAbortShaped(error)) return 'timeout'
  const f = failureOf(error)
  if (f.finishReason === 'length') return 'budget-exhausted'
  const message = messageOf(error).toLowerCase()
  if (
    message.includes('did not return a response') &&
    (f.text === undefined || f.text === '')
  )
    return 'empty-output'
  if (
    message.includes('no object generated') ||
    message.includes('schema') ||
    message.includes('validation') ||
    message.includes('could not parse')
  )
    return 'schema-mismatch'
  if (
    message.includes('aborted') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('etimedout')
  )
    return 'timeout'
  if (
    message.includes('econnreset') ||
    message.includes('socket hang up') ||
    message.includes('fetch failed') ||
    /\b5\d\d\b/.test(message)
  )
    return 'transport'
  return 'unknown'
}

/** How a failed planning call ended, in the form the audit records. */
export interface PlanFailureFacts {
  message: string
  /** LUM-776 — the stable classification; count on this, never on `message`. */
  shape: PlanFailureShape
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
  const facts: PlanFailureFacts = {
    message: messageOf(error),
    shape: classifyPlanFailure(error),
  }
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
 * Transient = the gateway did not answer, or this attempt ran out of budget:
 * an abort or timeout (including the `Delay was aborted` shape the AI SDK
 * raises when the signal lands inside its backoff sleep), a 5xx, a
 * connection-level failure, a `length` finish, or an empty response.
 *
 * Everything else is NOT transient, and the deterministic failures matter most:
 * a schema-validation miss is the model being wrong about the shape, and it
 * will be wrong the same way next time — retrying spends the budget twice for
 * the same answer. An unrecognised failure also returns false, so the default
 * is the deterministic fallback, which is a real answer rather than an error.
 *
 * LUM-776: defined ON the classification so the retry decision and the audit
 * label can never disagree about what a failure was.
 */
export function isTransientPlanError(error: unknown): boolean {
  switch (classifyPlanFailure(error)) {
    case 'timeout':
    case 'transport':
    case 'budget-exhausted':
    case 'empty-output':
      return true
    case 'schema-mismatch':
    case 'unknown':
      return false
  }
}
