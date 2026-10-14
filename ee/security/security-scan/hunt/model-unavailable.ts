/**
 * LUM-1084 — "the hunt model is gone", told apart from a flaky call.
 *
 * `alibaba/qwen3-coder-plus` left the AI Gateway catalog and every production
 * hunt task failed with "Model not exist." — then the retry pass ran each task
 * again, and the fault re-queue ran the whole hunt again, each time on a fresh
 * VM, each time failing in seconds. A model that does not exist will not exist
 * a minute later: this predicate lets the hunt stop on the first such error
 * and say why, instead of spending two more attempts and reading as a
 * transient gateway fault.
 *
 * Pure. Walks the error chain the AI SDK builds (`cause`, a RetryError's
 * `lastError` / `errors`) because the gateway's own `GatewayModelNotFoundError`
 * may arrive wrapped, and an upstream provider's refusal arrives only as text.
 */

// "Model not exist." (the upstream text production saw), `model_not_found`,
// and the gateway's "The model 'x/y' does not exist" — the id quoted, so a
// sentence that merely mentions a model and a missing file does not match.
const MODEL_GONE_TEXT =
  /\bmodel[_ ]not[_ ](?:found|exists?)\b|\bmodel ['"`][^'"`\n]{1,120}['"`] does not exist\b/i

const MAX_DEPTH = 6

export function isModelUnavailableError(error: unknown): boolean {
  return visit(error, 0)
}

function visit(error: unknown, depth: number): boolean {
  if (error === null || error === undefined || depth > MAX_DEPTH) return false
  if (typeof error === 'string') return MODEL_GONE_TEXT.test(error)
  if (typeof error !== 'object') return false
  const e = error as {
    name?: unknown
    type?: unknown
    code?: unknown
    message?: unknown
    cause?: unknown
    lastError?: unknown
    errors?: unknown
  }
  if (e.name === 'GatewayModelNotFoundError') return true
  if (e.type === 'model_not_found' || e.code === 'model_not_found') return true
  if (typeof e.message === 'string' && MODEL_GONE_TEXT.test(e.message))
    return true
  if (visit(e.cause, depth + 1) || visit(e.lastError, depth + 1)) return true
  return (
    Array.isArray(e.errors) && e.errors.some(inner => visit(inner, depth + 1))
  )
}
