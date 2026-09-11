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
  const message = messageOf(error).toLowerCase()
  // Shape failures first — some of these also mention "response", so order
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
